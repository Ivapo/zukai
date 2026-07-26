import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BASELINE_DROP,
  CROSSWALK_DEPTH,
  GIVE_WAY_DEPTH,
  GORE_LENGTH,
  LANE_LINE_GAP,
  LANE_PX,
  ROAD_MARGIN,
  SCHEMATIC_MEDIAN,
  SIGN_SIZE,
  classWidthFactor,
  signPlate,
} from "../editor/geometry";
import { Action, EditorState, initialState, reducer } from "../editor/state";
import {
  Document,
  LaneKind,
  LineStyle,
  LinkAlign,
  LinkStyle,
  Marking,
  SignKind,
} from "../model/types";
import { Diagram, Interaction } from "./Diagram";

/** Every road class the Inspector offers. */
const LINK_STYLES: LinkStyle[] = ["motorway", "arterial", "local", "ramp"];

/** Apply a sequence of actions, as the UI would dispatch them. */
function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(reducer, state);
}

/**
 * An endpoint and a roundabout junction joined by a 3-lane link — enough to
 * exercise every branch that carries chrome: road hit target and halo, lane
 * dividers, the junction hit disc, and the roundabout's `vector-effect` circles.
 */
function sample(): Document {
  return run(
    initialState(),
    { type: "addNode", pos: { x: 0, y: 0 } },
    { type: "addNode", pos: { x: 120, y: 40 } },
    { type: "startLink", from: "N1" },
    { type: "completeLink", to: "N2" },
    { type: "setLinkLanes", id: "L1", count: 3 },
    { type: "setNodeKind", id: "N2", kind: "junction" },
    { type: "setJunctionGlyph", id: "N2", glyph: "roundabout" },
  ).doc;
}

/** The live canvas's interaction, with the road selected. */
function interaction(): Interaction {
  return {
    selection: { kind: "link", id: "L1" },
    linkFrom: null,
    cursor: null,
    onNodePointerDown: () => {},
    onLinkPointerDown: () => {},
    onMarkingPointerDown: () => {},
    onSignPointerDown: () => {},
  };
}

describe("Diagram in export mode", () => {
  it("renders the drawing and none of the canvas chrome", () => {
    const svg = renderToStaticMarkup(<Diagram doc={sample()} />);

    expect(svg).not.toMatch(/road-hit|jn-hit|halo|is-selected|link-preview/);
    // Hairlines must scale with the drawing in a file (spec §2.5).
    expect(svg).not.toMatch(/vector-effect/);
  });

  it("emits its own <g class=\"diagram\"> root around the drawing", () => {
    const svg = renderToStaticMarkup(<Diagram doc={sample()} />);

    expect(svg.startsWith('<g class="diagram">')).toBe(true);
    expect(svg.endsWith("</g>")).toBe(true);
    expect(svg).toContain("road-casing");
    expect(svg).toContain("node-dot");
    expect(svg).toContain("jn-ring");
  });

  it("draws an empty document as an empty group", () => {
    const empty = initialState().doc;

    expect(renderToStaticMarkup(<Diagram doc={empty} />)).toBe(
      '<g class="diagram"></g>',
    );
  });
});

describe("RoadShape geometry", () => {
  /** Two nodes 120 units apart on the x axis, joined by a `lanes`-lane link. */
  function straight(lanes: number): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: lanes },
    ).doc;
  }

  /**
   * The drawn width, edge lines, and lane dividers of a 4-lane road, pinned to
   * exact numbers.
   *
   * A regression pin, not a restatement: the road spec's Phase 1 replaced a
   * fixed 9-units-per-lane pitch with a derivation from each `Lane.width`, and
   * a default document has to keep drawing *identically*. These are the numbers
   * the fixed-pitch code emitted — casing `4 * 9 + 3`, edge lines inset 1.5
   * from its rim, dividers on the 9-unit lane boundaries. A road drawn due east
   * offsets purely in y, so every offset reads off the path directly.
   */
  it("draws a 4-lane road at the same width, insets, and lane pitch as ever", () => {
    const svg = renderToStaticMarkup(<Diagram doc={straight(4)} />);

    expect(svg).toContain('class="road-casing" d="M 0 0 L 120 0" stroke-width="39"');
    expect(svg).toContain('class="road-edge" d="M 0 18 L 120 18"');
    expect(svg).toContain('class="road-edge" d="M 0 -18 L 120 -18"');
    for (const y of [9, 0, -9]) {
      expect(svg).toContain(`class="road-divider" d="M 0 ${y} L 120 ${y}"`);
    }
    // Three dividers for four lanes: the outermost boundaries are the edge lines.
    expect(svg.match(/road-divider/g)).toHaveLength(3);
  });

  it("draws a 1-lane road with no dividers at all", () => {
    const svg = renderToStaticMarkup(<Diagram doc={straight(1)} />);

    expect(svg).toContain('class="road-casing" d="M 0 0 L 120 0" stroke-width="12"');
    expect(svg).toContain('class="road-edge" d="M 0 4.5 L 120 4.5"');
    expect(svg).not.toContain("road-divider");
  });
});

describe("road class", () => {
  /** A `lanes`-lane link drawn due east from the origin, at road class `style`. */
  function classed(style: LinkStyle, lanes = 4): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: lanes },
      { type: "setLinkStyle", id: "L1", style },
    ).doc;
  }

  /** Every `y` a road drawn due east paints its `cls` lines at. */
  function offsets(svg: string, cls: string): number[] {
    return [...svg.matchAll(new RegExp(`class="${cls}" d="M 0 (\\S+) L`, "g"))]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  }

  /** The casing's drawn width. */
  function casingWidth(svg: string): number {
    return Number(svg.match(/class="road-casing"[^>]*stroke-width="(\S+?)"/)![1]);
  }

  it("tags the road group with its class, for every class", () => {
    for (const style of LINK_STYLES) {
      const svg = renderToStaticMarkup(<Diagram doc={classed(style)} />);
      expect(svg).toContain(`<g class="road road-${style}">`);
    }
  });

  /**
   * An imported or hand-edited document need not carry a `LinkView` at all, and
   * the drawing still has to pick a class — the same default the Inspector shows.
   */
  it("falls back to arterial for a link with no layout entry", () => {
    const doc = classed("ramp");
    const bare: Document = {
      ...doc,
      layout: { ...doc.layout, links: {} },
    };

    expect(renderToStaticMarkup(<Diagram doc={bare} />)).toContain(
      '<g class="road road-arterial">',
    );
  });

  /**
   * The width factor has to reach the *lane-derived* geometry, not just the
   * casing. Scaling the finished width alone narrows the asphalt while the
   * dividers stay at full pitch and spill outside it — a broken drawing that a
   * casing-and-edges check would pass (road spec 2.3).
   */
  it("narrows a ramp's casing, edge lines and lane dividers together", () => {
    const plain = renderToStaticMarkup(<Diagram doc={classed("arterial")} />);
    const ramp = renderToStaticMarkup(<Diagram doc={classed("ramp")} />);
    const f = classWidthFactor("ramp");

    // The casing carries the lane region, which scales, plus the unscaled lip.
    expect(casingWidth(ramp)).toBeLessThan(casingWidth(plain));
    expect(casingWidth(ramp) - ROAD_MARGIN).toBeCloseTo(
      f * (casingWidth(plain) - ROAD_MARGIN),
    );

    const rampEdges = offsets(ramp, "road-edge");
    const rampDividers = offsets(ramp, "road-divider");
    expect(rampEdges).toHaveLength(2);
    expect(rampDividers).toHaveLength(3);

    // Every lane-derived line moved inward by the same factor. The edge lines
    // sit at the lane region's half-span, so they scale with it as cleanly as
    // the dividers do — the casing is the only quantity carrying the lip.
    const plainEdges = offsets(plain, "road-edge");
    const plainDividers = offsets(plain, "road-divider");
    for (let i = 0; i < rampEdges.length; i++) {
      expect(rampEdges[i]).toBeCloseTo(f * plainEdges[i]);
    }
    for (let i = 0; i < rampDividers.length; i++) {
      expect(rampDividers[i]).toBeCloseTo(f * plainDividers[i]);
    }

    // And the paint stays on the road: no divider outside its own edge lines.
    for (const d of rampDividers) {
      expect(Math.abs(d)).toBeLessThan(Math.abs(rampEdges[0]));
    }
  });

  /** `junctionArms` measures each approach, so the class sizes the pad too. */
  it("sizes a junction pad from the class of the roads meeting it", () => {
    const pad = (style: LinkStyle) => {
      const doc = run(
        initialState(),
        { type: "addNode", pos: { x: 0, y: 0 } },
        { type: "addNode", pos: { x: 120, y: 0 } },
        { type: "startLink", from: "N1" },
        { type: "completeLink", to: "N2" },
        { type: "setLinkStyle", id: "L1", style },
        { type: "setNodeKind", id: "N2", kind: "junction" },
      ).doc;
      const svg = renderToStaticMarkup(<Diagram doc={doc} />);
      return Number(svg.match(/class="jn-pad" r="(\S+?)"/)![1]);
    };

    expect(pad("ramp")).toBeLessThan(pad("arterial"));
  });
});

describe("lane kinds", () => {
  /** A 4-lane road due east, with `kinds` applied by lane index. */
  function withKinds(...kinds: [number, LaneKind][]): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: 4 },
      ...kinds.map(
        ([lane, kind]): Action => ({ type: "setLaneKind", id: "L1", lane, kind }),
      ),
    ).doc;
  }

  /** Attributes of every `<path>` carrying `cls`, in document order. */
  function bands(svg: string, cls: string): string[] {
    return [...svg.matchAll(new RegExp(`<path class="${cls}"[^>]*>`, "g"))].map(
      (m) => m[0],
    );
  }

  it("paints a band for a shoulder lane and none for a general one", () => {
    // Four lanes, none classified: the markup is what it was before lane kinds.
    expect(renderToStaticMarkup(<Diagram doc={withKinds()} />)).not.toContain(
      "lane-band",
    );

    const shoulder = renderToStaticMarkup(
      <Diagram doc={withKinds([0, "shoulder"])} />,
    );
    expect(bands(shoulder, "lane-band lane-band-shoulder")).toHaveLength(1);
  });

  /**
   * Lane 0 is the nearside (kerb) lane, so its band takes the most positive
   * offset — `+y` for a road drawn due east. A shoulder that renders in the
   * median instead of on the outside is the failure this pins (spec §2.2), and
   * no count-of-bands assertion catches it.
   */
  it("puts lane 0's band on the nearside, at that lane's own width", () => {
    const svg = renderToStaticMarkup(<Diagram doc={withKinds([0, "shoulder"])} />);
    const band = bands(svg, "lane-band lane-band-shoulder")[0];

    // 4 default lanes: bands at +13.5, +4.5, -4.5, -13.5, each 9 wide.
    expect(band).toContain('d="M 0 13.5 L 120 13.5"');
    expect(band).toContain('stroke-width="9"');
  });

  it("tints a bus lane rather than hatching it", () => {
    const svg = renderToStaticMarkup(<Diagram doc={withKinds([1, "bus"])} />);

    expect(bands(svg, "lane-band lane-band-bus")).toHaveLength(1);
    expect(svg).not.toContain("url(");
    expect(svg).not.toContain("lane-band-shoulder");
  });

  it("leaves a turn pocket plain, like a general lane", () => {
    const svg = renderToStaticMarkup(<Diagram doc={withKinds([2, "turn"])} />);

    expect(svg).not.toContain("lane-band");
  });

  /**
   * The hatch is the one piece of paint that cannot travel as a CSS rule, so it
   * is a `<pattern>` in the markup — which must be **conditional**: the empty
   * document renders as exactly `<g class="diagram"></g>` (asserted above), and
   * an unconditional `<defs>` breaks that.
   */
  it("emits the hatch pattern only when a shoulder is actually drawn", () => {
    const plain = renderToStaticMarkup(<Diagram doc={withKinds([1, "bus"])} />);
    expect(plain).not.toContain("<defs>");
    expect(plain).not.toContain("pattern");

    const hatched = renderToStaticMarkup(
      <Diagram doc={withKinds([0, "shoulder"])} />,
    );
    expect(hatched).toContain('<pattern id="road-hatch"');
    expect(hatched).toContain('stroke="url(#road-hatch)"');
    // The pattern's own line takes its colour from the stylesheet, so nothing
    // here reaches outside the file.
    expect(hatched).toContain('class="road-hatch-line"');
    expect(hatched).not.toMatch(/href|http/);
  });

  /**
   * §2.5's line table: a dashed divider means "lanes, same direction, cross
   * freely", which a hard-shoulder boundary does not. It is also the whole of
   * what makes a motorway read differently from an arterial.
   */
  it("draws a shoulder boundary solid, and the rest still dashed", () => {
    const plain = renderToStaticMarkup(<Diagram doc={withKinds()} />);
    expect(plain.match(/road-divider/g)).toHaveLength(3);
    expect(plain).not.toContain("road-shoulder-line");

    const svg = renderToStaticMarkup(<Diagram doc={withKinds([0, "shoulder"])} />);
    // The boundary between lane 0 and lane 1 changes hands: 2 dividers, 1
    // shoulder line, still three boundaries for four lanes.
    expect(svg.match(/road-divider/g)).toHaveLength(2);
    expect(svg.match(/road-shoulder-line/g)).toHaveLength(1);
    expect(svg).toContain('class="road-shoulder-line" d="M 0 9 L 120 9"');
  });

  /** A shoulder either side of a boundary still yields one solid line. */
  it("draws a boundary between two shoulders solid too", () => {
    const svg = renderToStaticMarkup(
      <Diagram doc={withKinds([0, "shoulder"], [1, "shoulder"])} />,
    );

    expect(svg.match(/road-shoulder-line/g)).toHaveLength(2);
    expect(svg.match(/road-divider/g)).toHaveLength(1);
  });

  /**
   * OQ-4, resolved: nothing in the model can tell "one link the user thinks of
   * as two-way" from "one carriageway of a pair", so a lone link gets edge lines
   * and dividers and no centreline **invented** for it.
   *
   * Still true after the markings spec's Phase 4, and the distinction is the
   * whole of that resolution: a centreline is now *paintable* — a `lane_line`
   * with no lane, which is the human saying the road is two-way — but nothing
   * derives one from the model, which is what would have needed a field.
   */
  it("gives a lone road no centreline it did not ask for", () => {
    const svg = renderToStaticMarkup(<Diagram doc={withKinds()} />);

    expect(svg).not.toContain("centre");
    expect(svg.match(/road-edge/g)).toHaveLength(2);
  });
});

describe("two-way carriageways", () => {
  /**
   * Two nodes 120 apart, joined by a link each way — a two-way road exactly as
   * the model spells one: two links with opposite `from_node`/`to_node`. Lanes
   * pinned at 2 so the numbers below don't move with `NEW_LINK_LANES`.
   */
  function divided(): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N1" },
      { type: "setLinkLanes", id: "L1", count: 2 },
      { type: "setLinkLanes", id: "L2", count: 2 },
    ).doc;
  }

  /**
   * Before this, the pair drew on one centreline and a two-way road was
   * invisible as two. Now each half steps out by `roadWidth/2 + median/2`.
   *
   * The signs are the load-bearing half: SVG's y points down, so the eastbound
   * link belongs *below* the centreline under right-hand traffic, and its
   * westbound twin above. Both offsets are positive — the opposition lives in
   * each link's polyline frame — so only the drawn `y` can tell them apart.
   */
  it("draws the two halves apart, on the sides right-hand traffic puts them", () => {
    const svg = renderToStaticMarkup(<Diagram doc={divided()} />);

    expect(svg).toContain('class="road-casing" d="M 0 13.5 L 120 13.5"');
    expect(svg).toContain('class="road-casing" d="M 120 -13.5 L 0 -13.5"');

    // Both casings 21 wide, so each spans 3..24 from the centreline on its own
    // side: a 6-unit median down the middle, and no overlap anywhere.
    const widths = [
      ...svg.matchAll(/class="road-casing"[^>]*stroke-width="(\S+?)"/g),
    ].map((m) => Number(m[1]));
    expect(widths).toEqual([21, 21]);
    expect(13.5 - 21 / 2).toBe(SCHEMATIC_MEDIAN / 2);
  });

  it("leaves the same road on the centreline once its twin is gone", () => {
    const oneWay = run(
      { ...initialState(), doc: divided() },
      { type: "select", selection: { kind: "link", id: "L2" } },
      { type: "deleteSelection" },
    ).doc;
    const svg = renderToStaticMarkup(<Diagram doc={oneWay} />);

    expect(svg).toContain('class="road-casing" d="M 0 0 L 120 0"');
    expect(svg).not.toContain("13.5");
  });
});

describe("link alignment", () => {
  /** A 4-lane arterial drawn due east from the origin, aligned `align`. */
  function aligned(align: LinkAlign): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: 4 },
      { type: "setLinkAlign", id: "L1", align },
    ).doc;
  }

  /** Every `y` a road drawn due east paints its `cls` lines at, ascending. */
  function offsets(svg: string, cls: string): number[] {
    return [...svg.matchAll(new RegExp(`class="${cls}" d="M 0 (\\S+) L`, "g"))]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  }

  it("draws a centred link exactly where an unaligned one goes", () => {
    const centred = renderToStaticMarkup(<Diagram doc={aligned("centre")} />);

    // The 4-lane pin from `RoadShape geometry`, unmoved: setting `centre`
    // explicitly is the same drawing as never setting anything.
    expect(centred).toContain('class="road-casing" d="M 0 0 L 120 0"');
    expect(offsets(centred, "road-edge")).toEqual([-18, 18]);
  });

  /**
   * The sign, in the direction §2.3 derives rather than as a magnitude — a
   * magnitude test passes under an inversion, which is the trap the road spec
   * hit four times.
   *
   * Lane 0 is the nearside lane at the most *positive* offset, so an
   * `offside`-aligned eastbound road puts its **offside edge on `y = 0`** and
   * its whole lane region at **positive** `y`: it hangs to the nearside of its
   * own polyline. 4 default lanes give a 36-unit lane region, so the shift is
   * 18 and the far (nearside) edge lands at 36.
   */
  it("puts an offside-aligned road's offside edge on its polyline", () => {
    const svg = renderToStaticMarkup(<Diagram doc={aligned("offside")} />);

    expect(svg).toContain('class="road-casing" d="M 0 18 L 120 18"');
    expect(offsets(svg, "road-edge")).toEqual([0, 36]);
    // Every lane-derived line at or below the polyline, none above it.
    for (const y of offsets(svg, "road-divider")) {
      expect(y).toBeGreaterThan(0);
    }
  });

  it("mirrors it exactly for nearside", () => {
    const svg = renderToStaticMarkup(<Diagram doc={aligned("nearside")} />);

    expect(svg).toContain('class="road-casing" d="M 0 -18 L 120 -18"');
    expect(offsets(svg, "road-edge")).toEqual([-36, 0]);
    for (const y of offsets(svg, "road-divider")) {
      expect(y).toBeLessThan(0);
    }
  });

  /**
   * The two lateral terms **compose by addition**; neither wins. A 2-lane
   * carriageway steps 13.5 off the shared centreline and an `offside` alignment
   * adds its own 9 — so the aligned half moves to 22.5 while its twin stays put.
   *
   * That the pair's halves no longer straddle the median symmetrically is the
   * named consequence of composing (spec §2.3), not a defect: alignment is a
   * per-carriageway control on a divided road.
   */
  it("adds alignment to a carriageway offset rather than replacing it", () => {
    const doc = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N1" },
      { type: "setLinkLanes", id: "L1", count: 2 },
      { type: "setLinkLanes", id: "L2", count: 2 },
      { type: "setLinkAlign", id: "L1", align: "offside" },
    ).doc;
    const svg = renderToStaticMarkup(<Diagram doc={doc} />);

    expect(svg).toContain('class="road-casing" d="M 0 22.5 L 120 22.5"');
    expect(svg).toContain('class="road-casing" d="M 120 -13.5 L 0 -13.5"');
    // 13.5 (the carriageway step) + 9 (half a 2-lane road's 18-unit lane region).
    expect(22.5).toBe(13.5 + (2 * LANE_PX) / 2);
  });

  /**
   * Alignment reaches the junction glyph for free, because `junctionArms` reads
   * the *drawn* polyline: the arm's `origin` moves with the road, and Phase 1's
   * reach floor grows the pad to meet it.
   */
  it("carries a junction's arms along with the road", () => {
    const doc = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: 2 },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionGlyph", id: "N2", glyph: "signalized_cross" },
      { type: "setLinkAlign", id: "L1", align: "offside" },
    ).doc;
    const svg = renderToStaticMarkup(<Diagram doc={doc} />);

    // The one carriageway is drawn 9 off the centreline…
    expect(svg).toContain('class="road-casing" d="M 0 9 L 120 9"');
    // …so its stop bar is too, and the pad reaches its outer edge (9 + 21/2).
    const bar = svg.match(
      /class="jn-stopbar" x1="\S+" y1="(\S+)" x2="\S+" y2="(\S+)"/,
    )!;
    expect((Number(bar[1]) + Number(bar[2])) / 2).toBeCloseTo(9);
    expect(Number(svg.match(/class="jn-pad" r="(\S+?)"/)![1])).toBeCloseTo(19.5);
  });
});

describe("tapers", () => {
  /**
   * §1's lane drop, drawn due east: a 4-lane motorway at N2 becoming a 3-lane
   * one, both links held on their **offside** edge so the outer edge runs
   * straight through and the lane goes from the nearside. `extra` hangs further
   * actions off the same document.
   */
  function laneDrop(...extra: Action[]): Document {
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
      { type: "setLinkStyle", id: "L1", style: "motorway" },
      { type: "setLinkStyle", id: "L2", style: "motorway" },
      { type: "setLinkAlign", id: "L1", align: "offside" },
      { type: "setLinkAlign", id: "L2", align: "offside" },
      ...extra,
    ).doc;
  }

  /** The two endpoints of the taper's own edge line. */
  function taperEdgePoints(svg: string): [number, number][] {
    const m = svg.match(
      /class="road-edge road-taper-edge" d="M (\S+) (\S+) L (\S+) (\S+)"/,
    )!;
    return [
      [Number(m[1]), Number(m[2])],
      [Number(m[3]), Number(m[4])],
    ];
  }

  /**
   * The wedge, pinned exactly. The outer corner is the 4-lane road's **casing**
   * rim at 18 + 19.5, the inner one the 3-lane road's at 13.5 + 15, and the tip
   * a whole `TAPER_LENGTH` past the node — the dropped lane closing forward,
   * which is how a real lane drop reads.
   *
   * One wedge, not two: aligning both links offside makes their offside edges
   * agree, so that side has nothing to close.
   */
  it("closes a lane drop with one wedge on the nearside", () => {
    const svg = renderToStaticMarkup(<Diagram doc={laneDrop()} />);

    expect(svg).toContain(
      '<polygon class="road-taper" points="120,37.5 120,28.5 144,28.5"></polygon>',
    );
    expect(svg.match(/road-taper"/g)).toHaveLength(1);
    // Painted in the class of the link it closes, by the same class token the
    // road group carries — so `.road-local .road-taper` needs no rule of its own.
    expect(svg).toContain('<g class="taper road-motorway">');
  });

  /**
   * The wedge's own edge line: `RoadShape`'s 1.5-unit inset, applied to the
   * hypotenuse. Asserted as a distance from the two pinned corners, which is
   * the claim itself — a sign error would put the line on the paper outside the
   * asphalt and still satisfy any assertion about its direction.
   */
  it("paints an edge line 1.5 inside the wedge's hypotenuse", () => {
    const [start, finish] = taperEdgePoints(
      renderToStaticMarkup(<Diagram doc={laneDrop()} />),
    );

    expect(Math.hypot(start[0] - 120, start[1] - 37.5)).toBeCloseTo(1.5);
    expect(Math.hypot(finish[0] - 144, finish[1] - 28.5)).toBeCloseTo(1.5);
    // Inside the asphalt, which on this joint is below the hypotenuse and left
    // of the joint face: both ends move toward the wedge's third corner.
    expect(start[1]).toBeLessThan(37.5);
    expect(finish[1]).toBeLessThan(28.5);
  });

  /**
   * The round cap has to go with the wedge: `.road-casing` is `stroke-linecap:
   * round`, so the 4-lane link would paint a half-disc of asphalt 19.5 units
   * past N2 — outside the taper line just painted, and unremovable by any added
   * polygon. **Both** links take the modifier, since either can overhang.
   */
  it("butt-caps both links of a tapered joint, and only those", () => {
    const svg = renderToStaticMarkup(<Diagram doc={laneDrop()} />);

    expect(svg.match(/road-casing road-casing--butt/g)).toHaveLength(2);

    const plain = renderToStaticMarkup(<Diagram doc={straightPair(4, 4)} />);
    expect(plain).not.toContain("road-casing--butt");
  });

  /** Two links of `a` then `b` lanes, in a straight line, centred and unaligned. */
  function straightPair(a: number, b: number): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      { type: "setLinkLanes", id: "L1", count: a },
      { type: "setLinkLanes", id: "L2", count: b },
    ).doc;
  }

  /**
   * A document with no width step draws exactly what it drew before tapers
   * existed — no polygon, no modifier class, and the casing markup unchanged
   * down to the attribute.
   */
  it("leaves a joint of equal width exactly as it was", () => {
    const svg = renderToStaticMarkup(<Diagram doc={straightPair(4, 4)} />);

    expect(svg).not.toContain("taper");
    expect(svg).toContain(
      '<path class="road-casing" d="M 0 0 L 120 0" stroke-width="39"></path>',
    );
  });

  /** A centred lane change closes half the difference on each side. */
  it("wedges both sides of an unaligned lane change", () => {
    const svg = renderToStaticMarkup(<Diagram doc={straightPair(4, 3)} />);

    expect(svg).toContain(
      '<polygon class="road-taper" points="120,19.5 120,15 144,15"></polygon>',
    );
    expect(svg).toContain(
      '<polygon class="road-taper" points="120,-19.5 120,-15 144,-15"></polygon>',
    );
  });

  /**
   * Three links on a node is a junction or a gore, not a through joint — the
   * road spec's habit of leaving the ambiguous case alone. Stated as its own
   * case because the alternative is to guess which two of the three taper.
   */
  it("draws no wedge where three links meet", () => {
    const svg = renderToStaticMarkup(
      <Diagram
        doc={laneDrop(
          { type: "addNode", pos: { x: 200, y: 120 } },
          { type: "startLink", from: "N2" },
          { type: "completeLink", to: "N4" },
        )}
      />,
    );

    expect(svg).not.toContain("road-taper");
    expect(svg).not.toContain("road-casing--butt");
  });

  /**
   * The anti-parallel trap. A divided pair puts exactly one link in and one out
   * at *either* of its nodes, so unequal lane counts would otherwise stretch a
   * wedge between two carriageways that face opposite ways — a lane drop drawn
   * across the median. The reversed-twin exclusion is what stops it; the bend
   * guard does not, since a twin's two ends can leave a node any way its bends
   * take them.
   */
  it("never wedges between the two carriageways of a divided road", () => {
    const doc = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N1" },
      { type: "setLinkLanes", id: "L1", count: 4 },
      { type: "setLinkLanes", id: "L2", count: 2 },
    ).doc;
    const svg = renderToStaticMarkup(<Diagram doc={doc} />);

    expect(svg).not.toContain("road-taper");
    expect(svg).not.toContain("road-casing--butt");
  });

  /**
   * A corner is a corner. `segmentNormals` rotates with the link, so at
   * `N1(0,0) → N2(120,0) → N3(120,120)` two **identical** 4-lane links put their
   * nearside casing edges at `(120, 19.5)` and `(100.5, 0)` — a rule comparing
   * world points would read that as a width step and wedge a plain corner, which
   * no collinear fixture catches. Comparing signed offsets makes the equal-width
   * corner safe; the unequal one is what `TAPER_MAX_BEND` itself excludes.
   */
  it("draws no wedge at a right-angled corner, equal width or not", () => {
    const corner = (a: number, b: number): string => {
      const doc = run(
        initialState(),
        { type: "addNode", pos: { x: 0, y: 0 } },
        { type: "addNode", pos: { x: 120, y: 0 } },
        { type: "addNode", pos: { x: 120, y: 120 } },
        { type: "startLink", from: "N1" },
        { type: "completeLink", to: "N2" },
        { type: "startLink", from: "N2" },
        { type: "completeLink", to: "N3" },
        { type: "setLinkLanes", id: "L1", count: a },
        { type: "setLinkLanes", id: "L2", count: b },
      ).doc;
      return renderToStaticMarkup(<Diagram doc={doc} />);
    };

    for (const svg of [corner(4, 4), corner(4, 3)]) {
      expect(svg).not.toContain("road-taper");
      expect(svg).not.toContain("road-casing--butt");
    }
  });
});

describe("junction interiors", () => {
  /**
   * Three nodes in a row, the middle one a signalized junction: two undivided
   * 2-lane approaches, both on the centreline. Lanes pinned so the numbers below
   * don't move with `NEW_LINK_LANES`.
   */
  function crossroad(scale?: number): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      { type: "setLinkLanes", id: "L1", count: 2 },
      { type: "setLinkLanes", id: "L2", count: 2 },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionGlyph", id: "N2", glyph: "signalized_cross" },
      ...(scale === undefined
        ? []
        : [{ type: "setJunctionScale", id: "N2", scale } as Action]),
    ).doc;
  }

  /** The `jn-pad` radius. */
  function padRadius(svg: string): number {
    return Number(svg.match(/class="jn-pad" r="(\S+?)"/)![1]);
  }

  /**
   * The no-visual-change proof for Phase 1. An undivided arm's `origin` *is* the
   * node centre, so `rayCircleExit` returns exactly the pad radius and the new
   * expression collapses to the old `dir * (rp + 4)`. These are the numbers the
   * centre-derived code emitted — pinned literally, so a drift of any size fails.
   *
   * Written at the **default** Size deliberately: the reach floor is unscaled, so
   * a reduced Size *does* move an undivided pad (asserted below, by design).
   */
  it("draws an undivided signalized junction exactly as it always has", () => {
    const svg = renderToStaticMarkup(<Diagram doc={crossroad()} />);

    // (2 * 9 + 3) * 0.62 + 3, with no floor binding: reach is only 10.5.
    expect(svg).toContain('class="jn-pad" r="16.02"');
    // Stop bars 4 units beyond the pad, half a road plus 1 wide either side.
    expect(svg).toContain('x1="-20.02" y1="11.5" x2="-20.02" y2="-11.5"');
    expect(svg).toContain('x1="20.02" y1="-11.5" x2="20.02" y2="11.5"');
  });

  /**
   * A divided road ending at a signalized junction: the two carriageways step
   * 13.5 either side of the centreline, and before `Arm.origin` the stop bars
   * stayed behind on it — both bars drawn at y = 0, across the median, touching
   * neither carriageway (road spec OQ-6).
   *
   * Asserted against the drawn casing rather than a constant, so the two can
   * never drift apart, and `not 0` explicitly: that is the value the old code
   * emitted, and no count-of-bars assertion catches it.
   */
  function dividedApproach(scale?: number): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N1" },
      { type: "setLinkLanes", id: "L1", count: 2 },
      { type: "setLinkLanes", id: "L2", count: 2 },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionGlyph", id: "N2", glyph: "signalized_cross" },
      ...(scale === undefined
        ? []
        : [{ type: "setJunctionScale", id: "N2", scale } as Action]),
    ).doc;
  }

  it("puts a stop bar on each carriageway of a divided approach", () => {
    const svg = renderToStaticMarkup(<Diagram doc={dividedApproach()} />);

    // Where the two carriageways are actually drawn, read off their casings.
    const casings = [...svg.matchAll(/class="road-casing" d="M \S+ (\S+) L/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    expect(casings).toEqual([-13.5, 13.5]);

    // The bars are drawn in the junction's group, which is translated to the
    // node — and the node sits on the centreline, so a bar's y is directly
    // comparable to its carriageway's.
    const bars = [
      ...svg.matchAll(/class="jn-stopbar" x1="\S+" y1="(\S+)" x2="\S+" y2="(\S+)"/g),
    ]
      .map((m) => (Number(m[1]) + Number(m[2])) / 2)
      .sort((a, b) => a - b);

    expect(bars).toEqual(casings);
    expect(bars).not.toContain(0);
  });

  /**
   * …and the pad has to grow to meet them. The base radius for a 2-lane arm is
   * 16.02, which stops 8 units short of a carriageway whose outer edge is at
   * 13.5 + 21/2 = 24 — a glyph floating clear of the roads it joins.
   */
  it("reaches a displaced carriageway's outer edge with the pad", () => {
    const svg = renderToStaticMarkup(<Diagram doc={dividedApproach()} />);

    expect(padRadius(svg)).toBeCloseTo(24);
  });

  /**
   * The reach is a floor in **world** units while `scale` multiplies only the
   * base term, so the Size control clamps rather than shrinking a pad past the
   * road it serves. That is intended (ramps spec §2.2), and pinned here so it is
   * not later read as a bug: at half size an undivided 2-lane junction would
   * compute (0.62 * 21 + 3) * 0.5 = 8.01 and instead holds at half a road, 10.5.
   */
  it("clamps the Size control at the arms' own reach", () => {
    const full = renderToStaticMarkup(<Diagram doc={crossroad()} />);
    const half = renderToStaticMarkup(<Diagram doc={crossroad(0.5)} />);

    // Size still resizes, just not below the approach.
    expect(padRadius(half)).toBeLessThan(padRadius(full));
    expect(padRadius(half)).toBeCloseTo(10.5);
    expect(padRadius(half)).toBeGreaterThan((16.02 * 0.5));
  });

  /**
   * The roundabout ring takes the same floor — fixing the pad and not the ring
   * would be an omission with no reason behind it. Half size is where it bites:
   * `1.35 w / 2 < w / 2 + median / 2 + w / 2` for every road.
   */
  it("floors the roundabout ring at the arms' reach too", () => {
    const ring = (doc: Document) =>
      Math.max(
        ...[
          ...renderToStaticMarkup(<Diagram doc={doc} />).matchAll(
            /class="jn-edge" r="(\S+?)"/g,
          ),
        ].map((m) => Number(m[1])),
      );
    const round = (scale?: number): Document =>
      run(
        { ...initialState(), doc: dividedApproach(scale) },
        { type: "setJunctionGlyph", id: "N2", glyph: "roundabout" },
      ).doc;

    // 2 lanes: max(20, 28.35) unfloored, against a 24-unit reach.
    expect(ring(round())).toBeCloseTo(28.35);
    expect(ring(round(0.5))).toBeCloseTo(24);
  });
});

describe("gores", () => {
  /**
   * §1's exit, drawn due east: a 4-lane motorway becoming 3 at N2 with a 1-lane
   * ramp leaving to the south-east, both mainline links held on their **offside**
   * edge so the outer edge runs straight through and the lane goes from the
   * nearside. N2 carries the `gore` glyph. `extra` hangs further actions off it.
   */
  function exit(...extra: Action[]): Document {
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
      { type: "setLinkStyle", id: "L1", style: "motorway" },
      { type: "setLinkStyle", id: "L2", style: "motorway" },
      { type: "setLinkStyle", id: "L3", style: "ramp" },
      { type: "setLinkAlign", id: "L1", align: "offside" },
      { type: "setLinkAlign", id: "L2", align: "offside" },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionGlyph", id: "N2", glyph: "gore" },
      ...extra,
    ).doc;
  }

  /** The gore triangle's three corners: nose first, then one along each arm. */
  function corners(svg: string): [number, number][] {
    const m = svg.match(/class="jn-gore" points="(\S+) (\S+) (\S+)"/)!;
    return m.slice(1, 4).map((p) => p.split(",").map(Number) as [number, number]);
  }

  /** A gore is the paint *between* two arms, so there is nothing to pad. */
  it("draws no junction pad at all", () => {
    const svg = renderToStaticMarkup(<Diagram doc={exit()} />);

    expect(svg).not.toContain("jn-pad");
    expect(svg).toContain('<g class="gore">');
  });

  /**
   * The nose is where the two roads' **painted** edges meet, not their casing
   * rims — so it lands exactly on the downstream mainline's own edge line, which
   * this asserts against the drawn line rather than against a constant. A gore
   * measured at `width / 2` would sit 1.5 units off it, which reads as an
   * antialiasing artefact and never gets diagnosed.
   *
   * The glyph's group is translated to N2 at `(120, 0)`, and N2 is on the
   * mainline's own y, so the nose's `y` is directly comparable to the road's.
   */
  it("puts the nose on the mainline's own edge line", () => {
    const svg = renderToStaticMarkup(<Diagram doc={exit()} />);
    const [nose] = corners(svg);

    // A 3-lane offside-aligned motorway: polyline at 13.5, nearside edge at 27.
    expect(svg).toContain('class="road-edge" d="M 120 27 L 240 27"');
    expect(nose[1]).toBeCloseTo(27);
    // Downstream of the node, where the ramp has actually pulled clear.
    expect(nose[0]).toBeGreaterThan(0);
  });

  /**
   * The pair is the two *diverging* arms, and nothing about it consults the
   * direction of travel — `junctionArms` points every arm away from the node, so
   * it could not. Picking the two mainline arms instead would put the legs
   * anti-parallel, which is what these two assertions distinguish.
   */
  it("runs its legs down the ramp and the mainline, not the two mainline arms", () => {
    const svg = renderToStaticMarkup(<Diagram doc={exit()} />);
    const [nose, along, down] = corners(svg);

    // Due east along the mainline…
    expect(along[1]).toBeCloseTo(nose[1]);
    expect(along[0]).toBeGreaterThan(nose[0]);
    // …and south-east down the ramp, which is where the second leg has to go.
    expect(down[0]).toBeGreaterThan(nose[0]);
    expect(down[1]).toBeGreaterThan(nose[1]);
    for (const c of [along, down]) {
      expect(Math.hypot(c[0] - nose[0], c[1] - nose[1])).toBeCloseTo(GORE_LENGTH);
    }
  });

  /**
   * §2.5's trap, and the only failure mode here that no other assertion catches:
   * the `<defs>` used to be gated on a hard shoulder alone, so a document with a
   * gore and no shoulder would reference a `<pattern>` that was never emitted —
   * and render as an *unpainted* triangle, with the markup otherwise identical.
   */
  it("emits the hatch pattern for a gore in a document with no shoulder lane", () => {
    const svg = renderToStaticMarkup(<Diagram doc={exit()} />);

    expect(svg).not.toContain("lane-band");
    expect(svg).toContain('<pattern id="road-hatch"');
    expect(svg).toContain('class="jn-gore-hatch"');
    expect(svg).toContain('fill="url(#road-hatch)"');
  });

  /** Two layers, because the hatch pattern is transparent and the gore's base is
   *  out past both roads, over bare paper. */
  it("paints asphalt under the hatch, on the same three corners", () => {
    const svg = renderToStaticMarkup(<Diagram doc={exit()} />);
    const surface = svg.match(/class="jn-gore" points="([^"]+)"/)![1];

    expect(svg).toContain(`class="jn-gore-hatch" points="${surface}"`);
  });

  /**
   * §2.5's stated bounds: two arms is enough (the closest pair is the only
   * pair), one is not. Neither case draws a pad either — a gore glyph is a gore
   * or it is nothing.
   */
  it("draws from two arms and nothing at all from one", () => {
    const two = run(
      { ...initialState(), doc: exit() },
      { type: "select", selection: { kind: "link", id: "L1" } },
      { type: "deleteSelection" },
    ).doc;
    expect(renderToStaticMarkup(<Diagram doc={two} />)).toContain('class="jn-gore"');

    const one = run(
      { ...initialState(), doc: two },
      { type: "select", selection: { kind: "link", id: "L3" } },
      { type: "deleteSelection" },
    ).doc;
    const svg = renderToStaticMarkup(<Diagram doc={one} />);
    expect(svg).not.toContain("jn-gore");
    expect(svg).not.toContain("jn-pad");
  });

  /**
   * A pad-less glyph would leave the Inspector's Size control inert, so Size
   * moves the one thing a gore has: its length. It cannot misalign anything —
   * the legs stay on the roads' edge lines and only the base slides — so the
   * nose must not move with it.
   */
  it("lets Size lengthen the gore without moving its nose", () => {
    const full = corners(renderToStaticMarkup(<Diagram doc={exit()} />));
    const half = corners(
      renderToStaticMarkup(
        <Diagram doc={exit({ type: "setJunctionScale", id: "N2", scale: 0.5 })} />,
      ),
    );

    expect(half[0]).toEqual(full[0]);
    expect(Math.hypot(half[1][0] - half[0][0], half[1][1] - half[0][1])).toBeCloseTo(
      GORE_LENGTH / 2,
    );
  });
});

describe("road markings", () => {
  /**
   * A 3-lane arterial due east from the origin, with a stop line on `lane`.
   *
   * **14 metres is not arbitrary.** `Marking.position` is metres and the
   * renderer multiplies by `UNITS_PER_METRE` (9/3.5), and 14 m is exactly 36
   * world units — no rounding tail — so the `x` in every pin below is the
   * conversion rate itself, pinned rather than restated (markings spec §2.2).
   */
  const ALONG = 36;

  function marked(lane: number | "all"): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: 3 },
      {
        type: "addMarking",
        link: "L1",
        position: 14,
        lane: lane === "all" ? undefined : lane,
      },
    ).doc;
  }

  /** `doc` with its markings replaced wholesale — for the cases no gesture can
   *  produce, which is what makes them the hand-edited-document cases. */
  function withMarkings(doc: Document, markings: Marking[]): Document {
    return { ...doc, markings };
  }

  /**
   * The band assertions are the ones that matter: `laneBands` puts lane 0 at the
   * most **positive** offset, so an inverted normal draws this bar at −13.5…−4.5
   * — the offside lane — and a magnitude assertion would pass either way.
   */
  it("draws a bar across the lane it was placed in, at that band's offset and width", () => {
    const svg = renderToStaticMarkup(<Diagram doc={marked(0)} />);

    // Lane 0 is the nearside: centre +9, width 9.
    expect(svg).toContain(
      `<g class="marking marking-stop-line"><path class="marking-bar" d="M ${ALONG} 4.5 L ${ALONG} 13.5"></path></g>`,
    );
  });

  it("draws the offside lane's bar on the other side of the road", () => {
    const svg = renderToStaticMarkup(<Diagram doc={marked(2)} />);

    expect(svg).toContain(`class="marking-bar" d="M ${ALONG} -13.5 L ${ALONG} -4.5"`);
  });

  /**
   * The common stop line, and the one no Phase-1 gesture can place — the Span
   * control that reaches it deliberately is Phase 2, so it is built in the
   * fixture (markings spec §2.4).
   */
  it("spans the whole lane region for a marking with no lane", () => {
    const svg = renderToStaticMarkup(<Diagram doc={marked("all")} />);

    // The lane region, casing lip excluded: 3 lanes of 9, centred on the road.
    expect(svg).toContain(`class="marking-bar" d="M ${ALONG} -13.5 L ${ALONG} 13.5"`);
  });

  it("clamps a marking past the end of its road to the end of it", () => {
    // 120 units of road is 46.6 m; 400 m is far past it.
    const far = withMarkings(marked(0), [
      { id: "M1", link: "L1", position: 400, lane: 0, kind: { type: "stop_line" } },
    ]);

    expect(renderToStaticMarkup(<Diagram doc={far} />)).toContain(
      'class="marking-bar" d="M 120 4.5 L 120 13.5"',
    );
  });

  /**
   * §2.5: the cascades in `state.ts` cover every edit the app can make, but
   * `normalizeDocument` validates nothing, so an imported or hand-edited file
   * can still carry either of these. Indexing `laneBands` out of range yields
   * `undefined` and then `NaN` coordinates, which SVG renders as an
   * invisible-but-corrupt path — so the renderer emits nothing at all.
   */
  it("skips a marking whose link is gone, and one whose lane is out of range", () => {
    const base = marked(0);
    for (const markings of [
      [{ id: "M1", link: "L9", position: 14, lane: 0, kind: { type: "stop_line" } }],
      [{ id: "M1", link: "L1", position: 14, lane: 7, kind: { type: "stop_line" } }],
      [{ id: "M1", link: "L1", position: Number.NaN, lane: 0, kind: { type: "stop_line" } }],
    ] as Marking[][]) {
      const svg = renderToStaticMarkup(
        <Diagram doc={withMarkings(base, markings)} />,
      );

      expect(svg).not.toContain("marking");
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      // The road under it is untouched — a skipped marking is not a broken road.
      expect(svg).toContain('class="road-casing" d="M 0 0 L 120 0"');
    }
  });

  it("draws nothing for a document that has no markings", () => {
    expect(renderToStaticMarkup(<Diagram doc={initialState().doc} />)).toBe(
      '<g class="diagram"></g>',
    );
    expect(renderToStaticMarkup(<Diagram doc={sample()} />)).not.toContain("marking");
  });

  /**
   * **The glyph's stop bars are not markings.** `.jn-stopbar` is drawn per arm by
   * `signalized_cross` and says "this junction has signals"; a `stop_line`
   * marking is paint a human placed. A document can carry both, and that is not a
   * duplicate — it is a signalised junction whose approach also has a painted bar
   * (§2.7). Any attempt to suppress one from the other couples the glyph to the
   * decoration list.
   */
  it("leaves a signalised junction's own stop bars exactly as they were", () => {
    const signals = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: 3 },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionGlyph", id: "N2", glyph: "signalized_cross" },
    ).doc;

    const bars = (doc: Document) =>
      [...renderToStaticMarkup(<Diagram doc={doc} />).matchAll(/<line class="jn-stopbar"[^>]*>/g)]
        .map((m) => m[0]);

    const before = bars(signals);
    expect(before).toHaveLength(1);

    const after = bars(
      withMarkings(signals, [
        { id: "M1", link: "L1", position: 14, lane: 0, kind: { type: "stop_line" } },
      ]),
    );
    expect(after).toEqual(before);
  });

  it("carries a hit target and a halo on the canvas, and neither in an export", () => {
    const doc = marked(0);
    const selected: Interaction = {
      ...interaction(),
      selection: { kind: "marking", id: "M1" },
    };

    const live = renderToStaticMarkup(<Diagram doc={doc} interaction={selected} />);
    expect(live).toContain('class="marking-hit"');
    expect(live).toContain('class="marking-halo"');
    expect(live).toContain('class="marking marking-stop-line is-selected"');

    // With the *road* selected instead, the marking keeps its hit target and
    // gains neither halo nor token — the halo follows the selection, not the tool.
    const unselected = renderToStaticMarkup(
      <Diagram doc={doc} interaction={interaction()} />,
    );
    expect(unselected).toContain('class="marking-hit"');
    expect(unselected).not.toContain("marking-halo");
    expect(unselected).toContain('<g class="marking marking-stop-line">');

    const exported = renderToStaticMarkup(<Diagram doc={doc} />);
    expect(exported).not.toMatch(/marking-hit|marking-halo|is-selected/);
    // Paint on the road scales with the road, unlike the glyph's own bar.
    expect(exported).not.toMatch(/vector-effect/);
  });

  /**
   * The kinds Phase 2 draws. The exact points are pinned in `geometry.test.ts`,
   * where they read off a due-east frame instead of out of a `d` string; what
   * matters here is that the right builder reaches the right kind, under a class
   * token taken from the model.
   */
  describe("the kinds that are not a bar", () => {
    /** `marked`'s document with its one marking repainted as `kind`. */
    function repainted(kind: Marking["kind"], lane: number | "all" = 0): Document {
      const doc = marked(lane);
      return withMarkings(doc, [{ ...doc.markings[0], kind }]);
    }

    /** Every number in the first `d` of `cls`, in order. */
    function path(svg: string, cls: string): number[] {
      const d = svg.match(new RegExp(`class="${cls}" d="([^"]*)"`))?.[1] ?? "";
      return [...d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
    }

    it("draws a give-way line as a row of closed triangles in its lane", () => {
      const svg = renderToStaticMarkup(
        <Diagram doc={repainted({ type: "give_way_line" })} />,
      );

      expect(svg).toContain('<g class="marking marking-give-way-line">');
      expect(svg).toContain('class="marking-teeth"');
      // Lane 0 is 9 units wide: three cells of the 3-unit pitch, so three closed
      // subpaths — one `Z` each.
      const d = svg.match(/class="marking-teeth" d="([^"]*)"/)![1];
      expect(d.match(/Z/g)).toHaveLength(3);
      expect(d).not.toMatch(/NaN|undefined/);

      const n = path(svg, "marking-teeth");
      const xs = n.filter((_, i) => i % 2 === 0);
      const ys = n.filter((_, i) => i % 2 === 1);
      // Centred on the position, GIVE_WAY_DEPTH deep, and wholly inside lane 0.
      expect(Math.min(...xs)).toBeCloseTo(ALONG - GIVE_WAY_DEPTH / 2);
      expect(Math.max(...xs)).toBeCloseTo(ALONG + GIVE_WAY_DEPTH / 2);
      expect(Math.min(...ys)).toBeGreaterThan(4.5);
      expect(Math.max(...ys)).toBeLessThan(13.5);
    });

    it("draws a crossing as stripes running along the road", () => {
      const svg = renderToStaticMarkup(
        <Diagram doc={repainted({ type: "crosswalk" })} />,
      );

      expect(svg).toContain('<g class="marking marking-crosswalk">');
      const n = path(svg, "marking-zebra");
      const xs = n.filter((_, i) => i % 2 === 0);
      const ys = n.filter((_, i) => i % 2 === 1);

      expect(Math.min(...xs)).toBeCloseTo(ALONG - CROSSWALK_DEPTH / 2);
      expect(Math.max(...xs)).toBeCloseTo(ALONG + CROSSWALK_DEPTH / 2);
      expect(Math.min(...ys)).toBeGreaterThan(4.5);
      expect(Math.max(...ys)).toBeLessThan(13.5);
    });

    /**
     * A turn arrow is **one shaft with a branch per direction**, so a shared
     * through/right lane is one arrow rather than two. The bearings and the
     * containment are pinned in `geometry.test.ts`, off a due-east frame instead
     * of out of a `d` string; what matters here is that the arrow reaches the
     * band it was placed in, as two elements — stroked stems, filled heads.
     */
    it("draws a turn arrow in the lane it was placed in", () => {
      const svg = renderToStaticMarkup(
        <Diagram doc={repainted({ type: "turn_arrow", directions: ["through", "right"] }, 2)} />,
      );

      expect(svg).toContain('<g class="marking marking-turn-arrow">');
      expect(svg).toContain('class="marking-arrow-stem"');
      expect(svg).toContain('class="marking-arrow-head"');
      expect(svg).not.toMatch(/NaN|undefined/);
      // Lane 2 is the offside lane: −13.5…−4.5, so an inverted normal draws this
      // arrow in the kerb lane and a magnitude assertion would pass either way.
      for (const cls of ["marking-arrow-stem", "marking-arrow-head"]) {
        const ys = path(svg, cls).filter((_, i) => i % 2 === 1);
        expect(Math.min(...ys)).toBeGreaterThan(-13.5);
        expect(Math.max(...ys)).toBeLessThan(-4.5);
      }
      // One shaft plus one stem per branch, and one head each — never one whole
      // arrow per direction.
      const stems = svg.match(/class="marking-arrow-stem" d="([^"]*)"/)![1];
      const heads = svg.match(/class="marking-arrow-head" d="([^"]*)"/)![1];
      expect(stems.match(/M/g)).toHaveLength(3);
      expect(heads.match(/Z/g)).toHaveLength(2);
    });

    /**
     * **A `turn_arrow` has no carriageway-wide meaning**, so a lane-less one
     * draws in the nearside lane (§2.7) — and the anchor is what resolves it, so
     * the hit target and the halo move there with it rather than highlighting a
     * strip the arrow is not painted on.
     */
    it("draws a lane-less turn arrow in the nearside lane, halo and all", () => {
      const arrow = repainted({ type: "turn_arrow", directions: ["through"] }, "all");
      const svg = renderToStaticMarkup(
        <Diagram
          doc={arrow}
          interaction={{ ...interaction(), selection: { kind: "marking", id: "M1" } }}
        />,
      );

      for (const cls of ["marking-arrow-stem", "marking-arrow-head"]) {
        const ys = path(svg, cls).filter((_, i) => i % 2 === 1);
        expect(Math.min(...ys)).toBeGreaterThan(4.5);
        expect(Math.max(...ys)).toBeLessThan(13.5);
      }
      const bar = `d="M ${ALONG} 4.5 L ${ALONG} 13.5"`;
      expect(svg).toContain(`class="marking-hit" ${bar}`);
      expect(svg).toContain(`class="marking-halo" ${bar}`);
    });

    /**
     * **The placeholder, and every phase that draws a kind changes it
     * deliberately**: `lane_line` left this list in markings Phase 4 and `text`
     * with *content* leaves it here, once a font travels inside an exported file
     * (signs spec Phase 1). What remains is what the arm exists for — the one
     * kind out of scope entirely (markings §2.10), and the two whose fresh pick
     * starts empty and so has nothing to draw yet. A marking that paints nothing
     * is an object on the canvas that can only be found by accident; its class
     * token already says which kind it is.
     */
    it("falls back to the bar for a kind with no geometry of its own", () => {
      for (const kind of [
        { type: "hatching" },
        { type: "text", content: "" },
        { type: "turn_arrow", directions: [] },
      ] as Marking["kind"][]) {
        const svg = renderToStaticMarkup(<Diagram doc={repainted(kind)} />);

        expect(svg).toContain(`class="marking-bar" d="M ${ALONG} 4.5 L ${ALONG} 13.5"`);
        expect(svg).not.toMatch(/marking-teeth|marking-zebra|marking-arrow/);
        // And nothing that would drag a font into an exported file with it: an
        // empty text marking must cost no `<text>` and no `@font-face`.
        expect(svg).not.toMatch(/<text[\s>]|font-family/);
        // And the fall-through paints *across* the road, so it takes no divider
        // with it: a kind with no geometry is not a lane line.
        expect(svg).not.toContain("marking-line");
        expect(svg.match(/road-divider/g)).toHaveLength(2);
      }
    });

    /**
     * **The drawing's first glyph** (signs spec Phase 1). Two things are asserted
     * here that nothing else can assert: that the face and the size ride as
     * *presentation attributes* rather than as rules in `diagram.css`, which is
     * what keeps a `font-family` out of every text-free export; and that the run
     * is rotated onto the road rather than laid flat on the page.
     *
     * Lane 0 is the nearside: centre +9, so a baseline dropped half a cap height
     * (`TEXT_SIZE * CAP_HEIGHT / 2`, 2.1) lands at 11.1 — the run's visual middle
     * on the band's middle, since `dominant-baseline` is deliberately unused.
     */
    it("paints text along its lane, in the face the file embeds", () => {
      const svg = renderToStaticMarkup(
        <Diagram doc={repainted({ type: "text", content: "BUS" })} />,
      );

      expect(svg).toContain(
        '<g class="marking marking-text">' +
          `<text class="marking-text" x="${ALONG}" y="11.1"` +
          ' font-family="Overpass Mono" font-size="6" text-anchor="middle"' +
          ` transform="rotate(0 ${ALONG} 11.1)">BUS</text></g>`,
      );
      // The bar is the *empty* case, so a run replaces it rather than backing it.
      expect(svg).not.toContain("marking-bar");
    });

    /**
     * The content is the one thing in the drawing a human types, so it is the one
     * thing that can carry a `<` or an `&` — which would end the element or start
     * an entity in the XML an export writes. React escapes it; this pins that we
     * never build the element by hand.
     */
    it("escapes markup a human typed into the content", () => {
      const svg = renderToStaticMarkup(
        <Diagram doc={repainted({ type: "text", content: "A<B&C" })} />,
      );

      expect(svg).toContain(">A&lt;B&amp;C</text>");
      expect(svg.match(/<text[\s>]/g)).toHaveLength(1);
    });

    /**
     * The hit target and the halo are the anchor's transverse bar whatever the
     * marking paints, so selecting one feels the same for every kind — and a
     * `stop_line`'s markup is exactly what Phase 1 emitted.
     */
    it("keeps the same hit target and halo whatever the kind paints", () => {
      const bar = `d="M ${ALONG} 4.5 L ${ALONG} 13.5"`;
      const selected: Interaction = {
        ...interaction(),
        selection: { kind: "marking", id: "M1" },
      };

      for (const kind of [
        { type: "stop_line" },
        { type: "give_way_line" },
        { type: "crosswalk" },
        // Text included: it is the one kind whose paint is not a path at all, and
        // the hit target and halo are drawn outside `markingPaint` precisely so
        // that changes nothing about selecting it.
        { type: "text", content: "BUS" },
      ] as Marking["kind"][]) {
        const svg = renderToStaticMarkup(
          <Diagram doc={repainted(kind)} interaction={selected} />,
        );

        expect(svg).toContain(`class="marking-hit" ${bar}`);
        expect(svg).toContain(`class="marking-halo" ${bar}`);
      }
    });

    it("skips a lane line whose link is gone, leaving no line and no group", () => {
      const svg = renderToStaticMarkup(
        <Diagram
          doc={withMarkings(marked(0), [
            { id: "M1", link: "L9", lane: 0, position: 14, kind: { type: "lane_line", style: "solid" } },
          ])}
        />,
      );

      expect(svg).not.toContain("marking");
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      // And the road keeps every divider: a line that is not drawn replaces
      // nothing, or a missing link would rub a divider off a road it never
      // reached.
      expect(svg.match(/road-divider/g)).toHaveLength(2);
    });

    it("skips a give-way line and a crossing on the same terms as a bar", () => {
      for (const kind of [
        { type: "give_way_line" },
        { type: "crosswalk" },
      ] as Marking["kind"][]) {
        const svg = renderToStaticMarkup(
          <Diagram doc={withMarkings(marked(0), [
            { id: "M1", link: "L1", position: 14, lane: 7, kind },
          ])} />,
        );

        expect(svg).not.toContain("marking");
        expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      }
    });
  });

  /**
   * The one kind that runs **along** the road instead of across it: it spans the
   * whole link, `position` is ignored, and it **replaces** the divider it lands
   * on rather than being painted over one (§2.3, OQ-3).
   */
  describe("the lane line", () => {
    /**
     * An `lanes`-lane road due east with one lane line on it, placed and then
     * repainted through the real actions — so the Phase 2 controls' payloads are
     * on the path under test, not just the renderer.
     *
     * A 4-lane road by default, because that is the road whose dividers are
     * already pinned at y = 9, 0, −9 above: a line on boundary `1|2` takes the
     * middle one and the other two have to survive.
     */
    function lined(
      style: LineStyle,
      lane: number | "centre",
      lanes = 4,
    ): Document {
      return run(
        initialState(),
        { type: "addNode", pos: { x: 0, y: 0 } },
        { type: "addNode", pos: { x: 120, y: 0 } },
        { type: "startLink", from: "N1" },
        { type: "completeLink", to: "N2" },
        { type: "setLinkLanes", id: "L1", count: lanes },
        { type: "addMarking", link: "L1", position: 14, lane: 0 },
        { type: "setMarkingKind", id: "M1", kind: { type: "lane_line", style } },
        {
          type: "setMarkingLane",
          id: "M1",
          lane: lane === "centre" ? undefined : lane,
        },
      ).doc;
    }

    /**
     * **Drawing both is the failure**, and a count-of-lines assertion catches
     * only half of it — the line has to land on the offset the divider had, or
     * the road grows a fourth boundary while keeping all three of its own.
     */
    it("replaces the divider on its boundary and leaves the others dashed", () => {
      const svg = renderToStaticMarkup(<Diagram doc={lined("solid", 1)} />);

      expect(svg).toContain('<g class="marking marking-lane-line">');
      expect(svg).toContain(
        '<path class="marking-line marking-line-solid" d="M 0 0 L 120 0"></path>',
      );
      // Boundary 1|2 of a 4-lane road is y = 0, so that divider is gone and the
      // ones at ±9 are not.
      expect(svg.match(/road-divider/g)).toHaveLength(2);
      expect(svg).toContain('class="road-divider" d="M 0 9 L 120 9"');
      expect(svg).toContain('class="road-divider" d="M 0 -9 L 120 -9"');
      // The edge lines are not boundaries and are never a lane line's to take.
      expect(svg.match(/road-edge/g)).toHaveLength(2);
    });

    it("draws a double line as two strokes symmetric about that boundary", () => {
      const svg = renderToStaticMarkup(<Diagram doc={lined("double", 1)} />);

      expect(svg).toContain(
        `<path class="marking-line marking-line-double" d="M 0 ${LANE_LINE_GAP / 2} L 120 ${LANE_LINE_GAP / 2} M 0 ${-LANE_LINE_GAP / 2} L 120 ${-LANE_LINE_GAP / 2}"></path>`,
      );
      expect(svg.match(/road-divider/g)).toHaveLength(2);
    });

    it("draws a dashed line as one stroke, styled by its class token", () => {
      const svg = renderToStaticMarkup(<Diagram doc={lined("dashed", 1)} />);

      // No dasharray in the markup: the token carries it, as the road class
      // carries colour, so an export inherits it with no exporter change.
      expect(svg).toContain(
        '<path class="marking-line marking-line-dashed" d="M 0 0 L 120 0"></path>',
      );
      expect(svg).not.toContain("stroke-dasharray");
    });

    /**
     * **The undivided two-way road, which is what road spec OQ-4 has been
     * waiting for** — and it needed no model field: the human says the road is
     * two-way by painting the line, and `lane: undefined` puts it on the lane
     * region's centre. On a 2-lane road that centre *is* boundary 0|1, so the
     * one replacement rule covers a centreline as well as a named boundary; the
     * failure it rules out is a dashed line showing through the double one at
     * every dash gap.
     */
    it("paints a two-way centreline down the middle, taking the divider with it", () => {
      const svg = renderToStaticMarkup(<Diagram doc={lined("double", "centre", 2)} />);

      expect(svg).toContain(
        `class="marking-line marking-line-double" d="M 0 ${LANE_LINE_GAP / 2} L 120 ${LANE_LINE_GAP / 2} M 0 ${-LANE_LINE_GAP / 2} L 120 ${-LANE_LINE_GAP / 2}"`,
      );
      expect(svg).not.toContain("road-divider");
      // Two lanes of 9: the edge lines are untouched at the lane region's rim.
      expect(svg).toContain('class="road-edge" d="M 0 9 L 120 9"');
      expect(svg).toContain('class="road-edge" d="M 0 -9 L 120 -9"');
    });

    /**
     * **`lane = n-1` names no boundary**, because that lane's far side is the
     * carriageway edge line — so nothing is drawn at all (§2.3). Phase 2's
     * controls make it unreachable in the app; this is the hand-edited document
     * that gets there anyway, and a line silently re-homed to a different
     * boundary would be worse, because the drawing would still look deliberate.
     */
    it("draws nothing at all for a line on the offside-most lane", () => {
      const svg = renderToStaticMarkup(<Diagram doc={lined("solid", 2, 3)} />);

      expect(svg).not.toContain("marking");
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      // Both dashed dividers and both edge lines survive it untouched.
      expect(svg.match(/road-divider/g)).toHaveLength(2);
      expect(svg).toContain('class="road-divider" d="M 0 4.5 L 120 4.5"');
      expect(svg).toContain('class="road-divider" d="M 0 -4.5 L 120 -4.5"');
      expect(svg.match(/road-edge/g)).toHaveLength(2);
    });

    /**
     * The one kind with a hit target of its own: it runs along the road, so a
     * transverse bar would highlight a strip it is not painted on. The hit strip
     * is narrower than a bar's, too — a 12-unit one down the length of a link is
     * a dead zone for every click on the road under it.
     *
     * **The halo grows with the paint**, which is the rule `.road-halo`'s `w + 6`
     * already follows: a `double` line's two strokes sit `LANE_LINE_GAP` apart,
     * and a halo that ignored that would be exactly as wide as the paint — which
     * against a *yellow* double line reads as no halo at all.
     */
    it("takes its own hit target and halo, along the line rather than across it", () => {
      const selection = { kind: "marking", id: "M1" } as const;
      const single = renderToStaticMarkup(
        <Diagram doc={lined("solid", 1)} interaction={{ ...interaction(), selection }} />,
      );
      const double = renderToStaticMarkup(
        <Diagram doc={lined("double", 1)} interaction={{ ...interaction(), selection }} />,
      );

      expect(single).toContain('<path class="marking-hit" d="M 0 0 L 120 0" stroke-width="8">');
      expect(single).toContain('<path class="marking-halo" d="M 0 0 L 120 0" stroke-width="6">');
      expect(double).toContain(
        `<path class="marking-halo" d="M 0 0 L 120 0" stroke-width="${6 + LANE_LINE_GAP}">`,
      );
      expect(single).toContain('class="marking marking-lane-line is-selected"');
      // An export carries neither, as for every other kind.
      expect(renderToStaticMarkup(<Diagram doc={lined("double", 1)} />)).not.toMatch(
        /marking-hit|marking-halo|is-selected/,
      );
    });

    /** `position` is ignored: the line is the whole link either way (§2.3). */
    it("spans the whole link wherever the click that placed it landed", () => {
      const near = lined("solid", 1);
      const far = withMarkings(near, [{ ...near.markings[0], position: 400 }]);

      expect(renderToStaticMarkup(<Diagram doc={far} />)).toBe(
        renderToStaticMarkup(<Diagram doc={near} />),
      );
    });
  });

  /**
   * The layer order §2.7 fixes: above every road and wedge, below the junction
   * glyphs, because a pad is the intersection's own surface and paint under one
   * is genuinely covered.
   */
  it("draws above every road and below the junction glyphs", () => {
    const svg = renderToStaticMarkup(<Diagram doc={sample()} />);
    const marked3 = renderToStaticMarkup(
      <Diagram
        doc={withMarkings(sample(), [
          { id: "M1", link: "L1", position: 14, lane: 0, kind: { type: "stop_line" } },
        ])}
      />,
    );

    expect(svg).not.toContain("marking");
    expect(marked3.indexOf("road-casing")).toBeLessThan(marked3.indexOf("marking-bar"));
    expect(marked3.indexOf("marking-bar")).toBeLessThan(marked3.indexOf("jn-ring"));
  });
});

describe("signs", () => {
  /**
   * `sample()`'s road and roundabout, with a stop line painted on it and one sign
   * standing clear of both — so a single document carries every layer whose order
   * matters.
   */
  function signed(label = "TOLL"): Document {
    return run(
      { ...initialState(), doc: sample() },
      { type: "addMarking", link: "L1", position: 14, lane: 0 },
      { type: "addSign", pos: { x: 60, y: 90 } },
      { type: "setSignKind", id: "S1", kind: { type: "custom", label } },
    ).doc;
  }

  /**
   * **The whole element, pinned.** Three things nothing else asserts: the group is
   * translated to the sign's *own* layout position rather than deriving one from a
   * road (signs spec §2.5); the plate is as wide as the label it carries, floored
   * at `SIGN_SIZE`; and the face and the size ride as **presentation attributes**,
   * which is what keeps a typeface out of the stylesheet every text-free export
   * embeds (§2.3).
   *
   * The numbers come from `signPlate` rather than being restated, so this pins the
   * *markup* — what the renderer does with the geometry — and `geometry.test.ts`
   * pins the geometry itself.
   */
  it("stands a sign at its layout position, on a plate sized to its label", () => {
    const plate = signPlate("TOLL");
    const svg = renderToStaticMarkup(<Diagram doc={signed()} />);

    expect(svg).toContain(
      '<g class="sign sign-custom" transform="translate(60 90)">' +
        `<rect class="sign-plate" x="${plate.box.x}" y="${plate.box.y}"` +
        ` width="${plate.box.width}" height="${plate.box.height}" rx="${plate.radius}"></rect>` +
        `<text class="sign-label" x="0" y="${plate.baseline.y}"` +
        ' font-family="Overpass Mono" font-size="6" text-anchor="middle">TOLL</text></g>',
    );
    // The label is what sets the width, and the floor is what an empty one gets.
    expect(plate.box.width).toBeGreaterThan(SIGN_SIZE);
    expect(signPlate("").box.width).toBe(SIGN_SIZE);
  });

  /**
   * **A sign is beside the road, not on it, so it must never be occluded** (§2.7)
   * — the opposite of a marking, which sits *below* the junction glyphs because a
   * pad is the intersection's own surface. Asserted by source order, which is
   * paint order in SVG and the only thing a string can see.
   */
  it("draws above the roads, the paint and the junction glyphs alike", () => {
    const svg = renderToStaticMarkup(<Diagram doc={signed()} />);
    const plate = svg.indexOf("sign-plate");

    expect(plate).toBeGreaterThan(svg.indexOf("road-casing"));
    expect(plate).toBeGreaterThan(svg.indexOf("marking-bar"));
    expect(plate).toBeGreaterThan(svg.indexOf("jn-ring"));
    expect(plate).toBeGreaterThan(svg.indexOf("node-dot"));
  });

  /**
   * **The regression net for `isSelected`** (§2.6). Its `kind` parameter is now
   * typed off `Selection`, so the union cannot lag — but nothing makes a new shape
   * *call* it, and a sign that simply never lights up is no build error. Both
   * directions are asserted, because the interesting failure is the halo appearing
   * for a selection that is not this sign.
   */
  it("carries a hit target and a halo on the canvas, and neither in an export", () => {
    const doc = signed();
    const selected: Interaction = {
      ...interaction(),
      selection: { kind: "sign", id: "S1" },
    };

    const live = renderToStaticMarkup(<Diagram doc={doc} interaction={selected} />);
    expect(live).toContain('class="sign-hit"');
    expect(live).toContain('class="sign-halo"');
    expect(live).toContain('<g class="sign sign-custom is-selected"');

    // With the *road* selected instead, the sign keeps its hit target and gains
    // neither halo nor token — the halo follows the selection, not the tool.
    const unselected = renderToStaticMarkup(
      <Diagram doc={doc} interaction={interaction()} />,
    );
    expect(unselected).toContain('class="sign-hit"');
    expect(unselected).not.toContain("sign-halo");
    expect(unselected).toContain('<g class="sign sign-custom" ');

    const exported = renderToStaticMarkup(<Diagram doc={doc} />);
    expect(exported).not.toMatch(/sign-hit|sign-halo|is-selected/);
    expect(exported).not.toMatch(/vector-effect/);
  });

  /** The hand-edited case: a `Sign` with no entry in `layout.signs` has no
   *  position to draw at, so the layer skips it as the node layer skips a node. */
  it("emits nothing for a sign with no layout entry", () => {
    const doc = signed();
    const stranded: Document = {
      ...doc,
      layout: { ...doc.layout, signs: {} },
    };
    const svg = renderToStaticMarkup(<Diagram doc={stranded} />);

    expect(svg).not.toContain("sign-plate");
    expect(svg).not.toContain('<g class="sign');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  /**
   * An empty label draws the **plate and no `<text>`** — the empty text marking's
   * bar again: a sign you can see, select and then type into, rather than an
   * invisible object findable only by accident. It is also what makes the
   * conservative `needsText` conservative rather than wrong (§2.3).
   */
  it("draws a fresh sign as a bare plate, with no text at all", () => {
    const svg = renderToStaticMarkup(<Diagram doc={signed("")} />);

    expect(svg).toContain(
      '<g class="sign sign-custom" transform="translate(60 90)">' +
        `<rect class="sign-plate" x="${-SIGN_SIZE / 2}" y="-6"` +
        ` width="${SIGN_SIZE}" height="12" rx="2"></rect></g>`,
    );
    expect(svg).not.toMatch(/<text[\s>]/);
  });

  /** The second human-typed string to reach an XML file; React escapes it. */
  it("escapes a label that would otherwise end the element", () => {
    expect(renderToStaticMarkup(<Diagram doc={signed("A<B&C")} />)).toContain(
      ">A&lt;B&amp;C</text>",
    );
  });

  /** The `d` of the one `<path>` carrying `cls`. */
  function path(svg: string, cls: string): string {
    return svg.match(new RegExp(`<path class="${cls}" d="([^"]*)"`))?.[1] ?? "";
  }

  /** {@link signed}'s sign, carrying `kind` instead of a `custom` plate. */
  function kinded(kind: SignKind): Document {
    return run({ ...initialState(), doc: signed() }, {
      type: "setSignKind",
      id: "S1",
      kind,
    }).doc;
  }

  /**
   * **Every kind, and its whole element set** (signs spec Phase 3). Two things are
   * asserted per kind and the second is the one a presence check misses: the
   * elements are compared as a *list*, so an extra element is as loud as a missing
   * one — a stop octagon that also drew its plate would pass any `toContain`.
   *
   * The group's token comes from the model (`speed_limit` → `sign-speed-limit`),
   * so this is also what pins that no table stands between the two.
   */
  it("draws each kind as its own shape, under its own token", () => {
    const cases: [SignKind, string, string[]][] = [
      [
        { type: "speed_limit", kph: 50 },
        "sign-speed-limit",
        ["sign-roundel", "sign-roundel-ring", "sign-label"],
      ],
      [{ type: "stop" }, "sign-stop", ["sign-octagon", "sign-label"]],
      [{ type: "give_way" }, "sign-give-way", ["sign-triangle"]],
      [{ type: "warning", symbol: "bend_right" }, "sign-warning", ["sign-triangle"]],
      [
        { type: "priority" },
        "sign-priority",
        ["sign-diamond-border", "sign-diamond"],
      ],
      [{ type: "no_entry" }, "sign-no-entry", ["sign-disc", "sign-bar"]],
      [{ type: "custom", label: "TOLL" }, "sign-custom", ["sign-plate", "sign-label"]],
      // Phase 4's kind draws the plate it already has, and no text yet.
      [{ type: "direction", text: "M4 W" }, "sign-direction", ["sign-plate"]],
    ];

    for (const [kind, token, elements] of cases) {
      const svg = renderToStaticMarkup(<Diagram doc={kinded(kind)} />);

      expect(svg).toContain(`<g class="sign ${token}" transform="translate(60 90)">`);
      expect([...svg.matchAll(/class="(sign-[a-z-]+)"/g)].map((m) => m[1])).toEqual(
        elements,
      );
    }
  });

  /**
   * **The symbol names a pictogram and is deliberately not drawn** (§2.9, OQ-6):
   * a symbol library is a catalogue of artwork rather than a phase, so the
   * triangle carries "warning" on its own and the string lives in the Inspector.
   * The two triangles differ only in which way they point, which is geometry —
   * asserted here as the markup difference it becomes.
   */
  it("points the give-way triangle the other way, and draws no symbol", () => {
    const warning = renderToStaticMarkup(
      <Diagram doc={kinded({ type: "warning", symbol: "bend_right" })} />,
    );
    const giveWay = renderToStaticMarkup(
      <Diagram doc={kinded({ type: "give_way" })} />,
    );

    expect(warning).not.toContain("bend_right");
    expect(warning).not.toMatch(/<text[\s>]/);
    // Same class, same size, opposite shape — which is the whole message.
    expect(path(warning, "sign-triangle")).not.toBe(path(giveWay, "sign-triangle"));
  });

  /**
   * The roundel's number, as **its own element** rather than as an index into the
   * file: a document that also carries painted road text has two `<text>`s, and an
   * assertion on "the second one" would pass for the wrong reason.
   */
  it("sets the roundel's number in the roundel, centred like every other run", () => {
    const svg = renderToStaticMarkup(
      <Diagram doc={kinded({ type: "speed_limit", kph: 100 })} />,
    );

    expect(svg).toContain(
      `<text class="sign-label" x="0" y="${BASELINE_DROP}"` +
        ' font-family="Overpass Mono" font-size="6" text-anchor="middle">100</text>',
    );
  });

  /**
   * **The chrome follows the shape, not the plate** — the concrete failure being
   * ruled out is a halo `TEXT_SIZE * 2` tall sitting *inside* a 22-unit octagon.
   * The hit target is the same box grown by less, so one assertion covers both
   * gates.
   */
  it("grows the hit target and halo from the sign's own box", () => {
    const svg = renderToStaticMarkup(
      <Diagram
        doc={kinded({ type: "stop" })}
        interaction={{ ...interaction(), selection: { kind: "sign", id: "S1" } }}
      />,
    );

    for (const [cls, pad] of [
      ["sign-hit", 3],
      ["sign-halo", 4],
    ] as const) {
      expect(svg).toContain(
        `<rect class="${cls}" x="${-SIGN_SIZE / 2 - pad}" y="${-SIGN_SIZE / 2 - pad}"` +
          ` width="${SIGN_SIZE + 2 * pad}" height="${SIGN_SIZE + 2 * pad}"`,
      );
    }
    // A plate's box is the one it would have taken before, and it is shorter than
    // the sign it would have had to ring.
    expect(signPlate("").box.height).toBeLessThan(SIGN_SIZE);
  });

  /** The sign layer is an unwrapped `.map()`, so it adds nothing to a document
   *  that has no sign — the rule the marking layer already follows. */
  it("draws nothing for a document that has no signs", () => {
    expect(renderToStaticMarkup(<Diagram doc={initialState().doc} />)).toBe(
      '<g class="diagram"></g>',
    );
    expect(renderToStaticMarkup(<Diagram doc={sample()} />)).not.toContain("sign");
  });
});

describe("Diagram on the live canvas", () => {
  // Guards against gating the chrome the wrong way round: the assertions above
  // would also pass if `interaction` never rendered anything.
  it("renders hit targets, the selection halo, and non-scaling strokes", () => {
    const svg = renderToStaticMarkup(
      <Diagram doc={sample()} interaction={interaction()} />,
    );

    expect(svg).toContain("road-hit");
    expect(svg).toContain("road-halo");
    expect(svg).toContain("jn-hit");
    expect(svg).toContain("is-selected");
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
  });

  it("previews the in-progress link only while one is being drawn", () => {
    const drawing: Interaction = {
      ...interaction(),
      selection: null,
      linkFrom: "N1",
      cursor: { x: 60, y: 90 },
    };

    expect(
      renderToStaticMarkup(<Diagram doc={sample()} interaction={drawing} />),
    ).toContain("link-preview");
    expect(
      renderToStaticMarkup(
        <Diagram doc={sample()} interaction={interaction()} />,
      ),
    ).not.toContain("link-preview");
  });
});
