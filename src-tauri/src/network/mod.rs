//! Assimilator's `network.yaml` — the one format Zukai reads that Zukai does not
//! own.
//!
//! This module is deliberately *not* part of [`crate::persist`]. They are two
//! YAML formats with two different owners: `.zkai` is Zukai's own shape and may
//! change whenever Zukai likes, while this one belongs to another project and may
//! only change when that project's does. Putting them in one file would make the
//! second rule invisible.
//!
//! # The mirror rule
//!
//! [`NetworkFile`] and its structs mirror Assimilator's `NetworkConfig`
//! (`crates/config/src/network.rs`). **Every field's optionality follows
//! Assimilator's source, not Zukai's model** — the two disagree, and copying the
//! wrong one rejects legal files. `MovementConfig.movement_type` is
//! `#[serde(default, rename = "type")]` there, so a movement omitting `type:`
//! must still parse here.
//!
//! [`NetworkMovement::from_lanes`] is the one deliberate departure, and its own
//! doc comment says why: the rule was there to guarantee faithful *writing*, and
//! nothing writes this format any more.
//!
//! What is *not* mirrored is mirrored nowhere by accident: `detectors`, `stops`,
//! `crossings` and `rerouters` are simulation instrumentation a schematic has
//! nowhere to draw, and nothing here derives `deny_unknown_fields`, so they pass
//! through the reader untouched and unstored. See `specs/network_yaml_spec.md`
//! §2.8 for the full list and §2.3.3 for the field-by-field audit.
//!
//! # Three of the enums are shared, and that is checked
//!
//! [`NodeKind`], [`JunctionControl`] and [`UnsignalizedRule`] are Zukai's own,
//! reused rather than redeclared: every variant produces Assimilator's exact
//! wire spelling, verified value by value (spec §2.1).
//! `the_shared_enums_spell_what_assimilator_spells` is what keeps that true —
//! drift on either side fails a test rather than silently writing a foreign file.
//!
//! [`MovementKind`] is the fourth and is **declared here**, which is the shape
//! of the coupling rather than an exception to it. It was a model type while a
//! `Junction` recorded the turns through it; a junction says its turns with
//! paint on the approach now (lane arrows Phase 4), so the only thing left that
//! names a turn this way is the file being read, and the vocabulary belongs to
//! the mirror that reads it.

use serde::{Deserialize, Serialize};

use crate::model::graph::{JunctionControl, NodeKind, UnsignalizedRule};
use crate::model::ids::{LaneIdx, LinkId, MovementId, NodeId};
use crate::model::layout::Vec2;

pub mod import;

/// The `schema_version` this build of Zukai can read.
///
/// A **copy** of Assimilator's `CURRENT_SCHEMA_VERSION`
/// (`crates/config/src/version.rs:34`), read at commit `d79c32d` on 2026-07-26 —
/// not a derivation, and the one number here that can rot silently. When
/// Assimilator bumps it, this has to move by hand or Zukai starts refusing files
/// it could read.
const ASSIMILATOR_SCHEMA_VERSION: u32 = 1;

/// Canvas units per model metre.
///
/// A hand-mirror of the frontend's `UNITS_PER_METRE`
/// (`src/editor/geometry.ts`), which is pinned to `LANE_PX / DEFAULT_LANE_WIDTH`
/// = `9 / 3.5`. Written out rather than derived because Rust has neither
/// constant: `LANE_PX` is a rendering number that never crosses IPC, and the
/// lane width is a `fn` behind `#[serde(default = "…")]`. Keep the arithmetic
/// literal so the two spell the same thing.
pub const UNITS_PER_METRE: f64 = 9.0 / 3.5;

/// How wide a fitted import is drawn, in canvas units.
///
/// The longest side of a network's bounding box is laid out across this much
/// canvas, and no more (see [`layout_factor`]). **Calibrated against both
/// committed fixtures rather than chosen freely**: at 500 units `t_junction`
/// (1000 m across) takes a factor of 0.5 and `cross-4` (200 m) takes 2.5, so
/// each lands a 250-unit arm against a 9-unit lane — 27.8 lane-widths, and the
/// fixture that already read well moves by 2.8%.
///
/// The clamp in [`layout_factor`] binds only below an extent of
/// `LAYOUT_EXTENT / UNITS_PER_METRE` ≈ 194.4 m.
const LAYOUT_EXTENT: f64 = 500.0;

/// A parsed `network.yaml`.
///
/// Mirrors Assimilator's `NetworkConfig` (`network.rs:333-356`). `metadata`,
/// `nodes` and `links` are required there and here; `junctions` defaults. The
/// four dropped top-level blocks are named in this module's docs.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetworkFile {
    /// Network-level metadata.
    pub metadata: NetworkMetadata,
    /// Every node: endpoints, junctions, waypoints.
    pub nodes: Vec<NetworkNode>,
    /// Every directed link.
    pub links: Vec<NetworkLink>,
    /// Junction definitions, one per node of type `junction`.
    #[serde(default)]
    pub junctions: Vec<NetworkJunction>,
}

/// Mirrors `NetworkMetadata` (`network.rs:667-689`).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetworkMetadata {
    /// Human-readable network name.
    pub name: String,
    /// Optional author.
    #[serde(default)]
    pub author: Option<String>,
    /// Coordinate system; must be `metric`, which is also its default — so an
    /// *absent* key already reads as metric and must never be rejected.
    #[serde(default = "default_coordinate_system")]
    pub coordinate_system: String,
    /// Whether z-coordinates are meaningful. Zukai has no elevation, so a file
    /// with real z comes back flat (spec §2.3.3, stated rather than inferred).
    #[serde(default)]
    pub z_enabled: bool,
    /// Map projection origin as `[longitude, latitude]`. Zukai has no projection.
    #[serde(default)]
    pub map_origin: Option<[f64; 2]>,
}

/// Mirrors `NodeConfigRepr` (`network.rs:719-733`) — the *wire* form of
/// Assimilator's node, whose in-memory twin splits `x`/`y`.
///
/// `point` is a two-element array rather than two keys, and Assimilator's own
/// doc says why: **a bare `y:` mapping key is coerced to the boolean `true`
/// under YAML 1.1**, which forced an ugly `'y':` quoting. Assimilator needs a
/// two-struct `from`/`into` trick to keep ergonomic `x`/`y` fields in memory;
/// this mirror has no `y:` key to be coerced and so needs no trick. Carry the
/// reason, not the pattern.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetworkNode {
    /// Stable id, preserved verbatim through import and export.
    pub id: NodeId,
    /// Position as `[x, y]`, metres, in a frame whose y grows **up**.
    pub point: [f64; 2],
    /// Elevation, metres. Read and dropped — Zukai has no elevation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z: Option<f64>,
    /// Node classification.
    #[serde(rename = "type")]
    pub kind: NodeKind,
}

/// Mirrors `LinkConfig` (`network.rs:772-820`).
///
/// `anchors` and `curve_control_points` are Assimilator's spline form and are
/// deliberately absent: a curve Zukai cannot draw is a curve Zukai should not
/// claim to carry (spec §2.8).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetworkLink {
    /// Stable id.
    pub id: LinkId,
    /// Upstream node.
    pub from_node: NodeId,
    /// Downstream node.
    pub to_node: NodeId,
    /// Shape as `[x, y]` pairs in metres; at least 2 points. Discarded on
    /// import — the founding claim of the whole project.
    pub geometry: Vec<[f64; 2]>,
    /// Lateral shift of the centreline, metres, positive to the right.
    /// Assimilator applies this itself, so it is a *value*, never baked into
    /// `geometry`.
    #[serde(default)]
    pub lateral_offset: f64,
    /// Full median width between a bidirectional pair, metres. Assimilator
    /// offsets each link by half of it, so this too is a value rather than a
    /// shift already applied to the polyline.
    #[serde(default = "default_median_gap")]
    pub median_gap: f64,
    /// Lanes, ordered by index.
    pub lanes: Vec<NetworkLane>,
}

/// Mirrors `LaneConfig` (`network.rs:871-904`).
///
/// `no_change_left`, `no_change_right` and `gap_after` are dropped, and the cost
/// is real: a file prohibiting a lane change comes back permitting it. Accepted
/// rather than hidden, because Zukai has no lane-change concept to attach them
/// to (spec §2.3.3).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetworkLane {
    /// 0-based lane index.
    pub id: LaneIdx,
    /// Lane width, metres. **Required** — Assimilator has no default for it.
    pub width: f64,
    /// Speed limit, m/s. **Required**, same reason.
    pub speed_limit: f64,
    /// Vehicle classes permitted; empty means all.
    #[serde(default)]
    pub allowed_classes: Vec<String>,
}

/// Mirrors `JunctionConfig` (`network.rs:969-1045`).
///
/// The ten simulation-only fields (`conflict_pairs`, `gap_acceptance`,
/// `collision_avoidance`, `conflict_model`, `b_amber`, `enforce_entry_guards`,
/// `stop_time`, `stop_line_offsets`, `arms`, `geometry`) and the per-junction
/// `crossings` are all `#[serde(default)]` there, so omitting them is legal.
/// `crate::model::graph` has recorded them as deliberately omitted since the
/// first commit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetworkJunction {
    /// The junction node this controls.
    pub node_id: NodeId,
    /// Signalized or unsignalized.
    pub control: JunctionControl,
    /// Right-of-way rule; only meaningful when unsignalized.
    #[serde(default)]
    pub rule: Option<UnsignalizedRule>,
    /// Permitted turn movements.
    #[serde(default)]
    pub movements: Vec<NetworkMovement>,
}

/// Mirrors `MovementConfig` (`network.rs:1334-1378`), less most of what it says
/// about lanes.
///
/// `turn_speed` and `control_points` are dropped because both are tuned against
/// real geometry and Zukai's radii are schematic fictions. `to_lanes`,
/// `priority`, `yields_to` and `lane_mapping` are dropped for a different
/// reason: **nothing draws them.** They were mirrored while Zukai still wrote
/// this format back out, so that a round trip could survive them; with the
/// export cut there is no round trip, and a schematic shows *that* a turn is
/// permitted rather than which lane feeds which.
///
/// Dropping them is safe on the read side — serde ignores unknown keys unless
/// told otherwise, so a real `network.yaml` carrying all four still parses.
///
/// **`from_lanes` is the exception, and it is read rather than carried.** It
/// says which lanes of an approach feed a turn, which is exactly what a painted
/// lane arrow says, so `import::lane_arrows` converts it to paint on the way in
/// and nothing stores it — the read-only mirror's cleanest case
/// (`specs/lane_arrows_spec.md` §2.5).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetworkMovement {
    /// Stable id, unique within the junction.
    pub id: MovementId,
    /// Approach link; its `to_node` is the junction node.
    pub from_link: LinkId,
    /// Exit link; its `from_node` is the junction node.
    pub to_link: LinkId,
    /// Turn category. Defaults to `through`, which is Assimilator's shape and
    /// not [`MovementKind`]'s own — the mirror rule, in one field.
    #[serde(default = "default_movement_kind", rename = "type")]
    pub kind: MovementKind,
    /// Lanes of [`from_link`](Self::from_link) this turn may be taken from,
    /// **in Assimilator's numbering** — `0` is the median lane, the opposite of
    /// Zukai's (see `import::kerb_lane`).
    ///
    /// Assimilator declares this required (`network.rs:1347`) and this module's
    /// rule is that optionality follows Assimilator's, so the `#[serde(default)]`
    /// is a deliberate departure. That rule existed to guarantee faithful
    /// *writing*: a movement Zukai could not reproduce byte-for-byte was a bug
    /// while an export existed, and the export is gone. An absent key takes the
    /// same path as an empty list — it paints nothing — and
    /// `the_lane_and_priority_keys_are_ignored_either_way` pins that a bare
    /// movement still parses.
    #[serde(default)]
    pub from_lanes: Vec<LaneIdx>,
}

/// Turn category of a [`NetworkMovement`]. Matches Assimilator's movement
/// `type`.
///
/// **This lives here rather than in `model::graph` because it is the file's
/// vocabulary, not the document's.** It was a model type while a `Junction`
/// recorded the turns through it; those are paint now (lane arrows Phase 4), so
/// the only thing that still names a turn this way is a `network.yaml` being
/// read. It reaches no `.zkai`, and `import::turn_direction` is the one place it
/// crosses into Zukai's own vocabulary.
///
/// **`u-turn`'s hyphen is Assimilator's spelling and must never be "fixed".**
/// The underscore belongs to
/// [`TurnDirection`](crate::model::decoration::TurnDirection), which is paint
/// and carries two slight-turn values this has no room for. One hyphen is the
/// whole difference on the wire, which is why
/// `the_shared_enums_spell_what_assimilator_spells` asserts it against a literal
/// lifted from the fixture.
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

/// Just enough of a `network.yaml` to read its version without committing to
/// [`NetworkFile`].
///
/// [`crate::persist::load_document`]'s probe with one difference that is
/// load-bearing: the field is an `Option`. Assimilator reads this header *above*
/// serde and strips it, and its own demo scenarios predate the stamping — both
/// committed fixtures start at `metadata:`. A probe demanding the key would
/// reject the very files this module exists to read.
#[derive(Deserialize)]
struct VersionProbe {
    #[serde(default)]
    schema_version: Option<u32>,
}

/// Parse a `network.yaml`, checking its schema version first.
///
/// Absent, `0` and `1` are accepted; anything higher is rejected with a message
/// naming the version, rather than an arbitrary field error from deep inside
/// [`NetworkFile`]. That mirrors Assimilator's own `classify` policy against
/// `CURRENT_SCHEMA_VERSION`, minus its `TooOld` arm, which cannot occur while
/// that constant is 1.
///
/// The header needs no stripping: nothing here derives `deny_unknown_fields`, so
/// the full parse simply ignores it — which is also why every dropped block
/// (`detectors`, `stops`, `conflict_pairs`, …) passes through untouched.
pub fn parse_network(text: &str) -> Result<NetworkFile, String> {
    let probe: VersionProbe = serde_yaml::from_str(text).map_err(|e| e.to_string())?;
    if let Some(version) = probe.schema_version {
        if version > ASSIMILATOR_SCHEMA_VERSION {
            return Err(format!(
                "This network.yaml is schema version {version}; this build of Zukai reads \
                 up to {ASSIMILATOR_SCHEMA_VERSION}. Please update Zukai to import it."
            ));
        }
    }
    serde_yaml::from_str(text).map_err(|e| e.to_string())
}

/// Assimilator's metric frame → Zukai's canvas frame, at the scale the caller
/// names.
///
/// Scale by `units_per_metre` and **negate y**: SVG's y grows *down* while the
/// metric frame's grows *up*, so a node 300 m **south** of the origin arrives at
/// a **positive** canvas y. Getting this wrong mirrors the whole network, which
/// is self-consistent, silently wrong, and passes any test written from the same
/// premise — hence the tests name compass bearings rather than signs.
///
/// **The scale is the caller's and the negation is not.** Pass
/// [`UNITS_PER_METRE`] for a true-to-life conversion; import passes
/// [`layout_factor`]'s fitted answer instead, because a node has to arrive where
/// it reads well rather than where it is (spec §2.6.1). The y-negation has
/// exactly one home either way, which is this line.
///
/// **The `+ 0.0` is not noise: it is what stops the negation minting `-0.0`.**
/// A node on the metric x-axis has `point[1] == 0.0`, and negating that yields
/// a signed zero that means nothing on a canvas and does not survive a trip
/// through JavaScript — `JSON.stringify(-0)` is `"0"`, so the file said `-0.0`
/// and every host that reopened and resaved it wrote `0.0`. That is true of the
/// desktop too, whose IPC marshals through JSON exactly as the wasm shell does;
/// the browser's byte-identity golden is simply what finally noticed. IEEE 754
/// makes `-0.0 + 0.0` positive zero and leaves every other value alone.
pub fn metres_to_canvas(point: [f64; 2], units_per_metre: f64) -> Vec2 {
    Vec2::new(
        point[0] * units_per_metre + 0.0,
        -point[1] * units_per_metre + 0.0,
    )
}

/// The canvas units per metre this network's **nodes are placed at** — fit the
/// bounding box, and never enlarge.
///
/// Import lays out for legibility rather than for fidelity. At true scale a
/// 500 m arm is 1285 units against a 9-unit lane, which is 143 lane-widths of
/// road and not a drawing anybody wants to drag into shape; fitting the longest
/// side of the box into [`LAYOUT_EXTENT`] puts it at 28 instead.
///
/// **The clamp is what makes the rule one-directional**, and it is the part that
/// collapsed a fork this spec argued over for weeks: import shrinks a network
/// that does not fit and leaves every smaller one at true scale, so a 50 m slip
/// road stays 50 m of road rather than inflating to 56 lane-widths from the
/// other side.
///
/// **The extent is the longer side, not both.** A network whose nodes are
/// collinear has a box with one side of zero, and a factor built from that side
/// divides by it.
///
/// **Three degenerate inputs and one guard.** No nodes has no box, one node has
/// a box of zero size, and so does any number of nodes at one point — each makes
/// `fitted` non-finite or zero, and all three fall back to true scale. All three
/// reach here today, because import does not validate what Assimilator wrote.
///
/// Nothing stores this. The document records the resulting *positions*, the way
/// a `.zkai` always has, so no reader can ask what scale a drawing is at — which
/// is correct rather than regrettable, the drawing making no scale claim and
/// `Link::length` carrying the truth about the road.
fn layout_factor(nodes: &[NetworkNode]) -> f64 {
    let mut min = [f64::INFINITY; 2];
    let mut max = [f64::NEG_INFINITY; 2];
    for node in nodes {
        for axis in 0..2 {
            min[axis] = min[axis].min(node.point[axis]);
            max[axis] = max[axis].max(node.point[axis]);
        }
    }

    let extent = (max[0] - min[0]).max(max[1] - min[1]);
    let fitted = LAYOUT_EXTENT / extent;
    if fitted.is_finite() && fitted > 0.0 {
        fitted.min(UNITS_PER_METRE)
    } else {
        UNITS_PER_METRE
    }
}

fn default_coordinate_system() -> String {
    "metric".to_string()
}

fn default_median_gap() -> f64 {
    0.5
}

fn default_movement_kind() -> MovementKind {
    MovementKind::Through
}

/// `t_junction`, copied from Assimilator's own demo scenarios. See the README
/// beside it.
#[cfg(test)]
pub(crate) const T_JUNCTION: &str = include_str!("../../tests/fixtures/network/t_junction.yaml");

/// `cross-4`, the signalized fixture.
#[cfg(test)]
pub(crate) const CROSS_4: &str = include_str!("../../tests/fixtures/network/cross-4.yaml");

#[cfg(test)]
mod tests {
    use super::*;

    /// Both fixtures parse, at the counts the files actually carry — read off
    /// them rather than assumed, so a refreshed fixture fails here first.
    #[test]
    fn both_fixtures_parse() {
        let t = parse_network(T_JUNCTION).expect("t_junction parses");
        assert_eq!(t.nodes.len(), 4);
        assert_eq!(t.links.len(), 3);
        assert_eq!(t.junctions.len(), 1);
        assert_eq!(t.junctions[0].movements.len(), 2);

        let c = parse_network(CROSS_4).expect("cross-4 parses");
        assert_eq!(c.nodes.len(), 5);
        assert_eq!(c.links.len(), 8);
        assert_eq!(c.junctions.len(), 1);
        assert_eq!(c.junctions[0].movements.len(), 16);
    }

    /// The "absent → accept" arm is not leniency, it is the only arm the
    /// committed fixtures exercise: both start at `metadata:`.
    #[test]
    fn a_file_with_no_schema_version_parses() {
        assert!(!T_JUNCTION.contains("schema_version"));
        assert!(!CROSS_4.contains("schema_version"));

        parse_network(T_JUNCTION).expect("no header is not an error");
    }

    #[test]
    fn a_newer_schema_version_is_rejected_by_number() {
        let stamped = format!("schema_version: 99\n{T_JUNCTION}");

        let err = parse_network(&stamped).expect_err("schema version 99 must be refused");

        assert!(err.contains("99"), "message should name the version: {err}");
        assert!(err.contains('1'), "message should name what we read: {err}");
    }

    /// `0` is Assimilator's own "legacy, unstamped" value and `1` is current;
    /// both are files this build can read.
    #[test]
    fn schema_versions_zero_and_one_are_accepted() {
        for version in [0, 1] {
            let stamped = format!("schema_version: {version}\n{T_JUNCTION}");
            parse_network(&stamped).unwrap_or_else(|e| panic!("version {version} rejected: {e}"));
        }
    }

    /// The enums are Zukai's, reused rather than redeclared, on the claim that
    /// every variant already spells what Assimilator spells. This is the check
    /// that keeps the claim true — including `u-turn`'s hyphen, which is
    /// Assimilator's spelling and must never be "fixed" to `u_turn`.
    #[test]
    fn the_shared_enums_spell_what_assimilator_spells() {
        let t = parse_network(T_JUNCTION).expect("parse");
        assert!(T_JUNCTION.contains("type: endpoint"));
        assert!(T_JUNCTION.contains("type: junction"));
        assert_eq!(t.nodes[0].kind, NodeKind::Endpoint);
        assert_eq!(t.nodes[1].kind, NodeKind::Junction);

        assert!(T_JUNCTION.contains("control: unsignalized"));
        assert!(T_JUNCTION.contains("rule: priority"));
        assert_eq!(t.junctions[0].control, JunctionControl::Unsignalized);
        assert_eq!(t.junctions[0].rule, Some(UnsignalizedRule::Priority));
        assert_eq!(t.junctions[0].movements[0].kind, MovementKind::Through);

        let c = parse_network(CROSS_4).expect("parse");
        assert!(CROSS_4.contains("type: u-turn"));
        assert!(!CROSS_4.contains("u_turn"));
        assert!(c.junctions[0]
            .movements
            .iter()
            .any(|m| m.kind == MovementKind::UTurn));
        assert_eq!(c.junctions[0].control, JunctionControl::Signal);

        // The two remaining rule spellings appear on no fixture, so they are
        // pinned against literals instead.
        let rule: UnsignalizedRule = serde_yaml::from_str("priority_right").expect("parse");
        assert_eq!(rule, UnsignalizedRule::PriorityRight);
        let rule: UnsignalizedRule = serde_yaml::from_str("all_way_stop").expect("parse");
        assert_eq!(rule, UnsignalizedRule::AllWayStop);
        let kind: NodeKind = serde_yaml::from_str("waypoint").expect("parse");
        assert_eq!(kind, NodeKind::Waypoint);
    }

    /// A movement omitting `type:` is legal in Assimilator and must be legal
    /// here — the mirror rule's own example. Neither fixture catches it, since
    /// both write `type:` on every movement.
    #[test]
    fn a_movement_without_a_type_reads_as_through() {
        let yaml = "id: M1\nfrom_link: L1\nto_link: L2\nfrom_lanes: []\nto_lanes: []\n";

        let movement: NetworkMovement = serde_yaml::from_str(yaml).expect("deserialize");

        assert_eq!(movement.kind, MovementKind::Through);
    }

    /// The lane and right-of-way keys are no longer mirrored, and this is the
    /// assertion that dropping them cannot break a real file: serde ignores an
    /// unknown key, so a movement carrying all five still parses — and so does
    /// one carrying none.
    ///
    /// It replaces `a_movement_without_from_lanes_fails_to_parse`, which pinned
    /// the opposite rule for a reason that has gone: an absent `from_lanes` had
    /// to fail *because Zukai wrote this format back out*, and a file it could
    /// not reproduce faithfully was a bug. Nothing writes it now.
    #[test]
    fn the_lane_and_priority_keys_are_ignored_either_way() {
        let full = concat!(
            "id: M1\nfrom_link: L1\nto_link: L2\n",
            "from_lanes:\n- 0\nto_lanes:\n- 0\ntype: through\n",
            "priority: minor\nyields_to:\n- M2\nlane_mapping:\n- from: 0\n  to: 0\n",
        );
        let bare = "id: M1\nfrom_link: L1\nto_link: L2\ntype: through\n";

        for yaml in [full, bare] {
            let movement: NetworkMovement = serde_yaml::from_str(yaml).expect("deserialize");
            assert_eq!(movement.id.as_str(), "M1");
            assert_eq!(movement.kind, MovementKind::Through);
        }
    }

    /// The fixture's south node is at `[500, -300]`: 500 m east and 300 m
    /// **south** of the origin. South is `+y` on the canvas, so the sign flips.
    ///
    /// The scale passed here is the true one, which is what makes this the
    /// converter's own test rather than the layout's: what it asserts did not
    /// change when the factor became the caller's (spec §2.6.1).
    #[test]
    fn a_node_300_metres_south_lands_at_a_positive_canvas_y() {
        let south = metres_to_canvas([500.0, -300.0], UNITS_PER_METRE);

        assert_eq!(south.x, 500.0 * UNITS_PER_METRE);
        assert_eq!(south.y, 300.0 * UNITS_PER_METRE);
        assert!(south.y > 0.0, "south must be positive-y on the canvas");

        // ...and a node north of the origin lands above it.
        assert!(metres_to_canvas([0.0, 300.0], UNITS_PER_METRE).y < 0.0);
    }

    /// A network of bare nodes at the given metric points — everything
    /// [`layout_factor`] reads, and nothing it does not.
    fn nodes_at(points: &[[f64; 2]]) -> Vec<NetworkNode> {
        points
            .iter()
            .enumerate()
            .map(|(index, &point)| NetworkNode {
                id: format!("N{index}").into(),
                point,
                z: None,
                kind: NodeKind::Endpoint,
            })
            .collect()
    }

    /// The factor fits the **longer** side of the box, and the two committed
    /// fixtures are what calibrate it: 1000 m across takes 0.5, 200 m takes 2.5,
    /// and each puts its own arm at 250 canvas units.
    ///
    /// The third case is the one no fixture can stand in for. `cross-4`'s box is
    /// **square**, so it cannot tell `max` from `min` at all; `t_junction`'s
    /// (1000 × 300) can, and a `min` there gives 1.667 rather than 0.5. Neither
    /// exercises a side of **zero**, which is what a collinear network has and
    /// what a `min` would divide by.
    #[test]
    fn the_factor_fits_the_longer_side() {
        let t = parse_network(T_JUNCTION).expect("parse");
        assert_eq!(layout_factor(&t.nodes), 0.5);

        let c = parse_network(CROSS_4).expect("parse");
        assert_eq!(layout_factor(&c.nodes), 2.5);

        // 1000 m of road along one axis, and no height at all.
        let collinear = nodes_at(&[[0.0, 0.0], [400.0, 0.0], [1000.0, 0.0]]);
        assert_eq!(layout_factor(&collinear), 0.5);
    }

    /// Three networks with no bounding box to speak of, all of which reach
    /// [`import::network_to_document`] today — import does not validate what
    /// Assimilator wrote. Each falls back to true scale rather than panicking or
    /// placing every node at `NaN`.
    #[test]
    fn three_degenerate_networks_place_at_true_scale() {
        let none: Vec<NetworkNode> = Vec::new();
        assert_eq!(layout_factor(&none), UNITS_PER_METRE);

        let one = nodes_at(&[[7.0, -7.0]]);
        assert_eq!(layout_factor(&one), UNITS_PER_METRE);

        let stacked = nodes_at(&[[7.0, -7.0], [7.0, -7.0]]);
        assert_eq!(layout_factor(&stacked), UNITS_PER_METRE);
    }

    /// Pinned against the frontend's own derivation rather than a rounded
    /// literal: `LANE_PX / DEFAULT_LANE_WIDTH`, the peg `geometry.test.ts`
    /// asserts on the other side.
    #[test]
    fn the_scale_is_a_lane_width_of_default_lanes() {
        assert_eq!(UNITS_PER_METRE, 9.0 / 3.5);
        assert_eq!(3.5 * UNITS_PER_METRE, 9.0);
    }
}
