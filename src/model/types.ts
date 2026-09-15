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
  | { type: "lane_line"; style: LineStyle }
  | { type: "bus_stop"; form: StopForm };

/**
 * Where a bus stop puts the bus: in the kerb lane, or pulled into a bay beside
 * it. A stop is always at the kerb, so a `bus_stop` ignores `Marking.lane`
 * (bus stops spec §2.4).
 */
export type StopForm = "in_lane" | "bay";

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

/**
 * Which side a road's lanes change on where it runs through a node, in the
 * road's own travel frame — `both` (the default) keeps the road centred, so a
 * change shows on each side, as every road was drawn before this existed.
 * `nearside` holds the offside edge straight through the node and `offside` the
 * nearside one (ramps spec §2.13.1).
 */
export type LaneChange = "both" | "nearside" | "offside";

/**
 * The symbol used to render a junction.
 *
 * There is no `t_junction`, and its absence is a decision rather than an
 * omission: the pad follows the roads that meet at it, so a three-arm node draws
 * as a T because it *has* three arms (junction glyphs §2.4). A variant naming a
 * fact the arms already carry is a control that cannot change a pixel. Rust
 * keeps the spelling as a load-only variant so an older `.zkai` still parses, and
 * normalizes it to `generic` on the way in — so nothing on this side ever sees
 * one.
 */
export type JunctionGlyph =
  | "generic"
  | "roundabout"
  | "signalized_cross"
  | "priority_cross"
  | "gore";

/** Where a node sits on the canvas. */
export interface NodeView {
  pos: Vec2;
  /** Absent means `both`; Rust elides the key for a node that states no side. */
  lane_change?: LaneChange;
}

/**
 * How a link is placed and routed. Every field is optional and so is the view
 * itself: a straight road has none, and nothing creates one until a bend is
 * set. There is no road class (road declutter §2.2).
 */
export interface LinkView {
  bends?: Vec2[];
}

/**
 * How a junction node is drawn.
 *
 * **There is deliberately no `rotation`.** One was declared in both mirrors from
 * the first commit, written only as zero, and read by nothing that draws — and a
 * pad derived from its arms is already oriented by them, which is what made the
 * field permanently dead (junction glyphs OQ-1).
 */
export interface JunctionView {
  glyph: JunctionGlyph;
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
 * 3 since the `bus_stop` marking kind, as 2 was since the `gore` junction glyph:
 * a new *field* costs no bump, but a new enum **variant** does. An older build
 * fails to deserialize the whole document on an unknown variant, and
 * `persist.rs`'s probe can only turn that into a readable message if the version
 * moves with it — and only if a save declares it, which `persist.rs:encode`
 * makes true whatever version the document was loaded at.
 */
export const SCHEMA_VERSION = 3;
