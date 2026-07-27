//! The Zukai schematic document model.
//!
//! A [`Document`] is the whole thing a user draws and saves. It has three
//! parts, kept deliberately separate:
//!
//! 1. **Semantic graph** ([`graph`]) — `nodes`, `links`, `junctions`. This is
//!    the geometry-free subset that maps 1:1 to and from Assimilator's
//!    `network.yaml`.
//! 2. **Layout** ([`layout`]) — canvas positions, glyph styles, connector
//!    bends. Presentation only; dropped on export, regenerated on import.
//! 3. **Decorations** ([`decoration`]) — road-surface markings and roadside
//!    signs. Zukai-native; Assimilator has no equivalent, so they never export.
//!
//! Zukai saves its own YAML (its schema is *not* Assimilator's), versioned by
//! [`Document::schema_version`]. Import/export against `network.yaml` is a
//! separate translation step layered on top of these types.

pub mod decoration;
pub mod graph;
pub mod ids;
pub mod layout;

use serde::{Deserialize, Serialize};

use decoration::{Marking, Sign};
use graph::{Junction, Link, Node};
use layout::Layout;

/// The current Zukai document schema version. Bump on a breaking change to the
/// save format (distinct from Assimilator's `network.yaml` `schema_version`).
///
/// A new optional *field* is not a breaking change — nothing here derives
/// `deny_unknown_fields`, so an older build ignores one it does not know, which
/// is why [`layout::LinkView::align`] arrived at version 1. A new enum
/// **variant** is: an older build fails to deserialize the whole document, and
/// [`crate::persist::load_document`]'s version probe can only turn that into a
/// readable message if the version moves with it. Version 2 is
/// [`layout::JunctionGlyph::Gore`].
///
/// No migration arm is needed for it: a version-1 document is a valid version-2
/// document.
pub const SCHEMA_VERSION: u32 = 2;

/// A complete schematic: semantic graph, its presentation, and decorations.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Document {
    /// Save-format version; see [`SCHEMA_VERSION`].
    pub schema_version: u32,
    /// Document metadata (name, etc.).
    pub metadata: Metadata,
    // --- Semantic graph: the Assimilator-exportable subset ---
    /// Graph vertices.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<Node>,
    /// Directed road segments.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<Link>,
    /// Intersections, each attached to a junction-kind node.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub junctions: Vec<Junction>,
    // --- Presentation: stripped on export ---
    /// Canvas placement and glyph styling for the graph above.
    #[serde(default)]
    pub layout: Layout,
    // --- Zukai-native decorations: never exported ---
    /// Painted road-surface markings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub markings: Vec<Marking>,
    /// Roadside signs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub signs: Vec<Sign>,
}

impl Document {
    /// An empty document at the current schema version with the given name.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            metadata: Metadata {
                name: name.into(),
                author: None,
            },
            nodes: Vec::new(),
            links: Vec::new(),
            junctions: Vec::new(),
            layout: Layout::default(),
            markings: Vec::new(),
            signs: Vec::new(),
        }
    }
}

/// Descriptive metadata about a document.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Metadata {
    /// Human-readable schematic name.
    pub name: String,
    /// Optional author.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::decoration::{Marking, MarkingKind, Sign, SignKind, TurnDirection};
    use super::graph::{
        Junction, JunctionControl, Lane, LaneMappingEntry, Link, Movement, MovementKind,
        MovementPriority, Node, NodeKind, Phase, SignalPlan,
    };
    use super::layout::{
        JunctionGlyph, JunctionView, Layout, LinkAlign, LinkStyle, LinkView, NodeView, Vec2,
    };
    use super::*;

    /// A small but non-trivial document exercising every part of the model:
    /// a signalized T-junction with a turn arrow and a give-way sign.
    fn sample() -> Document {
        let lanes = || {
            vec![Lane {
                id: 0,
                width: 3.5,
                speed_limit: 13.888_888_888_888_89,
                allowed_classes: vec![],
                kind: None,
            }]
        };
        let mut doc = Document::new("Sample T-junction");
        doc.metadata.author = Some("test".into());
        doc.nodes = vec![
            Node {
                id: "N1".into(),
                kind: NodeKind::Endpoint,
            },
            Node {
                id: "N2".into(),
                kind: NodeKind::Junction,
            },
            Node {
                id: "N3".into(),
                kind: NodeKind::Endpoint,
            },
        ];
        doc.links = vec![
            Link {
                id: "L1".into(),
                from_node: "N1".into(),
                to_node: "N2".into(),
                lanes: lanes(),
                median_gap: 0.5,
            },
            Link {
                id: "L2".into(),
                from_node: "N2".into(),
                to_node: "N3".into(),
                lanes: lanes(),
                median_gap: 0.5,
            },
        ];
        doc.junctions = vec![Junction {
            node_id: "N2".into(),
            control: JunctionControl::Signal,
            rule: None,
            movements: vec![Movement {
                id: "M_L1_L2".into(),
                from_link: "L1".into(),
                to_link: "L2".into(),
                from_lanes: vec![0],
                to_lanes: vec![0],
                kind: MovementKind::Through,
                // Minor rather than major so the round-trip test actually
                // exercises the three carried fields: a major movement writes
                // no `priority` key at all (see `a_major_movement_writes_no_
                // priority_key`), so a `Major` here would assert nothing.
                priority: MovementPriority::Minor,
                yields_to: vec!["M_L2_L1".into()],
                lane_mapping: vec![LaneMappingEntry { from: 0, to: 0 }],
            }],
            signal_plan: Some(SignalPlan {
                cycle_time: 60.0,
                offset: 0.0,
                phases: vec![Phase {
                    id: "P1".into(),
                    duration: 25.0,
                    green_movements: vec!["M_L1_L2".into()],
                    permitted_movements: vec![],
                    amber_time: 3.0,
                    all_red_time: 2.0,
                }],
            }),
        }];
        doc.layout = Layout {
            nodes: [
                (
                    "N1".into(),
                    NodeView {
                        pos: Vec2::new(0.0, 0.0),
                    },
                ),
                (
                    "N2".into(),
                    NodeView {
                        pos: Vec2::new(100.0, 0.0),
                    },
                ),
                (
                    "N3".into(),
                    NodeView {
                        pos: Vec2::new(200.0, 0.0),
                    },
                ),
            ]
            .into_iter()
            .collect(),
            links: [(
                "L1".into(),
                LinkView {
                    style: LinkStyle::Arterial,
                    align: LinkAlign::Offside,
                    bends: vec![Vec2::new(50.0, 10.0)],
                },
            )]
            .into_iter()
            .collect(),
            junctions: [(
                "N2".into(),
                JunctionView {
                    glyph: JunctionGlyph::SignalizedCross,
                    rotation: 0.0,
                    scale: 1.0,
                },
            )]
            .into_iter()
            .collect(),
            signs: [("S1".into(), Vec2::new(120.0, 20.0))]
                .into_iter()
                .collect(),
        };
        doc.markings = vec![Marking {
            id: "K1".into(),
            link: "L1".into(),
            position: 90.0,
            lane: Some(0),
            kind: MarkingKind::TurnArrow {
                directions: vec![TurnDirection::Through],
            },
        }];
        doc.signs = vec![Sign {
            id: "S1".into(),
            kind: SignKind::GiveWay,
            associated_link: Some("L2".into()),
        }];
        doc
    }

    #[test]
    fn yaml_round_trips() {
        let doc = sample();
        let yaml = serde_yaml::to_string(&doc).expect("serialize");
        let back: Document = serde_yaml::from_str(&yaml).expect("deserialize");
        assert_eq!(doc, back);
    }

    /// The whole point of [`MovementPriority::is_major`]: every movement Zukai
    /// has ever created is major, so adding the field must leave those documents
    /// saving byte-for-byte as before — which is why it needs no
    /// [`SCHEMA_VERSION`] bump. `LinkAlign::is_centre`'s test, one field later.
    #[test]
    fn a_major_movement_writes_no_priority_key() {
        let movement = Movement {
            id: "M_L1_L2".into(),
            from_link: "L1".into(),
            to_link: "L2".into(),
            from_lanes: vec![],
            to_lanes: vec![],
            kind: MovementKind::Through,
            priority: MovementPriority::Major,
            yields_to: vec![],
            lane_mapping: vec![],
        };

        let yaml = serde_yaml::to_string(&movement).expect("serialize");

        assert!(
            !yaml.contains("priority"),
            "unexpected priority in {yaml:?}"
        );
        assert!(
            !yaml.contains("yields_to"),
            "unexpected yields_to in {yaml:?}"
        );
        assert!(
            !yaml.contains("lane_mapping"),
            "unexpected lane_mapping in {yaml:?}"
        );
        // ...and a minor one does write it, in Assimilator's own spelling.
        let minor = Movement {
            priority: MovementPriority::Minor,
            ..movement
        };
        assert!(serde_yaml::to_string(&minor)
            .expect("serialize")
            .contains("priority: minor"));
    }

    /// A `.zkai` written before these fields existed still loads, with the
    /// documented defaults — the other half of "a new optional field costs no
    /// version bump".
    #[test]
    fn a_movement_without_the_new_fields_loads_as_major() {
        let yaml = "id: M_L1_L2\nfrom_link: L1\nto_link: L2\ntype: through\n";

        let movement: Movement = serde_yaml::from_str(yaml).expect("deserialize");

        assert_eq!(movement.priority, MovementPriority::Major);
        assert!(movement.yields_to.is_empty());
        assert!(movement.lane_mapping.is_empty());
    }

    #[test]
    fn defaults_fill_in_for_minimal_yaml() {
        // A lane written with only its id should pick up the documented defaults.
        let yaml = r"
schema_version: 1
metadata:
  name: Minimal
nodes:
  - id: N1
    type: endpoint
  - id: N2
    type: endpoint
links:
  - id: L1
    from_node: N1
    to_node: N2
    lanes:
      - id: 0
";
        let doc: Document = serde_yaml::from_str(yaml).expect("deserialize");
        let lane = &doc.links[0].lanes[0];
        assert_eq!(lane.width, 3.5);
        assert_eq!(doc.links[0].median_gap, 0.5);
        // Absent layout deserializes to an empty (not missing) layout.
        assert!(doc.layout.nodes.is_empty());
    }
}
