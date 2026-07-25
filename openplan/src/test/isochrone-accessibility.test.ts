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
