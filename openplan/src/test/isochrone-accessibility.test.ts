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
});
