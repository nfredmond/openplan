import { describe, expect, it } from "vitest";

import {
  NEVADA_COUNTY_CAVEATS_VERBATIM,
  NEVADA_COUNTY_PROOF_DOC_PATH,
  NEVADA_COUNTY_RUN_CONTEXT,
  NEVADA_COUNTY_SCREENING_GATE,
  NEVADA_COUNTY_VALIDATION_METRICS,
  nevadaCountyMaxApeRow,
} from "@/lib/examples/nevada-county-2026-03-24";

const FORBIDDEN_CLAIMS = [
  /validated forecast/i,
  /certified calibration/i,
  /live run/i,
  /production data seeded/i,
  /automatic workspace provisioning/i,
  /instant customer activation/i,
  /checkout/i,
  /\bbuyers?\b/i,
  /supervised/i,
];

describe("Nevada County evidence fixture", () => {
  it("preserves the internal-prototype validation gate and uncomfortable Max APE caveat", () => {
    expect(NEVADA_COUNTY_RUN_CONTEXT.runId).toBe("nevada-county-runtime-norenumber-freeze-20260324");
    expect(NEVADA_COUNTY_SCREENING_GATE.statusLabel).toBe("internal prototype only");
    expect(NEVADA_COUNTY_SCREENING_GATE.reason).toContain("237.62% absolute percent error");
    expect(nevadaCountyMaxApeRow()).toMatchObject({
      label: "Max APE",
      value: "237.62%",
    });
    expect(nevadaCountyMaxApeRow().note).toMatch(/disqualifies this run from outward modeling claims/i);
    expect(NEVADA_COUNTY_PROOF_DOC_PATH).toBe(
      "docs/ops/2026-04-18-modeling-nevada-county-live-proof.md",
    );
    expect(NEVADA_COUNTY_CAVEATS_VERBATIM).toContain("screening-grade only");
    expect(NEVADA_COUNTY_VALIDATION_METRICS.map((metric) => metric.label)).toContain("Spearman ρ (facility ranking)");
  });

  it("keeps every string in the catalog free of overclaims and sales-era framing", () => {
    const catalogText = [
      NEVADA_COUNTY_SCREENING_GATE.statusLabel,
      NEVADA_COUNTY_SCREENING_GATE.reason,
      ...NEVADA_COUNTY_CAVEATS_VERBATIM,
      ...NEVADA_COUNTY_VALIDATION_METRICS.flatMap((m) => [m.label, m.value, m.note ?? ""]),
      NEVADA_COUNTY_RUN_CONTEXT.engine,
      NEVADA_COUNTY_RUN_CONTEXT.countsSource,
      NEVADA_COUNTY_PROOF_DOC_PATH,
    ].join("\n");

    for (const forbiddenClaim of FORBIDDEN_CLAIMS) {
      expect(catalogText).not.toMatch(forbiddenClaim);
    }
  });
});
