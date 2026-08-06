import { describe, expect, it } from "vitest";
import { computeCorridorScores } from "@/lib/data-sources/scoring";
import type { TransitAccessSummary } from "@/lib/data-sources/transit";
import { NOT_MEASURED_METHOD, OSM_STOP_INVENTORY_METHOD, gtfsServiceLevelMethod } from "@/lib/data-sources/transit/method";
import { accessibilityTransitTerm } from "@/lib/data-sources/scoring";

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
    // FALSE: OpenStreetMap records where a stop is and nothing about what calls
    // there, so it has no opinion on frequency at all — which is a different
    // statement from "it could not state one here", and only this one keeps the
    // whole transit term as density.
    measuresFrequency: false,
    // NULL, not zero: scoring that silence as "no stop is frequent" would
    // penalise the corridor for the measurement.
    frequentServiceShare: null,
    frequentServiceStops: null,
    frequentServiceHeadwayMinutes: null,
    truncated: false,
    method: OSM_STOP_INVENTORY_METHOD,
    contributingSources: [],
    caveats: [],
    narrativeLine: "**Transit Access:** 30 stops (5/sq mi). Access tier: medium.",
    sourceSnapshot: {},
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
  method: NOT_MEASURED_METHOD,
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

/**
 * THE TRANSIT TERM ITSELF — the arithmetic that moves when a workspace ingests
 * a real feed, tested on its own rather than inferred from a composite.
 *
 * A composite assertion would pass for the wrong reason the first time any other
 * component moved, and the whole point of these is that the number is going to
 * be quoted back by a planner asking why their score fell.
 */
describe("the accessibility score's transit term", () => {
  it("is stop density alone when the source cannot speak to frequency", () => {
    // 5 stops/sq mi × 2.2 = 11 points, exactly what it was before the split. A
    // workspace that has ingested no feed must score today what it scored
    // yesterday, and this is the assertion that says so.
    expect(
      accessibilityTransitTerm({ stopsPerSqMile: 5, frequentServiceShare: null, measuresFrequency: false })
    ).toBe(11);
    expect(
      accessibilityTransitTerm({ stopsPerSqMile: 20, frequentServiceShare: null, measuresFrequency: false })
    ).toBe(20);
  });

  it("splits into half density and half frequent-service share when it can", () => {
    // Saturated density (≥ 9.1 stops/sq mi) is 10 of the 20 points, and the
    // frequent-service share fills the rest in proportion.
    const at = (share: number) =>
      accessibilityTransitTerm({ stopsPerSqMile: 20, frequentServiceShare: share, measuresFrequency: true });
    expect(at(0)).toBe(10);
    expect(at(0.5)).toBe(15);
    expect(at(1)).toBe(20);
  });

  it("keeps the same density saturation point, rather than halving the ceiling", () => {
    // Halving the CEILING (`min(10, density × 2.2)`) would saturate at 4.5 stops
    // per square mile and quietly redefine what a dense corridor is. Halving the
    // CURVE keeps the 9.1 the whole term always had, so these two differ.
    expect(
      accessibilityTransitTerm({ stopsPerSqMile: 4.55, frequentServiceShare: 0, measuresFrequency: true })
    ).toBeCloseTo(5.005, 3);
    expect(
      accessibilityTransitTerm({ stopsPerSqMile: 9.1, frequentServiceShare: 0, measuresFrequency: true })
    ).toBe(10);
  });

  it("never exceeds the term's ceiling, whatever it is handed", () => {
    // The ceiling is what makes the composite's weighting stable. A share above
    // 1 (a corrupt or hand-edited run) must not be able to inflate it.
    expect(
      accessibilityTransitTerm({ stopsPerSqMile: 1000, frequentServiceShare: 4, measuresFrequency: true })
    ).toBe(20);
    expect(
      accessibilityTransitTerm({ stopsPerSqMile: 1000, frequentServiceShare: -3, measuresFrequency: true })
    ).toBe(10);
  });

  it("treats a share that is not a number as no opinion when the source has none", () => {
    // `undefined` is what a run persisted before this field existed carries.
    // Reaching the arithmetic with it produced a NaN accessibility score, which
    // renders as the literal text "NaN" in a headline tile.
    const legacy = accessibilityTransitTerm({
      stopsPerSqMile: 5,
      frequentServiceShare: undefined as unknown as number | null,
    });
    expect(legacy).toBe(11);
    expect(Number.isNaN(accessibilityTransitTerm({ stopsPerSqMile: 5, frequentServiceShare: NaN }))).toBe(false);
  });

  it("fills ZERO of the frequency half when a frequency-capable source could not state a share", () => {
    // THE INVERSION THIS REPLACED. Handing the unmeasured half back as density
    // made a partial-coverage GTFS run score 6.45 points ABOVE a full-coverage
    // one over identical stops. Withholding is now identical to measuring zero,
    // which is the floor of measuring rather than the ceiling.
    const withheld = accessibilityTransitTerm({
      stopsPerSqMile: 5,
      frequentServiceShare: null,
      measuresFrequency: true,
    });
    expect(withheld).toBe(5.5);
    expect(withheld).toBe(
      accessibilityTransitTerm({ stopsPerSqMile: 5, frequentServiceShare: 0, measuresFrequency: true })
    );
    // And a NaN share from a frequency-capable source is still not NaN out.
    expect(
      Number.isNaN(
        accessibilityTransitTerm({ stopsPerSqMile: 5, frequentServiceShare: NaN, measuresFrequency: true })
      )
    ).toBe(false);
  });
});

/**
 * THE MEASURED SCORE DELTA A WORKSPACE SEES WHEN IT INGESTS A REAL FEED.
 *
 * This is the support question written as a test. The corridor below is
 * transit-rich enough for density to saturate under both sources — which is the
 * case where the drop is largest and therefore the one somebody will report.
 */
describe("what ingesting a feed does to the same corridor's score", () => {
  const OSM_RUN = transitSummary({ stopsPerSqMile: 12, totalStops: 96 });
  const GTFS_RUN = transitSummary({
    stopsPerSqMile: 12,
    totalStops: 96,
    source: "gtfs-feed",
    measuresFrequency: true,
    frequentServiceShare: 0.1,
    frequentServiceStops: 10,
    frequentServiceHeadwayMinutes: 15,
    method: gtfsServiceLevelMethod(true),
  });

  it("falls, and by an amount a planner can be told in advance", () => {
    const osm = score(OSM_RUN);
    const gtfs = score(GTFS_RUN);

    // 20 points of transit term become 10 (saturated density, halved) + 1
    // (a tenth of the frequent-service half): a nine-point fall in accessibility.
    expect(osm.accessibilityScore - gtfs.accessibilityScore).toBe(9);
    // Accessibility is 35% of the composite, so the overall score moves by ~3.
    expect(osm.overallScore - gtfs.overallScore).toBe(3);
  });

  it("does not fall when the ingested feed is actually frequent", () => {
    const frequent = score(
      transitSummary({
        stopsPerSqMile: 12,
        source: "gtfs-feed",
        measuresFrequency: true,
        frequentServiceShare: 1,
        method: gtfsServiceLevelMethod(true),
      })
    );
    // A corridor where every stop meets the headway scores exactly what the OSM
    // tally gave it. The change is not a penalty for using better data.
    expect(frequent.accessibilityScore).toBe(score(OSM_RUN).accessibilityScore);
  });
});
