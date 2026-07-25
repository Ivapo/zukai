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
 * DOM-free except `measureDiagram`, which mounts the markup to measure it, and
 * `rasterizePng`, which draws it into a canvas.
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
 * How many pixels a raster export puts on each world unit.
 *
 * 2× so a PNG stays crisp on a retina display and in a printed document, where a
 * 1× raster of a line drawing reads as soft. Fixed rather than offered: the
 * format is chosen by the extension and there is no options panel (spec §2.8,
 * OQ-2). SVG, being resolution-independent, needs no equivalent.
 */
export const PNG_SCALE = 2;

/**
 * Half the widest stroke in the document, so no cap or edge is clipped.
 *
 * Bounds come from `getBBox`, which measures path geometry and **excludes**
 * stroke width. The dominant overhang is the road casing: drawn at
 * `roadWidth(lanes)` with a round linecap, it extends half that past each
 * polyline end — 37.5 world units for a road of 8 default lanes, so a flat
 * 24-unit margin would have sliced the end-cap off every road of 5 lanes or
 * more. Deriving the allowance from `roadWidth` means neither a change to
 * `LANE_PX` nor a document whose lanes are wider than the default can silently
 * reintroduce that.
 *
 * The `2` seed floors the allowance at the fattest non-casing stroke in
 * `diagram.css` (`.jn-stopbar`, 4) and keeps the spread from yielding
 * `-Infinity` for a document with no links.
 */
export function strokeAllowance(doc: Document): number {
  return Math.max(2, ...doc.links.map((l) => roadWidth(l.lanes) / 2));
}

/** The drawing alone, chrome-free: `<g class="diagram">…</g>`. */
export function diagramInner(doc: Document): string {
  return renderToStaticMarkup(<Diagram doc={doc} />);
}

/**
 * The drawing's own extent in world units, or `null` when there is nothing to
 * measure.
 *
 * Measured rather than derived: `getBBox` on the very tree that gets written
 * cannot drift from it, whereas a union of node positions and link polylines
 * would have to re-derive every glyph's radius and would clip silently the first
 * time a new glyph forgot to update it. Measuring the *export* tree rather than
 * the live canvas group also keeps the result independent of the selection — a
 * halo is several world units of extra bbox, and "the exported image is bigger
 * when something is selected" is not a thing anyone would think to test.
 *
 * The only DOM-touching function in this module. The host is hidden but
 * *rendered*: `getBBox` returns zeros inside a `display: none` subtree.
 */
export function measureDiagram(doc: Document): Rect | null {
  const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  host.setAttribute(
    "style",
    "position:absolute; left:-10000px; top:0; visibility:hidden; pointer-events:none",
  );
  try {
    // Assigning to an SVG element's `innerHTML` parses the fragment in the SVG
    // namespace. Safe for this markup, which carries no case-sensitive attribute
    // name (export mode emits neither `viewBox` nor `vector-effect`).
    host.innerHTML = diagramInner(doc);
    document.body.appendChild(host);
    const g = host.firstElementChild as SVGGraphicsElement | null;
    if (!g) return null;
    const box = g.getBBox();
    // An empty document has no geometry: `diagramSvg` frames `null` as a small
    // blank sheet rather than a zero-size — or `NaN` — viewBox.
    if (box.width === 0 && box.height === 0) return null;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  } finally {
    host.remove();
  }
}

/** The file formats export can write; the extension chooses between them. */
export type ExportFormat = "svg" | "png";

/**
 * Which format a chosen path asks for (spec §2.10). The save dialog hands back a
 * path, not which filter produced it, and the user may type any name — so the
 * rule is exhaustive: `.png` means PNG, and everything else, extension or not,
 * means SVG. Honour the name that was typed; never write PNG bytes into a file
 * the user called something else.
 */
export function exportFormat(path: string): ExportFormat {
  return /\.png$/i.test(path) ? "png" : "svg";
}

/**
 * The padded drawing, snapped outwards to whole world units.
 *
 * Whole units for two reasons. It drops the measurement noise `getBBox` returns,
 * so a file's numbers are readable. And more importantly it keeps `width`/
 * `height` **integral**, which the raster path depends on: a browser rounds an
 * image's intrinsic size to whole pixels, so a fractional `width="265.77"` gets a
 * 266-px viewport, the viewBox letterboxes inside it, and the picture ends up
 * with a sub-pixel transparent gap at the frame — a paper background that is not
 * quite opaque, and a PNG not quite `scale`× the SVG.
 *
 * `floor`/`ceil` rather than `round`, so snapping can only ever *grow* the frame:
 * the derived margin of §2.6 is a clipping guarantee, and rounding could shave it.
 */
function frame(doc: Document, bounds: Rect | null): Rect {
  const margin = EXPORT_PAD + strokeAllowance(doc);
  const b = bounds ?? { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.floor(b.x - margin);
  const y = Math.floor(b.y - margin);
  return {
    x,
    y,
    width: Math.ceil(b.x + b.width + margin) - x,
    height: Math.ceil(b.y + b.height + margin) - y,
  };
}

/**
 * The whole standalone file: root `<svg>`, the embedded stylesheet, an opaque
 * sheet of paper, and the drawing.
 *
 * `bounds` is the drawing's own extent (`measureDiagram`); `null` means there
 * was nothing to measure, and falls through the same arithmetic as a zero-size
 * box at the origin — a blank document exports as a small blank picture rather
 * than an error or a `NaN` viewBox.
 */
export function diagramSvg(doc: Document, bounds: Rect | null): string {
  const { x, y, width: w, height: h } = frame(doc, bounds);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="zukai-diagram"` +
      ` width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">`,
    `<style>\n${diagramCss}</style>`,
    `<rect class="diagram-bg" x="${x}" y="${y}" width="${w}" height="${h}"/>`,
    diagramInner(doc),
    `</svg>`,
  ].join("\n");
}

/**
 * The same picture as PNG bytes, rasterized at `scale` by the webview.
 *
 * The webview, not a Rust rasterizer (spec §2.8): `resvg` would be a second
 * renderer to keep in sync with the one that draws the app, and a dependency to
 * carry. Here the bytes come out of the exact engine the user was just looking
 * at.
 *
 * The target size comes from the image's *intrinsic* dimensions rather than from
 * re-parsing the SVG we just built — so "the PNG is `scale`× the SVG" holds by
 * construction, with no second place to keep the arithmetic. That is why §2.4
 * insists the root `<svg>` carry explicit `width`/`height`: WebKit gives a
 * viewBox-only SVG no intrinsic size at all, and this would silently rasterize
 * nothing.
 *
 * No background is painted here. The SVG carries its own opaque sheet of paper
 * (`.diagram-bg`, §2.7), so the raster path never needs to know the palette.
 */
export async function rasterizePng(
  svg: string,
  scale: number,
): Promise<Uint8Array> {
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const img = await loadImage(url);
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);
    if (width === 0 || height === 0) {
      throw new Error(
        "The webview gave the diagram no intrinsic size, so there is nothing to rasterize.",
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("This webview has no 2D canvas context.");
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await canvasBlob(canvas);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** An `<img>` that has finished loading `url`, or a rejection saying it didn't. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("The webview could not read the diagram as an image."));
    img.src = url;
  });
}

/**
 * The canvas encoded as PNG.
 *
 * `toBlob` hands back `null` when the canvas is tainted or the encoder fails —
 * the failure spec OQ-6 asks this phase to detect. It should not happen: the
 * diagram references nothing outside itself (no linked stylesheet, no web font,
 * no remote image), which is exactly what keeps the canvas clean. If it ever
 * does, this error is the signal, not a blank file.
 */
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("The webview could not encode the diagram as PNG."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}
