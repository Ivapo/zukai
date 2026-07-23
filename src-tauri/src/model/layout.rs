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
    /// Intermediate waypoints the link bends through, between its end nodes.
    /// Empty draws a straight connector. This is what lets a schematic route a
    /// road cleanly regardless of the real geometry.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bends: Vec<Vec2>,
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
}

fn default_scale() -> f64 {
    1.0
}
