import { describe, expect, it } from "vitest";
import { DEFAULT_LANE_WIDTH, defaultLane } from "../model/document";
import { Lane } from "../model/types";
import {
  LANE_PX,
  MIN_ROAD_WIDTH,
  ROAD_MARGIN,
  UNITS_PER_METRE,
  laneBands,
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
