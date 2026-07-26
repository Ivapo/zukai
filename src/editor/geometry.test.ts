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
  LinkAlign,
  LinkId,
  LinkStyle,
  LinkView,
  NodeId,
  Vec2,
} from "../model/types";
import {
  DRIVE_SIDE,
  GORE_LENGTH,
  GoreArm,
  JointEnd,
  LANE_PX,
  MIN_ROAD_WIDTH,
  ROAD_MARGIN,
  SCHEMATIC_MEDIAN,
  TAPER_LENGTH,
  TAPER_MAX_BEND,
  UNITS_PER_METRE,
  alignmentShift,
  carriageways,
  classWidthFactor,
  distance,
  gore,
  gorePair,
  laneBands,
  offsetPolyline,
  rayCircleExit,
  rayIntersection,
  roadWidth,
  taperEdge,
  taperWedge,
  taperWedges,
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

describe("alignmentShift", () => {
  const ALIGNED: LinkAlign[] = ["nearside", "offside"];
  const STYLES: LinkStyle[] = ["motorway", "arterial", "local", "ramp"];

  it("leaves a centred link exactly where it was, whatever it carries", () => {
    for (const style of STYLES) {
      for (let n = 1; n <= 8; n++) {
        expect(alignmentShift(defaults(n), style, "centre")).toBe(0);
      }
    }
    // An empty lane array is one default lane everywhere else, and here too.
    expect(alignmentShift([], DEFAULT_LINK_STYLE, "centre")).toBe(0);
  });

  /**
   * The shift is the **lane region's** half-span, not `roadWidth / 2`:
   * `ROAD_MARGIN` is the casing lip, not a lane, so aligning to an edge means
   * aligning the outermost painted line. The difference is `ROAD_MARGIN / 2` —
   * 1.5 units of casing at every joint, small enough to read as an antialiasing
   * artefact and never be diagnosed, which is why this is asserted exactly.
   */
  it("shifts by the lane region's half-span, not half the road width", () => {
    for (const style of STYLES) {
      for (let n = 1; n <= 8; n++) {
        const lanes = defaults(n);
        const w = roadWidth(lanes, style);
        const half = (w - ROAD_MARGIN) / 2;

        expect(alignmentShift(lanes, style, "offside")).toBe(half);
        expect(half).not.toBe(w / 2);
        expect(w / 2 - half).toBeCloseTo(ROAD_MARGIN / 2);
      }
    }
  });

  /**
   * Lane 0 is the nearside lane at the most *positive* `laneBands` offset, so
   * holding the **offside** edge on the polyline shifts the road **positive**
   * — the road hangs to the nearside of its own polyline. Asserted as a signed
   * value and as an exact negation: a magnitude test passes under an inversion,
   * which is the trap the road spec hit four times.
   */
  it("sends offside positive and nearside its exact negation", () => {
    for (const style of STYLES) {
      for (let n = 1; n <= 8; n++) {
        const lanes = defaults(n);
        const off = alignmentShift(lanes, style, "offside");
        const near = alignmentShift(lanes, style, "nearside");

        expect(off).toBeGreaterThan(0);
        expect(near).toBe(-off);
        // Which is to say: the aligned edge lands on the polyline. Lane 0's own
        // outer boundary is the nearside edge, and the shift cancels it.
        const bands = laneBands(lanes, style);
        const nearsideEdge = bands[0].offset + bands[0].width / 2;
        expect(nearsideEdge + near).toBeCloseTo(0);
        expect(nearsideEdge - off).toBeCloseTo(0);
      }
    }
  });

  /** It is a width, so it carries the road class like every other width. */
  it("shifts a ramp less far than an arterial of the same lane count", () => {
    for (const align of ALIGNED) {
      const arterial = alignmentShift(defaults(4), "arterial", align);
      const ramp = alignmentShift(defaults(4), "ramp", align);

      expect(Math.abs(ramp)).toBeLessThan(Math.abs(arterial));
      expect(Math.abs(ramp)).toBeCloseTo(
        classWidthFactor("ramp") * Math.abs(arterial),
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

describe("tapers", () => {
  /**
   * How a `lanes`-lane link meets a joint at `(120, 0)`, drawn due east —
   * `arriving` for the link that ends there, `!arriving` for the one that
   * starts. Both carry the same nearside, which is what a through joint means.
   */
  function end(
    lanes: number,
    align: LinkAlign,
    arriving: boolean,
    style: LinkStyle = DEFAULT_LINK_STYLE,
  ): JointEnd {
    const ls = defaults(lanes);
    const offset = alignmentShift(ls, style, align);
    return {
      at: { x: 120, y: offset },
      away: arriving ? { x: -1, y: 0 } : { x: 1, y: 0 },
      nearside: { x: 0, y: 1 },
      offset,
      width: roadWidth(ls, style),
    };
  }

  /** The same, for a link leaving the joint `deg` off due east. */
  function bent(lanes: number, deg: number): JointEnd {
    const rad = (deg * Math.PI) / 180;
    const away = { x: Math.cos(rad), y: Math.sin(rad) };
    const ls = defaults(lanes);
    return {
      at: { x: 120, y: 0 },
      away,
      nearside: { x: -away.y, y: away.x },
      offset: 0,
      width: roadWidth(ls),
    };
  }

  it("puts the tip a whole length along the inset link, and returns three corners", () => {
    const corners = taperWedge(
      { x: 0, y: 10 },
      { x: 0, y: 4 },
      { x: 0.6, y: -0.8 },
      TAPER_LENGTH,
    );

    expect(corners).toHaveLength(3);
    expect(corners[2]).toEqual({
      x: 0 + 0.6 * TAPER_LENGTH,
      y: 4 - 0.8 * TAPER_LENGTH,
    });
  });

  /**
   * §1's joint: a 4-lane motorway dropping a lane, both links held on their
   * **offside** edge. The offside offsets then agree exactly, so the outer edge
   * runs straight through and the only wedge is on the nearside — closing over
   * `TAPER_LENGTH` **past** the node, which is how a real lane drop reads.
   *
   * The corners are exact, and the outer one is the **casing** rim at 37.5, not
   * the lane region's edge at 36: a wedge is asphalt, and using the painted edge
   * instead is a silent 1.5-unit error at every joint.
   */
  it("closes a 4-to-3 lane drop past the node, on the nearside only", () => {
    const wedges = taperWedges(
      end(4, "offside", true),
      end(3, "offside", false),
      TAPER_LENGTH,
    );

    expect(wedges).toHaveLength(1);
    expect(wedges[0].corners).toEqual([
      { x: 120, y: 37.5 },
      { x: 120, y: 28.5 },
      { x: 144, y: 28.5 },
    ]);
    // The casing rim, not the 4-lane road's painted nearside edge.
    expect(wedges[0].corners[0].y).toBe(roadWidth(defaults(4)) / 2 + 18);
    expect(wedges[0].corners[0].y).not.toBe(
      alignmentShift(defaults(4), DEFAULT_LINK_STYLE, "offside") * 2,
    );
    // It runs along the downstream link — the narrow one, which leaves the node.
    expect(wedges[0].inset.away).toEqual({ x: 1, y: 0 });
  });

  /**
   * The mirror case, and OQ-1's recorded direction: a lane **addition** opens
   * *before* the node, because the inset link is then the upstream one and the
   * wedge always runs along the inset link. That is what keeps the geometry
   * additive — it only ever paints asphalt into space the narrow link left
   * empty, never erases asphalt a uniform stroke already laid down.
   */
  it("opens a 3-to-4 lane addition before the node", () => {
    const wedges = taperWedges(
      end(3, "offside", true),
      end(4, "offside", false),
      TAPER_LENGTH,
    );

    expect(wedges).toHaveLength(1);
    expect(wedges[0].corners).toEqual([
      { x: 120, y: 37.5 },
      { x: 120, y: 28.5 },
      { x: 96, y: 28.5 },
    ]);
    expect(wedges[0].inset.away).toEqual({ x: -1, y: 0 });
  });

  /**
   * The rule compares **casing-edge offsets**, not lane counts. A 5-lane ramp
   * and a 4-lane arterial draw the same 39 units wide, so a joint between them
   * is not a width step however different the two roads are.
   */
  it("draws nothing where the two casing edges agree, whatever the lane counts", () => {
    const ramp = end(5, "centre", true, "ramp");
    const arterial = end(4, "centre", false);

    expect(ramp.width).toBe(arterial.width);
    expect(taperWedges(ramp, arterial, TAPER_LENGTH)).toEqual([]);
  });

  /**
   * And the comparison is a tolerance, not `===`. A step below a millionth of a
   * world unit is not a lane drop: drawing it would emit a zero-area polygon and
   * butt-cap two roads over a difference no one can see.
   */
  it("treats a step too small to draw as no step at all", () => {
    const a = end(4, "centre", true);
    const b: JointEnd = { ...end(4, "centre", false), offset: 1e-9 };

    expect(b.offset).not.toBe(a.offset);
    expect(taperWedges(a, b, TAPER_LENGTH)).toEqual([]);
  });

  /**
   * Aligning both links to a side is exactly what leaves one wedge. Aligning
   * neither leaves two: a centred pair steps symmetrically, so each side closes
   * half the difference — the honest drawing of an unaligned lane change.
   */
  it("wedges both sides of a centred joint, in mirror image", () => {
    const wedges = taperWedges(
      end(4, "centre", true),
      end(3, "centre", false),
      TAPER_LENGTH,
    );

    expect(wedges).toHaveLength(2);
    const [near, off] = wedges;
    expect(near.corners).toEqual([
      { x: 120, y: 19.5 },
      { x: 120, y: 15 },
      { x: 144, y: 15 },
    ]);
    for (let i = 0; i < 3; i++) {
      expect(off.corners[i].x).toBe(near.corners[i].x);
      expect(off.corners[i].y).toBe(-near.corners[i].y);
    }
    // Both run along the narrow link, which is the same link on either side.
    expect(off.inset).toBe(near.inset);
  });

  /**
   * A taper's premise is one road continuing through a width step, and the two
   * links only share a frame while the joint is straight: `segmentNormals`
   * rotates with the link, so at a corner the "same" edge points a different way
   * for each. Beyond the tolerance a corner stays a corner, however different
   * the two roads are.
   */
  it("refuses a joint bent past TAPER_MAX_BEND, and allows one inside it", () => {
    const arriving = end(4, "centre", true);

    expect(TAPER_MAX_BEND).toBe(8);
    expect(taperWedges(arriving, bent(3, 7), TAPER_LENGTH)).toHaveLength(2);
    expect(taperWedges(arriving, bent(3, 9), TAPER_LENGTH)).toEqual([]);
    // A right-angled corner is the case this exists for.
    expect(taperWedges(arriving, bent(3, 90), TAPER_LENGTH)).toEqual([]);
    expect(taperWedges(arriving, bent(4, 90), TAPER_LENGTH)).toEqual([]);
  });

  /** A zero-length link has no direction to be collinear with. */
  it("refuses a degenerate end rather than dividing by its length", () => {
    const dead: JointEnd = { ...end(3, "centre", false), away: { x: 0, y: 0 } };

    expect(taperWedges(end(4, "centre", true), dead, TAPER_LENGTH)).toEqual([]);
  });

  describe("taperEdge", () => {
    const corners = taperWedges(
      end(4, "offside", true),
      end(3, "offside", false),
      TAPER_LENGTH,
    )[0].corners;
    const [outer, inset, tip] = corners;

    /** Signed distance of `p` from the hypotenuse, positive toward `inset`. */
    function fromHypotenuse(p: { x: number; y: number }): number {
      const len = distance(outer, tip);
      const nx = -(tip.y - outer.y) / len;
      const ny = (tip.x - outer.x) / len;
      const side = Math.sign((inset.x - outer.x) * nx + (inset.y - outer.y) * ny);
      return side * ((p.x - outer.x) * nx + (p.y - outer.y) * ny);
    }

    /**
     * The wedge's own edge line mirrors `RoadShape`'s `edgeInset = w / 2 - 1.5`:
     * parallel to the hypotenuse, 1.5 inside the asphalt. Inside, not outside —
     * a line painted on the far side of the casing rim is painted on the paper.
     */
    it("runs parallel to the hypotenuse, exactly 1.5 inside the asphalt", () => {
      const [e0, e1] = taperEdge(corners, 1.5);

      expect(fromHypotenuse(e0)).toBeCloseTo(1.5);
      expect(fromHypotenuse(e1)).toBeCloseTo(1.5);
      // Parallel: the shifted segment is the same vector as the hypotenuse.
      expect(e1.x - e0.x).toBeCloseTo(tip.x - outer.x);
      expect(e1.y - e0.y).toBeCloseTo(tip.y - outer.y);
    });

    it("leaves a degenerate wedge's hypotenuse where it is", () => {
      const flat: [typeof outer, typeof outer, typeof outer] = [
        { x: 10, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 10 },
      ];

      expect(taperEdge(flat, 1.5)).toEqual([flat[0], flat[2]]);
    });
  });
});

describe("gores", () => {
  /** Half the lane region of a 4-lane arterial: the mainline in §1's exit. */
  const H4 = (roadWidth(defaults(4)) - ROAD_MARGIN) / 2;

  /** An arm leaving the node at `deg` off due east, from `at` (the node itself
   *  unless a divided carriageway has stepped it off). */
  function arm(
    id: LinkId,
    deg: number,
    halfSpan = H4,
    at = { x: 0, y: 0 },
  ): GoreArm {
    const rad = (deg * Math.PI) / 180;
    return { id, at, away: { x: Math.cos(rad), y: Math.sin(rad) }, halfSpan };
  }

  /** Every component of every corner, for the finiteness checks. */
  function components(tri: [Vec2, Vec2, Vec2]): number[] {
    return tri.flatMap((p) => [p.x, p.y]);
  }

  it("pins GORE_LENGTH at half again a taper's", () => {
    expect(GORE_LENGTH).toBe(36);
    expect(GORE_LENGTH).toBeGreaterThan(TAPER_LENGTH);
  });

  /**
   * The nose of two symmetric diverging arms lands on their axis of symmetry —
   * an assertion the maths can be checked against rather than a literal: two
   * inner edges each `h` off a shared origin, splayed by `deg` either side of
   * due east, meet at `x = h / sin deg` on `y = 0`.
   *
   * Asserted as that expression, not as 69.55, so a change to the lane widths
   * cannot quietly make the test agree with a wrong implementation.
   */
  it("puts the nose of two symmetric arms on their axis of symmetry", () => {
    const deg = 15;
    const [nose] = gore(arm("L1", deg), arm("L2", -deg), { x: 0, y: 0 }, GORE_LENGTH);

    expect(nose.y).toBeCloseTo(0);
    expect(nose.x).toBeCloseTo(H4 / Math.sin((deg * Math.PI) / 180));
    // Downstream of the node, which is what makes it a diverge's nose.
    expect(nose.x).toBeGreaterThan(0);
  });

  /** The triangle is the nose plus a whole `length` along each arm — so each leg
   *  stays on the edge line the nose was found on. */
  it("runs a whole length along each arm from the nose", () => {
    const a = arm("L1", 15);
    const b = arm("L2", -15);
    const [nose, fa, fb] = gore(a, b, { x: 0, y: 0 }, GORE_LENGTH);

    expect(distance(nose, fa)).toBeCloseTo(GORE_LENGTH);
    expect(distance(nose, fb)).toBeCloseTo(GORE_LENGTH);
    expect(fa).toEqual({
      x: nose.x + a.away.x * GORE_LENGTH,
      y: nose.y + a.away.y * GORE_LENGTH,
    });
  });

  /**
   * Parallel arms have no nose. The failure this pins is not "the wrong point"
   * but `Infinity`/`NaN` reaching the markup, where it renders as nothing at all
   * and no `points=` assertion catches it (§2.5's degenerate case).
   */
  it("falls back to the node for parallel arms rather than dividing by zero", () => {
    const node = { x: 7, y: -3 };
    const pairs: [GoreArm, GoreArm][] = [
      // Side by side, same way — the two carriageways of nothing in particular.
      [arm("L1", 0, H4, { x: 7, y: 10 }), arm("L2", 0, H4, { x: 7, y: -16 })],
      // Anti-parallel: a divided road's own pair, if a human puts a gore on it.
      [arm("L1", 0), arm("L2", 180)],
    ];

    for (const [a, b] of pairs) {
      const tri = gore(a, b, node, GORE_LENGTH);
      expect(tri[0]).toEqual(node);
      for (const c of components(tri)) expect(Number.isFinite(c)).toBe(true);
    }
  });

  /**
   * Arms already apart and splaying further meet only *behind* both origins, so
   * there is no nose ahead of them either. `rayIntersection` says so directly;
   * `gore` turns that into the node.
   */
  it("falls back when the two edges meet only behind both origins", () => {
    const a = arm("L1", 15, H4, { x: 0, y: 40 });
    const b = arm("L2", -15, H4, { x: 0, y: -40 });
    const node = { x: 0, y: 0 };

    expect(gore(a, b, node, GORE_LENGTH)[0]).toEqual(node);
  });

  /**
   * "Behind **both**" is the rule, and the distinction is load-bearing: the same
   * crossing point is rejected when neither ray reaches it and kept when one
   * does. Rejecting on "behind either" would drop a perfectly good nose whenever
   * a divided carriageway steps one arm past it.
   */
  it("rejects a crossing behind both origins and keeps one behind only one", () => {
    const p = { x: 0, y: 0 };
    const q = { x: -10, y: -10 };

    // Both rays point away from (-10, 0): nothing to draw.
    expect(rayIntersection(p, { x: 1, y: 0 }, q, { x: 0, y: -1 })).toBeUndefined();
    // The second ray runs through it, so it is still where the two edges meet.
    expect(rayIntersection(p, { x: 1, y: 0 }, q, { x: 0, y: 1 })).toEqual({
      x: -10,
      y: 0,
    });
  });

  /**
   * The arm pair, from the same three-arm layout read both ways. An `Arm` points
   * away from the node whichever way its traffic runs, so the rule never asks:
   * at a diverge the ramp leaves downstream and pairs with the *downstream*
   * mainline arm; at a merge it arrives from upstream and pairs with the
   * *upstream* one. 30° apart against 150° and 180°.
   */
  it("picks the diverging pair at a diverge and the converging pair at a merge", () => {
    const downstream = arm("L2", 0);
    const upstream = arm("L1", 180);

    const diverge = gorePair([upstream, downstream, arm("L3", 30)])!;
    expect(diverge.map((a) => a.id).sort()).toEqual(["L2", "L3"]);

    const merge = gorePair([upstream, downstream, arm("L3", 150)])!;
    expect(merge.map((a) => a.id).sort()).toEqual(["L1", "L3"]);
  });

  it("draws nothing from fewer than two arms", () => {
    expect(gorePair([])).toBeUndefined();
    expect(gorePair([arm("L1", 0)])).toBeUndefined();
  });

  /**
   * A T of three arms at exact right angles ties two of its three pairs at
   * exactly 0, and the winner is then whatever the tie-break says. It must be
   * the ids and not the array order, or re-drawing the same three roads in a
   * different document order moves the gore. (Written with literal directions
   * rather than `arm(…, deg)`: `Math.cos(Math.PI / 2)` is 6.1e-17, not 0, so a
   * degrees-based fixture would not tie at all and would test nothing.)
   */
  it("breaks an exact tie on link id, not on arm order", () => {
    const at = { x: 0, y: 0 };
    const arms: GoreArm[] = [
      { id: "L2", at, away: { x: 1, y: 0 }, halfSpan: H4 },
      { id: "L3", at, away: { x: 0, y: 1 }, halfSpan: H4 },
      { id: "L1", at, away: { x: 0, y: -1 }, halfSpan: H4 },
    ];

    for (const order of [arms, [...arms].reverse()]) {
      expect(gorePair(order)!.map((a) => a.id).sort()).toEqual(["L1", "L2"]);
    }
  });

  /**
   * The gore is bounded by the roads' **painted** edges, not their casing rims —
   * the opposite of a taper wedge, which is asphalt and takes `width / 2`. The
   * two differ by half the casing lip, which is exactly `RoadShape`'s own
   * `edgeInset`, so the gore's legs continue the edge lines either side of it.
   */
  it("measures its arms at the painted edge, not the casing rim", () => {
    const w = roadWidth(defaults(4));
    const casing = gore(arm("L1", 15, w / 2), arm("L2", -15, w / 2), { x: 0, y: 0 }, GORE_LENGTH);
    const painted = gore(arm("L1", 15), arm("L2", -15), { x: 0, y: 0 }, GORE_LENGTH);

    expect(H4).toBe(w / 2 - 1.5);
    expect(painted[0].x).toBeLessThan(casing[0].x);
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
