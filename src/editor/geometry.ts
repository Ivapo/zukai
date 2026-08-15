/** Canvas geometry: the pan/zoom transform and road-drawing math. */

import {
  DEFAULT_LANE_WIDTH,
  DEFAULT_LINK_STYLE,
  findLink,
  findNode,
  linkAlign,
  linkPolyline,
  linkStyle,
  nodePos,
} from "../model/document";
import {
  Document,
  Lane,
  LaneIdx,
  Link,
  LinkAlign,
  LinkEnd,
  LinkId,
  LinkStyle,
  LineStyle,
  Marking,
  NodeId,
  SignKind,
  TurnDirection,
  Vec2,
} from "../model/types";

/**
 * The canvas view transform. A world point `p` maps to screen coordinates as
 * `p * k + (tx, ty)`. Pan changes `tx`/`ty`; zoom changes `k` about a pivot.
 */
export interface ViewTransform {
  tx: number;
  ty: number;
  k: number;
}

/** The identity view: world and screen coincide. */
export const IDENTITY_VIEW: ViewTransform = { tx: 0, ty: 0, k: 1 };

/** Convert a screen point (relative to the SVG origin) to world coordinates. */
export function screenToWorld(v: ViewTransform, sx: number, sy: number): Vec2 {
  return { x: (sx - v.tx) / v.k, y: (sy - v.ty) / v.k };
}

/** Zoom by `factor` about a screen pivot, keeping that pivot stationary. */
export function zoomAbout(
  v: ViewTransform,
  factor: number,
  px: number,
  py: number,
): ViewTransform {
  const k = clampZoom(v.k * factor);
  const applied = k / v.k;
  return {
    k,
    tx: px - (px - v.tx) * applied,
    ty: py - (py - v.ty) * applied,
  };
}

/** Keep zoom within a usable range. */
export function clampZoom(k: number): number {
  return Math.min(8, Math.max(0.1, k));
}

/** Distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * How far along unit direction `d` a ray from `p` runs before it leaves the
 * circle of radius `r` **about the origin** — `0` when `p` is already outside it.
 *
 * Written for a junction glyph's interior, whose group is translated to the node,
 * so `p` is an arm's position *relative to the node* and the circle is the pad.
 *
 * **A centred arm gets exactly `r` back**, not `r` to within a rounding error:
 * `p = (0, 0)` reduces the expression to `-0 + Math.sqrt(0 + r * r - 0)`, and
 * `Math.sqrt(r * r) === r` holds for every double. That identity is what lets a
 * displaced arm and an undivided one share one expression while the undivided
 * drawing stays byte-identical to the centre-derived code this replaced.
 */
export function rayCircleExit(p: Vec2, d: Vec2, r: number): number {
  const pd = p.x * d.x + p.y * d.y;
  const p2 = p.x * p.x + p.y * p.y;
  // Outside the circle there is nothing to leave. The junction's reach floor
  // keeps every arm origin inside its own pad, so this branch is defensive.
  if (p2 >= r * r) return 0;
  return -pd + Math.sqrt(pd * pd + r * r - p2);
}

/** An SVG `path` `d` string through a polyline of world points. */
export function polylinePath(points: Vec2[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
}

/**
 * World-space width of one *default* lane, chosen for schematic legibility (not
 * to scale). Also the peg that fixes `UNITS_PER_METRE` — a lane the model gives
 * some other width draws in proportion to this one — and the peg
 * {@link GRID_PITCH} is a multiple of.
 */
export const LANE_PX = 9;
/** Extra world-space padding added around the lanes for the road casing. */
export const ROAD_MARGIN = 3;

/**
 * World units per model metre.
 *
 * Pinned to `LANE_PX / DEFAULT_LANE_WIDTH` so a document of default lanes draws
 * exactly as it did when every lane was hardcoded to `LANE_PX`: n default lanes
 * give `n * 3.5 * (9/3.5) + 3 = n * 9 + 3`. A wider lane then draws wider —
 * ordinally faithful, still not to scale (road spec §2.2).
 */
export const UNITS_PER_METRE = LANE_PX / DEFAULT_LANE_WIDTH;

/**
 * Drawn width of a road of one default lane at the default road class — what an
 * empty `lanes` array gets, and the fallback width for a junction with no arms
 * to measure (`Diagram.tsx`). A narrower class draws narrower than this: a
 * 1-lane ramp is 10.2, deliberately *not* floored back up to 12 (§2.2).
 */
export const MIN_ROAD_WIDTH = DEFAULT_LANE_WIDTH * UNITS_PER_METRE + ROAD_MARGIN;

/**
 * The canvas grid's cell, in world units — four lane widths.
 *
 * The number the dot grid has always been drawn at, named here so the dots and
 * the pointer honour one lattice instead of two (link bends spec §2.7). Four
 * lanes rather than one because a grid a reader can count is a grid whose cell
 * is bigger than the things placed on it.
 */
export const GRID_PITCH = LANE_PX * 4;

/**
 * The dot a world point lands on: each axis to the **nearest** multiple of
 * {@link GRID_PITCH}.
 *
 * Alignment is most of what separates a schematic from a sketch, so a corner
 * that lands on the same lattice as every other corner reads as deliberate.
 *
 * **Pure, and applied in the UI layer only** — `Canvas.tsx` rounds a pointer
 * before it dispatches, and no reducer arm ever calls this. `moveNode(pos)`
 * keeps meaning "put it exactly here", which is what lets an imported document,
 * an undo and a test place a node off-grid without fighting anything (§2.7).
 * The same split markings §2.3 records for its kind-aware rules, and for its
 * reason: a reducer that silently rewrites its argument makes one action mean
 * different things depending on which caller sent it.
 *
 * Nearest, never truncated: truncation drags every negative coordinate toward
 * zero and drifts a whole figure one way.
 */
export function snap(p: Vec2): Vec2 {
  return { x: toGrid(p.x), y: toGrid(p.y) };
}

/**
 * One axis of {@link snap}. The trailing `+ 0` normalizes the **negative zero**
 * `Math.round` answers for a point just left of the origin — arithmetically the
 * same number, but one that reaches a saved document as `-0`.
 */
function toGrid(v: number): number {
  return Math.round(v / GRID_PITCH) * GRID_PITCH + 0;
}

/**
 * The dot grid's tile in **screen** pixels — its size, and where its origin
 * sits — so that a dot drawn at the tile's centre lands on the same lattice
 * {@link snap} rounds to.
 *
 * **The tile moves and the circle stays centred**, which is worth saying
 * because the obvious fix is wrong: a `<pattern>` clips its content to its own
 * tile (`overflow` defaults to hidden), so a circle at the tile origin renders
 * **a quarter of a dot** — the other three quadrants do not arrive from the
 * neighbouring tiles, which draw their own. Pulling the origin back half a cell
 * puts the whole dot on the lattice instead (§2.7).
 *
 * It is a real half-pixel too, not a rounding: the tile was anchored at
 * `(tx, ty)` with its dot half a **screen** pixel inside, so a dot sat at world
 * `GRID_PITCH·i + 0.5/k` where `snap` answers `GRID_PITCH·i`, at every zoom.
 */
export function gridPattern(view: ViewTransform): { cell: number; origin: Vec2 } {
  const cell = GRID_PITCH * view.k;
  return { cell, origin: { x: view.tx - cell / 2, y: view.ty - cell / 2 } };
}

/** Per-class lane-width multipliers. Exhaustive, so a new `LinkStyle` won't build. */
const CLASS_WIDTH_FACTOR: Record<LinkStyle, number> = {
  motorway: 1,
  arterial: 1,
  local: 0.9,
  ramp: 0.8,
};

/**
 * How much narrower a road of this class draws — modest by design, and never
 * large enough to confuse lane count: road width is how a reader counts lanes,
 * so a 2-lane motorway must still read narrower than a 4-lane local street. The
 * rest of what makes a class legible is colour and line treatment, which live in
 * `diagram.css` (§2.3).
 *
 * It is applied to the per-lane widths rather than to the finished road width,
 * so `roadWidth`, `laneBands`, the dividers, the edge inset, the junction arms
 * and the export allowance all inherit it from one derivation. Falls back to 1
 * for a style a hand-edited document invented.
 */
export function classWidthFactor(style: LinkStyle): number {
  return CLASS_WIDTH_FACTOR[style] ?? 1;
}

/**
 * One lane's slice of the road, in **world units** — the metre conversion has
 * already happened, so every consumer is in drawing space. `offset` is the band
 * centre, signed as `offsetPolyline` takes it.
 */
export interface LaneBand {
  offset: number;
  width: number;
}

/**
 * Each lane's drawn width, in world units — the single place the metre
 * conversion and the lane-count floor live.
 *
 * **Converts per lane rather than summing metres first.** `UNITS_PER_METRE` is
 * `9/3.5`, which has no exact binary form, so `sum(width) * UNITS_PER_METRE`
 * lands on 30.000000000000004 for 3 default lanes and 57.00000000000001 for 6 —
 * the drift is visible in an exported file and breaks the exactness this
 * conversion exists to guarantee.
 *
 * **An empty `lanes` array is treated as one default lane** — a floor on the
 * lane *count*, deliberately not a `Math.max(MIN_ROAD_WIDTH, …)` clamp on the
 * resulting width. The two differ once a road class narrows its lanes: a 1-lane
 * ramp is 10.2 units, which an output clamp would round back up to a 1-lane
 * arterial's 12 and so cancel the class distinction it was meant to show. Only a
 * hand-edited or imported document can get here — the Inspector clamps the count
 * to 1..8 — which is why it needs a floor rather than an assertion.
 *
 * **The road class enters here and nowhere else.** Scaling the finished width
 * instead would narrow the casing while the band-derived dividers stayed put and
 * spilled outside it; scaling in metres, before the conversion, drifts three
 * times as often (measured). So each lane's already-converted width takes the
 * factor, and `ROAD_MARGIN` — the casing lip, not a lane — never does.
 */
function laneWidths(lanes: Lane[], style: LinkStyle): number[] {
  const factor = classWidthFactor(style);
  if (lanes.length === 0) return [DEFAULT_LANE_WIDTH * UNITS_PER_METRE * factor];
  return lanes.map((l) => l.width * UNITS_PER_METRE * factor);
}

/**
 * Where each lane sits across the road, in array order.
 *
 * **Lane 0 is the nearside (kerb) lane**, so it comes back with the most
 * positive offset — the side a positive `offsetPolyline` distance draws on under
 * right-hand traffic. That convention is what makes a `shoulder` at index 0 an
 * outside hard shoulder rather than one hiding in the median.
 *
 * The boundary between two adjacent bands is a lane divider; the outermost two
 * are the carriageway edges.
 */
export function laneBands(
  lanes: Lane[],
  style: LinkStyle = DEFAULT_LINK_STYLE,
): LaneBand[] {
  const widths = laneWidths(lanes, style);
  let edge = widths.reduce((s, w) => s + w, 0) / 2;
  return widths.map((width) => {
    const offset = edge - width / 2;
    edge -= width;
    return { offset, width };
  });
}

/** Total drawn road width in world units: every lane, plus the casing lip. */
export function roadWidth(
  lanes: Lane[],
  style: LinkStyle = DEFAULT_LINK_STYLE,
): number {
  return laneWidths(lanes, style).reduce((s, w) => s + w, 0) + ROAD_MARGIN;
}

/**
 * How far a link steps sideways to hold one of its own edges on its polyline,
 * in the same signed frame {@link offsetPolyline} takes — so it *adds* to the
 * carriageway offset rather than competing with it.
 *
 * **It is the lane region's half-span, not `roadWidth / 2`.** `ROAD_MARGIN` is
 * the casing lip, not a lane, so aligning "to an edge" means aligning the edge a
 * reader sees: the outermost painted line. Using the full width instead leaves a
 * half-lip step at every joint — 1.5 units of casing, small enough to look like
 * an antialiasing artefact and never be diagnosed.
 *
 * **The sign is derived, not chosen.** Lane 0 is the nearside lane and
 * {@link laneBands} gives it the most *positive* offset, so the nearside edge of
 * an unaligned road is at `+(roadWidth - ROAD_MARGIN) / 2`. Holding an edge *on*
 * the polyline means shifting the road by whatever brings that edge to zero — so
 * `offside` shifts **positive** and an offside-aligned road hangs to the
 * nearside of its own polyline, with `nearside` the mirror.
 */
export function alignmentShift(
  lanes: Lane[],
  style: LinkStyle,
  align: LinkAlign,
): number {
  if (align === "centre") return 0;
  const half = (roadWidth(lanes, style) - ROAD_MARGIN) / 2;
  return align === "offside" ? half : -half;
}

/** What {@link alignmentShift} does to a road, said in the drawing's own terms. */
export interface AlignmentReading {
  /**
   * Which side of its own polyline the lane region sits on, **in the road's own
   * travel frame** — `on` when it straddles the line. Never a side of the
   * screen: `+18` moves an eastbound road down and a westbound one up.
   */
  side: "left" | "right" | "on";
  /** How far off the line, in canvas units. Always `>= 0`. */
  offset: number;
}

/**
 * The Inspector's reading of a link's alignment: which way its lanes hang, and
 * how far (ramps spec §2.11.3).
 *
 * **Its whole reason for existing away from the panel is that the panel cannot
 * be tested** — this repo has no `Inspector.test.tsx`, a standing property
 * recorded in three rules, so a reading computed inline is a reading no test can
 * read. Same argument that lifted `turnArrowKind` out of it. The panel renders
 * this and decides nothing.
 *
 * **The frame is travel, not the screen, and it has to be.** This function is
 * as direction-blind as {@link alignmentShift} — it never sees a polyline, so it
 * could not answer a screen-frame question — and since a link carries `bends` a
 * bent road has no single "below" anyway, while `right of travel` is one answer
 * for the whole road. The drawing states which way that is, with the arrow head
 * `RoadShape` paints at the link's far end.
 *
 * `side` is nothing but the **sign** of the shift, which §2.3 already pins:
 * under `DRIVE_SIDE = 1` a positive offset draws to the visual right of travel,
 * so `offside` reads `right` and `nearside` `left` with no second derivation.
 *
 * Branching on the shift rather than on `align === "centre"` costs nothing and
 * is honest about a road that is centred without saying so: a lane region of no
 * width does not move, whichever edge it claims to hold. (An *empty* `lanes` is
 * not that road — it stands for one default lane, as it does everywhere else in
 * this file. It takes a lane of literally zero width, which no control can
 * author and only a hand-written document holds.)
 */
export function alignmentReading(
  lanes: Lane[],
  style: LinkStyle,
  align: LinkAlign,
): AlignmentReading {
  const shift = alignmentShift(lanes, style, align);
  // `-0 === 0`, so a negated zero lands here rather than reading `left`.
  if (shift === 0) return { side: "on", offset: 0 };
  return { side: shift > 0 ? "right" : "left", offset: Math.abs(shift) };
}

/**
 * How far a taper wedge runs along the inset link, in world units.
 *
 * A build constant in the manner of {@link SCHEMATIC_MEDIAN}, not a converted
 * model quantity: nothing in the model carries a taper length, and a real one
 * (~50 m) would be ~129 world units — longer than most whole links in a
 * schematic. Roughly two-and-a-half lane widths, which reads as a taper rather
 * than as a chamfer (ramps spec OQ-2).
 */
export const TAPER_LENGTH = 24;

/**
 * How far a joint may bend and still count as one road continuing through it,
 * in **degrees**. Beyond it a corner is a corner and no wedge is drawn.
 *
 * **Derived, not picked.** The butt caps a wedge forces (`.road-casing--butt`)
 * leave a notch on the *outside* of a bend of depth `(roadWidth / 2) · tan(θ/2)`
 * — 1.36 units at 8° for a 4-lane road, the same order as the ≈1.33-unit
 * round-cap overhang the butt cap removes, so the trade is never a loss and
 * falls to zero as the joint straightens. A larger tolerance inverts it (15°
 * gives ≈2.6), and a schematic lane drop is drawn nearly straight anyway.
 */
export const TAPER_MAX_BEND = 8;

/**
 * How far a mitred corner may reach past its own vertex, as a multiple of the
 * offset distance — {@link offsetPolyline}'s clamp at a sharp bend.
 *
 * **Derived, not picked, and it has to be this number** (link bends spec OQ-3).
 * A corner is drawn twice over: {@link offsetPolyline} places each element's
 * centreline, and SVG joins that element's own stroke at the vertex. SVG bevels
 * a join once `miterLength / strokeWidth` passes `stroke-miterlimit`, and that
 * ratio is `1 / sin(ι/2)` for an included angle `ι` — the same quantity as this
 * function's `1 / cos(φ/2)`, since `ι = 180° − φ`. So clamping here at SVG's
 * **default** of 4 is what makes the paint and the asphalt under it change
 * behaviour at one angle, 28.96°, which no independently chosen number would.
 *
 * The number is written twice — here and as `.road-casing`'s
 * `stroke-miterlimit` in `diagram.css` — because a CSS rule cannot read a
 * constant, the same reason the road class's width factor does not live there.
 *
 * Past the limit the two differ in *kind*: this clamps the **distance** along
 * the same bisector, where SVG bevels. That is accepted. A hairpin that sharp is
 * not a road this project draws, and the alternative costs the vertex
 * correspondence a bend's insertion index rests on (link bends spec §2.4).
 */
export const MITER_LIMIT = 4;

/**
 * How close two casing-edge offsets must be to count as the same edge.
 *
 * The pairs that *should* agree do agree exactly today — two `offside`-aligned
 * roads both put that edge on the polyline, and a 5-lane ramp and a 4-lane
 * arterial both draw exactly 39 wide (checked across every class and lane
 * count). This is a tolerance rather than `===` because nothing guarantees that
 * of a document whose lanes carry arbitrary widths, and because the alternative
 * is worse than a missed wedge: a step below 1e-6 world units would emit a
 * zero-area polygon and butt-cap two roads over a difference no one can see.
 */
const SAME_EDGE = 1e-6;

/**
 * How one link meets a through joint, **as drawn** — the input the taper rule
 * compares. Every direction is passed in rather than re-derived: the road spec's
 * review burned four rounds on offset-sign traps, and `Diagram.tsx` has all of
 * this in hand from the drawn polyline already (ramps spec §2.4).
 */
export interface JointEnd {
  /** Where the link's drawn polyline meets the joint. */
  at: Vec2;
  /** Unit direction from the joint **away** along this link. */
  away: Vec2;
  /** Unit direction toward this end's **nearside**, in world space. */
  nearside: Vec2;
  /** The link's signed lateral shift — the `d` its drawn polyline carries. */
  offset: number;
  /** Its drawn road width, casing lip included. */
  width: number;
}

/** A wedge to draw, and which end of the joint it runs along. */
export interface TaperWedge {
  /** `[the outset link's edge at the joint, the inset link's, the tip]`. */
  corners: [Vec2, Vec2, Vec2];
  /**
   * The inset end — the very {@link JointEnd} that was passed in, so a caller
   * can map it back to the link it came from (and to that link's road class).
   */
  inset: JointEnd;
}

/**
 * The asphalt wedge closing a width step at a through joint, on one side.
 *
 * Every argument is already in drawing space, so this function has no frame, no
 * offset sign, and nothing to re-derive. **Three** corners, not four: the wedge
 * is a triangle from the two links' edges at the joint out to a tip `length`
 * along the inset link.
 */
export function taperWedge(
  outerEdge: Vec2,
  insetEdge: Vec2,
  insetDir: Vec2,
  length: number,
): [Vec2, Vec2, Vec2] {
  return [
    outerEdge,
    insetEdge,
    {
      x: insetEdge.x + insetDir.x * length,
      y: insetEdge.y + insetDir.y * length,
    },
  ];
}

/**
 * Every wedge a through joint needs — none, one, or one per side.
 *
 * **The joint must be collinear within {@link TAPER_MAX_BEND} first.** A taper's
 * whole premise is one road continuing through a width step, and the two ends'
 * lateral offsets are only comparable while their frames agree: `segmentNormals`
 * rotates with the link, so at `N1(0,0) → N2(120,0) → N3(120,120)` two
 * *identical* links put their nearside casing edges at `(120, 19.5)` and
 * `(100.5, 0)`. The two ends of a through joint point *apart*, so the test is on
 * the dot product being near `-1`. It also rejects a degenerate zero-length
 * link, whose `away` is `(0, 0)`.
 *
 * Then, **independently on each side**, the two ends' casing edges are compared
 * as *signed lateral offsets* — `offset ± width / 2`, the numbers the drawing
 * itself is built from, never world points:
 *
 * - equal ⇒ nothing to draw (aligning both links to that side is exactly what
 *   makes them equal);
 * - otherwise the **inset** end is the one nearer the road's other side — the
 *   smaller value on the nearside, the larger on the offside — and the wedge
 *   runs from the joint along it. There is no tie to break: a tie *is* equality.
 *
 * That rule keeps the geometry purely **additive**. A wedge only ever paints
 * asphalt into space the inset link left empty; it never has to erase asphalt a
 * uniform stroke already laid down.
 */
export function taperWedges(
  a: JointEnd,
  b: JointEnd,
  length: number,
): TaperWedge[] {
  const alignment = a.away.x * b.away.x + a.away.y * b.away.y;
  if (alignment > -Math.cos((TAPER_MAX_BEND * Math.PI) / 180)) return [];

  const wedges: TaperWedge[] = [];
  // +1 is the nearside, -1 the offside — the sign `laneBands` and
  // `offsetPolyline` already use, so no side has to be named twice.
  for (const side of [1, -1]) {
    const ea = a.offset + (side * a.width) / 2;
    const eb = b.offset + (side * b.width) / 2;
    if (Math.abs(ea - eb) < SAME_EDGE) continue;
    // Smaller wins on the nearside, larger on the offside: both are "nearer the
    // road's other side", which `side *` says once instead of twice.
    const [inset, outset] = side * (ea - eb) < 0 ? [a, b] : [b, a];
    wedges.push({
      corners: taperWedge(
        casingEdge(outset, side),
        casingEdge(inset, side),
        inset.away,
        length,
      ),
      inset,
    });
  }
  return wedges;
}

/** Where one end's casing edge on `side` (+1 nearside, -1 offside) sits. */
function casingEdge(e: JointEnd, side: number): Vec2 {
  const d = (side * e.width) / 2;
  return { x: e.at.x + e.nearside.x * d, y: e.at.y + e.nearside.y * d };
}

/**
 * The wedge's own edge line: its hypotenuse, drawn `inset` inside the asphalt.
 *
 * Mirrors `RoadShape`'s `edgeInset = w / 2 - 1.5` — a wedge is asphalt bounded
 * by the *casing* edges, and its painted line sits inside that rim like every
 * other. The direction is "toward the third corner", so there is no sign to get
 * wrong and no frame to be in. A degenerate wedge returns its hypotenuse unmoved.
 */
export function taperEdge(
  corners: [Vec2, Vec2, Vec2],
  inset: number,
): [Vec2, Vec2] {
  const [outerEdge, insetEdge, tip] = corners;
  const hx = tip.x - outerEdge.x;
  const hy = tip.y - outerEdge.y;
  const len = Math.hypot(hx, hy);
  if (len < SAME_EDGE) return [outerEdge, tip];
  const nx = -hy / len;
  const ny = hx / len;
  // Which way the asphalt lies: the side the wedge's third corner is on.
  const towards = (insetEdge.x - outerEdge.x) * nx + (insetEdge.y - outerEdge.y) * ny;
  if (towards === 0) return [outerEdge, tip];
  const d = towards > 0 ? inset : -inset;
  return [
    { x: outerEdge.x + nx * d, y: outerEdge.y + ny * d },
    { x: tip.x + nx * d, y: tip.y + ny * d },
  ];
}

/**
 * How far a gore runs from its nose, in world units.
 *
 * A build constant like {@link TAPER_LENGTH}, and half again as long: a taper
 * has to read as a taper rather than a chamfer, while a gore has to read as an
 * *area* rather than a wedge (ramps spec OQ-2). Scaled by the glyph's own Size,
 * which is the only thing that control can move on a pad-less glyph — and moving
 * it is safe, because lengthening a gore slides its base along two legs that
 * stay on the roads' own edge lines.
 */
export const GORE_LENGTH = 36;

/**
 * One arm of a gore, **as drawn**, in whatever frame the gore is drawn in — the
 * junction glyph's group is already translated to the node, so `Diagram.tsx`
 * passes arm positions relative to it.
 *
 * Like {@link JointEnd}, every direction is passed in rather than re-derived.
 */
export interface GoreArm {
  /** The link this arm came from. Used only to break an exact tie in
   *  {@link gorePair}, so the drawing never depends on document order. */
  id: LinkId;
  /** Where the carriageway meets the node. */
  at: Vec2;
  /** Unit direction **away** from the node, along the drawn carriageway. */
  away: Vec2;
  /**
   * Whether traffic **leaves** the node along this arm — {@link Arm.outbound},
   * carried through unchanged. {@link gorePair} never reads it; only
   * {@link goreFlow} does, and only after the pair is already chosen.
   */
  outbound: boolean;
  /**
   * Half the **lane region's** span — `(roadWidth - ROAD_MARGIN) / 2`, the same
   * quantity {@link alignmentShift} holds an edge at, and exactly `RoadShape`'s
   * `edgeInset`. A gore is paint bounded by the roads' *painted* edges, not
   * asphalt bounded by their casing rims the way a taper wedge is, so its legs
   * are literal continuations of the two edge lines either side of it.
   */
  halfSpan: number;
}

/**
 * Where the ray from `p` along unit `d` crosses the ray from `q` along unit `e`
 * — `undefined` when they are parallel, or when they meet only *behind* both
 * origins.
 *
 * The two rejected cases are the gore's degenerate ones (ramps spec §2.5), and
 * returning `undefined` rather than a point is what keeps an `Infinity` or a
 * `NaN` out of the drawing: a caller falls back to the node, which is
 * degenerate but drawable. "Behind **both**" is deliberate — a nose behind one
 * origin and ahead of the other is still where those two edges meet.
 */
export function rayIntersection(
  p: Vec2,
  d: Vec2,
  q: Vec2,
  e: Vec2,
): Vec2 | undefined {
  const denom = d.x * e.y - d.y * e.x;
  if (Math.abs(denom) < SAME_EDGE) return undefined;
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const t = (rx * e.y - ry * e.x) / denom;
  const u = (rx * d.y - ry * d.x) / denom;
  if (t < 0 && u < 0) return undefined;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

/**
 * The two arms a gore is drawn between: **the pair with the smallest angle
 * between their directions**, which is the diverging pair at a diverge and the
 * converging pair at a merge.
 *
 * Not read off the traffic, because it cannot be: `junctionArms` orients *every*
 * incident link so its direction points away from the node, whichever way its
 * traffic runs, so a {@link GoreArm} carries no incoming/outgoing information at
 * all. It does not need to — the closest pair is the right pair both times, with
 * no direction of travel consulted either way (ramps spec §2.5).
 *
 * Every direction is a unit vector, so smallest angle is **largest dot**. Fewer
 * than two arms gives `undefined`; more than three is not rejected — the closest
 * pair still wins, which is the same "the human chose this glyph" posture the
 * rest of the drawing takes. An exact tie (a genuinely symmetric Y, not a float
 * wobble) breaks on the pair's link ids.
 */
export function gorePair(arms: GoreArm[]): [GoreArm, GoreArm] | undefined {
  let best: [GoreArm, GoreArm] | undefined;
  let bestDot = -Infinity;
  for (let i = 0; i < arms.length; i++) {
    for (let j = i + 1; j < arms.length; j++) {
      const a = arms[i];
      const b = arms[j];
      const dot = a.away.x * b.away.x + a.away.y * b.away.y;
      if (
        dot > bestDot ||
        (best !== undefined && dot === bestDot && pairKey(a, b) < pairKey(best[0], best[1]))
      ) {
        bestDot = dot;
        best = [a, b];
      }
    }
  }
  return best;
}

/** A pair of arms as one comparable string, so a tie breaks the same way twice. */
function pairKey(a: GoreArm, b: GoreArm): string {
  return a.id < b.id ? `${a.id}\0${b.id}` : `${b.id}\0${a.id}`;
}

/**
 * The gore: the triangle of paint between two arms as they separate.
 *
 * Three steps, and only the first needs any reasoning (ramps spec §2.5):
 *
 * 1. Each arm's **inner edge** is a ray from its own position along its own
 *    direction, stepped sideways by its `halfSpan` *toward the other arm*. Which
 *    perpendicular that is falls out of the geometry rather than out of
 *    `DRIVE_SIDE`: the one whose dot with the other arm's direction is positive,
 *    a quantity that is `±sin θ` and so non-zero for any angle strictly between
 *    parallel and anti-parallel.
 * 2. The two rays cross at the **nose**. Collinear arms make step 1's sign
 *    arbitrary *and* step 2 parallel, so both fall together into `fallback` —
 *    the node — which is degenerate but drawable.
 * 3. The triangle runs `length` from the nose along each arm. The nose lies on
 *    both inner edges, so each leg stays on its road's own edge line.
 */
export function gore(
  a: GoreArm,
  b: GoreArm,
  fallback: Vec2,
  length: number,
): [Vec2, Vec2, Vec2] {
  const ea = innerEdge(a, b.away);
  const eb = innerEdge(b, a.away);
  const nose = rayIntersection(ea, a.away, eb, b.away) ?? fallback;
  return [
    nose,
    { x: nose.x + a.away.x * length, y: nose.y + a.away.y * length },
    { x: nose.x + b.away.x * length, y: nose.y + b.away.y * length },
  ];
}

/** Where `arm`'s inner edge starts: its own position, stepped `halfSpan` toward
 *  the arm heading `other`. */
function innerEdge(arm: GoreArm, other: Vec2): Vec2 {
  // The perpendicular leaning toward the other arm. Its dot with `other` is
  // `±sin θ`; at θ = 0 or 180° either choice is as good as the other, because
  // the rays are then parallel and the nose falls back to the node regardless.
  const nx = -arm.away.y;
  const ny = arm.away.x;
  const side = nx * other.x + ny * other.y >= 0 ? 1 : -1;
  return {
    x: arm.at.x + nx * side * arm.halfSpan,
    y: arm.at.y + ny * side * arm.halfSpan,
  };
}

/**
 * Which end of a gore the driver arrives from, and so which end its chevrons
 * point at: the **nose** at a diverge, the **base** at a merge.
 */
export type GoreFlow = "nose" | "base";

/**
 * The one place a gore consults the direction of travel (ramps spec §2.9.1).
 *
 * {@link gorePair} deliberately cannot: it picks the closest pair off `away`,
 * which points out of the node whichever way traffic runs, and that
 * direction-blindness is what lets **one** `gore` variant cover both a diverge
 * and a merge. But a chevron has to claim a direction — draw one orientation for
 * both and half of all gores point the wrong way, in a drawing that looks
 * entirely deliberate and states the opposite of what it means.
 *
 * The answer costs no model field, because the link already carries it: the node
 * is either the link's `from_node` (traffic leaves — {@link GoreArm.outbound})
 * or its `to_node` (traffic arrives). **Both out is a diverge**, whose traffic
 * arrives on the third arm and splits at the nose; **both in is a merge**, whose
 * traffic arrives along the two legs and joins at the base.
 *
 * **The mixed case is a floor, not an error.** One arm in and one out is a gore a
 * human built from two links that neither diverge nor converge, and an imported
 * fragment can hold one. It draws the diverge orientation, on {@link gorePair}'s
 * own posture towards a node with more than three arms — a drawing that still
 * looks deliberate beats one that silently loses its paint (OQ-9, taken).
 */
export function goreFlow(a: GoreArm, b: GoreArm): GoreFlow {
  return !a.outbound && !b.outbound ? "base" : "nose";
}

/**
 * The gap between two chevrons along the gore's axis, in world units.
 *
 * A build constant beside {@link GORE_LENGTH}, and **unscaled** where that one is
 * scaled: the triangle already grows with the glyph's Size, so holding the pitch
 * fixed is what makes a longer gore carry *more* chevrons rather than the same
 * few stretched. One default lane, settled in the app.
 */
export const GORE_CHEVRON_PITCH = LANE_PX;

/**
 * How far a chevron's wing leans off the edge it ends on, as a fraction of the
 * way from that edge to square across the gore's axis.
 *
 * **A fraction rather than an angle, and this is the one thing settling it in the
 * app changed.** A wing has to stay visibly clear of the edge line it lands on,
 * and the edge's own angle is not a constant — it is whatever splay the two roads
 * happen to leave. So an *absolute* angle reads at one gore and fails at two
 * others, in opposite directions: at 60° off the axis a wing sits 12° off the
 * edge of a narrow diverge and merges into it, while any fixed angle is
 * eventually *shallower* than the edge of a wide one, which flips the chevron to
 * point at the far end. That last failure is the exact silent mirror
 * {@link goreFlow} exists to rule out, arriving by the back door.
 *
 * Held at a fraction of the room available, the wing is clear of the edge by the
 * same proportion at every splay and stays strictly inside square-across, so
 * neither failure is reachable: the tip's setback,
 * `tan α / tan(α + lean · (90° − α))`, is strictly between 0 and 1 for every
 * splay, so a chevron can never turn round.
 */
export const GORE_CHEVRON_LEAN = 0.65;

/**
 * The chevrons inside a gore: one open polyline per chevron, each
 * `[on one edge, tip, on the other edge]`, pointing at whichever end the driver
 * arrives from (ramps spec §2.9.3).
 *
 * **The triangle is isoceles**, because {@link gore} runs a whole `length` along
 * each arm from the nose — so its axis of symmetry is `nose → midpoint(fa, fb)`,
 * and two facts make the whole layout free of perpendiculars, normals and offset
 * signs, which is the trap class this spec's review kept catching:
 *
 * - a point on a leg at axial station `s` is exactly `lerp(nose, corner, s /
 *   axisLen)`, since a leg's projection on the axis grows linearly from `0` to
 *   `axisLen`;
 * - a point on the axis is `lerp(nose, mid, s / axisLen)`.
 *
 * **The count comes from the axis and the pitch follows**, as {@link spanCells}
 * does for the tiled marking kinds, so the cells tile the axis exactly with no
 * partial one at either end. **Containment is then constructional rather than
 * clamped**: both wing ends are convex combinations of the nose and a corner, so
 * they land *exactly* on the edges, and the tip is on the axis between them. A
 * chevron outside an edge line is the failure that rules out, as `ARROW_REACH`
 * rules it out for a turn arrow.
 *
 * **A cell with no room for a tip draws nothing**, which is the one place a cell
 * and a chevron are not the same thing. The cells nearest the end the chevrons
 * point at are shallower than the setback, so their tips would land beyond the
 * triangle — and pinning one to the corner instead is worse than dropping it,
 * because a chevron with its tip *on* the nose has both wings lying along the two
 * edge lines. That draws the gore's own outline a second time and reads as a
 * doubled edge, not as paint.
 *
 * A chevron near the far end reaches back past the tip of the one before it. That
 * is what a real gore looks like — nested Vs — and the gap that has to stay
 * visible is the perpendicular one, which the pitch fixes.
 */
export function goreChevrons(
  nose: Vec2,
  fa: Vec2,
  fb: Vec2,
  toward: GoreFlow,
): Vec2[][] {
  const mid = { x: (fa.x + fb.x) / 2, y: (fa.y + fb.y) / 2 };
  const axisLen = distance(nose, mid);
  const halfBase = distance(fa, fb) / 2;
  // Both of `gore`'s degenerate cases, and they fail differently. Anti-parallel
  // arms put `mid` on the nose, so there is no axis and every point would be a
  // `NaN`. **Parallel** arms are the one the drawing catches rather than the
  // maths: the triangle has an axis but no width, so every chevron comes out with
  // its three points on top of each other — which a round cap paints as a *dot*,
  // a row of them down the middle of nothing. Neither draws.
  if (axisLen < SAME_EDGE || halfBase < SAME_EDGE) return [];

  // The triangle's own half-angle, as a tangent and then as an angle.
  const slope = halfBase / axisLen;
  const edge = Math.atan(slope);
  // How far back from its wings a chevron's tip sits, per unit of station. The
  // wings land on the edges either way; this is only what sets the tip's angle,
  // and it is strictly in (0, 1) for every splay, so a chevron cannot turn round.
  const wing = edge + GORE_CHEVRON_LEAN * (Math.PI / 2 - edge);
  const rake = slope / Math.tan(wing);

  const count = Math.max(1, Math.round(axisLen / GORE_CHEVRON_PITCH));
  const pitch = axisLen / count;

  const fan: Vec2[][] = [];
  for (let i = 0; i < count; i++) {
    const k = (pitch * (i + 0.5)) / axisLen;
    const t = toward === "nose" ? k - rake : k + rake;
    // No room for this cell's tip, so it draws nothing rather than folding its
    // wings onto the two edge lines — see the note above.
    if (t < 0 || t > 1) continue;
    fan.push([lerp(nose, fa, k), lerp(nose, mid, t), lerp(nose, fb, k)]);
  }
  return fan;
}

/** The point a fraction `t` of the way from `a` to `b`. */
function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Which side of its own travel direction a carriageway of a divided road sits
 * on: `+1` is right-hand traffic.
 *
 * A build-wide constant, not a document field — a `.zkai` has nowhere to record
 * one, and adding a place would be the schema change the road spec rules out
 * (§2.7, OQ-2). Left-hand traffic is a one-character change here.
 *
 * The sign is not the obvious one. `segmentNormals` returns left-hand normals in
 * the y-up convention maths uses, but SVG's y axis points down: travel due east
 * gives the normal `(0, +1)`, which draws *below* the road, i.e. to the right of
 * the direction of travel as seen. So positive is right-hand traffic.
 */
export const DRIVE_SIDE = 1;

/**
 * The narrowest drawn gap between the two carriageways of a divided road, in
 * world units.
 *
 * `Link.median_gap` is metres and defaults to 0.5, which converts to ~1.3 units
 * — thinner than the 1.5-unit edge line, so drawing it literally would smudge
 * the two carriageways into one road. Six units is four times the edge line, so
 * the median reads as a gap; the crossover is at `median_gap ≈ 2.33 m`, above
 * which a real motorway median widens the drawn gap and the model's field is
 * honoured ordinally (OQ-3).
 */
export const SCHEMATIC_MEDIAN = 6;

/**
 * How far each link steps sideways before it is drawn, keyed by link id. Every
 * link in the document gets an entry, `0` unless it is one carriageway of a
 * divided road — a caller never has to tell "no offset" from "unknown link".
 *
 * Two links between the same node pair in opposite directions are one two-way
 * road; the model has no other way to say so ("roads are directional: a two-way
 * street is two links with opposite `from_node`/`to_node`"). Drawn on the shared
 * centreline they are literally invisible as two, so each steps out by half its
 * own drawn width plus half the median. Half its *own* width is the point: a
 * step derived from the median alone would leave two 4-lane carriageways sitting
 * almost entirely on top of each other, which is the defect this fixes.
 *
 * **Every offset returned is positive, and that is not a bug.** The number is
 * the `d` of {@link offsetPolyline}, measured in each link's *own* polyline
 * frame — and a reversed twin traverses the same ground the other way, so its
 * segment normal already points the other way and the same positive `d` draws it
 * on the opposite visual side. Negating one twin to make the two signs differ
 * would put both carriageways on the same side.
 *
 * Pairing is on an exact reversed node pair, never on "roughly parallel", which
 * would mis-pair a slip road with the mainline it runs beside — and a schematic
 * is deliberately placed by a human. Three or more links on one node pair (a
 * divided road plus a service road) stay on the centreline rather than have a
 * layout guessed for them.
 */
export function carriageways(doc: Document): Record<LinkId, number> {
  const offsets: Record<LinkId, number> = {};
  // Grouped by *unordered* node pair, so a link and its reversed twin collide
  // here; `\0` cannot occur in an id, so the key cannot alias.
  const byPair = new Map<string, Link[]>();

  for (const link of doc.links) {
    offsets[link.id] = 0;
    const [a, b] =
      link.from_node < link.to_node
        ? [link.from_node, link.to_node]
        : [link.to_node, link.from_node];
    const key = `${a}\0${b}`;
    const group = byPair.get(key);
    if (group) group.push(link);
    else byPair.set(key, [link]);
  }

  for (const group of byPair.values()) {
    if (group.length !== 2) continue;
    const [a, b] = group;
    // Same pair of nodes, opposite directions — and not two self-loops, which
    // satisfy that test trivially without being a divided road.
    if (a.from_node === a.to_node) continue;
    if (a.from_node !== b.to_node || a.to_node !== b.from_node) continue;
    offsets[a.id] = carriagewayOffset(doc, a);
    offsets[b.id] = carriagewayOffset(doc, b);
  }

  return offsets;
}

/**
 * One carriageway's step out from the shared centreline — always positive, per
 * {@link carriageways}.
 *
 * The width term is the link's *drawn* width, road class and all, so the gap
 * left for the median is the median and nothing else. Each link uses its own
 * `median_gap`; on the document the UI produces they always agree, and where a
 * hand-edited one disagrees the drawn gap is the mean of the two separations.
 */
function carriagewayOffset(doc: Document, link: Link): number {
  const separation = Math.max(
    SCHEMATIC_MEDIAN,
    link.median_gap * UNITS_PER_METRE,
  );
  const w = roadWidth(link.lanes, linkStyle(doc, link.id));
  return DRIVE_SIDE * (w / 2 + separation / 2);
}

/**
 * Unit direction of the final segment of a polyline, used to orient the
 * link's direction arrowhead. Returns `undefined` for a degenerate polyline.
 */
export function endDirection(points: Vec2[]): Vec2 | undefined {
  for (let i = points.length - 1; i > 0; i--) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) return { x: dx / len, y: dy / len };
  }
  return undefined;
}

/**
 * Unit left-hand normals of each segment of a polyline — "left-hand" in the
 * y-up convention this formula comes from. SVG's y axis points down, so on the
 * canvas these point to the **right** of the direction of travel: due east gives
 * `(0, +1)`, which is drawn below the road. See {@link DRIVE_SIDE}.
 */
function segmentNormals(points: Vec2[]): Vec2[] {
  const normals: Vec2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy) || 1;
    normals.push({ x: -dy / len, y: dx / len });
  }
  return normals;
}

/**
 * How short a vector may be before {@link offsetPolyline} stops treating it as a
 * direction — a missing segment normal, or a bisector that cancelled out.
 *
 * Loose rather than tight, and deliberately: normalizing a sum of two unit
 * vectors that nearly cancel amplifies its error without bound, so a threshold
 * near float noise would keep a direction whose *angle* is already meaningless.
 * Nothing above it is at risk, because the {@link MITER_LIMIT} clamp already
 * caps how far a near-reversal reaches.
 */
const NO_BISECTOR = 1e-6;

/**
 * A polyline parallel to `points`, offset by signed distance `d` — positive `d`
 * to the right of the direction of travel as drawn. **Every vertex comes back
 * exactly `d` from its own segment's infinite line**, at an interior corner as
 * much as at an end, which is the invariant to assert and the one an averaged
 * normal breaks.
 *
 * An end vertex steps along its one segment's normal. An interior vertex is a
 * true **miter**: it steps along the bisector `m = normalize(n₁ + n₂)` by
 * `d / (m · n₁)`, which is `d / cos(φ/2)` for a turn of `φ`. Stepping by `d`
 * instead — the average-normal offset this replaced — leaves every corner short,
 * so the paint cuts inside the asphalt it belongs on (link bends spec §2.4).
 *
 * **The vertex count and order never change**, past the clamp as much as before
 * it. A bend's insertion index is measured on the drawn polyline and applied to
 * the layout one, and that transfer is valid only because this function emits
 * one vertex per vertex — so the clamp shortens the miter's *distance* and never
 * inserts a bevel vertex the way SVG's own join would.
 *
 * Two degeneracies have no bisector at all, and both are reachable once a human
 * can drag a bend onto a grid:
 *
 * - a **zero-length segment** has no normal — {@link segmentNormals} gives it
 *   `(0, 0)` — so there is no corner here to mitre and the vertex takes
 *   whichever normal exists, at plain `d`. Left to the miter it would divide by
 *   a dot product of zero and clamp to a 4·`d` spike sideways;
 * - an **exact reversal** puts `n₁ + n₂` at the origin, so there is no direction
 *   to normalize. It steps `d` along `n₁` — the *first* segment's normal, named
 *   rather than "either" — which is finite and sane, where the reversal
 *   otherwise emits `NaN` into the path.
 */
export function offsetPolyline(points: Vec2[], d: number): Vec2[] {
  if (points.length < 2) return points;
  const seg = segmentNormals(points);
  return points.map((p, i) => {
    let nx: number;
    let ny: number;
    // How far along that direction, in multiples of `d`: 1 everywhere except a
    // mitred corner, where the bisector is shorter than the offset it carries.
    let reach = 1;
    if (i === 0) {
      nx = seg[0].x;
      ny = seg[0].y;
    } else if (i === points.length - 1) {
      nx = seg[seg.length - 1].x;
      ny = seg[seg.length - 1].y;
    } else {
      const a = seg[i - 1];
      const b = seg[i];
      // A normal that is not a unit vector came from a zero-length segment, so
      // this vertex sits on top of its neighbour and there is no corner here.
      const degenerate = Math.hypot(a.x, a.y) < NO_BISECTOR;
      if (degenerate || Math.hypot(b.x, b.y) < NO_BISECTOR) {
        const u = degenerate ? b : a;
        nx = u.x;
        ny = u.y;
      } else {
        nx = a.x + b.x;
        ny = a.y + b.y;
        const len = Math.hypot(nx, ny);
        if (len < NO_BISECTOR) {
          // An exact reversal: `n₁` at plain `d`, per the note above.
          nx = a.x;
          ny = a.y;
        } else {
          nx /= len;
          ny /= len;
          reach = Math.min(MITER_LIMIT, 1 / (nx * a.x + ny * a.y));
        }
      }
    }
    return { x: p.x + nx * d * reach, y: p.y + ny * d * reach };
  });
}

/**
 * The polyline a link is *drawn* along: its layout polyline, stepped sideways by
 * **two** lateral terms — the carriageway offset of a divided road, and the
 * shift that holds an aligned link's own edge on the polyline. Identical to the
 * layout polyline — the same array, not a copy — for a centred link with no
 * opposing twin, which is every link in a document that has set neither.
 *
 * **They compose by addition, and this is the only site that knows it.** The
 * roads, the junction arms and (through `Arm.origin`) the junction interiors all
 * inherit both from here, so nothing else has to learn about alignment — and the
 * roads and the arms cannot come to disagree about where a road runs.
 *
 * Lives here rather than in `Diagram.tsx`, where it started, because placing a
 * marking means putting it on the polyline the road is *actually drawn along*
 * (`Canvas.tsx`), and a second derivation of that is exactly what this function's
 * "only site" claim forbids (markings spec §2.4).
 */
export function drawnPolyline(
  doc: Document,
  link: Link,
  offsets: Record<LinkId, number>,
): Vec2[] | undefined {
  const pts = linkPolyline(doc, link);
  const d = lateralShift(doc, link, offsets);
  if (!pts || d === 0) return pts;
  return offsetPolyline(pts, d);
}

/**
 * The sum of the two lateral terms, in the link's own polyline frame — the `d`
 * {@link drawnPolyline} applies.
 *
 * Its own function because the taper rule compares these as **signed offsets**
 * rather than as world points (ramps spec §2.4), and a second derivation of the
 * same number is exactly how the drawing and the rule that measures it come to
 * disagree.
 */
export function lateralShift(
  doc: Document,
  link: Link,
  offsets: Record<LinkId, number>,
): number {
  return (
    (offsets[link.id] ?? 0) +
    alignmentShift(link.lanes, linkStyle(doc, link.id), linkAlign(doc, link.id))
  );
}

/** An arm meeting a junction, as drawn. */
export interface Arm {
  /** The link it comes from — the tie-break when a gore has two equally close
   *  pairs to choose between (`gorePair`). */
  id: LinkId;
  /** Unit direction away from the node, along the drawn carriageway. */
  dir: Vec2;
  /**
   * Where that carriageway actually meets the node, in **world** units — the
   * node position stepped off by {@link lateralShift}, so **both** of its terms
   * move this point: the carriageway offset of a divided pair, and the shift an
   * aligned link takes to hold its own edge on the polyline. Only a centred link
   * with no opposing twin has its origin *at* the node. A glyph's own group is
   * translated to the node, so an interior detail drawn from this has to enter as
   * `origin - center`.
   */
  origin: Vec2;
  /**
   * Whether traffic **leaves** the node along this arm — the node is the link's
   * `from_node`. Carried rather than re-derived, on `origin`'s road: it is the
   * `touchesStart` {@link junctionArms} already computes and used to discard.
   *
   * {@link dir} cannot substitute and that is the whole point of the field: every
   * arm points *away* from the node whichever way its traffic runs. One consumer,
   * {@link goreFlow}, and it is what lets a gore's chevrons face the driver.
   */
  outbound: boolean;
  width: number;
}

/**
 * The arms incident to a junction node, derived from the links that touch it —
 * from each one *as drawn*, so a divided road's arms follow its carriageways,
 * position included. The lateral position is not re-derived from `DRIVE_SIDE` or
 * a second call to `carriageways`: it is already sitting in the drawn polyline's
 * own end point (ramps spec §2.2, road spec OQ-6).
 *
 * **The name understates it: this reads every node type, not only a junction.**
 * It filters on nothing but the links that touch the node, so {@link nodeDots}
 * asks it about an endpoint and a waypoint too. Renaming it would ripple through
 * four rules and two specs for no behaviour, so the correction lives here.
 *
 * **Lives here rather than in `Diagram.tsx`**, where it started, for
 * {@link drawnPolyline}'s reason one step on: an `end`-anchored marking measures
 * to the *rim* of the glyph these arms size ({@link junctionRadius}), and that is
 * not a render-time question. Lifting it is the whole of lane arrows Phase 5.
 */
export function junctionArms(
  doc: Document,
  nodeId: NodeId,
  offsets: Record<LinkId, number>,
): Arm[] {
  const arms: Arm[] = [];
  for (const link of doc.links) {
    const touchesStart = link.from_node === nodeId;
    const touchesEnd = link.to_node === nodeId;
    if (!touchesStart && !touchesEnd) continue;
    const poly = drawnPolyline(doc, link, offsets);
    if (!poly || poly.length < 2) continue;
    // Orient the polyline so the junction node is first, then step to the next
    // point to get the direction of the approach leaving the node.
    const [n0, n1] = touchesStart
      ? [poly[0], poly[1]]
      : [poly[poly.length - 1], poly[poly.length - 2]];
    const dx = n1.x - n0.x;
    const dy = n1.y - n0.y;
    const len = Math.hypot(dx, dy) || 1;
    arms.push({
      id: link.id,
      dir: { x: dx / len, y: dy / len },
      origin: n0,
      outbound: touchesStart,
      width: roadWidth(link.lanes, linkStyle(doc, link.id)),
    });
  }
  return arms;
}

/**
 * How close two arm origins must be to count as **one drawn road end**.
 *
 * This absorbs float slack and nothing else. Two arms drawn to the same place
 * usually *are* the same object — `drawnPolyline` returns the layout polyline
 * unmodified for a centred link — and a straight divided waypoint offsets both
 * its links by the same distance along the same delta, which came out bitwise
 * identical in 314 of 400 scanned splits; the rest parted by at worst `2.84e-14`
 * (an instance, not a bound: the slack grows with distance from the world
 * origin). The nearest genuinely *distinct* pair of lateral shifts the UI can
 * produce is `0.45` apart, and the lane-drop step this must never merge is `4.5`.
 * So the guard sits six orders below the smallest decision and eight above the
 * largest slack, and it is never a design parameter.
 *
 * **Its own constant rather than {@link SAME_EDGE}'s**, which is the same
 * magnitude. The two answer different questions — are these lane edges at one
 * lateral offset; are these road ends at one point — and a shared constant is how
 * tuning one silently retunes the other (ramps spec §2.10.2).
 */
const SAME_POINT = 1e-6;

/**
 * Where a node's dots are drawn: **one per distinct arm origin**, so a divided
 * road's end is marked on each of its carriageways instead of once in the median
 * between them, and an aligned link's end is marked on the road rather than on
 * the polyline it stepped off (ramps spec §2.10).
 *
 * "Distinct" means distinct as a **position** — no angle, no mean, no grouping.
 * That is what makes the result a set rather than an ordering: a rule clever
 * enough to know that two same-side origins `4.5` apart belong together is a
 * clustering rule, and greedy clustering over a three-arm fan changes the number
 * of dots under a permutation of `doc.links`. So a divided waypoint with a lane
 * drop draws **four** dots, two overlapping on each side, which is what two road
 * ends at two places look like.
 *
 * The node keeps its own position: only the *mark* moves, and a drag still
 * dispatches `moveNode` with the node's own position.
 */
export function nodeDots(
  doc: Document,
  nodeId: NodeId,
  offsets: Record<LinkId, number>,
): Vec2[] {
  const p = nodePos(doc, nodeId);
  // No layout entry at all — the hand-edited case the node layer already guards.
  if (!p) return [];
  const arms = junctionArms(doc, nodeId, offsets);
  // A node no link touches keeps its dot at the node, and this is the ordinary
  // path rather than the edge case: every node is link-less between being placed
  // and being connected, so an arms-only rule would make the node tool look
  // broken on its first click (§2.10.3).
  if (!arms.length) return [p];
  const dots: Vec2[] = [];
  for (const arm of arms) {
    if (!dots.some((d) => distance(d, arm.origin) < SAME_POINT)) dots.push(arm.origin);
  }
  return dots;
}

/**
 * How far the outermost corner of any arm sits from the node. On an undivided
 * junction this is just half the widest road; a divided approach adds its step
 * off the centreline, and the glyph has to reach out to meet it.
 *
 * A **floor** on the size a glyph chooses, never a replacement: `0.62 w + 3 >
 * w / 2` for every road, so substituting would shrink every undivided pad ever
 * drawn. And the floor is unscaled world units while `scale` multiplies only the
 * base term, so shrinking a junction can no longer pull its glyph off the
 * carriageways it exists to join — below roughly half scale the Size control
 * simply stops shrinking it (ramps spec §2.2).
 */
function armReach(arms: Arm[], center: Vec2): number {
  return arms.length
    ? Math.max(...arms.map((a) => distance(a.origin, center) + a.width / 2))
    : 0;
}

/** The widest arm, or a default lane's road where a junction has none. */
function armWidth(arms: Arm[]): number {
  return arms.length ? Math.max(...arms.map((a) => a.width)) : MIN_ROAD_WIDTH;
}

/** The asphalt pad's radius — the five glyphs that are a paved area. */
export function padRadius(arms: Arm[], center: Vec2, scale: number): number {
  return Math.max((armWidth(arms) * 0.62 + 3) * scale, armReach(arms, center));
}

/** A roundabout's outer edge, which is its equivalent of the pad's rim. */
export function ringRadius(arms: Arm[], center: Vec2, scale: number): number {
  return Math.max(
    Math.max(20, armWidth(arms) * 1.35) * scale,
    armReach(arms, center),
  );
}

/**
 * How coarse the pad's outer arc may be: at most 10° between two chord ends.
 *
 * A chord falls short of its arc by `r * (1 - cos 5°)` — 0.10 units on a 4-lane
 * T and 0.47 on the largest pad this app can draw (8 lanes at the Inspector's
 * 2.5x Size), against a 1.5-unit edge line. The bound is stated because
 * containment passes for an inscribed arc at **any** chord density, so nothing
 * in the gate catches a coarse one (junction glyphs §2.2).
 */
const PAD_CHORD = (10 * Math.PI) / 180;

/** Where a lateral offset meets the rim, as an angle off the arm's own axis. */
function arcAngle(v: number, r: number): number {
  return Math.asin(Math.min(1, Math.max(-1, v / r)));
}

/** Two ring vertices the construction produced at the same place. */
function same(a: Vec2 | undefined, b: Vec2): boolean {
  return !!a && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

/**
 * The pad's outline: one closed ring per arm, all wound the same way, to be
 * filled as a single nonzero path. In the glyph's frame, so an arm enters as
 * `origin - center` and the disc is centred on the origin of that frame.
 *
 * One arm's ring is its **band** — every point at or ahead of the line through
 * the centre perpendicular to `dir`, within `width / 2` of the arm's own axis —
 * **intersected with the disc of radius `r`**. Two straight sides, a straight
 * inner cut, and an outer arc.
 *
 * **The pad is contained in the disc, and that containment is load-bearing.**
 * Three things measure to the rim ({@link rayCircleExit}, through the stop bars
 * and {@link junctionRadius}), all three assume a circle, and all three stay
 * correct only because no ring reaches past one. A band merely run out to the
 * rim with a flat end puts its corners at `sqrt(r² + (w/2)²)` — outside the hit
 * target, the halo, and the rim a marking was cleared from.
 *
 * Two consequences of the construction, each a way to get it wrong:
 *
 * - **Along its own arm the ring ends exactly where {@link rayCircleExit} says**,
 *   because a vertex is forced at that point. That is what makes the pad and the
 *   stop bar agree by construction rather than by coincidence, on a divided
 *   approach as much as an undivided one. It is a statement about the **ray**,
 *   not about the ring's furthest vertex: on a divided 2-lane approach the ray
 *   exits at 19.84 while the furthest vertex sits at 23.81.
 * - **The union is rendered, never computed.** The rings go out as subpaths of
 *   one `<path>` under the default nonzero rule, so overlapping bands read as one
 *   area with no boolean machinery. The cost is that **every ring winds the same
 *   way**, or two overlapping rings of opposite winding cancel into a hole.
 *
 * `[]` where there are no arms, which is the one case the glyph still draws as a
 * circle — a junction the human placed and has not yet joined must stay visible
 * and clickable, and an inscribed polygon would be a different drawing for no
 * reason.
 */
export function padShape(arms: Arm[], center: Vec2, r: number): Vec2[][] {
  if (r <= 0) return [];
  const rings: Vec2[][] = [];
  for (const arm of arms) {
    // The arm's own frame: `u` runs along it, `v` across. Both axes are unit and
    // `det[d, n] = 1`, so this is a rotation — which is what lets one vertex
    // order in here give one winding out there, for every arm.
    const d = arm.dir;
    const n = { x: -d.y, y: d.x };
    const ax = arm.origin.x - center.x;
    const ay = arm.origin.y - center.y;
    const c = ax * n.x + ay * n.y;
    const h = arm.width / 2;

    // The band's two sides, clipped to the disc. The reach floor keeps every
    // arm inside its own pad (`armReach`), so the clamp is defensive.
    const v0 = Math.max(-r, c - h);
    const v1 = Math.min(r, c + h);
    if (!(v1 > v0)) continue;

    const uv: Vec2[] = [
      { x: 0, y: v0 },
      { x: 0, y: v1 },
    ];
    // The outer arc, from the far side back to the near one, through the arm's
    // own ray exit. Splitting there is what makes the reach an equality.
    const a0 = arcAngle(v0, r);
    const a1 = arcAngle(v1, r);
    const ac = Math.min(a1, Math.max(a0, arcAngle(c, r)));
    for (const [from, to] of [
      [a1, ac],
      [ac, a0],
    ]) {
      const steps = Math.max(1, Math.ceil(Math.abs(to - from) / PAD_CHORD));
      for (let i = 0; i <= steps; i++) {
        const t = from + ((to - from) * i) / steps;
        uv.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
      }
    }

    // Back to the glyph's frame, dropping the points the construction repeats:
    // the split angle belongs to both half-arcs, `v1 === r` puts the first arc
    // point on the inner cut's own end, and `v0 === -r` closes onto the start.
    // All three are reachable, and all three are `Z` doubled back on itself.
    const ring: Vec2[] = [];
    for (const p of uv) {
      const w = { x: p.x * d.x + p.y * n.x, y: p.x * d.y + p.y * n.y };
      if (!same(ring[ring.length - 1], w)) ring.push(w);
    }
    if (same(ring[ring.length - 1], ring[0])) ring.pop();
    if (ring.length > 2) rings.push(ring);
  }
  return rings;
}

/** Twice a polygon's signed area — the sign alone is read, for its winding. */
function signedArea2(ring: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * The stretch of the ray from `p` along unit `d` that lies inside one **convex**
 * ring, as `[enter, exit]` in ray parameter, or `undefined` where it misses.
 *
 * Boundary-inclusive at every edge, which {@link rayPadExit} depends on.
 */
function raySpan(ring: Vec2[], p: Vec2, d: Vec2): [number, number] | undefined {
  const s = signedArea2(ring) >= 0 ? 1 : -1;
  let lo = -Infinity;
  let hi = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    // Outward normal of a→b, turned by the ring's own winding so the sign of
    // `num` means "outside" whichever way the vertices were ordered.
    const nx = s * (b.y - a.y);
    const ny = -s * (b.x - a.x);
    const num = (p.x - a.x) * nx + (p.y - a.y) * ny;
    const den = d.x * nx + d.y * ny;
    if (Math.abs(den) < 1e-12) {
      // Parallel to this edge: the whole ray is on one side of it. On the edge
      // itself counts as inside, so only a strictly positive `num` misses.
      if (num > 1e-9) return undefined;
      continue;
    }
    const t = -num / den;
    if (den > 0) hi = Math.min(hi, t);
    else lo = Math.max(lo, t);
  }
  return lo <= hi ? [lo, hi] : undefined;
}

/**
 * How far the pad reaches from `p` along unit `d` before **first** leaving it:
 * the ray-versus-pad exit, `0` when `p` is outside every ring. The union is not
 * convex, so a ray can leave and re-enter; only the contiguous run from `p`
 * counts.
 *
 * The ray analogue of {@link rayCircleExit}, for the shape that replaced the
 * circle — with one difference that is a trap rather than a detail: a point
 * **on** a ring's boundary counts as inside. The glyph centre lies exactly on
 * every band's inner cut by construction ({@link padShape}), so an
 * implementation that copies `rayCircleExit`'s strict outside-test returns `0`
 * for every ring and collapses every priority diamond to nothing.
 *
 * That convention is what gives the right answer three times over: on a T of
 * 4-lane roads the northward ray rides two bands' inner cuts and exits at their
 * own edge, 19.5; on a T whose through road is 1 lane it exits at 6; and on a
 * four-arm cross every direction runs down an arm and reaches the rim.
 */
export function rayPadExit(rings: Vec2[][], p: Vec2, d: Vec2): number {
  const spans: [number, number][] = [];
  for (const ring of rings) {
    const span = raySpan(ring, p, d);
    if (span) spans.push(span);
  }
  spans.sort((a, b) => a[0] - b[0]);

  let reach = 0;
  let started = false;
  for (const [lo, hi] of spans) {
    if (!started) {
      // Sorted by entry, so once a span starts ahead of `p` nothing behind it
      // can still cover `p` — the run either began by now or never begins.
      if (lo > 0) break;
      if (hi < 0) continue;
      started = true;
      reach = hi;
    } else if (lo <= reach) {
      reach = Math.max(reach, hi);
    } else break;
  }
  return started ? Math.max(0, reach) : 0;
}

/**
 * How far the glyph at `nodeId` reaches along its arms, or `undefined` where it
 * reaches nowhere — the radius an `end`-anchored marking measures its clearance
 * from ({@link markingAnchor}).
 *
 * **What is excluded is what has no radius to give**, and nothing else: a node
 * that is not a junction, a `gore` (paint *between* two arms rather than a disc
 * around a node), and a junction with no arms at all. Each falls back to the
 * node itself, which is where every marking measured before this existed.
 *
 * A **roundabout is not excluded** — its ring buries an approach arrow exactly
 * as a pad does, and `ro` is as real a radius as `rp`. That is worth stating
 * because the obvious list to reach for is the one that skips it, and the
 * reasons are not transferable: the drawn movement arcs this rule once had to
 * be read against skipped a roundabout because an arc on one would be a chord
 * across its own island. An anchor has no such reason.
 */
export function junctionRadius(
  doc: Document,
  nodeId: NodeId,
  offsets: Record<LinkId, number>,
): number | undefined {
  return junctionRim(doc, nodeId, offsets)?.radius;
}

/** A glyph's rim and the arms it was sized from, in one pass over the links. */
function junctionRim(
  doc: Document,
  nodeId: NodeId,
  offsets: Record<LinkId, number>,
): { radius: number; arms: Arm[]; center: Vec2 } | undefined {
  if (findNode(doc, nodeId)?.type !== "junction") return undefined;
  const center = nodePos(doc, nodeId);
  if (!center) return undefined;
  const view = doc.layout.junctions[nodeId];
  const glyph = view?.glyph ?? "generic";
  if (glyph === "gore") return undefined;
  const arms = junctionArms(doc, nodeId, offsets);
  if (!arms.length) return undefined;
  const scale = view?.scale ?? 1;
  const radius =
    glyph === "roundabout"
      ? ringRadius(arms, center, scale)
      : padRadius(arms, center, scale);
  return { radius, arms, center };
}

/**
 * How far back from a link's drawn end the glyph there reaches — the clearance an
 * `end`-anchored marking is pushed out by, so its `position` is measured from the
 * **rim** rather than from the node buried inside it.
 *
 * **The same expression the stop bar is placed with** (`Diagram.tsx`'s
 * `jn-stopbar`), which is the whole argument for routing the anchor through here:
 * the paint a human puts at a junction and the paint the glyph draws itself can no
 * longer disagree about where the road meets the glyph.
 *
 * Measured from *this link's own carriageway* rather than from the node, so a
 * divided approach gets its own half's clearance — `Arm.origin` **is** this
 * polyline's end point, which is what makes the ray distance and the arc-length
 * walked back from that end the same number. `0` where there is no glyph to clear
 * (an `endpoint` or `waypoint`, a `gore`, a junction with no arms), which is the
 * end-node measurement every marking used before this existed.
 */
function rimClearance(
  doc: Document,
  link: Link,
  offsets: Record<LinkId, number>,
): number {
  const rim = junctionRim(doc, link.to_node, offsets);
  const arm = rim?.arms.find((a) => a.id === link.id);
  if (!rim || !arm) return 0;
  return rayCircleExit(
    { x: arm.origin.x - rim.center.x, y: arm.origin.y - rim.center.y },
    arm.dir,
    rim.radius,
  );
}

/** Where a point falls on a polyline: how far along it, and how far off it. */
export interface PolylineHit {
  /** Arc-length from the polyline's start to the nearest point on it. */
  along: number;
  /**
   * Signed lateral distance from that point, in the frame
   * {@link offsetPolyline} takes — so `offsetPolyline(pts, d)` measures back as
   * exactly `+d`, and the sign agrees with {@link laneBands}' offsets.
   */
  offset: number;
}

/**
 * Where `p` lands on `points` — the input the marking tool turns into a
 * `position` and a lane (markings spec §2.4).
 *
 * **The offset is signed, not a distance**, because that sign is the whole of
 * which lane was clicked: `laneBands` puts the nearside lane at the most
 * positive offset, and a magnitude would put every click in the nearside half.
 *
 * **A point past either end lands on that end**, which falls out of clamping the
 * projection parameter to `[0, 1]` rather than being a case of its own. So a
 * click off the end of a road places a marking at the end of it, and never at a
 * negative distance along.
 *
 * A degenerate polyline — fewer than two points, or every segment zero-length —
 * gives `{ along: 0, offset: 0 }`, the same floor the rest of this module takes
 * with input only a hand-edited document can produce.
 */
export function nearestOnPolyline(points: Vec2[], p: Vec2): PolylineHit {
  let best: PolylineHit = { along: 0, offset: 0 };
  let bestDist = Infinity;
  let travelled = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < SAME_EDGE) continue;
    // Clamped, so a point beyond a segment projects onto its nearer end.
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    const dist = Math.hypot(p.x - qx, p.y - qy);
    if (dist < bestDist) {
      bestDist = dist;
      // The segment's own normal, which is `segmentNormals`' — positive to the
      // right of travel as drawn, so the sign matches `offsetPolyline`'s `d`.
      best = {
        along: travelled + len * t,
        offset: (p.x - qx) * (-dy / len) + (p.y - qy) * (dx / len),
      };
    }
    travelled += len;
  }

  return best;
}

/** A point on a polyline and the direction of travel through it. */
export interface PolylinePoint {
  at: Vec2;
  /** Unit direction along the segment `at` lies on. */
  dir: Vec2;
  /**
   * Which segment that is, as an index into the **polyline's own** points:
   * `points[segment] → points[segment + 1]`.
   *
   * **The polyline's index, never the walk's** (link bends spec OQ-1). The walk
   * below skips segments too short to have a direction, so a link carrying a
   * duplicate bend makes the two disagree — and a bend spliced at the walk's
   * index would land one place off, which is a spike in the road rather than a
   * vertex a pixel out.
   *
   * Non-optional, because the no-walk case is already modelled: a polyline with
   * nothing to walk gives `undefined` for the whole {@link PolylinePoint}, so
   * there is no state left for an absent field to stand for. It rides on this
   * type rather than on {@link PolylineHit} because the insertion index belongs
   * to the **layout** polyline, which is the one this function walks; the two
   * frames disagree about where an interior vertex sits (link bends §2.6).
   */
  segment: number;
}

/**
 * How far it is from one end of `points` to the other, skipping segments too
 * short to have a direction.
 *
 * **The `SAME_EDGE` filter is what makes this the right total rather than merely
 * a plausible one**: {@link nearestOnPolyline} and {@link pointAlongPolyline}
 * both walk the same filtered segments, so a distance measured against this one
 * converts between their two frames exactly (see {@link anchoredAlong}) rather
 * than to within a few float slacks. Written as a plain sum of point-to-point
 * distances it would drift from both.
 */
export function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    if (len < SAME_EDGE) continue;
    total += len;
  }
  return total;
}

/**
 * A distance in the other end's frame — `total - distance` for a marking
 * anchored to the `end` of its road, and `distance` untouched for one anchored
 * to the `start`.
 *
 * **Its own inverse**, which is the whole reason it is one function: the drawing
 * turns a marking's stored metres into an arc-length from the polyline's start
 * ({@link markingAnchor}), and a drag turns an arc-length back into stored
 * metres (`projectOntoLink`). Two expressions could disagree about which
 * direction subtracts; one cannot.
 */
export function anchoredAlong(
  total: number,
  distance: number,
  anchor: LinkEnd | undefined,
): number {
  return anchor === "end" ? total - distance : distance;
}

/**
 * The point `along` world units from the start of `points`, and the direction of
 * travel there — the inverse of {@link nearestOnPolyline}'s `along`.
 *
 * **`along` is clamped to the polyline**, which is what keeps a marking on a road
 * the user has since shortened by dragging a node: its stored metres may now
 * exceed the drawn length, and the marking sits at whichever end is furthest from
 * its own anchor rather than off the road (markings spec §2.2; an end-anchored
 * marking resolves to a *negative* `along`, so it piles up at the start). The
 * clamp is deliberately applied to the resolved distance rather than the stored
 * one. `undefined` for a polyline with no length to walk, the same posture
 * {@link endDirection} takes.
 */
export function pointAlongPolyline(
  points: Vec2[],
  along: number,
): PolylinePoint | undefined {
  // `index` is the point's own index in `points`, carried rather than inferred
  // from this array's position: the `continue` below skips degenerate segments,
  // so the two run apart the moment a polyline carries a duplicate vertex.
  const segments: { a: Vec2; dir: Vec2; len: number; index: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < SAME_EDGE) continue;
    segments.push({
      a,
      dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
      len,
      index: i,
    });
  }
  // Not `polylineLength(points) === 0`: an empty polyline and two identical
  // points both measure zero, and both must return nothing rather than walk.
  if (segments.length === 0) return undefined;

  let remaining = Math.min(polylineLength(points), Math.max(0, along));
  for (const s of segments) {
    if (remaining <= s.len) {
      return {
        at: { x: s.a.x + s.dir.x * remaining, y: s.a.y + s.dir.y * remaining },
        dir: s.dir,
        segment: s.index,
      };
    }
    remaining -= s.len;
  }
  // Only reachable on float slack at exactly `total`: the last segment's far end.
  const last = segments[segments.length - 1];
  return {
    at: { x: last.a.x + last.dir.x * last.len, y: last.a.y + last.dir.y * last.len },
    dir: last.dir,
    segment: last.index,
  };
}

/** Where a bend is to be spliced into a link's layout polyline. */
export interface BendInsertion {
  /** The point itself, in the **layout** polyline's frame. */
  pos: Vec2;
  /**
   * The layout segment it landed on, which is also its index in `LinkView.bends`
   * — a polyline is `[from, ...bends, to]`, so splicing at segment `i` puts the
   * new vertex at `bends[i]`.
   */
  index: number;
}

/**
 * Where a press on a road puts a bend: the pointer's place along the polyline
 * the road is **drawn** along, answered in the polyline it is **routed** along
 * (link bends spec §2.6).
 *
 * **The two frames are not the same road, and that is the whole reason this
 * exists.** A divided or aligned link is drawn `lateralShift` off its layout
 * polyline, so storing the raw pointer position steps the road sideways the
 * instant a bend is minted. Worse, the two put an interior vertex at *different
 * fractions* of arc length, because offsetting lengthens the outer segment and
 * shortens the inner one: on layout `A(0,0) → B(50,0) → C(50,150)` at `d` 13.5
 * the bend sits at fraction 0.211 drawn against 0.250 layout, so a press at drawn
 * length 40 is on **drawn** segment 1 while its layout point is on **layout**
 * segment 0. Splice at the drawn index and the route doubles back on itself — a
 * spike, in a band about 6.75 drawn units either side of every existing bend.
 *
 * So the arc length transfers by the two totals and **the index comes out of the
 * same walk as the point**, never from the drawn polyline and never from
 * anywhere else. One walk, one answer, and the two cannot disagree by
 * construction.
 *
 * The conversion is exactly `Canvas.tsx:projectOntoLink`'s for metres, since
 * {@link pointAlongPolyline} takes an absolute length rather than a fraction.
 * `undefined` for a polyline with nothing to walk, that function's own posture.
 *
 * **Valid only because {@link offsetPolyline} preserves vertex count and order**
 * (§2.4), which is what makes a segment index mean the same thing in both frames
 * even where the arc lengths do not.
 */
export function bendInsertion(
  layout: Vec2[],
  drawn: Vec2[],
  world: Vec2,
): BendInsertion | undefined {
  const drawnLength = polylineLength(drawn);
  if (drawnLength < SAME_EDGE) return undefined;
  const { along } = nearestOnPolyline(drawn, world);
  const at = pointAlongPolyline(
    layout,
    (along / drawnLength) * polylineLength(layout),
  );
  return at && { pos: at.at, index: at.segment };
}

/**
 * The lane band a **signed lateral offset** falls in, or `undefined` for none.
 *
 * The other half of a click on a road: {@link nearestOnPolyline} answers *how far
 * along*, and this answers *which lane* from the same hit's `offset`. Outside
 * every band — the casing lip, or the fat invisible hit path either side of the
 * road — means the whole carriageway, which is what an absent `lane` says.
 */
export function bandAt(bands: LaneBand[], offset: number): LaneIdx | undefined {
  const i = bands.findIndex((b) => Math.abs(offset - b.offset) <= b.width / 2);
  return i < 0 ? undefined : i;
}

/**
 * The lane **boundary** nearest a signed lateral offset, or `undefined` when the
 * road has none.
 *
 * {@link bandAt}'s counterpart for the one kind whose `lane` names a boundary
 * rather than a lane, and the reason it exists is that the two indexes are *not*
 * interchangeable: a road with `n` lanes has `n-1` boundaries, so a band index
 * can land on `n-1`, for which {@link boundaryOffset} returns `undefined` and the
 * marking is **not drawn at all** — invisible, unselectable, and recoverable only
 * by undo (lane arrows Phase 1; the Inspector's Span control withholds the same
 * index for the same reason).
 *
 * *Nearest*, not *containing*: boundaries are lines rather than strips, so there
 * is nothing to be inside of and every offset has an answer. A single-lane road
 * has no boundary to name and returns `undefined`, which {@link boundaryOffset}
 * reads as the centreline — the only place such a line can go.
 */
export function boundaryAt(
  bands: LaneBand[],
  offset: number,
): LaneIdx | undefined {
  let best: LaneIdx | undefined;
  let bestDist = Infinity;
  for (let i = 0; i < bands.length - 1; i++) {
    const at = boundaryOffset(bands, i);
    if (at === undefined) continue;
    const dist = Math.abs(offset - at);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Everything a marking is drawn from: a point, a direction, and a span. */
export interface MarkingAnchor extends PolylinePoint {
  /**
   * The strip of road it paints across — one {@link laneBands} entry, or the
   * whole lane region when the marking spans the carriageway.
   */
  span: LaneBand;
}

/**
 * Where a marking sits on the road it is painted on, or `undefined` if it cannot
 * be drawn.
 *
 * The one place `Marking.position`'s **metres** become world units. Metres are
 * what the model documents and what Assimilator's own `crossings`/`detectors`
 * positions mean, and the placement gesture is what keeps that painless: the user
 * never types a distance, the click divides by {@link UNITS_PER_METRE}, and this
 * multiplies back (markings spec §2.2).
 *
 * **`Marking.anchor` picks which end that distance is measured from**, through
 * {@link anchoredAlong} — an `end`-anchored marking holds its distance from the
 * far end while the road's drawn length changes under it, which is what
 * auto-placed paint needs (lane arrows §2.3). It does **not** flip `dir`: an
 * arrow measured back from the junction still points the way the road runs.
 *
 * **That end is the glyph's rim, not the node** ({@link rimClearance}, lane
 * arrows Phase 5). The node sits *inside* the junction it names, and the pad
 * drawn around it is opaque and painted over this layer, so a marking measured to
 * the node is a marking measured to somewhere it cannot be seen. The rim is also
 * what the glyph's own stop bar measures to, so the two now share one expression.
 * Where there is no glyph — an `endpoint`, a `gore`, a junction with no arms —
 * the clearance is zero and this is the end-node measurement unchanged.
 *
 * **Four ways a marking is skipped rather than drawn**, all of them reachable
 * only from an imported or hand-edited document — the cascades in `state.ts`
 * cover every edit the app itself can make (§2.5). Indexing `laneBands` out of
 * range yields `undefined` and then `NaN` coordinates, which SVG renders as an
 * invisible-but-corrupt path, so each returns nothing at all instead:
 *
 * - the `link` names no link in the document;
 * - that link has no drawable polyline, or none with any length;
 * - `position` is not a finite number;
 * - `lane` is outside the link's lanes.
 *
 * `lane` absent means the whole carriageway, whose span is the **lane region** —
 * summed from the bands rather than taken as `roadWidth - ROAD_MARGIN`, which
 * would carry the casing lip through a needless round trip.
 *
 * **One kind-aware line, and only one:** a `turn_arrow` has no carriageway-wide
 * meaning (markings spec §2.7), so a lane-less one falls back to the **nearside**
 * band rather than spanning the road. It lives here rather than in
 * {@link markingArrow} so the hit target and the halo move with it — a halo that
 * highlights a strip the arrow is not painted on misreports the span at the
 * moment the user is looking at it.
 */
export function markingAnchor(
  doc: Document,
  marking: Marking,
  offsets: Record<LinkId, number>,
): MarkingAnchor | undefined {
  const link = findLink(doc, marking.link);
  if (!link) return undefined;
  const points = drawnPolyline(doc, link, offsets);
  if (!points || points.length < 2) return undefined;

  // An `end`-anchored marking measures from the **rim** of whatever glyph sits at
  // the `to_node`, not from the node itself — which is inside it. The clearance
  // is added to the stored distance rather than subtracted from the total, so the
  // clamp below still catches an over-long marking at the polyline's start.
  // A `start` anchor takes no such term: nothing asked for one, and adding it
  // would move the paint in every document already saved.
  const along = anchoredAlong(
    polylineLength(points),
    marking.position * UNITS_PER_METRE +
      (marking.anchor === "end" ? rimClearance(doc, link, offsets) : 0),
    marking.anchor,
  );
  if (!Number.isFinite(along)) return undefined;
  const at = pointAlongPolyline(points, along);
  if (!at) return undefined;

  const bands = laneBands(link.lanes, linkStyle(doc, link.id));
  let span: LaneBand;
  if (marking.lane === undefined) {
    span =
      marking.kind.type === "turn_arrow"
        ? bands[0]
        : { offset: 0, width: bands.reduce((s, b) => s + b.width, 0) };
  } else {
    const band = bands[marking.lane];
    if (!band) return undefined;
    span = band;
  }

  return { ...at, span };
}

/**
 * The two ends of a transverse bar across a marking's span — a stop line, and the
 * baseline every other transverse kind is built on.
 *
 * Both the band's centre offset and its half-width run along the same normal, so
 * the whole bar is one expression and there is no side to name twice. The normal
 * is the right of travel, matching {@link laneBands} and `jointEnd`'s `nearside`.
 */
export function markingBar(anchor: MarkingAnchor): [Vec2, Vec2] {
  const { at, dir, span } = anchor;
  const nx = -dir.y;
  const ny = dir.x;
  const near = span.offset - span.width / 2;
  const far = span.offset + span.width / 2;
  return [
    { x: at.x + nx * near, y: at.y + ny * near },
    { x: at.x + nx * far, y: at.y + ny * far },
  ];
}

/**
 * How deep a crossing runs along the road, in world units.
 *
 * A schematic build constant in the manner of {@link TAPER_LENGTH}, not a
 * converted model quantity — a real zebra is roughly 4 m, which lands near this
 * anyway, but nothing in the model carries a crossing depth to convert. A lane
 * and a third, which reads as a crossing rather than as a fat stop line
 * (markings spec OQ-2).
 */
export const CROSSWALK_DEPTH = 12;

/** How far a give-way row reaches along the road: the length of one tooth. */
export const GIVE_WAY_DEPTH = 5;

/**
 * The rhythm both tiled kinds are laid out on — a third of a default lane, so a
 * lane gets three teeth or three stripes and a 3-lane carriageway nine.
 *
 * **One constant, not one per kind**, so a give-way row and a crossing on the
 * same road read as the same hand. It is a *target*: the actual pitch is derived
 * from the span so the cells tile it exactly (see {@link spanCells}).
 *
 * A third rather than a half, decided in the app: two teeth to a lane read as
 * two arrows rather than as a row, which is the thing a give-way line has to say.
 */
export const MARKING_PITCH = LANE_PX / 3;

/**
 * A marking's span divided into equal cells of roughly {@link MARKING_PITCH} —
 * the shared tiling every repeated kind is built on.
 *
 * **The count is derived from the span and the pitch follows**, rather than the
 * other way round: the cells then tile the span *exactly*, with no partial cell
 * at either end. That is what makes containment a property of the construction
 * rather than a clamp each kind has to remember — a shape occupying any fraction
 * of its own cell is inside the lane at every lane count and every road class,
 * and a stripe on the verge is the failure this rules out.
 */
function spanCells(span: LaneBand): { centres: number[]; pitch: number } {
  const count = Math.max(1, Math.round(span.width / MARKING_PITCH));
  const pitch = span.width / count;
  const lo = span.offset - span.width / 2;
  return {
    centres: Array.from({ length: count }, (_, i) => lo + pitch * (i + 0.5)),
    pitch,
  };
}

/**
 * A point on a marking, from its lateral offset across the road and its
 * longitudinal offset along it — the one frame every kind below is built in.
 *
 * The normal is {@link markingBar}'s, which is {@link laneBands}' and
 * {@link offsetPolyline}'s: positive is the right of travel, and no kind gets to
 * pick a second sign convention.
 *
 * Takes a bare {@link PolylinePoint} rather than a {@link MarkingAnchor} — it
 * never reads the band — so {@link lengthLabel}, which has no band to read, steps
 * off a road in this same frame instead of writing the arithmetic out again.
 */
function markingPoint(
  anchor: PolylinePoint,
  across: number,
  along: number,
): Vec2 {
  const { at, dir } = anchor;
  return {
    x: at.x - dir.y * across + dir.x * along,
    y: at.y + dir.x * across + dir.y * along,
  };
}

/** What share of its cell a give-way tooth's base takes; the rest is the gap. */
const TOOTH_DUTY = 0.7;
/** What share of its cell a zebra stripe takes. Near half, so paint and gap read alike. */
const STRIPE_DUTY = 0.55;

/**
 * A give-way line: one triangle per cell across the marking's span.
 *
 * **The apex points upstream, at the driver**, who arrives from behind the
 * marking — so the bases sit downstream and a reader sees the points aimed at
 * them (markings spec §2.7). Getting this backwards draws a row of arrowheads
 * telling traffic to keep going, which no assertion on a magnitude would catch.
 *
 * Centred on `position`, as every transverse kind is: a bar has no depth and so
 * is trivially centred, and a give-way row placed where a stop line sits covers
 * the same stretch of road.
 */
export function markingTeeth(anchor: MarkingAnchor): Vec2[][] {
  const { centres, pitch } = spanCells(anchor.span);
  const half = (pitch * TOOTH_DUTY) / 2;
  const back = GIVE_WAY_DEPTH / 2;
  return centres.map((c) => [
    markingPoint(anchor, c, -back),
    markingPoint(anchor, c - half, back),
    markingPoint(anchor, c + half, back),
  ]);
}

/**
 * A crossing: zebra stripes **parallel to travel**, tiled across the span over
 * {@link CROSSWALK_DEPTH}, centred on `position`.
 *
 * Stripes run along the road rather than across it, which is what distinguishes
 * a crossing from the transverse kinds at a glance — and what makes the depth a
 * constant of its own rather than a stroke width.
 */
export function markingZebra(anchor: MarkingAnchor): Vec2[][] {
  const { centres, pitch } = spanCells(anchor.span);
  const half = (pitch * STRIPE_DUTY) / 2;
  const back = CROSSWALK_DEPTH / 2;
  return centres.map((c) => [
    markingPoint(anchor, c - half, -back),
    markingPoint(anchor, c + half, -back),
    markingPoint(anchor, c + half, back),
    markingPoint(anchor, c - half, back),
  ]);
}

/**
 * How far a turn arrow runs along the road, in world units.
 *
 * A schematic build constant like {@link CROSSWALK_DEPTH}, and **fixed rather
 * than band-derived**: two default lanes long, near the 2:1 a real turn arrow
 * cuts in a real lane. It is the arrow's whole footprint at every direction set,
 * forward or back — which is what a *rear* branch spends the shaft to keep: a
 * two-headed arrow shortens the shaft to `-fork → fork` and gives the length
 * back to the head it grew, rather than reaching further up the road than a
 * single-headed one (markings §2.11). Adding a **forward** branch still never
 * moves anything.
 */
export const TURN_ARROW_LENGTH = 15;

/**
 * How far a branch reaches from the fork, as a fraction of the band width.
 *
 * **This one number is the whole containment rule.** Every point of every branch,
 * for all six directions, lands within `ARROW_REACH * width` of the band centre —
 * so paint on the verge is ruled out by the construction rather than by a clamp
 * each direction has to remember, exactly as {@link spanCells} rules it out for
 * the tiled kinds. Everything below is sized to keep that true, and it is under a
 * half, which is where the lane ends.
 */
const ARROW_REACH = 0.42;
/** A head's length along its own branch, as a fraction of the band width. */
const ARROW_HEAD_LENGTH = 0.3;
/** A head's half-width across it — a head twice as wide as the stem it caps. */
const ARROW_HEAD_HALF = 0.17;
/** How wide the shaft and the stems are stroked. */
const ARROW_STEM = 0.16;
/** Segments in the `u_turn` hook's semicircle: 15° each, a hundredth of a unit of chord. */
const HOOK_STEPS = 12;

/**
 * Each straight branch's bearing off the direction of travel, in radians and
 * **positive toward the right of travel** — the sign {@link markingPoint}'s
 * `across` takes, so `left` is negative (markings spec §2.7).
 *
 * `u_turn` is absent deliberately rather than sitting here at π: it is a hook,
 * not a stub, and a stub at 180° would draw a head on a stem running straight
 * back down the shaft.
 */
const BRANCH_BEARING: Record<Exclude<TurnDirection, "u_turn">, number> = {
  through: 0,
  slight_left: -Math.PI / 6,
  slight_right: Math.PI / 6,
  left: -Math.PI / 2,
  right: Math.PI / 2,
};

/**
 * How far **upstream** of the shaft's own fork each direction leaves it, as a
 * fraction of the arrow's stagger budget — the whole of markings spec §2.12.
 *
 * Every branch used to fork at one point, so left and right sat 180° apart across
 * a band only `2 * ARROW_REACH` wide with a head between them, and three
 * directions drew a four-pointed star. The heads are separated **along the road**
 * instead, which is the axis with room: `through` keeps the shaft's own fork and
 * runs to the arrow's end, and the harder a branch turns the earlier it leaves.
 *
 * **A table rather than a formula on the bearing**, which was the first draft: the
 * two slights are equally hard, so a formula gives them the *same* fork, and two
 * ±30° heads at a shared fork intersect at every fork position there is. So each
 * of the six carries its own — `u_turn` included, the one direction
 * {@link BRANCH_BEARING} deliberately has no entry for. The `Record` is
 * exhaustive, so a seventh {@link TurnDirection} will not build.
 *
 * **Per-direction, not per-count**, which is what makes an arrow set-invariant: a
 * count-keyed rule would visibly rearrange a `right` head when `left` is toggled.
 * The price, stated rather than hidden, is that *every* arrow but a lone `through`
 * changed shape when this landed — a lone `left` forks where `left` always forks.
 *
 * **A fraction of the budget, not of the band and not in world units.** The budget
 * is `TURN_ARROW_LENGTH - 2 * reach`, which is exactly twice the shaft's fork, and
 * keying to it makes `≤ 1` do two jobs at once at every band width **by
 * construction rather than by a clamp**, as {@link ARROW_REACH} does across the
 * band and {@link spanCells} does for the tiled kinds:
 *
 * - a `u_turn` head apex lands at `-TURN_ARROW_LENGTH / 2 + budget * (1 - s)`, so
 *   the arrow keeps its footprint — which is what {@link TURN_ARROW_LENGTH}'s own
 *   claim, and `ARROW_SETBACK_METRES`'s in `import.rs`, rest on;
 * - a fork lands at `forkAt - s * budget ≥ -forkAt`, so it stays **on** the shaft,
 *   including the shortened one a rear branch draws (§2.11).
 *
 * The order is hardness, and **only the pair that needs splitting is split.** The
 * spec proposed splitting both, then granted the tuning pass this freedom, and the
 * app took it: `left` and `right` are across-disjoint at any *shared* fork, so the
 * split buys nothing there, and a sub-unit one — all the budget can spare — draws
 * a barb pair that is symmetric except for a wobble, which reads as a slip rather
 * than as a decision. Sharing draws the barbs a real painted arrow has. The two
 * slights need it and get it: at ±30° they overlap across the band, so a shared
 * fork puts their heads through each other at every fork position there is.
 *
 * Values settled in the app against the measure the suite now holds — no two heads
 * intersecting, minimum **0.487 units** of clear asphalt on a default lane, and
 * wider on every narrower one.
 */
const BRANCH_STAGGER: Record<TurnDirection, number> = {
  through: 0,
  slight_right: 0.35,
  slight_left: 0.55,
  right: 0.75,
  left: 0.75,
  u_turn: 0.9,
};

/**
 * Where a point of a turn arrow lands, from `across` the band and `along` the
 * road — the frame every branch below is built in.
 *
 * There are two of them and that is the whole of the second head: the driver's
 * own, and the oncoming driver's, which is the first rotated 180° about the band
 * centre. Every builder takes one rather than closing over a single frame, so a
 * rear branch is the same code read in the other frame.
 */
type ArrowFrame = (across: number, along: number) => Vec2;

/** One direction of a turn arrow: a stem off the shaft, ending in a head. */
export interface ArrowBranch {
  /**
   * **Its own** fork to the centre of the head's base — one segment for a stub,
   * and an arc plus a return leg for `u_turn`. Which point on the shaft that fork
   * is comes from {@link BRANCH_STAGGER}, so two branches of one arrow rarely
   * share it.
   */
  stem: Vec2[];
  /** `[apex, base, base]`, pointing where the branch goes. */
  head: [Vec2, Vec2, Vec2];
}

/** A turn arrow: one shaft, and one branch per direction. */
export interface TurnArrow {
  /**
   * `[tail, fork]` — the one shaft every branch leaves, though each leaves it at
   * the point its own direction picks ({@link BRANCH_STAGGER}) rather than at the
   * far end. `fork` here is the far end, which is where `through` leaves and
   * where the paint stops.
   *
   * The same for every *forward* direction set; a rear branch shortens the tail
   * to `-fork`, so the two-headed arrow is symmetric and keeps
   * {@link TURN_ARROW_LENGTH} as its footprint.
   */
  shaft: [Vec2, Vec2];
  branches: ArrowBranch[];
  /**
   * How wide to stroke the shaft and the stems. Derived from the band and so
   * carried here rather than set in `diagram.css`, exactly as a lane band's own
   * width is: an arrow in a narrow ramp lane is a narrower arrow.
   */
  stroke: number;
}

/**
 * A turn arrow: **one shaft up the lane's centre and one branch per direction**,
 * so a shared through/right lane draws one arrow with two branches rather than
 * two arrows (markings spec §2.7).
 *
 * Five directions are straight stubs at the bearings {@link BRANCH_BEARING}
 * tabulates. The sixth, `u_turn`, is a 180° hook that turns back alongside the
 * shaft with its head pointing **at the driver** — and it hooks *left*, the
 * U-turn side under the right-hand traffic {@link laneBands} already assumes.
 *
 * **Each branch leaves the shaft where its own direction says**
 * ({@link BRANCH_STAGGER}), which is what keeps left + through + right reading as
 * three turns rather than as a four-pointed star: the heads are separated along
 * the road, the axis that has room, since the band is only `2 * ARROW_REACH` wide
 * (markings spec §2.12). `through` alone keeps the shaft's own fork.
 *
 * **The hook's radius is derived, not picked.** §2.7 proposes a quarter of the
 * band width, but that puts the return leg at `2R = width/2` — the band edge,
 * before the head is even added — and the same paragraph makes containment the
 * thing that bounds the radius. So `2R + headHalf = reach`: the hook's head
 * reaches exactly as far sideways as a hard stub's apex, and {@link ARROW_REACH}
 * alone bounds all six directions.
 *
 * `back` paints a **second head, at the upstream end and pointing upstream** —
 * the two-way left-turn lane of markings §2.11. Its directions are read in the
 * oncoming driver's frame, which is the one thing about it that is not obvious:
 * a rear `left` is left *for the driver it faces*, the opposite side of the road.
 * See {@link ArrowFrame}.
 *
 * `undefined` for an arrow with no **forward** directions it can draw — an empty
 * list, or one only a hand-edited document could hold. A bare shaft would read as
 * a lane line, which is worse than the placeholder bar the caller falls back to.
 * A `back`-only arrow lands there too, and is unreachable from the panel.
 */
export function markingArrow(
  anchor: MarkingAnchor,
  directions: TurnDirection[],
  back?: TurnDirection[],
): TurnArrow | undefined {
  const width = anchor.span.width;
  const reach = ARROW_REACH * width;
  const headLength = ARROW_HEAD_LENGTH * width;
  const headHalf = ARROW_HEAD_HALF * width;
  // Where the shaft ends, so a `through` branch's apex lands exactly on the
  // arrow's downstream end. Every other direction leaves it earlier.
  const forkAt = TURN_ARROW_LENGTH / 2 - reach;
  // The room the arrow has to stagger in: `TURN_ARROW_LENGTH - 2 * reach`, which
  // is twice the fork. Floored at zero so a band too wide to have any — one whose
  // reach alone spends the arrow's length — collapses to a single shared fork
  // rather than staggering *downstream*, which is the one thing an offset must
  // never do. See {@link BRANCH_STAGGER} for what the fraction buys.
  const budget = Math.max(0, 2 * forkAt);
  const forkOf = (d: TurnDirection) => forkAt - BRANCH_STAGGER[d] * budget;

  /** A point in the arrow's own frame: `across` from the band centre, `along` from `position`. */
  const at: ArrowFrame = (across, along) =>
    markingPoint(anchor, anchor.span.offset + across, along);

  /**
   * The **oncoming driver's frame**, and it is one flip rather than two sign
   * changes distributed through the builders below.
   *
   * {@link markingPoint} is affine — `P = at + across·n + along·d` — so negating
   * both terms is a 180° rotation about the band centre at the marking's
   * position, and it carries `stub`, `hook` and `head` into the facing frame
   * wholesale, all six directions included. Negating `along` alone would draw a
   * two-way left-turn lane with **both heads swinging the same way**: a rear
   * `left` is left for the driver it faces, which is the other side of the road.
   */
  const facing: ArrowFrame = (across, along) => at(-across, -along);

  /** A head with its apex at `(across, along)`, pointing along the unit `(da, dl)`. */
  const head = (
    frame: ArrowFrame,
    across: number,
    along: number,
    da: number,
    dl: number,
  ): [Vec2, Vec2, Vec2] => {
    const ba = across - da * headLength;
    const bl = along - dl * headLength;
    return [
      frame(across, along),
      frame(ba - dl * headHalf, bl + da * headHalf),
      frame(ba + dl * headHalf, bl - da * headHalf),
    ];
  };

  const stub = (
    frame: ArrowFrame,
    bearing: number,
    fork: number,
  ): ArrowBranch => {
    const da = Math.sin(bearing);
    const dl = Math.cos(bearing);
    const base = reach - headLength;
    return {
      stem: [frame(0, fork), frame(da * base, fork + dl * base)],
      head: head(frame, da * reach, fork + dl * reach, da, dl),
    };
  };

  const hook = (frame: ArrowFrame, fork: number): ArrowBranch => {
    const r = (reach - headHalf) / 2;
    const stem: Vec2[] = [];
    // Centred a radius to the left of the fork, so the arc leaves it heading
    // downstream and arrives at `-2r` heading back upstream.
    for (let i = 0; i <= HOOK_STEPS; i++) {
      const t = (Math.PI * i) / HOOK_STEPS;
      stem.push(frame(-r + r * Math.cos(t), fork + r * Math.sin(t)));
    }
    stem.push(frame(-2 * r, fork - reach + headLength));
    return { stem, head: head(frame, -2 * r, fork - reach, 0, -1) };
  };

  const branchesIn = (frame: ArrowFrame, ds: TurnDirection[]): ArrowBranch[] => {
    const built: ArrowBranch[] = [];
    for (const d of ds) {
      // A direction the model does not name reaches here only from a hand-edited
      // document, and would put a `NaN` bearing into the markup — so it is
      // skipped on the same terms `markingAnchor` skips an unknown link.
      // The fork goes in through the **frame**, not on to the point that comes
      // back out, so §2.11's flip carries the stagger into the oncoming driver's
      // frame with no second expression. Added outside, a rear branch would
      // stagger the wrong way along the road and a two-way left-turn lane would
      // draw asymmetrically — plausible, and wrong.
      if (d === "u_turn") built.push(hook(frame, forkOf(d)));
      else if (d in BRANCH_BEARING)
        built.push(stub(frame, BRANCH_BEARING[d], forkOf(d)));
    }
    return built;
  };

  const branches = branchesIn(at, directions);
  if (branches.length === 0) return undefined;
  const rear = branchesIn(facing, back ?? []);

  return {
    // Symmetric **iff a rear branch was actually built**, which is what makes
    // the reflection exact when there is something to reflect and leaves every
    // existing arrow untouched when there is not: `back: []` and a `back` naming
    // only directions the model does not know both keep the single-headed shaft,
    // with no arm of their own.
    shaft: [
      at(0, rear.length ? -forkAt : -TURN_ARROW_LENGTH / 2),
      at(0, forkAt),
    ],
    branches: [...branches, ...rear],
    stroke: ARROW_STEM * width,
  };
}

/**
 * How tall the drawing sets type, in world units — the one size, for painted road
 * text and for every sign.
 *
 * A schematic build constant like {@link CROSSWALK_DEPTH}, and **fixed rather
 * than band-derived**, unlike a turn arrow's proportions: a sign is a symbol
 * beside the road with no band to derive from, and one size across the whole
 * drawing is what keeps a plate and a painted word reading as the same hand.
 *
 * Sized so a run's cap height clears the narrowest band it can land in — a ramp
 * lane is 7.2 units — with asphalt showing either side. Settled in the app
 * (signs spec §2.4).
 */
export const TEXT_SIZE = 6;

/**
 * Overpass Mono's advance width, as a fraction of the type size.
 *
 * **Measured, not derived**, which is the whole reason the face is monospaced:
 * every glyph advances the same, so a string's width is one multiplication
 * ({@link textWidth}) rather than a metrics table that can fall out of step with
 * the font. Read out of the face itself — `hmtx` gives every glyph an advance of
 * 1232 against a 2000-unit em — rather than off a canvas, so the number is the
 * font's own and carries no rounding from a rasterizer (§2.4).
 *
 * Pinned as a bare literal in `geometry.test.ts`, so swapping the face fails a
 * test instead of silently resizing every plate it sizes.
 */
export const ADVANCE = 0.616;

/**
 * Overpass Mono's cap height, as a fraction of the type size.
 *
 * From the same source as {@link ADVANCE} — `OS/2.sCapHeight`, 1400 of the same
 * 2000-unit em, which the outline of a capital `M` confirms exactly. It exists
 * for one job: centring a run on the strip it is drawn in. SVG offers
 * `dominant-baseline` for that, and this drawing does not use it — WebKit's
 * support for it inside a rasterized SVG is exactly the class of thing that fails
 * silently in the PNG path (§2.7, OQ-1) — so the baseline offset is arithmetic
 * from a number instead.
 */
export const CAP_HEIGHT = 0.7;

/**
 * How far a baseline sits **below** the centre of the strip a run is centred in.
 *
 * The one centring rule in the drawing, and the reason it is a constant rather
 * than an expression written out at each site: glyphs sit above their baseline,
 * so a run whose baseline is on the centre line rides high by half its cap. Every
 * text in the drawing takes it — a word painted on its lane band
 * ({@link markingText}), a label on its plate ({@link signPlate}), and the number
 * in a speed roundel — and `geometry.test.ts` asserts two of them against each
 * other rather than against a literal they happen to share.
 *
 * `dominant-baseline` is what SVG offers for this, and the drawing does not use
 * it: WebKit's support for it inside a rasterized SVG is exactly the class of
 * thing that fails silently in the PNG path (§2.7, OQ-1).
 */
export const BASELINE_DROP = (TEXT_SIZE * CAP_HEIGHT) / 2;

/**
 * How wide a string sets, in world units.
 *
 * Exact because the face is monospaced, and pure because nothing measures a DOM:
 * `signPlate` can therefore size a direction plate to its text in the same suite
 * that tests the rest of the geometry.
 */
export function textWidth(content: string): number {
  return content.length * ADVANCE * TEXT_SIZE;
}

/** A run of text: where its baseline sits, the angle it runs at, and how tall. */
export interface TextRun {
  /**
   * The baseline's **midpoint** — `text-anchor="middle"` centres the string on
   * it, which is what keeps the string itself out of this arithmetic.
   */
  at: Vec2;
  /** Degrees clockwise from due east, for an SVG `rotate(angle, at.x, at.y)`. */
  angle: number;
  /** Carried here so the renderer writes one attribute rather than reading two constants. */
  size: number;
}

/**
 * Text painted flat on the road: centred in its lane, running **along** the road
 * in the direction of travel.
 *
 * The one thing in the drawing set at an angle, and it earns it — road paint is
 * on the road, so it turns with it, exactly as a turn arrow does. There is no
 * upright flip: a westbound road paints text that reads upside down on screen,
 * which is what real paint does and what the driver it is aimed at sees the right
 * way up (§2.9).
 *
 * Two offsets, both from the band and neither from the string:
 *
 * - **along** the road, nothing — `text-anchor="middle"` puts the string's
 *   midpoint on `position`, so a word sits where a stop line would;
 * - **across** it, {@link BASELINE_DROP} toward the right of travel.
 *   {@link markingPoint}'s positive `across` is the right of travel, so dropping
 *   the baseline by that much lands the run's visual centre on the band centre.
 *
 * Takes the anchor and nothing else, as every other kind's builder does — the
 * content changes nothing about where the run goes.
 */
export function markingText(anchor: MarkingAnchor): TextRun {
  const at = markingPoint(anchor, anchor.span.offset + BASELINE_DROP, 0);
  return {
    at,
    angle: (Math.atan2(anchor.dir.y, anchor.dir.x) * 180) / Math.PI,
    size: TEXT_SIZE,
  };
}

/**
 * How far clear of the road's edge a length label's centre sits, in world units.
 *
 * A schematic build constant like {@link MARKING_PITCH}, settled in the app. It
 * measures to the run's *centre*, so the paper actually showing between the
 * casing and the glyphs is this less half a cap height (link-length §2.3).
 */
export const LABEL_GAP = 8;

/**
 * A length as the drawing states it: metres to the nearest whole one, an `m` and
 * no space — `1800m`, `CLAUDE.md`'s own example.
 *
 * **One function, so two links cannot disagree about how a length reads.** The
 * number is stored bare and formatted here, at the point of drawing, which is
 * OQ-1's resolution: the model carries a quantity in the one unit everything else
 * in it uses, and the spelling is the drawing's business (§2.4).
 */
export function formatLength(metres: number): string {
  return `${Math.round(metres)}m`;
}

/**
 * Where a link's length label goes: beside the carriageway at its midpoint,
 * clear of the asphalt, and the right way up.
 *
 * **It takes no length**, and that is load-bearing rather than tidy. §2.2 forbids
 * the drawing being sized from `Link.length`; a function with no such parameter
 * cannot do it, whatever a later edit intends. {@link markingText} takes no
 * content for the same shape of reason.
 *
 * Three decisions, each the inverse of the painted-text kind's
 * ({@link markingText}, and the table in §2.3):
 *
 * - **Beside the road, not on it.** Half the road's width plus {@link LABEL_GAP}
 *   to the *right of travel*, which is {@link markingPoint}'s positive `across`.
 *   The side is derived rather than picked: {@link carriageways} steps each
 *   carriageway of a divided road out by a **positive** offset in its own frame,
 *   so each one's right of travel points away from their shared centreline and
 *   the two labels land outside the pair rather than in the median (OQ-2).
 * - **Upright.** A westbound road paints its words upside down because a driver
 *   reads them; a label is read by a reader of the figure, so a run that would
 *   set backwards is turned through half a circle into `(-90, 90]`. Every
 *   vertical road then reads bottom-to-top.
 * - **Derived.** No id, no hit target, no `Selection` arm — the caller redraws it
 *   from the field, or draws nothing.
 *
 * The baseline drop's **sign follows the flip**: a turned run's own "down" is the
 * other way about, so adding the drop unturned would sit the label half a cap
 * height off the gap it was given. `undefined` for a polyline with no length to
 * walk, {@link pointAlongPolyline}'s own posture.
 */
export function lengthLabel(
  points: Vec2[],
  width: number,
): TextRun | undefined {
  const mid = pointAlongPolyline(points, polylineLength(points) / 2);
  if (!mid) return undefined;

  // Due south counts as backwards so that a vertical road reads bottom-to-top
  // whichever way its traffic runs, rather than flipping with the link's
  // direction — which the reader of a figure cannot see.
  const flip = mid.dir.x < 0 || (mid.dir.x === 0 && mid.dir.y > 0);
  const raw = (Math.atan2(mid.dir.y, mid.dir.x) * 180) / Math.PI;

  return {
    at: markingPoint(
      mid,
      width / 2 + LABEL_GAP + (flip ? -BASELINE_DROP : BASELINE_DROP),
      0,
    ),
    angle: flip ? raw - Math.sign(raw) * 180 : raw,
    size: TEXT_SIZE,
  };
}

/**
 * How big a sign is drawn, in world units — the symbol size, and the floor a
 * plate's width never goes below.
 *
 * A sign is a **symbol, not a scale model** (signs spec §2.7): it stands beside
 * the road rather than on it, so unlike a turn arrow's proportions it is not
 * derived from a lane band — the same sign beside a narrow ramp is the same sign.
 * A schematic build constant in the manner of {@link GORE_LENGTH}, and settled in
 * the app as {@link MARKING_PITCH} was.
 *
 * Phase 3's roundel, octagon, triangle and diamond take it in **both** directions;
 * {@link signPlate} takes it as a minimum only, since a plate is as wide as what
 * it carries.
 */
export const SIGN_SIZE = 22;

/**
 * How wide the red ring on a speed roundel is stroked, in world units.
 *
 * **Fat, and deliberately.** The drawing sets one type size for every text it
 * carries (§2.4), so the roundel cannot close its white space with a bigger
 * number; the ring does it instead — which is also what a roundel looks like, and
 * it keeps the vocabulary's one-size rule intact rather than adding a second
 * constant that only one sign would use. {@link signRoundel} states what it has to
 * leave room for.
 */
export const SIGN_RING = 4;

/**
 * The clear space either side of a label on its plate, in world units.
 *
 * Two thirds of the type size, so a plate has visible border rather than letters
 * running to its edge — and about a character wide, which is what makes a short
 * label read as centred rather than cramped.
 */
export const PLATE_PAD = 4;

/**
 * How much a sign's corners are rounded by, in world units — a third of the type
 * size, which is enough to read as a sign and little enough that the symbol kinds
 * can share it for their chrome.
 */
const PLATE_RADIUS = TEXT_SIZE / 3;

/**
 * A rounded box a sign occupies, centred on the sign's own position — a plate, or
 * the square a symbol is drawn inside.
 *
 * It is what the sign's **chrome** is grown from ({@link signBox}): one hit target
 * and one halo for every kind, so selecting a sign feels identical across the
 * vocabulary.
 */
export interface SignChrome {
  /** The box as a rect, centred on the sign's own position. */
  box: { x: number; y: number; width: number; height: number };
  /** Corner rounding, so a plate reads as signage rather than as a bare box. */
  radius: number;
}

/** A sign's plate and the run of text centred on it, drawn about the origin. */
export interface SignPlate extends SignChrome {
  /**
   * The label's baseline **midpoint** — `text-anchor="middle"` centres the string
   * on it, which is what keeps the string out of this arithmetic, exactly as
   * {@link TextRun} does for painted road text.
   */
  baseline: Vec2;
  /** Carried here so the renderer writes one attribute rather than reading two constants. */
  size: number;
}

/**
 * The plate a sign carries its label on, **sized to that label**.
 *
 * **Origin-centred**, because a sign carries its own canvas position and its shape
 * is translated there — the way a node and a junction glyph are drawn, and unlike
 * a marking, whose every point comes out of the road (§2.5).
 *
 * Three decisions worth stating:
 *
 * - **The width is the text's, floored at {@link SIGN_SIZE}.** Exact because the
 *   face is monospaced ({@link textWidth}) and pure because nothing measures a
 *   DOM, which is the whole reason §2.4 chose a monospace face. The floor is what
 *   keeps an empty label a drawable plate rather than a sliver.
 * - **The height is the type it carries, not `SIGN_SIZE`** — two type sizes, so
 *   there is half a size of clearance above and below the cap. A square plate
 *   reads as a card rather than as a sign.
 * - **The label is centred by arithmetic, not `dominant-baseline`** — it takes
 *   {@link BASELINE_DROP} below the plate's centre, which is the identical rule
 *   {@link markingText} centres a run on its lane band with, and the one number
 *   every text site in the drawing agrees on. (§2.7 says "arithmetic from
 *   `SIGN_SIZE`"; it is not — it is the type's own cap height, which is what
 *   Phase 1 already fixed.)
 */
export function signPlate(label: string): SignPlate {
  const width = Math.max(SIGN_SIZE, textWidth(label) + 2 * PLATE_PAD);
  const height = TEXT_SIZE * 2;
  return {
    box: { x: -width / 2, y: -height / 2, width, height },
    radius: PLATE_RADIUS,
    baseline: { x: 0, y: BASELINE_DROP },
    size: TEXT_SIZE,
  };
}

/**
 * The words a sign carries on a **plate**, or `null` when its shape carries the
 * meaning instead.
 *
 * The one place that decides which kinds are plates, so the renderer and
 * {@link signBox} cannot disagree about how wide a sign is — the split that makes
 * "one hit box and one halo for every kind" hold once six of the eight kinds stop
 * being rectangles (signs spec §2.7).
 *
 * **Two kinds carry words and they carry them the same way.** A destination and a
 * free-text label differ in what they *mean*, which the drawing says in colour
 * (`.sign-direction`'s green panel) rather than in shape — so the width of one is
 * the width of the other, and this returns the string either carries. Both are
 * empty when freshly picked, which is the plate `SIGN_SIZE` floors.
 */
export function signPlateLabel(kind: SignKind): string | null {
  switch (kind.type) {
    case "custom":
      return kind.label;
    case "direction":
      return kind.text;
    default:
      return null;
  }
}

/**
 * The box a sign's chrome is grown from — its hit target and its halo.
 *
 * **Kind-aware, and it has to be.** A plate is as wide as its label and only
 * `TEXT_SIZE * 2` tall; a symbol is {@link SIGN_SIZE} in *both* directions, so a
 * halo taken from the plate would sit inside a roundel rather than around it. One
 * box per kind, and one hit target and one halo grown from it, is what keeps
 * selecting a sign feeling identical across the vocabulary.
 */
export function signBox(kind: SignKind): SignChrome {
  const label = signPlateLabel(kind);
  if (label !== null) {
    const { box, radius } = signPlate(label);
    return { box, radius };
  }
  const half = SIGN_SIZE / 2;
  return {
    box: { x: -half, y: -half, width: SIGN_SIZE, height: SIGN_SIZE },
    radius: PLATE_RADIUS,
  };
}

/**
 * A regular polygon about the origin: `sides` vertices on a circle of radius `r`,
 * the first at `phase` radians clockwise from due east.
 *
 * The one construction every straight-edged sign below is built from, so the
 * octagon, the two triangles and the diamond cannot drift apart in how they are
 * inscribed — each differs only in its count and its phase.
 */
function regularPolygon(sides: number, r: number, phase: number): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = phase + (i * 2 * Math.PI) / sides;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
}

/**
 * A stop sign's octagon, inscribed in {@link SIGN_SIZE}.
 *
 * **Flat-topped**, which is the half-step phase: an octagon with a vertex at the
 * top reads as a rotated one. Regular, so all eight sides are equal — the property
 * `geometry.test.ts` pins, because a magnitude test on one vertex passes for any
 * number of near-octagons.
 */
export function signOctagon(): Vec2[] {
  return regularPolygon(8, SIGN_SIZE / 2, Math.PI / 8);
}

/**
 * A triangular sign, inscribed in {@link SIGN_SIZE} and pointing either way.
 *
 * **One construction and one flip, deliberately.** A give-way triangle points
 * **down** and a warning triangle points **up**, and that is the whole of what
 * distinguishes them — two separate builders could drift into two different
 * triangles, and no assertion on a size would notice. SVG's `y` grows downward, so
 * `down` is the apex at `+y`.
 */
export function signTriangle(point: "up" | "down"): Vec2[] {
  const up = regularPolygon(3, SIGN_SIZE / 2, -Math.PI / 2);
  return point === "up" ? up : up.map((p) => ({ x: p.x, y: -p.y }));
}

/**
 * How far the yellow face's circumradius is inset from the border's — so the white
 * band a reader sees is this much *along a diagonal*, about three quarters of it
 * across an edge.
 */
const PRIORITY_BORDER = 3;

/**
 * A priority sign: a yellow diamond with a white border (§2.1).
 *
 * **Two polygons, not one stroked path.** The border is drawn as a diamond behind
 * the face rather than as a stroke on it, because the outer edge also needs the
 * plate's dark outline: white on light paper is the one place in this vocabulary
 * where the sign would otherwise dissolve into the page, and a single path cannot
 * carry two strokes.
 */
export function signPriority(): { border: Vec2[]; face: Vec2[] } {
  const r = SIGN_SIZE / 2;
  return {
    border: regularPolygon(4, r, -Math.PI / 2),
    face: regularPolygon(4, r - PRIORITY_BORDER, -Math.PI / 2),
  };
}

/** A speed roundel: the white disc, and the red ring inside its rim. */
export interface SignRoundel {
  /** The disc's radius — the sign's own half size. */
  radius: number;
  /**
   * The ring, **stroked**: its own radius is inset by half its width, so the
   * outermost thing the sign paints is red rather than a sliver of white.
   */
  ring: { radius: number; width: number };
}

/**
 * A speed limit sign — a white roundel with a red ring, carrying its number.
 *
 * **The ring is what closes the white space, not a second type size.** The drawing
 * sets one size ({@link TEXT_SIZE}, §2.4), so a thin ring would leave a small
 * number adrift in a large disc; {@link SIGN_RING} is fat instead, which is also
 * what a roundel looks like.
 *
 * The number is the containment case, and the limit is **three digits**: the
 * widest string the Inspector's stepper can reach has to sit inside the ring, with
 * its cap centred by {@link BASELINE_DROP} as every other run is.
 * `geometry.test.ts` asserts that rather than the arithmetic that produced it.
 */
export function signRoundel(): SignRoundel {
  const radius = SIGN_SIZE / 2;
  return { radius, ring: { radius: radius - SIGN_RING / 2, width: SIGN_RING } };
}

/** How wide and how tall a no-entry sign's bar is, as fractions of the disc's diameter. */
const NO_ENTRY_BAR = { width: 0.64, height: 0.2 };

/** A no-entry sign: the red disc, and the white bar across it. */
export interface SignDisc {
  radius: number;
  bar: { x: number; y: number; width: number; height: number };
}

/**
 * A no-entry sign — the red disc, and the white bar that is the whole message.
 *
 * A red disc *without* the bar is a different sign entirely, which is §2.7's
 * ordering in miniature: the shape carries the meaning and the colour confirms it,
 * so the bar is geometry rather than decoration.
 */
export function signNoEntry(): SignDisc {
  const width = SIGN_SIZE * NO_ENTRY_BAR.width;
  const height = SIGN_SIZE * NO_ENTRY_BAR.height;
  return {
    radius: SIGN_SIZE / 2,
    bar: { x: -width / 2, y: -height / 2, width, height },
  };
}

/**
 * How far apart a double line's two strokes sit, centre to centre.
 *
 * A schematic build constant like {@link CROSSWALK_DEPTH}, and **decided in the
 * app** as {@link MARKING_PITCH} was: it leaves two units of asphalt between two
 * 2-unit strokes, so the gap reads as wide as the paint either side of it. A
 * narrower one draws as a single fat line with a scratch down the middle, which
 * is the one thing a double line must not look like.
 */
export const LANE_LINE_GAP = 4;

/** A lane line: the boundary it takes over, and the strokes that paint it. */
export interface LaneLine {
  /** Its lateral offset in the link's drawn frame — the divider it replaces. */
  offset: number;
  /** Carried here so the renderer needs no second narrowing of `Marking.kind`. */
  style: LineStyle;
  /** The single line its hit target and halo take, whatever the style paints. */
  spine: Vec2[];
  /** One polyline for `solid`/`dashed`, two for `double`. */
  lines: Vec2[][];
}

/**
 * Which boundary a lane line's `lane` names, or `undefined` if it names none —
 * **the whole of the boundary rule** (markings spec §2.3).
 *
 * `lane` on a `lane_line` names a *boundary between* lanes rather than a lane,
 * and `n` lanes have only `n-1` of them: `lane = n-1` — the offside-most lane —
 * names nothing, because that lane's far side is the carriageway edge line,
 * which is not a divider and is not a lane line's to take. Rather than re-home it
 * to a boundary the user did not ask for, nothing is drawn.
 *
 * `lane` absent is the lane region's **centre**, which is `0` in this frame:
 * {@link laneBands} centres the bands on the drawn polyline. That is the
 * undivided two-way road's centreline (road spec OQ-4, ramps OQ-6).
 *
 * The offset is `bands.slice(1)`'s own expression from `RoadShape`, not an
 * equivalent one over `bands[lane]` — the two agree to the last bit only if they
 * are the same arithmetic, and the road drops the divider this replaces by
 * comparing the two numbers.
 */
function boundaryOffset(
  bands: LaneBand[],
  lane: LaneIdx | undefined,
): number | undefined {
  if (lane === undefined) return 0;
  if (lane < 0 || lane >= bands.length - 1) return undefined;
  const b = bands[lane + 1];
  return b.offset + b.width / 2;
}

/**
 * A lane line's drawn form, or `undefined` if it cannot be drawn.
 *
 * **The one longitudinal kind.** Five of the seven marking kinds sit at a point;
 * this one is a run, and `Marking` has one `position` and nowhere to put an
 * extent — so it paints its boundary for the **whole link** and `position` is
 * ignored (markings spec §2.3). A line that has to start and stop partway is a
 * link that wants splitting at a waypoint, which the model already supports and
 * the renderer already draws through.
 *
 * Skipped on the same terms {@link markingAnchor} skips a marking: a kind that is
 * not a `lane_line`, an unknown `link`, a link with no drawable polyline, and a
 * `lane` naming no boundary (see {@link boundaryOffset}). It is
 * {@link drawnPolyline} the line is offset from, so it inherits the carriageway
 * offset and the alignment shift like every other thing drawn on a road.
 */
export function laneLine(
  doc: Document,
  marking: Marking,
  offsets: Record<LinkId, number>,
): LaneLine | undefined {
  if (marking.kind.type !== "lane_line") return undefined;
  const link = findLink(doc, marking.link);
  if (!link) return undefined;
  const points = drawnPolyline(doc, link, offsets);
  if (!points || points.length < 2) return undefined;

  const bands = laneBands(link.lanes, linkStyle(doc, link.id));
  const offset = boundaryOffset(bands, marking.lane);
  if (offset === undefined) return undefined;

  const { style } = marking.kind;
  const spine = offsetPolyline(points, offset);
  const half = LANE_LINE_GAP / 2;
  return {
    offset,
    style,
    spine,
    lines:
      style === "double"
        ? [
            offsetPolyline(points, offset + half),
            offsetPolyline(points, offset - half),
          ]
        : [spine],
  };
}

/**
 * The boundaries each link's lane lines have taken over, so the road can stop
 * deriving a divider there (markings spec OQ-3: a lane line **replaces** the
 * line it lands on rather than being painted over it).
 *
 * **No `offsets` argument, deliberately:** which boundary a line sits on is a
 * fact about the road's cross-section, not about where the road was dragged, so
 * this needs neither the carriageway offsets nor a polyline. A link whose
 * polyline is undrawable is skipped by {@link laneLine} *and* by the renderer, so
 * the two cannot disagree about a road that is not drawn at all.
 */
export function laneLineOffsets(doc: Document): Record<LinkId, number[]> {
  const taken: Record<LinkId, number[]> = {};
  for (const m of doc.markings) {
    if (m.kind.type !== "lane_line") continue;
    const link = findLink(doc, m.link);
    if (!link) continue;
    const offset = boundaryOffset(
      laneBands(link.lanes, linkStyle(doc, link.id)),
      m.lane,
    );
    if (offset === undefined) continue;
    (taken[m.link] ??= []).push(offset);
  }
  return taken;
}

/**
 * Whether a lane line has taken the boundary at `offset` — the predicate
 * `RoadShape` filters its dividers with.
 *
 * A function rather than an exported tolerance, so `SAME_EDGE` stays this
 * module's own. The comparison is exact for a line that names a boundary index
 * (both sides run {@link boundaryOffset}'s arithmetic); the slack is for the
 * centreline, which arrives as a literal `0` and meets a boundary offset summed
 * from lane widths.
 */
export function boundaryTaken(
  taken: number[] | undefined,
  offset: number,
): boolean {
  return taken?.some((o) => Math.abs(o - offset) < SAME_EDGE) ?? false;
}

/**
 * How a marking is drawn: **across** the road at a point, or **along** it for the
 * whole link. Exactly one arm is present.
 */
export type MarkingForm =
  | { across: MarkingAnchor; along?: never }
  | { along: LaneLine; across?: never };

/**
 * Everything the renderer needs to draw one marking, or `undefined` if it cannot
 * be drawn.
 *
 * The kind branch lives here rather than in `Diagram.tsx` so that "how is this
 * marking drawn" stays with the geometry that answers it, and the marking layer
 * keeps its shape: one call, one skip, one element.
 */
export function markingForm(
  doc: Document,
  marking: Marking,
  offsets: Record<LinkId, number>,
): MarkingForm | undefined {
  if (marking.kind.type === "lane_line") {
    const along = laneLine(doc, marking, offsets);
    return along && { along };
  }
  const across = markingAnchor(doc, marking, offsets);
  return across && { across };
}

/**
 * Several closed polygons as one `d` — so a marking of many pieces is still one
 * element, and one class token, in the markup.
 */
export function polygonsPath(polygons: Vec2[][]): string {
  return polygons.map((p) => `${polylinePath(p)} Z`).join(" ");
}

/**
 * The same for *open* polylines — a shaft and its stems as one stroked path,
 * where {@link polygonsPath} would close each one across its own chord and fill
 * the half-disc inside the `u_turn`'s hook.
 */
export function polylinesPath(lines: Vec2[][]): string {
  return lines.map((l) => polylinePath(l)).join(" ");
}
