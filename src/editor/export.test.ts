import { describe, expect, it } from "vitest";
import { Document } from "../model/types";
import {
  EXPORT_PAD,
  diagramSvg,
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
      const margin = EXPORT_PAD + strokeAllowance(road(lanes));
      expect(margin).toBeGreaterThanOrEqual(roadWidth(lanes) / 2);
    }
    expect(EXPORT_PAD + strokeAllowance(road(8))).toBeGreaterThanOrEqual(
      roadWidth(8) / 2,
    );
  });
});

describe("diagramSvg", () => {
  it("is a standalone SVG framing the bounds plus the derived margin", () => {
    const svg = diagramSvg(road(3), { x: 0, y: 0, width: 120, height: 40 });

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('class="zukai-diagram"');
    // margin = EXPORT_PAD 24 + roadWidth(3)/2 = 39.
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
    // margin = 24 + roadWidth(6)/2 = 52.5, rounded to 2dp so measurement noise
    // never reaches the file.
    expect(svg).toContain('viewBox="-64.85 -44.61 105 105"');
  });
});
