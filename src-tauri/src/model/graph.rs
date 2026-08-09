//! The semantic road graph — the part of a Zukai document that maps directly
//! to and from Assimilator's `network.yaml` (`nodes`, `links`, `junctions`).
//!
//! This layer is deliberately **geometry-free**: it records topology and lane
//! counts, but no coordinates or polylines.
//! On import from Assimilator the literal geometry is discarded; on export it
//! is synthesized from the [`Layout`](super::layout::Layout). Presentation
//! (where a node sits on the canvas, how a junction is drawn) lives entirely in
//! `layout` and never appears here, so this whole layer round-trips cleanly.
//!
//! Fidelity note: Assimilator's schema carries more per-junction detail
//! (`conflict_pairs`, `collision_avoidance`, `gap_acceptance`, `geometry`) and
//! more top-level lists (`detectors`, `stops`, `rerouters`). Those are
//! auto-generated or simulation-only; Zukai omits them for now and will add
//! them to [`Junction`]/the document as import/export fidelity demands.

use serde::{Deserialize, Serialize};

use super::ids::{LaneIdx, LinkId, NodeId};

/// A point in the network graph: a road end, a junction, or a mid-road shape
/// change. Matches Assimilator's node `type`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    /// A dangling road end (an arm leaving the schematic). Assimilator's
    /// `endpoint` — exactly what a network *fragment* terminates its arms with.
    Endpoint,
    /// A controlled or uncontrolled intersection; carries a [`Junction`].
    Junction,
    /// A non-intersection point where the road continues but changes (e.g. a
    /// lane count change between two links). Assimilator's `waypoint`.
    Waypoint,
}

/// A vertex of the road graph.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Node {
    /// Stable id, preserved across Assimilator import/export.
    pub id: NodeId,
    /// What kind of point this is.
    #[serde(rename = "type")]
    pub kind: NodeKind,
}

/// A directed road segment between two nodes, carrying one or more lanes.
///
/// As in Assimilator, roads are directional: a two-way street is two links with
/// opposite `from_node`/`to_node`. Lane-count changes along a road are modelled
/// as separate links meeting at a [`NodeKind::Waypoint`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Link {
    /// Stable id, preserved across Assimilator import/export.
    pub id: LinkId,
    /// Upstream node.
    pub from_node: NodeId,
    /// Downstream node.
    pub to_node: NodeId,
    /// Lanes, ordered; `lanes.len()` is the schematic lane count.
    pub lanes: Vec<Lane>,
    /// Gap to the opposing carriageway centreline, metres (Assimilator default).
    #[serde(default = "default_median_gap")]
    pub median_gap: f64,
    /// How long the road really is, metres — the human's claim about the world,
    /// and **not** a measurement of the drawing. The drawing is a diagram, so the
    /// two are decoupled: changing this moves nothing on the canvas, and moving a
    /// node changes nothing here (link-length spec §2.2).
    ///
    /// `None` means the road states no length, which every document written
    /// before this field means. It is neither zero nor "unknown pending
    /// measurement". Elided when absent, so those documents stay byte-identical
    /// and the field costs no `SCHEMA_VERSION` bump.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<f64>,
}

/// A single lane within a [`Link`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Lane {
    /// `0`-based lane index within the link.
    pub id: LaneIdx,
    /// Lane width, metres.
    #[serde(default = "default_lane_width")]
    pub width: f64,
    /// Speed limit, metres per second (SI, as in Assimilator).
    #[serde(default = "default_speed_limit")]
    pub speed_limit: f64,
    /// Vehicle classes permitted; empty means all.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_classes: Vec<String>,
    /// Schematic-only hint used for rendering (bus lane tint, shoulder hatch).
    /// Not part of Assimilator's schema; ignored on export.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<LaneKind>,
}

/// Optional schematic classification of a lane, for rendering only.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaneKind {
    /// General traffic lane (the default rendering).
    General,
    /// Bus / public-transport lane.
    Bus,
    /// Hard shoulder / emergency lane.
    Shoulder,
    /// Dedicated turn pocket.
    Turn,
    /// Cycle lane.
    Cycle,
}

/// The intersection attached to a [`NodeKind::Junction`] node.
///
/// **Which turns it permits is not recorded here.** A junction's turns are said
/// with paint on the approach — a `turn_arrow`
/// [`Marking`](super::decoration::Marking) per lane — rather than with a
/// relation in the model: an arrow is what the road tells a driver, and it is
/// the only one of the two that prints (lane arrows §2.1). An older `.zkai`
/// carrying a `movements:` key still loads, because nothing here derives
/// `deny_unknown_fields`, and saving it again drops the key.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Junction {
    /// The junction node this controls.
    pub node_id: NodeId,
    /// Signalized vs. give-way/stop control.
    pub control: JunctionControl,
    /// Right-of-way rule for an unsignalized junction; `None` when signalized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<UnsignalizedRule>,
}

/// How a junction is controlled. Matches Assimilator's `control`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JunctionControl {
    /// Traffic-signal controlled.
    Signal,
    /// Uncontrolled or sign-controlled; behaviour set by [`UnsignalizedRule`].
    Unsignalized,
}

/// Right-of-way rule for an unsignalized junction. Matches Assimilator's `rule`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnsignalizedRule {
    /// Major road has priority over minor approaches.
    Priority,
    /// Priority to the right (uncontrolled).
    PriorityRight,
    /// All approaches stop.
    AllWayStop,
}

fn default_median_gap() -> f64 {
    0.5
}

fn default_lane_width() -> f64 {
    3.5
}

fn default_speed_limit() -> f64 {
    // 50 km/h, matching Assimilator's editor-generated example networks.
    13.888_888_888_888_89
}
