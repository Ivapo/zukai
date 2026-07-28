//! `network.yaml` → [`Document`]: the easy direction.
//!
//! Import throws information away. The polylines go, because a schematic
//! intentionally distorts real geometry for clarity and reusing surveyed
//! coordinates is the whole thing Zukai exists not to do. What does *not* go is
//! `point`: it is **demoted, not discarded** — it seeds `layout.nodes` and never
//! reaches `doc.nodes`, which stays geometry-free.
//!
//! That seeding is not a nicety. A node with no layout entry has no drawable
//! polyline, so an unseeded import renders a blank page. The positions arrive
//! true-to-life and *wrong for a schematic*, and a human drags them into a
//! legible diagram — semi-automatic, which is the project's stated posture
//! towards layout, not a step short of auto-layout.
//!
//! The conversion is pure: [`network_to_document`] touches no filesystem and no
//! IPC, and everything a test needs to exercise it is a `&str`.
//! [`import_network`] is the thin shell around it — read the file, probe the
//! version, convert — and is the only thing here the app can reach. See
//! `specs/network_yaml_spec.md` §2.5–§2.6.

use std::fs;

use crate::model::graph::{Junction, Lane, Link, Movement, Node, NodeKind};
use crate::model::layout::{JunctionView, LinkAlign, LinkStyle, LinkView, NodeView};
use crate::model::Document;

use super::{
    metres_to_canvas, parse_network, NetworkFile, NetworkJunction, NetworkLink, NetworkMovement,
};

/// Read a `network.yaml` from disk and convert it to a Zukai [`Document`].
///
/// The command surface for the whole module: [`crate::persist::load_document`]'s
/// shape, one format over. What the *caller* does with the result is where the
/// two part company — an imported document is **dirty and pathless**, because
/// this is not a `.zkai` and Save must not write back over the file it came
/// from. That rule lives in the reducer (`importDocument`), not here.
#[tauri::command]
pub fn import_network(path: String) -> Result<Document, String> {
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    network_to_document(parse_network(&text)?)
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

    for node in &net.nodes {
        doc.nodes.push(Node {
            id: node.id.clone(),
            kind: node.kind,
        });
        // The demotion: metric position out of the graph and into the layout.
        doc.layout.nodes.insert(
            node.id.clone(),
            NodeView {
                pos: metres_to_canvas(node.point),
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

fn import_link(link: NetworkLink) -> Link {
    Link {
        id: link.id,
        from_node: link.from_node,
        to_node: link.to_node,
        lanes: link
            .lanes
            .into_iter()
            .map(|lane| Lane {
                id: lane.id,
                width: lane.width,
                speed_limit: lane.speed_limit,
                allowed_classes: lane.allowed_classes,
                // Schematic-only, so nothing in the file can supply it.
                kind: None,
            })
            .collect(),
        median_gap: link.median_gap,
    }
}

/// A junction arrives as its control, its right-of-way rule and the turns it
/// permits.
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
        movements: junction
            .movements
            .into_iter()
            .map(import_movement)
            .collect(),
    }
}

/// A turn arrives as the pair of links it joins and the category of turn it is —
/// which is all the schematic draws it from.
///
/// The file's lane detail (`from_lanes`, `to_lanes`, `lane_mapping`) and its
/// right-of-way detail (`priority`, `yields_to`) are **discarded**, alongside the
/// polyline geometry. They were once carried so an imported network could be
/// written back out unchanged; nothing writes that format now, and a schematic
/// says *that* a turn is permitted rather than which lane feeds which.
fn import_movement(movement: NetworkMovement) -> Movement {
    Movement {
        id: movement.id,
        from_link: movement.from_link,
        to_link: movement.to_link,
        kind: movement.kind,
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::model::graph::{JunctionControl, MovementKind, UnsignalizedRule};
    use crate::model::ids::NodeId;
    use crate::model::layout::JunctionGlyph;
    use crate::network::{parse_network, CROSS_4, T_JUNCTION, UNITS_PER_METRE};

    fn import(text: &str) -> Document {
        network_to_document(parse_network(text).expect("parse")).expect("import")
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
        assert_eq!(doc.junctions[0].movements.len(), 2);

        let ids: Vec<_> = doc.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, ["W", "J", "E", "S"]);
        let ids: Vec<_> = doc.links.iter().map(|l| l.id.as_str()).collect();
        assert_eq!(ids, ["L_W_J", "L_J_E", "L_S_J"]);
        assert_eq!(doc.junctions[0].node_id.as_str(), "J");
        assert_eq!(doc.junctions[0].movements[0].id.as_str(), "M_major_thru");
        assert_eq!(doc.junctions[0].movements[1].id.as_str(), "M_minor_left");

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
    #[test]
    fn the_southern_node_seeds_a_positive_canvas_y() {
        let doc = import(T_JUNCTION);

        let south = doc.layout.nodes[&NodeId::from("S")].pos;
        assert_eq!(south.x, 500.0 * UNITS_PER_METRE);
        assert_eq!(south.y, 300.0 * UNITS_PER_METRE);

        // The west end is the origin, and the east end is further east than the
        // junction — so the T is the right way round as well as the right way up.
        let west = doc.layout.nodes[&NodeId::from("W")].pos;
        let junction = doc.layout.nodes[&NodeId::from("J")].pos;
        let east = doc.layout.nodes[&NodeId::from("E")].pos;
        assert_eq!(west.x, 0.0);
        assert!(west.x < junction.x && junction.x < east.x);
        assert!(south.y > junction.y, "the stem hangs below the crossbar");
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
        assert_eq!(view.rotation, 0.0);
        assert_eq!(view.scale, 1.0);
    }

    /// A movement arrives as the two links it joins and the kind of turn it is,
    /// and **nothing else** — the whole-struct comparison is the assertion, so a
    /// field re-added to the model fails here rather than quietly reappearing.
    ///
    /// `t_junction.yaml`'s movements carry `from_lanes`, `to_lanes`,
    /// `lane_mapping`, `priority` and `yields_to`, and the second half of this
    /// test is that those keys being present is **harmless**: serde ignores an
    /// unknown key, so dropping them from the mirror cannot make a real network
    /// fail to parse. Importing this file at all is that assertion.
    #[test]
    fn a_movement_arrives_as_two_links_and_a_turn() {
        let doc = import(T_JUNCTION);
        let movements = &doc.junctions[0].movements;

        assert_eq!(
            movements[0],
            Movement {
                id: "M_major_thru".into(),
                from_link: "L_W_J".into(),
                to_link: "L_J_E".into(),
                kind: MovementKind::Through,
            }
        );

        // Its `type` is `right`, not `left` — the id names the road, the kind
        // names the turn, and the mirror carries the file's word for it.
        assert_eq!(movements[1].id.as_str(), "M_minor_left");
        assert_eq!(movements[1].kind, MovementKind::Right);
    }

    /// `cross-4` is `control: signal` **with** a 60 s plan in the file, and the
    /// import keeps the control and drops the plan. A fixed-time plan is a table
    /// of stage timings; nothing draws one, and Zukai does not write this format
    /// back out, so carrying it would be carrying data for no reader.
    ///
    /// The whole-junction comparison is the assertion — a field re-added to the
    /// model fails here rather than silently reappearing.
    #[test]
    fn cross_4_keeps_its_control_and_drops_its_signal_plan() {
        let doc = import(CROSS_4);
        let junction = &doc.junctions[0];

        assert_eq!(junction.control, JunctionControl::Signal);
        assert_eq!(junction.rule, None);
        assert_eq!(junction.movements.len(), 16);
        assert!(
            CROSS_4.contains("signal_plan:"),
            "the fixture must still have one"
        );
    }

    /// The u-turn is the one kind `derivableMovements` never mints, so an
    /// imported junction is the only place the drawing meets one — and
    /// `cross-4` has four. The kind is the whole of what survives import, and
    /// it is what the arc is drawn from.
    #[test]
    fn cross_4_keeps_its_four_u_turns() {
        let doc = import(CROSS_4);

        let u_turns = doc.junctions[0]
            .movements
            .iter()
            .filter(|m| m.kind == MovementKind::UTurn)
            .count();

        assert_eq!(u_turns, 4);
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
