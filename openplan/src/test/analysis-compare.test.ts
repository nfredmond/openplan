import { describe, expect, it } from "vitest";
import { buildMetricDeltas, deltaTone, formatDelta } from "@/lib/analysis/compare";
import {
  OSM_STOP_INVENTORY_METHOD,
  gtfsServiceLevelMethod,
} from "@/lib/data-sources/transit/method";

/**
 * The transit provenance `/api/analysis` writes on every run it stores.
 *
 * A fixture without it describes a run from before that record existed, and the
 * transit-sensitive metrics of such a run are deliberately not subtractable —
 * see the last test in this file. An ordinary comparison test should describe an
 * ordinary run.
 */
const transitProvenance = { transit: { source: "osm-overpass", observed: true, method: OSM_STOP_INVENTORY_METHOD } };

describe("analysis comparison utilities", () => {
  it("computes numeric deltas for known metrics", () => {
    const deltas = buildMetricDeltas(
      { overallScore: 72, accessibilityScore: 80, safetyScore: 60, sourceSnapshots: transitProvenance },
      { overallScore: 64, accessibilityScore: 75, safetyScore: 65, sourceSnapshots: transitProvenance }
    );

    const overall = deltas.find((d) => d.key === "overallScore");
    const safety = deltas.find((d) => d.key === "safetyScore");

    expect(overall?.delta).toBe(8);
    expect(overall?.deltaPct).toBe(12.5);
    expect(safety?.delta).toBe(-5);
  });

  /**
   * A RUN THAT NEVER STATED ITS MEASUREMENT IS NOT COMPARABLE, EVEN TO ANOTHER
   * SILENT RUN.
   *
   * Two `not-recorded` methods produce the same comparability key, so a plain
   * key comparison permitted the subtraction — which is how two model runs
   * measured two different ways subtracted cleanly on the scenario board, both
   * being equally silent. Matching keys are evidence of a matching measurement
   * only when both runs stated one.
   *
   * Note what is NOT refused: `safetyScore` and the census metrics, which no
   * transit source moves. Flagging those would train a reader to skip the badge.
   */
  it("refuses the transit-sensitive metrics of a run that recorded no transit method", () => {
    const deltas = buildMetricDeltas(
      { overallScore: 72, accessibilityScore: 80, safetyScore: 60 },
      { overallScore: 64, accessibilityScore: 75, safetyScore: 65 }
    );

    const overall = deltas.find((d) => d.key === "overallScore")!;
    expect(overall.incomparable).toBe(true);
    expect(overall.delta).toBeNull();
    expect(overall.incomparableReason).toMatch(/did not record how transit was measured/i);
    // Both values survive, so a reader still sees the evidence side by side.
    expect(overall.current).toBe(72);
    expect(overall.baseline).toBe(64);

    const safety = deltas.find((d) => d.key === "safetyScore")!;
    expect(safety.incomparable).toBe(false);
    expect(safety.delta).toBe(-5);
  });

  /**
   * COMPARABILITY IS A PROPERTY OF THE PAIR, AND EVERY FIXTURE ABOVE IS
   * SYMMETRIC — WHICH IS WHY NOTHING HERE COULD SEE IT.
   *
   * Either both runs carry `transitProvenance` or neither does, so
   * `baselineMetrics` was never distinguishable from `currentMetrics`. Mutation
   * proved the consequence: `resolveTransitMethod(baselineMetrics)` changed to
   * `resolveTransitMethod(currentMetrics)` — comparing the run's method against
   * ITSELF, so the "measured differently" refusal can never fire — left all four
   * tests green, and a probe against the mutated module rendered
   * `Transit Stops −412` and `Overall Score +8` with `incomparable: false`.
   * That is verbatim the defect `compare.ts` and `transit/method.ts` exist to
   * prevent: it reads as SERVICE SHRANK and means THE MEASUREMENT CHANGED.
   *
   * The three transit-sensitive keys are asserted individually on purpose. Two
   * further mutations, dropping `accessibilityScore` and dropping
   * `totalTransitStops` from `TRANSIT_SENSITIVE_METRIC_KEYS`, also survived —
   * only `overallScore` was ever exercised.
   */
  it("refuses to subtract the transit-sensitive metrics of a GTFS run from an OSM run", () => {
    const gtfs = { transit: { source: "gtfs-feed", observed: true, method: gtfsServiceLevelMethod(true) } };
    const osm = { transit: { source: "osm-overpass", observed: true, method: OSM_STOP_INVENTORY_METHOD } };

    const deltas = buildMetricDeltas(
      {
        overallScore: 72,
        accessibilityScore: 80,
        totalTransitStops: 1084,
        safetyScore: 60,
        sourceSnapshots: gtfs,
      },
      {
        overallScore: 64,
        accessibilityScore: 75,
        totalTransitStops: 1496,
        safetyScore: 65,
        sourceSnapshots: osm,
      }
    );

    for (const key of ["totalTransitStops", "accessibilityScore", "overallScore"]) {
      const metric = deltas.find((d) => d.key === key)!;
      expect(metric.incomparable, `${key} must not be subtractable across methods`).toBe(true);
      expect(metric.delta, `${key} must render no delta`).toBeNull();
      expect(metric.deltaPct).toBeNull();
      expect(metric.incomparableReason).toMatch(/measured differently/i);
    }

    // Both figures still show, side by side — the refusal withholds the
    // subtraction, not the evidence.
    expect(deltas.find((d) => d.key === "totalTransitStops")!.current).toBe(1084);
    expect(deltas.find((d) => d.key === "totalTransitStops")!.baseline).toBe(1496);

    // And nothing a transit source cannot move is flagged. Marking these would
    // train a reader to skip the badge, which is how a caveat stops working.
    const safety = deltas.find((d) => d.key === "safetyScore")!;
    expect(safety.incomparable).toBe(false);
    expect(safety.delta).toBe(-5);
  });

  /** The same pair the other way round: the refusal is symmetric. */
  it("refuses in the other direction too (OSM current, GTFS baseline)", () => {
    const gtfs = { transit: { source: "gtfs-feed", observed: true, method: gtfsServiceLevelMethod(true) } };
    const osm = { transit: { source: "osm-overpass", observed: true, method: OSM_STOP_INVENTORY_METHOD } };

    const deltas = buildMetricDeltas(
      { overallScore: 64, totalTransitStops: 1496, sourceSnapshots: osm },
      { overallScore: 72, totalTransitStops: 1084, sourceSnapshots: gtfs }
    );

    expect(deltas.find((d) => d.key === "overallScore")!.incomparable).toBe(true);
    expect(deltas.find((d) => d.key === "totalTransitStops")!.incomparable).toBe(true);
  });

  /** Two runs measured the SAME way still subtract — the refusal is not blanket. */
  it("still subtracts two runs that recorded the same method", () => {
    const gtfs = { transit: { source: "gtfs-feed", observed: true, method: gtfsServiceLevelMethod(true) } };

    const deltas = buildMetricDeltas(
      { totalTransitStops: 1100, sourceSnapshots: gtfs },
      { totalTransitStops: 1000, sourceSnapshots: gtfs }
    );

    const stops = deltas.find((d) => d.key === "totalTransitStops")!;
    expect(stops.incomparable).toBe(false);
    expect(stops.delta).toBe(100);
  });

  it("handles missing values gracefully", () => {
    const deltas = buildMetricDeltas({ accessibilityScore: 70 }, { accessibilityScore: "n/a" });
    const accessibility = deltas.find((d) => d.key === "accessibilityScore");

    expect(accessibility?.delta).toBeNull();
    expect(accessibility?.deltaPct).toBeNull();
    expect(formatDelta(accessibility?.delta ?? null)).toBe("N/A");
  });

  it("returns expected tone labels", () => {
    expect(deltaTone(3)).toBe("up");
    expect(deltaTone(-1)).toBe("down");
    expect(deltaTone(0)).toBe("flat");
    expect(deltaTone(null)).toBe("na");
  });
});
