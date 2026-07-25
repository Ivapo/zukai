import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANE_WIDTH,
  DEFAULT_LINK_STYLE,
  DEFAULT_MEDIAN_GAP,
  defaultLane,
  emptyDocument,
} from "../model/document";
import {
  Document,
  Lane,
  Link,
  LinkId,
  LinkStyle,
  LinkView,
  NodeId,
} from "../model/types";
import {
  DRIVE_SIDE,
  LANE_PX,
  MIN_ROAD_WIDTH,
  ROAD_MARGIN,
  SCHEMATIC_MEDIAN,
  UNITS_PER_METRE,
  carriageways,
  classWidthFactor,
  distance,
  laneBands,
  offsetPolyline,
  rayCircleExit,
  roadWidth,
} from "./geometry";

/** `n` lanes at the model's default width, as every link the UI creates has. */
function defaults(n: number): Lane[] {
  return Array.from({ length: n }, (_, i) => defaultLane(i));
}

/** Lanes of the given widths in metres, indexed in order. */
function widths(...metres: number[]): Lane[] {
  return metres.map((width, i) => ({ ...defaultLane(i), width }));
}

describe("roadWidth", () => {
  /**
   * The no-visual-change proof for the road spec's Phase 1. Before it, the road
   * was `laneCount * LANE_PX + ROAD_MARGIN`; now it is a sum over each
   * `Lane.width` converted at `UNITS_PER_METRE`. A default document has to land
   * on the *same number*, so `toBe`, not `toBeCloseTo`.
   *
   * n=3 and n=6 are the two that matter: summing metres before converting gives
   * 30.000000000000004 and 57.00000000000001 there, which would also break
   * `strokeAllowance`'s exact assertions in `export.test.ts`.
   */
  it("equals the old lane-count formula exactly, for every allowed lane count", () => {
    for (let n = 1; n <= 8; n++) {
      expect(roadWidth(defaults(n))).toBe(n * LANE_PX + ROAD_MARGIN);
    }
  });

  /**
   * The floor is on the lane *count* — an empty array is one default lane —
   * never a `Math.max(MIN_ROAD_WIDTH, …)` on the result. The distinction is
   * invisible here and load-bearing once a road class narrows its lanes: an
   * output clamp would round a 1-lane ramp back up to a 1-lane arterial's width.
   */
  it("treats an empty lane array as a single default lane", () => {
    expect(roadWidth([])).toBe(MIN_ROAD_WIDTH);
    expect(roadWidth([])).toBe(roadWidth([defaultLane(0)]));
    expect(MIN_ROAD_WIDTH).toBe(12);
  });

  it("widens in proportion to the lanes the model actually gives it", () => {
    const lane = DEFAULT_LANE_WIDTH;

    // One double-width lane covers the same ground as two default ones.
    expect(roadWidth(widths(lane * 2))).toBe(roadWidth(defaults(2)));
    // A narrower lane draws narrower, not floored back to the default.
    expect(roadWidth(widths(lane * 0.5))).toBeLessThan(roadWidth(defaults(1)));
    // The lane region — the road minus its casing lip — is exactly proportional.
    expect(roadWidth(widths(7)) - ROAD_MARGIN).toBe(
      2 * (roadWidth(widths(3.5)) - ROAD_MARGIN),
    );
  });

  it("converts metres at the pinned rate", () => {
    expect(UNITS_PER_METRE).toBe(LANE_PX / DEFAULT_LANE_WIDTH);
    expect(DEFAULT_LANE_WIDTH * UNITS_PER_METRE).toBe(LANE_PX);
  });
});

describe("laneBands", () => {
  it("accounts for the whole lane region and nothing else", () => {
    for (let n = 1; n <= 8; n++) {
      const lanes = defaults(n);
      const span = laneBands(lanes).reduce((s, b) => s + b.width, 0);
      expect(span).toBe(roadWidth(lanes) - ROAD_MARGIN);
    }
    // And for lanes the model gives unequal widths.
    const mixed = widths(3.5, 2.5, 4);
    expect(laneBands(mixed).reduce((s, b) => s + b.width, 0)).toBe(
      roadWidth(mixed) - ROAD_MARGIN,
    );
  });

  /**
   * Lane 0 is the nearside (kerb) lane, so it takes the most positive offset —
   * the side a positive `offsetPolyline` distance draws on under right-hand
   * traffic. Everything keyed on `Lane.kind` depends on this: a `shoulder` at
   * index 0 has to render as an outside hard shoulder, not one in the median.
   */
  it("puts lane 0 on the nearside and runs inward, contiguously", () => {
    const bands = laneBands(defaults(4));

    expect(bands).toHaveLength(4);
    expect(bands[0].offset).toBe(Math.max(...bands.map((b) => b.offset)));
    for (let i = 1; i < bands.length; i++) {
      // Adjacent bands share an edge: no gap, no overlap.
      expect(bands[i].offset + bands[i].width / 2).toBe(
        bands[i - 1].offset - bands[i - 1].width / 2,
      );
    }
    // The road is centred on its polyline, so the bands are symmetric about 0.
    expect(bands[0].offset).toBe(-bands[bands.length - 1].offset);
  });

  it("keeps an unequal lane's own width, in world units", () => {
    const bands = laneBands(widths(3.5, 7));

    expect(bands[0].width).toBe(LANE_PX);
    expect(bands[1].width).toBe(2 * LANE_PX);
    // Metres would have made these 3.5 and 7 — the bands are drawing space.
    expect(bands[1].width).toBe(7 * UNITS_PER_METRE);
  });

  /**
   * The divider half of the no-visual-change proof. `RoadShape` draws a divider
   * on each band's far boundary; those boundaries have to land exactly where the
   * deleted fixed-pitch loop put them.
   */
  it("puts its boundaries on the old fixed-pitch divider offsets", () => {
    for (const n of [1, 2, 3, 4, 6, 8]) {
      const lanes = defaults(n);
      const w = roadWidth(lanes);

      // The loop this replaced, verbatim.
      const old: number[] = [];
      for (let i = 1; i < n; i++) old.push(w / 2 - 1.5 - i * ((w - 3) / n));

      const boundaries = laneBands(lanes)
        .slice(1)
        .map((b) => b.offset + b.width / 2);

      expect(boundaries).toEqual(old);
    }
  });
});

describe("classWidthFactor", () => {
  const NARROWER: LinkStyle[] = ["local", "ramp"];

  it("leaves motorway and arterial at the unfactored width", () => {
    for (let n = 1; n <= 8; n++) {
      expect(roadWidth(defaults(n), "motorway")).toBe(roadWidth(defaults(n)));
      expect(roadWidth(defaults(n), "arterial")).toBe(roadWidth(defaults(n)));
    }
    expect(classWidthFactor("motorway")).toBe(1);
    expect(classWidthFactor("arterial")).toBe(1);
  });

  it("keeps the factor modest enough never to confuse lane count", () => {
    for (const style of NARROWER) {
      const f = classWidthFactor(style);
      expect(f).toBeGreaterThanOrEqual(0.8);
      expect(f).toBeLessThan(1);
    }
    // The property that matters: more lanes always beats a wider class.
    expect(roadWidth(defaults(3), "ramp")).toBeGreaterThan(
      roadWidth(defaults(2), "motorway"),
    );
  });

  /**
   * The factor's definition: it scales each lane's drawn width, one step
   * upstream of everything derived from them. Exact, and deliberately asserted
   * per band rather than on the summed road width — this is the half a
   * scale-the-finished-width implementation gets wrong, leaving the dividers at
   * full pitch and spilling them outside a narrowed casing (road spec 2.3).
   */
  it("scales every lane band exactly, for every class and lane count", () => {
    for (const style of NARROWER) {
      const f = classWidthFactor(style);
      for (let n = 1; n <= 8; n++) {
        const plain = laneBands(defaults(n));
        const scaled = laneBands(defaults(n), style);

        expect(scaled).toHaveLength(plain.length);
        for (let i = 0; i < plain.length; i++) {
          expect(scaled[i].width).toBe(f * plain[i].width);
        }
      }
    }
  });

  /**
   * `ROAD_MARGIN` is the casing lip, not a lane, so it is *not* scaled: the road
   * width is not proportional to the factor, only its lane region is, and the
   * two differ by `ROAD_MARGIN * (1 - factor)` at every lane count.
   *
   * `toBeCloseTo`, not `toBe`, and the reason is measured rather than assumed.
   * Two float effects put the aggregate identity up to 1 ulp off: regrouping
   * (`sum(w * f)` differs from `f * sum(w)` at local n=3, n=7 and ramp n=8 —
   * the same drift the metre conversion has, one level up) and the margin round
   * trip (`(region + 3) - 3` differs from `region` at ramp n=1, n=2). Neither is
   * avoidable by regrouping — scaling in metres before converting drifts three
   * times as often. The exact claim lives in the per-band test above.
   */
  it("scales the lane region and leaves the casing lip alone", () => {
    for (const style of NARROWER) {
      const f = classWidthFactor(style);
      for (let n = 1; n <= 8; n++) {
        const plain = roadWidth(defaults(n));
        const scaled = roadWidth(defaults(n), style);

        expect(scaled - ROAD_MARGIN).toBeCloseTo(f * (plain - ROAD_MARGIN));
        expect(scaled - f * plain).toBeCloseTo(ROAD_MARGIN * (1 - f));
        // Which is to say: the road width itself is *not* proportional.
        expect(scaled).not.toBe(f * plain);
      }
    }
  });

  /**
   * The `MIN_ROAD_WIDTH` interaction. The one-lane floor is on the lane *count*;
   * had it been a `Math.max(MIN_ROAD_WIDTH, ...)` clamp on the result, a 1-lane
   * ramp would round back up to a 1-lane arterial's 12 and the class would be
   * silently cancelled in exactly the case it reads most clearly (spec 2.2).
   */
  it("draws a 1-lane ramp strictly narrower than a 1-lane arterial", () => {
    expect(roadWidth(defaults(1), "ramp")).toBeLessThan(roadWidth(defaults(1)));
    expect(roadWidth(defaults(1), "ramp")).toBeLessThan(MIN_ROAD_WIDTH);
    expect(roadWidth(defaults(1), "ramp")).toBeCloseTo(10.2);
    // And the floor still applies to the count, not the width.
    expect(roadWidth([], "ramp")).toBe(roadWidth([defaultLane(0)], "ramp"));
  });

  /**
   * Contiguity is `toBeCloseTo` here where the default-lane case above asserts
   * `toBe`: a shared boundary is reached from either side as `offset ± width/2`,
   * and once the class factor makes the widths non-integral those two
   * reconstructions can land 1 ulp apart. That is a rounding artefact of the
   * midpoint form, not a gap in the road.
   */
  it("keeps lane 0 on the nearside under a narrowed class", () => {
    const bands = laneBands(defaults(4), "ramp");

    expect(bands[0].offset).toBe(Math.max(...bands.map((b) => b.offset)));
    expect(bands[0].offset).toBe(-bands[bands.length - 1].offset);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].offset + bands[i].width / 2).toBeCloseTo(
        bands[i - 1].offset - bands[i - 1].width / 2,
      );
    }
  });
});

describe("rayCircleExit", () => {
  /**
   * The identity Phase 1's no-visual-change proof rests on: an arm that meets
   * the node dead centre must get the pad radius back **exactly**, so the new
   * stop-bar expression collapses to the old `dir * (rp + 4)`. `toBe`, not
   * `toBeCloseTo` — a rounding error here would move every existing stop bar.
   *
   * The radii are real ones: a 2-lane and a 1-lane arterial pad, and a 2-lane
   * divided junction's floored pad.
   */
  it("returns exactly the radius for a ray from the centre", () => {
    const centre = { x: 0, y: 0 };
    for (const r of [16.02, 10.44, 24, 40.5]) {
      expect(rayCircleExit(centre, { x: 1, y: 0 }, r)).toBe(r);
      expect(rayCircleExit(centre, { x: -1, y: 0 }, r)).toBe(r);
      expect(rayCircleExit(centre, { x: 0.6, y: -0.8 }, r)).toBe(r);
    }
  });

  /**
   * The case that exists for divided approaches: a carriageway 13.5 off the
   * centreline leaves a 24-unit pad sooner than a centred one does, and lands on
   * the pad rim rather than somewhere near it.
   */
  it("lands on the circle from an off-centre start", () => {
    const p = { x: 0, y: 13.5 };
    const d = { x: -1, y: 0 };
    const t = rayCircleExit(p, d, 24);

    expect(t).toBeCloseTo(Math.sqrt(24 * 24 - 13.5 * 13.5));
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(24);
    expect(Math.hypot(p.x + d.x * t, p.y + d.y * t)).toBeCloseTo(24);
  });

  it("returns 0 from a start on or outside the circle, whichever way it points", () => {
    // On the rim.
    expect(rayCircleExit({ x: 24, y: 0 }, { x: 1, y: 0 }, 24)).toBe(0);
    // Outside, heading away — and outside, heading back in, which is the one a
    // "just solve the quadratic" implementation gets wrong by re-entering.
    expect(rayCircleExit({ x: 30, y: 0 }, { x: 1, y: 0 }, 24)).toBe(0);
    expect(rayCircleExit({ x: 30, y: 0 }, { x: -1, y: 0 }, 24)).toBe(0);
  });
});

describe("carriageways", () => {
  /** A link carrying what `completeLink` writes, at `lanes` default lanes. */
  function link(
    id: LinkId,
    from: NodeId,
    to: NodeId,
    lanes = 2,
    median_gap = DEFAULT_MEDIAN_GAP,
  ): Link {
    return { id, from_node: from, to_node: to, lanes: defaults(lanes), median_gap };
  }

  /** A document of just these links: `carriageways` reads nothing else. */
  function net(links: Link[], views: Record<LinkId, LinkView> = {}): Document {
    const base = emptyDocument("carriageways");
    return { ...base, links, layout: { ...base.layout, links: views } };
  }

  /** Where one 2-lane arterial carriageway sits: 21/2 + 6/2. */
  const OFFSET_2 = 13.5;

  it("leaves every road without an opposing twin on its centreline", () => {
    // A lone link; a chain sharing one node; and two links running the *same*
    // way between one pair, which is not a two-way road however it is drawn.
    expect(carriageways(net([link("L1", "N1", "N2")]))).toEqual({ L1: 0 });
    expect(
      carriageways(net([link("L1", "N1", "N2"), link("L2", "N2", "N3")])),
    ).toEqual({ L1: 0, L2: 0 });
    expect(
      carriageways(net([link("L1", "N1", "N2"), link("L2", "N1", "N2")])),
    ).toEqual({ L1: 0, L2: 0 });
  });

  it("steps each half of a reversed pair out by half its width plus half the median", () => {
    const off = carriageways(net([link("L1", "N1", "N2"), link("L2", "N2", "N1")]));

    expect(off.L1).toBe(roadWidth(defaults(2)) / 2 + SCHEMATIC_MEDIAN / 2);
    expect(off.L1).toBe(OFFSET_2);
    expect(off.L2).toBe(off.L1);
  });

  /**
   * Both offsets are **positive**, and an assertion that the two signs differ
   * would be wrong — it fails on a correct implementation, and the obvious fix
   * (negate one twin) puts both carriageways on the same visual side. The offset
   * is the `d` of `offsetPolyline`, measured in each link's own polyline frame;
   * the twin runs the other way, so its normal already points the other way.
   */
  it("returns positive offsets for both halves, not opposite signs", () => {
    const off = carriageways(net([link("L1", "N1", "N2"), link("L2", "N2", "N1")]));

    expect(off.L1).toBeGreaterThan(0);
    expect(off.L2).toBeGreaterThan(0);
  });

  /**
   * The opposition is in the frame, not the sign — so this is the assertion that
   * catches an inverted `DRIVE_SIDE`, which no magnitude test can. SVG's y axis
   * points down, so `+y` is *below* the centreline, which for eastbound travel
   * is its right-hand side: where right-hand traffic belongs.
   */
  it("draws the eastbound half below the centreline and its twin above", () => {
    const off = carriageways(net([link("L1", "N1", "N2"), link("L2", "N2", "N1")]));
    // N1 at the origin, N2 due east: L1 runs east, its twin L2 runs back west.
    const east = offsetPolyline([{ x: 0, y: 0 }, { x: 120, y: 0 }], off.L1);
    const west = offsetPolyline([{ x: 120, y: 0 }, { x: 0, y: 0 }], off.L2);

    expect(DRIVE_SIDE).toBe(1);
    expect(east.map((p) => p.y)).toEqual([OFFSET_2, OFFSET_2]);
    expect(west.map((p) => p.y)).toEqual([-OFFSET_2, -OFFSET_2]);
  });

  /**
   * The step has to clear the road's own width, not just the median: an offset
   * derived from the median alone leaves two 4-lane carriageways sitting almost
   * entirely on top of each other. Unequal lane counts are the case that shows
   * it — the magnitudes differ, and the drawn median does not.
   */
  it("clears each carriageway's own width, whatever its lane count", () => {
    const off = carriageways(net([link("L1", "N1", "N2", 4), link("L2", "N2", "N1", 2)]));

    expect(off.L1).toBeGreaterThan(off.L2);
    // Each one's inner edge, in its own frame; the two face each other.
    const innerA = off.L1 - roadWidth(defaults(4)) / 2;
    const innerB = off.L2 - roadWidth(defaults(2)) / 2;
    expect(innerA).toBe(SCHEMATIC_MEDIAN / 2);
    expect(innerA + innerB).toBe(SCHEMATIC_MEDIAN);
  });

  it("leaves three links on one node pair alone rather than guess a layout", () => {
    const off = carriageways(
      net([link("L1", "N1", "N2"), link("L2", "N2", "N1"), link("L3", "N1", "N2")]),
    );

    expect(off).toEqual({ L1: 0, L2: 0, L3: 0 });
  });

  it("honours a median_gap wider than the schematic minimum, and floors a narrower one", () => {
    const separation = 3 * UNITS_PER_METRE;
    const wide = carriageways(
      net([link("L1", "N1", "N2", 2, 3), link("L2", "N2", "N1", 2, 3)]),
    );

    expect(separation).toBeGreaterThan(SCHEMATIC_MEDIAN);
    expect(wide.L1).toBe(roadWidth(defaults(2)) / 2 + separation / 2);
    // The 0.5 m every link the UI creates carries is ~1.3 units — thinner than
    // the edge line painted over it, so it floors at the schematic median.
    expect(DEFAULT_MEDIAN_GAP * UNITS_PER_METRE).toBeLessThan(SCHEMATIC_MEDIAN);
  });

  it("measures each carriageway at its own road class", () => {
    const links = [link("L1", "N1", "N2"), link("L2", "N2", "N1")];
    const off = carriageways(
      net(links, { L1: { style: "ramp" }, L2: { style: "ramp" } }),
    );
    const w = roadWidth(defaults(2), "ramp");

    expect(off.L1).toBe(w / 2 + SCHEMATIC_MEDIAN / 2);
    // A ramp pair sits closer together because its asphalt is narrower — the
    // median between them is the same 6 units. (`toBeCloseTo`: subtracting the
    // half-width back off a narrowed road is the float round trip the class
    // factor already documents.)
    expect(off.L1).toBeLessThan(OFFSET_2);
    expect(off.L1 - w / 2).toBeCloseTo(SCHEMATIC_MEDIAN / 2);
  });

  it("offsets a bent road along its whole length", () => {
    const bend = { x: 60, y: 20 };
    const off = carriageways(
      net([link("L1", "N1", "N2"), link("L2", "N2", "N1")], {
        L1: { style: DEFAULT_LINK_STYLE, bends: [bend] },
      }),
    );

    // A bend is layout, not topology: still a pair, still the same step.
    expect(off.L1).toBe(OFFSET_2);

    const spine = [{ x: 0, y: 0 }, bend, { x: 120, y: 0 }];
    const drawn = offsetPolyline(spine, off.L1);

    expect(drawn).toHaveLength(spine.length);
    for (let i = 0; i < spine.length; i++) {
      expect(distance(spine[i], drawn[i])).toBeCloseTo(OFFSET_2);
    }
  });
});
