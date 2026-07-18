import { describe, expect, it } from "vitest";
import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import {
  buildBcaScreeningFactClaims,
  buildLatestBcaScreeningByProjectId,
  parseStoredBcaScreening,
  summarizeBcaScreeningForCue,
  type ProjectBcaScreeningRowLike,
} from "@/lib/grants/bca-evidence";

const RESULT_JSON = {
  netPresentValue: 250000.5,
  benefitCostRatio: 1.2534,
  presentValueBenefits: 1250000,
  presentValueCosts: 999999.5,
  internalRateOfReturnPct: 7.2,
  paybackYearsDiscounted: 12.4,
  baseYear: 2026,
  analysisHorizonYears: 20,
  discountRatePct: 3.1,
  co2DiscountRatePct: 3,
};

function row(overrides: Partial<ProjectBcaScreeningRowLike> = {}): ProjectBcaScreeningRowLike {
  return {
    id: "bca-1",
    project_id: "project-1",
    result_json: RESULT_JSON,
    engine_version: "openplan-bca-ts",
    created_at: "2026-07-18T20:00:00.000Z",
    ...overrides,
  };
}

describe("parseStoredBcaScreening", () => {
  it("parses a server-derived result row", () => {
    const parsed = parseStoredBcaScreening(row());
    expect(parsed).toMatchObject({
      id: "bca-1",
      projectId: "project-1",
      netPresentValue: 250000.5,
      benefitCostRatio: 1.2534,
      analysisHorizonYears: 20,
      discountRatePct: 3.1,
      engineVersion: "openplan-bca-ts",
    });
  });

  it("accepts a null benefitCostRatio (no discounted costs) but rejects a non-finite one", () => {
    expect(
      parseStoredBcaScreening(row({ result_json: { ...RESULT_JSON, benefitCostRatio: null } }))
        ?.benefitCostRatio
    ).toBeNull();
    expect(
      parseStoredBcaScreening(row({ result_json: { ...RESULT_JSON, benefitCostRatio: "1.2" } }))
    ).toBeNull();
  });

  it("returns null for malformed stored payloads instead of guessing", () => {
    expect(parseStoredBcaScreening(row({ result_json: null }))).toBeNull();
    expect(parseStoredBcaScreening(row({ result_json: "not json" }))).toBeNull();
    expect(
      parseStoredBcaScreening(row({ result_json: { ...RESULT_JSON, netPresentValue: "250000" } }))
    ).toBeNull();
    expect(
      parseStoredBcaScreening(row({ result_json: { netPresentValue: 1 } }))
    ).toBeNull();
    expect(parseStoredBcaScreening(null)).toBeNull();
  });
});

describe("buildLatestBcaScreeningByProjectId", () => {
  it("keeps the first (newest) parseable row per project", () => {
    const map = buildLatestBcaScreeningByProjectId([
      row({ id: "new", created_at: "2026-07-18T20:00:00.000Z" }),
      row({ id: "old", created_at: "2026-07-17T20:00:00.000Z" }),
      row({ id: "other-project", project_id: "project-2" }),
    ]);
    expect(map.get("project-1")?.id).toBe("new");
    expect(map.get("project-2")?.id).toBe("other-project");
  });

  it("falls through to the next row when the newest is malformed", () => {
    const map = buildLatestBcaScreeningByProjectId([
      row({ id: "broken", result_json: { junk: true } }),
      row({ id: "good", created_at: "2026-07-16T20:00:00.000Z" }),
    ]);
    expect(map.get("project-1")?.id).toBe("good");
  });
});

describe("buildBcaScreeningFactClaims", () => {
  it("produces self-contained sentences that end with the one-sentence narrative caveat", () => {
    const claims = buildBcaScreeningFactClaims(parseStoredBcaScreening(row())!, "SR-49 Corridor");
    expect(claims).toHaveLength(2);
    for (const claim of claims) {
      expect(claim.endsWith(BCA_NARRATIVE_CAVEAT)).toBe(true);
    }
    // The narrative caveat is a single sentence so a cited fact stays grounded.
    expect(BCA_NARRATIVE_CAVEAT.split(". ").length).toBe(1);
    expect(claims[0]).toContain("the SR-49 Corridor project");
    expect(claims[0]).toContain("benefit-cost ratio of 1.25");
    expect(claims[0]).toContain("$250,001");
    expect(claims[0]).toContain("Jul 18, 2026");
    expect(claims[1]).toContain("$1,250,000");
    expect(claims[1]).toContain("engine openplan-bca-ts");
  });

  it("states plainly when no BCR was computable", () => {
    const summary = parseStoredBcaScreening(
      row({ result_json: { ...RESULT_JSON, benefitCostRatio: null } })
    )!;
    const claims = buildBcaScreeningFactClaims(summary, null);
    expect(claims[0]).toContain("no benefit-cost ratio was computable");
    expect(claims[0]).toContain("the linked project");
    // Regression: the null case used to splice into "computed <clause> and a
    // net present value", producing an ungrammatical, misreadable sentence.
    expect(claims[0]).not.toContain("computed no benefit-cost ratio");
    expect(claims[0]).toContain("computed a net present value");
  });
});

describe("summarizeBcaScreeningForCue", () => {
  it("compresses the screening into one honest line", () => {
    const line = summarizeBcaScreeningForCue(parseStoredBcaScreening(row())!);
    expect(line).toBe("Saved Jul 18, 2026: BCR 1.25, NPV $250,001 over 20 years.");
  });
});
