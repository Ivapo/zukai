import { describe, expect, it } from "vitest";
import { Document, LinkStyle } from "../model/types";
import {
  EXPORT_PAD,
  diagramInner,
  diagramSvg,
  exportFormat,
  strokeAllowance,
} from "./export";
import { roadWidth } from "./geometry";
import { Action, EditorState, initialState, reducer } from "../editor/state";

/** Apply a sequence of actions, as the UI would dispatch them. */
function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(reducer, state);
}

/** Two endpoints joined by one link of `lanes` lanes. */
function road(lanes: number): Document {
  return run(
    initialState(),
    { type: "addNode", pos: { x: 0, y: 0 } },
    { type: "addNode", pos: { x: 120, y: 40 } },
    { type: "startLink", from: "N1" },
    { type: "completeLink", to: "N2" },
    { type: "setLinkLanes", id: "L1", count: lanes },
  ).doc;
}

/** {@link road}, at a road class other than the default. */
function classed(lanes: number, style: LinkStyle): Document {
  return run({ ...initialState(), doc: road(lanes) }, {
    type: "setLinkStyle",
    id: "L1",
    style,
  }).doc;
}

/**
 * Chrome is matched by class token, not by bare word: `--paint-white` contains
 * the substring "hit", so a `/hit/` test can never pass on a file that carries
 * the palette.
 */
const CHROME = /road-hit|jn-hit|-halo|is-selected|link-preview|grid|cursor/;

/** The text between `<style>` and `</style>` — the embedded stylesheet. */
function embeddedCss(svg: string): string {
  return svg.slice(svg.indexOf("<style>") + "<style>".length, svg.indexOf("</style>"));
}

describe("strokeAllowance", () => {
  it("is half the widest road in the document", () => {
    expect(strokeAllowance(road(8))).toBe(37.5);
    expect(strokeAllowance(road(3))).toBe(15);
  });

  it("floors at 2 when there is no road to measure", () => {
    expect(strokeAllowance(initialState().doc)).toBe(2);
  });

  it("leaves room for the round end-cap of the widest road allowed", () => {
    // The regression this exists for: a flat 24-unit margin clipped the cap off
    // every road of 5 lanes or more.
    for (let lanes = 1; lanes <= 8; lanes++) {
      const doc = road(lanes);
      const margin = EXPORT_PAD + strokeAllowance(doc);
      expect(margin).toBeGreaterThanOrEqual(roadWidth(doc.links[0].lanes) / 2);
    }
    const widest = road(8);
    expect(EXPORT_PAD + strokeAllowance(widest)).toBeGreaterThanOrEqual(
      roadWidth(widest.links[0].lanes) / 2,
    );
  });

  /**
   * The road class is part of the drawn width, so the frame has to know about
   * it: today every factor is at most 1, so a miss would only over-pad, but a
   * class that ever drew wider than the default would clip its own end caps —
   * the regression this function exists to prevent.
   */
  it("measures the road at its own class, not the default", () => {
    const ramp = classed(4, "ramp");

    expect(strokeAllowance(ramp)).toBe(
      roadWidth(ramp.links[0].lanes, "ramp") / 2,
    );
    expect(strokeAllowance(ramp)).toBeLessThan(strokeAllowance(road(4)));
  });
});

describe("diagramSvg", () => {
  it("is a standalone SVG framing the bounds plus the derived margin", () => {
    const svg = diagramSvg(road(3), { x: 0, y: 0, width: 120, height: 40 });

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('class="zukai-diagram"');
    // margin = EXPORT_PAD 24 + (3 default lanes = 30)/2 = 39.
    expect(svg).toContain('viewBox="-39 -39 198 118"');
    // 1 world unit = 1 px at 1×, so width/height match the viewBox extent.
    expect(svg).toContain('width="198" height="118"');
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("paints an opaque sheet across the whole frame", () => {
    const svg = diagramSvg(road(3), { x: 10, y: -5, width: 100, height: 50 });

    expect(svg).toContain(
      '<rect class="diagram-bg" x="-29" y="-44" width="178" height="128"/>',
    );
  });

  it("carries its own styling, with no external reference", () => {
    const css = embeddedCss(diagramSvg(road(2), null));

    expect(css).toContain(":root,\n.zukai-diagram");
    expect(css).toContain("--asphalt: #2b2f36");
    expect(css).toContain(".road-casing");
    expect(css).toContain(".diagram-bg");
    expect(css).not.toContain("@import");
    expect(css).not.toContain("url(");
  });

  /**
   * The road class travels as a class token plus a rule in the embedded
   * stylesheet, so an exported file paints it with no exporter change at all —
   * the claim that made class-in-CSS the right mechanism (road spec 2.3). A
   * computed inline colour would have needed the export path to know about road
   * classes; a `url()` reference would have failed the assertions above.
   */
  it("carries the road class and its paint rule into the file", () => {
    const svg = diagramSvg(classed(2, "ramp"), null);

    expect(svg).toContain('<g class="road road-ramp">');
    expect(embeddedCss(svg)).toContain(".road-ramp .road-casing");
    expect(embeddedCss(svg)).toContain("--asphalt-2");
    expect(embeddedCss(svg)).not.toContain("url(");
    expect(embeddedCss(svg)).not.toMatch(/[<&]/);
  });

  /**
   * The hatch is the single exception to "the paint travels as CSS": neither
   * half of it can live in `diagram.css`, because a paint-server reference would
   * fail the no-external-reference rule above and the `<pattern>` element itself
   * would end the `<style>` element it was embedded in. So it is markup inside
   * the `Diagram` tree the exporter already renders — which means the exception
   * costs the export path nothing, and the two rules it was carved out of still
   * hold in full (road spec §2.5).
   */
  it("carries the shoulder hatch as markup, leaving the stylesheet rules intact", () => {
    const doc = run({ ...initialState(), doc: road(4) }, {
      type: "setLaneKind",
      id: "L1",
      lane: 0,
      kind: "shoulder",
    }).doc;
    const svg = diagramSvg(doc, { x: 0, y: 0, width: 120, height: 40 });
    const css = embeddedCss(svg);

    // The stylesheet is unchanged in kind: still no paint-server reference and
    // still XML-safe, hatched document or not.
    expect(css).not.toContain("url(");
    expect(css).not.toMatch(/[<&]/);
    // It does carry the flat rules — the pattern's own line and the band tints.
    expect(css).toContain(".road-hatch-line");
    expect(css).toContain(".road-shoulder-line");
    expect(css).toContain("--tint-bus");

    // And the pattern round-trips into the file, referencing nothing outside it.
    expect(svg).toContain('<pattern id="road-hatch"');
    expect(svg).toContain('class="lane-band lane-band-shoulder"');
    // The file's *only* paint-server reference is this in-document fragment.
    // A `url()` that resolved anywhere else would taint the canvas the PNG path
    // draws into, which is the failure the no-external-reference rule prevents.
    expect([...svg.matchAll(/url\([^)]*\)/g)].map((m) => m[0])).toEqual([
      "url(#road-hatch)",
    ]);
    // The drawing itself links to nothing at all; the root `xmlns` above is the
    // file's one URL, and it is a namespace, not a fetch.
    expect(diagramInner(doc)).not.toMatch(/xlink|href|https?:/);
    expect(svg).not.toMatch(CHROME);
    expect(svg).not.toMatch(/vector-effect/);
  });

  it("keeps the embedded stylesheet XML-safe", () => {
    // The `<style>` body is embedded raw inside an XML document, where `<` and
    // `&` would end the element or start an entity.
    expect(embeddedCss(diagramSvg(road(2), null))).not.toMatch(/[<&]/);
  });

  it("contains the drawing and none of the canvas chrome", () => {
    const doc = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 40 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: 4 },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionGlyph", id: "N2", glyph: "roundabout" },
      { type: "select", selection: { kind: "link", id: "L1" } },
    ).doc;
    const svg = diagramSvg(doc, { x: 0, y: 0, width: 120, height: 40 });

    expect(svg).toContain('<g class="diagram">');
    expect(svg).toContain("road-casing");
    expect(svg).toContain("node-dot");
    expect(svg).toContain("jn-ring");
    expect(svg).not.toMatch(CHROME);
    // Hairlines must scale with the drawing in a file (spec §2.5).
    expect(svg).not.toMatch(/vector-effect/);
  });

  it("frames an empty document as a small square of paper", () => {
    const svg = diagramSvg(initialState().doc, null);

    // margin = 24 + the 2-unit floor, so 26 either side of the origin.
    expect(svg).toContain('viewBox="-26 -26 52 52"');
    expect(svg).toContain('width="52" height="52"');
    expect(svg).toContain('<g class="diagram"></g>');
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("never writes NaN, whatever the bounds", () => {
    const svg = diagramSvg(road(6), { x: -12.3456, y: 7.891, width: 0, height: 0 });

    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    // margin = 24 + (6 default lanes = 57)/2 = 52.5, so the padded box is
    // (-64.85, -44.61) to (40.15, 60.39) — snapped outwards to whole units.
    expect(svg).toContain('viewBox="-65 -45 106 106"');
  });

  it("snaps the frame to whole units, only ever outwards", () => {
    // `width`/`height` must be integral: a browser rounds an image's intrinsic
    // size to whole pixels, so a fractional width letterboxes the viewBox inside
    // its own viewport and leaves a semi-transparent gap at the frame — which a
    // PNG then bakes in. Snapping outwards also keeps §2.6's clipping guarantee:
    // the margin can grow, never shrink.
    const bounds = { x: -12.3456, y: 7.891, width: 30.7, height: 12.02 };
    const svg = diagramSvg(road(6), bounds);

    const [x, y, w, h] = svg
      .match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!
      .slice(1)
      .map(Number);
    expect([x, y, w, h].every(Number.isInteger)).toBe(true);
    expect(svg).toContain(`width="${w}" height="${h}"`);

    const margin = EXPORT_PAD + strokeAllowance(road(6));
    expect(x).toBeLessThanOrEqual(bounds.x - margin);
    expect(y).toBeLessThanOrEqual(bounds.y - margin);
    expect(x + w).toBeGreaterThanOrEqual(bounds.x + bounds.width + margin);
    expect(y + h).toBeGreaterThanOrEqual(bounds.y + bounds.height + margin);
  });
});

describe("exportFormat", () => {
  it("reads PNG from the extension, whatever its case", () => {
    expect(exportFormat("x.png")).toBe("png");
    expect(exportFormat("/home/ivan/Roads/INTERCHANGE.PNG")).toBe("png");
  });

  it("treats everything else — including no extension — as SVG", () => {
    expect(exportFormat("x.svg")).toBe("svg");
    expect(exportFormat("x.SVG")).toBe("svg");
    expect(exportFormat("drawing")).toBe("svg");
    // Not a raster just because the *name* mentions one.
    expect(exportFormat("png")).toBe("svg");
    expect(exportFormat("x.png.svg")).toBe("svg");
    expect(exportFormat("/home/ivan/png/drawing")).toBe("svg");
  });
});
