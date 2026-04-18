import { describe, expect, it } from "vitest";
import {
  NEVADA_COUNTY_CAVEATS_VERBATIM,
  NEVADA_COUNTY_FACILITY_RANKING,
  NEVADA_COUNTY_PROOF_DOC_PATH,
  NEVADA_COUNTY_RUN_CONTEXT,
  NEVADA_COUNTY_RUN_NAME,
  NEVADA_COUNTY_SCREENING_GATE,
  NEVADA_COUNTY_VALIDATION_METRICS,
  isValidatedNevadaCountyRun,
  nevadaCountyMaxApeRow,
} from "@/lib/examples/nevada-county-2026-03-24";

describe("Nevada County evidence catalog (2026-03-24)", () => {
  it("pins the validated run identifier", () => {
    expect(NEVADA_COUNTY_RUN_NAME).toBe(
      "nevada-county-runtime-norenumber-freeze-20260324"
    );
    expect(NEVADA_COUNTY_RUN_CONTEXT.runId).toBe(NEVADA_COUNTY_RUN_NAME);
  });

  it("preserves the screening gate verbatim", () => {
    expect(NEVADA_COUNTY_SCREENING_GATE.statusLabel).toBe(
      "internal prototype only"
    );
    expect(NEVADA_COUNTY_SCREENING_GATE.reason).toContain("237.62%");
    expect(NEVADA_COUNTY_SCREENING_GATE.reason).toContain("50.00% critical-facility threshold");
  });

  it("preserves the five caveats verbatim in order", () => {
    expect(NEVADA_COUNTY_CAVEATS_VERBATIM).toHaveLength(5);
    expect(NEVADA_COUNTY_CAVEATS_VERBATIM).toEqual([
      "screening-grade only",
      "OSM default speeds/capacities",
      "tract fragments are not calibrated TAZs",
      "jobs are estimated from tract-scale demographic proxies",
      "external gateways are inferred from major boundary-crossing roads",
    ]);
  });

  it("pins the max APE validation metric", () => {
    const maxApe = nevadaCountyMaxApeRow();
    expect(maxApe.label).toBe("Max APE");
    expect(maxApe.value).toBe("237.62%");
    expect(maxApe.note).toBeDefined();
    expect(maxApe.note).toContain("50% critical-facility threshold");
  });

  it("contains five validation stations with obs/mod ranks", () => {
    expect(NEVADA_COUNTY_FACILITY_RANKING).toHaveLength(5);
    const highestObserved = NEVADA_COUNTY_FACILITY_RANKING.find((r) => r.obsRank === 1);
    expect(highestObserved?.station).toBe("SR 20 at Jct Rte 49");
  });

  it("surfaces the seven headline validation metrics", () => {
    expect(NEVADA_COUNTY_VALIDATION_METRICS).toHaveLength(7);
    const labels = NEVADA_COUNTY_VALIDATION_METRICS.map((row) => row.label);
    expect(labels).toContain("Stations total");
    expect(labels).toContain("Max APE");
    expect(labels).toContain("Spearman ρ (facility ranking)");
  });

  it("points at the operator-facing proof doc", () => {
    expect(NEVADA_COUNTY_PROOF_DOC_PATH).toBe(
      "docs/ops/2026-04-18-modeling-nevada-county-live-proof.md"
    );
  });

  describe("isValidatedNevadaCountyRun", () => {
    it("matches only the canonical run name", () => {
      expect(isValidatedNevadaCountyRun(NEVADA_COUNTY_RUN_NAME)).toBe(true);
      expect(isValidatedNevadaCountyRun("some-other-run")).toBe(false);
    });

    it("handles null and undefined safely", () => {
      expect(isValidatedNevadaCountyRun(null)).toBe(false);
      expect(isValidatedNevadaCountyRun(undefined)).toBe(false);
      expect(isValidatedNevadaCountyRun("")).toBe(false);
    });
  });
});
