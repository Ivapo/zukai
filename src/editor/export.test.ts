import { describe, expect, it } from "vitest";
import { Document, LinkStyle, MarkingKind, SignKind } from "../model/types";
import {
  EXPORT_PAD,
  diagramInner,
  diagramSvg,
  exportFormat,
  strokeAllowance,
} from "./export";
import { SIGN_SIZE, roadWidth, signPlate } from "./geometry";
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

/** {@link road} with one sign standing clear of it, carrying `label`. */
function signed(label: string): Document {
  const base = road(3);
  return {
    ...base,
    signs: [{ id: "S1", kind: { type: "custom", label } }],
    layout: { ...base.layout, signs: { S1: { x: 60, y: 60 } } },
  };
}

/** {@link road}, stating how long it really is — and carrying nothing else that
 *  draws a glyph, which is what the third arm of the font gate is tested on. */
function stated(metres: number): Document {
  const base = road(3);
  return { ...base, links: [{ ...base.links[0], length: metres }] };
}

/** {@link signed}, but a destination panel — the widest sign the drawing can make. */
function destination(text: string): Document {
  const base = signed("");
  return { ...base, signs: [{ id: "S1", kind: { type: "direction", text } }] };
}

/** Every kind in the vocabulary, in a row beside {@link road}. */
const EVERY_KIND: SignKind[] = [
  { type: "speed_limit", kph: 50 },
  { type: "stop" },
  { type: "give_way" },
  { type: "priority" },
  { type: "no_entry" },
  { type: "warning", symbol: "bend_right" },
  { type: "direction", text: "M4 W" },
  { type: "custom", label: "TOLL" },
];

/** {@link road} carrying one sign of every kind. */
function vocabulary(): Document {
  const base = road(3);
  return {
    ...base,
    signs: EVERY_KIND.map((kind, i) => ({ id: `S${i + 1}`, kind })),
    layout: {
      ...base.layout,
      signs: Object.fromEntries(
        EVERY_KIND.map((_, i) => [`S${i + 1}`, { x: 30 * i, y: 60 }]),
      ),
    },
  };
}

/**
 * Chrome is matched by class token, not by bare word: `--paint-white` contains
 * the substring "hit", so a `/hit/` test can never pass on a file that carries
 * the palette.
 */
const CHROME =
  /road-hit|jn-hit|marking-hit|sign-hit|-halo|is-selected|link-preview|grid|cursor/;

/**
 * The text between the **first** `<style>` and the first `</style>` — the
 * embedded `diagram.css`.
 *
 * The first is load-bearing rather than incidental: a document that draws a glyph
 * emits a *second* stylesheet carrying the `@font-face` (signs spec §2.3), and
 * every assertion here about the paint means the first block.
 */
function embeddedCss(svg: string): string {
  return svg.slice(svg.indexOf("<style>") + "<style>".length, svg.indexOf("</style>"));
}

/**
 * **The file references nothing outside itself** — the rule the whole export
 * design rests on, since a `url()` that resolved anywhere else would fail to load
 * in a standalone SVG and would taint the canvas the PNG path draws into.
 *
 * The subject is the **whole file**, not just the stylesheet, and that widening
 * is the point (signs spec §2.3). Scoped to `embeddedCss()` this rule would keep
 * passing by accident the moment a font arrived, because the font block is a
 * second `<style>` the slice never reaches — a rule that cannot fail on the one
 * new thing that could break it. Two references resolve inside the file and
 * nothing else does: the in-document hatch fragment, and a `data:` URI, which is
 * not a fetch but the bytes themselves.
 *
 * `diagram.css` keeps the stricter form it has always had — no `url(` at all —
 * because the hatch pattern is markup for exactly that reason.
 */
function expectSelfContained(svg: string): void {
  for (const [ref] of svg.matchAll(/url\([^)]*\)/g)) {
    expect(ref).toMatch(/^url\((#|data:)/);
  }
  expect(embeddedCss(svg)).not.toContain("url(");
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
    const svg = diagramSvg(road(2), null);
    const css = embeddedCss(svg);

    expect(css).toContain(":root,\n.zukai-diagram");
    expect(css).toContain("--asphalt: #2b2f36");
    expect(css).toContain(".road-casing");
    expect(css).toContain(".diagram-bg");
    expect(css).not.toContain("@import");
    expectSelfContained(svg);
  });

  /**
   * **The corner of a bent road is drawn twice over, and both halves have to
   * agree** — so this is the one link-bends edit that reaches an exported figure
   * rather than the canvas (link bends spec §2.4). `offsetPolyline` places every
   * painted element's centreline; SVG then joins that element's own stroke at
   * the vertex. `.road-edge`, `.road-divider` and `.lane-band` declare no join
   * and take SVG's default, which is miter, so a casing left on `round` rounds
   * the asphalt under mitred paint and hangs a white line off the outside of
   * every bend.
   *
   * Asserted **positively**, on the property this stylesheet sets rather than on
   * the paint around it: the existing rules above cannot fail if the CSS edit is
   * simply skipped, which is the vacuous shape this file's assertions avoid.
   */
  it("mitres the road casing, so the asphalt agrees with the paint on it", () => {
    const css = embeddedCss(diagramSvg(road(2), null));

    expect(css).toContain("stroke-linejoin: miter");
    // The limit is stated rather than left to the default, because the same
    // number lives in `geometry.ts` as `MITER_LIMIT` and clamps the offset.
    expect(css).toContain("stroke-miterlimit: 4");
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
    expectSelfContained(svg);
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
    expectSelfContained(svg);
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
    expectSelfContained(svg);
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
   * **A gore no longer reaches a paint server at all**, which is the inverse of
   * what this asserted through Phase 4 and is the point of Phase 5. The hatch was
   * *borrowed* — a shoulder pattern standing in for paint a gore did not have —
   * and chevrons are ordinary strokes, so a gored document with no shoulder lane
   * now carries no `<pattern>` and no `url(` whatsoever.
   *
   * The rule the hatch was carved out of therefore has one fewer exception rather
   * than a second: a paint-server reference must be an in-document fragment, or
   * it taints the canvas the PNG path draws into (`rules/diagram-export.md`,
   * "Standing constraints"). The shoulder test above is what still exercises it.
   */
  it("reaches no paint server at all, with the stylesheet unchanged in kind", () => {
    const svg = diagramSvg(gored(), { x: 0, y: 0, width: 240, height: 120 });
    const css = embeddedCss(svg);

    expect(svg).not.toContain("<pattern");
    expect(svg).not.toMatch(/url\(/);
    expectSelfContained(svg);
    expect(css).not.toMatch(/[<&]/);
    expect(css).toContain(".jn-gore");
    // The paint that replaced it travels as a rule, like every other stroke.
    expect(css).toContain(".jn-gore-chevrons");
    expect(svg).toContain('class="jn-gore-chevrons"');
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

/**
 * The turn-arc vocabulary is **gone from the file**, not merely unused: a
 * junction says which lane goes where with paint on the approach now, and the
 * three rules that drew a dashed guide across the pad left `diagram.css` with
 * the markup (lane arrows Phase 4).
 *
 * Asserted on an *exported* document because that stylesheet is inlined whole —
 * a rule nothing emits markup for would still ship in every picture.
 */
describe("the turn arcs are gone from an exported file", () => {
  function signalised(): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      { type: "setLinkLanes", id: "L1", count: 3 },
      { type: "setLinkLanes", id: "L2", count: 3 },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionControl", id: "N2", control: "signal" },
    ).doc;
  }

  it("emits no jn-movement markup and ships no rule for it", () => {
    const svg = diagramSvg(signalised(), { x: 0, y: 0, width: 240, height: 40 });

    expect(svg).not.toContain("jn-movement");
    expect(embeddedCss(svg)).not.toContain("jn-movement");
    // The glyph itself is unchanged: the pad and its stop bars still ship.
    expect(svg).toContain('class="jn-pad"');
    expect(svg).toContain('class="jn-stopbar"');
  });

  /**
   * The cross-spec obligation for the pad's new outline, checked rather than
   * assumed — and the expected answer is "nothing to do", the wedge's and the
   * gore's answer for the wedge's and the gore's reason.
   *
   * `strokeAllowance` exists because `getBBox` excludes *stroke* width, which is
   * the whole of the road casing. The pad is **fill**, as it was when it was a
   * circle, and every vertex of it sits inside the disc the arms' own reach
   * derives — which is inside the frame the roads already demand.
   */
  it("needs no allowance for a pad that follows its arms", () => {
    const doc = signalised();

    expect(strokeAllowance(doc)).toBe(roadWidth(doc.links[0].lanes) / 2);
    expect(strokeAllowance(doc)).toBe(strokeAllowance(road(3)));

    const corners = diagramInner(doc)
      .match(/class="jn-pad" d="([^"]+)"/)![1]
      .matchAll(/[ML] ([-\d.e]+) ([-\d.e]+)/g);
    const [x, y, w, h] = diagramSvg(doc, { x: 0, y: 0, width: 240, height: 40 })
      .match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!
      .slice(1)
      .map(Number);

    let seen = 0;
    for (const m of corners) {
      seen++;
      // The glyph group is translated to N2 at (120, 0), as the gore's is.
      const cx = Number(m[1]) + 120;
      const cy = Number(m[2]);
      expect(cx).toBeGreaterThan(x);
      expect(cx).toBeLessThan(x + w);
      expect(cy).toBeGreaterThan(y);
      expect(cy).toBeLessThan(y + h);
    }
    expect(seen).toBeGreaterThan(8);
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
    expectSelfContained(svg);
    expect(css).not.toMatch(/[<&]/);
    expect(svg).not.toMatch(CHROME);
    // Paint on the road scales with the road: no hairline exemption here.
    expect(svg).not.toMatch(/vector-effect/);
  });

  /**
   * **No text unless the document asks for it.** Markings spec §2.8 held this as
   * an absolute — an exported SVG reaches no external font, so the first `<text>`
   * either falls back to whatever the viewer has or, in the PNG path, bakes that
   * substitution in permanently — and signs spec Phase 1 is the thing that made
   * it conditional instead, by embedding the face as a data-URI `@font-face`
   * (export spec OQ-4, resolved).
   *
   * What survives unchanged is this document, and that is the whole point: a
   * drawing with no glyph exports the **same markup and the same font posture as
   * before**. No `<text>`, no `font-family` anywhere in the file — which is what
   * pins that the face is declared as an *attribute* on the element rather than
   * as a rule in `diagram.css`, since that stylesheet travels inside every
   * picture and would fail this line for all of them (signs spec §2.3).
   *
   * The interaction chrome carries no text either, so this holds for the live
   * tree as well as the file.
   */
  it("emits no text at all for a document that carries none", () => {
    const svg = diagramSvg(painted(), { x: 0, y: 0, width: 120, height: 40 });

    expect(svg).not.toMatch(/<text[\s>]|<tspan[\s>]|font-family/);
    expect(diagramInner(painted())).not.toMatch(/<text[\s>]|<tspan[\s>]/);
    // And the stylesheet names no font either, so nothing can resolve to one.
    expect(embeddedCss(svg)).not.toMatch(/@font-face|font-family/);
  });

  /**
   * The other kinds travel on the same terms: their paint is a rule in
   * `diagram.css` like every other, and their geometry is polygons and
   * polylines, so nothing about them reaches outside the file.
   *
   * The arrow is the first marking to carry a `stroke-width` **attribute** rather
   * than take one from the stylesheet — its stem is a fraction of the band, as a
   * lane band's own width is — so this is also what confirms that width travels.
   */
  it("carries a give-way line, a crossing and a turn arrow too", () => {
    for (const [kind, cls] of [
      [{ type: "give_way_line" }, "marking-teeth"],
      [{ type: "crosswalk" }, "marking-zebra"],
      [{ type: "turn_arrow", directions: ["through", "right"] }, "marking-arrow-stem"],
    ] as [MarkingKind, string][]) {
      const doc = painted(kind);
      const svg = diagramSvg(doc, { x: 0, y: 0, width: 120, height: 40 });

      expect(svg).toContain(`class="${cls}"`);
      expect(embeddedCss(svg)).toContain(`.${cls}`);
      expect(svg).not.toMatch(/<text[\s>]|<tspan[\s>]|font-family/);
      expectSelfContained(svg);
      expect(svg).not.toMatch(CHROME);
      // And no widening: every marking is inside the road it is painted on.
      expect(strokeAllowance(doc)).toBe(strokeAllowance(road(3)));
    }

    // The arrow's own stroke width, which no rule in the stylesheet carries.
    expect(
      diagramSvg(painted({ type: "turn_arrow", directions: ["through"] }), {
        x: 0,
        y: 0,
        width: 120,
        height: 40,
      }),
    ).toMatch(/class="marking-arrow-stem" d="[^"]+" stroke-width="[\d.]+"/);
  });

  /**
   * The undivided two-way road — road spec OQ-4, answered with paint rather than
   * a model field. Its centreline is the one marking that is **not white**, and
   * the colour travels the way every other treatment does: a class token on the
   * element and a rule in `diagram.css`, so the file and the canvas cannot come
   * to disagree about what a double line looks like.
   */
  it("carries a two-way double centreline, colour and all", () => {
    const base = road(2);
    const twoWay: Document = {
      ...base,
      markings: [
        { id: "M1", link: "L1", position: 14, kind: { type: "lane_line", style: "double" } },
      ],
    };
    const svg = diagramSvg(twoWay, { x: 0, y: 0, width: 120, height: 40 });
    const css = embeddedCss(svg);

    expect(svg).toContain('<g class="marking marking-lane-line">');
    expect(svg).toContain('class="marking-line marking-line-double"');
    expect(css).toContain(".marking-line");
    expect(css).toContain(".marking-line-double");
    // The divider it replaced is gone from the drawing too, not merely covered
    // — the stylesheet still carries the rule, which is why this reads the
    // markup rather than the whole file.
    expect(diagramInner(twoWay)).not.toContain("road-divider");
    expectSelfContained(svg);
    expect(svg).not.toMatch(/<text[\s>]|<tspan[\s>]|font-family/);
    expect(svg).not.toMatch(CHROME);
    // A line runs the length of the road it is painted on, so it needs no more
    // allowance than the road does.
    expect(strokeAllowance(twoWay)).toBe(strokeAllowance(base));
  });

  /**
   * **The font a picture carries inside itself** (signs spec Phase 1). Every
   * assertion below is about one thing: an exported file that draws a glyph has
   * to reach nothing outside itself to draw it, and one that draws no glyph must
   * pay nothing for the ability.
   */
  describe("the embedded face", () => {
    /** §1's flow: a stop line in the kerb lane, repainted as the word `BUS`. */
    const lettered = painted({ type: "text", content: "BUS" });
    const box = { x: 0, y: 0, width: 120, height: 40 };

    it("embeds the face exactly once, as bytes rather than a reference", () => {
      const svg = diagramSvg(lettered, box);

      expect(svg.match(/@font-face/g)).toHaveLength(1);
      expect(svg).toContain('font-family:"Overpass Mono"');
      expect(svg).toContain("src:url(data:font/woff2;base64,");
      // The markup asks for the same family the block defines. One constant,
      // and this is the assertion that would catch the two drifting apart.
      expect(svg).toContain('font-family="Overpass Mono"');
      // Not a fetch, not an @import, and nothing outside the file at all.
      expect(svg).not.toContain("@import");
      expectSelfContained(svg);
      expect(diagramInner(lettered)).not.toMatch(/xlink|href|https?:/);
    });

    /**
     * The order is load-bearing, not cosmetic: `embeddedCss()` slices the
     * **first** stylesheet, so a font block emitted before `diagram.css` would
     * silently redirect every assertion in this file onto the wrong one.
     */
    it("emits the font as a second stylesheet, after the paint", () => {
      const svg = diagramSvg(lettered, box);
      const css = embeddedCss(svg);

      expect(css).toContain(".road-casing");
      expect(css).toContain(".marking-text");
      expect(css).not.toContain("@font-face");
      expect(svg.match(/<style>/g)).toHaveLength(2);
      expect(svg.indexOf("--asphalt")).toBeLessThan(svg.indexOf("@font-face"));
    });

    /**
     * Base64's alphabet is `A-Z a-z 0-9 + / =`, so it can carry neither a `<` to
     * end the element nor an `&` to start an entity — which is what makes it
     * legal to embed raw inside XML at all. Asserted on **both** blocks, since
     * the rule was only ever checked on one.
     */
    it("keeps both stylesheets XML-safe", () => {
      const svg = diagramSvg(lettered, box);
      const blocks = [...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)];

      expect(blocks).toHaveLength(2);
      for (const [, body] of blocks) expect(body).not.toMatch(/[<&]/);
    });

    /**
     * OFL-1.1 requires the notice to travel with the font. It rides as an XML
     * comment, which is legal outside `<style>` and is the one place in the file
     * that may carry the URL the notice names — and it carries no `--`, the one
     * sequence an XML comment may not hold.
     */
    it("carries the licence notice with the bytes it covers", () => {
      const svg = diagramSvg(lettered, box);
      const comment = svg.match(/<!--[\s\S]*?-->/)![0];

      expect(comment).toContain("The Overpass Project Authors");
      expect(comment).toContain("SIL Open Font License 1.1");
      expect(comment.slice(4, -3)).not.toContain("--");
      // And only where the bytes are: no font, nothing to attribute.
      expect(diagramSvg(painted(), box)).not.toContain("<!--");
    });

    /**
     * The gate is what the tree *emits*, not what the model carries — one
     * predicate for both, so a file can never hold a face with no text or, worse,
     * text with no face. An empty content draws the placeholder bar instead, so
     * the marking stays visible and selectable while costing nothing.
     */
    it("costs a document with no glyph nothing at all", () => {
      for (const doc of [painted(), painted({ type: "text", content: "" })]) {
        const svg = diagramSvg(doc, box);

        expect(svg).not.toMatch(/@font-face|<text[\s>]|font-family/);
        expect(svg.match(/<style>/g)).toHaveLength(1);
        expect(svg).toContain('class="marking-bar"');
      }
    });

    /** The one element in the drawing whose content a human types. */
    it("escapes a typed angle bracket rather than ending the document", () => {
      const svg = diagramSvg(painted({ type: "text", content: "A<B&C" }), box);

      expect(svg).toContain(">A&lt;B&amp;C</text>");
      // Which leaves the file's only bare `<` characters as real elements.
      expect(svg.match(/<text[\s>]/g)).toHaveLength(1);
    });

    /**
     * Text is fill, and `getBBox` includes fill — so unlike a road casing's
     * stroke it needs no allowance of its own. Confirmed rather than assumed:
     * §2.8 flagged this as the one place a glyph could have widened the frame.
     */
    it("needs no more stroke allowance than the road it is painted on", () => {
      expect(strokeAllowance(lettered)).toBe(strokeAllowance(road(3)));
    });

    /**
     * **The gate is deliberately conservative about signs, and that asymmetry is
     * the design** (signs spec §2.3). A sign whose label is empty draws a plate
     * and no `<text>` — and the face travels anyway, because refining the
     * predicate to "signs whose kind draws a glyph" would put the kind vocabulary
     * in the export path, where it can fall out of step with what Phase 3 draws.
     * 18 kB on a rare sign-without-letters document is the price, recorded here so
     * a later pass does not read it as an oversight.
     *
     * The marking half is not conservative and must not become one: it counts
     * exactly what the tree emits a `<text>` for.
     */
    it("embeds the face for a signed document, glyph or no glyph", () => {
      for (const label of ["TOLL", ""]) {
        const svg = diagramSvg(signed(label), box);

        expect(svg.match(/@font-face/g)).toHaveLength(1);
        expect(svg.match(/<style>/g)).toHaveLength(2);
        expect(svg).toContain("The Overpass Project Authors");
        expectSelfContained(svg);
      }
      // The two halves, stated rather than implied: no label, no glyph.
      expect(diagramSvg(signed(""), box)).not.toMatch(/<text[\s>]/);
      expect(diagramSvg(signed("TOLL"), box)).toContain(
        'font-family="Overpass Mono"',
      );
    });

    /**
     * **The third arm, and the trap it closes** (link-length spec §2.5). A length
     * label is a `<text>` the tree emits from a link rather than from a marking or
     * a sign, so a document carrying one and nothing else would have exported an
     * SVG **naming Overpass Mono without carrying its bytes** — the viewer
     * substitutes whatever it has, and the PNG path bakes that in permanently.
     *
     * The isolation is the whole assertion: no sign, no text marking, nothing but
     * the road and the length it states.
     */
    it("embeds the face for a document whose only text is a length", () => {
      const svg = diagramSvg(stated(1800), box);

      expect(svg.match(/@font-face/g)).toHaveLength(1);
      expect(svg.match(/<style>/g)).toHaveLength(2);
      expect(svg).toContain("The Overpass Project Authors");
      expect(svg).toContain('font-family="Overpass Mono"');
      expect(svg).toContain(">1800m</text>");
      expect(svg.match(/<text[\s>]/g)).toHaveLength(1);
      expectSelfContained(svg);
      // The isolation, asserted on the drawing rather than on the file: the
      // paint for every kind travels in `diagram.css` whether it is used or not.
      expect(diagramInner(stated(1800))).not.toMatch(/sign|marking/);
    });

    /** The other half, and the one that would fail if the arm were left out of
     *  `needsText` while the label still drew: a road stating nothing pays
     *  nothing, exactly as it did before the field existed. */
    it("costs a road that states no length nothing at all", () => {
      const svg = diagramSvg(road(3), box);

      expect(svg).not.toMatch(/@font-face|<text[\s>]|font-family/);
      expect(svg.match(/<style>/g)).toHaveLength(1);
    });

    /** A label is fill, `getBBox` measures fill, and it sits inside the measured
     *  group — so the frame grows to include it by construction (§2.5). */
    it("needs no more stroke allowance than the road it is set beside", () => {
      expect(strokeAllowance(stated(1800))).toBe(strokeAllowance(road(3)));
    });
  });
});

describe("signs in an exported file", () => {
  const box = { x: 0, y: 0, width: 120, height: 40 };

  it("carries the plate's paint as a rule, like every other", () => {
    const svg = diagramSvg(signed("TOLL"), box);
    const css = embeddedCss(svg);

    expect(svg).toContain('<g class="sign sign-custom"');
    expect(svg).toContain('class="sign-plate"');
    expect(svg).toContain('class="sign-label"');
    expect(css).toContain(".sign-plate");
    expect(css).toContain(".sign-label");
    expectSelfContained(svg);
    expect(css).not.toMatch(/[<&]/);
    expect(svg).not.toMatch(CHROME);
    // A sign is a symbol, and its outline holds its weight only on the canvas.
    expect(svg).not.toMatch(/vector-effect/);
  });

  /**
   * A plate is a filled rect with a 1-unit outline, so half of it is well under
   * the `2` floor — and `getBBox` measures fill with no allowance at all.
   * Confirmed rather than assumed: §2.8 flagged the frame as the one place a sign
   * could have needed widening.
   */
  it("needs no more stroke allowance than the road it stands beside", () => {
    expect(strokeAllowance(signed("HEATHROW"))).toBe(strokeAllowance(road(3)));
  });

  /**
   * **The whole vocabulary travels, colours and all** (signs spec Phase 3). A sign
   * is drawn from geometry and painted by a rule, so the export path needs to know
   * about neither — and this is what says so: every kind's own token in the markup,
   * every kind's own rule in the stylesheet, and the palette entry all three reds
   * resolve through, with the file still referring to nothing outside itself.
   */
  it("carries every kind, and the sign colour they are painted from", () => {
    const svg = diagramSvg(vocabulary(), box);
    const css = embeddedCss(svg);

    for (const kind of EVERY_KIND) {
      expect(svg).toContain(`<g class="sign sign-${kind.type.replace(/_/g, "-")}"`);
    }
    for (const rule of [
      "--sign-red",
      ".sign-roundel",
      ".sign-roundel-ring",
      ".sign-octagon",
      ".sign-triangle",
      ".sign-diamond-border",
      ".sign-diamond",
      ".sign-disc",
      ".sign-bar",
      ".sign-stop .sign-label",
      // The two colours, and the two rules the second one exists for: a
      // destination is a rectangle as wide as its words, exactly as a `custom`
      // plate is, so colour is the only thing that separates them (Phase 4).
      "--sign-green",
      ".sign-direction .sign-plate",
      ".sign-direction .sign-label",
    ]) {
      expect(css).toContain(rule);
    }
    // The letters three of them carry, and the one string that is deliberately not
    // drawn: a warning's symbol names a pictogram no phase draws (OQ-6).
    expect(svg).toContain(">50</text>");
    expect(svg).toContain(">STOP</text>");
    expect(svg).toContain(">M4 W</text>");
    expect(svg).not.toContain("bend_right");

    expectSelfContained(svg);
    expect(css).not.toMatch(/[<&]/);
    expect(svg).not.toMatch(CHROME);
    expect(svg).not.toMatch(/vector-effect/);
  });

  /**
   * A symbol is fill and a stroke of at most 3, so half of it stays under the `2`
   * floor — the same answer the plate got, checked again because Phase 3 is what
   * put the widest stroke in the sign layer.
   */
  it("needs no more allowance for a symbol than for a plate", () => {
    expect(strokeAllowance(vocabulary())).toBe(strokeAllowance(road(3)));
  });

  /**
   * **The widest thing the drawing can make, exported whole** (signs spec Phase 4)
   * — the clipping question §2.8 raised and OQ-2 answered. A long destination is
   * the only element whose extent is unbounded by a build constant: every other
   * sign is `SIGN_SIZE` and every road is `roadWidth`, while a plate is as wide as
   * whatever a human types.
   *
   * The framing itself is `measureDiagram`'s and needs a DOM this suite does not
   * have, so what is asserted here is the half that decides it: the plate is fill
   * with a 1-unit outline, so half of that stays under `strokeAllowance`'s `2`
   * floor and `getBBox` — which measures fill — already contains the letters. A
   * plate that needed *more* room than the road it stands beside is the failure
   * that would clip, and it would show up here as an allowance that moved.
   */
  it("carries a long destination whole, and asks the frame for no more room", () => {
    const text = "HEATHROW & THE WEST";
    const svg = diagramSvg(destination(text), box);
    const plate = signPlate(text);

    // Wider than any symbol in the vocabulary, and wider than its own floor —
    // otherwise this asserts nothing the `TOLL` case did not.
    expect(plate.box.width).toBeGreaterThan(SIGN_SIZE * 2);
    expect(svg).toContain(`<rect class="sign-plate" x="${plate.box.x}"`);
    expect(svg).toContain(`width="${plate.box.width}"`);
    // The whole string, escaped — the third human-typed run to reach an XML file.
    expect(svg).toContain(">HEATHROW &amp; THE WEST</text>");

    expect(svg.match(/@font-face/g)).toHaveLength(1);
    expectSelfContained(svg);
    expect(strokeAllowance(destination(text))).toBe(strokeAllowance(road(3)));
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
