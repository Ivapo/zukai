//! The presentation layer — where things sit on the canvas and how they are
//! drawn. This is the half of a Zukai document that has **no** meaning to
//! Assimilator: export omits it entirely, and import re-generates it (seeding
//! positions from a naive layout so the user never starts from a blank canvas).
//!
//! Layout is stored as id-keyed maps parallel to the [`graph`](super::graph),
//! rather than inline on each node/link, so the semantic graph stays literally
//! geometry-free and the two layers can be serialized and reasoned about
//! independently. A missing entry is not an error — the renderer falls back to
//! an auto-placement — and an orphan entry (no matching graph entity) is
//! ignored. Coordinates are abstract canvas units, unrelated to Assimilator's
//! metres.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::ids::{LinkId, NodeId, SignId};

/// A 2-D point in abstract canvas space.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    /// Horizontal canvas coordinate.
    pub x: f64,
    /// Vertical canvas coordinate.
    pub y: f64,
}

impl Vec2 {
    /// A point at the given coordinates.
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// All presentation state for a document, keyed by semantic entity id.
///
/// `BTreeMap` (not `HashMap`) keeps serialization order stable so saved files
/// produce clean, reviewable diffs.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    /// Canvas placement per node.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub nodes: BTreeMap<NodeId, NodeView>,
    /// Routing per link — only for the links that carry one, so a plain straight
    /// road has no entry at all.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub links: BTreeMap<LinkId, LinkView>,
    /// Glyph choice per junction (keyed by the junction's node id).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub junctions: BTreeMap<NodeId, JunctionView>,
    /// Canvas placement per sign.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub signs: BTreeMap<SignId, Vec2>,
}

/// Where a node sits on the canvas.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct NodeView {
    /// Node position in canvas space.
    pub pos: Vec2,
    /// Which side a road's lanes change on where it runs through this node.
    ///
    /// Elided when `both`, so a document that has never stated a side
    /// serializes byte-for-byte as it did before the field existed — which is why
    /// it needs no `SCHEMA_VERSION` bump.
    #[serde(default, skip_serializing_if = "LaneChange::is_both")]
    pub lane_change: LaneChange,
}

/// Which side a road's lanes change on at a node, in the road's own travel
/// frame (ramps spec §2.13.1).
///
/// A fact about one place, so it lives on the node rather than on the two links
/// that meet there — two links stating one fact is how they come to disagree.
/// Presentation, not topology: Assimilator's links carry real polylines, from
/// which the side is a *consequence* rather than an input, so a field in
/// [`graph`](super::graph) would be a Zukai-native concept in the layer whose
/// whole promise is a 1:1 `network.yaml` mapping.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaneChange {
    /// The road stays centred and a change shows on both sides (the default,
    /// and every older document).
    #[default]
    Both,
    /// Lanes are added or dropped on the nearside; the offside edge runs on.
    Nearside,
    /// Lanes are added or dropped on the offside; the nearside edge runs on.
    Offside,
}

impl LaneChange {
    /// Whether this is the default — the `skip_serializing_if` predicate for
    /// [`NodeView::lane_change`].
    fn is_both(&self) -> bool {
        matches!(self, Self::Both)
    }
}

/// How a link is placed and routed on the canvas.
///
/// **There is deliberately no road class.** A `style` of four values drew two
/// looks, and the narrower one made lane count — the thing road width tells a
/// reader — ambiguous (road declutter §2.2). It left the way `rotation` left
/// [`JunctionView`]: nothing derives `deny_unknown_fields`, so an older file's
/// `style:` key is ignored on the way in and absent on the way out.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LinkView {
    /// Intermediate waypoints the link bends through, between its end nodes.
    /// Empty draws a straight connector. This is what lets a schematic route a
    /// road cleanly regardless of the real geometry.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bends: Vec<Vec2>,
}

/// How a junction node is drawn. This is the render hint that turns a plain
/// graph junction into a recognizable symbol; the arms are the links incident
/// to the node, so no glyph needs to own its geometry.
///
/// **There is deliberately no `rotation`.** One was declared in both mirrors from
/// the first commit, written only as zero, and read by nothing that draws — and
/// the pad following its arms is what made that permanent, since a shape derived
/// from the arms is already oriented by them (junction glyphs OQ-1). It was
/// removed in the same pass that retired [`JunctionGlyph::TJunction`], and cost
/// nothing to remove: nothing here derives `deny_unknown_fields`, so an older
/// file's `rotation:` key is ignored on the way in and absent on the way out.
/// That is the cheap direction — a removed *variant* is the expensive one.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct JunctionView {
    /// Which symbol to draw.
    #[serde(default)]
    pub glyph: JunctionGlyph,
    /// Uniform scale applied to the glyph.
    #[serde(default = "default_scale")]
    pub scale: f64,
}

impl Default for JunctionView {
    fn default() -> Self {
        Self {
            glyph: JunctionGlyph::default(),
            scale: 1.0,
        }
    }
}

/// The symbol used to render a junction.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JunctionGlyph {
    /// Plain intersection drawn from the incident arms. Import defaults to this;
    /// the user can upgrade it to a more specific glyph.
    #[default]
    Generic,
    /// Roundabout ring with the arms as spokes.
    Roundabout,
    /// Signalized crossroads.
    SignalizedCross,
    /// Priority (major/minor) crossroads.
    PriorityCross,
    /// **Load-only, and nothing constructs it.** A three-arm node draws as a T
    /// because it *has* three arms — the pad follows the roads that meet at it —
    /// so this variant named a fact the arms already carry, and a control that
    /// cannot change a pixel is a control that lies (junction glyphs §2.4). It
    /// survives here **only** so a `.zkai` written before the retirement still
    /// *parses*: removing a variant outright makes serde fail on the whole
    /// document, and `persist.rs`'s version probe cannot turn that into a
    /// readable message, since such a file declares an older-or-equal version.
    /// `load_document` maps it to [`JunctionGlyph::Generic`] on the way in, so
    /// the frontend — whose union no longer spells it — can never receive one.
    TJunction,
    /// The gore of a diverge or a merge: no pad at all, but the hatched
    /// triangle of paint between the two arms that separate. The pair is chosen
    /// by geometry rather than by traffic, so one variant covers both.
    Gore,
}

fn default_scale() -> f64 {
    1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A node view at the origin stating the given side and nothing else.
    fn view(lane_change: LaneChange) -> NodeView {
        NodeView {
            pos: Vec2::new(0.0, 0.0),
            lane_change,
        }
    }

    #[test]
    fn a_lane_change_survives_a_yaml_round_trip() {
        for side in [LaneChange::Nearside, LaneChange::Offside] {
            let yaml = serde_yaml::to_string(&view(side)).expect("serialize");
            let back: NodeView = serde_yaml::from_str(&yaml).expect("deserialize");
            assert_eq!(view(side), back);
        }
        // …written in the same snake_case the TypeScript mirror spells.
        assert!(serde_yaml::to_string(&view(LaneChange::Offside))
            .expect("serialize")
            .contains("lane_change: offside"));
    }

    /// The whole point of the `skip_serializing_if` predicate: a document that
    /// has never stated a side must save exactly as it did before the field
    /// existed, so adding it needs no `SCHEMA_VERSION` bump.
    #[test]
    fn a_both_node_writes_no_lane_change_key_at_all() {
        let yaml = serde_yaml::to_string(&view(LaneChange::Both)).expect("serialize");

        assert!(
            !yaml.contains("lane_change"),
            "unexpected lane_change key in {yaml:?}"
        );
    }

    #[test]
    fn a_file_without_the_field_loads_as_both() {
        let view: NodeView =
            serde_yaml::from_str("pos:\n  x: 1.0\n  y: 2.0\n").expect("deserialize");

        assert_eq!(view.lane_change, LaneChange::Both);
    }

    /// The glyph the `SCHEMA_VERSION` bump was for. Spelled in the same
    /// snake_case the TypeScript mirror uses, or a document built in the
    /// frontend serializes to YAML this side cannot read.
    #[test]
    fn the_gore_glyph_round_trips_as_snake_case() {
        let view = JunctionView {
            glyph: JunctionGlyph::Gore,
            ..JunctionView::default()
        };
        let yaml = serde_yaml::to_string(&view).expect("serialize");

        assert!(yaml.contains("glyph: gore"), "unexpected glyph in {yaml:?}");
        assert_eq!(
            view,
            serde_yaml::from_str::<JunctionView>(&yaml).expect("deserialize")
        );
    }
}
