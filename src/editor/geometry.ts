/** Canvas geometry: the pan/zoom transform and road-drawing math. */

import {
  DEFAULT_LANE_WIDTH,
  DEFAULT_LINK_STYLE,
  linkStyle,
} from "../model/document";
import {
  Document,
  Lane,
  Link,
  LinkAlign,
  LinkId,
  LinkStyle,
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
 * to scale). Also the canvas grid pitch (`Canvas.tsx`), and the peg that fixes
 * `UNITS_PER_METRE` — a lane the model gives some other width draws in
 * proportion to this one.
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
 * A polyline parallel to `points`, offset by signed distance `d` along the
 * per-vertex normal (averaged at interior vertices) — positive `d` to the right
 * of the direction of travel as drawn. Good enough for the gentle bends a
 * schematic uses; not a true miter offset at sharp corners.
 */
export function offsetPolyline(points: Vec2[], d: number): Vec2[] {
  if (points.length < 2) return points;
  const seg = segmentNormals(points);
  return points.map((p, i) => {
    let nx: number;
    let ny: number;
    if (i === 0) {
      nx = seg[0].x;
      ny = seg[0].y;
    } else if (i === points.length - 1) {
      nx = seg[seg.length - 1].x;
      ny = seg[seg.length - 1].y;
    } else {
      nx = seg[i - 1].x + seg[i].x;
      ny = seg[i - 1].y + seg[i].y;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
    }
    return { x: p.x + nx * d, y: p.y + ny * d };
  });
}
