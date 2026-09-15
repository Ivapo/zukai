import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BASELINE_DROP,
  CROSSWALK_DEPTH,
  GIVE_WAY_DEPTH,
  GORE_LENGTH,
  LABEL_GAP,
  LANE_LINE_GAP,
  LANE_PX,
  ROAD_MARGIN,
  SCHEMATIC_MEDIAN,
  SIGN_SIZE,
  UNITS_PER_METRE,
  carriageways,
  drawnPolyline,
  junctionArms,
  lateralShifts,
  markingText,
  offsetPolyline,
  padRadius,
  polylineLength,
  polylinePath,
  polylineStretch,
  signPlate,
} from "../editor/geometry";
import { Action, EditorState, initialState, reducer } from "../editor/state";
import { nodePos } from "../model/document";
import {
  Document,
  LaneKind,
  LineStyle,
  Marking,
  SignKind,
  Vec2,
} from "../model/types";
import { Diagram, Interaction } from "./Diagram";

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

/**
 * The radius the glyph is sized from, read from `padRadius` rather than off the
 * drawn element.
 *
 * Every assertion below is about that **number** — the arms' reach floor, the
 * Size clamp, the road class — and none of them is about the markup. Taking it
 * out of an `r="…"` attribute tied them to the pad being a circle, which it is
 * only while it has no arms to follow (junction glyphs §4).
 */
function padR(doc: Document, id = "N2"): number {
  return padRadius(
    junctionArms(doc, id, lateralShifts(doc)),
    nodePos(doc, id)!,
    doc.layout.junctions[id]?.scale ?? 1,
  );
}

/** The live canvas's interaction, with the road selected. */
function interaction(): Interaction {
  return {
    selection: { kind: "link", id: "L1" },
    linkFrom: null,
    cursor: null,
    revealNodes: false,
    onNodePointerDown: () => {},
    onLinkPointerDown: () => {},
    onMarkingPointerDown: () => {},
    onSignPointerDown: () => {},
    onBendPointerDown: () => {},
  };
}

/** A road arrow's three corners, apex first — the order `arrowTriangle` emits. */
function arrowPoints(svg: string): Vec2[] {
  const points = svg.match(/class="road-arrow" points="([^"]*)"/)?.[1];
  if (points === undefined) throw new Error("the markup carries no road arrow");
  return points.split(" ").map((p) => {
    const [x, y] = p.split(",").map(Number);
    return { x, y };
  });
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
    expect(svg).toContain("jn-ring");
    // A node's dot is where a human clicks, not something the road does, so a
    // figure carries none of them (ramps §2.11.1).
    expect(svg).not.toContain("node-dot");
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

  /**
   * The direction arrow sits halfway along the road, pointing the way it runs,
   * and is as long as it ever was: `0.45` of the 39-unit width, so `17.55`. Drawn
   * on the canvas with `L1` selected, the only place an arrow is drawn at all.
   */
  it("centres the direction arrow on the road's midpoint, apex downstream", () => {
    const [apex, b1, b2] = arrowPoints(
      renderToStaticMarkup(<Diagram doc={straight(4)} interaction={interaction()} />),
    );

    expect(apex.x).toBeCloseTo(60 + 17.55 / 2);
    expect(apex.y).toBeCloseTo(0);
    for (const b of [b1, b2]) expect(b.x).toBeCloseTo(60 - 17.55 / 2);
    expect(b1.y).toBeCloseTo(-b2.y);
  });
});

/**
 * **The direction arrow is chrome, on the selected link alone** (road declutter
 * §2.1). No road is painted with an arrowhead down its middle, so a figure carries
 * none; the Lane region readout converts "of travel" to the screen by looking at
 * one, and that panel exists only for a selected link.
 */
describe("the direction arrow is chrome on the selected link", () => {
  /** `L1` runs `N1(0,0) → N2(120,0)` and `L2` runs back, both one lane. */
  function twoWay(): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N1" },
      { type: "setLinkLanes", id: "L1", count: 1 },
      { type: "setLinkLanes", id: "L2", count: 1 },
    ).doc;
  }

  const arrows = (svg: string) => svg.match(/class="road-arrow"/g) ?? [];

  /**
   * Exactly one, and it is `L1`'s: the apex is the most easterly corner, which
   * `L2`'s arrow — pointing west — could not have.
   */
  it("draws one arrow, on the selected link, pointing the way it runs", () => {
    const svg = renderToStaticMarkup(<Diagram doc={twoWay()} interaction={interaction()} />);

    expect(arrows(svg)).toHaveLength(1);
    const [apex, b1, b2] = arrowPoints(svg);
    expect(apex.x).toBeGreaterThan(Math.max(b1.x, b2.x));
  });

  it("draws none when nothing is selected", () => {
    const svg = renderToStaticMarkup(
      <Diagram doc={twoWay()} interaction={{ ...interaction(), selection: null }} />,
    );
    expect(arrows(svg)).toHaveLength(0);
  });

  /** A bend's panel states a canvas position, not a side of travel. */
  it("draws none when a bend on the link is selected rather than the link", () => {
    const svg = renderToStaticMarkup(
      <Diagram
        doc={twoWay()}
        interaction={{ ...interaction(), selection: { kind: "bend", link: "L1", index: 0 } }}
      />,
    );
    expect(arrows(svg)).toHaveLength(0);
  });

  it("draws none in an export", () => {
    expect(arrows(renderToStaticMarkup(<Diagram doc={twoWay()} />))).toHaveLength(0);
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

/**
 * A node's dot — **one, at the node**, wherever its roads are drawn (ramps spec
 * §2.14.1). There is no geometry left to test apart from the markup: the dot and
 * its halo carry no `cx`/`cy`, so what these cases pin is that a road drawn off
 * its node — a carriageway, or a road a lane change has walked over — no longer
 * draws a second circle beside the first.
 */
describe("node dots", () => {
  /** A one-way road due east, and the same pair with a twin coming back. */
  function road(...extra: Action[]): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: 2 },
      ...extra,
    ).doc;
  }

  const twoWay = (): Document =>
    road(
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N1" },
      { type: "setLinkLanes", id: "L2", count: 2 },
    );

  /** Two links in series, so the middle node is a waypoint with two arms. */
  const chain = (): Document =>
    road(
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      { type: "setLinkLanes", id: "L2", count: 2 },
      { type: "setNodeKind", id: "N2", kind: "waypoint" },
    );

  /**
   * **The identity, and it is exact rather than equivalent.** A centred undivided
   * document emits character-for-character what it emitted while the dots were
   * drawn per road end, which is what makes one dot at the node a change only
   * where a road sits off its node (§2.14.1). No `cx`/`cy` at all: React writes
   * `cx={0}` as `cx="0"`, so a circle spelled with a zero displacement fails this
   * for a reason that has nothing to do with the geometry.
   *
   * **The waypoint is the load-bearing half of this test.** An endpoint has one
   * arm, so it emits one circle under any rule; the waypoint has two arms at one
   * point, so it is the row that stops being byte-identical the moment a rule
   * draws per arm instead of per node.
   *
   * **Rendered on the canvas since Phase 7**, which moved the dot behind the
   * `interaction` gate (§2.11.1). The claim is unchanged and had to survive the
   * move: the only difference in the markup is the `vector-effect` every
   * hairline takes on the canvas.
   */
  it("emits a centred undivided node exactly as it did before the dots moved", () => {
    // Nothing selected: the helper selects `L1`, whose two ends would also carry
    // `is-shown` (§2.12.3), which is a different claim from this one.
    const svg = renderToStaticMarkup(
      <Diagram doc={chain()} interaction={{ ...interaction(), selection: null }} />,
    );

    expect(svg).toContain(
      '<g class="node node-endpoint" transform="translate(0 0)">' +
        '<circle class="node-dot" r="6" vector-effect="non-scaling-stroke"></circle></g>',
    );
    expect(svg).toContain(
      '<g class="node node-waypoint" transform="translate(120 0)">' +
        '<circle class="node-dot" r="4" vector-effect="non-scaling-stroke"></circle></g>',
    );
  });

  /**
   * **Once, at the node, in the median** (§2.14.1). This case drew a dot on each
   * carriageway through Phase 14; §2.10's reason for that was a dot in the median
   * reading as an object *in a figure*, and since Phases 7 and 12 no figure
   * carries a dot and the canvas shows one only while its node is edited.
   */
  it("marks a divided road's endpoint once, at the node", () => {
    // Nothing selected, for the same reason as the test above.
    const svg = renderToStaticMarkup(
      <Diagram doc={twoWay()} interaction={{ ...interaction(), selection: null }} />,
    );

    expect(svg).toContain(
      '<g class="node node-endpoint" transform="translate(0 0)">' +
        '<circle class="node-dot" r="6" vector-effect="non-scaling-stroke"></circle></g>',
    );
    // The road really is off the node: the eastbound carriageway below its line.
    expect(svg).toContain("M 0 13.5 L 120 13.5");
  });

  /**
   * **The report's Y** (§2.14): a lane change at `N2` walks `L2` half a lane off
   * its nodes, and at `N3` both branches turn by more than `TAPER_MAX_BEND`, so
   * nothing continues `L2` there. Drawn per road end, `N3` carried a second circle
   * at `cy="4.5"`, `L2`'s end, beside the branches' one at the node.
   */
  it("draws one dot where a walked road splits into a Y", () => {
    const doc = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "addNode", pos: { x: 360, y: -84 } },
      { type: "addNode", pos: { x: 360, y: 120 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      { type: "startLink", from: "N3" },
      { type: "completeLink", to: "N4" },
      { type: "startLink", from: "N3" },
      { type: "completeLink", to: "N5" },
      { type: "setLinkLanes", id: "L1", count: 1 },
      { type: "setLinkLanes", id: "L2", count: 2 },
      { type: "setLinkLanes", id: "L3", count: 1 },
      { type: "setLinkLanes", id: "L4", count: 1 },
      { type: "setNodeLaneChange", id: "N2", change: "nearside" },
    ).doc;
    const svg = renderToStaticMarkup(
      <Diagram doc={doc} interaction={{ ...interaction(), selection: null }} />,
    );

    expect(svg).toContain("M 120 4.5 L 240 4.5");
    expect(svg).toContain(
      '<g class="node node-waypoint" transform="translate(240 0)">' +
        '<circle class="node-dot" r="4" vector-effect="non-scaling-stroke"></circle></g>',
    );
  });
});

/**
 * **A node draws one dot and shows it only while the node is being edited**
 * (ramps §2.12.3, §2.14.1). Shown is a class token and nothing else: the dot
 * stays in the markup because it is the node's only hit target, and `styles.css`
 * paints the dot of a group without the token transparent.
 */
describe("a node's dot shows while it is being edited", () => {
  /** `L1` runs `N1(0,0) → N2(120,0)` and `L2` runs `N2 → N3(240,0)`. */
  function chain(): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
    ).doc;
  }

  /** The chain's nodes, by the `x` each group is translated to. */
  const AT = { N1: 0, N2: 120, N3: 240 } as const;

  /** The group of the node drawn at `(x, 0)`, opening tag through its `</g>`. */
  function group(svg: string, x: number): string {
    const start = svg.search(
      new RegExp(`<g class="node [^"]*" transform="translate\\(${x} 0\\)">`),
    );
    if (start < 0) throw new Error(`the markup carries no node at (${x}, 0)`);
    return svg.slice(start, svg.indexOf("</g>", start));
  }

  /** Which of the chain's nodes carry `is-shown`, in id order. */
  function shown(svg: string): string[] {
    return Object.entries(AT)
      .filter(([, x]) => /^<g class="[^"]*\bis-shown\b/.test(group(svg, x)))
      .map(([id]) => id);
  }

  const render = (over: Partial<Interaction>, doc = chain()) =>
    renderToStaticMarkup(<Diagram doc={doc} interaction={{ ...interaction(), ...over }} />);

  /** Hidden is not absent: every node still has the dot a press lands on. */
  it("draws every node's dot and shows none when nothing is being edited", () => {
    const svg = render({ selection: null });

    for (const x of Object.values(AT)) expect(group(svg, x)).toContain('class="node-dot"');
    expect(shown(svg)).toEqual([]);
  });

  it("shows the two ends of the selected link", () => {
    expect(shown(render({ selection: { kind: "link", id: "L1" } }))).toEqual(["N1", "N2"]);
  });

  it("shows the selected node alone, after its selection token", () => {
    const svg = render({ selection: { kind: "node", id: "N3" } });

    expect(shown(svg)).toEqual(["N3"]);
    expect(group(svg, AT.N3)).toMatch(/^<g class="node node-endpoint is-selected is-shown"/);
  });

  /** On the link arm alone, as the direction arrow is (road declutter §2.1). */
  it("shows none when a bend on a link is selected rather than the link", () => {
    expect(shown(render({ selection: { kind: "bend", link: "L1", index: 0 } }))).toEqual([]);
  });

  it("shows the node a link is being drawn from", () => {
    expect(shown(render({ selection: null, linkFrom: "N3" }))).toEqual(["N3"]);
  });

  /**
   * Also **the vacuity check for `export.test.ts`'s `is-shown` token**: the canvas
   * carries the very token an exported figure must not.
   */
  it("shows every node while the canvas reveals them", () => {
    expect(shown(render({ selection: null, revealNodes: true }))).toEqual(["N1", "N2", "N3"]);
  });

  /** Or a node just placed would be invisible (§2.10.3). */
  it("shows a node no link touches", () => {
    const svg = render(
      { selection: null },
      run(
        initialState(),
        { type: "addNode", pos: { x: 0, y: 0 } },
        { type: "addNode", pos: { x: 120, y: 0 } },
      ).doc,
    );

    expect(group(svg, 0)).toMatch(/^<g class="node node-endpoint is-shown"/);
    expect(group(svg, 120)).toMatch(/^<g class="node node-endpoint is-shown"/);
  });

  /**
   * **A junction draws a dot too** (§2.14.2), as its glyph's next sibling and by
   * the same predicate as every node. `sample()`'s roundabout `N2` is at
   * `(120, 40)`, entered by `L1`; `N3` is one more node drawn **after** it, so a
   * junction dot drawn in some later layer would have `N3`'s group between it and
   * its glyph.
   */
  describe("at a junction", () => {
    const doc = () =>
      run({ ...initialState(), doc: sample() }, { type: "addNode", pos: { x: 240, y: 0 } }).doc;

    const OPEN = '<g class="node node-junction';
    const GROUP = '<g class="node node-junction" transform="translate(120 40)">';

    /** The junction's dot group's opening tag, whatever its tokens. */
    function dotTag(svg: string): string {
      const start = svg.indexOf(OPEN);
      if (start < 0) throw new Error("the markup carries no junction dot");
      return svg.slice(start, svg.indexOf(">", start) + 1);
    }

    /** The glyph's group, from `<g class="junction"` through its first `</g>`. */
    function glyph(svg: string): { text: string; end: number } {
      const start = svg.indexOf('<g class="junction"');
      const close = svg.indexOf("</g>", start);
      return { text: svg.slice(start, close + 4), end: close + 4 };
    }

    it("draws the dot hidden when nothing is being edited", () => {
      const svg = render({ selection: null }, doc());

      expect(svg).toContain(
        GROUP + '<circle class="node-dot" r="4" vector-effect="non-scaling-stroke"></circle></g>',
      );
      expect(dotTag(svg)).not.toContain("is-shown");
    });

    it("shows it at an end of the selected link, and while nodes are revealed", () => {
      expect(dotTag(render({ selection: { kind: "link", id: "L1" } }, doc()))).toMatch(
        /^<g class="node node-junction is-shown"/,
      );
      expect(dotTag(render({ selection: null, revealNodes: true }, doc()))).toMatch(
        /^<g class="node node-junction is-shown"/,
      );
    });

    /** `jn-halo` already rings it, so the dot takes no `node-halo` (§2.14.2). */
    it("rings a selected junction once, with the glyph's halo", () => {
      const svg = render({ selection: { kind: "node", id: "N2" } }, doc());

      expect(dotTag(svg)).toMatch(/^<g class="node node-junction is-selected is-shown"/);
      expect(svg).not.toContain("node-halo");
      expect(svg).toContain("jn-halo");
    });

    /**
     * **What `styles.css`'s `.junction:hover + .node` stands on.** The roundabout
     * glyph nests no `<g>`, so its first `</g>` closes it, and the dot's group must
     * open on the very next character.
     */
    it("draws the dot's group immediately after the glyph's", () => {
      const svg = render({ selection: null }, doc());

      expect(svg.indexOf(GROUP)).toBe(glyph(svg).end);
    });

    it("leaves the glyph itself alone", () => {
      const a = glyph(render({ selection: null, revealNodes: true }, doc())).text;
      const b = glyph(render({ selection: null, revealNodes: false }, doc())).text;

      expect(a).toContain('<g class="junction" transform="translate(120 40)">');
      expect(a).toBe(b);
      expect(a).not.toContain("is-shown");
    });
  });
});

describe("lane change at a joint", () => {
  /**
   * The side reaches a junction glyph downstream for free, because the walk
   * carries it through the waypoint and `junctionArms` reads the *drawn*
   * polyline: the arm's `origin` moves with the road, and Phase 1's reach floor
   * grows the pad to meet it.
   *
   * `L1` is a 1-lane head at `0`; `offside` at `N2` holds the nearside edge, so
   * the 3-lane `L2` sits at `0 + 4.5 − 13.5 = −9` (ramps §2.13.3).
   */
  it("carries a junction's arms along with the road", () => {
    const doc = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      { type: "setLinkLanes", id: "L1", count: 1 },
      { type: "setLinkLanes", id: "L2", count: 3 },
      { type: "setNodeLaneChange", id: "N2", change: "offside" },
      { type: "setNodeKind", id: "N3", kind: "junction" },
      { type: "setJunctionGlyph", id: "N3", glyph: "signalized_cross" },
    ).doc;
    const svg = renderToStaticMarkup(<Diagram doc={doc} />);

    // The downstream road is drawn 9 above the line its nodes are on…
    expect(svg).toContain('class="road-casing" d="M 120 -9 L 240 -9"');
    // …so its stop bar is too, and the pad reaches its outer edge (9 + 30/2),
    // past the base size of 30 × 0.62 + 3 = 21.6, so the floor binds.
    const bar = svg.match(
      /class="jn-stopbar" x1="\S+" y1="(\S+)" x2="\S+" y2="(\S+)"/,
    )!;
    expect((Number(bar[1]) + Number(bar[2])) / 2).toBeCloseTo(-9);
    expect(padR(doc, "N3")).toBeCloseTo(24);
  });

  /**
   * A 1 → 2 waypoint stating `offside`: the nearside edges agree, so the only
   * wedge is on the offside — above an eastbound road — and, being an addition,
   * it opens along the narrow upstream road (OQ-1). Stated nowhere, the same
   * joint draws one on each side.
   */
  it("draws one wedge, on the side the node names", () => {
    const doc = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      { type: "setLinkLanes", id: "L1", count: 1 },
      { type: "setLinkLanes", id: "L2", count: 2 },
      { type: "setNodeLaneChange", id: "N2", change: "offside" },
    ).doc;
    const svg = renderToStaticMarkup(<Diagram doc={doc} />);

    expect(svg.match(/road-taper"/g)).toHaveLength(1);
    expect(svg).toContain(
      '<polygon class="road-taper" points="120,-15 120,-6 96,-6"></polygon>',
    );
  });
});

describe("tapers", () => {
  /**
   * §1's lane drop, drawn due east: a 4-lane motorway at N2 becoming a 3-lane
   * one, with N2 stating `nearside` so the outer (offside) edge runs straight
   * through and the lane goes from the nearside. `L1` is a head at `0`, and `L2`
   * sits at `0 − 18 + 13.5 = −4.5`. `extra` hangs further actions off the same
   * document.
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
      { type: "setNodeLaneChange", id: "N2", change: "nearside" },
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
   * rim at 0 + 19.5, the inner one the 3-lane road's at −4.5 + 15, and the tip
   * a whole `TAPER_LENGTH` past the node — the dropped lane closing forward,
   * which is how a real lane drop reads.
   *
   * One wedge, not two: stating `nearside` carries the offside edge through, so
   * that side has nothing to close.
   */
  it("closes a lane drop with one wedge on the nearside", () => {
    const svg = renderToStaticMarkup(<Diagram doc={laneDrop()} />);

    expect(svg).toContain(
      '<polygon class="road-taper" points="120,19.5 120,10.5 144,10.5"></polygon>',
    );
    expect(svg.match(/road-taper"/g)).toHaveLength(1);
    // A group with no class token: every wedge paints the one asphalt.
    expect(svg).toContain('<g class="taper">');
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

    expect(Math.hypot(start[0] - 120, start[1] - 19.5)).toBeCloseTo(1.5);
    expect(Math.hypot(finish[0] - 144, finish[1] - 10.5)).toBeCloseTo(1.5);
    // Inside the asphalt, which on this joint is below the hypotenuse and left
    // of the joint face: both ends move toward the wedge's third corner.
    expect(start[1]).toBeLessThan(19.5);
    expect(finish[1]).toBeLessThan(10.5);
  });

  /**
   * No round shape at a wedge: every casing ends flat, and a tapered joint is the
   * one through joint that gets no joint disc — a disc of the 4-lane road would
   * paint a half-disc of asphalt 19.5 units past N2, outside the taper line just
   * painted (§2.4, §2.12.1).
   */
  it("draws the wedge of a tapered joint and no joint disc", () => {
    const svg = renderToStaticMarkup(<Diagram doc={laneDrop()} />);

    expect(svg).toContain('class="road-taper"');
    expect(svg).not.toContain("road-joint");
  });

  /** Two links of `a` then `b` lanes, in a straight line, stating no side. */
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
   * A joint with no width step draws no wedge, and its casing markup is what it
   * was before tapers existed, down to the attribute. What it gains is the joint
   * disc every wedge-free joint of two roads carries (§2.12.1).
   */
  it("draws no wedge at a joint of equal width, only its joint disc", () => {
    const svg = renderToStaticMarkup(<Diagram doc={straightPair(4, 4)} />);

    expect(svg).not.toContain("taper");
    expect(svg).toContain(
      '<path class="road-casing" d="M 0 0 L 120 0" stroke-width="39"></path>',
    );
    expect(svg).toContain('<circle class="road-joint" cx="120" cy="0" r="19.5"></circle>');
  });

  /**
   * The discs go **under every road**, which is the whole fix: drawn anywhere
   * later, a disc would paint over some road's lines — the bead it replaces.
   * Each needle is asserted present first, since `indexOf` of an absent one is
   * `-1` and would pass any ordering (§2.11.1's lesson).
   */
  it("draws a joint's discs before the first road", () => {
    const svg = renderToStaticMarkup(<Diagram doc={straightPair(3, 3)} />);

    expect(svg).toContain("road-joint");
    expect(svg).toContain("road-casing");
    expect(svg.lastIndexOf("road-joint")).toBeLessThan(svg.indexOf("road-casing"));
  });

  /** A joint's round shape is a disc under the roads, never a road's own cap. */
  it("carries no cap modifier on any road, tapered, gored or plain", () => {
    for (const doc of [laneDrop(), straightPair(4, 4), straightPair(4, 3)]) {
      const svg = renderToStaticMarkup(<Diagram doc={doc} />);
      expect(svg).toContain("road-casing");
      expect(svg).not.toContain("road-casing--butt");
    }
  });

  /** A centred lane change closes half the difference on each side. */
  it("wedges both sides of a lane change that states no side", () => {
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
    expect(padR(crossroad())).toBe(16.02);
    // Stop bars 4 units beyond the pad, half a road plus 1 wide either side.
    expect(svg).toContain('x1="-20.02" y1="11.5" x2="-20.02" y2="-11.5"');
    expect(svg).toContain('x1="20.02" y1="-11.5" x2="20.02" y2="11.5"');
    // Nothing is drawn between the pad and its stop bars any more. The dashed
    // turn arcs used to sit exactly there, and a junction's turns are paint on
    // the approach now (lane arrows Phase 4) — so the pad's own tag is the last
    // thing before the first bar, and `jn-movement` is not in the file at all.
    expect(svg).not.toContain("jn-movement");
    expect(svg.indexOf("jn-pad")).toBeLessThan(svg.indexOf("jn-stopbar"));
    expect(
      svg.slice(svg.indexOf("jn-pad"), svg.indexOf("jn-stopbar")),
    ).toMatch(/^jn-pad" d="[^"]+"><\/path><line class="$/);
  });

  /**
   * The three things that measure to the glyph's rim, pinned as a **regression
   * check and not as a proof** (junction glyphs §2.3). All three read
   * `padRadius` and none of them reads the pad's outline, so they come out
   * byte-identical whatever the outline is — including a wrong one.
   *
   * They are captured here anyway, because the rim staying a circle is the whole
   * reason the pad may stop being one, and nothing pinned the hit disc or the
   * halo before.
   */
  it("keeps the stop bars, the hit disc and the halo on a circular rim", () => {
    const svg = renderToStaticMarkup(
      <Diagram
        doc={crossroad()}
        interaction={{ ...interaction(), selection: { kind: "node", id: "N2" } }}
      />,
    );

    // Two units past the pad for the target, five for the outline.
    expect(svg).toContain('<circle class="jn-hit" r="18.02">');
    expect(svg).toContain('<circle class="jn-halo" r="21.02"');
    expect(padR(crossroad()) + 2).toBe(18.02);
    expect(padR(crossroad()) + 5).toBe(21.02);
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

    // And where each bar lies, whole, pinned literally: `rayCircleExit` off a
    // carriageway 13.5 out of a 24-unit rim is √(24² − 13.5²) = 19.843, plus the
    // 4-unit standoff. A regression check on the rim, which does not move here.
    expect(svg).toContain(
      '<line class="jn-stopbar" x1="-23.84313483298443" y1="25" x2="-23.84313483298443" y2="2">',
    );
    expect(svg).toContain(
      '<line class="jn-stopbar" x1="-23.84313483298443" y1="-2" x2="-23.84313483298443" y2="-25">',
    );
  });

  /**
   * …and the pad has to grow to meet them. The base radius for a 2-lane arm is
   * 16.02, which stops 8 units short of a carriageway whose outer edge is at
   * 13.5 + 21/2 = 24 — a glyph floating clear of the roads it joins.
   */
  it("reaches a displaced carriageway's outer edge with the pad", () => {
    expect(padR(dividedApproach())).toBeCloseTo(24);
  });

  /**
   * The reach is a floor in **world** units while `scale` multiplies only the
   * base term, so the Size control clamps rather than shrinking a pad past the
   * road it serves. That is intended (ramps spec §2.2), and pinned here so it is
   * not later read as a bug: at half size an undivided 2-lane junction would
   * compute (0.62 * 21 + 3) * 0.5 = 8.01 and instead holds at half a road, 10.5.
   */
  it("clamps the Size control at the arms' own reach", () => {
    const full = padR(crossroad());
    const half = padR(crossroad(0.5));

    // Size still resizes, just not below the approach.
    expect(half).toBeLessThan(full);
    expect(half).toBeCloseTo(10.5);
    expect(half).toBeGreaterThan(16.02 * 0.5);
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

  /**
   * The pad follows the roads (junction glyphs Phase 1). The **shape** of it is
   * `geometry.test.ts`'s subject; what this adds is that the outline survives the
   * trip from the document to the markup — one element, one class token, and a
   * `d` rather than an `r`.
   */
  it("draws the pad as one path, wound so the bands read as one area", () => {
    const svg = renderToStaticMarkup(<Diagram doc={crossroad()} />);
    const d = svg.match(/class="jn-pad" d="([^"]+)"/)![1];

    // One subpath per arm, each closed, in one element.
    expect(d.match(/M /g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(svg.match(/class="jn-pad"/g)).toHaveLength(1);
    // And nothing sets a fill rule on it, in the markup or the stylesheet: the
    // default nonzero is what turns two overlapping bands into one pad.
    expect(svg).not.toContain("fill-rule");
  });

  /**
   * The one branch this phase must not move. A junction with no arms has no
   * roads to follow, still paints a full disc of asphalt, and still carries its
   * badge at the size it always did — `10.44 * 0.85`, byte for byte.
   */
  it("keeps the circle, and the full-size badge, on a junction with no arms", () => {
    const lone = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "setNodeKind", id: "N1", kind: "junction" },
      { type: "setJunctionGlyph", id: "N1", glyph: "priority_cross" },
    ).doc;
    const svg = renderToStaticMarkup(<Diagram doc={lone} />);

    expect(svg).toContain('<circle class="jn-pad" r="10.44">');
    expect(svg).toContain(
      'points="0,-8.873999999999999 8.873999999999999,0 0,8.873999999999999 -8.873999999999999,0"',
    );
    // A vacuous bound would have erased that badge from under a full disc.
    expect(padR(lone, "N1") * 0.85).toBeCloseTo(8.874);
  });
});

/**
 * The priority diamond is paint **on** the asphalt, so it moves when the asphalt
 * does — the one badge of the three that Phase 1 touches. A stop bar measures
 * along an arm and the rim did not move; a signal head is roadside furniture and
 * needs no asphalt beneath it (junction glyphs §2.6).
 */
describe("the priority badge", () => {
  /** The diamond's half-diagonal, read off its north tip. */
  function half(doc: Document): number {
    const svg = renderToStaticMarkup(<Diagram doc={doc} />);
    return -Number(
      svg.match(/class="jn-priority" points="0,(\S+?) /)![1],
    );
  }

  /** A junction of `lanes`-lane roads: two through arms, plus a stem of `stem`
   *  lanes leaving south where one is given. */
  function junction(lanes: number, stem?: number): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "addNode", pos: { x: 240, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 120 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N3" },
      ...(stem === undefined
        ? []
        : ([
            { type: "startLink", from: "N2" },
            { type: "completeLink", to: "N4" },
            { type: "setLinkLanes", id: "L3", count: stem },
          ] as Action[])),
      { type: "setLinkLanes", id: "L1", count: lanes },
      { type: "setLinkLanes", id: "L2", count: lanes },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionGlyph", id: "N2", glyph: "priority_cross" },
    ).doc;
  }

  /** A junction's pad owns its joint, so a T draws no joint disc (§2.12.1). */
  it("draws no joint disc at a T junction", () => {
    const svg = renderToStaticMarkup(<Diagram doc={junction(2, 2)} />);

    expect(svg).toContain("jn-pad");
    expect(svg).not.toContain("road-joint");
  });

  /**
   * On a straight-through junction the tips north and south leave the pad at the
   * road's own edge, so the diamond shrinks to it: 10.5 where `rp * 0.85` alone
   * would have drawn 13.617 and floated 3.1 units of yellow on bare paper.
   */
  it("shrinks the diamond onto the asphalt under it", () => {
    expect(half(junction(2))).toBeCloseTo(10.5);
    expect(padR(junction(2)) * 0.85).toBeCloseTo(13.617);
  });

  /**
   * **The case that makes the bound measured rather than derived.** A T with a
   * 1-lane through road and a 4-lane stem is sized by the stem, so any rule
   * reading the widest arm reports 19.5 — while the pad north of the centre is
   * the through road's 12-unit band and reaches 6 (junction glyphs §2.3).
   */
  it("measures each tip against the pad, not against the widest arm", () => {
    const mixed = junction(1, 4);

    expect(half(mixed)).toBeCloseTo(6);
    expect(padR(mixed)).toBeCloseTo(27.18);
  });

  /**
   * OQ-5, resolved: where the pad does not cover the glyph centre the measured
   * bound is `0`, and the badge is floored rather than erased. A divided approach
   * puts the centre in the median, which is the commonest way to get there.
   */
  it("floors the diamond where the pad does not cover the centre", () => {
    const divided = run(
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
      { type: "setJunctionGlyph", id: "N2", glyph: "priority_cross" },
    ).doc;

    expect(half(divided)).toBeCloseTo(8.4);
    expect(padR(divided) * 0.35).toBeCloseTo(8.4);
  });
});

describe("gores", () => {
  /**
   * §1's exit, drawn due east: a 4-lane motorway becoming 3 at N2 with a 1-lane
   * ramp leaving to the south-east, with N2 stating `nearside` so the outer edge
   * runs straight through and the lane goes from the nearside. N2 carries the
   * `gore` glyph. `extra` hangs further actions off it.
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
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "setJunctionGlyph", id: "N2", glyph: "gore" },
      { type: "setNodeLaneChange", id: "N2", change: "nearside" },
      ...extra,
    ).doc;
  }

  /** The gore triangle's three corners: nose first, then one along each arm. */
  function corners(svg: string): [number, number][] {
    const m = svg.match(/class="jn-gore" points="(\S+) (\S+) (\S+)"/)!;
    return m.slice(1, 4).map((p) => p.split(",").map(Number) as [number, number]);
  }

  /**
   * **No round shape on any of the three arms.** A gore's legs are literal
   * continuations of the two roads' edge lines, so round asphalt crossing one
   * crosses a line drawn to be continuous — and the widest arm, the 4-lane
   * approach, would paint to `y = 19.5` against a mainline edge line at `9`
   * (§2.11.2). Every casing now ends flat, and a gore node is a `junction`, so no
   * joint disc stands in for the cap either (§2.12.1).
   */
  it("draws no joint disc at a gore, and no cap modifier on any arm", () => {
    const svg = renderToStaticMarkup(<Diagram doc={exit()} />);

    expect(svg.match(/class="road-casing"/g)).toHaveLength(3);
    expect(svg).not.toContain("road-joint");
    expect(svg).not.toContain("road-casing--butt");
  });

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

    // A 3-lane motorway walked to −4.5 by the side at N2: nearside edge at
    // −4.5 + 13.5 = 9.
    expect(svg).toContain('class="road-edge" d="M 120 9 L 240 9"');
    expect(nose[1]).toBeCloseTo(9);
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
   * **The inverse of what this asserted through Phase 4**, and the change is the
   * phase. A gore used to *borrow* the shoulder's hatch, which is why the
   * `<defs>` gate had to be widened past a hard shoulder to reach it. With
   * chevrons of its own the borrowing is gone, so a document with a gore and no
   * shoulder now emits no `<pattern>` at all — and the predicate is a shoulder
   * test again, name included (§2.9.2).
   */
  it("emits no hatch pattern for a gore in a document with no shoulder lane", () => {
    const svg = renderToStaticMarkup(<Diagram doc={exit()} />);

    expect(svg).not.toContain("lane-band");
    expect(svg).not.toContain("<pattern");
    expect(svg).not.toContain("jn-gore-hatch");
    expect(svg).not.toContain("url(");
    expect(svg).toContain('class="jn-gore-chevrons"');
  });

  /**
   * Two layers still, and for the reason that outlived the hatch it was written
   * for: the gore's base is out past both roads, over bare paper, so a chevron
   * needs asphalt under it just as a transparent pattern did.
   *
   * Phase 4 asserted the two polygons carried the *same points*, which a fan of
   * chevrons has no analog for. What replaces it is the claim that survives —
   * the surface still sits under the paint, in that order.
   */
  it("paints the chevrons on a surface, in that order", () => {
    const svg = renderToStaticMarkup(<Diagram doc={exit()} />);

    expect(svg.indexOf('class="jn-gore"')).toBeLessThan(
      svg.indexOf('class="jn-gore-chevrons"'),
    );
    // A path with something in it: an empty `d` is what a degenerate gore draws,
    // and it passes every assertion above.
    expect(svg).toMatch(/class="jn-gore-chevrons" d="M [-\d.]+ [-\d.]+ L/);
  });

  /**
   * The chevrons of a diverge point at the nose; §1's exit *is* a diverge, both
   * mainline and ramp leaving N2. The direction rule itself is pinned in
   * `geometry.test.ts`, off both cases; what this adds is that the bit survives
   * the trip from the document, through `junctionArms`, to the paint — which no
   * pure test can see (§2.9.1).
   */
  it("faces the chevrons of a diverge back at the nose", () => {
    const svg = renderToStaticMarkup(<Diagram doc={exit()} />);
    const [nose] = corners(svg);
    const d = svg.match(/class="jn-gore-chevrons" d="([^"]+)"/)![1];
    const pts = [...d.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as [number, number],
    );
    const from = (p: [number, number]) =>
      Math.hypot(p[0] - nose[0], p[1] - nose[1]);

    // Each chevron is `wing, tip, wing`; the tip is the one nearest the nose.
    for (let i = 0; i < pts.length; i += 3) {
      expect(from(pts[i + 1])).toBeLessThan(from(pts[i]));
      expect(from(pts[i + 1])).toBeLessThan(from(pts[i + 2]));
    }
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
   * A bus stop in the kerb lane: two end bars and the word, and **no long side**,
   * because the road's own lines are the box's sides (bus stops spec §2.7.1). On
   * `marked`'s road — 120 long, three lanes, band 0 at offset 9 and 9 wide — a bar
   * runs `y` 4.5 to 13.5, and the box is 45 long.
   */
  describe("a bus stop", () => {
    /** `marked`'s road carrying one in-lane stop, `units` along it. */
    function stopAt(units: number): Document {
      return withMarkings(marked(0), [
        {
          id: "M1",
          link: "L1",
          position: units / UNITS_PER_METRE,
          kind: { type: "bus_stop", form: "in_lane" },
        },
      ]);
    }

    /** What the stop's group holds, from the first stop group in `svg`. */
    function group(svg: string): string {
      return svg.match(/<g class="marking marking-bus-stop[^"]*">([\s\S]*?)<\/g>/)![1];
    }

    it("paints two end bars and its word, and no long side", () => {
      const [bars, word, ...rest] = group(
        renderToStaticMarkup(<Diagram doc={stopAt(60)} />),
      ).split(/(?=<text )/);

      // The whole of its paint: one path of two bars across band 0, and the word.
      expect(rest).toEqual([]);
      expect(bars).toBe(
        '<path class="marking-stop-ends" d="M 37.5 4.5 L 37.5 13.5 M 82.5 4.5 L 82.5 13.5"></path>',
      );
      expect(word).toMatch(/^<text class="marking-text" [^>]*>BUS<\/text>$/);

      const run = markingText({
        at: { x: 60, y: 0 },
        dir: { x: 1, y: 0 },
        segment: 0,
        distance: 60,
        span: { offset: 9, width: 9 },
      });
      expect(word).toContain(` x="${run.at.x}" y="${run.at.y}" `);
      expect(word).toContain(
        `transform="rotate(${run.angle} ${run.at.x} ${run.at.y})"`,
      );

      // …and it is the element a text marking reading BUS paints in that lane.
      const lettered = renderToStaticMarkup(
        <Diagram
          doc={withMarkings(marked(0), [
            {
              id: "M1",
              link: "L1",
              position: 60 / UNITS_PER_METRE,
              lane: 0,
              kind: { type: "text", content: "BUS" },
            },
          ])}
        />,
      );
      expect(lettered).toContain(word);
    });

    /**
     * Dragged to the road's end, the stop slides back until it fits whole — its
     * word still centred in its box — rather than drawing half a box (OQ-4).
     */
    it("slides to fit at the end of its road, word and all", () => {
      const inner = group(renderToStaticMarkup(<Diagram doc={stopAt(120)} />));

      expect(inner).toContain(
        'class="marking-stop-ends" d="M 75 4.5 L 75 13.5 M 120 4.5 L 120 13.5"',
      );
      expect(inner).toMatch(/<text class="marking-text" x="97.5" /);
    });

    /** The box is what selects and highlights, not a bar across its middle. */
    it("is hit and haloed as the box, not as a bar across it", () => {
      const selected: Interaction = {
        ...interaction(),
        selection: { kind: "marking", id: "M1" },
      };
      const live = renderToStaticMarkup(
        <Diagram doc={stopAt(60)} interaction={selected} />,
      );

      expect(live).toContain('<g class="marking marking-bus-stop is-selected">');
      // Band 0's centre line along the stretch, stroked band 0's width.
      expect(live).toContain(
        '<path class="marking-hit" d="M 37.5 9 L 82.5 9" stroke-width="9">',
      );
      expect(live).toContain(
        '<path class="marking-halo" d="M 37.5 9 L 82.5 9" stroke-width="15">',
      );
    });

    /**
     * A stop follows the road: its stretch carries a bend, and each end bar is
     * square to the segment its own end is on — not to the direction at the
     * stop's centre, which on this road is the first leg's (bus stops §2.6).
     */
    it("follows a bend inside its stretch", () => {
      // `N1(0,0) → (60,0) → N2(60,100)`: the corner 60 along, so a stop centred
      // there runs 22.5 into each leg.
      const bent = withMarkings(
        run(
          initialState(),
          { type: "addNode", pos: { x: 0, y: 0 } },
          { type: "addNode", pos: { x: 60, y: 100 } },
          { type: "startLink", from: "N1" },
          { type: "completeLink", to: "N2" },
          { type: "setLinkLanes", id: "L1", count: 3 },
          { type: "addBend", link: "L1", index: 0, pos: { x: 60, y: 0 } },
        ).doc,
        stopAt(60).markings,
      );
      const live = renderToStaticMarkup(
        <Diagram doc={bent} interaction={interaction()} />,
      );
      const points = (d: string) =>
        d
          .split(/[ML]/)
          .map((s) => s.trim())
          .filter((s) => s !== "")
          .map((s) => s.split(" ").map(Number));
      const path = (cls: string) =>
        points(live.match(new RegExp(`<path class="${cls}" d="([^"]*)"`))![1]);

      expect(path("marking-hit")).toHaveLength(3);

      const [a0, a1, b0, b1] = path("marking-stop-ends");
      const along = (p: number[], q: number[], dir: [number, number]) =>
        (q[0] - p[0]) * dir[0] + (q[1] - p[1]) * dir[1];
      // The near end is on the eastbound leg, the far end on the southbound one.
      expect(along(a0, a1, [1, 0])).toBeCloseTo(0);
      expect(along(b0, b1, [0, 1])).toBeCloseTo(0);
      expect(Math.hypot(b1[0] - b0[0], b1[1] - b0[1])).toBeCloseTo(9);
    });
  });

  /**
   * A bus stop in a bay: the road widens beside the running lane and its kerb edge
   * line opens over the whole mouth (bus stops spec §2.8, §2.9). The bay's own
   * geometry is pinned in `geometry.test.ts`; what these carry is the markup —
   * which pieces the road draws, and in what order the layers fall.
   */
  describe("a bus stop in a bay", () => {
    /** A three-lane road due east, `length` long, carrying `markings`. */
    function roadOf(length: number, markings: Marking[]): Document {
      return withMarkings(
        run(
          initialState(),
          { type: "addNode", pos: { x: 0, y: 0 } },
          { type: "addNode", pos: { x: length, y: 0 } },
          { type: "startLink", from: "N1" },
          { type: "completeLink", to: "N2" },
          { type: "setLinkLanes", id: "L1", count: 3 },
        ).doc,
        markings,
      );
    }

    /** A bay stop on `L1`, placed in **world units** rather than metres. */
    function bay(units: number, id = "M1"): Marking {
      return {
        id,
        link: "L1",
        position: units / UNITS_PER_METRE,
        kind: { type: "bus_stop", form: "bay" },
      };
    }

    /** The first road group's markup — everything `RoadShape` drew, and nothing else. */
    function roadGroup(svg: string): string {
      return svg.match(/<g class="road">[\s\S]*?<\/g>/)![0];
    }

    /** Its `road-edge` paths, in the order drawn: the kerb pieces, then the offside edge. */
    function roadEdges(svg: string): string[] {
      return [
        ...roadGroup(svg).matchAll(/class="road-edge" d="([^"]*)"/g),
      ].map((m) => m[1]);
    }

    /**
     * The cut is made on the road **as drawn** and only then offset. Offsetting
     * first moves the corner along the road — the first piece would end at
     * `(36.5, 55.5)`, 36.5 along its own first leg and then 42 down the second.
     */
    it("cuts the kerb edge line on the drawn polyline, not the offset one", () => {
      // `A(0,0) → (50,0) → C(50,150)`: a bay centred 125 along sits 75 down the
      // second leg, so its opening runs 78.5 to 171.5, all on that leg.
      const bent = withMarkings(
        run(
          initialState(),
          { type: "addNode", pos: { x: 0, y: 0 } },
          { type: "addNode", pos: { x: 50, y: 150 } },
          { type: "startLink", from: "N1" },
          { type: "completeLink", to: "N2" },
          { type: "setLinkLanes", id: "L1", count: 3 },
          { type: "addBend", link: "L1", index: 0, pos: { x: 50, y: 0 } },
        ).doc,
        [bay(125)],
      );

      expect(roadEdges(renderToStaticMarkup(<Diagram doc={bent} />))).toEqual([
        "M 0 13.5 L 36.5 13.5 L 36.5 28.5",
        "M 36.5 121.5 L 36.5 150",
        "M 0 -13.5 L 63.5 -13.5 L 63.5 150",
      ]);
    });

    /**
     * Two bays whose footprints overlap open **one** gap, not two overlapping ones
     * (OQ-5). Listed later-first deliberately: their stretches are equally long, so
     * in sorted order a walk that never merges still comes out right, and only this
     * order makes the merge observable.
     */
    it("opens one gap for two bays whose footprints overlap", () => {
      const doc = roadOf(400, [bay(200, "M1"), bay(150, "M2")]);

      expect(roadEdges(renderToStaticMarkup(<Diagram doc={doc} />))).toEqual([
        "M 0 13.5 L 103.5 13.5",
        "M 246.5 13.5 L 400 13.5",
        "M 0 -13.5 L 400 -13.5",
      ]);
    });

    /**
     * A bay dragged to the road's start slides in until the whole footprint fits —
     * its reach is 46.5, a taper further than an in-lane stop's (OQ-4) — so the
     * road keeps one kerb piece rather than that plus an empty one at the start.
     */
    it("slides in from the road's end, and draws no piece of no length", () => {
      const svg = renderToStaticMarkup(<Diagram doc={roadOf(240, [bay(0)])} />);

      expect(roadEdges(svg)).toEqual([
        "M 93 13.5 L 240 13.5",
        "M 0 -13.5 L 240 -13.5",
      ]);
      expect(svg).toContain(
        'class="road-divider road-bay-mouth" d="M 0 13.5 L 93 13.5"',
      );
      // The box and its word slide with the bay, and sit in it: 13.5 to 22.5.
      expect(svg).toContain(
        'class="marking-stop-ends" d="M 24 13.5 L 24 22.5 M 69 13.5 L 69 22.5"',
      );
      expect(svg).toMatch(/<text class="marking-text" x="46.5" /);
    });

    it("leaves the road exactly as it was for an in-lane stop", () => {
      const stopped = roadOf(240, [
        {
          id: "M1",
          link: "L1",
          position: 120 / UNITS_PER_METRE,
          kind: { type: "bus_stop", form: "in_lane" },
        },
      ]);
      const svg = renderToStaticMarkup(<Diagram doc={stopped} />);

      expect(roadGroup(svg)).toBe(
        roadGroup(renderToStaticMarkup(<Diagram doc={roadOf(240, [])} />)),
      );
      expect(svg).not.toContain("road-bay");
    });

    /**
     * A road with no bay draws its kerb edge from its **own points**, never from a
     * stretch of its whole length: re-walking a polyline lands its far end a float
     * slack away, which no picture shows and which would change the markup of every
     * road in every document that carries no bay at all.
     */
    it("draws an uncut kerb edge straight from the road's own points", () => {
      const doc = run(
        initialState(),
        { type: "addNode", pos: { x: 0.3, y: 0.7 } },
        { type: "addNode", pos: { x: 141.9, y: 5.3 } },
        { type: "startLink", from: "N1" },
        { type: "completeLink", to: "N2" },
        { type: "setLinkLanes", id: "L1", count: 3 },
        { type: "addBend", link: "L1", index: 0, pos: { x: 37.1, y: 11.9 } },
        { type: "addBend", link: "L1", index: 1, pos: { x: 90.23, y: -23.17 } },
      ).doc;
      const points = drawnPolyline(doc, doc.links[0], carriageways(doc))!;
      const direct = polylinePath(offsetPolyline(points, 13.5));

      // The fixture is one where the two differ, or this would assert nothing.
      expect(
        polylinePath(
          offsetPolyline(polylineStretch(points, 0, polylineLength(points)), 13.5),
        ),
      ).not.toBe(direct);
      expect(roadEdges(renderToStaticMarkup(<Diagram doc={doc} />))[0]).toBe(direct);
    });

    /**
     * The bay is asphalt, so it is drawn in the wedge layer: after **every** road,
     * and before every marking — including a marking of a neighbouring road listed
     * before the stop the bay belongs to, which is what a bay drawn beside its own
     * stop would paint over (§2.8).
     */
    it("draws above every road and below every marking", () => {
      const two = run(
        initialState(),
        { type: "addNode", pos: { x: 0, y: 0 } },
        { type: "addNode", pos: { x: 240, y: 0 } },
        { type: "startLink", from: "N1" },
        { type: "completeLink", to: "N2" },
        { type: "setLinkLanes", id: "L1", count: 3 },
        { type: "addNode", pos: { x: 0, y: 120 } },
        { type: "addNode", pos: { x: 240, y: 120 } },
        { type: "startLink", from: "N3" },
        { type: "completeLink", to: "N4" },
        { type: "setLinkLanes", id: "L2", count: 3 },
      ).doc;
      const svg = renderToStaticMarkup(
        <Diagram
          doc={withMarkings(two, [
            {
              id: "M2",
              link: "L2",
              position: 14,
              lane: 0,
              kind: { type: "stop_line" },
            },
            bay(120),
          ])}
        />,
      );

      expect(svg.lastIndexOf("road-casing")).toBeLessThan(svg.indexOf("road-bay"));
      expect(svg.indexOf("road-bay")).toBeLessThan(svg.indexOf('class="marking'));
    });

    /**
     * A link's length label sits `LABEL_GAP` off the **kerb** side — the side a
     * bay opens on — so a bay under the road's midpoint lands on top of it. The
     * label clears it by the bay's own width, and a bay anywhere else on the same
     * road leaves the label exactly where it was.
     */
    it("pushes a length label past a bay under it, and past no other", () => {
      const stated = (doc: Document): Document => ({
        ...doc,
        links: doc.links.map((l) => ({ ...l, length: 820 })),
      });
      const label = (doc: Document): number[] =>
        renderToStaticMarkup(<Diagram doc={stated(doc)} />)
          .match(/<text class="link-length" x="([^"]*)" y="([^"]*)"/)!
          .slice(1)
          .map(Number);

      // The 240-unit road's midpoint is 120, which the bay's stretch covers; the
      // bay at `position = 0` slides to 46.5 and stops 27 short of it.
      const none = label(roadOf(240, []));
      const under = label(roadOf(240, [bay(120)]));
      const elsewhere = label(roadOf(240, [bay(0)]));

      expect(under[0]).toBe(none[0]);
      expect(under[1] - none[1]).toBeCloseTo(LANE_PX);
      expect(elsewhere).toEqual(none);
    });

    it("draws the bay as a plain group, and the box's chrome in the bay", () => {
      const doc = roadOf(240, [bay(120)]);
      const selected: Interaction = {
        ...interaction(),
        selection: { kind: "marking", id: "M1" },
      };
      const live = renderToStaticMarkup(<Diagram doc={doc} interaction={selected} />);

      // No class token on the group: the bay paints the road's own asphalt and
      // line through `.road-taper` and `.road-edge`, as a taper wedge does.
      expect(live).toContain('<g class="bay">');
      expect(live).toContain(
        '<path class="marking-hit" d="M 97.5 18 L 142.5 18" stroke-width="9">',
      );
      expect(live).toContain(
        '<path class="marking-halo" d="M 97.5 18 L 142.5 18" stroke-width="15">',
      );
      // Hairlines on the canvas; an export drops them with every other one.
      expect(live).toMatch(
        /class="road-edge road-bay-edge" d="[^"]*" vector-effect="non-scaling-stroke"/,
      );
      expect(renderToStaticMarkup(<Diagram doc={doc} />)).not.toMatch(/vector-effect/);
    });
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
     * The rear head reaches the drawing (markings spec Phase 5) — which is one
     * assertion the geometry suite cannot make for us, because `back` is an
     * **optional** parameter: a call site that never passes it builds green,
     * tests green in `geometry.test.ts`, and quietly draws a single-headed
     * arrow. Only the markup can tell.
     */
    it("carries a rear head into the drawing", () => {
      const both = renderToStaticMarkup(
        <Diagram
          doc={repainted(
            { type: "turn_arrow", directions: ["left"], back: ["left"] },
            1,
          )}
        />,
      );
      const single = renderToStaticMarkup(
        <Diagram doc={repainted({ type: "turn_arrow", directions: ["left"] }, 1)} />,
      );

      const heads = (svg: string) =>
        svg.match(/class="marking-arrow-head" d="([^"]*)"/)![1].match(/Z/g)!;
      expect(heads(both)).toHaveLength(2);
      expect(heads(single)).toHaveLength(1);
      expect(both).not.toMatch(/NaN|undefined/);
      // The rear head sits at the other end of the lane's own stretch of road, so
      // the arrow grew along the link rather than doubling up on itself. The
      // *extent* rather than the near end, because a `left` branch forks upstream
      // of the marking's position once it is staggered (markings §2.12), which
      // puts its rear head downstream — the arrow still grew, from the other end.
      const spread = (svg: string) => {
        const xs = path(svg, "marking-arrow-head").filter((_, i) => i % 2 === 0);
        return Math.max(...xs) - Math.min(...xs);
      };
      expect(spread(both)).toBeGreaterThan(spread(single));
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
   *
   * **Every needle is asserted present before its index is compared, and that is
   * a rule rather than a belt-and-braces.** `indexOf` answers `-1` for a needle
   * that is absent, which *every* index beats — so the day a class leaves the
   * markup, an ordering assertion written the obvious way starts passing for
   * nothing. Phase 7 is the day: the dot went behind the `interaction` gate
   * (ramps §2.11.1), which is also why this renders on the canvas.
   */
  it("draws above the roads, the paint and the junction glyphs alike", () => {
    const svg = renderToStaticMarkup(
      <Diagram doc={signed()} interaction={interaction()} />,
    );
    const plate = svg.indexOf("sign-plate");

    for (const under of ["road-casing", "marking-bar", "jn-ring", "node-dot"]) {
      expect(svg).toContain(under);
      expect(plate).toBeGreaterThan(svg.indexOf(under));
    }
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
      // The two plate kinds emit the *same* elements, which is exactly why the
      // group's token has to differ: it is the only thing `diagram.css` can hang a
      // destination's green panel off (signs spec Phase 4).
      [
        { type: "direction", text: "M4 W" },
        "sign-direction",
        ["sign-plate", "sign-label"],
      ],
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
   * **A destination is centred in its plate at every length** (signs spec Phase 4),
   * which is the property the whole monospace decision (§2.4) bought: the plate
   * grows with the string and the string stays on the sign's own position, with no
   * DOM measured anywhere in the chain.
   *
   * `x="0"` is the load-bearing half. `text-anchor="middle"` centres the run on
   * that point and the box is symmetric about it, so "centred" is one coordinate
   * that must **not** move as the plate widens — a sizing bug that shifted the
   * plate without the text would leave `x` alone and be invisible to an assertion
   * on the width.
   */
  it("centres a destination in the plate it sizes, at every length", () => {
    for (const text of ["M4", "M4 W", "HEATHROW & THE WEST"]) {
      const plate = signPlate(text);
      const svg = renderToStaticMarkup(<Diagram doc={kinded({ type: "direction", text })} />);

      expect(svg).toContain(
        `<rect class="sign-plate" x="${plate.box.x}" y="${plate.box.y}"` +
          ` width="${plate.box.width}" height="${plate.box.height}" rx="${plate.radius}"></rect>`,
      );
      expect(svg).toContain(`<text class="sign-label" x="0" y="${plate.baseline.y}"`);
      // Symmetric about the sign's own position, whatever the width — the plate
      // grows either side rather than off to one.
      expect(plate.box.x).toBeCloseTo(-plate.box.width / 2);
    }

    // Monotone in the markup, not merely in `geometry.test.ts`: the renderer is
    // what has to pass the string through, and an arm that dropped it would draw
    // every destination at the floor.
    const widths = ["M4", "M4 W", "HEATHROW & THE WEST"].map(
      (text) =>
        renderToStaticMarkup(<Diagram doc={kinded({ type: "direction", text })} />).match(
          /class="sign-plate"[^>]* width="([\d.]+)"/,
        )?.[1],
    );
    expect(widths.map(Number)).toEqual([...widths.map(Number)].sort((a, b) => a - b));

    // An empty destination is the freshly picked one: the floor-width plate, and
    // no `<text>` at all — `custom`'s rule, since they share the arm.
    const fresh = renderToStaticMarkup(<Diagram doc={kinded({ type: "direction", text: "" })} />);
    expect(fresh).toContain(`<rect class="sign-plate" x="${-SIGN_SIZE / 2}"`);
    expect(fresh).not.toMatch(/<text[\s>]/);
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

/**
 * The length a link states (link-length spec Phase 1) — the drawing's only
 * derived text, and the only one whose whole point is that it does **not** move
 * the picture it sits beside.
 */
describe("the length a link states", () => {
  /** The drawn width of the one-lane road below, which the label steps off. */
  const W = LANE_PX + ROAD_MARGIN;

  /** A road due east, stating `metres` — or stating nothing. */
  function stated(metres?: number): Document {
    const doc = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
    ).doc;
    // Written onto the link directly rather than through the action, so this
    // suite tests the drawing and not the reducer.
    return metres === undefined
      ? doc
      : { ...doc, links: [{ ...doc.links[0], length: metres }] };
  }

  /** The road's own casing path, which is the whole of "the drawing". */
  function casing(svg: string): string {
    return svg.match(/class="road-casing" d="([^"]+)" stroke-width="([^"]+)"/)!.slice(1).join(" ");
  }

  it("sets the length beside the road, upright and centred", () => {
    const svg = renderToStaticMarkup(<Diagram doc={stated(1800)} />);
    const y = W / 2 + LABEL_GAP + BASELINE_DROP;

    expect(svg).toContain(
      `<text class="link-length" x="60" y="${y}"` +
        ' font-family="Overpass Mono" font-size="6" text-anchor="middle"' +
        ` transform="rotate(0 60 ${y})">1800m</text>`,
    );
  });

  /**
   * **The founding example, asserted on the markup.** `CLAUDE.md`: a link reads
   * `1800m`, and changing it to `1500m` does not move the drawing. Compared on
   * the casing's own path string, because that is what "the drawing" is.
   */
  it("changes the words and nothing else when the length changes", () => {
    const before = renderToStaticMarkup(<Diagram doc={stated(1800)} />);
    const after = renderToStaticMarkup(<Diagram doc={stated(1500)} />);

    expect(before).toContain(">1800m</text>");
    expect(after).toContain(">1500m</text>");
    expect(casing(after)).toBe(casing(before));
    // And the label's own position is the road's, not the number's: a longer
    // string is centred on the same point rather than pushed off it.
    expect(casing(after)).toBe(casing(renderToStaticMarkup(<Diagram doc={stated(200)} />)));
    expect(after.replace("1500m", "1800m")).toBe(before);
  });

  /** Derived, so a link that states nothing emits nothing at all — which is what
   *  keeps every document written before the field rendering as it did. */
  it("draws nothing for a road that states no length", () => {
    const svg = renderToStaticMarkup(<Diagram doc={stated()} />);

    expect(svg).not.toMatch(/<text[\s>]|link-length|font-family/);
    // Byte-identical to the same road drawn by the suites above.
    expect(casing(svg)).toBe(casing(renderToStaticMarkup(<Diagram doc={stated(1800)} />)));
  });

  /** Above the junction pad, which is opaque asphalt — a label drawn before the
   *  node layer would be painted over while passing every other assertion here.
   *  Below the signs, which stay the topmost thing in the drawing. */
  it("is drawn above the roads and pads, and below the signs", () => {
    const base = stated(1800);
    const doc = run(
      { ...initialState(), doc: base },
      { type: "setNodeKind", id: "N2", kind: "junction" },
      { type: "addSign", pos: { x: 60, y: 40 } },
      { type: "setSignKind", id: "S1", kind: { type: "custom", label: "TOLL" } },
    ).doc;
    const svg = renderToStaticMarkup(<Diagram doc={doc} />);

    expect(svg.indexOf("road-casing")).toBeLessThan(svg.indexOf("link-length"));
    expect(svg.indexOf("jn-pad")).toBeLessThan(svg.indexOf("link-length"));
    expect(svg.indexOf("link-length")).toBeLessThan(svg.indexOf("sign-label"));
  });

  /** The half-turn, at the level the reader sees it: two opposed carriageways
   *  both read left to right, where painted text on the same pair would not. */
  it("reads the same way up on both carriageways of a divided road", () => {
    const base = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 0 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N1" },
    ).doc;
    const doc: Document = {
      ...base,
      links: base.links.map((l) => ({ ...l, length: 1800 })),
    };
    const svg = renderToStaticMarkup(<Diagram doc={doc} />);

    expect(svg.match(/class="link-length"/g)).toHaveLength(2);
    expect(svg.match(/transform="rotate\(0 /g)).toHaveLength(2);
    // ...and on opposite sides of the shared centreline, outside the pair.
    const ys = [...svg.matchAll(/class="link-length" x="60" y="(-?[\d.]+)"/g)].map(
      (m) => Number(m[1]),
    );
    expect(ys).toHaveLength(2);
    expect(ys[0] * ys[1]).toBeLessThan(0);
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

  /**
   * **The vacuity check for `export.test.ts`'s `CHROME` token.** That file
   * asserts an exported figure matches the regex nowhere, and a regex that
   * catches nothing passes every file — so the canvas render is asserted to
   * carry the very token the export must not (ramps §2.11.1, link bends §2.3's
   * lesson turned into an assertion rather than a measurement).
   */
  it("carries a node's dot on the canvas, and none in an export", () => {
    const doc = sample();

    const live = renderToStaticMarkup(<Diagram doc={doc} interaction={interaction()} />);
    expect(live).toContain('class="node-dot"');

    const exported = renderToStaticMarkup(<Diagram doc={doc} />);
    expect(exported).not.toContain("node-dot");
    // The node is still there, and still where it was — only its mark is gone.
    expect(exported).toContain('<g class="node node-endpoint" transform="translate(0 0)"></g>');
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


/**
 * A road that turns a corner, and the handle a human grabs to make it — the
 * whole of what link bends Phase 2 adds to the drawing.
 */
describe("link bends", () => {
  /**
   * `N1(0,0) → N2(120,40)`, 3 lanes, with `bends` in between. Undivided and
   * centred, so the drawn polyline **is** the layout one and every number below
   * is read straight off the route.
   */
  function road(...bends: Vec2[]): Document {
    return run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 120, y: 40 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "setLinkLanes", id: "L1", count: 3 },
      ...bends.map((pos, i) => ({ type: "addBend" as const, link: "L1", index: i, pos })),
    ).doc;
  }

  /** Every `d` attribute in the markup, in source order. */
  function paths(svg: string): string[] {
    return [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
  }

  it("walks the road's own path through the bend", () => {
    const svg = renderToStaticMarkup(<Diagram doc={road({ x: 60, y: -40 })} />);
    expect(paths(svg)[0]).toBe("M 0 0 L 60 -40 L 120 40");
  });

  /**
   * Halfway along the **route**, not the chord: legs of `√5200 ≈ 72.11` and `100`
   * put the midpoint 13.94 into the second leg, heading `(0.6, 0.8)` — where the
   * chord's midpoint `(60, 20)` would sit 36 units off a road 30 wide.
   */
  it("puts the direction arrow halfway along the route it turns through", () => {
    const [apex, b1, b2] = arrowPoints(
      renderToStaticMarkup(
        <Diagram doc={road({ x: 60, y: -40 })} interaction={interaction()} />,
      ),
    );
    const base = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
    const into = (Math.sqrt(5200) + 100) / 2 - Math.sqrt(5200);
    const len = Math.hypot(apex.x - base.x, apex.y - base.y);

    expect((apex.x + base.x) / 2).toBeCloseTo(60 + 0.6 * into);
    expect((apex.y + base.y) / 2).toBeCloseTo(-40 + 0.8 * into);
    expect((apex.x - base.x) / len).toBeCloseTo(0.6);
    expect((apex.y - base.y) / len).toBeCloseTo(0.8);
  });

  /**
   * **Phase 1's preserved vertex count, seen from the drawing.** Every stroked
   * element of a road is its own `offsetPolyline` — the two edge lines and, on a
   * 3-lane road, two dividers — so all of them gain a vertex with the casing
   * rather than cutting the corner. A bevel inserted at the clamp would show
   * here as one path with four points, and it is the same invariant a bend's
   * insertion index rests on.
   */
  it("gives every stroked element of the road three points, not two", () => {
    const svg = renderToStaticMarkup(<Diagram doc={road({ x: 60, y: -40 })} />);
    const road_ = paths(svg).filter((d) => d.startsWith("M 0 0") || d.includes(" L "));
    expect(road_.length).toBeGreaterThanOrEqual(5); // casing, 2 edges, 2 dividers
    for (const d of road_) expect(d.split(" L ")).toHaveLength(3);
  });

  it("draws a handle per bend, on the canvas and nowhere else", () => {
    const doc = road({ x: 40, y: -40 }, { x: 90, y: -10 });

    const canvas = renderToStaticMarkup(
      <Diagram doc={doc} interaction={interaction()} />,
    );
    expect([...canvas.matchAll(/bend-handle/g)]).toHaveLength(2);
    expect(canvas).toContain("bend-hit");

    // **The gate the whole `interaction` split exists for**: an export renders
    // the drawing and no handle at all. `not.toMatch` rather than a byte
    // comparison, since this repo has no snapshot testing.
    const file = renderToStaticMarkup(<Diagram doc={doc} />);
    expect(file).not.toMatch(/bend-handle|bend-hit/);
    expect(file).toContain("M 0 0 L 40 -40 L 90 -10 L 120 40");
  });

  /**
   * **The handle sits on the *drawn* vertex, not the layout one**, so what you
   * grab is what you see. On an undivided road the two coincide and the
   * assertion is vacuous — so this one is a **carriageway of a divided pair**,
   * where they are `lateralShift` apart and the mitre moves the vertex along the
   * road as well as across it.
   */
  it("puts the handle on the drawn polyline's vertex, not the layout one", () => {
    const doc = run(
      initialState(),
      { type: "addNode", pos: { x: 0, y: 0 } },
      { type: "addNode", pos: { x: 50, y: 150 } },
      { type: "startLink", from: "N1" },
      { type: "completeLink", to: "N2" },
      { type: "startLink", from: "N2" },
      { type: "completeLink", to: "N1" },
      { type: "setLinkLanes", id: "L1", count: 2 },
      { type: "setLinkLanes", id: "L2", count: 2 },
      // The corner the spec's worked example turns: east to (50,0), then south.
      { type: "addBend", link: "L1", index: 0, pos: { x: 50, y: 0 } },
    ).doc;

    const svg = renderToStaticMarkup(
      <Diagram doc={doc} interaction={interaction()} />,
    );
    // `d` is 13.5 for a 2-lane arterial pair, and the mitre puts the drawn
    // vertex at (36.5, 13.5) — 13.5 off the layout bend in *both* axes.
    expect(svg).toContain("translate(36.5 13.5)");
    expect(svg).not.toContain("translate(50 0)");
  });

  it("lights the selected bend and no other", () => {
    const svg = renderToStaticMarkup(
      <Diagram
        doc={road({ x: 40, y: -40 }, { x: 90, y: -10 })}
        interaction={{
          ...interaction(),
          selection: { kind: "bend", link: "L1", index: 1 },
        }}
      />,
    );
    expect([...svg.matchAll(/class="bend is-selected"/g)]).toHaveLength(1);
    expect([...svg.matchAll(/class="bend"/g)]).toHaveLength(1);
  });

  /** A link with no bends emits no handle at all, so a straight document renders
   *  exactly as it did before this phase. */
  it("emits nothing for a road with no bends", () => {
    expect(
      renderToStaticMarkup(<Diagram doc={road()} interaction={interaction()} />),
    ).not.toMatch(/bend-handle|bend-hit/);
  });
});
