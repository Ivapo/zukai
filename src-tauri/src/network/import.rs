//! `network.yaml` → [`Document`]: the easy direction.
//!
//! Import throws information away. The polylines go, because a schematic
//! intentionally distorts real geometry for clarity and reusing surveyed
//! coordinates is the whole thing Zukai exists not to do. What does *not* go is
//! `point`: it is **demoted, not discarded** — it seeds `layout.nodes` and never
//! reaches `doc.nodes`, which stays geometry-free.
//!
//! A polyline's **total** is demoted the same way, and it is the sharpest case of
//! the distinction: [`geometry_length`] sums it into `Link::length`, a *label*
//! stating how long the road is, while the shape it was summed from is thrown
//! away and the canvas is laid out without it. One road, two independent records
//! (link-length spec §2.2).
//!
//! That seeding is not a nicety. A node with no layout entry has no drawable
//! polyline, so an unseeded import renders a blank page. **The positions are
//! placed for legibility rather than for fidelity**: [`super::layout_factor`]
//! fits the network's bounding box into one screenful, so a node arrives where
//! it reads well rather than where it is. That is a scaled *placement*, not a
//! schematization — every relative position survives it, and no
//! orthogonalization or octilinear snapping is performed. The human still drags
//! the diagram into shape; the difference is that they are no longer dragging
//! 143 lane-widths of road.
//!
//! Import also *mints* one thing the file has no equivalent of: a turn arrow per
//! approach lane, painted from the movements' own `from_lanes` (see
//! [`lane_arrows`]). That is the one place a `network.yaml` field is read without
//! being carried, and it is where the two projects' **opposite lane numberings**
//! are reconciled — once, at this boundary, by [`kerb_lane`].
//!
//! The conversion is pure: [`network_to_document`] touches no filesystem and no
//! IPC, and everything a test needs to exercise it is a `&str`.
//! [`import_network`] is the thin shell around it — read the file, probe the
//! version, convert — and is the only thing here the app can reach. See
//! `specs/network_yaml_spec.md` §2.5–§2.6 and `specs/lane_arrows_spec.md` §2.5.

use std::collections::BTreeMap;
// The module's one non-portable line, and it serves exactly one function.
#[cfg(not(target_arch = "wasm32"))]
use std::fs;

use crate::model::decoration::{LinkEnd, Marking, MarkingKind, TurnDirection};
use crate::model::graph::{Junction, Lane, Link, Node, NodeKind};
use crate::model::ids::{LaneIdx, LinkId};
use crate::model::layout::{JunctionView, LinkAlign, LinkStyle, LinkView, NodeView};
use crate::model::Document;

use super::{
    layout_factor, metres_to_canvas, parse_network, MovementKind, NetworkFile, NetworkJunction,
    NetworkLink, UNITS_PER_METRE,
};

/// How far a turn arrow runs along the road, in world units.
///
/// A hand-mirror of the frontend's `TURN_ARROW_LENGTH`
/// (`src/editor/geometry.ts`), which has no Rust source to derive from — a
/// rendering number that never crosses IPC, exactly as
/// [`UNITS_PER_METRE`](super::UNITS_PER_METRE) is. `the_arrow_length_is_the_one_the_canvas_draws`
/// is what stops the two drifting.
const TURN_ARROW_LENGTH: f64 = 15.0;

/// The order a minted arrow's directions are written in.
///
/// A hand-mirror of `TURN_DIRECTIONS` (`src/components/Inspector.tsx`), which is
/// a module-private TypeScript const: **road order, left to right**, so the
/// stored array reads like the arrow it describes and two imports of one file
/// produce byte-identical documents whatever order the movements appeared in.
/// `the_direction_order_is_the_one_the_panel_rebuilds` pins the two equal.
const CANONICAL_TURN_DIRECTIONS: [TurnDirection; 6] = [
    TurnDirection::UTurn,
    TurnDirection::Left,
    TurnDirection::SlightLeft,
    TurnDirection::Through,
    TurnDirection::SlightRight,
    TurnDirection::Right,
];

/// Read a `network.yaml` from disk and convert it to a Zukai [`Document`].
///
/// The command surface for the whole module: [`crate::persist::load_document`]'s
/// shape, one format over. What the *caller* does with the result is where the
/// two part company — an imported document is **dirty and pathless**, because
/// this is not a `.zkai` and Save must not write back over the file it came
/// from. That rule lives in the reducer (`importDocument`), not here.
#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
pub fn import_network(path: String) -> Result<Document, String> {
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    import_network_str(&text)
}

/// The same conversion, given the file's *text* rather than its path.
///
/// The desktop twin of the browser's `#[wasm_bindgen]` shell, and it exists so
/// `Host.importNetworkText` is a method **both** hosts honour rather than one
/// the desktop refuses (`specs/web_demo_spec.md` Phase 2). Nothing dispatches to
/// it today — the browser drop calls the wasm — but wiring the Tauri webview's
/// own file drop to it later is a one-liner rather than a redesign of the seam.
#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
pub fn import_network_text(text: String) -> Result<Document, String> {
    import_network_str(&text)
}

/// Parse, then convert. **The one place those two steps are composed**, and the
/// reason it is a function rather than a line repeated three times: there are
/// three shells over it now — the two commands above and `crate::wasm` — and a
/// shell that composed them itself would be a second implementation to keep in
/// step. Takes a `&str` and returns a [`Document`]; touches nothing else.
pub fn import_network_str(text: &str) -> Result<Document, String> {
    network_to_document(parse_network(text)?)
}

/// Turn a parsed [`NetworkFile`] into a Zukai [`Document`].
///
/// Fails only on a coordinate system this reader cannot honour. Every other
/// difference between the two models is a drop or a default, not an error —
/// there is no validation pass here, because Assimilator wrote the file and
/// Assimilator is the thing that validates it.
pub fn network_to_document(net: NetworkFile) -> Result<Document, String> {
    // The "present and" matters: `coordinate_system` defaults to `metric` in the
    // mirror, so an absent key already reads as metric and must not trip this.
    // Every conversion below assumes metres.
    if net.metadata.coordinate_system != "metric" {
        return Err(format!(
            "This network uses the '{}' coordinate system; Zukai reads only 'metric' \
             (all positions in metres).",
            net.metadata.coordinate_system
        ));
    }

    let mut doc = Document::new(net.metadata.name);
    doc.metadata.author = net.metadata.author;

    // Once, off the whole file, before any node is placed: the fit is a property
    // of the network rather than of a node, and computing it per node would let
    // one arrive at a different scale from its neighbour.
    let factor = layout_factor(&net.nodes);

    for node in &net.nodes {
        doc.nodes.push(Node {
            id: node.id.clone(),
            kind: node.kind,
        });
        // The demotion: metric position out of the graph and into the layout.
        doc.layout.nodes.insert(
            node.id.clone(),
            NodeView {
                pos: metres_to_canvas(node.point, factor),
            },
        );
        // A junction-kind node gets the default glyph, the way `setNodeKind`
        // mints one. Keyed by node kind rather than by the presence of a
        // junction record, because that is the pairing the editor maintains.
        if node.kind == NodeKind::Junction {
            doc.layout
                .junctions
                .insert(node.id.clone(), JunctionView::default());
        }
    }

    // Before the loop below consumes the links: the arrows need each approach's
    // lane *count* to read the file's lane numbering in Zukai's.
    doc.markings = lane_arrows(&net.junctions, &net.links);

    for link in net.links {
        // `geometry` and `lateral_offset` stop here. `median_gap` does not: it
        // is a road property Assimilator applies itself, not a shift already
        // baked into the polyline.
        doc.layout.links.insert(
            link.id.clone(),
            LinkView {
                // Defaults, never derived. A road class inferred from a speed
                // limit is a guess dressed as a fact.
                style: LinkStyle::default(),
                align: LinkAlign::default(),
                bends: Vec::new(),
            },
        );
        doc.links.push(import_link(link));
    }

    doc.junctions = net.junctions.into_iter().map(import_junction).collect();

    Ok(doc)
}

/// A link arrives with its lanes **renumbered from the kerb**.
///
/// The file orders them from the median and Zukai orders them from the kerb
/// ([`kerb_lane`]), so the array is reversed on the way in. Nothing downstream
/// knows there was ever another numbering — `rules/persistence.md`'s
/// normalize-at-one-boundary rule, one format over.
///
/// **The reversal renumbers rather than reorders.** Each lane takes its *new*
/// position as its [`Lane::id`], because that field is documented as the index
/// (`graph.rs`) and every reader is positional; copying the file's id through
/// would leave `lanes[0].id == 1`, which breaks the struct's own invariant while
/// every positional reader carries on working.
fn import_link(link: NetworkLink) -> Link {
    let count = link.lanes.len();
    // Read before the lanes move out of `link` below.
    let length = geometry_length(&link.geometry);
    let mut lanes: Vec<Lane> = link
        .lanes
        .into_iter()
        .enumerate()
        .map(|(file_index, lane)| Lane {
            // In range by construction — the index came from this very array.
            id: kerb_lane(count, file_index).expect("a lane's own index is in range"),
            width: lane.width,
            speed_limit: lane.speed_limit,
            allowed_classes: lane.allowed_classes,
            // Schematic-only, so nothing in the file can supply it.
            kind: None,
        })
        .collect();
    lanes.sort_by_key(|lane| lane.id);

    Link {
        id: link.id,
        from_node: link.from_node,
        to_node: link.to_node,
        lanes,
        median_gap: link.median_gap,
        // The one thing the discarded polyline leaves behind: its total, as the
        // road's stated length (link-length spec Phase 2).
        length,
    }
}

/// How long the road really is, in metres, summed off the polyline import throws
/// away.
///
/// **This is not the frontend's `polylineLength`** (`src/editor/geometry.ts`),
/// and the two must never be confused: that one measures the *drawn* polyline in
/// canvas units, and the link-length spec §2.2 forbids it from ever reaching
/// [`Link::length`]. This one measures the *file's* polyline in metres, which is
/// a fact about the road rather than a measurement of the diagram. Import is the
/// only place the two numbers are ever both in hand, and it keeps them apart.
///
/// The shape itself still goes — a schematic distorts real geometry for clarity.
/// Only the total survives, and it survives as a **label**, which is why import
/// can carry a real length without carrying a real distance
/// (`network_yaml_spec.md` OQ-2).
///
/// **`None` for anything with nothing to measure**, and the degenerate cases need
/// no branch: `windows(2)` yields nothing on an empty or one-point polyline, so
/// the sum is `0.0` and the guard below rejects it. "At least 2 points"
/// ([`NetworkLink::geometry`](super::NetworkLink::geometry)) is a doc comment
/// rather than a parse invariant, so such a file reaches here today. A road that
/// states no length is not a road of length zero.
fn geometry_length(geometry: &[[f64; 2]]) -> Option<f64> {
    let total: f64 = geometry
        .windows(2)
        .map(|pair| (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]))
        .sum();
    (total.is_finite() && total > 0.0).then_some(total)
}

/// The file's lane numbering read in Zukai's, or `None` for an index the link
/// does not have.
///
/// **The two count in opposite directions**, and this is the one thing about
/// importing lanes that fails silently while looking entirely plausible:
///
/// - Assimilator counts from the median — "0 is the leftmost/fastest lane"
///   (`crates/config/src/network.rs`).
/// - Zukai counts from the kerb — "lane 0 is the nearside (kerb) lane"
///   (`src/editor/geometry.ts`).
///
/// So `count - 1 - index`, which is **its own inverse** — which is why one
/// function serves both callers without a second formula: [`import_link`] maps a
/// file index to a new array position, [`lane_arrows`] maps a file index into the
/// already-reversed array, and the two do not compound.
fn kerb_lane(lane_count: usize, index: usize) -> Option<LaneIdx> {
    let flipped = lane_count.checked_sub(1)?.checked_sub(index)?;
    LaneIdx::try_from(flipped).ok()
}

/// A junction arrives as its control and its right-of-way rule, and nothing else.
///
/// **The `movements` block is read and not carried**, which is the sharpest case
/// of this module's mirror-what-is-drawn rule: it is what [`lane_arrows`] paints
/// the approach from, and then it stops. No `Junction` field holds it, no `.zkai`
/// key records it and no panel row edits it — the paint is the whole of what
/// survives (lane arrows §2.1).
///
/// **`signal_plan` is discarded**, alongside the ten simulation-only fields the
/// mirror never read. A fixed-time plan is a table of stage timings; nothing in
/// a schematic draws one, and Zukai does not write this format back out, so
/// carrying it would be carrying data for no reader (`specs/signal_plans_spec.md`
/// §0).
fn import_junction(junction: NetworkJunction) -> Junction {
    Junction {
        node_id: junction.node_id,
        control: junction.control,
        rule: junction.rule,
    }
}

/// One turn arrow per approach lane the file gives a turn to.
///
/// This is what makes an imported junction *legible*: a real approach says which
/// lane goes where with paint, not with a web of arcs across the middle of the
/// pad. The source is `from_lanes` — the one `network.yaml` field read without
/// being carried (`specs/lane_arrows_spec.md` §2.5).
///
/// **Import seeds and lets go.** Nothing binds an arrow to the movement it came
/// from: the paint *is* the claim from here on, and it is an ordinary
/// [`Marking`] the human may drag, repaint or delete. Re-deriving it would stomp
/// that edit with no way to refuse, and a simplified drawing may deliberately say
/// less than the junction permits.
///
/// Three cases need no special handling and all three are right: a u-turn with
/// `from_lanes: []` (all four of `cross-4`'s) claims no lane, a lane serving
/// several turns gets **one** arrow with several branches, and a lane with no
/// movement gets no paint at all rather than a symbol Zukai would be inventing.
///
/// The `BTreeMap`s are load-bearing, not incidental: their ordering is what makes
/// two imports of one file produce identical documents, ids included.
fn lane_arrows(junctions: &[NetworkJunction], links: &[NetworkLink]) -> Vec<Marking> {
    let lane_counts: BTreeMap<&LinkId, usize> =
        links.iter().map(|l| (&l.id, l.lanes.len())).collect();

    // approach link → Zukai lane → the turns painted on it.
    let mut by_lane: BTreeMap<&LinkId, BTreeMap<LaneIdx, Vec<TurnDirection>>> = BTreeMap::new();
    for movement in junctions.iter().flat_map(|j| &j.movements) {
        // A movement's `from_link` *is* the road arriving, so restricting this to
        // approaches costs nothing — there is no exit link to filter out.
        let Some(&count) = lane_counts.get(&movement.from_link) else {
            continue;
        };
        let direction = turn_direction(movement.kind);
        for &file_index in &movement.from_lanes {
            // An index the link does not have is a file Zukai cannot draw from;
            // it is skipped rather than clamped onto a lane it never named.
            let Some(lane) = usize::try_from(file_index)
                .ok()
                .and_then(|index| kerb_lane(count, index))
            else {
                continue;
            };
            let turns = by_lane
                .entry(&movement.from_link)
                .or_default()
                .entry(lane)
                .or_default();
            if !turns.contains(&direction) {
                turns.push(direction);
            }
        }
    }

    let mut markings = Vec::new();
    for (link, lanes) in by_lane {
        for (lane, turns) in lanes {
            let directions: Vec<TurnDirection> = CANONICAL_TURN_DIRECTIONS
                .into_iter()
                .filter(|d| turns.contains(d))
                .collect();
            markings.push(Marking {
                // The frontend's own scheme (`nextId(…, "M")`), so the first
                // marking a human places after an import lands one past the last
                // minted here rather than colliding with it.
                id: format!("M{}", markings.len() + 1).into(),
                link: link.clone(),
                position: ARROW_SETBACK_METRES,
                // The whole reason the anchor exists: an imported arm is over a
                // thousand units long and is about to be dragged into shape, and
                // the paint has to stay by the junction while it is.
                anchor: LinkEnd::End,
                lane: Some(lane),
                kind: MarkingKind::TurnArrow {
                    directions,
                    // Never a rear head: a lane in `network.yaml` is
                    // one-directional by construction, so nothing in the file
                    // can supply one (markings §2.11).
                    back: Vec::new(),
                },
            });
        }
    }
    markings
}

/// How far from the junction a minted arrow sits, in **metres**.
///
/// Links are not to scale, so no real distance is meaningful here: the offset is
/// derived from the arrow's own drawn size, and it sits **one arrow-length clear
/// of the junction** so that the paint and the gap ahead of it read as one unit
/// whatever the road is.
///
/// The `1.5` is a conversion rather than a taste: the canvas centres an arrow's
/// shaft on its `position`, so a marking at distance `d` puts the arrow's near
/// end at `d - L/2`, and a full arrow-length of clear road needs `L + L/2`. The
/// division is the second conversion — [`TURN_ARROW_LENGTH`] is world units and
/// [`Marking::position`] is metres.
const ARROW_SETBACK_METRES: f64 = 1.5 * TURN_ARROW_LENGTH / UNITS_PER_METRE;

/// What a turn is called in paint.
///
/// Two vocabularies separated by one hyphen: [`MovementKind`] is Assimilator's
/// wire spelling (`u-turn`) and [`TurnDirection`] is the painted arrow's
/// (`u_turn`). Four kinds map onto four of the six directions; the two slight
/// turns have no movement kind to come from and are hand-painted only.
///
/// **This is the whole of the crossing between them**, and since Phase 4 it is
/// also the boundary between the file's model and Zukai's: `MovementKind` does
/// not exist past this function.
fn turn_direction(kind: MovementKind) -> TurnDirection {
    match kind {
        MovementKind::Through => TurnDirection::Through,
        MovementKind::Left => TurnDirection::Left,
        MovementKind::Right => TurnDirection::Right,
        MovementKind::UTurn => TurnDirection::UTurn,
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::model::graph::{JunctionControl, UnsignalizedRule};
    use crate::model::ids::NodeId;
    use crate::model::layout::JunctionGlyph;
    use crate::network::{parse_network, CROSS_4, LAYOUT_EXTENT, T_JUNCTION, UNITS_PER_METRE};

    /// The two frontend files this module hand-mirrors a constant out of. Read at
    /// compile time so a drift on the TypeScript side fails a test here rather
    /// than showing up as arrows in the wrong place.
    const GEOMETRY_TS: &str = include_str!("../../../src/editor/geometry.ts");
    const INSPECTOR_TSX: &str = include_str!("../../../src/components/Inspector.tsx");

    fn import(text: &str) -> Document {
        network_to_document(parse_network(text).expect("parse")).expect("import")
    }

    /// The turns painted on one lane of one link, or a panic naming what is
    /// actually there — an arrow on the *wrong* lane is the failure §2.5.1 exists
    /// to catch, so the message has to show the whole set.
    fn painted(doc: &Document, link: &str, lane: LaneIdx) -> Vec<TurnDirection> {
        let marking = doc
            .markings
            .iter()
            .find(|m| m.link.as_str() == link && m.lane == Some(lane))
            .unwrap_or_else(|| panic!("no arrow on {link} lane {lane}; have {:?}", doc.markings));
        match &marking.kind {
            MarkingKind::TurnArrow { directions, .. } => directions.clone(),
            other => panic!("{link} lane {lane} is painted {other:?}, not an arrow"),
        }
    }

    /// How far apart two nodes are drawn, in canvas units — the drawing's own
    /// number, never the road's.
    fn apart(doc: &Document, from: &str, to: &str) -> f64 {
        let from = doc.layout.nodes[&NodeId::from(from)].pos;
        let to = doc.layout.nodes[&NodeId::from(to)].pos;
        (to.x - from.x).hypot(to.y - from.y)
    }

    /// The text between `open` and the first `close` after it.
    fn between<'a>(text: &'a str, open: &str, close: &str) -> &'a str {
        let start = text.find(open).unwrap_or_else(|| panic!("no `{open}`")) + open.len();
        let rest = &text[start..];
        let end = rest
            .find(close)
            .unwrap_or_else(|| panic!("no `{close}` after `{open}`"));
        &rest[..end]
    }

    /// How a [`TurnDirection`] is spelled on the wire — which is also how the
    /// TypeScript spells it, both sides being snake_case of one vocabulary.
    fn spelled(direction: TurnDirection) -> String {
        serde_yaml::to_string(&direction)
            .expect("serialize")
            .trim()
            .to_string()
    }

    /// Ids are preserved verbatim, which is not decoration: the export
    /// direction, and the scenario-directory swap that proves it works, both
    /// depend on a re-exported network still answering to the demand file
    /// sitting beside it.
    #[test]
    fn t_junction_imports_with_its_ids_intact() {
        let doc = import(T_JUNCTION);

        assert_eq!(doc.nodes.len(), 4);
        assert_eq!(doc.links.len(), 3);
        assert_eq!(doc.junctions.len(), 1);

        let ids: Vec<_> = doc.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, ["W", "J", "E", "S"]);
        let ids: Vec<_> = doc.links.iter().map(|l| l.id.as_str()).collect();
        assert_eq!(ids, ["L_W_J", "L_J_E", "L_S_J"]);
        assert_eq!(doc.junctions[0].node_id.as_str(), "J");

        assert_eq!(doc.metadata.name, "Editor Network");
        assert_eq!(doc.junctions[0].control, JunctionControl::Unsignalized);
        assert_eq!(doc.junctions[0].rule, Some(UnsignalizedRule::Priority));
        assert_eq!(doc.links[0].lanes.len(), 1);
        assert_eq!(doc.links[0].lanes[0].width, 3.5);
    }

    /// The geometry-free claim, asserted rather than assumed: the fixture is
    /// full of coordinates and the imported semantic graph carries none of them.
    #[test]
    fn the_semantic_graph_carries_no_coordinates() {
        assert!(T_JUNCTION.contains("geometry:"));
        assert!(T_JUNCTION.contains("point:"));

        let doc = import(T_JUNCTION);
        let nodes = serde_yaml::to_string(&doc.nodes).expect("serialize");
        let links = serde_yaml::to_string(&doc.links).expect("serialize");

        // The needles are the *key* forms, trailing colon included: a bare
        // "point" matches the word `endpoint` in every node's `type:`.
        for yaml in [&nodes, &links] {
            assert!(!yaml.contains("point:"), "coordinates leaked: {yaml}");
            assert!(!yaml.contains("geometry:"), "geometry leaked: {yaml}");
        }
        // The positions are not gone, they moved.
        assert_eq!(doc.layout.nodes.len(), 4);
    }

    /// The fixture puts node `S` at `[500, -300]` — 500 m east, 300 m
    /// **south**. South is `+y` on the canvas, so the y flips sign on the way
    /// in. A test phrased as "one is negative and one is positive" would pass
    /// just as happily against a network mirrored end to end.
    ///
    /// The two numbers are the fitted ones: `t_junction` spans 1000 m, so it is
    /// laid out at 0.5 units per metre. The **shape** assertions below are what
    /// survived that change untouched, and they are the ones that catch a factor
    /// which also mirrors or rotates.
    #[test]
    fn the_southern_node_seeds_a_positive_canvas_y() {
        let doc = import(T_JUNCTION);

        let south = doc.layout.nodes[&NodeId::from("S")].pos;
        assert_eq!(south.x, 250.0);
        assert_eq!(south.y, 150.0);

        // The west end is the origin, and the east end is further east than the
        // junction — so the T is the right way round as well as the right way up.
        let west = doc.layout.nodes[&NodeId::from("W")].pos;
        let junction = doc.layout.nodes[&NodeId::from("J")].pos;
        let east = doc.layout.nodes[&NodeId::from("E")].pos;
        assert_eq!(west.x, 0.0);
        assert!(west.x < junction.x && junction.x < east.x);
        assert!(south.y > junction.y, "the stem hangs below the crossbar");
    }

    /// **The whole claim of the layout factor, and it needs both fixtures.**
    /// `t_junction`'s arm is 500 real metres and `cross-4`'s is 100, and each is
    /// drawn 250 canvas units long — 27.8 lane-widths against a 9-unit lane.
    ///
    /// One fixture cannot catch a factor applied to the wrong quantity: any
    /// single network can be made to land on any figure. **Two networks at
    /// different real extents landing on one drawn extent** is the discriminator,
    /// and it is what separates fitting the drawing from rescaling the world.
    #[test]
    fn both_fixtures_draw_their_arms_at_one_length() {
        let t = import(T_JUNCTION);
        assert_eq!(t.links[0].length, Some(500.0), "500 real metres");
        assert_eq!(apart(&t, "W", "J"), 250.0);

        let c = import(CROSS_4);
        assert_eq!(c.links[0].length, Some(100.0), "100 real metres");
        assert_eq!(apart(&c, "N1", "N5"), 250.0);
    }

    /// The clamp never enlarges, so the fixture that already read well is left
    /// almost exactly as it was: `cross-4`'s 200 m span goes from 514.29 units
    /// to 500, a move of 2.8%.
    ///
    /// This one stays green if the clamp is dropped altogether — 2.5 is below
    /// `UNITS_PER_METRE` either way — which is why
    /// `a_network_smaller_than_the_frame_keeps_true_scale` is also needed.
    #[test]
    fn the_fixture_that_already_fitted_barely_moves() {
        let doc = import(CROSS_4);

        let span = apart(&doc, "N1", "N2");
        assert_eq!(span, 500.0);

        let before = 200.0 * UNITS_PER_METRE;
        assert!((before - 514.28).abs() < 0.01, "{before}");
        assert!(
            (1.0 - span / before) < 0.03,
            "moved by more than 3%: {span}"
        );
    }

    /// **The clamp, and the test that fails if `min` becomes `max`.** A network
    /// smaller than the frame keeps true scale rather than being inflated to fill
    /// it: 50 m of road is 128.6 units, not 500.
    ///
    /// Without the clamp a 50 m slip road would arrive 56 lane-widths long — the
    /// same illegibility the factor exists to remove, reached from the other side.
    #[test]
    fn a_network_smaller_than_the_frame_keeps_true_scale() {
        let yaml = concat!(
            "metadata:\n  name: Slip road\n",
            "nodes:\n  - id: A\n    point: [0, 0]\n    type: endpoint\n",
            "  - id: B\n    point: [50, 0]\n    type: endpoint\n",
            "links:\n  - id: L1\n    from_node: A\n    to_node: B\n",
            "    geometry: [[0, 0], [50, 0]]\n",
            "    lanes: [{id: 0, width: 3.5, speed_limit: 13.9}]\n",
        );

        let drawn = apart(&import(yaml), "A", "B");

        // The expression rather than a rounded literal, so a changed lane width
        // reads as a changed scale rather than as a failed test.
        assert_eq!(drawn, 50.0 * UNITS_PER_METRE);
        assert_ne!(drawn, LAYOUT_EXTENT, "import must not enlarge");
    }

    /// Layout is seeded with defaults, not inferred. Deriving a road class from
    /// a speed limit, or a glyph from a control type, is a guess dressed as a
    /// fact — and the human is about to redraw all of it anyway.
    #[test]
    fn layout_is_seeded_with_defaults_rather_than_derived() {
        let doc = import(T_JUNCTION);

        assert_eq!(doc.layout.links.len(), 3);
        for view in doc.layout.links.values() {
            assert_eq!(view.style, LinkStyle::Arterial);
            assert_eq!(view.align, LinkAlign::Centre);
            assert!(view.bends.is_empty());
        }

        // One junction-kind node, one glyph, and it is the generic one even
        // though the file says `rule: priority` and a `priority_cross` glyph
        // exists.
        assert_eq!(doc.layout.junctions.len(), 1);
        let view = doc.layout.junctions[&NodeId::from("J")];
        assert_eq!(view.glyph, JunctionGlyph::Generic);
        assert_eq!(view.scale, 1.0);
    }

    /// `cross-4` is `control: signal` **with** a 60 s plan in the file, and the
    /// import keeps the control and drops the plan. A fixed-time plan is a table
    /// of stage timings; nothing draws one, and Zukai does not write this format
    /// back out, so carrying it would be carrying data for no reader.
    ///
    /// The **whole-junction** comparison is the assertion, and it is what makes
    /// this the test that catches a field creeping back into the model: the
    /// file's sixteen movements and its plan both have to leave no trace, not
    /// merely arrive with the count the reader expected.
    #[test]
    fn cross_4_keeps_its_control_and_drops_everything_else() {
        let doc = import(CROSS_4);

        assert_eq!(
            doc.junctions,
            vec![Junction {
                node_id: "N5".into(),
                control: JunctionControl::Signal,
                rule: None,
            }]
        );
        assert!(
            CROSS_4.contains("signal_plan:"),
            "the fixture must still have one"
        );
        assert!(
            CROSS_4.contains("movements:"),
            "the fixture must still have them - they are what the arrows come from"
        );
    }

    /// **The one test that fails under an identity lane map**, which is the whole
    /// of §2.5.1: the two projects number lanes in opposite directions, and
    /// getting it backwards mirror-images every approach while looking entirely
    /// plausible on a fixture whose lanes are all 3.5 m wide.
    ///
    /// The fixture's approach `L1` has two lanes and the file numbers them from
    /// the **median**: its lane 0 goes through or turns left (`M_L1_L3`,
    /// `M_L1_L7`), its lane 1 goes through or turns right (`M_L1_L3`, `M_L1_L6`).
    /// Zukai numbers from the **kerb**, so those land the other way up — and a
    /// left-turn arrow drawn on the kerb lane is the failure this catches.
    #[test]
    fn cross_4_paints_each_approach_lane_in_zukai_s_numbering() {
        let doc = import(CROSS_4);

        // The file's lane 0 is the median, which is Zukai's *highest* index.
        assert_eq!(
            painted(&doc, "L1", 1),
            [TurnDirection::Left, TurnDirection::Through]
        );
        assert_eq!(
            painted(&doc, "L1", 0),
            [TurnDirection::Through, TurnDirection::Right]
        );

        // The northbound approach says the same thing from the other side, so a
        // sign error in the flip cannot hide behind one arm's symmetry.
        assert_eq!(
            painted(&doc, "L5", 1),
            [TurnDirection::Left, TurnDirection::Through]
        );
        assert_eq!(
            painted(&doc, "L5", 0),
            [TurnDirection::Through, TurnDirection::Right]
        );

        // Four approaches, two lanes each, and nothing on the four exit links —
        // a movement's `from_link` is by definition the road arriving.
        assert_eq!(doc.markings.len(), 8);
        let approaches: Vec<&str> = doc.markings.iter().map(|m| m.link.as_str()).collect();
        assert_eq!(approaches, ["L1", "L1", "L4", "L4", "L5", "L5", "L8", "L8"]);
    }

    /// A single-lane approach flips to itself, and the *turn* still has to be the
    /// file's: `M_minor_left` is `type: right`, so the stem is painted with a
    /// right arrow whatever its id says.
    #[test]
    fn t_junction_paints_one_arrow_per_approach() {
        let doc = import(T_JUNCTION);

        assert_eq!(painted(&doc, "L_W_J", 0), [TurnDirection::Through]);
        assert_eq!(painted(&doc, "L_S_J", 0), [TurnDirection::Right]);
        assert_eq!(doc.markings.len(), 2);
    }

    /// Where the paint sits, and why it is not a distance anybody chose. Links
    /// are not to scale, so the offset is one arrow-length of clear road ahead of
    /// the junction — `1.5 × 15` units, converted to metres because
    /// `Marking.position` is metres.
    ///
    /// The anchor is the load-bearing half: an imported arm is over a thousand
    /// units long and is about to be dragged into shape.
    #[test]
    fn an_arrow_sits_one_arrow_length_clear_of_the_junction() {
        let doc = import(CROSS_4);

        for marking in &doc.markings {
            assert_eq!(marking.anchor, LinkEnd::End);
            assert_eq!(marking.position, 1.5 * 15.0 / UNITS_PER_METRE);
        }
        // Spelled out once, so a changed constant reads as a changed distance
        // rather than as two expressions agreeing with each other.
        assert_eq!(doc.markings[0].position, 8.75);
    }

    /// A u-turn contributes nothing, and it needs no special case to: `cross-4`'s
    /// four carry `from_lanes: []`, so no lane ever claims them.
    ///
    /// The precondition is read off the **parsed file** rather than off the
    /// document, because the document no longer records a junction's turns at
    /// all — which is precisely why "the fixture must still have them" needs
    /// saying out loud here.
    #[test]
    fn the_u_turns_paint_nothing() {
        let doc = import(CROSS_4);

        assert_eq!(
            parse_network(CROSS_4)
                .expect("parse")
                .junctions
                .iter()
                .flat_map(|j| &j.movements)
                .filter(|m| m.kind == MovementKind::UTurn)
                .count(),
            4,
            "the fixture must still have them"
        );
        for marking in &doc.markings {
            let MarkingKind::TurnArrow { directions, .. } = &marking.kind else {
                panic!("import paints only arrows");
            };
            assert!(
                !directions.contains(&TurnDirection::UTurn),
                "a u-turn with no lanes claimed one: {marking:?}"
            );
        }
    }

    /// The other half of "absent takes the same path as empty": a movement with
    /// **no `from_lanes` key at all** is legal here
    /// (`the_lane_and_priority_keys_are_ignored_either_way`) and paints nothing.
    /// Neither fixture catches it — both write the key on every movement.
    #[test]
    fn a_movement_with_no_from_lanes_key_paints_nothing() {
        let yaml = concat!(
            "metadata:\n  name: Bare\n",
            "nodes:\n  - id: A\n    point: [0, 0]\n    type: endpoint\n",
            "  - id: J\n    point: [100, 0]\n    type: junction\n",
            "  - id: B\n    point: [200, 0]\n    type: endpoint\n",
            "links:\n",
            "  - id: L1\n    from_node: A\n    to_node: J\n",
            "    geometry: [[0, 0], [100, 0]]\n",
            "    lanes: [{id: 0, width: 3.5, speed_limit: 13.9}]\n",
            "  - id: L2\n    from_node: J\n    to_node: B\n",
            "    geometry: [[100, 0], [200, 0]]\n",
            "    lanes: [{id: 0, width: 3.5, speed_limit: 13.9}]\n",
            "junctions:\n  - node_id: J\n    control: unsignalized\n",
            "    movements:\n      - id: M1\n        from_link: L1\n        to_link: L2\n",
            "        type: through\n",
        );
        assert!(!yaml.contains("from_lanes"));

        let doc = import(yaml);

        // The movement parsed — it is the junction being imported at all that
        // says so, since nothing in the document records one — and painted
        // nothing.
        assert_eq!(doc.junctions.len(), 1);
        assert!(doc.markings.is_empty(), "{:?}", doc.markings);
    }

    /// §2.5.1's other half, and the bug `import_link` carried before this phase:
    /// the **lane array** runs the other way too, so the file's outside lane is
    /// Zukai's lane 0.
    ///
    /// It needs distinct widths to be visible at all — `t_junction`'s links are
    /// single-lane and `cross-4`'s lanes are uniform, so no committed fixture can
    /// catch this and no existing test noticed the reversal landing.
    ///
    /// The second assertion is the failure hiding inside the fix for the first:
    /// `Lane.id` is documented as the index and every reader is positional, so a
    /// reversal that copied the file's ids through would leave `lanes[0].id == 1`
    /// while every positional reader carried on working.
    #[test]
    fn import_link_renumbers_the_lanes_from_the_kerb() {
        let yaml = concat!(
            "metadata:\n  name: Widths\n",
            "nodes:\n  - id: A\n    point: [0, 0]\n    type: endpoint\n",
            "  - id: B\n    point: [100, 0]\n    type: endpoint\n",
            "links:\n  - id: L1\n    from_node: A\n    to_node: B\n",
            "    geometry: [[0, 0], [100, 0]]\n",
            "    lanes:\n",
            // The file counts from the median, so this first lane is the fast one.
            "      - {id: 0, width: 3.0, speed_limit: 30.0}\n",
            "      - {id: 1, width: 3.5, speed_limit: 20.0}\n",
            "      - {id: 2, width: 2.5, speed_limit: 10.0}\n",
        );

        let lanes = &import(yaml).links[0].lanes;

        let widths: Vec<f64> = lanes.iter().map(|l| l.width).collect();
        assert_eq!(widths, [2.5, 3.5, 3.0], "the kerb lane comes back first");
        let speeds: Vec<f64> = lanes.iter().map(|l| l.speed_limit).collect();
        assert_eq!(
            speeds,
            [10.0, 20.0, 30.0],
            "the whole lane moved, not a field"
        );
        let ids: Vec<LaneIdx> = lanes.iter().map(|l| l.id).collect();
        assert_eq!(ids, [0, 1, 2], "ids are the new positions, not the file's");
    }

    /// The lengths the fixtures' own polylines trace, hand-summed off the files:
    /// `t_junction`'s crossbar is two 500 m arms with a 300 m stem, and every one
    /// of `cross-4`'s eight links is 100 m.
    ///
    /// Every value is exact in f64 — both fixtures are axis-aligned — so the slack
    /// is there for a future fixture that is not, rather than for these.
    #[test]
    fn both_fixtures_state_the_length_their_geometry_traces() {
        let t = import(T_JUNCTION);

        let lengths: Vec<Option<f64>> = t.links.iter().map(|l| l.length).collect();
        assert_eq!(lengths, [Some(500.0), Some(500.0), Some(300.0)]);

        let c = import(CROSS_4);

        assert_eq!(c.links.len(), 8);
        for link in &c.links {
            let length = link
                .length
                .unwrap_or_else(|| panic!("{} states none", link.id));
            assert!((length - 100.0).abs() < 1e-9, "{} is {length} m", link.id);
        }
    }

    /// **The one test that fails against an endpoint chord**, and no committed
    /// fixture can stand in for it: every fixture polyline is exactly two points,
    /// so a wrong implementation measuring first-to-last passes on all committed
    /// data while mis-stating every bent road in a real network.
    ///
    /// The bend is a right angle, so the two readings are 700 m summed against a
    /// 500 m chord — far enough apart that no slack can hide the difference, and
    /// both exact.
    #[test]
    fn a_bent_polyline_sums_its_segments_rather_than_its_ends() {
        let yaml = concat!(
            "metadata:\n  name: Bent\n",
            "nodes:\n  - id: A\n    point: [0, 0]\n    type: endpoint\n",
            "  - id: B\n    point: [400, 300]\n    type: endpoint\n",
            "links:\n  - id: L1\n    from_node: A\n    to_node: B\n",
            "    geometry: [[0, 0], [0, 300], [400, 300]]\n",
            "    lanes: [{id: 0, width: 3.5, speed_limit: 13.9}]\n",
        );

        let length = import(yaml).links[0].length.expect("a length");

        assert_eq!(length, 700.0, "the segments, not the ends");
        // Named rather than left implicit, so a regression reads as the wrong
        // *measurement* rather than as the wrong number.
        let chord = 400.0_f64.hypot(300.0);
        assert_eq!(chord, 500.0);
        assert_ne!(length, chord);
    }

    /// A polyline with nothing to measure states **no length**, not a length of
    /// zero — `graph.rs` is explicit that absent means the road says nothing.
    ///
    /// All three cases reach `import_link` today: "at least 2 points" is a doc
    /// comment on the mirror, not a parse invariant, so a file carrying an empty
    /// or one-point polyline parses and must not panic.
    #[test]
    fn a_polyline_with_nothing_to_measure_states_no_length() {
        let yaml = concat!(
            "metadata:\n  name: Degenerate\n",
            "nodes:\n  - id: A\n    point: [0, 0]\n    type: endpoint\n",
            "links:\n",
            "  - id: L_empty\n    from_node: A\n    to_node: A\n",
            "    geometry: []\n",
            "    lanes: [{id: 0, width: 3.5, speed_limit: 13.9}]\n",
            "  - id: L_one\n    from_node: A\n    to_node: A\n",
            "    geometry: [[0, 0]]\n",
            "    lanes: [{id: 0, width: 3.5, speed_limit: 13.9}]\n",
            "  - id: L_still\n    from_node: A\n    to_node: A\n",
            "    geometry: [[7, 7], [7, 7]]\n",
            "    lanes: [{id: 0, width: 3.5, speed_limit: 13.9}]\n",
        );

        let doc = import(yaml);

        for link in &doc.links {
            assert_eq!(link.length, None, "{} states a length", link.id);
        }
        // ...and the key is elided, so such a document is byte-identical to one
        // written before the field existed.
        let yaml = serde_yaml::to_string(&doc.links).expect("serialize");
        assert!(!yaml.contains("length"), "{yaml}");
    }

    /// **The decoupling, from one import.** `L_W_J` states 500 metres while the
    /// canvas holds its two ends 250 units apart — two independent records of
    /// one road, which is the whole of `CLAUDE.md`'s founding idea and the answer
    /// this spec gives `network_yaml_spec.md` OQ-2.
    ///
    /// A test asserting only the metres would pass just as happily against an
    /// import that had scaled the canvas to match them.
    ///
    /// **The layout factor is what makes the decoupling structural.** Before it
    /// the two numbers differed by one global constant, which a reader could
    /// recover from either; they now differ by a factor fitted to this file and
    /// stored nowhere, so the drawing cannot be read back as a measurement even
    /// in principle.
    #[test]
    fn the_label_states_metres_while_the_canvas_holds_units() {
        let doc = import(T_JUNCTION);

        let link = &doc.links[0];
        assert_eq!(link.id.as_str(), "L_W_J");
        assert_eq!(link.length, Some(500.0), "metres, the road's own claim");

        let west = doc.layout.nodes[&NodeId::from("W")].pos;
        let junction = doc.layout.nodes[&NodeId::from("J")].pos;
        let drawn = (junction.x - west.x).hypot(junction.y - west.y);
        assert_eq!(drawn, 250.0, "units, the diagram's");
        assert_ne!(drawn, 500.0 * UNITS_PER_METRE, "and not the metres, scaled");
    }

    /// Two imports of one file produce the same document, ids included — which is
    /// what the `BTreeMap`s and the canonical direction order are for, and what a
    /// `HashMap` would quietly cost.
    #[test]
    fn two_imports_of_one_file_paint_identically() {
        assert_eq!(import(CROSS_4).markings, import(CROSS_4).markings);
    }

    /// The first of two hand-mirrors, pinned against the file it was copied from.
    /// Nothing derives this number: `TURN_ARROW_LENGTH` is a rendering constant
    /// that never crosses IPC, so the only thing keeping the two equal is a test.
    #[test]
    fn the_arrow_length_is_the_one_the_canvas_draws() {
        let ts = between(GEOMETRY_TS, "export const TURN_ARROW_LENGTH =", ";")
            .trim()
            .parse::<f64>()
            .expect("a numeric literal");

        assert_eq!(TURN_ARROW_LENGTH, ts);
    }

    /// The second: the panel rebuilds a turn arrow's directions in **road order**,
    /// and import has to mint them in the same one or a hand-edited arrow would
    /// reorder itself the first time it was touched.
    #[test]
    fn the_direction_order_is_the_one_the_panel_rebuilds() {
        let block = between(INSPECTOR_TSX, "const TURN_DIRECTIONS", "];");
        let ts: Vec<&str> = block
            .match_indices("value: \"")
            .map(|(at, pat)| {
                let rest = &block[at + pat.len()..];
                &rest[..rest.find('"').expect("a closing quote")]
            })
            .collect();
        assert_eq!(ts.len(), 6, "parsed the wrong block: {ts:?}");

        let rust: Vec<String> = CANONICAL_TURN_DIRECTIONS.into_iter().map(spelled).collect();

        assert_eq!(rust, ts);
    }

    #[test]
    fn a_geographic_coordinate_system_is_rejected() {
        let yaml =
            "metadata:\n  name: Elsewhere\n  coordinate_system: geographic\nnodes: []\nlinks: []\n";

        let err = network_to_document(parse_network(yaml).expect("parse"))
            .expect_err("a non-metric network must be refused");

        assert!(err.contains("geographic"), "{err}");
        assert!(err.contains("metric"), "{err}");
    }

    /// The other half, and the one a naive "reject anything that is not metric"
    /// gets wrong: the key is `#[serde(default)]`, so an absent one already
    /// *means* metric.
    #[test]
    fn a_file_with_no_coordinate_system_at_all_is_accepted() {
        let yaml = "metadata:\n  name: Bare\nnodes: []\nlinks: []\n";
        assert!(!yaml.contains("coordinate_system"));

        let doc = import(yaml);

        assert_eq!(doc.metadata.name, "Bare");
        assert!(doc.nodes.is_empty());
    }

    /// The blocks Zukai has no idea about pass straight through the reader.
    /// Nothing derives `deny_unknown_fields`, which is what makes a
    /// `detectors:` section a drop rather than a parse error.
    #[test]
    fn the_dropped_blocks_do_not_stop_the_file_parsing() {
        assert!(T_JUNCTION.contains("detectors:"));
        assert!(T_JUNCTION.contains("conflict_pairs:"));
        assert!(T_JUNCTION.contains("gap_acceptance:"));

        let doc = import(T_JUNCTION);

        // ...and leave no trace in the document.
        let yaml = serde_yaml::to_string(&doc).expect("serialize");
        assert!(!yaml.contains("detector"), "{yaml}");
        assert!(!yaml.contains("conflict_pairs"), "{yaml}");
        assert!(!yaml.contains("gap_acceptance"), "{yaml}");
    }

    /// An imported document is an ordinary Zukai document: it saves and reloads
    /// through the `.zkai` path with the carried fields intact.
    #[test]
    fn an_imported_document_round_trips_as_zkai() {
        let doc = import(T_JUNCTION);

        let yaml = serde_yaml::to_string(&doc).expect("serialize");
        let back: Document = serde_yaml::from_str(&yaml).expect("deserialize");

        assert_eq!(doc, back);
        assert_eq!(back.schema_version, crate::model::SCHEMA_VERSION);
    }

    /// The **whole** converted document, pinned against a committed file — where
    /// every test above pins one property of it.
    ///
    /// It exists for a reader this crate does not contain:
    /// `src/editor/network-wasm.test.ts` feeds the same fixture to the
    /// `#[wasm_bindgen]` shell and asserts the result deep-equals this same JSON.
    /// Two readers, one file, so the golden cannot rot without this test going
    /// red. What the pair catches is **marshalling** drift, not converter drift —
    /// both paths call [`network_to_document`], so a converter change moves them
    /// together. Marshalling is the real hazard: `serde_wasm_bindgen`'s default
    /// serializer emits an ES `Map` for a `BTreeMap`, which `normalizeDocument`
    /// would index as an object and find empty — a blank canvas that throws
    /// nothing.
    ///
    /// **Asserts by default; rewrites only under `ZUKAI_UPDATE_GOLDEN`.** A test
    /// that regenerates its own fixture on every run always matches itself and
    /// so asserts nothing.
    #[test]
    fn cross_4_matches_the_committed_golden_document() {
        const GOLDEN: &str = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/golden/cross-4.document.json"
        );

        let json = serde_json::to_string_pretty(&import(CROSS_4)).expect("serialize") + "\n";
        if std::env::var_os("ZUKAI_UPDATE_GOLDEN").is_some() {
            fs::write(GOLDEN, &json).expect("rewrite the golden");
        }

        let committed = fs::read_to_string(GOLDEN)
            .expect("golden missing — regenerate with `ZUKAI_UPDATE_GOLDEN=1 cargo test`");
        assert_eq!(
            json, committed,
            "the imported document has changed; if that is intended, regenerate \
             with `ZUKAI_UPDATE_GOLDEN=1 cargo test` and read the diff"
        );
    }

    /// The command is a *shell*, not a second implementation: read the file and
    /// hand it to the same two functions the tests above call directly.
    #[test]
    fn the_command_reads_a_file_into_the_same_document() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("network.yaml");
        fs::write(&path, T_JUNCTION).expect("write");

        let doc = import_network(path.to_str().expect("utf-8 path").to_string()).expect("import");

        assert_eq!(doc, import(T_JUNCTION));
    }

    #[test]
    fn a_missing_file_is_an_error_rather_than_a_panic() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("nowhere.yaml");

        import_network(path.to_str().expect("utf-8 path").to_string())
            .expect_err("a missing file must be reported");
    }

    /// Pointing Import at a `.zkai` is the obvious user error, and the dialog's
    /// extension filter is what prevents it (spec §2.5). This pins the fallback:
    /// it **fails** rather than importing something half-formed. The message it
    /// happens to get is the version probe's — `.zkai` is at schema 2 and
    /// Assimilator's format is at 1 — which is odd phrasing for the case but not
    /// worth a content sniffer to improve.
    #[test]
    fn a_zkai_document_is_not_a_network() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("schematic.zkai");
        let zkai = serde_yaml::to_string(&Document::new("A schematic")).expect("serialize");
        fs::write(&path, zkai).expect("write");

        import_network(path.to_str().expect("utf-8 path").to_string())
            .expect_err("a .zkai is not a network.yaml");
    }
}
