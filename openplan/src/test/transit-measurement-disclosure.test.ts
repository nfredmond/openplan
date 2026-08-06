import { describe, expect, it } from "vitest";

import { buildMetricDeltas, TRANSIT_SENSITIVE_METRIC_KEYS } from "@/lib/analysis/compare";
import {
  NOT_MEASURED_METHOD,
  NOT_RECORDED_METHOD,
  OSM_STOP_INVENTORY_METHOD,
  gtfsServiceLevelMethod,
  resolveTransitMethod,
  transitComparabilityRefusal,
  transitMethodComparabilityKey,
  transitMethodLine,
} from "@/lib/data-sources/transit/method";

/**
 * THE MEASUREMENT TRAVELS WITH THE NUMBER — the three disclosure sites, and the
 * reading rules that make them survive.
 *
 * A workspace that ingests its agency's GTFS feed can watch the same corridor's
 * accessibility score fall by up to nine points. That is correct — a published
 * schedule is better evidence about service than a tally of OpenStreetMap stop
 * nodes — but it is also the support question, and a planner who cannot see WHY
 * will conclude the product is broken or, worse, will not notice and will put
 * two incompatible numbers in one document.
 *
 * Site (a), the run snapshot's `method`, is asserted in
 * `analysis-route-grounding.test.ts` where the run is actually persisted.
 * Site (b), the corridor report's method line, is asserted in
 * `report-route.test.ts` where the HTML is actually rendered.
 * Site (c) and the reading rules are here.
 */

function metricsWith(transit: Record<string, unknown> | undefined, over: Record<string, unknown> = {}) {
  return {
    overallScore: 70,
    accessibilityScore: 68,
    safetyScore: 72,
    equityScore: 74,
    totalTransitStops: 1_500,
    totalFatalCrashes: 3,
    pctDisadvantaged: 40,
    pctZeroVehicle: 12,
    ...(transit ? { sourceSnapshots: { transit } } : {}),
    ...over,
  };
}

describe("reading the transit method off a stored run", () => {
  it("uses the method the run recorded, verbatim", () => {
    const method = gtfsServiceLevelMethod(true);
    expect(resolveTransitMethod(metricsWith({ source: "gtfs-feed", method }))).toEqual(method);
  });

  it("passes through a method this build has never heard of", () => {
    // A future source's runs must not be re-described by an older reader.
    const resolved = resolveTransitMethod(
      metricsWith({
        source: "national-feed-aggregator",
        method: { id: "some-future-method", label: "Future method", detail: "Because.", frequencyTermApplied: true },
      })
    );
    expect(resolved.id).toBe("some-future-method");
    expect(resolved.label).toBe("Future method");
    expect(resolved.frequencyTermApplied).toBe(true);
  });

  it("derives a legacy run's method from the source token it does carry", () => {
    // STORED RUNS ARE NEVER REWRITTEN. Every run stored before this module
    // existed used the OpenStreetMap inventory and the full density term, so this
    // is a reading of what happened rather than a guess about it — and
    // `frequencyTermApplied: false` is exactly what those scores were built with.
    const legacy = resolveTransitMethod(metricsWith({ source: "osm-overpass", observed: true }));
    expect(legacy).toEqual(OSM_STOP_INVENTORY_METHOD);
    expect(legacy.frequencyTermApplied).toBe(false);

    expect(resolveTransitMethod(metricsWith({ source: "unavailable", observed: false }))).toEqual(
      NOT_MEASURED_METHOD
    );
  });

  it("says NOT RECORDED rather than assuming one", () => {
    // Backfilling a method onto a run that carried none would be inventing
    // provenance for a number nobody can re-derive.
    expect(resolveTransitMethod(metricsWith(undefined))).toEqual(NOT_RECORDED_METHOD);
    expect(resolveTransitMethod(undefined)).toEqual(NOT_RECORDED_METHOD);
    expect(resolveTransitMethod(metricsWith({}))).toEqual(NOT_RECORDED_METHOD);
  });

  it("prints one line a report can put beside its transit figures", () => {
    const line = transitMethodLine(gtfsServiceLevelMethod(true));
    expect(line).toContain(gtfsServiceLevelMethod(true).label);
    expect(line).toContain("peak headway");
  });
});

describe("the comparability key", () => {
  it("separates two sources, and separates one source from itself with the term withheld", () => {
    const withFrequency = transitMethodComparabilityKey(gtfsServiceLevelMethod(true));
    const withoutFrequency = transitMethodComparabilityKey(gtfsServiceLevelMethod(false));
    const osm = transitMethodComparabilityKey(OSM_STOP_INVENTORY_METHOD);

    expect(new Set([withFrequency, withoutFrequency, osm]).size).toBe(3);
    // Same method, same key: two runs of the same corridor a month apart are the
    // ordinary case and must stay subtractable.
    expect(transitMethodComparabilityKey(gtfsServiceLevelMethod(true))).toBe(withFrequency);
  });

  it("refuses across methods and permits within one", () => {
    expect(transitComparabilityRefusal(gtfsServiceLevelMethod(true), gtfsServiceLevelMethod(true))).toBeNull();
    expect(
      transitComparabilityRefusal(gtfsServiceLevelMethod(true), OSM_STOP_INVENTORY_METHOD)
    ).toMatch(/measured differently/i);
  });
});

describe("two runs measured differently do not subtract", () => {
  const gtfsRun = metricsWith(
    { source: "gtfs-feed", observed: true, method: gtfsServiceLevelMethod(true) },
    { totalTransitStops: 1_500, accessibilityScore: 68, overallScore: 70 }
  );
  const osmRun = metricsWith(
    { source: "osm-overpass", observed: true, method: OSM_STOP_INVENTORY_METHOD },
    { totalTransitStops: 1_088, accessibilityScore: 77, overallScore: 73 }
  );

  it("renders no delta where one would read as service growing", () => {
    const deltas = buildMetricDeltas(gtfsRun, osmRun);
    const stops = deltas.find((delta) => delta.key === "totalTransitStops")!;

    // "+412 (+38%)" is what this used to say. It reads as SERVICE GREW and means
    // THE MEASUREMENT CHANGED.
    expect(stops.incomparable).toBe(true);
    expect(stops.delta).toBeNull();
    expect(stops.deltaPct).toBeNull();
    // Both values survive so a reader can still see them side by side; it is the
    // SUBTRACTION that is refused, not the evidence.
    expect(stops.current).toBe(1_500);
    expect(stops.baseline).toBe(1_088);
    expect(stops.incomparableReason).toMatch(/change in how transit was measured/i);
  });

  /**
   * THE METRICS ARE NAMED HERE, not read off the constant that produces them.
   *
   * This assertion used to be `expect(new Set(incomparable)).toEqual(
   * TRANSIT_SENSITIVE_METRIC_KEYS)` — a comparison of the result against the very
   * constant under test, which passes for ANY value of that constant. Adding
   * `safetyScore` or `pctZeroVehicle` to the set would have flagged metrics
   * nothing about the transit source moves, and the test would have agreed.
   *
   * Over-flagging is not the safe direction. A card that marks four unrelated
   * metrics "Not comparable" trains a planner to read past the badge, and then
   * the one flag that matters — the accessibility delta that is an artefact of
   * the measurement — reads like the rest of the noise.
   */
  const EXPECTED_TRANSIT_SENSITIVE = ["totalTransitStops", "accessibilityScore", "overallScore"];

  it("refuses the two scores the transit term feeds, and nothing else", () => {
    const deltas = buildMetricDeltas(gtfsRun, osmRun);
    const incomparable = deltas.filter((delta) => delta.incomparable).map((delta) => delta.key);

    // `accessibilityScore` carries the transit term directly and `overallScore`
    // is 35% accessibility. `safetyScore`, `equityScore` and the census metrics
    // do not move with the transit source.
    expect([...incomparable].sort()).toEqual([...EXPECTED_TRANSIT_SENSITIVE].sort());

    for (const key of ["safetyScore", "equityScore", "totalFatalCrashes", "pctDisadvantaged", "pctZeroVehicle"]) {
      expect(incomparable, `${key} does not move with the transit source`).not.toContain(key);
    }

    const safety = deltas.find((delta) => delta.key === "safetyScore")!;
    expect(safety.delta).toBe(0);
    expect(safety.incomparable).toBe(false);
  });

  it("keeps the exported set to exactly those three, so a widening cannot ride in unnoticed", () => {
    // The constant is asserted SEPARATELY from the behaviour, by name. It is
    // exported and read by anything that renders a comparison, so widening it is
    // a product decision rather than a refactor.
    expect([...TRANSIT_SENSITIVE_METRIC_KEYS].sort()).toEqual([...EXPECTED_TRANSIT_SENSITIVE].sort());
  });

  it("subtracts normally when both runs used the same measurement", () => {
    const laterGtfsRun = metricsWith(
      { source: "gtfs-feed", observed: true, method: gtfsServiceLevelMethod(true) },
      { totalTransitStops: 1_520, accessibilityScore: 69, overallScore: 71 }
    );

    const deltas = buildMetricDeltas(laterGtfsRun, gtfsRun);
    expect(deltas.every((delta) => !delta.incomparable)).toBe(true);
    expect(deltas.find((delta) => delta.key === "totalTransitStops")!.delta).toBe(20);
    // A real service change between two like-measured runs is exactly what this
    // comparison exists to show, and it must still show it.
    expect(deltas.find((delta) => delta.key === "accessibilityScore")!.delta).toBe(1);
  });

  it("distinguishes 'not comparable' from 'one run has no value'", () => {
    const noSafety = metricsWith(
      { source: "gtfs-feed", observed: true, method: gtfsServiceLevelMethod(true) },
      { safetyScore: null }
    );

    const deltas = buildMetricDeltas(noSafety, gtfsRun);
    const safety = deltas.find((delta) => delta.key === "safetyScore")!;

    // Both are a null delta and they are different findings: one says a run had
    // no number, the other says both did and they may not be subtracted.
    expect(safety.delta).toBeNull();
    expect(safety.incomparable).toBe(false);
    expect(safety.incomparableReason).toBeNull();
  });
});
