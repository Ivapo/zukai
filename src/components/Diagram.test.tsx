import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ROAD_MARGIN,
  SCHEMATIC_MEDIAN,
  classWidthFactor,
} from "../editor/geometry";
import { Action, EditorState, initialState, reducer } from "../editor/state";
import { Document, LinkStyle } from "../model/types";
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
