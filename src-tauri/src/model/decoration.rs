//! Zukai-native decorations: road-surface markings and roadside signs.
//!
//! Assimilator has no concept of either, so nothing in this module ever exports
//! to `network.yaml` — these are purely part of a schematic's expressiveness.
//! Markings are anchored to a link (a position along it, optionally a lane);
//! signs carry their own canvas position in the [`Layout`](super::layout::Layout).

use serde::{Deserialize, Serialize};

use super::ids::{LaneIdx, LinkId, MarkingId, SignId};

/// A painted road-surface marking anchored to a link.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Marking {
    /// Stable id.
    pub id: MarkingId,
    /// Link the marking is painted on.
    pub link: LinkId,
    /// Distance along the link from its start, metres (as with Assimilator's
    /// `crossings`/`detectors` positions).
    pub position: f64,
    /// Lane the marking applies to; `None` spans the whole carriageway.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lane: Option<LaneIdx>,
    /// What is painted.
    pub kind: MarkingKind,
}

/// Kind of road-surface paint. A starter set; extend as the palette grows.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum MarkingKind {
    /// One or more turn arrows in a lane.
    TurnArrow {
        /// Directions the arrow points (e.g. through + left for a shared lane).
        directions: Vec<TurnDirection>,
    },
    /// A stop line across the carriageway or lane.
    StopLine,
    /// A give-way / yield line (dashed or triangles).
    GiveWayLine,
    /// A pedestrian crossing (zebra) painted on the surface.
    Crosswalk,
    /// Diagonal hatching / chevron island keeping traffic out of an area.
    Hatching,
    /// Free text painted on the road (`BUS`, `SLOW`, `30`).
    Text {
        /// The painted characters.
        content: String,
    },
    /// A longitudinal lane line with a given style.
    LaneLine {
        /// Solid / dashed / double appearance.
        style: LineStyle,
    },
}

/// Arrow direction for a [`MarkingKind::TurnArrow`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnDirection {
    /// Straight ahead.
    Through,
    /// Left turn.
    Left,
    /// Right turn.
    Right,
    /// Slight/merge left.
    SlightLeft,
    /// Slight/merge right.
    SlightRight,
    /// U-turn.
    UTurn,
}

/// Appearance of a longitudinal [`MarkingKind::LaneLine`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineStyle {
    /// Continuous line (no crossing).
    Solid,
    /// Broken line (crossing permitted).
    Dashed,
    /// Double solid line.
    Double,
}

/// A roadside sign. Its canvas position lives in the [`Layout`](super::layout::Layout);
/// here we record only what the sign means and (optionally) which link it refers to.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Sign {
    /// Stable id.
    pub id: SignId,
    /// What the sign says.
    pub kind: SignKind,
    /// Link the sign refers to, for context; `None` if free-standing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub associated_link: Option<LinkId>,
}

/// Kind of roadside sign. A starter set with a [`SignKind::Custom`] escape hatch.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum SignKind {
    /// Speed limit in km/h.
    SpeedLimit {
        /// Posted limit, km/h.
        kph: u32,
    },
    /// A warning (triangular) sign, identified by a symbol name.
    Warning {
        /// Symbol id (e.g. `bend_right`, `pedestrians`, `roundabout`).
        symbol: String,
    },
    /// Priority-road sign.
    Priority,
    /// Give-way / yield sign.
    GiveWay,
    /// Stop sign.
    Stop,
    /// No-entry sign.
    NoEntry,
    /// A direction / guide sign with free text.
    Direction {
        /// Destination text on the sign.
        text: String,
    },
    /// Anything not covered above.
    Custom {
        /// Free-text label describing the sign.
        label: String,
    },
}
