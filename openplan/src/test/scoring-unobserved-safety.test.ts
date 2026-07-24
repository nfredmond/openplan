import { describe, expect, it } from "vitest";
import { computeCorridorScores } from "@/lib/data-sources/scoring";
import type { CrashSummary } from "@/lib/data-sources/crashes";

/**
 * Absence of crash evidence is not evidence of safety.
 *
 * Every count on an unobserved CrashSummary is zero by schema. Those zeros used
 * to walk through computeSafety's deductions untouched and then collect the
 * "no fatalities at all" bonus, so a study area with NO crash source scored
 * 95/100 — safer than almost anywhere with real data — and that number was
 * averaged into the overall composite and cited in narratives.
 */

function crashSummary(over: Partial<CrashSummary> = {}): CrashSummary {
  return {
    observed: true,
    source: "ccrs-ca",
    sourceLabel: "CCRS",
    attribution: null,
    severityCompleteness: "fatal_injury_only",
    totalFatalCrashes: 0,
    totalFatalities: 0,
    pedestrianFatalities: 0,
    bicyclistFatalities: 0,
    severeInjuryCrashes: null,
    totalInjuryCrashes: 0,
    yearsQueried: [2024],
    crashesPerSquareMile: 0,
    crashDensityBasis: "injury_and_fatal",
    reportedTotal: 0,
    mappedTotal: 0,
    truncated: false,
    points: [],
    checkedSources: [],
    unavailableReason: null,
    sourceSnapshot: {},
    narrativeLine: "",
    ...over,
  } as CrashSummary;
}

// Realistic enough that accessibility is a real number — the point of these
// tests is the safety component, but a NaN elsewhere would mask it.
const census = {
  tracts: [{}],
  totalPopulation: 1000,
  pctTransit: 2,
  pctWalk: 4,
  pctBike: 1,
  pctZeroVehicle: 4,
} as never;
const lodes = { jobsPerResident: 0.4 } as never;
const transit = { stopsPerSqMile: 3 } as never;
const equity = { equityScore: 50 } as never;

function score(crashes: CrashSummary) {
  return computeCorridorScores(census, lodes, transit, crashes, equity);
}

describe("safety scoring with no crash source", () => {
  it("produces NO safety score rather than a flattering one", () => {
    const unobserved = crashSummary({ observed: false, source: "out-of-coverage" });
    expect(score(unobserved).safetyScore).toBeNull();
  });

  it("does not let an unobserved area outscore an observed crash-free one", () => {
    // The old behaviour: unobserved = 95 (base 85 + the no-fatality bonus),
    // which beat or tied genuinely-measured areas.
    const unobserved = score(crashSummary({ observed: false, source: "out-of-coverage" }));
    const observedClean = score(crashSummary());
    expect(unobserved.safetyScore).toBeNull();
    expect(observedClean.safetyScore).toBeGreaterThan(0);
  });

  it("keeps a fabricated safety score out of the overall composite", () => {
    // Overall must be the average of what exists, not of what was invented.
    const unobserved = score(crashSummary({ observed: false, source: "source-unavailable" }));
    expect(Number.isFinite(unobserved.overallScore)).toBe(true);

    // With accessibility and equity identical, an unobserved run's overall must
    // not be inflated by a phantom 95.
    const observedPoor = score(
      crashSummary({ crashesPerSquareMile: 6, pedestrianFatalities: 3, totalFatalities: 3, totalFatalCrashes: 3 })
    );
    expect(unobserved.overallScore).not.toBe(observedPoor.overallScore);
  });

  it("reports crash data as unavailable when nothing answered", () => {
    // This was derived from source.includes("estimate") — a tier that no longer
    // exists — so it reported every study area as having crash data.
    const unobserved = score(crashSummary({ observed: false, source: "out-of-coverage" }));
    expect(unobserved.dataQuality.crashDataAvailable).toBe(false);
    expect(unobserved.confidence).not.toBe("high");
  });

  it("still reports crash data as available for a real observed run", () => {
    expect(score(crashSummary()).dataQuality.crashDataAvailable).toBe(true);
  });

  it("still deducts for a genuinely dangerous observed corridor", () => {
    const dangerous = score(
      crashSummary({ crashesPerSquareMile: 6, pedestrianFatalities: 4, totalFatalities: 4, totalFatalCrashes: 4 })
    );
    const clean = score(crashSummary());
    expect(dangerous.safetyScore!).toBeLessThan(clean.safetyScore!);
  });
});
