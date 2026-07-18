import { describe, expect, it } from "vitest";

import { computeBenefitCostAnalysis } from "@/lib/bca/engine";
import { runBcaMonteCarlo } from "@/lib/bca/monte-carlo";
import {
  BCA_ENGINE_VERSION,
  BCA_METHOD_CITATION,
  BCA_SCREENING_CAVEAT,
} from "@/lib/bca/parameters";
import { bcaFactBlocks, formatUsd, renderBcaMemoMarkdown } from "@/lib/bca/render";
import type { BcaAnalysisInputs } from "@/lib/bca/types";

// Clean re-implementation informed by DOT-Dashboard's benefit-cost-service.ts
// (reference only — NOT a line-port). The renderer follows the planner-pack
// memo style: pinned screening caveat, Citations section, and explicit
// sentences for non-computable metrics instead of blanks. Harvest bugs fixed
// upstream and visible here: BCR=0-on-zero-costs (renders as "not
// computable"), IRR never computed (renders a real value or the explicit
// null sentence).

const GENERATED_AT = "2026-07-17T00:00:00Z";

// BCR-golden fixture (see bca-engine.test.ts): pvB = 1,137,236.03,
// pvC = 909,090.91, BCR = 1.2510, NPV = 228,145.12, IRR = 25.68%,
// discounted payback = 3.80 years.
const fullInputs: BcaAnalysisInputs = {
  baseYear: 2026,
  analysisHorizonYears: 5,
  discountRatePct: 10,
  benefits: [{ kind: "other", label: "Access benefit", annualValue: 300_000 }],
  costs: [{ kind: "capital", totalAmount: 1_000_000 }],
};
const fullResult = computeBenefitCostAnalysis(fullInputs, undefined, {
  generatedAt: GENERATED_AT,
});

// Benefits-only fixture: PV costs 0 -> BCR null; all-positive flows -> IRR
// null; cumulative positive from year one -> payback 0.
const benefitsOnlyResult = computeBenefitCostAnalysis(
  {
    baseYear: 2026,
    analysisHorizonYears: 3,
    discountRatePct: 10,
    benefits: [{ kind: "other", label: "Benefit", annualValue: 50_000 }],
    costs: [],
  },
  undefined,
  { generatedAt: GENERATED_AT }
);

describe("formatUsd", () => {
  it("formats whole-dollar USD", () => {
    expect(formatUsd(1_234_567.89)).toBe("$1,234,568");
    expect(formatUsd(-500)).toBe("-$500");
    expect(formatUsd(0)).toBe("$0");
  });
});

describe("renderBcaMemoMarkdown", () => {
  const memo = renderBcaMemoMarkdown(fullResult, { contextLabel: "Elm Street Corridor" });

  it("renders the determination with 2-decimal BCR, USD NPV, IRR and payback", () => {
    expect(memo).toContain("# Benefit-Cost Screening — Elm Street Corridor");
    // BCR 1.25095963... -> two decimals.
    expect(memo).toContain("- Benefit-cost ratio: **1.25**");
    // NPV 228145.12 -> whole-dollar USD.
    expect(memo).toContain("- Net present value: **$228,145**");
    expect(memo).toContain("(present-value benefits $1,137,236 minus present-value costs $909,091)");
    // IRR 25.679...% -> one decimal.
    expect(memo).toContain("- Internal rate of return: **25.7%**");
    // Payback 3.7957 -> one decimal.
    expect(memo).toContain("- Discounted payback: **3.8 years**");
  });

  it("lists assumptions and the line-item table", () => {
    expect(memo).toContain("- Base year (discounting epoch): **2026**; analysis years 2027–2031.");
    expect(memo).toContain("- Analysis horizon: **5 years**.");
    expect(memo).toContain("- Discount rate: **10%** real; CO2e stream discounted at **3%**.");
    // Undiscounted benefit total = 300000 * 5 = 1,500,000.
    expect(memo).toContain("| Access benefit | benefit:other | $1,500,000 | $1,137,236 |");
    expect(memo).toContain("| Capital cost | cost:capital | $1,000,000 | $909,091 |");
    expect(memo).toContain("- Present-value benefits: **$1,137,236**");
    expect(memo).toContain("- Present-value costs: **$909,091**");
  });

  it("pins the screening caveat verbatim as the first Notes line", () => {
    expect(memo).toContain(`## Notes\n\n- ${BCA_SCREENING_CAVEAT}\n`);
  });

  it("pins the screening caveat and method citation byte-exact", () => {
    expect(BCA_SCREENING_CAVEAT).toBe(
      "Screening-level benefit-cost estimate for internal prioritization and grant-readiness review — not a benefit-cost analysis of record. Confirm monetization values against the current USDOT Benefit-Cost Analysis Guidance before including results in an application."
    );
    expect(BCA_METHOD_CITATION).toBe(
      "USDOT Benefit-Cost Analysis Guidance for Discretionary Grant Programs; OMB Circular A-94 (2023 revision)."
    );
  });

  it("cites the method sources", () => {
    expect(memo).toContain(`## Citations\n\n- ${BCA_METHOD_CITATION}\n`);
  });

  it("uses the default engine version and honors an override", () => {
    expect(memo).toContain(`- Engine version: \`${BCA_ENGINE_VERSION}\``);
    const custom = renderBcaMemoMarkdown(fullResult, {
      contextLabel: "X",
      engineVersion: "bca-test-9",
    });
    expect(custom).toContain("- Engine version: `bca-test-9`");
  });

  it("renders explicit sentences for null IRR and null BCR, never blanks", () => {
    const nullMemo = renderBcaMemoMarkdown(benefitsOnlyResult, { contextLabel: "No costs" });
    expect(nullMemo).toContain("- Internal rate of return: not computable from these flows.");
    expect(nullMemo).toContain("- Benefit-cost ratio: not computable (present-value costs are zero).");
    // Immediately-positive project: payback is 0, not null.
    expect(nullMemo).toContain("- Discounted payback: **0.0 years**");
  });

  it("includes the Monte Carlo section with seed and iterations when given", () => {
    const monteCarlo = runBcaMonteCarlo(fullInputs, undefined, {
      seed: 42,
      iterations: 40,
      draws: [
        { target: "benefitScale", index: 0, spec: { distribution: "uniform", min: 0.9, max: 1.1 } },
      ],
    });
    const withMc = renderBcaMemoMarkdown(fullResult, {
      contextLabel: "Elm Street Corridor",
      monteCarlo,
    });
    expect(withMc).toContain("## Uncertainty (Monte Carlo)");
    expect(withMc).toContain("- Iterations: **40**, seed `42`");
    expect(withMc).toContain("P(BCR ≥ 1):");
    expect(withMc).toContain("NPV p10–p90:");
    // Without the option the section is absent.
    expect(memo).not.toContain("## Uncertainty (Monte Carlo)");
  });

  it("renders optional TDM lines and parameter notes", () => {
    const withExtras = renderBcaMemoMarkdown(fullResult, {
      contextLabel: "X",
      tdmSummaryLines: ["TDM program reduces corridor VMT by 3%."],
      parameterNotes: ["Value of time confirmed against 2024 guidance."],
    });
    expect(withExtras).toContain("## Travel demand management context");
    expect(withExtras).toContain("- TDM program reduces corridor VMT by 3%.");
    expect(withExtras).toContain("- Value of time confirmed against 2024 guidance.");
    expect(memo).not.toContain("## Travel demand management context");
  });

  it("is deterministic with a generatedAt override", () => {
    expect(memo).toContain(`- Generated: \`${GENERATED_AT}\``);
    const again = renderBcaMemoMarkdown(fullResult, { contextLabel: "Elm Street Corridor" });
    expect(again).toBe(memo);
  });
});

describe("bcaFactBlocks", () => {
  it("emits one screening-framed block per headline metric", () => {
    const blocks = bcaFactBlocks(fullResult, "run-42/bca.json");
    expect(blocks.map((block) => block.fact_id)).toEqual([
      "bca-npv",
      "bca-bcr",
      "bca-pv-benefits",
      "bca-pv-costs",
    ]);
    for (const block of blocks) {
      expect(block.method_ref).toBe("bca.screening");
      expect(block.fact_type).toBe("bca_screening_metric");
      // Each claim is a single self-contained sentence with screening framing.
      expect(block.claim_text.startsWith("Screening-level benefit-cost estimate")).toBe(true);
      expect(block.claim_text.endsWith(".")).toBe(true);
      expect(block.artifact_refs).toEqual([{ path: "run-42/bca.json", type: "analysis" }]);
      expect(block.source_table).toBe("run-42/bca.json");
    }
    const npvBlock = blocks[0];
    expect(npvBlock.claim_text).toContain("$228,145");
    const bcrBlock = blocks[1];
    expect(bcrBlock.claim_text).toContain("1.25");
  });

  it("states when the BCR is not computable instead of inventing a number", () => {
    const blocks = bcaFactBlocks(benefitsOnlyResult, "run-7/bca.json");
    const bcrBlock = blocks.find((block) => block.fact_id === "bca-bcr");
    expect(bcrBlock?.claim_text).toContain("not computable because present-value costs are zero");
  });
});
