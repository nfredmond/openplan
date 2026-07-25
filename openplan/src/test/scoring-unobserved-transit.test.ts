import { describe, expect, it } from "vitest";
import { computeCorridorScores } from "@/lib/data-sources/scoring";
import type { TransitAccessSummary } from "@/lib/data-sources/transit";

/**
 * "Not measured" is not "measured and found none".
 *
 * When Overpass did not answer, `fetchTransitAccessForBbox` used to manufacture
 * `area x 2.5` stops with a fixed 85/10/5 bus/rail/ferry split and derive an
 * access tier from it. That fabricated `stopsPerSqMile` fed up to 20 points of
 * `computeAccessibility`, which fed the corridor composite, which is exported
 * into grant-ready reports. These tests pin the replacement: the transit term is
 * dropped and the remaining components are rescaled, so an unmeasured corridor
 * is neither credited with invented service nor penalised as if it were bare.
 */

const census = {
  tracts: [{}],
  totalPopulation: 1000,
  pctTransit: 6,
  pctWalk: 5,
  pctBike: 2,
  pctZeroVehicle: 6,
} as never;
const lodes = { jobsPerResident: 0.4, source: "lodes-wac" } as never;
const equity = { equityScore: 50, source: "proxy-census" } as never;
const crashes = { observed: true, crashesPerSquareMile: 0, totalFatalities: 0, totalFatalCrashes: 0, pedestrianFatalities: 0, bicyclistFatalities: 0 } as never;

function transitSummary(over: Partial<TransitAccessSummary> = {}): TransitAccessSummary {
  return {
    observed: true,
    totalStops: 30,
    busStops: 28,
    railStations: 2,
    ferryStops: 0,
    stopsPerSqMile: 5,
    accessTier: "medium",
    source: "osm-overpass",
    unavailableReason: null,
    ...over,
  };
}

const UNOBSERVED = transitSummary({
  observed: false,
  totalStops: null,
  busStops: null,
  railStations: null,
  ferryStops: null,
  stopsPerSqMile: null,
  accessTier: null,
  source: "unavailable",
  unavailableReason: "The OpenStreetMap Overpass service did not respond.",
});

function score(transit: TransitAccessSummary) {
  return computeCorridorScores(census, lodes, transit, crashes, equity);
}

describe("accessibility scoring with no transit source", () => {
  it("records that transit data was unavailable", () => {
    expect(score(UNOBSERVED).dataQuality.transitDataAvailable).toBe(false);
    expect(score(transitSummary()).dataQuality.transitDataAvailable).toBe(true);
  });

  /**
   * The core property. An area that was never measured must not score the same
   * as one that was measured and genuinely has no transit — that would convert
   * an outage into a finding about the place.
   */
  it("does not score an unmeasured corridor as if it had been measured and found bare", () => {
    const measuredEmpty = score(
      transitSummary({ totalStops: 0, busStops: 0, railStations: 0, ferryStops: 0, stopsPerSqMile: 0, accessTier: "low" })
    );
    const unmeasured = score(UNOBSERVED);

    expect(unmeasured.accessibilityScore).toBeGreaterThan(measuredEmpty.accessibilityScore);
  });

  it("rescales rather than silently capping the score ~21 points lower", () => {
    const unmeasured = score(UNOBSERVED);
    const measuredEmpty = score(
      transitSummary({ totalStops: 0, busStops: 0, railStations: 0, ferryStops: 0, stopsPerSqMile: 0, accessTier: "low" })
    );

    // 96 is the with-transit ceiling, 76 the without. The unmeasured score is
    // the measured-components total scaled onto the full range.
    const expected = Math.round((measuredEmpty.accessibilityScore * 96) / 76);
    expect(unmeasured.accessibilityScore).toBe(expected);
  });

  it("leaves the observed path untouched", () => {
    // A pin: the with-transit arithmetic must not have shifted for real runs.
    const observed = score(transitSummary({ stopsPerSqMile: 5 }));
    const withoutStopTerm = score(
      transitSummary({ totalStops: 0, busStops: 0, railStations: 0, ferryStops: 0, stopsPerSqMile: 0, accessTier: "low" })
    );
    // 5 stops/sq mi * 2.2 = 11 points above the zero-density case.
    expect(observed.accessibilityScore - withoutStopTerm.accessibilityScore).toBe(11);
  });

  it("cannot report high confidence when the transit inventory was never read", () => {
    expect(score(UNOBSERVED).confidence).not.toBe("high");
    expect(score(transitSummary()).confidence).toBe("high");
  });

  it("keeps the composite finite and comparable when transit is missing", () => {
    const unmeasured = score(UNOBSERVED);
    expect(Number.isFinite(unmeasured.overallScore)).toBe(true);
    expect(unmeasured.overallScore).toBeGreaterThan(0);
  });
});
