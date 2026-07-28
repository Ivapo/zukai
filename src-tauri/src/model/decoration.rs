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
    /// Distance along the link from the end named by [`anchor`](Self::anchor),
    /// metres (as with Assimilator's `crossings`/`detectors` positions).
    pub position: f64,
    /// Which end of the link [`position`](Self::position) is measured from.
    ///
    /// Elided when `start`, so every document written before this field existed
    /// loads and saves byte-for-byte as it did — [`LinkAlign`](super::layout::LinkAlign)'s
    /// shape, for its reason.
    #[serde(default, skip_serializing_if = "LinkEnd::is_start")]
    pub anchor: LinkEnd,
    /// Lane the marking applies to; `None` spans the whole carriageway.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lane: Option<LaneIdx>,
    /// What is painted.
    pub kind: MarkingKind,
}

/// Which end of a link a [`Marking`]'s position is measured from.
///
/// `End` means the link's `to_node`, so the paint holds its distance from the
/// junction a road arrives at while the road's *drawn* length changes freely —
/// which is what auto-placed paint needs, since a schematic's arms are dragged
/// into shape after they are populated (lane arrows spec §2.3).
///
/// Named after a link but living among the decorations, because that is what it
/// belongs to: `anchor` is Zukai's own and never exports, and
/// [`graph`](super::graph) is the layer whose whole promise is a 1:1
/// `network.yaml` mapping.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkEnd {
    /// The link's `from_node` — where every marking measured from before the
    /// field existed, and where one with no `anchor` key still measures from.
    #[default]
    Start,
    /// The link's `to_node`.
    End,
}

impl LinkEnd {
    /// Whether this is the default start anchor — the `skip_serializing_if`
    /// predicate for [`Marking::anchor`].
    fn is_start(&self) -> bool {
        matches!(self, Self::Start)
    }
}

/// Kind of road-surface paint. A starter set; extend as the palette grows.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum MarkingKind {
    /// One or more turn arrows in a lane.
    TurnArrow {
        /// Directions the arrow points (e.g. through + left for a shared lane).
        directions: Vec<TurnDirection>,
        /// Directions painted at the **upstream** end, pointing upstream — a
        /// head at each end, for a lane carrying traffic both ways. The case
        /// that earns it is the two-way left-turn lane (markings spec §2.11).
        ///
        /// A `Vec` rather than an `Option<Vec>`, and elided when empty: empty
        /// and absent are then the same document, so emptying the control is
        /// the whole route back to a single-headed arrow and no code has to
        /// decide what `Some(vec![])` means. [`Marking::anchor`]'s shape, for
        /// its reason — a defaulted value with a `skip_serializing_if`
        /// predicate rather than an `Option`.
        ///
        /// **Nothing imports one.** Assimilator has no per-lane direction at
        /// all — a link runs `from_node` → `to_node` and a two-way road is a
        /// *pair* of links — so this is schematic-only, as [`Lane::kind`] is.
        ///
        /// [`Lane::kind`]: super::graph::Lane::kind
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        back: Vec<TurnDirection>,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A stop line 20 m along `L1`, anchored to the given end.
    fn marking(anchor: LinkEnd) -> Marking {
        Marking {
            id: "K1".into(),
            link: "L1".into(),
            position: 20.0,
            anchor,
            lane: Some(0),
            kind: MarkingKind::StopLine,
        }
    }

    #[test]
    fn an_anchor_survives_a_yaml_round_trip() {
        let yaml = serde_yaml::to_string(&marking(LinkEnd::End)).expect("serialize");
        let back: Marking = serde_yaml::from_str(&yaml).expect("deserialize");
        assert_eq!(marking(LinkEnd::End), back);

        // …written in the same snake_case the TypeScript mirror spells.
        assert!(
            yaml.contains("anchor: end"),
            "unexpected anchor in {yaml:?}"
        );
    }

    /// The whole point of the `skip_serializing_if` predicate: every marking
    /// written before the field existed measured from the start, so one that
    /// still does must save exactly as it did — which is what makes a new
    /// optional field cost no `SCHEMA_VERSION` bump.
    #[test]
    fn a_start_anchored_marking_writes_no_anchor_key_at_all() {
        let yaml = serde_yaml::to_string(&marking(LinkEnd::Start)).expect("serialize");

        assert!(
            !yaml.contains("anchor"),
            "unexpected anchor key in {yaml:?}"
        );
    }

    #[test]
    fn a_file_without_the_field_loads_as_start() {
        let marking: Marking =
            serde_yaml::from_str("id: K1\nlink: L1\nposition: 20.0\nkind:\n  type: stop_line\n")
                .expect("deserialize");

        assert_eq!(marking.anchor, LinkEnd::Start);
    }

    /// A left-turn arrow with the given rear heads — a two-way left-turn lane
    /// when `back` names `left`, and today's single-headed arrow when it is
    /// empty (markings spec §2.11).
    fn arrow(back: Vec<TurnDirection>) -> Marking {
        Marking {
            id: "K1".into(),
            link: "L1".into(),
            position: 20.0,
            anchor: LinkEnd::Start,
            lane: Some(1),
            kind: MarkingKind::TurnArrow {
                directions: vec![TurnDirection::Left],
                back,
            },
        }
    }

    #[test]
    fn a_rear_head_survives_a_yaml_round_trip() {
        let marking = arrow(vec![TurnDirection::Left, TurnDirection::UTurn]);
        let yaml = serde_yaml::to_string(&marking).expect("serialize");
        let read: Marking = serde_yaml::from_str(&yaml).expect("deserialize");
        assert_eq!(marking, read);

        // …written in the same snake_case the TypeScript mirror spells.
        assert!(yaml.contains("back:"), "no back key in {yaml:?}");
        assert!(yaml.contains("u_turn"), "unexpected spelling in {yaml:?}");
    }

    /// The `skip_serializing_if` predicate, and the reason it is a `Vec` rather
    /// than an `Option<Vec>`: emptying the back control is the whole route back
    /// to a single-headed arrow, and it has to leave a file byte-identical to
    /// one that never had a rear head. That is what makes the field cost no
    /// [`SCHEMA_VERSION`](super::SCHEMA_VERSION) bump.
    #[test]
    fn an_arrow_with_no_rear_head_writes_no_back_key_at_all() {
        let yaml = serde_yaml::to_string(&arrow(Vec::new())).expect("serialize");

        assert!(!yaml.contains("back"), "unexpected back key in {yaml:?}");
    }

    #[test]
    fn a_file_without_the_field_loads_as_single_headed() {
        let marking: Marking = serde_yaml::from_str(
            "id: K1\nlink: L1\nposition: 20.0\nkind:\n  type: turn_arrow\n  directions:\n  - left\n",
        )
        .expect("deserialize");

        assert_eq!(
            marking.kind,
            MarkingKind::TurnArrow {
                directions: vec![TurnDirection::Left],
                back: Vec::new(),
            }
        );
    }
}
