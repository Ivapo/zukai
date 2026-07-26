import { describe, expect, it } from "vitest";
import { Document, LinkStyle, MarkingKind } from "../model/types";
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
const CHROME =
  /road-hit|jn-hit|marking-hit|-halo|is-selected|link-preview|grid|cursor/;

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

  /**
   * A marking needs **no** widening, and this confirms it rather than pre-empting
   * it (markings spec §2.10). Every marking is painted inside the road it belongs
   * to, and the allowance is already half the widest road; the bar's own stroke
   * is 4, which the `2` floor — half the fattest non-casing stroke in
   * `diagram.css` — already covers.
   */
  it("is unchanged by the markings painted on a road", () => {
    const plain = road(3);
    const painted: Document = {
      ...plain,
      markings: [
        { id: "M1", link: "L1", position: 14, lane: 0, kind: { type: "stop_line" } },
      ],
    };

    expect(strokeAllowance(painted)).toBe(strokeAllowance(plain));
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

describe("tapers in an exported file", () => {
  /** §1's lane drop: a 4-lane road becoming 3-lane at (120, 0), both offside. */
  function tapered(): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      { type: "setLinkLanes", id: "L1", count: 4 },
      { type: "setLinkLanes", id: "L2", count: 3 },
      { type: "setLinkAlign", id: "L1", align: "offside" },
      { type: "setLinkAlign", id: "L2", align: "offside" },
    ).doc;
  }

  /**
   * The cross-spec obligation, checked rather than assumed — and the expected
   * answer is "nothing to do".
   *
   * `strokeAllowance` exists because `getBBox` measures path geometry and
   * excludes *stroke* width, which is the whole of the road casing. A wedge is a
   * filled `<polygon>` inside the same measured `<g>`, so its extent is already
   * in the box, and it can never reach past the casing rim the allowance is
   * derived from: its corners are on that rim by construction. So the frame the
   * roads alone demand already covers it, and widening the allowance for a
   * tapered document would only pad every export for nothing.
   */
  it("needs no allowance of its own — the frame already covers the wedge", () => {
    const doc = tapered();

    expect(strokeAllowance(doc)).toBe(roadWidth(doc.links[0].lanes) / 2);
    expect(strokeAllowance(doc)).toBe(strokeAllowance(road(4)));

    const corners = [
      ...diagramInner(doc).matchAll(/class="road-taper" points="([^"]+)"/g),
    ].flatMap((m) =>
      m[1].split(" ").map((p) => p.split(",").map(Number) as [number, number]),
    );
    expect(corners).toHaveLength(3);

    // Framed from the node positions alone — the conservative stand-in for the
    // `getBBox` this environment has no DOM to run.
    const [x, y, w, h] = diagramSvg(doc, { x: 0, y: 0, width: 240, height: 0 })
      .match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!
      .slice(1)
      .map(Number);
    for (const [cx, cy] of corners) {
      expect(cx).toBeGreaterThan(x);
      expect(cx).toBeLessThan(x + w);
      expect(cy).toBeGreaterThan(y);
      expect(cy).toBeLessThan(y + h);
    }
  });

  /** The wedge's paint travels as CSS like every other rule (spec §2.4). */
  it("carries the taper's paint in the embedded stylesheet", () => {
    const svg = diagramSvg(tapered(), null);
    const css = embeddedCss(svg);

    expect(svg).toContain('class="road-taper"');
    expect(css).toContain(".road-taper");
    expect(css).toContain(".road-casing--butt");
    expect(css).not.toContain("url(");
    expect(css).not.toMatch(/[<&]/);
    expect(svg).not.toMatch(CHROME);
    expect(svg).not.toMatch(/vector-effect/);
  });
});

describe("gores in an exported file", () => {
  /** §1's exit: a 4-lane motorway shedding a lane to a ramp at (120, 0), with
   *  N2 carrying the gore glyph — and no shoulder lane anywhere. */
  function gored(): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "addNode", pos: { x: 200, y: 120 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N4" },
      { type: "setLinkLanes", id: "L1", count: 4 },
      { type: "setLinkLanes", id: "L2", count: 3 },
      { type: "setLinkLanes", id: "L3", count: 1 },
      { type: "setLinkStyle", id: "L3", style: "ramp" },
      { type: "setLinkAlign", id: "L1", align: "offside" },
      { type: "setLinkAlign", id: "L2", align: "offside" },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionGlyph", id: "N2", glyph: "gore" },
    ).doc;
  }

  /**
   * The hatch is the file's one paint-server reference, and a gore is now a
   * second way to reach it — so the rule it was carved out of has to still hold
   * for a document that carries a gore and *no* shoulder lane. An in-document
   * fragment does not taint the canvas the PNG path draws into; anything else
   * would (`rules/diagram-export.md`, "Standing constraints").
   */
  it("references the hatch and nothing else, with the stylesheet unchanged in kind", () => {
    const svg = diagramSvg(gored(), { x: 0, y: 0, width: 240, height: 120 });
    const css = embeddedCss(svg);

    expect(svg).toContain('<pattern id="road-hatch"');
    expect([...svg.matchAll(/url\([^)]*\)/g)].map((m) => m[0])).toEqual([
      "url(#road-hatch)",
    ]);
    expect(css).not.toContain("url(");
    expect(css).not.toMatch(/[<&]/);
    expect(css).toContain(".jn-gore");
    expect(diagramInner(gored())).not.toMatch(/xlink|href|https?:/);
    expect(svg).not.toMatch(CHROME);
    expect(svg).not.toMatch(/vector-effect/);
  });

  /**
   * Same conclusion as the wedge, and for the same reason: a gore is fill
   * geometry inside the measured `<g>`, so `getBBox` already has it. The one
   * wrinkle is that its points are in the glyph's own translated frame, which is
   * why they are compared against the frame with the node added back.
   */
  it("needs no allowance of its own either", () => {
    const doc = gored();

    expect(strokeAllowance(doc)).toBe(strokeAllowance(road(4)));

    const corners = diagramInner(doc)
      .match(/class="jn-gore" points="([^"]+)"/)![1]
      .split(" ")
      .map((p) => p.split(",").map(Number) as [number, number]);
    const [x, y, w, h] = diagramSvg(doc, { x: 0, y: 0, width: 240, height: 120 })
      .match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!
      .slice(1)
      .map(Number);

    for (const [cx, cy] of corners) {
      // The glyph group is translated to N2 at (120, 0).
      expect(cx + 120).toBeGreaterThan(x);
      expect(cx + 120).toBeLessThan(x + w);
      expect(cy).toBeGreaterThan(y);
      expect(cy).toBeLessThan(y + h);
    }
  });
});

describe("road markings in an exported file", () => {
  /** §1's approach: a 3-lane arterial with a stop line in its kerb lane. */
  function painted(kind: MarkingKind = { type: "stop_line" }): Document {
    const base = road(3);
    return {
      ...base,
      markings: [{ id: "M1", link: "L1", position: 14, lane: 0, kind }],
    };
  }

  it("carries the marking's paint as a rule, like every other", () => {
    const svg = diagramSvg(painted(), { x: 0, y: 0, width: 120, height: 40 });
    const css = embeddedCss(svg);

    expect(svg).toContain('<g class="marking marking-stop-line">');
    expect(svg).toContain('class="marking-bar"');
    expect(css).toContain(".marking-bar");
    expect(css).not.toContain("url(");
    expect(css).not.toMatch(/[<&]/);
    expect(svg).not.toMatch(CHROME);
    // Paint on the road scales with the road: no hairline exemption here.
    expect(svg).not.toMatch(/vector-effect/);
  });

  /**
   * **The hard line of markings spec §2.8, and nothing pinned it before.** An
   * exported SVG reaches no external font, so the first `<text>` in the drawing
   * either falls back to whatever the viewer has, or — in the PNG path, which
   * rasterizes through the webview — bakes that substitution in permanently.
   * So `MarkingKind::Text` and the whole of `Sign` are out of scope until a font
   * is embedded as a data-URI `@font-face` (export spec OQ-4), and every kind
   * this spec renders is pure geometry.
   *
   * The interaction chrome carries no text either, so this holds for the live
   * tree as well as the file.
   */
  it("emits no text at all — the constraint the whole spec is cut around", () => {
    const svg = diagramSvg(painted(), { x: 0, y: 0, width: 120, height: 40 });

    expect(svg).not.toMatch(/<text[\s>]|<tspan[\s>]|font-family/);
    expect(diagramInner(painted())).not.toMatch(/<text[\s>]|<tspan[\s>]/);
    // And the stylesheet names no font either, so nothing can resolve to one.
    expect(embeddedCss(svg)).not.toMatch(/@font-face|font-family/);
  });

  /**
   * The tiled kinds travel on the same terms: their paint is a rule in
   * `diagram.css` like every other, and their geometry is polygons, so nothing
   * about them reaches outside the file.
   */
  it("carries a give-way line and a crossing too", () => {
    for (const [kind, cls] of [
      [{ type: "give_way_line" }, "marking-teeth"],
      [{ type: "crosswalk" }, "marking-zebra"],
    ] as [MarkingKind, string][]) {
      const doc = painted(kind);
      const svg = diagramSvg(doc, { x: 0, y: 0, width: 120, height: 40 });

      expect(svg).toContain(`class="${cls}"`);
      expect(embeddedCss(svg)).toContain(`.${cls}`);
      expect(svg).not.toMatch(/<text[\s>]|<tspan[\s>]|font-family/);
      expect(embeddedCss(svg)).not.toContain("url(");
      expect(svg).not.toMatch(CHROME);
      // And no widening: every marking is inside the road it is painted on.
      expect(strokeAllowance(doc)).toBe(strokeAllowance(road(3)));
    }
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
