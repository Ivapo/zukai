/** Canvas geometry: the pan/zoom transform and road-drawing math. */

import { DEFAULT_LANE_WIDTH } from "../model/document";
import { Lane, Vec2 } from "../model/types";

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

/** Drawn width of a road of one default lane — what an empty `lanes` array gets. */
export const MIN_ROAD_WIDTH = DEFAULT_LANE_WIDTH * UNITS_PER_METRE + ROAD_MARGIN;

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
 */
function laneWidths(lanes: Lane[]): number[] {
  if (lanes.length === 0) return [DEFAULT_LANE_WIDTH * UNITS_PER_METRE];
  return lanes.map((l) => l.width * UNITS_PER_METRE);
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
export function laneBands(lanes: Lane[]): LaneBand[] {
  const widths = laneWidths(lanes);
  let edge = widths.reduce((s, w) => s + w, 0) / 2;
  return widths.map((width) => {
    const offset = edge - width / 2;
    edge -= width;
    return { offset, width };
  });
}

/** Total drawn road width in world units: every lane, plus the casing lip. */
export function roadWidth(lanes: Lane[]): number {
  return laneWidths(lanes).reduce((s, w) => s + w, 0) + ROAD_MARGIN;
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

/** Unit left-hand normals of each segment of a polyline. */
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
 * per-vertex normal (averaged at interior vertices). Good enough for the gentle
 * bends a schematic uses; not a true miter offset at sharp corners.
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
