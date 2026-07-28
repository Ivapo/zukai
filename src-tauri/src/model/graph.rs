//! The semantic road graph — the part of a Zukai document that maps directly
//! to and from Assimilator's `network.yaml` (`nodes`, `links`, `junctions`).
//!
//! This layer is deliberately **geometry-free**: it records topology, lane
//! counts and turn movements, but no coordinates or polylines.
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

use super::ids::{LaneIdx, LinkId, MovementId, NodeId};

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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Junction {
    /// The junction node this controls.
    pub node_id: NodeId,
    /// Signalized vs. give-way/stop control.
    pub control: JunctionControl,
    /// Right-of-way rule for an unsignalized junction; `None` when signalized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<UnsignalizedRule>,
    /// Permitted turning movements through the junction.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub movements: Vec<Movement>,
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

/// A permitted turn from one approach link to one exit link.
///
/// **Lane detail is deliberately absent.** `from_lanes`, `to_lanes`,
/// `priority`, `yields_to` and `lane_mapping` were mirrored here so an imported
/// `network.yaml` could be written back out unchanged. Zukai no longer writes
/// that format (the export was cut), and none of the five was ever read or
/// drawn — a schematic shows *that* a turn is permitted, not which lane pairs
/// with which. Import discards them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Movement {
    /// Stable id (e.g. `M_L1_L3`), preserved across import.
    pub id: MovementId,
    /// Approach link.
    pub from_link: LinkId,
    /// Exit link.
    pub to_link: LinkId,
    /// Turn category, which is what the drawn arc is classified by.
    #[serde(rename = "type")]
    pub kind: MovementKind,
}

/// Turn category of a [`Movement`]. Matches Assimilator's movement `type`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MovementKind {
    /// Straight-through movement.
    Through,
    /// Left turn.
    Left,
    /// Right turn.
    Right,
    /// U-turn.
    #[serde(rename = "u-turn")]
    UTurn,
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
