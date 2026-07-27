//! The semantic road graph — the part of a Zukai document that maps directly
//! to and from Assimilator's `network.yaml` (`nodes`, `links`, `junctions`).
//!
//! This layer is deliberately **geometry-free**: it records topology, lane
//! counts, turn movements, and signal timing, but no coordinates or polylines.
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

use super::ids::{LaneIdx, LinkId, MovementId, NodeId, PhaseId};

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
    /// Fixed-time signal plan; `None` unless signalized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal_plan: Option<SignalPlan>,
}

/// How a junction is controlled. Matches Assimilator's `control`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JunctionControl {
    /// Traffic-signal controlled; expects a [`SignalPlan`].
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Movement {
    /// Stable id (e.g. `M_L1_L3`), preserved across import/export.
    pub id: MovementId,
    /// Approach link.
    pub from_link: LinkId,
    /// Exit link.
    pub to_link: LinkId,
    /// Approach lanes used; empty for a movement with no lane detail (e.g. a
    /// bare u-turn), matching Assimilator — its own editor writes
    /// `from_lanes: []` for exactly that case.
    ///
    /// **When writing a `network.yaml` the key is always emitted: `[]` is legal,
    /// absent is not.** Assimilator's `MovementConfig.from_lanes` carries no
    /// `serde(default)`, so an omitted key fails the whole file's parse. The
    /// `skip_serializing_if` below is `.zkai` terseness only — see
    /// `specs/network_yaml_spec.md` §2.3.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub from_lanes: Vec<LaneIdx>,
    /// Exit lanes used. Same always-write rule as `from_lanes` on export.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub to_lanes: Vec<LaneIdx>,
    /// Turn category, used both for export and for drawing turn arrows.
    #[serde(rename = "type")]
    pub kind: MovementKind,
    /// Right of way at a `priority` junction. Carried for Assimilator fidelity,
    /// never edited: nothing in Zukai creates a minor movement, the same deal
    /// [`Junction::signal_plan`] has had since the first commit
    /// (`specs/network_yaml_spec.md` §2.3.1).
    #[serde(default, skip_serializing_if = "MovementPriority::is_major")]
    pub priority: MovementPriority,
    /// Movements this one must give way to; only meaningful when `priority` is
    /// [`MovementPriority::Minor`]. Carried, not edited.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub yields_to: Vec<MovementId>,
    /// Explicit lane pairings through the junction. Carried, not edited: empty
    /// means Assimilator computes them positionally from `from_lanes`/`to_lanes`,
    /// and a **crossed** mapping is the one it cannot regenerate (§2.3.3).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lane_mapping: Vec<LaneMappingEntry>,
}

/// Right of way of a [`Movement`] at a [`UnsignalizedRule::Priority`] junction.
///
/// Assimilator's `MovementPriority`, spelled `lowercase` to match it. Dropping
/// this field would import a file happily and export a priority junction in
/// which *nothing yields* — a materially different network, with no parse error
/// to say so (`specs/network_yaml_spec.md` §2.3.1).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MovementPriority {
    /// Has right of way (the default).
    #[default]
    Major,
    /// Must give way to the movements in [`Movement::yields_to`].
    Minor,
}

impl MovementPriority {
    /// Serialization predicate: a major movement writes no `priority` key, so a
    /// document that never carried one saves exactly as it did before the field
    /// existed. [`super::layout::LinkAlign`]'s `is_centre`, for the same reason.
    fn is_major(&self) -> bool {
        matches!(self, Self::Major)
    }
}

/// One approach lane paired with one departure lane through a [`Movement`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaneMappingEntry {
    /// Lane index on the approach link.
    pub from: LaneIdx,
    /// Lane index on the exit link.
    pub to: LaneIdx,
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

/// A fixed-time signal plan for a signalized junction.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SignalPlan {
    /// Total cycle length, seconds.
    pub cycle_time: f64,
    /// Offset from a common reference, seconds (coordinated corridors).
    #[serde(default)]
    pub offset: f64,
    /// Phases in cycle order.
    pub phases: Vec<Phase>,
}

/// One stage of a [`SignalPlan`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Phase {
    /// Stable id (e.g. `P1`).
    pub id: PhaseId,
    /// Green duration, seconds (excludes amber/all-red).
    pub duration: f64,
    /// Movements shown protected green this phase.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub green_movements: Vec<MovementId>,
    /// Movements permitted (give-way) this phase.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub permitted_movements: Vec<MovementId>,
    /// Amber time after green, seconds.
    #[serde(default = "default_amber_time")]
    pub amber_time: f64,
    /// All-red clearance after amber, seconds.
    #[serde(default = "default_all_red_time")]
    pub all_red_time: f64,
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

fn default_amber_time() -> f64 {
    3.0
}

fn default_all_red_time() -> f64 {
    2.0
}
