import { describe, expect, it } from "vitest";
import { classifyWalkBikeAccess } from "@/lib/accessibility/isochrone";

describe("classifyWalkBikeAccess", () => {
  it("returns low access tier for weak walk-bike signals", () => {
    const result = classifyWalkBikeAccess({
      pctWalk: 1,
      pctBike: 1,
      pctZeroVehicle: 2,
      transitStopsPerSqMile: 3,
    });

    expect(result.tier).toBe("low");
    expect(result.scoreBoost).toBe(0);
    expect(result.rawScore).toBeLessThan(21);
  });

  it("returns medium access tier for moderate walk-bike signals", () => {
    const result = classifyWalkBikeAccess({
      pctWalk: 8,
      pctBike: 4,
      pctZeroVehicle: 8,
      transitStopsPerSqMile: 12,
    });

    expect(result.tier).toBe("medium");
    expect(result.scoreBoost).toBe(4);
    expect(result.rawScore).toBeGreaterThanOrEqual(21);
    expect(result.rawScore).toBeLessThan(39);
  });

  it("returns high access tier for strong walk-bike signals", () => {
    const result = classifyWalkBikeAccess({
      pctWalk: 20,
      pctBike: 10,
      pctZeroVehicle: 25,
      transitStopsPerSqMile: 40,
    });

    expect(result.tier).toBe("high");
    expect(result.scoreBoost).toBe(8);
    expect(result.rawScore).toBeGreaterThanOrEqual(39);
  });

  it("keeps score boost monotonic as access signals improve", () => {
    const low = classifyWalkBikeAccess({
      pctWalk: 1,
      pctBike: 1,
      pctZeroVehicle: 2,
      transitStopsPerSqMile: 3,
    });
    const medium = classifyWalkBikeAccess({
      pctWalk: 8,
      pctBike: 4,
      pctZeroVehicle: 8,
      transitStopsPerSqMile: 12,
    });
    const high = classifyWalkBikeAccess({
      pctWalk: 20,
      pctBike: 10,
      pctZeroVehicle: 25,
      transitStopsPerSqMile: 40,
    });

    expect(low.scoreBoost).toBeLessThanOrEqual(medium.scoreBoost);
    expect(medium.scoreBoost).toBeLessThanOrEqual(high.scoreBoost);
  });

  /**
   * A null stop density means no transit source answered. Treating it as
   * 0/sq mi would score an unmeasured area exactly as if it had been surveyed
   * and found to have no service.
   */
  describe("when transit stop density was not measured", () => {
    const measuredBare = {
      pctWalk: 8,
      pctBike: 4,
      pctZeroVehicle: 8,
      transitStopsPerSqMile: 0,
    };
    const unmeasured = { ...measuredBare, transitStopsPerSqMile: null };

    it("scores higher than the same area measured and found to have no stops", () => {
      expect(classifyWalkBikeAccess(unmeasured).rawScore).toBeGreaterThan(
        classifyWalkBikeAccess(measuredBare).rawScore
      );
    });

    it("rescales the measured signals onto the full range", () => {
      // walk+bike 12% -> 16; zero-vehicle 8% -> 6; measured total 22.
      // Ceilings: 44 without the stop-density term, 58 with it.
      // 22 / 44 * 58 = 29.
      expect(classifyWalkBikeAccess(unmeasured).rawScore).toBe(29);

      // The measured-bare case keeps its lowest-bucket stop-density score of 2,
      // which is exactly why it is NOT the same as omitting the term.
      expect(classifyWalkBikeAccess(measuredBare).rawScore).toBe(24);
    });

    it("says the density was unavailable rather than reporting it as zero", () => {
      const rationale = classifyWalkBikeAccess(unmeasured).rationale;
      expect(rationale).toMatch(/not available/i);
      expect(rationale).not.toMatch(/0\/sq mi/);
    });

    it("still reports a measured zero as zero", () => {
      expect(classifyWalkBikeAccess(measuredBare).rationale).toMatch(/0\/sq mi/);
    });
  });
});

/**
 * THE TIER BOUNDARIES AND THE SCORE CURVE, PINNED.
 *
 * The 2026-08-06 foundation audit ran six mutations against `isochrone.ts` and
 * FOUR survived the whole suite: both tier cutoffs could be moved, a mode-share
 * bucket could be collapsed, and the zero-vehicle top bucket could be cut from
 * 14 to 2. Every one changes what a planner reports as a finding — "high
 * accessibility" is a label that goes into a grant application — and nothing
 * anywhere noticed.
 *
 * The zero-vehicle one is the sharpest: zero-vehicle share is the EQUITY term
 * of this score, so flattening its top bucket removes most of the credit
 * carless households earn, silently.
 *
 * READ `bucketScore` BEFORE CHANGING THESE NUMBERS. Its buckets are
 * `[maxExclusive, score]` and it returns the score of the FIRST bucket the
 * value falls BELOW — so `[5, 4]` means "under 5% scores 4", and the fallback
 * is the top of the ladder rather than the bottom. Every expectation here is
 * the sum of all three terms, so the all-zero baseline is 8 (4 + 2 + 2) and not
 * 0. Each block moves ONE term and holds the other two, and asserts both sides
 * of every step: a cutoff tested only from above can be lowered without
 * failing anything, which is how four of these survived.
 */
describe("classifyWalkBikeAccess — the tier cutoffs are where the code says", () => {
  function score(inputs: Partial<Parameters<typeof classifyWalkBikeAccess>[0]>) {
    return classifyWalkBikeAccess({
      pctWalk: 0,
      pctBike: 0,
      pctZeroVehicle: 0,
      transitStopsPerSqMile: 0,
      ...inputs,
    });
  }

  it("puts the high tier at 39, with 38 still medium and 40 high", () => {
    const justUnder = score({ pctWalk: 25, pctZeroVehicle: 5, transitStopsPerSqMile: 0 });
    expect(justUnder.rawScore).toBe(38);
    expect(justUnder.tier).toBe("medium");
    expect(justUnder.scoreBoost).toBe(4);

    const justOver = score({ pctWalk: 15, pctZeroVehicle: 10, transitStopsPerSqMile: 5 });
    expect(justOver.rawScore).toBe(40);
    expect(justOver.tier).toBe("high");
    expect(justOver.scoreBoost).toBe(8);
  });

  it("puts the medium tier at 21, with 20 still low and 22 medium", () => {
    const justUnder = score({ transitStopsPerSqMile: 30 });
    expect(justUnder.rawScore).toBe(20);
    expect(justUnder.tier).toBe("low");
    expect(justUnder.scoreBoost).toBe(0);

    const justOver = score({ pctWalk: 5, transitStopsPerSqMile: 15 });
    expect(justOver.rawScore).toBe(22);
    expect(justOver.tier).toBe("medium");
  });
});

describe("classifyWalkBikeAccess — the bucket table is the score curve", () => {
  function raw(inputs: Partial<Parameters<typeof classifyWalkBikeAccess>[0]>) {
    return classifyWalkBikeAccess({
      pctWalk: 0,
      pctBike: 0,
      pctZeroVehicle: 0,
      transitStopsPerSqMile: 0,
      ...inputs,
    }).rawScore;
  }

  it("steps walk+bike mode share at 5 / 10 / 15 / 25", () => {
    // The whole ladder, because the audit collapsed the [25, 24] bucket — a
    // re-shaping in the MIDDLE of the range that no single-point test can see.
    expect(raw({ pctWalk: 4.9 })).toBe(8);
    expect(raw({ pctWalk: 5 })).toBe(14);
    expect(raw({ pctWalk: 10 })).toBe(20);
    expect(raw({ pctWalk: 15 })).toBe(28);
    expect(raw({ pctWalk: 25 })).toBe(34);
    // Monotonic and capped: more walking never scores less, and never more.
    expect(raw({ pctWalk: 60 })).toBe(34);
  });

  it("steps zero-vehicle share at 5 / 10 / 20 — the equity term", () => {
    expect(raw({ pctZeroVehicle: 4.9 })).toBe(8);
    expect(raw({ pctZeroVehicle: 5 })).toBe(12);
    expect(raw({ pctZeroVehicle: 10 })).toBe(16);
    // The audit cut this top value from 14 to 2 with the suite green, deleting
    // most of the credit carless households earn.
    expect(raw({ pctZeroVehicle: 20 })).toBe(20);
    expect(raw({ pctZeroVehicle: 90 })).toBe(20);
  });

  it("steps transit stop density at 5 / 15 / 30", () => {
    expect(raw({ transitStopsPerSqMile: 4.9 })).toBe(8);
    expect(raw({ transitStopsPerSqMile: 5 })).toBe(12);
    expect(raw({ transitStopsPerSqMile: 15 })).toBe(16);
    expect(raw({ transitStopsPerSqMile: 30 })).toBe(20);
  });

  it("combines walk and bike into one mode share rather than scoring them apart", () => {
    expect(raw({ pctWalk: 8, pctBike: 7 })).toBe(raw({ pctWalk: 15, pctBike: 0 }));
    expect(raw({ pctWalk: 8, pctBike: 7 })).toBe(28);
  });
});
