import { describe, expect, it } from "vitest";

import {
  NEVADA_COUNTY_BUYER_EVIDENCE_BRIEF,
  NEVADA_COUNTY_CAVEATS_VERBATIM,
  NEVADA_COUNTY_DEMO_STORY_BEATS,
  NEVADA_COUNTY_PROOF_DOC_PATH,
  NEVADA_COUNTY_RUN_CONTEXT,
  NEVADA_COUNTY_SCREENING_GATE,
  NEVADA_COUNTY_VALIDATION_METRICS,
  buildNevadaCountyBuyerEvidenceBriefText,
  nevadaCountyMaxApeRow,
} from "@/lib/examples/nevada-county-2026-03-24";

const FORBIDDEN_BUYER_CLAIMS = [
  /validated forecast/i,
  /certified calibration/i,
  /live run/i,
  /production data seeded/i,
  /automatic workspace provisioning/i,
  /instant customer activation/i,
  /checkout/i,
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

  it("generates a copyable buyer evidence brief from the same caveated catalog", () => {
    const brief = buildNevadaCountyBuyerEvidenceBriefText();

    expect(NEVADA_COUNTY_BUYER_EVIDENCE_BRIEF.posture).toBe(
      "internal prototype only; screening-grade only; not production model validation",
    );
    expect(brief).toContain("Nevada County buyer evidence brief");
    expect(brief).toContain("internal prototype only");
    expect(brief).toContain("237.62% Max APE");
    expect(brief).toContain("screening-grade only");
    expect(brief).toContain("does not prove current runtime state");
    expect(brief).toContain("Scope one supervised first workflow");

    for (const forbiddenClaim of FORBIDDEN_BUYER_CLAIMS) {
      expect(brief).not.toMatch(forbiddenClaim);
    }
  });

  it("keeps demo story beats static, supervised, and buyer-safe", () => {
    expect(NEVADA_COUNTY_DEMO_STORY_BEATS).toHaveLength(3);
    expect(NEVADA_COUNTY_DEMO_STORY_BEATS.map((beat) => beat.label)).toEqual([
      "Geography",
      "Evidence stress test",
      "Service next step",
    ]);

    const storyCopy = NEVADA_COUNTY_DEMO_STORY_BEATS.map((beat) =>
      [beat.label, beat.title, beat.detail].join(" "),
    ).join("\n");

    expect(storyCopy).toMatch(/not a full regional travel model or adopted RTP finding/i);
    expect(storyCopy).toMatch(/failed validation remains visible/i);
    expect(storyCopy).toMatch(/what geography, data owner, review path, and hosting model/i);

    for (const forbiddenClaim of FORBIDDEN_BUYER_CLAIMS) {
      expect(storyCopy).not.toMatch(forbiddenClaim);
    }
  });
});
