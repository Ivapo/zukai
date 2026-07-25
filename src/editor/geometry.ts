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
  // here; ` ` cannot occur in an id, so the key cannot alias.
  const byPair = new Map<string, Link[]>();

  for (const link of doc.links) {
    offsets[link.id] = 0;
    const [a, b] =
      link.from_node < link.to_node
        ? [link.from_node, link.to_node]
        : [link.to_node, link.from_node];
    const key = `${a} ${b}`;
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
