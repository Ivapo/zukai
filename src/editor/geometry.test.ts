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
  LaneIdx,
  Link,
  LinkAlign,
  LinkId,
  LineStyle,
  LinkStyle,
  LinkView,
  Marking,
  NodeId,
  SignKind,
  TurnDirection,
  Vec2,
} from "../model/types";
import {
  ADVANCE,
  BASELINE_DROP,
  CAP_HEIGHT,
  CROSSWALK_DEPTH,
  DRIVE_SIDE,
  GIVE_WAY_DEPTH,
  GORE_LENGTH,
  GoreArm,
  JointEnd,
  LANE_LINE_GAP,
  LANE_PX,
  MARKING_PITCH,
  MIN_ROAD_WIDTH,
  MarkingAnchor,
  MovementArc,
  MovementEnd,
  PLATE_PAD,
  ROAD_MARGIN,
  SCHEMATIC_MEDIAN,
  SIGN_RING,
  SIGN_SIZE,
  TAPER_LENGTH,
  TAPER_MAX_BEND,
  TEXT_SIZE,
  TURN_ARROW_LENGTH,
  TurnArrow,
  UNITS_PER_METRE,
  alignmentShift,
  bandAt,
  boundaryAt,
  boundaryTaken,
  carriageways,
  classWidthFactor,
  derivableMovements,
  distance,
  drawnPolyline,
  gore,
  gorePair,
  laneBands,
  laneLine,
  laneLineOffsets,
  legalMovements,
  markingArrow,
  markingTeeth,
  markingText,
  markingZebra,
  movementArc,
  movementId,
  movementKind,
  movementPath,
  nearestOnPolyline,
  offsetPolyline,
  pointAlongPolyline,
  polygonsPath,
  polylinesPath,
  rayCircleExit,
  rayIntersection,
  roadWidth,
  signBox,
  signNoEntry,
  signOctagon,
  signPlate,
  signPlateLabel,
  signPriority,
  signRoundel,
  signTriangle,
  taperEdge,
  taperWedge,
  taperWedges,
  textWidth,
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

/**
 * The lateral half of a click on a road (lane arrows Phase 1). Every case here
 * uses **unequal lane widths**, because a uniform road cannot tell the two
 * indexes apart: with equal lanes a band's centre and a boundary sit at tidy
 * multiples of the same pitch, and an implementation that confused one for the
 * other would still land plausibly.
 */
describe("bandAt and boundaryAt", () => {
  // Bands at +13.5 / 0 / -13.5 (widths 9 / 18 / 9), so the two boundaries are
  // at +9 and -9 — neither of which is any band's centre.
  const bands = laneBands(widths(3.5, 7, 3.5));

  it("names the band a lateral offset falls in", () => {
    expect(bandAt(bands, 13.5)).toBe(0);
    expect(bandAt(bands, 0)).toBe(1);
    expect(bandAt(bands, -13.5)).toBe(2);
    // Anywhere inside a band, not only its centre.
    expect(bandAt(bands, 8.5)).toBe(1);
  });

  it("names no band beyond the lane region — the casing lip is carriageway-wide", () => {
    // The road's lane region ends at ±18; the hit path is fatter than that.
    expect(bandAt(bands, 19)).toBeUndefined();
    expect(bandAt(bands, -25)).toBeUndefined();
  });

  /**
   * **The assertion the helper exists for.** A road with `n` lanes has `n-1`
   * boundaries, so a band index can be `n-1` and a boundary index cannot: that
   * value makes `boundaryOffset` return `undefined`, `laneLine` draw nothing, and
   * a dragged lane line vanish mid-gesture — invisible and unselectable.
   */
  it("never names the band index a lane line cannot be drawn at", () => {
    for (let offset = -30; offset <= 30; offset += 0.25) {
      const boundary = boundaryAt(bands, offset);
      expect(boundary).not.toBeUndefined();
      expect(boundary).toBeLessThan(bands.length - 1);
    }
    // Concretely: deep in the offside lane, `bandAt` says 2 and `boundaryAt`
    // says 1 — the outermost boundary there actually is.
    expect(bandAt(bands, -13.5)).toBe(2);
    expect(boundaryAt(bands, -13.5)).toBe(1);
  });

  it("picks the nearest boundary, not the containing anything", () => {
    // Boundaries are lines, so every offset has an answer and the midpoint
    // between two is the only place the choice is arbitrary.
    expect(boundaryAt(bands, 9)).toBe(0);
    expect(boundaryAt(bands, -9)).toBe(1);
    expect(boundaryAt(bands, 4)).toBe(0);
    expect(boundaryAt(bands, -4)).toBe(1);
    // Far outside the road on the nearside still reads as the nearside boundary.
    expect(boundaryAt(bands, 100)).toBe(0);
  });

  /**
   * A single-lane road has no boundary to name, and `undefined` is exactly right:
   * `boundaryOffset` reads it as offset 0, the centreline — the only place such a
   * line can go, and what the Span control calls it.
   */
  it("has no boundary to offer on a one-lane road", () => {
    expect(boundaryAt(laneBands(defaults(1)), 3)).toBeUndefined();
    // Two lanes have exactly one, and every click resolves to it.
    const two = laneBands(widths(3.5, 7));
    expect(boundaryAt(two, 10)).toBe(0);
    expect(boundaryAt(two, -10)).toBe(0);
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

describe("nearestOnPolyline", () => {
  /** A road drawn due east from the origin — offsets read straight off `y`. */
  const east: Vec2[] = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
  ];

  it("returns the exact arc-length of the nearest point", () => {
    expect(nearestOnPolyline(east, { x: 40, y: 0 })).toEqual({
      along: 40,
      offset: 0,
    });
    // Off the road: the projection is what counts, not the distance to it.
    expect(nearestOnPolyline(east, { x: 40, y: 30 }).along).toBe(40);
  });

  /**
   * **The offset is signed, and the sign is the whole of which lane was
   * clicked.** A magnitude assertion passes under an inversion — the trap the
   * road spec hit four times — so this pins it against `offsetPolyline`, whose
   * `d` is the same number: a point on `offsetPolyline(pts, +5)` must measure
   * back as `+5`, not as `5` in whichever direction.
   */
  it("signs the offset the way offsetPolyline does", () => {
    for (const d of [5, -5, 13.5]) {
      const shifted = offsetPolyline(east, d);
      const mid = { x: (shifted[0].x + shifted[1].x) / 2, y: (shifted[0].y + shifted[1].y) / 2 };
      expect(nearestOnPolyline(east, mid).offset).toBeCloseTo(d);
    }
    // Concretely, in SVG's y-down frame: positive is *below* an eastbound road,
    // which is the nearside under right-hand traffic — where `laneBands` puts
    // lane 0.
    expect(nearestOnPolyline(east, { x: 60, y: 9 }).offset).toBe(9);
    expect(nearestOnPolyline(east, { x: 60, y: -9 }).offset).toBe(-9);
    expect(laneBands(defaults(3))[0].offset).toBe(9);
  });

  it("lands a point past either end on that end", () => {
    expect(nearestOnPolyline(east, { x: -40, y: 0 }).along).toBe(0);
    expect(nearestOnPolyline(east, { x: 400, y: 0 }).along).toBe(120);
    // …and the offset there is measured from the end point, not extrapolated.
    expect(nearestOnPolyline(east, { x: -40, y: 7 }).offset).toBe(7);
  });

  it("keeps the arc-length across a bend, in the bent segment's own frame", () => {
    const bent: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    // 100 along the first leg, then 40 down the second.
    const hit = nearestOnPolyline(bent, { x: 95, y: 40 });

    expect(hit.along).toBe(140);
    // The second leg runs due south, whose normal points west — so a point 5
    // units west of it is at `+5`, the same sign `offsetPolyline` would give.
    expect(hit.offset).toBe(5);
    expect(offsetPolyline(bent, 5)[2]).toEqual({ x: 95, y: 100 });
  });

  it("floors on a polyline with no length rather than dividing by it", () => {
    expect(nearestOnPolyline([], { x: 5, y: 5 })).toEqual({ along: 0, offset: 0 });
    expect(nearestOnPolyline([{ x: 0, y: 0 }], { x: 5, y: 5 })).toEqual({
      along: 0,
      offset: 0,
    });
    expect(
      nearestOnPolyline([{ x: 3, y: 3 }, { x: 3, y: 3 }], { x: 5, y: 5 }),
    ).toEqual({ along: 0, offset: 0 });
  });
});

describe("pointAlongPolyline", () => {
  const bent: Vec2[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it("round-trips against nearestOnPolyline on a bent polyline", () => {
    for (const p of [
      { x: 30, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 55 },
      { x: 95, y: 40 },
    ]) {
      const { along } = nearestOnPolyline(bent, p);
      const back = pointAlongPolyline(bent, along)!;

      expect(nearestOnPolyline(bent, back.at).along).toBeCloseTo(along);
      // A unit direction, always — the frame every marking is drawn in.
      expect(Math.hypot(back.dir.x, back.dir.y)).toBeCloseTo(1);
    }
  });

  it("takes the direction of the segment it lands on", () => {
    expect(pointAlongPolyline(bent, 40)).toEqual({
      at: { x: 40, y: 0 },
      dir: { x: 1, y: 0 },
    });
    expect(pointAlongPolyline(bent, 140)).toEqual({
      at: { x: 100, y: 40 },
      dir: { x: 0, y: 1 },
    });
  });

  /**
   * **The clamp is what keeps a marking on a road the user has shortened.**
   * `Marking.position` is absolute metres, so dragging a node can leave a
   * marking's distance past the drawn end; it sits at the end rather than off it
   * (markings spec §2.2).
   */
  it("clamps past either end instead of running off the polyline", () => {
    expect(pointAlongPolyline(bent, -40)!.at).toEqual({ x: 0, y: 0 });
    expect(pointAlongPolyline(bent, 1000)!.at).toEqual({ x: 100, y: 100 });
    expect(pointAlongPolyline(bent, 200)!.at).toEqual({ x: 100, y: 100 });
  });

  it("gives nothing for a polyline with no length to walk", () => {
    expect(pointAlongPolyline([], 10)).toBeUndefined();
    expect(pointAlongPolyline([{ x: 0, y: 0 }], 10)).toBeUndefined();
    expect(
      pointAlongPolyline([{ x: 4, y: 4 }, { x: 4, y: 4 }], 10),
    ).toBeUndefined();
  });
});

/**
 * The one site that knows the two lateral terms compose by addition — moved here
 * from `Diagram.tsx` so the marking tool can place a marking on the polyline the
 * road is *actually drawn along* rather than derive it a second time (markings
 * spec §2.4).
 */
describe("drawnPolyline", () => {
  /** A two-way pair `N1 ⇄ N2` 120 units apart, `L1` carrying `lanes` lanes. */
  function twoWay(lanes: number, views: Record<LinkId, LinkView> = {}): Document {
    const base = emptyDocument("drawn");
    return {
      ...base,
      nodes: [
        { id: "N1", type: "endpoint" },
        { id: "N2", type: "endpoint" },
      ],
      links: [
        { id: "L1", from_node: "N1", to_node: "N2", lanes: defaults(lanes), median_gap: DEFAULT_MEDIAN_GAP },
        { id: "L2", from_node: "N2", to_node: "N1", lanes: defaults(2), median_gap: DEFAULT_MEDIAN_GAP },
      ],
      layout: {
        ...base.layout,
        nodes: { N1: { pos: { x: 0, y: 0 } }, N2: { pos: { x: 120, y: 0 } } },
        links: views,
      },
    };
  }

  it("returns the layout polyline itself when neither term applies", () => {
    const base = emptyDocument("plain");
    const doc: Document = {
      ...base,
      nodes: [
        { id: "N1", type: "endpoint" },
        { id: "N2", type: "endpoint" },
      ],
      links: [
        { id: "L1", from_node: "N1", to_node: "N2", lanes: defaults(2), median_gap: DEFAULT_MEDIAN_GAP },
      ],
      layout: {
        ...base.layout,
        nodes: { N1: { pos: { x: 0, y: 0 } }, N2: { pos: { x: 120, y: 0 } } },
      },
    };

    expect(drawnPolyline(doc, doc.links[0], carriageways(doc))).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ]);
  });

  /**
   * The assertion this describe exists for: both terms, added, on one link. A
   * test of either alone passes while the other is silently dropped.
   */
  it("adds the carriageway offset and the alignment shift, on one link", () => {
    const doc = twoWay(3, { L1: { style: DEFAULT_LINK_STYLE, align: "offside" } });
    const offsets = carriageways(doc);
    const drawn = drawnPolyline(doc, doc.links[0], offsets)!;

    const carriageway = roadWidth(defaults(3)) / 2 + SCHEMATIC_MEDIAN / 2;
    const shift = alignmentShift(defaults(3), DEFAULT_LINK_STYLE, "offside");

    expect(offsets.L1).toBe(carriageway);
    expect(shift).toBe((roadWidth(defaults(3)) - ROAD_MARGIN) / 2);
    // Due east, so the whole lateral sum reads off `y` — and it is the *sum*,
    // not either term.
    expect(drawn.map((p) => p.y)).toEqual([carriageway + shift, carriageway + shift]);
    expect(drawn[0].y).toBeGreaterThan(carriageway);
  });

  it("gives nothing for a link whose endpoints have no position", () => {
    const base = emptyDocument("homeless");
    const doc: Document = {
      ...base,
      links: [
        { id: "L1", from_node: "N1", to_node: "N2", lanes: defaults(2), median_gap: DEFAULT_MEDIAN_GAP },
      ],
    };

    expect(drawnPolyline(doc, doc.links[0], carriageways(doc))).toBeUndefined();
  });
});

/**
 * The two tiled kinds (markings spec Phase 2). Every anchor below points **due
 * east**, so the frame reads straight off the coordinates: `y` is the lateral
 * offset across the road — the one `laneBands` and `offsetPolyline` share — and
 * `x` is the distance along it, positive downstream.
 */
describe("markingTeeth and markingZebra", () => {
  function anchor(offset: number, width: number): MarkingAnchor {
    return { at: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, span: { offset, width } };
  }

  /** The whole lane region of `n` default lanes — a carriageway-wide marking. */
  function carriageway(n: number, style: LinkStyle = DEFAULT_LINK_STYLE) {
    const bands = laneBands(defaults(n), style);
    return anchor(
      0,
      bands.reduce((s, b) => s + b.width, 0),
    );
  }

  /** Each shape's lateral centre, in span order. */
  function centres(shapes: Vec2[][]): number[] {
    return shapes.map(
      (s) => (Math.min(...s.map((p) => p.y)) + Math.max(...s.map((p) => p.y))) / 2,
    );
  }

  /**
   * The count is derived from the span so the cells tile it *exactly* — which is
   * why no kind below needs a clamp, and why a stripe cannot end up on the verge.
   */
  it("divides a span into whole cells of roughly the marking pitch", () => {
    // 3 default lanes is 27 units, exactly nine cells of the 3-unit pitch.
    const wide = centres(markingTeeth(carriageway(3)));
    expect(wide).toHaveLength(9);
    expect(wide[1] - wide[0]).toBeCloseTo(MARKING_PITCH);
    expect(wide[0]).toBeCloseTo(-13.5 + MARKING_PITCH / 2);

    // One lane is 9 units: three cells, and the row is symmetric about it.
    const one = centres(markingTeeth(anchor(0, LANE_PX)));
    expect(one).toHaveLength(3);
    expect(one[1] - one[0]).toBeCloseTo(MARKING_PITCH);
    expect(one[1]).toBeCloseTo(0);

    // A narrow band still gets one whole cell rather than none.
    expect(markingTeeth(anchor(0, 2))).toHaveLength(1);

    // And the pitch is the span's, not the constant's, wherever the two differ:
    // a 1-lane ramp is 7.2 units, which is two and two fifths of a nominal cell.
    const ramp = centres(markingZebra(anchor(0, 7.2)));
    expect(ramp).toHaveLength(2);
    expect(ramp[1] - ramp[0]).toBeCloseTo(3.6);
  });

  /**
   * **The teeth point upstream, at the driver**, who arrives from behind the
   * marking. Drawn the other way round they read as arrowheads telling traffic to
   * keep going — and no assertion on a magnitude or a count would see it.
   */
  it("points every give-way tooth back at the driver", () => {
    for (const [apex, ...base] of markingTeeth(carriageway(3))) {
      expect(apex.x).toBeCloseTo(-GIVE_WAY_DEPTH / 2);
      expect(base.map((p) => p.x)).toEqual([GIVE_WAY_DEPTH / 2, GIVE_WAY_DEPTH / 2]);
      expect(apex.x).toBeLessThan(base[0].x);
      // The apex is centred on its own cell, between the two base corners.
      expect(apex.y).toBeCloseTo((base[0].y + base[1].y) / 2);
    }
  });

  /** A zebra's stripes run **along** the road, over a depth of its own. */
  it("runs the zebra's stripes along the road, centred on the position", () => {
    const stripes = markingZebra(carriageway(3));
    expect(stripes).toHaveLength(9);

    for (const stripe of stripes) {
      const xs = stripe.map((p) => p.x);
      expect(Math.min(...xs)).toBeCloseTo(-CROSSWALK_DEPTH / 2);
      expect(Math.max(...xs)).toBeCloseTo(CROSSWALK_DEPTH / 2);
      // Longer along the road than it is wide across it — the whole of what
      // distinguishes a crossing from the transverse kinds at a glance.
      const ys = stripe.map((p) => p.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(CROSSWALK_DEPTH);
    }
  });

  /**
   * The failure this rules out is a stripe on the verge. Containment is a
   * property of the tiling rather than a clamp, so it has to hold at every lane
   * count *and* every road class — `ramp` narrows each lane to 0.8, which is
   * where a pitch computed from a nominal lane width would spill.
   */
  it("keeps every point inside the span, at every lane count and class", () => {
    const styles: LinkStyle[] = ["motorway", "arterial", "local", "ramp"];
    for (const style of styles) {
      for (let n = 1; n <= 8; n++) {
        const spans = [
          ...laneBands(defaults(n), style),
          carriageway(n, style).span,
        ];
        for (const span of spans) {
          const lo = span.offset - span.width / 2;
          const hi = span.offset + span.width / 2;
          for (const shape of [
            ...markingTeeth(anchor(span.offset, span.width)),
            ...markingZebra(anchor(span.offset, span.width)),
          ]) {
            for (const p of shape) {
              expect(p.y).toBeGreaterThan(lo);
              expect(p.y).toBeLessThan(hi);
            }
          }
        }
      }
    }
  });

  /**
   * The sign trap the road spec burned four review rounds on: lane 0 is the
   * nearside lane at the most **positive** offset, so paint on an offside lane
   * must land wholly negative. A containment test alone passes under an
   * inversion, since both bands are the same width.
   */
  it("paints an offside lane on the offside", () => {
    const offside = laneBands(defaults(3))[2];
    expect(offside.offset).toBeLessThan(0);

    for (const shape of [
      ...markingTeeth(anchor(offside.offset, offside.width)),
      ...markingZebra(anchor(offside.offset, offside.width)),
    ]) {
      for (const p of shape) expect(p.y).toBeLessThan(0);
    }
  });

  it("closes every polygon, so many pieces are one path", () => {
    expect(
      polygonsPath([
        [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
        [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }],
      ]),
    ).toBe("M 0 0 L 1 0 L 1 1 Z M 2 2 L 3 2 L 3 3 Z");
  });

  it("leaves open polylines open, so a hook is not filled across its chord", () => {
    expect(
      polylinesPath([
        [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        [{ x: 2, y: 2 }, { x: 3, y: 2 }],
      ]),
    ).toBe("M 0 0 L 1 0 M 2 2 L 3 2");
  });
});

/**
 * Turn arrows (markings spec Phase 3). Same due-east frame as the tiled kinds
 * above: `y` is the lateral offset across the road, positive to the **right** of
 * travel, and `x` is the distance along it, positive downstream.
 */
describe("markingArrow", () => {
  const ALL: TurnDirection[] = [
    "through",
    "left",
    "right",
    "slight_left",
    "slight_right",
    "u_turn",
  ];

  function anchor(offset: number, width: number): MarkingAnchor {
    return { at: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, span: { offset, width } };
  }

  /** Every point the arrow is drawn from. */
  function points(a: TurnArrow): Vec2[] {
    return [...a.shaft, ...a.branches.flatMap((b) => [...b.stem, ...b.head])];
  }

  /**
   * How far a head points from `expected`, in degrees, the short way round — so
   * the ±180° a `u_turn` lands on either side of does not read as a 360° miss.
   */
  function offBy(head: [Vec2, Vec2, Vec2], expected: number): number {
    const [apex, b1, b2] = head;
    const deg =
      (Math.atan2(apex.y - (b1.y + b2.y) / 2, apex.x - (b1.x + b2.x) / 2) * 180) /
      Math.PI;
    return Math.abs((((deg - expected) % 360) + 540) % 360 - 180);
  }

  it("draws a lone through arrow symmetric about its lane's centre", () => {
    const a = markingArrow(anchor(0, LANE_PX), ["through"])!;
    const [branch] = a.branches;
    const [apex, b1, b2] = branch.head;

    expect(a.shaft.map((p) => p.y)).toEqual([0, 0]);
    expect(branch.stem.map((p) => p.y)).toEqual([0, 0]);
    expect(apex.y).toBeCloseTo(0);
    expect(b1.y).toBeCloseTo(-b2.y);
    // A head with width, not a point: the mirror above passes either way.
    expect(Math.abs(b1.y)).toBeGreaterThan(1);

    // The arrow's own footprint, tail to apex.
    expect(a.shaft[0].x).toBeCloseTo(-TURN_ARROW_LENGTH / 2);
    expect(apex.x).toBeCloseTo(TURN_ARROW_LENGTH / 2);
  });

  /**
   * A shared through/right lane is **one arrow with two branches**, not two
   * arrows — which is the whole of why a branch leaves the shaft's far end rather
   * than carrying a shaft of its own.
   */
  it("gives a multi-direction arrow one shaft", () => {
    const a = markingArrow(anchor(0, LANE_PX), ["through", "right"])!;

    expect(a.branches).toHaveLength(2);
    for (const b of a.branches) expect(b.stem[0]).toEqual(a.shaft[1]);
  });

  it("points each direction's head at its tabulated bearing", () => {
    const bearings: [TurnDirection, number][] = [
      ["through", 0],
      ["slight_left", -30],
      ["slight_right", 30],
      ["left", -90],
      ["right", 90],
      ["u_turn", 180],
    ];

    for (const [direction, degrees] of bearings) {
      const a = markingArrow(anchor(0, LANE_PX), [direction])!;
      expect(offBy(a.branches[0].head, degrees)).toBeLessThan(1);
    }
  });

  /**
   * The failure this rules out is paint on the verge, and `ARROW_REACH` alone is
   * what rules it out — which is why it has to hold for every direction at every
   * lane count and class, `ramp` at 0.8 being the narrowest lane drawn.
   *
   * The stems are **stroked** and the heads **filled**, so paint reaches half a
   * stroke past a stem point and exactly to a head point. Both are checked, since
   * a single tolerance would let the tighter of the two slide.
   */
  it("keeps every branch inside the band, at every lane count and class", () => {
    for (const style of ["motorway", "arterial", "local", "ramp"] as LinkStyle[]) {
      for (let n = 1; n <= 8; n++) {
        for (const band of laneBands(defaults(n), style)) {
          const a = markingArrow(anchor(band.offset, band.width), ALL)!;
          const lo = band.offset - band.width / 2;
          const hi = band.offset + band.width / 2;

          for (const p of [...a.shaft, ...a.branches.flatMap((b) => b.stem)]) {
            expect(p.y - a.stroke / 2).toBeGreaterThan(lo);
            expect(p.y + a.stroke / 2).toBeLessThan(hi);
          }
          for (const p of a.branches.flatMap((b) => b.head)) {
            expect(p.y).toBeGreaterThan(lo);
            expect(p.y).toBeLessThan(hi);
          }
        }
      }
    }
  });

  /**
   * "Does not degenerate", made concrete. A U-turn is the one direction that
   * cannot be a stub, and it hooks **left** — the U-turn side under the
   * right-hand traffic `laneBands` already assumes.
   */
  it("hooks the u-turn back at the driver, on the left of the shaft", () => {
    const a = markingArrow(anchor(0, LANE_PX), ["u_turn"])!;
    const [hook] = a.branches;
    const fork = a.shaft[1];

    expect(offBy(hook.head, 180)).toBeLessThan(1);
    // It leaves the shaft and turns away to the left, never to the right.
    expect(hook.stem[0]).toEqual(fork);
    expect(Math.min(...hook.stem.map((p) => p.y))).toBeLessThan(-1);
    expect(Math.max(...hook.stem.map((p) => p.y))).toBeCloseTo(0);
    // And it turns: downstream of the fork on the way round, upstream of it by
    // the time the head lands.
    expect(Math.max(...hook.stem.map((p) => p.x))).toBeGreaterThan(fork.x);
    expect(hook.head[0].x).toBeLessThan(fork.x);
  });

  /**
   * The shaft is the arrow's anchor: repainting the directions must not slide it
   * along the road, and no branch may reach past the footprint the shaft sets.
   */
  it("holds the shaft still, and inside the footprint, whatever the directions", () => {
    const through = markingArrow(anchor(0, LANE_PX), ["through"])!;

    for (const directions of [["left"], ["u_turn"], ALL] as TurnDirection[][]) {
      const a = markingArrow(anchor(0, LANE_PX), directions)!;

      expect(a.shaft).toEqual(through.shaft);
      for (const p of points(a)) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(TURN_ARROW_LENGTH / 2 + 1e-9);
      }
    }
  });

  /**
   * A bare shaft reads as a lane line, so an arrow with nothing to point at draws
   * nothing and the caller falls back to the placeholder bar. Only a hand-edited
   * document gets here: the Inspector will not unset the last direction.
   */
  it("draws no arrow for a marking with no direction it can paint", () => {
    expect(markingArrow(anchor(0, LANE_PX), [])).toBeUndefined();
    expect(
      markingArrow(anchor(0, LANE_PX), ["sideways" as TurnDirection]),
    ).toBeUndefined();

    // A direction the model does not name is skipped, not drawn as `NaN`.
    const mixed = markingArrow(anchor(0, LANE_PX), [
      "sideways" as TurnDirection,
      "left",
    ])!;
    expect(mixed.branches).toHaveLength(1);
    for (const p of points(mixed)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
});

/**
 * Painted road text (signs spec Phase 1) — the one kind drawn at an angle, so
 * this is the first describe here that leaves the due-east frame.
 */
describe("textWidth and markingText", () => {
  function anchor(
    offset: number,
    width: number,
    dir: Vec2 = { x: 1, y: 0 },
  ): MarkingAnchor {
    return { at: { x: 0, y: 0 }, dir, span: { offset, width } };
  }

  /**
   * **The assertion that can fail, and the reason the numbers are literals.**
   * Restating `chars × ADVANCE × TEXT_SIZE` would pass for any wrong `ADVANCE`;
   * what is load-bearing is whether these are *Overpass Mono's* ratios. They are
   * read out of the face's own tables — every glyph's `hmtx` advance is 1232 and
   * `OS/2.sCapHeight` is 1400, against a 2000-unit em (signs spec §2.4). A face
   * swap lands here rather than in a plate that quietly stopped fitting.
   */
  it("pins the face's own metrics", () => {
    expect(ADVANCE).toBe(1232 / 2000);
    expect(CAP_HEIGHT).toBe(1400 / 2000);
    expect(TEXT_SIZE).toBe(6);
    // Cap height clears the narrowest band text can land in - a ramp lane, which
    // is `LANE_PX * classWidthFactor("ramp")` - with asphalt showing either side.
    expect(TEXT_SIZE * CAP_HEIGHT).toBeLessThan(LANE_PX * classWidthFactor("ramp"));
  });

  it("sets a string as wide as its characters", () => {
    expect(textWidth("BUS")).toBeCloseTo(3 * ADVANCE * TEXT_SIZE);
    expect(textWidth("")).toBe(0);
    // Monotonic, which is the whole property a plate is sized on (Phase 4).
    expect(textWidth("M4 WEST")).toBeGreaterThan(textWidth("M4"));
  });

  /**
   * Centred **across** the band, not on it: glyphs sit above their baseline, so
   * the baseline drops half a cap height toward the right of travel to land the
   * run's visual middle on the band's middle.
   */
  it("centres the run on the lane band", () => {
    const band = laneBands(defaults(3))[0];
    const run = markingText(anchor(band.offset, band.width));

    expect(run.at.y).toBeCloseTo(band.offset + (TEXT_SIZE * CAP_HEIGHT) / 2);
    // Along the road it sits exactly on `position`; `text-anchor="middle"` does
    // the rest, which is why the content never enters this arithmetic.
    expect(run.at.x).toBe(0);
    expect(run.size).toBe(TEXT_SIZE);
  });

  /**
   * A rotation is not a magnitude, so one road cannot pin it: due east must give
   * zero and due north minus a quarter turn, and an inversion fails exactly one
   * of the two.
   */
  it("runs along the road, whichever way the road runs", () => {
    expect(markingText(anchor(0, LANE_PX)).angle).toBe(0);
    // Due north is negative `y` in the drawing's frame.
    expect(markingText(anchor(0, LANE_PX, { x: 0, y: -1 })).angle).toBe(-90);
    expect(markingText(anchor(0, LANE_PX, { x: 0, y: 1 })).angle).toBe(90);
    expect(markingText(anchor(0, LANE_PX, { x: -1, y: 0 })).angle).toBe(180);
  });

  /**
   * The band offset is applied in the **rotated** frame, not added to `y` — a run
   * on a due-north road is offset in `x`, and adding it to `y` would slide the
   * text down the road instead of across it. Nearside on a northbound road is
   * east of it, so lane 0's offset lands positive in `x`.
   */
  it("offsets across the road it is on, not across the page", () => {
    const band = laneBands(defaults(3))[0];
    const north = markingText(anchor(band.offset, band.width, { x: 0, y: -1 }));

    expect(north.at.x).toBeCloseTo(band.offset + (TEXT_SIZE * CAP_HEIGHT) / 2);
    expect(north.at.y).toBeCloseTo(0);
  });

  /** The sign trap the tiled kinds are pinned against, applied to the baseline. */
  it("paints an offside lane on the offside", () => {
    const offside = laneBands(defaults(3))[2];
    expect(offside.offset).toBeLessThan(0);

    const run = markingText(anchor(offside.offset, offside.width));
    expect(run.at.y).toBeLessThan(0);
  });
});

/**
 * A sign's plate (signs spec Phase 2). Everything here is drawn **about the
 * origin**, because a sign carries its own canvas position and its shape is
 * translated there — so unlike every marking above, no road appears in this
 * describe at all.
 */
describe("signPlate", () => {
  /** A due-east anchor on one band, for the one assertion that compares the two
   *  text sites directly. */
  function anchor(offset: number, width: number): MarkingAnchor {
    return { at: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, span: { offset, width } };
  }

  /** Every label here is past the floor the next test pins, so this measures the
   *  text and nothing else. */
  it("is as wide as the text it carries, plus a margin either side", () => {
    for (const label of ["TOLL", "M4 WEST", "HEATHROW"]) {
      expect(signPlate(label).box.width).toBeCloseTo(
        textWidth(label) + 2 * PLATE_PAD,
      );
    }
  });

  /**
   * **Monotonic, which is the property a plate has to have** and the one a single
   * width assertion cannot show. It is what §2.4's monospace decision bought: a
   * proportional face would need a metrics table to say this much.
   */
  it("grows with its label and never shrinks below the sign size", () => {
    const widths = ["", "M4", "M4 W", "M4 WEST"].map(
      (s) => signPlate(s).box.width,
    );

    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    // The floor is what keeps an empty label a plate rather than a sliver — the
    // state every freshly placed sign starts in.
    expect(signPlate("").box.width).toBe(SIGN_SIZE);
    expect(signPlate("M4").box.width).toBe(SIGN_SIZE);
  });

  it("stays centred on the sign's own position at every length", () => {
    for (const label of ["", "TOLL", "HEATHROW"]) {
      const { box } = signPlate(label);
      expect(box.x).toBeCloseTo(-box.width / 2);
      expect(box.y).toBeCloseTo(-box.height / 2);
    }
  });

  /**
   * The height is the **type it carries**, not `SIGN_SIZE`: a square plate reads
   * as a card rather than as a sign, and the cap has to clear it top and bottom.
   */
  it("is as tall as the type it carries, with the cap clearing it", () => {
    const plate = signPlate("TOLL");

    expect(plate.box.height).toBe(TEXT_SIZE * 2);
    expect(TEXT_SIZE * CAP_HEIGHT).toBeLessThan(plate.box.height);
    expect(plate.size).toBe(TEXT_SIZE);
  });

  /**
   * **Centred by arithmetic, not `dominant-baseline`** (§2.7) — and by the
   * *identical* arithmetic `markingText` centres a run on its lane band with,
   * which is the one number both text sites in the drawing have to agree on.
   */
  it("drops the baseline half a cap height, as a painted run does", () => {
    const plate = signPlate("TOLL");

    expect(plate.baseline.x).toBe(0);
    expect(plate.baseline.y).toBeCloseTo((TEXT_SIZE * CAP_HEIGHT) / 2);
    // The same offset a run takes off its band centre, stated as the equality it
    // is rather than as two numbers that happen to match.
    const band = laneBands(defaults(3))[0];
    expect(markingText(anchor(band.offset, band.width)).at.y - band.offset).toBeCloseTo(
      plate.baseline.y,
    );
  });
});

/**
 * The shapes that carry a sign's meaning (signs spec Phase 3) — every one drawn
 * about the origin, and every one a **shape** test rather than a magnitude one:
 * §2.7's whole rule is that the shape says what the sign means and the colour only
 * confirms it, so a flipped triangle or a rotated octagon is the failure that
 * matters, and every size assertion in this file would pass through both.
 */
describe("the sign vocabulary", () => {
  /** Every vertex's distance from the origin — a sign is drawn about its own position. */
  const radii = (pts: Vec2[]) => pts.map((p) => Math.hypot(p.x, p.y));
  /** Every edge's length, the last one closing the polygon. */
  const sides = (pts: Vec2[]) =>
    pts.map((p, i) => distance(p, pts[(i + 1) % pts.length]));
  /** The six kinds whose shape carries the meaning, in `SIGN_PICKER`'s order. */
  const SYMBOLS: SignKind[] = [
    { type: "speed_limit", kph: 50 },
    { type: "stop" },
    { type: "give_way" },
    { type: "priority" },
    { type: "no_entry" },
    { type: "warning", symbol: "bend_right" },
  ];

  it("cuts a regular octagon, inscribed in the sign size", () => {
    const pts = signOctagon();

    expect(pts).toHaveLength(8);
    for (const r of radii(pts)) expect(r).toBeCloseTo(SIGN_SIZE / 2);
    // **Eight equal sides** is the property, and the one an assertion on a vertex
    // cannot show: any number of near-octagons pass that.
    const [first, ...rest] = sides(pts);
    for (const s of rest) expect(s).toBeCloseTo(first);
    // Flat-topped, which is the half-step phase: an octagon with a vertex at the
    // top reads as a rotated one. SVG's y grows downward, so the top is the pair
    // of lowest y's.
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(ys[1]);
    expect(ys[6]).toBeCloseTo(ys[7]);
  });

  /**
   * **The give-way triangle points down and the warning triangle points up**, and
   * that is the whole of what tells them apart — same size, same colour, same
   * class in the stylesheet. A magnitude test passes under the flip, which is why
   * the apex is compared against its own base rather than against a number.
   */
  it("inverts the give-way triangle and stands the warning one upright", () => {
    for (const point of ["up", "down"] as const) {
      const pts = signTriangle(point);
      expect(pts).toHaveLength(3);
      for (const r of radii(pts)) expect(r).toBeCloseTo(SIGN_SIZE / 2);

      const apex = pts.filter((p) => Math.abs(p.x) < 1e-9);
      const base = pts.filter((p) => Math.abs(p.x) >= 1e-9);
      expect(apex).toHaveLength(1);
      expect(base[0].y).toBeCloseTo(base[1].y);
      // SVG's y grows downward, so "down" is the apex *below* its own base.
      expect(Math.sign(apex[0].y - base[0].y)).toBe(point === "down" ? 1 : -1);
    }

    // One construction and one flip: two builders could drift into two different
    // triangles, and nothing above would notice.
    const down = signTriangle("down");
    signTriangle("up").forEach((p, i) => {
      expect(down[i].x).toBeCloseTo(p.x);
      expect(down[i].y).toBeCloseTo(-p.y);
    });
  });

  it("insets the priority face inside its border, corner for corner", () => {
    const { border, face } = signPriority();

    expect(border).toHaveLength(4);
    for (const r of radii(border)) expect(r).toBeCloseTo(SIGN_SIZE / 2);
    // Strictly inside at **every** corner, not merely smaller on average — the
    // white band is what the yellow face is read against on light paper.
    face.forEach((p, i) => {
      expect(Math.hypot(p.x, p.y)).toBeLessThan(Math.hypot(border[i].x, border[i].y));
    });
  });

  /**
   * The ring's two jobs, and the second is the one that can actually fail: it has
   * to leave room for the widest number the Inspector's stepper can reach. Three
   * digits is that width, and it is geometry rather than a road rule (§2.4's one
   * type size is what makes the ring the only adjustable part).
   */
  it("puts the roundel's ring on its rim, with room for three digits", () => {
    const { radius, ring } = signRoundel();

    expect(radius).toBe(SIGN_SIZE / 2);
    expect(ring.width).toBe(SIGN_RING);
    // Stroked, so the outermost thing the sign paints is red rather than a sliver
    // of white against light paper.
    expect(ring.radius + ring.width / 2).toBeCloseTo(radius);

    // The run is centred on the disc, so its four corners sit `BASELINE_DROP`
    // either side of the centre line and half its width either side of it.
    const corner = Math.hypot(textWidth("130") / 2, BASELINE_DROP);
    expect(corner).toBeLessThan(radius - ring.width);
  });

  it("keeps the no-entry bar inside its disc, and reading as a bar", () => {
    const { radius, bar } = signNoEntry();

    expect(radius).toBe(SIGN_SIZE / 2);
    expect(bar.x).toBeCloseTo(-bar.width / 2);
    expect(bar.y).toBeCloseTo(-bar.height / 2);
    expect(Math.hypot(bar.width / 2, bar.height / 2)).toBeLessThan(radius);
    // A red disc *without* the bar is a different sign, so the bar has to read as
    // one: most of the disc across, and a fraction of that tall.
    expect(bar.width).toBeGreaterThan(radius);
    expect(bar.height).toBeLessThan(bar.width / 2);
  });

  /**
   * **The one place that decides which kinds are plates.** A symbol deriving a
   * width from a label it does not carry is the failure it exists to rule out.
   *
   * The two plate kinds read their string out of **different fields** — a
   * `custom`'s `label` and a `direction`'s `text` — which is the whole of what this
   * function hides from the renderer and from `signBox` (signs spec Phase 4).
   */
  it("names the two plate kinds and no others", () => {
    expect(signPlateLabel({ type: "custom", label: "TOLL" })).toBe("TOLL");
    expect(signPlateLabel({ type: "direction", text: "M4 W" })).toBe("M4 W");
    for (const kind of SYMBOLS) expect(signPlateLabel(kind)).toBeNull();
  });

  /**
   * **The chrome is grown from the sign's own shape**, which is what keeps "one hit
   * box and one halo for every kind" true now that six of the eight are not
   * rectangles. The failure it rules out is concrete: a plate is `TEXT_SIZE * 2`
   * tall, so a halo taken from one would sit *inside* a 22-unit roundel.
   */
  it("boxes a symbol in the sign size and a plate in its own width", () => {
    for (const kind of SYMBOLS) {
      expect(signBox(kind)).toEqual({
        box: {
          x: -SIGN_SIZE / 2,
          y: -SIGN_SIZE / 2,
          width: SIGN_SIZE,
          height: SIGN_SIZE,
        },
        radius: signPlate("").radius,
      });
    }

    // Both plate kinds, because each reads its string out of a field of its own —
    // a `direction` boxed off an empty label would be the failure that survives
    // every assertion above.
    const wide = signBox({ type: "custom", label: "HEATHROW" });
    expect(wide.box).toEqual(signPlate("HEATHROW").box);
    expect(wide.box.width).toBeGreaterThan(SIGN_SIZE);

    const destination = signBox({ type: "direction", text: "M4 THE WEST" });
    expect(destination.box).toEqual(signPlate("M4 THE WEST").box);
    expect(destination.box.width).toBeGreaterThan(wide.box.width);

    // The two are genuinely different boxes, which is the whole reason this
    // function exists rather than the plate serving both.
    expect(signPlate("").box.height).toBeLessThan(SIGN_SIZE);
  });
});

/**
 * The one longitudinal kind (markings spec Phase 4). Every road below runs **due
 * east**, so the frame reads straight off the coordinates as it does above: `y`
 * is the lateral offset across the road, and a line's whole geometry is one `y`.
 */
describe("laneLine and laneLineOffsets", () => {
  /** One straight `lanes`-lane road due east, carrying `markings`. */
  function road(lanes: number, ...markings: Marking[]): Document {
    const base = emptyDocument("lined");
    return {
      ...base,
      nodes: [
        { id: "N1", type: "endpoint" },
        { id: "N2", type: "endpoint" },
      ],
      links: [
        { id: "L1", from_node: "N1", to_node: "N2", lanes: defaults(lanes), median_gap: DEFAULT_MEDIAN_GAP },
      ],
      layout: {
        ...base.layout,
        nodes: { N1: { pos: { x: 0, y: 0 } }, N2: { pos: { x: 120, y: 0 } } },
      },
      markings,
    };
  }

  /** A lane line on `L1`; `lane` absent is the centreline. */
  function line(lane?: LaneIdx, style: LineStyle = "solid", position = 14): Marking {
    return {
      id: "M1",
      link: "L1",
      position,
      ...(lane === undefined ? {} : { lane }),
      kind: { type: "lane_line", style },
    };
  }

  /** What `laneLine` makes of the first marking on `doc`. */
  function drawn(doc: Document) {
    return laneLine(doc, doc.markings[0], carriageways(doc));
  }

  /**
   * **The assertion the replacement rests on.** `RoadShape` derives divider `i`
   * as `bands[i+1].offset + bands[i+1].width / 2` and drops it by *comparing the
   * two numbers*, so an equivalent-but-different expression here would leave a
   * dashed line under the solid one at every boundary.
   */
  it("lands exactly where the divider it replaces was, at every boundary", () => {
    const bands = laneBands(defaults(4));

    for (const i of [0, 1, 2]) {
      expect(drawn(road(4, line(i)))!.offset).toBe(
        bands[i + 1].offset + bands[i + 1].width / 2,
      );
    }
    // Three boundaries for four default lanes, from the nearside outward.
    expect([0, 1, 2].map((i) => drawn(road(4, line(i)))!.offset)).toEqual([9, 0, -9]);
  });

  /**
   * The undivided two-way road (road spec OQ-4). On a 2-lane road the lane
   * region's centre *is* its one boundary, which is why a centreline replaces a
   * divider on exactly the same rule a named boundary does.
   */
  it("puts a lane-less line on the lane region's centre", () => {
    expect(drawn(road(4, line(undefined)))!.offset).toBe(0);
    expect(drawn(road(3, line(undefined)))!.offset).toBe(0);

    const bands = laneBands(defaults(2));
    expect(bands[1].offset + bands[1].width / 2).toBe(0);
  });

  it("draws nothing for a lane that names no boundary", () => {
    // `n` lanes have `n-1` boundaries, so the offside-most lane names none: its
    // far side is the carriageway edge line, which is not a lane line's to take.
    expect(drawn(road(3, line(2)))).toBeUndefined();
    expect(drawn(road(3, line(9)))).toBeUndefined();
    expect(drawn(road(3, line(-1)))).toBeUndefined();
    // A 1-lane road has no boundary at all — only a centreline.
    expect(drawn(road(1, line(0)))).toBeUndefined();
    expect(drawn(road(1, line(undefined)))).toBeDefined();
  });

  it("draws nothing for an unknown link, or a kind that is not a lane line", () => {
    const missing = road(3, { ...line(0), link: "L9" });
    expect(laneLine(missing, missing.markings[0], carriageways(missing))).toBeUndefined();

    const stop = road(3, { ...line(0), kind: { type: "stop_line" } });
    expect(drawn(stop)).toBeUndefined();
  });

  it("paints one stroke for solid and dashed, and two for double", () => {
    const single = drawn(road(4, line(1, "dashed")))!;
    expect(single.style).toBe("dashed");
    expect(single.lines).toEqual([single.spine]);

    const double = drawn(road(4, line(1, "double")))!;
    expect(double.lines).toHaveLength(2);
    // Symmetric about the boundary, `LANE_LINE_GAP` apart, with the spine — what
    // the hit target and halo take — down the middle of the pair.
    expect(double.lines.map((l) => l[0].y)).toEqual([
      LANE_LINE_GAP / 2,
      -LANE_LINE_GAP / 2,
    ]);
    expect(double.spine[0].y).toBe(0);
  });

  /**
   * `position` is ignored: a lane line paints its boundary for the **whole
   * link**, which is the reading that costs no model field (§2.3). Nothing reads
   * the number, so not even a hand-edited `NaN` can reach the geometry.
   */
  it("ignores `position` entirely, however it was placed", () => {
    const near = drawn(road(4, line(1, "solid", 0)));

    expect(drawn(road(4, line(1, "solid", 400)))).toEqual(near);
    expect(drawn(road(4, line(1, "solid", Number.NaN)))).toEqual(near);
  });

  /**
   * Offset from `drawnPolyline` rather than the layout polyline, so a lane line
   * inherits the carriageway offset and the alignment shift like everything else
   * drawn on a road — one carriageway's line cannot end up in the median.
   */
  it("follows the carriageway its link is drawn on", () => {
    const base = road(2, line(0));
    const divided: Document = {
      ...base,
      links: [
        ...base.links,
        { id: "L2", from_node: "N2", to_node: "N1", lanes: defaults(2), median_gap: DEFAULT_MEDIAN_GAP },
      ],
    };
    const offsets = carriageways(divided);

    expect(offsets.L1).toBeGreaterThan(0);
    // Boundary 0 of a 2-lane road is the road's own centre, so the whole of this
    // `y` is the carriageway term.
    expect(laneLine(divided, divided.markings[0], offsets)!.spine[0].y).toBe(offsets.L1);
  });

  it("collects the boundaries taken on each link, and only the drawable ones", () => {
    const doc = road(
      4,
      line(0),
      { ...line(2), id: "M2" },
      // Names no boundary; unknown link; not a lane line at all.
      { ...line(3), id: "M3" },
      { ...line(1), id: "M4", link: "L9" },
      { ...line(1), id: "M5", kind: { type: "crosswalk" } },
    );

    expect(laneLineOffsets(doc)).toEqual({ L1: [9, -9] });
    // The predicate `RoadShape` filters its dividers with.
    expect(boundaryTaken(laneLineOffsets(doc).L1, 9)).toBe(true);
    expect(boundaryTaken(laneLineOffsets(doc).L1, 0)).toBe(false);
    expect(boundaryTaken(undefined, 9)).toBe(false);
  });

  it("collects nothing from a document with no lane line", () => {
    expect(laneLineOffsets(road(4))).toEqual({});
    expect(laneLineOffsets(road(4, { ...line(1), kind: { type: "stop_line" } }))).toEqual({});
  });
});

describe("movements through a junction", () => {
  /**
   * The junction semantics spec's own fixture: a **two-way** T, which is what
   * Assimilator's model makes of one — every arm is an opposing *pair* of links,
   * because "a two-way street is two links with opposite `from_node`/`to_node`".
   *
   * ```
   *       N1 ⇄ N2 ⇄ N3     west arm   L1 (N1→N2) in,  L2 (N2→N1) out
   *            ⇅           east arm   L3 (N2→N3) out, L4 (N3→N2) in
   *            N4          south arm  L5 (N2→N4) out, L6 (N4→N2) in
   * ```
   *
   * `N4` is at **`+y`**, which is south: SVG's y axis points down. All three arms
   * are reversed pairs, so `carriageways` genuinely offsets every polyline here —
   * a lateral step, which is why the bearings below are still exact.
   */
  const POS: Record<NodeId, Vec2> = {
    N1: { x: -100, y: 0 },
    N2: { x: 0, y: 0 },
    N3: { x: 100, y: 0 },
    N4: { x: 0, y: 100 },
  };
  const ENDS: [LinkId, NodeId, NodeId][] = [
    ["L1", "N1", "N2"],
    ["L2", "N2", "N1"],
    ["L3", "N2", "N3"],
    ["L4", "N3", "N2"],
    ["L5", "N2", "N4"],
    ["L6", "N4", "N2"],
  ];

  /** The T, with only `placed` given a canvas position (all four by default). */
  function tee(placed: NodeId[] = ["N1", "N2", "N3", "N4"]): Document {
    const base = emptyDocument("T");
    const nodes: Record<NodeId, { pos: Vec2 }> = {};
    for (const id of placed) nodes[id] = { pos: POS[id] };
    return {
      ...base,
      nodes: [
        { id: "N1", type: "endpoint" },
        { id: "N2", type: "junction" },
        { id: "N3", type: "endpoint" },
        { id: "N4", type: "endpoint" },
      ],
      links: ENDS.map(([id, from, to]) => ({
        id,
        from_node: from,
        to_node: to,
        lanes: defaults(2),
        median_gap: DEFAULT_MEDIAN_GAP,
      })),
      junctions: [{ node_id: "N2", control: "unsignalized" }],
      layout: { ...base.layout, nodes },
    };
  }

  /**
   * **A named turn on a named bearing**, and both are load-bearing: the handedness
   * of §2.4's cross product is self-consistently invertible, so a test asserting
   * only "one left and one right" passes just as happily written backwards. SVG's
   * y axis points down, which is what makes a positive cross product a *right*
   * turn — `DRIVE_SIDE`'s trap in the other subsystem.
   */
  it("classifies a turn by the bearing it is actually drawn on", () => {
    const t = tee();

    // Arriving from the west on L1, so travelling east.
    expect(movementKind(t, "N2", "L1", "L5")).toBe("right"); // into the south arm
    expect(movementKind(t, "N2", "L1", "L3")).toBe("through"); // straight on, east
  });

  /** The same rule on a different axis, so nothing about it is axis-specific. */
  it("classifies an approach from the south the other way round", () => {
    const t = tee();

    // Arriving from the south on L6, so travelling north.
    expect(movementKind(t, "N2", "L6", "L2")).toBe("left"); // into the west arm
    expect(movementKind(t, "N2", "L6", "L3")).toBe("right"); // into the east arm
  });

  /**
   * A u-turn is **topology, not angle**: `from.from_node === to.to_node` is exactly
   * "leaves back down the road it arrived on". Running it first is what spares the
   * angular bands a `left`/`u-turn` boundary — a ~180° pair either is one of these
   * or genuinely is not a u-turn at all.
   */
  it("reads the three u-turns off the topology", () => {
    const t = tee();

    expect(movementKind(t, "N2", "L1", "L2")).toBe("u-turn");
    expect(movementKind(t, "N2", "L4", "L3")).toBe("u-turn");
    expect(movementKind(t, "N2", "L6", "L5")).toBe("u-turn");
  });

  /** The hand-edited document, and `setMovementKind` is the repair for it. */
  it("falls back to through for a link it cannot measure", () => {
    // L5's far node has no position, so the link is not drawn at all.
    expect(movementKind(tee(["N1", "N2", "N3"]), "N2", "L1", "L5")).toBe("through");
    expect(movementKind(tee(), "N2", "L1", "L9")).toBe("through");
    // A link that does not touch the node cannot be measured against it either:
    // neither of these two meets N1, so neither has an arm there.
    expect(movementKind(tee(), "N1", "L3", "L5")).toBe("through");
  });

  it("spells a movement's id as the ordered pair it is", () => {
    expect(movementId("L1", "L3")).toBe("M_L1_L3");
    expect(movementId("L1", "L3")).not.toBe(movementId("L3", "L1"));
  });

  /**
   * 3 arriving × 3 leaving = **9** ordered pairs, the three u-turns among them:
   * the picker offers everything the model can express, and it is Phase 4's Derive
   * that will decline to mint a u-turn (§2.4's deliberate split).
   */
  it("offers every ordered arriving→leaving pair, u-turns included", () => {
    const pairs = legalMovements(tee(), "N2");

    expect(pairs).toHaveLength(9);
    for (const u of [["L1", "L2"], ["L4", "L3"], ["L6", "L5"]]) {
      expect(pairs).toContainEqual({ from: u[0], to: u[1] });
    }
  });

  /** Direction is real: an arriving link is never an exit, whatever it pairs with. */
  it("never offers an arriving link as an exit", () => {
    const pairs = legalMovements(tee(), "N2");

    expect([...new Set(pairs.map((p) => p.from))].sort()).toEqual(["L1", "L4", "L6"]);
    expect([...new Set(pairs.map((p) => p.to))].sort()).toEqual(["L2", "L3", "L5"]);
  });

  /**
   * A road that only leaves, or only arrives, is no turn at all — and neither is a
   * link paired with itself, the self-loop only a hand-edited file can hold
   * (`carriageways` excludes the same degenerate link from a carriageway pair).
   */
  it("offers nothing at a node with one link", () => {
    const base = emptyDocument("one");
    const doc: Document = {
      ...base,
      nodes: [
        { id: "N1", type: "junction" },
        { id: "N2", type: "junction" },
      ],
      links: [
        {
          id: "L1",
          from_node: "N1",
          to_node: "N2",
          lanes: defaults(2),
          median_gap: DEFAULT_MEDIAN_GAP,
        },
      ],
      layout: {
        ...base.layout,
        nodes: { N1: { pos: { x: 0, y: 0 } }, N2: { pos: { x: 100, y: 0 } } },
      },
    };

    expect(legalMovements(doc, "N1")).toEqual([]);
    expect(legalMovements(doc, "N2")).toEqual([]);
  });

  /** A link with no drawable polyline is skipped, so the picker never offers one. */
  it("skips a link whose node has no layout entry", () => {
    const pairs = legalMovements(tee(["N1", "N2", "N3"]), "N2");

    expect(pairs).toHaveLength(4);
    expect(pairs.some((p) => p.from === "L6" || p.to === "L5")).toBe(false);
  });

  /**
   * The other half of §2.4's split, and the whole of what Derive is: the same 9
   * pairs **less the 3 u-turns**. A u-turn stays a permission a human asks for by
   * name, so the picker offers one and the button never mints one.
   */
  it("derives the six pairs that are not u-turns", () => {
    const pairs = derivableMovements(tee(), "N2");

    // Spelled out rather than counted: the three that are gone are exactly the
    // three that leave back down the road they arrived on.
    expect(pairs.map((p) => `${p.from}→${p.to}`)).toEqual([
      "L1→L3",
      "L1→L5",
      "L4→L2",
      "L4→L5",
      "L6→L2",
      "L6→L3",
    ]);
  });
});

describe("a movement drawn across the pad", () => {
  /**
   * The same T, but as `junctionArms` hands it to the glyph: **in the glyph's own
   * frame**, which is translated to N2, and one arm per link. Its three arms are
   * all divided pairs, so every carriageway sits 13.5 off its centreline
   * (`roadWidth(2) / 2 + SCHEMATIC_MEDIAN / 2`), and the pad radius is the arms'
   * own reach, 13.5 + 21 / 2 = 24.
   *
   * Every `away` points **out** of the junction, whichever way its traffic runs —
   * which is exactly why the arriving arms below are indistinguishable from the
   * leaving ones here, and why direction has to come from the model.
   */
  const R = 24;
  /** How far out along an arm the pad's rim is: `sqrt(R² - 13.5²)`. */
  const RIM = Math.sqrt(R * R - 13.5 * 13.5);

  const WEST_IN: MovementEnd = { at: { x: 0, y: 13.5 }, away: { x: -1, y: 0 } }; // L1
  const WEST_OUT: MovementEnd = { at: { x: 0, y: -13.5 }, away: { x: -1, y: 0 } }; // L2
  const EAST_OUT: MovementEnd = { at: { x: 0, y: 13.5 }, away: { x: 1, y: 0 } }; // L3
  const SOUTH_OUT: MovementEnd = { at: { x: -13.5, y: 0 }, away: { x: 0, y: 1 } }; // L5
  const SOUTH_IN: MovementEnd = { at: { x: 13.5, y: 0 }, away: { x: 0, y: 1 } }; // L6

  /** The point halfway along the curve — `(P0 + 3C1 + 3C2 + P3) / 8`. */
  function curveMid(arc: MovementArc): Vec2 {
    const [c1, c2] = arc.control;
    return {
      x: (arc.start.x + 3 * c1.x + 3 * c2.x + arc.end.x) / 8,
      y: (arc.start.y + 3 * c1.y + 3 * c2.y + arc.end.y) / 8,
    };
  }

  /** How far the curve leaves the straight line between its own two ends. */
  function sag(arc: MovementArc): number {
    return distance(curveMid(arc), {
      x: (arc.start.x + arc.end.x) / 2,
      y: (arc.start.y + arc.end.y) / 2,
    });
  }

  it("starts on its approach arm and ends on its exit arm", () => {
    const arc = movementArc(WEST_IN, SOUTH_OUT, R); // L1 to L5, a right turn.

    // Both ends on the pad's rim, where the stop bar would sit four units later.
    expect(distance({ x: 0, y: 0 }, arc.start)).toBeCloseTo(R);
    expect(distance({ x: 0, y: 0 }, arc.end)).toBeCloseTo(R);
    // Each out along its **own** carriageway, not along the node's centre: the
    // arc starts on the road it arrives on and ends on the road it leaves by.
    expect(arc.start).toEqual({ x: -RIM, y: 13.5 });
    expect(arc.end).toEqual({ x: -13.5, y: RIM });
    // And the arrowhead points the way the exit road runs.
    expect(arc.dir).toEqual(SOUTH_OUT.away);
  });

  /**
   * **The gate's shape test**, and it has to be a shape one: a magnitude test
   * ("the curve is 40 units long") passes for any curve at all, including the
   * straight line a broken through would draw and the stub a broken u-turn would.
   *
   * A `through` is straight because the cubic's four points come out collinear —
   * not because anything special-cases it.
   */
  it("draws a through straight and a left as a curve", () => {
    const through = movementArc(WEST_IN, EAST_OUT, R); // L1 to L3
    const left = movementArc(SOUTH_IN, WEST_OUT, R); // L6 to L2

    expect(sag(through)).toBeCloseTo(0);
    // Pinned rather than bounded: a flat `k = chord / 3` draws this same left at
    // 8.34, which is still comfortably "more than the through" and still wrong.
    expect(sag(left)).toBeCloseTo(9.766, 2);
    expect(sag(through)).toBeLessThan(sag(left));

    // The left swings *into* the junction before it turns — north-east of the
    // node, arriving northbound and leaving westbound.
    expect(curveMid(left).x).toBeGreaterThan(0);
    expect(curveMid(left).y).toBeLessThan(0);
  });

  /**
   * Beyond the gate, and the assertion that pins the arc constant rather than
   * merely the ordering above: a u-turn's apex sits **exactly** the median's
   * half-width beyond its own arm, which is a true semicircle across the median.
   *
   * A flat `k = chord / 3` draws that as a shallow stub — 6.75 rather than 13.5 —
   * while still passing every "straighter than" assertion ever written.
   */
  it("hooks a u-turn around the median rather than flattening it", () => {
    const arc = movementArc(WEST_IN, WEST_OUT, R); // L1 to L2

    expect(curveMid(arc).x - arc.start.x).toBeCloseTo(13.5);
    expect(curveMid(arc).y).toBeCloseTo(0);
    // Both ends on the west arm, one carriageway either side of its centreline.
    expect(arc.start).toEqual({ x: -RIM, y: 13.5 });
    expect(arc.end).toEqual({ x: -RIM, y: -13.5 });
  });

  /** One cubic, ending where the arc ends — the file's only non-`M`/`L` command. */
  it("spells the arc as a single cubic", () => {
    const d = movementPath(movementArc(WEST_IN, SOUTH_OUT, R));
    const arc = movementArc(WEST_IN, SOUTH_OUT, R);

    expect(d).toMatch(
      /^M [-\d.]+ [-\d.]+ C [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/,
    );
    expect(d).toContain(`M ${arc.start.x} ${arc.start.y} C`);
    expect(d.endsWith(`${arc.end.x} ${arc.end.y}`)).toBe(true);
  });
});
