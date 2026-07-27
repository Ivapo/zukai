//! [`Document`] → `network.yaml`: the hard direction.
//!
//! Import throws information away; export has to **invent** it. A schematic has
//! no metric geometry by design, and `LinkConfig.geometry` and `NodeConfig.point`
//! are both required, so this module synthesizes them — and every key Assimilator
//! declares without a `serde(default)` has to be here or the file will not open.
//!
//! That asymmetry is the reason this direction gets the longer gate. A `.zkai`
//! that fails to save is loud. A `network.yaml` Zukai writes happily and
//! Assimilator refuses is silent until someone tries to run it.
//!
//! # The polyline is built from the nodes, never from the drawing
//!
//! The one trap worth stating before the code. `src/editor/geometry.ts`'s
//! `drawnPolyline` is the layout polyline stepped sideways by two lateral terms —
//! the carriageway offset of a divided road, and the shift that holds an aligned
//! link's own edge on its polyline. **Assimilator applies both of those itself**,
//! from `median_gap` and `lateral_offset`. So exporting the drawn polyline would
//! double-offset every two-way road in the document.
//!
//! What is exported instead is the frontend's `linkPolyline` — node position,
//! bends, node position — with the two offsets handed over as *values*. A useful
//! side effect: the polyline's ends land exactly on its nodes, which is
//! Assimilator's validation rule 5 (within 1 m) satisfied by construction rather
//! than by care.
//!
//! # Where the required-key discipline actually lives
//!
//! Almost nowhere, and that is the design. [`NetworkMovement::from_lanes`] and
//! friends are declared **bare** in the mirror, so serializing through it emits
//! `from_lanes: []` where [`Movement`]'s own `skip_serializing_if` would have
//! omitted the key — and an omitted key is a parse error for the whole file.
//! Phase 1 wrote the mirror faithfully so that this phase would get the rule for
//! free; the only place the writer *decides* anything is [`movement_lanes`].
//!
//! See `specs/network_yaml_spec.md` §2.3 (the lane rule), §2.4 (the synthesis)
//! and `rules/network-yaml.md`.

use std::collections::BTreeMap;
use std::fs;

use crate::model::graph::{Lane, Link, Movement, MovementKind, Node};
use crate::model::ids::{LaneIdx, LinkId, NodeId};
use crate::model::layout::LinkAlign;
use crate::model::Document;

use super::{
    canvas_to_metres, NetworkFile, NetworkJunction, NetworkLane, NetworkLink, NetworkMetadata,
    NetworkMovement, NetworkNode, NetworkPhase, NetworkSignalPlan, ASSIMILATOR_SCHEMA_VERSION,
};

/// Write a [`Document`] to `path` as a `network.yaml`.
///
/// [`crate::network::import::import_network`]'s twin, and the same nine-line
/// shell: the conversion above it is pure, so every test reaches it without a
/// filesystem. What the *caller* must not do is treat this as a save — an export
/// is not a document, so `currentPath` and `dirty` are untouched by it. That rule
/// lives in the reducer, as it does for the SVG exporter.
#[tauri::command]
pub fn export_network(path: String, doc: Document) -> Result<(), String> {
    fs::write(&path, document_to_yaml(&doc)?).map_err(|e| e.to_string())
}

/// Serialize a [`Document`] as `network.yaml` text, `schema_version` first.
///
/// The header is a **text stamp, not a struct field**, and both halves of that
/// are deliberate: `NetworkConfig` has no such field because Assimilator reads
/// the key off the parsed value and strips it before typed deserialization
/// (`crates/config/src/version.rs`). Giving [`NetworkFile`] a field to match
/// would break the mirror; omitting the key entirely is legal *today* but becomes
/// a hard error the moment Assimilator's constant reaches 2, which is exactly the
/// silent arrival-already-deprecated failure this direction exists to avoid.
pub fn document_to_yaml(doc: &Document) -> Result<String, String> {
    let body = serde_yaml::to_string(&document_to_network(doc)).map_err(|e| e.to_string())?;
    Ok(format!(
        "schema_version: {ASSIMILATOR_SCHEMA_VERSION}\n{body}"
    ))
}

/// Turn a [`Document`] into the [`NetworkFile`] that describes it.
///
/// Pure, and total: there is no error case. Every difference between the two
/// models is a synthesis or a drop, and a document too broken to export — a link
/// naming a node that does not exist — is one Assimilator's own validator will
/// reject with a better message than anything invented here.
pub fn document_to_network(doc: &Document) -> NetworkFile {
    let links: BTreeMap<&LinkId, &Link> = doc.links.iter().map(|l| (&l.id, l)).collect();

    NetworkFile {
        metadata: NetworkMetadata {
            name: doc.metadata.name.clone(),
            author: doc.metadata.author.clone(),
            // Every conversion here is metres, and Zukai has neither elevation
            // nor a projection. Stated rather than defaulted: a reader of the
            // emitted file should not have to know our defaults to know this.
            coordinate_system: "metric".to_string(),
            z_enabled: false,
            map_origin: None,
        },
        nodes: doc.nodes.iter().map(|n| export_node(doc, n)).collect(),
        links: doc.links.iter().map(|l| export_link(doc, l)).collect(),
        junctions: doc
            .junctions
            .iter()
            .map(|j| NetworkJunction {
                node_id: j.node_id.clone(),
                control: j.control,
                rule: j.rule,
                movements: j
                    .movements
                    .iter()
                    .map(|m| export_movement(m, &links))
                    .collect(),
                signal_plan: j.signal_plan.as_ref().map(|plan| NetworkSignalPlan {
                    cycle_time: plan.cycle_time,
                    offset: plan.offset,
                    phases: plan
                        .phases
                        .iter()
                        .map(|phase| NetworkPhase {
                            id: phase.id.clone(),
                            duration: phase.duration,
                            // The mirror declares this bare, so an empty phase
                            // writes `green_movements: []` rather than nothing —
                            // `from_lanes`' trap, in the one other place it bites.
                            green_movements: phase.green_movements.clone(),
                            permitted_movements: phase.permitted_movements.clone(),
                            amber_time: phase.amber_time,
                            all_red_time: phase.all_red_time,
                        })
                        .collect(),
                }),
            })
            .collect(),
    }
}

fn export_node(doc: &Document, node: &Node) -> NetworkNode {
    NetworkNode {
        id: node.id.clone(),
        point: node_point(doc, &node.id),
        // Zukai has no elevation, so a file that arrived with real z-coordinates
        // leaves flat. Stated in the spec's drop list rather than inferred from
        // `z_enabled: false`.
        z: None,
        kind: node.kind,
    }
}

/// A node's metric position, or the origin.
///
/// A node with no layout entry has no position to export. Placing it at the
/// origin is the lenient answer and the deliberate one: refusing to export the
/// whole document would punish a state a hand-edited `.zkai` can reach, and the
/// import path already guarantees every node it creates is seeded.
fn node_point(doc: &Document, id: &NodeId) -> [f64; 2] {
    doc.layout
        .nodes
        .get(id)
        .map_or([0.0, 0.0], |view| canvas_to_metres(view.pos))
}

fn export_link(doc: &Document, link: &Link) -> NetworkLink {
    let view = doc.layout.links.get(&link.id);

    // `linkPolyline`, not `drawnPolyline` — see this module's docs. The bends go
    // in (spec OQ-1): they are already canvas units and convert by the same rule,
    // and a road that visibly doglegs in Zukai arriving dead straight in
    // Assimilator is the more surprising of the two answers.
    let mut geometry = Vec::with_capacity(2 + view.map_or(0, |v| v.bends.len()));
    geometry.push(node_point(doc, &link.from_node));
    if let Some(view) = view {
        geometry.extend(view.bends.iter().map(|bend| canvas_to_metres(*bend)));
    }
    geometry.push(node_point(doc, &link.to_node));

    NetworkLink {
        id: link.id.clone(),
        from_node: link.from_node.clone(),
        to_node: link.to_node.clone(),
        geometry,
        lateral_offset: lateral_offset(&link.lanes, view.map_or(LinkAlign::Centre, |v| v.align)),
        median_gap: link.median_gap,
        lanes: link
            .lanes
            .iter()
            .map(|lane| NetworkLane {
                id: lane.id,
                width: lane.width,
                speed_limit: lane.speed_limit,
                allowed_classes: lane.allowed_classes.clone(),
                // `Lane::kind` is a rendering hint with no counterpart, and
                // Assimilator's three lane-change flags have none here.
            })
            .collect(),
    }
}

/// [`LinkAlign`] as the metric shift Assimilator will apply.
///
/// The signs already agree, which is the only reason this is a three-line match:
/// a positive `lateral_offset` shifts the road **right of the direction of
/// travel**, and so does a positive lateral shift on the canvas — `geometry.ts`'s
/// `DRIVE_SIDE` spends a paragraph deriving that from SVG's y-down axis. Holding
/// the *offside* edge on the polyline hangs the road to the nearside, i.e.
/// positive; `nearside` is the mirror.
///
/// **It is the lane region in metres, not `alignmentShift`'s canvas value.** That
/// number folds in `ROAD_MARGIN` (a three-unit casing lip) and the class width
/// factor (0.9 for a local road, 0.8 for a ramp), both of which exist to make a
/// drawing legible and mean nothing in metres. Exporting them would dress a
/// rendering artefact as a surveyed offset.
fn lateral_offset(lanes: &[Lane], align: LinkAlign) -> f64 {
    let half = lanes.iter().map(|lane| lane.width).sum::<f64>() / 2.0;
    match align {
        LinkAlign::Centre => 0.0,
        LinkAlign::Offside => half,
        LinkAlign::Nearside => -half,
    }
}

fn export_movement(movement: &Movement, links: &BTreeMap<&LinkId, &Link>) -> NetworkMovement {
    NetworkMovement {
        id: movement.id.clone(),
        from_link: movement.from_link.clone(),
        to_link: movement.to_link.clone(),
        from_lanes: movement_lanes(
            &movement.from_lanes,
            movement.kind,
            &movement.from_link,
            links,
        ),
        to_lanes: movement_lanes(&movement.to_lanes, movement.kind, &movement.to_link, links),
        kind: movement.kind,
        // Carried, never edited — so a junction Zukai *drew* exports with every
        // movement `major`, i.e. a give-way rule with nothing giving way. Nothing
        // in the schematic model says which arm is the major road, and deriving
        // it from road class would be a guess dressed as a fact (spec OQ-8).
        priority: movement.priority,
        yields_to: movement.yields_to.clone(),
        // The one field Assimilator cannot regenerate: it recomputes a positional
        // mapping from the two lane lists, so an identity mapping survives being
        // dropped and a **crossed** one does not.
        lane_mapping: movement.lane_mapping.clone(),
    }
}

/// One of a movement's two lane lists, by spec §2.3's three cases.
///
/// The three, in order, and each list is decided against its own link:
///
/// 1. **Non-empty in the model** — verbatim. What makes an imported file's round
///    trip exact rather than merely valid.
/// 2. **Empty on a `u-turn`** — `[]`, which is what Assimilator's own editor
///    writes for the same case (`cross-4` has four). Filling these would make the
///    round trip rewrite a file it should have reproduced.
/// 3. **Empty on anything else** — every lane index on the link. `[]` here would
///    be a lie: the field is "lane indices that can use this movement", so an
///    empty list on a through movement says *no lane may*. It also defeats
///    Assimilator's positional `lane_mapping` computation, which is the thing
///    that makes carrying no lane detail survivable at all.
///
/// Case 3 counts the link's lanes rather than reading their declared ids, so a
/// hand-edited `id:` cannot produce an index out of range for the link — which is
/// Assimilator's validation rule 3, held by construction. A movement naming a
/// link the document does not contain has no lanes to offer and gets `[]`; the
/// same validator rejects that movement for the missing link, which is the better
/// message.
fn movement_lanes(
    model: &[LaneIdx],
    kind: MovementKind,
    link_id: &LinkId,
    links: &BTreeMap<&LinkId, &Link>,
) -> Vec<LaneIdx> {
    if !model.is_empty() {
        return model.to_vec();
    }
    if kind == MovementKind::UTurn {
        return Vec::new();
    }
    links
        .get(link_id)
        .map_or_else(Vec::new, |link| (0..link.lanes.len() as LaneIdx).collect())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::model::graph::{
        Junction, JunctionControl, LaneMappingEntry, MovementPriority, NodeKind, UnsignalizedRule,
    };
    use crate::model::ids::MovementId;
    use crate::model::layout::{LinkStyle, LinkView, NodeView, Vec2};
    use crate::network::import::network_to_document;
    use crate::network::{metres_to_canvas, parse_network, CROSS_4, T_JUNCTION, UNITS_PER_METRE};

    // --- The round-trip harness -------------------------------------------

    /// Parse, import, export, parse again — the whole loop the gate is built on.
    fn round_trip(text: &str) -> NetworkFile {
        let doc = network_to_document(parse_network(text).expect("parse")).expect("import");
        parse_network(&document_to_yaml(&doc).expect("serialize")).expect("re-parse")
    }

    /// A [`NetworkFile`] reduced to what a round trip is *entitled* to reproduce,
    /// so the comparison can be one whole-struct `assert_eq!` with a real diff.
    ///
    /// Two normalizations, and each is a claim:
    ///
    /// - **`geometry` is blanked.** It is synthesized from the layout, not
    ///   reproduced — the founding claim of the project, and the one field that
    ///   would otherwise have to be excluded by hand from every comparison.
    /// - **Coordinates are rounded to a micrometre.** Metres → canvas → metres is
    ///   a multiply and a divide, each free to round once, so exactness to the
    ///   bit is not owed. A micrometre is a *named* tolerance; `==` on an f64
    ///   that has been through arithmetic is a hope.
    ///
    /// Everything else compares exactly. A field that needs adding here is a
    /// field the round trip has stopped preserving.
    fn comparable(net: &NetworkFile) -> NetworkFile {
        let mut net = net.clone();
        for node in &mut net.nodes {
            node.point = [quantize(node.point[0]), quantize(node.point[1])];
        }
        for link in &mut net.links {
            link.geometry.clear();
        }
        net
    }

    fn quantize(v: f64) -> f64 {
        (v * 1e6).round() / 1e6
    }

    fn movement<'a>(net: &'a NetworkFile, id: &str) -> &'a NetworkMovement {
        net.junctions
            .iter()
            .flat_map(|j| &j.movements)
            .find(|m| m.id.as_str() == id)
            .unwrap_or_else(|| panic!("no movement {id}"))
    }

    // --- Hand-built documents ---------------------------------------------

    fn add_node(doc: &mut Document, id: &str, kind: NodeKind, x: f64, y: f64) {
        doc.nodes.push(Node {
            id: id.into(),
            kind,
        });
        doc.layout.nodes.insert(
            id.into(),
            NodeView {
                pos: Vec2::new(x, y),
            },
        );
    }

    fn add_link(doc: &mut Document, id: &str, from: &str, to: &str, lane_count: u32) {
        doc.links.push(Link {
            id: id.into(),
            from_node: from.into(),
            to_node: to.into(),
            lanes: (0..lane_count)
                .map(|i| Lane {
                    id: i,
                    width: 3.5,
                    speed_limit: 13.5,
                    allowed_classes: Vec::new(),
                    kind: None,
                })
                .collect(),
            median_gap: 0.5,
        });
        doc.layout.links.insert(
            id.into(),
            LinkView {
                style: LinkStyle::default(),
                align: LinkAlign::default(),
                bends: Vec::new(),
            },
        );
    }

    /// A movement shaped the way junction semantics' Derive mints one: **both
    /// lane lists empty**, which is the case §2.3 exists for and the one that
    /// would export with no keys at all if the writer went through [`Movement`]'s
    /// own serde attributes.
    fn derived_movement(id: &str, from: &str, to: &str, kind: MovementKind) -> Movement {
        Movement {
            id: id.into(),
            from_link: from.into(),
            to_link: to.into(),
            from_lanes: Vec::new(),
            to_lanes: Vec::new(),
            kind,
            priority: MovementPriority::default(),
            yields_to: Vec::new(),
            lane_mapping: Vec::new(),
        }
    }

    /// A T drawn by hand rather than imported — no `network.yaml` anywhere in its
    /// history, so nothing it exports was copied from one.
    ///
    /// **The u-turn is load-bearing, not decoration.** It is the only movement
    /// here that stays empty through the writer (§2.3 case 2, against case 3's
    /// filling), so it is the only one whose keys a `skip_serializing_if` could
    /// swallow — and therefore the only one that makes
    /// `an_authored_document_writes_every_required_key` a real check rather than
    /// a test of case 3.
    fn authored() -> Document {
        let mut doc = Document::new("Authored");
        add_node(&mut doc, "A", NodeKind::Endpoint, -100.0, 0.0);
        add_node(&mut doc, "J", NodeKind::Junction, 0.0, 0.0);
        add_node(&mut doc, "B", NodeKind::Endpoint, 100.0, 0.0);
        add_node(&mut doc, "S", NodeKind::Endpoint, 0.0, 100.0);
        add_link(&mut doc, "L_A_J", "A", "J", 2);
        add_link(&mut doc, "L_J_A", "J", "A", 2);
        add_link(&mut doc, "L_J_B", "J", "B", 2);
        add_link(&mut doc, "L_S_J", "S", "J", 1);
        doc.junctions.push(Junction {
            node_id: "J".into(),
            control: JunctionControl::Unsignalized,
            rule: Some(UnsignalizedRule::Priority),
            movements: vec![
                derived_movement("M_thru", "L_A_J", "L_J_B", MovementKind::Through),
                derived_movement("M_left", "L_S_J", "L_J_B", MovementKind::Left),
                derived_movement("M_u", "L_A_J", "L_J_A", MovementKind::UTurn),
            ],
            signal_plan: None,
        });
        doc
    }

    // --- The round trips ---------------------------------------------------

    /// The gate's centrepiece: everything §2.5 keeps comes back identical.
    ///
    /// The three explicit assertions after it are not redundant with the
    /// whole-struct compare — they are the three fields that fail *quietly*, and
    /// naming them means a regression says which one rather than printing two
    /// forty-line structs and leaving the reader to diff them.
    #[test]
    fn t_junction_round_trips_through_the_writer() {
        let before = parse_network(T_JUNCTION).expect("parse");
        let after = round_trip(T_JUNCTION);

        assert_eq!(comparable(&after), comparable(&before));

        let minor = movement(&after, "M_minor_left");
        assert_eq!(minor.priority, MovementPriority::Minor);
        assert_eq!(minor.yields_to, vec![MovementId::from("M_major_thru")]);
        assert_eq!(
            minor.lane_mapping,
            vec![LaneMappingEntry { from: 0, to: 0 }]
        );
        assert_eq!(after.junctions[0].rule, Some(UnsignalizedRule::Priority));
    }

    /// `cross-4` is `control: signal` with a plan, so dropping it would export a
    /// signalized junction that sits at red forever — no parse error, no
    /// complaint, just a network that does not work.
    #[test]
    fn cross_4_round_trips_with_its_signal_plan() {
        let before = parse_network(CROSS_4).expect("parse");
        let after = round_trip(CROSS_4);

        assert_eq!(comparable(&after), comparable(&before));

        let plan = after.junctions[0]
            .signal_plan
            .as_ref()
            .expect("the plan survives");
        assert_eq!(plan.cycle_time, 60.0);
        assert_eq!(plan.phases.len(), 2);
        assert_eq!(plan.phases[0].green_movements.len(), 4);
        assert_eq!(plan.phases[0].permitted_movements.len(), 4);
    }

    /// §2.3 case 2. An empty u-turn stays empty: filling it would make the round
    /// trip rewrite a file it should have reproduced. And the keys are *written*
    /// — `[]`, not absent — which is the distinction the whole rule turns on.
    #[test]
    fn cross_4_keeps_its_four_empty_u_turns() {
        let doc = network_to_document(parse_network(CROSS_4).expect("parse")).expect("import");
        let text = document_to_yaml(&doc).expect("serialize");
        let after = parse_network(&text).expect("re-parse");

        let u_turns: Vec<_> = after.junctions[0]
            .movements
            .iter()
            .filter(|m| m.kind == MovementKind::UTurn)
            .collect();

        assert_eq!(u_turns.len(), 4);
        for u in &u_turns {
            assert!(u.from_lanes.is_empty(), "{} was filled", u.id);
            assert!(u.to_lanes.is_empty(), "{} was filled", u.id);
        }
        assert_eq!(text.matches("from_lanes: []").count(), 4);
        assert_eq!(text.matches("to_lanes: []").count(), 4);
    }

    // --- The three lane cases ----------------------------------------------

    /// §2.3 case 3, and §2.4's unequal-lane-count note: both lists are valid for
    /// their own link, index 1 simply has no partner, and export does **not**
    /// invent a `lane_mapping` to paper over that — Assimilator's positional
    /// computation is what that case is for.
    #[test]
    fn an_empty_through_movement_gets_every_lane_index() {
        let mut doc = Document::new("Lane drop");
        add_node(&mut doc, "A", NodeKind::Endpoint, -100.0, 0.0);
        add_node(&mut doc, "J", NodeKind::Junction, 0.0, 0.0);
        add_node(&mut doc, "B", NodeKind::Endpoint, 100.0, 0.0);
        add_link(&mut doc, "L_in", "A", "J", 2);
        add_link(&mut doc, "L_out", "J", "B", 1);
        doc.junctions.push(Junction {
            node_id: "J".into(),
            control: JunctionControl::Unsignalized,
            rule: Some(UnsignalizedRule::Priority),
            movements: vec![derived_movement(
                "M",
                "L_in",
                "L_out",
                MovementKind::Through,
            )],
            signal_plan: None,
        });

        let net = document_to_network(&doc);
        let m = movement(&net, "M");

        assert_eq!(m.from_lanes, vec![0, 1]);
        assert_eq!(m.to_lanes, vec![0]);
        assert!(m.lane_mapping.is_empty(), "no mapping is invented");
    }

    /// §2.3.3's discriminator. Every mapping in both fixtures is the positional
    /// identity Assimilator regenerates anyway, so a fixture round trip cannot
    /// tell carrying the field from getting lucky. A crossed one can.
    #[test]
    fn a_crossed_lane_mapping_survives() {
        let mut doc = authored();
        let crossed = vec![
            LaneMappingEntry { from: 0, to: 1 },
            LaneMappingEntry { from: 1, to: 0 },
        ];
        doc.junctions[0].movements[0].from_lanes = vec![0, 1];
        doc.junctions[0].movements[0].to_lanes = vec![0, 1];
        doc.junctions[0].movements[0].lane_mapping = crossed.clone();

        let after = parse_network(&document_to_yaml(&doc).expect("serialize")).expect("re-parse");

        assert_eq!(movement(&after, "M_thru").lane_mapping, crossed);
    }

    /// The assertion this whole section exists for, and it needs no needles: the
    /// mirror declares `from_lanes`/`to_lanes`/`green_movements` bare, so a
    /// document whose movements leave them empty **cannot** re-parse unless the
    /// writer emitted `[]`. Verified by breaking it: adding a
    /// `skip_serializing_if` to the mirror's `from_lanes` fails this test, and
    /// [`Movement`]'s own attribute is exactly that.
    ///
    /// The u-turn in [`authored`] is what gives that teeth — every other movement
    /// here is filled by §2.3 case 3 and would be written either way.
    #[test]
    fn an_authored_document_writes_every_required_key() {
        let text = document_to_yaml(&authored()).expect("serialize");

        let net = parse_network(&text).expect("Assimilator's required keys are all present");

        assert_eq!(net.nodes.len(), 4);
        assert_eq!(net.links.len(), 4);
        for link in &net.links {
            assert!(link.geometry.len() >= 2, "{} has no polyline", link.id);
            for lane in &link.lanes {
                assert!(lane.width > 0.0);
                assert!(lane.speed_limit > 0.0);
            }
        }
        assert_eq!(text.matches("from_lanes:").count(), 3);
        assert_eq!(text.matches("to_lanes:").count(), 3);
        assert_eq!(movement(&net, "M_u").from_lanes, Vec::<LaneIdx>::new());
    }

    // --- The synthesized geometry -------------------------------------------

    /// §2.4's double-offset trap, and the one assertion that catches exporting
    /// `drawnPolyline`: a divided road's two carriageways are drawn to either
    /// side of the shared centreline, but Assimilator applies `median_gap`
    /// itself, so both must leave here **on** it. Both nodes sit at canvas
    /// `y = 0`, so any baked-in offset shows up as a non-zero y.
    #[test]
    fn the_two_carriageways_export_one_unoffset_polyline() {
        let mut doc = Document::new("Divided");
        add_node(&mut doc, "N1", NodeKind::Endpoint, 0.0, 0.0);
        add_node(&mut doc, "N2", NodeKind::Endpoint, 257.0, 0.0);
        add_link(&mut doc, "L_out", "N1", "N2", 2);
        add_link(&mut doc, "L_back", "N2", "N1", 2);

        let net = document_to_network(&doc);
        let out = &net.links[0];
        let back = &net.links[1];

        assert_eq!(
            out.geometry,
            vec![[0.0, 0.0], [257.0 / UNITS_PER_METRE, 0.0]]
        );
        assert_eq!(back.geometry, vec![out.geometry[1], out.geometry[0]]);
        assert_eq!(out.median_gap, 0.5);
        assert_eq!(back.median_gap, 0.5);
        assert_eq!(out.lateral_offset, 0.0);
    }

    /// OQ-1, decided: a road that visibly doglegs in Zukai should not arrive dead
    /// straight in Assimilator. The bends convert by the same rule as the nodes.
    #[test]
    fn a_link_carries_its_bends() {
        let mut doc = Document::new("Dogleg");
        add_node(&mut doc, "A", NodeKind::Endpoint, 0.0, 0.0);
        add_node(&mut doc, "B", NodeKind::Endpoint, 300.0, 0.0);
        add_link(&mut doc, "L", "A", "B", 1);
        doc.layout
            .links
            .get_mut(&LinkId::from("L"))
            .expect("view")
            .bends = vec![Vec2::new(100.0, -50.0), Vec2::new(200.0, -50.0)];

        let net = document_to_network(&doc);

        assert_eq!(net.links[0].geometry.len(), 4);
        assert_eq!(net.links[0].geometry[0], [0.0, 0.0]);
        assert_eq!(
            net.links[0].geometry[1],
            [100.0 / UNITS_PER_METRE, 50.0 / UNITS_PER_METRE]
        );
        assert_eq!(net.links[0].geometry[3], [300.0 / UNITS_PER_METRE, 0.0]);
    }

    /// §2.4's handedness, in the direction the writer owns. Named by compass
    /// bearing rather than by sign: getting this backwards mirrors the whole
    /// network, which is self-consistent, silently wrong, and passes any test
    /// written from the same premise.
    #[test]
    fn a_node_south_on_the_canvas_exports_a_negative_y() {
        let mut doc = Document::new("Bearings");
        add_node(
            &mut doc,
            "S",
            NodeKind::Endpoint,
            0.0,
            300.0 * UNITS_PER_METRE,
        );
        add_node(
            &mut doc,
            "N",
            NodeKind::Endpoint,
            0.0,
            -300.0 * UNITS_PER_METRE,
        );

        let net = document_to_network(&doc);

        assert_eq!(net.nodes[0].point, [0.0, -300.0]);
        assert!(net.nodes[0].point[1] < 0.0, "south must export negative");
        assert!(net.nodes[1].point[1] > 0.0, "north must export positive");
    }

    /// The two conversions are inverses — the property that makes the round trip
    /// scale-neutral, and the reason OQ-2's constant can be argued about without
    /// any of these tests changing.
    #[test]
    fn the_two_conversions_are_inverses() {
        for point in [[0.0, 0.0], [500.0, -300.0], [1000.0, 0.0], [-12.5, 7.25]] {
            let back = canvas_to_metres(metres_to_canvas(point));
            assert!((back[0] - point[0]).abs() < 1e-9, "{back:?} vs {point:?}");
            assert!((back[1] - point[1]).abs() < 1e-9, "{back:?} vs {point:?}");
        }
    }

    /// A node with no layout entry has no position to export. The origin is the
    /// deliberate answer: refusing to export the document would punish a state a
    /// hand-edited `.zkai` can reach.
    #[test]
    fn a_node_with_no_layout_entry_exports_at_the_origin() {
        let mut doc = authored();
        doc.layout.nodes.remove(&NodeId::from("B"));

        let net = document_to_network(&doc);

        let b = net.nodes.iter().find(|n| n.id.as_str() == "B").expect("B");
        assert_eq!(b.point, [0.0, 0.0]);
        // ...and the link that ends there still has a two-point polyline, so the
        // file stays loadable rather than failing Assimilator's "at least 2
        // points" rule on one bad node.
        let l = net
            .links
            .iter()
            .find(|l| l.id.as_str() == "L_J_B")
            .expect("link");
        assert_eq!(l.geometry.last(), Some(&[0.0, 0.0]));
    }

    /// §2.4: alignment is Assimilator's to apply, so it leaves as a **value**
    /// while the polyline stays on the nodes. Two lanes of 3.5 m give a 3.5 m
    /// half-span, negative for the nearside.
    #[test]
    fn an_aligned_link_writes_lateral_offset_as_a_value() {
        let mut doc = Document::new("Aligned");
        add_node(&mut doc, "A", NodeKind::Endpoint, 0.0, 0.0);
        add_node(&mut doc, "B", NodeKind::Endpoint, 257.0, 0.0);
        add_link(&mut doc, "L", "A", "B", 2);
        doc.layout
            .links
            .get_mut(&LinkId::from("L"))
            .expect("view")
            .align = LinkAlign::Nearside;

        let net = document_to_network(&doc);

        assert_eq!(net.links[0].lateral_offset, -3.5);
        assert_eq!(
            net.links[0].geometry,
            vec![[0.0, 0.0], [257.0 / UNITS_PER_METRE, 0.0]],
            "the shift is a value, not a displaced polyline"
        );

        doc.layout
            .links
            .get_mut(&LinkId::from("L"))
            .expect("view")
            .align = LinkAlign::Offside;
        assert_eq!(document_to_network(&doc).links[0].lateral_offset, 3.5);
    }

    // --- Assimilator's own validator ----------------------------------------

    /// The seven rules `crates/network/src/validation.rs` checks *after* parsing.
    ///
    /// Parsing is not the bar: a file that loads and then fails validation is
    /// exactly the silent failure this direction is prone to. Checked as a list
    /// rather than by intuition, which is the whole point of §2.4 naming them.
    fn assert_validates(net: &NetworkFile) {
        let nodes: BTreeMap<&NodeId, &NetworkNode> = net.nodes.iter().map(|n| (&n.id, n)).collect();
        let links: BTreeMap<&LinkId, &NetworkLink> = net.links.iter().map(|l| (&l.id, l)).collect();

        for link in &net.links {
            // 1. Link endpoints reference existing nodes.
            let from = nodes
                .get(&link.from_node)
                .unwrap_or_else(|| panic!("{} names a missing node", link.id));
            let to = nodes
                .get(&link.to_node)
                .unwrap_or_else(|| panic!("{} names a missing node", link.id));

            // 5. The polyline has ≥2 points and starts/ends within 1 m of them.
            assert!(link.geometry.len() >= 2, "{} has a stub polyline", link.id);
            let ends = [
                (link.geometry[0], from.point),
                (*link.geometry.last().expect("non-empty"), to.point),
            ];
            for (p, node) in ends {
                let d = ((p[0] - node[0]).powi(2) + (p[1] - node[1]).powi(2)).sqrt();
                assert!(d < 1.0, "{} strays {d} m from {}", link.id, from.id);
            }

            for lane in &link.lanes {
                assert!(lane.width > 0.0, "{} lane {} is flat", link.id, lane.id);
                assert!(
                    lane.speed_limit > 0.0,
                    "{} lane {} is still",
                    link.id,
                    lane.id
                );
            }
        }

        for junction in &net.junctions {
            for m in &junction.movements {
                // 2. The two links exist and actually touch the junction node.
                let from = links
                    .get(&m.from_link)
                    .unwrap_or_else(|| panic!("{} names a missing link", m.id));
                let to = links
                    .get(&m.to_link)
                    .unwrap_or_else(|| panic!("{} names a missing link", m.id));
                assert_eq!(
                    from.to_node, junction.node_id,
                    "{} approaches elsewhere",
                    m.id
                );
                assert_eq!(to.from_node, junction.node_id, "{} leaves elsewhere", m.id);

                // 3. Lane indices are in range for the link they name.
                for i in &m.from_lanes {
                    assert!((*i as usize) < from.lanes.len(), "{} lane {i}", m.id);
                }
                for i in &m.to_lanes {
                    assert!((*i as usize) < to.lanes.len(), "{} lane {i}", m.id);
                }
            }

            // 4. Phase times sum to the cycle time, tolerance 0.01 s.
            if let Some(plan) = &junction.signal_plan {
                let total: f64 = plan
                    .phases
                    .iter()
                    .map(|p| p.duration + p.amber_time + p.all_red_time)
                    .sum();
                assert!(
                    (total - plan.cycle_time).abs() < 0.01,
                    "{total} against a {} s cycle",
                    plan.cycle_time
                );
            }
        }
    }

    #[test]
    fn the_seven_validator_rules_hold() {
        assert_validates(&round_trip(T_JUNCTION));
        assert_validates(&round_trip(CROSS_4));
        assert_validates(
            &parse_network(&document_to_yaml(&authored()).expect("serialize")).expect("parse"),
        );
    }

    // --- What is not written -------------------------------------------------

    /// The drops, asserted rather than assumed. Needles carry their trailing
    /// colon: Phase 1 learned that the hard way when `point:` matched `endpoint`.
    #[test]
    fn the_dropped_blocks_are_not_written() {
        for fixture in [T_JUNCTION, CROSS_4] {
            let doc = network_to_document(parse_network(fixture).expect("parse")).expect("import");
            let text = document_to_yaml(&doc).expect("serialize");

            for needle in [
                "detectors:",
                "stops:",
                "rerouters:",
                "crossings:",
                "conflict_pairs:",
                "gap_acceptance:",
                "setback:",
                "b_amber:",
                "turn_speed:",
                "control_points:",
                "anchors:",
                "no_change_left:",
                "no_change_right:",
                "gap_after:",
            ] {
                assert!(!text.contains(needle), "{needle} was written");
            }
        }
    }

    /// The one drop the mirror can actually express, so it gets an assertion
    /// rather than a needle: Zukai has no elevation, and a file with real
    /// z-coordinates comes back flat. Stated in the spec's drop list precisely so
    /// nobody has to infer it from `z_enabled: false`.
    #[test]
    fn a_node_z_is_dropped_and_the_network_leaves_flat() {
        let with_z = T_JUNCTION.replace(
            "    point: [500, -300]\n",
            "    point: [500, -300]\n    z: 5\n",
        );
        assert_eq!(
            parse_network(&with_z).expect("parse").nodes[3].z,
            Some(5.0),
            "the fixture edit has to actually land"
        );

        let after = round_trip(&with_z);

        assert!(after.nodes.iter().all(|n| n.z.is_none()));
        assert!(!after.metadata.z_enabled);
    }

    // --- The header, and the file --------------------------------------------

    /// §2.1: the version is a text stamp above serde, so it has to be the first
    /// line rather than wherever a struct field would have landed — and it must
    /// not confuse Zukai's own reader, which is what the re-parse checks.
    #[test]
    fn the_header_is_the_first_line() {
        let text = document_to_yaml(&authored()).expect("serialize");

        assert!(
            text.starts_with("schema_version: 1\n"),
            "starts: {:?}",
            &text[..40]
        );
        assert_eq!(text.matches("schema_version").count(), 1);
        parse_network(&text).expect("Zukai reads its own output");
    }

    /// `import_network`'s twin: the shell is nine lines, so this only has to show
    /// that the bytes reach the disk and come back.
    #[test]
    fn the_command_writes_a_file_the_reader_accepts() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("network.yaml");

        export_network(path.to_string_lossy().into_owned(), authored()).expect("export");

        let text = std::fs::read_to_string(&path).expect("read back");
        assert_eq!(parse_network(&text).expect("parse").nodes.len(), 4);
    }

    #[test]
    fn a_bad_path_is_an_error_rather_than_a_panic() {
        export_network(
            "/nonexistent/directory/network.yaml".to_string(),
            authored(),
        )
        .expect_err("a missing directory must surface");
    }
}
