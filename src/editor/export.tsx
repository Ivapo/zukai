/**
 * The exported picture, as a string.
 *
 * Export is a pure function of the document: it renders the same `<Diagram>`
 * the canvas draws — with `interaction` omitted, so no click targets, selection
 * outlines, or `non-scaling-stroke` hairlines come along — and wraps it in a
 * standalone SVG 1.1 document that references nothing outside itself.
 *
 * The view transform never enters the file (spec §2.1): world units are emitted
 * as SVG user units, so an export at 1× matches the canvas at 100% zoom and pan
 * or zoom cannot change what an export looks like.
 *
 * `.tsx`, not `.ts`, because it renders JSX. Everything here is pure and
 * DOM-free; measuring the drawing (`measureDiagram`) and rasterizing it need a
 * DOM and land in later phases.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { Diagram } from "../components/Diagram";
import { Document } from "../model/types";
import { roadWidth } from "./geometry";
// The paint travels inside the file. One definition site, two importers: the
// app loads `diagram.css` as a stylesheet, we embed the same text verbatim —
// so a file on disk cannot drift from the picture on screen (spec §2.4).
import diagramCss from "../styles/diagram.css?raw";

/** An axis-aligned box in world units. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Breathing room around the drawing, in world units. */
export const EXPORT_PAD = 24;

/**
 * Half the widest stroke in the document, so no cap or edge is clipped.
 *
 * Bounds come from `getBBox`, which measures path geometry and **excludes**
 * stroke width. The dominant overhang is the road casing: drawn at
 * `roadWidth(lanes)` with a round linecap, it extends half that past each
 * polyline end — 37.5 world units for an 8-lane road, so a flat 24-unit margin
 * would have sliced the end-cap off every road of 5 lanes or more. Deriving the
 * allowance from `roadWidth` means a later change to `LANE_PX` or the 1–8 lane
 * clamp cannot silently reintroduce that.
 *
 * The `2` seed floors the allowance at the fattest non-casing stroke in
 * `diagram.css` (`.jn-stopbar`, 4) and keeps the spread from yielding
 * `-Infinity` for a document with no links.
 */
export function strokeAllowance(doc: Document): number {
  return Math.max(2, ...doc.links.map((l) => roadWidth(l.lanes.length) / 2));
}

/** The drawing alone, chrome-free: `<g class="diagram">…</g>`. */
export function diagramInner(doc: Document): string {
  return renderToStaticMarkup(<Diagram doc={doc} />);
}

/** Drop measurement noise, so `width`/`height` and `viewBox` stay consistent. */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * The whole standalone file: root `<svg>`, the embedded stylesheet, an opaque
 * sheet of paper, and the drawing.
 *
 * `bounds` is the drawing's own extent (Phase 3 measures it); `null` means there
 * was nothing to measure, and falls through the same arithmetic as a zero-size
 * box at the origin — a blank document exports as a small blank picture rather
 * than an error or a `NaN` viewBox.
 */
export function diagramSvg(doc: Document, bounds: Rect | null): string {
  const margin = EXPORT_PAD + strokeAllowance(doc);
  const b = bounds ?? { x: 0, y: 0, width: 0, height: 0 };
  const x = num(b.x - margin);
  const y = num(b.y - margin);
  const w = num(b.width + 2 * margin);
  const h = num(b.height + 2 * margin);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="zukai-diagram"` +
      ` width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">`,
    `<style>\n${diagramCss}</style>`,
    `<rect class="diagram-bg" x="${x}" y="${y}" width="${w}" height="${h}"/>`,
    diagramInner(doc),
    `</svg>`,
  ].join("\n");
}
