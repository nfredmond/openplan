import { describe, expect, it } from "vitest";
import { buildMetricDeltas, deltaTone, formatDelta } from "@/lib/analysis/compare";
import { OSM_STOP_INVENTORY_METHOD } from "@/lib/data-sources/transit/method";

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
