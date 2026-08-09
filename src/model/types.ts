/**
 * TypeScript mirror of the Rust document model in `src-tauri/src/model`.
 *
 * The string-literal unions below match serde's `snake_case` output exactly, so
 * a document built here serializes to the same YAML the Rust side reads. Until
 * we generate these from Rust, keep the two in sync by hand.
 */

// ----- ids -----

/** Stable id of a node, preserved across Assimilator import/export. */
export type NodeId = string;
/** Stable id of a link. */
export type LinkId = string;
/** Stable id of a sign. */
export type SignId = string;
/** Stable id of a marking. */
export type MarkingId = string;
/** 0-based lane index within a link. */
export type LaneIdx = number;

// ----- semantic graph (exportable to Assimilator) -----

/** A road end, an intersection, or a mid-road shape change. */
export type NodeKind = "endpoint" | "junction" | "waypoint";

/** A vertex of the road graph. */
export interface Node {
  id: NodeId;
  type: NodeKind;
}

/** Optional schematic classification of a lane, for rendering only. */
export type LaneKind = "general" | "bus" | "shoulder" | "turn" | "cycle";

/** A single lane within a link. */
export interface Lane {
  id: LaneIdx;
  width: number;
  speed_limit: number;
  allowed_classes?: string[];
  kind?: LaneKind;
}

/** A directed road segment carrying one or more lanes. */
export interface Link {
  id: LinkId;
  from_node: NodeId;
  to_node: NodeId;
  lanes: Lane[];
  median_gap: number;
  /**
   * How long the road really is, metres — an annotation the human owns, not a
   * measurement of the drawing. Absent means the road states no length; Rust
   * elides the key for such a link.
   */
  length?: number;
}

/** How a junction is controlled. */
export type JunctionControl = "signal" | "unsignalized";

/** Right-of-way rule for an unsignalized junction. */
export type UnsignalizedRule = "priority" | "priority_right" | "all_way_stop";

/**
 * The intersection attached to a junction-kind node.
 *
 * **Which turns it permits is not recorded here.** A junction's turns are said
 * with paint on the approach — a `turn_arrow` marking per lane — rather than
 * with a relation in the model, because an arrow is what the road tells a
 * driver and it is the only one of the two that prints (lane arrows §2.1). The
 * `movements` field that used to sit here is gone, and an older `.zkai`
 * carrying one still loads: serde ignores the key.
 */
export interface Junction {
  node_id: NodeId;
  control: JunctionControl;
  rule?: UnsignalizedRule;
}

// ----- decorations (Zukai-native, never exported) -----

/** Arrow direction for a turn-arrow marking. */
export type TurnDirection =
  | "through"
  | "left"
  | "right"
  | "slight_left"
  | "slight_right"
  | "u_turn";

/** Appearance of a longitudinal lane line. */
export type LineStyle = "solid" | "dashed" | "double";

/** What is painted on the road surface. Internally tagged by `type`. */
export type MarkingKind =
  | {
      type: "turn_arrow";
      directions: TurnDirection[];
      /**
       * Directions painted at the **upstream** end, pointing upstream — a head
       * at each end, for a lane carrying traffic both ways (a two-way left-turn
       * lane is the case that earns it). Absent is a single-headed arrow, which
       * is what Rust's elision of an empty `Vec` produces. Nothing imports one:
       * `network.yaml` has no per-lane direction at all.
       */
      back?: TurnDirection[];
    }
  | { type: "stop_line" }
  | { type: "give_way_line" }
  | { type: "crosswalk" }
  | { type: "hatching" }
  | { type: "text"; content: string }
  | { type: "lane_line"; style: LineStyle };

/**
 * Which end of a link a marking's `position` is measured from — `end` is the
 * link's `to_node`, so the paint holds its distance from the junction a road
 * arrives at however the road's drawn length changes.
 */
export type LinkEnd = "start" | "end";

/** A painted road-surface marking anchored to a link. */
export interface Marking {
  id: MarkingId;
  link: LinkId;
  /** Metres from the end named by `anchor`. */
  position: number;
  /** Absent means `start`; Rust elides the key for a start-anchored marking. */
  anchor?: LinkEnd;
  lane?: LaneIdx;
  kind: MarkingKind;
}

/** What a roadside sign says. Internally tagged by `type`. */
export type SignKind =
  | { type: "speed_limit"; kph: number }
  | { type: "warning"; symbol: string }
  | { type: "priority" }
  | { type: "give_way" }
  | { type: "stop" }
  | { type: "no_entry" }
  | { type: "direction"; text: string }
  | { type: "custom"; label: string };

/** A roadside sign; its canvas position lives in the layout. */
export interface Sign {
  id: SignId;
  kind: SignKind;
  associated_link?: LinkId;
}

// ----- presentation (stripped on export) -----

/** A 2-D point in abstract canvas space. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Road class of a link, a rendering hint only. */
export type LinkStyle = "motorway" | "arterial" | "local" | "ramp";

/**
 * Which of a link's own edges stays put on its polyline — `centre` (the
 * default) draws the road centred on it, as every road was drawn before this
 * existed. Aligning to an edge is what lets two links of different widths meet
 * at a node sharing that edge, which is what a lane drop looks like.
 */
export type LinkAlign = "centre" | "nearside" | "offside";

/** The symbol used to render a junction. */
export type JunctionGlyph =
  | "generic"
  | "roundabout"
  | "signalized_cross"
  | "priority_cross"
  | "t_junction"
  | "gore";

/** Where a node sits on the canvas. */
export interface NodeView {
  pos: Vec2;
}

/** How a link is drawn and routed. */
export interface LinkView {
  style: LinkStyle;
  /** Absent means `centre`; Rust elides the key for a centred link. */
  align?: LinkAlign;
  bends?: Vec2[];
}

/** How a junction node is drawn. */
export interface JunctionView {
  glyph: JunctionGlyph;
  rotation: number;
  scale: number;
}

/** All presentation state, keyed by semantic entity id. */
export interface Layout {
  nodes: Record<NodeId, NodeView>;
  links: Record<LinkId, LinkView>;
  junctions: Record<NodeId, JunctionView>;
  signs: Record<SignId, Vec2>;
}

// ----- document -----

/** Descriptive metadata about a document. */
export interface Metadata {
  name: string;
  author?: string;
}

/** A complete schematic: semantic graph, its presentation, and decorations. */
export interface Document {
  schema_version: number;
  metadata: Metadata;
  nodes: Node[];
  links: Link[];
  junctions: Junction[];
  layout: Layout;
  markings: Marking[];
  signs: Sign[];
}

/**
 * Current Zukai document schema version (matches the Rust `SCHEMA_VERSION` —
 * the two must move together).
 *
 * 2 since the `gore` junction glyph: a new *field* costs no bump, but a new
 * enum **variant** does. An older build fails to deserialize the whole document
 * on an unknown variant, and `persist.rs`'s probe can only turn that into a
 * readable message if the version moves with it.
 */
export const SCHEMA_VERSION = 2;
