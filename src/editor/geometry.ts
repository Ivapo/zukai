/** Canvas geometry: the pan/zoom transform and road-drawing math. */

import { Vec2 } from "../model/types";

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

/** World-space width of one lane, chosen for schematic legibility (not to scale). */
export const LANE_PX = 9;
/** Extra world-space padding added around the lanes for the road casing. */
const ROAD_MARGIN = 3;

/** Total drawn road width for a given lane count, in world units. */
export function roadWidth(laneCount: number): number {
  return Math.max(1, laneCount) * LANE_PX + ROAD_MARGIN;
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
