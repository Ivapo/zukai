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
    /// Rendering style and routing per link.
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
}

/// How a link is drawn and routed on the canvas.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LinkView {
    /// Road class, driving stroke width/colour.
    #[serde(default)]
    pub style: LinkStyle,
    /// Which of the link's own edges stays put on its polyline.
    ///
    /// Elided when centred, so a document that has never set an alignment
    /// serializes byte-for-byte as it did before the field existed. `bends`'
    /// `Vec::is_empty` trick has no equivalent for a plain enum, hence
    /// [`LinkAlign::is_centre`].
    #[serde(default, skip_serializing_if = "LinkAlign::is_centre")]
    pub align: LinkAlign,
    /// Intermediate waypoints the link bends through, between its end nodes.
    /// Empty draws a straight connector. This is what lets a schematic route a
    /// road cleanly regardless of the real geometry.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bends: Vec<Vec2>,
}

/// Which of a link's own edges stays put on its polyline.
///
/// Presentation, not topology: Assimilator's links carry real polylines, from
/// which alignment is a *consequence* rather than an input, so a field in
/// [`graph`](super::graph) would be a Zukai-native concept in the layer whose
/// whole promise is a 1:1 `network.yaml` mapping. It is what lets two links of
/// different widths meet at a node sharing an **edge** instead of a centre —
/// which is what a lane drop looks like on a real road.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkAlign {
    /// Drawn centred on its polyline (the default, and every older document).
    #[default]
    Centre,
    /// The nearside (kerb-side) edge of the lane region stays on the polyline.
    Nearside,
    /// The offside edge of the lane region stays on the polyline.
    Offside,
}

impl LinkAlign {
    /// Whether this is the default centre alignment — the `skip_serializing_if`
    /// predicate for [`LinkView::align`].
    fn is_centre(&self) -> bool {
        matches!(self, Self::Centre)
    }
}

/// Road class of a link, a rendering hint only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkStyle {
    /// Grade-separated motorway / freeway.
    Motorway,
    /// Major urban road (the default).
    #[default]
    Arterial,
    /// Minor / local street.
    Local,
    /// On/off ramp or slip road.
    Ramp,
}

/// How a junction node is drawn. This is the render hint that turns a plain
/// graph junction into a recognizable symbol; the arms are the links incident
/// to the node, so no glyph needs to own its geometry.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct JunctionView {
    /// Which symbol to draw.
    #[serde(default)]
    pub glyph: JunctionGlyph,
    /// Rotation applied to the glyph, degrees.
    #[serde(default)]
    pub rotation: f64,
    /// Uniform scale applied to the glyph.
    #[serde(default = "default_scale")]
    pub scale: f64,
}

impl Default for JunctionView {
    fn default() -> Self {
        Self {
            glyph: JunctionGlyph::default(),
            rotation: 0.0,
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
    /// Three-arm T-junction.
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

    /// A link view carrying the given alignment and nothing else unusual.
    fn view(align: LinkAlign) -> LinkView {
        LinkView {
            style: LinkStyle::Motorway,
            align,
            bends: Vec::new(),
        }
    }

    #[test]
    fn an_alignment_survives_a_yaml_round_trip() {
        for align in [LinkAlign::Nearside, LinkAlign::Offside] {
            let yaml = serde_yaml::to_string(&view(align)).expect("serialize");
            let back: LinkView = serde_yaml::from_str(&yaml).expect("deserialize");
            assert_eq!(view(align), back);
        }
        // …written in the same snake_case the TypeScript mirror spells.
        assert!(serde_yaml::to_string(&view(LinkAlign::Offside))
            .expect("serialize")
            .contains("align: offside"));
    }

    /// The whole point of the `skip_serializing_if` predicate: a document that
    /// has never set an alignment must save exactly as it did before the field
    /// existed, so adding it needs no `SCHEMA_VERSION` bump.
    #[test]
    fn a_centred_link_writes_no_align_key_at_all() {
        let yaml = serde_yaml::to_string(&view(LinkAlign::Centre)).expect("serialize");

        assert!(!yaml.contains("align"), "unexpected align key in {yaml:?}");
    }

    #[test]
    fn a_file_without_the_field_loads_as_centre() {
        let view: LinkView = serde_yaml::from_str("style: motorway\n").expect("deserialize");

        assert_eq!(view.align, LinkAlign::Centre);
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
