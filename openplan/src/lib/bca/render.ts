/**
 * OpenPlan benefit-cost screening — markdown memo renderer and fact blocks.
 *
 * Style-matches `src/lib/planner-pack/render.ts`: a titled memo with a
 * determination, assumptions, line-item table, Citations, and a Notes
 * section whose first line is the screening caveat verbatim — that wording
 * must not drift. Null IRR/payback render an explicit "not computable from
 * these flows" sentence, never a blank.
 */

import type { FactBlock } from "@/lib/planner-pack/types";

import type { BcaMonteCarloResult } from "./monte-carlo";
import {
  BCA_ENGINE_VERSION,
  BCA_METHOD_CITATION,
  BCA_SCREENING_CAVEAT,
} from "./parameters";
import type { BcaLineItemResult, BcaResult } from "./types";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Whole-dollar USD, e.g. 1234567.89 -> "$1,234,568". Shared by render and UI. */
export function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

export type RenderBcaMemoOptions = {
  contextLabel: string;
  engineVersion?: string;
  parameterNotes?: string[];
  monteCarlo?: BcaMonteCarloResult | null;
  tdmSummaryLines?: string[];
};

function lineItemRow(item: BcaLineItemResult, side: "benefit" | "cost"): string {
  return `| ${item.label} | ${side}:${item.kind} | ${formatUsd(item.undiscountedTotal)} | ${formatUsd(item.presentValue)} |\n`;
}

/** Render the benefit-cost screening memo as Markdown. */
export function renderBcaMemoMarkdown(result: BcaResult, options: RenderBcaMemoOptions): string {
  const engineVersion = options.engineVersion ?? BCA_ENGINE_VERSION;
  const firstAnalysisYear = result.baseYear + 1;
  const lastAnalysisYear = result.baseYear + result.analysisHorizonYears;

  const bcrLine =
    result.benefitCostRatio !== null
      ? `- Benefit-cost ratio: **${result.benefitCostRatio.toFixed(2)}**`
      : "- Benefit-cost ratio: not computable (present-value costs are zero).";
  const irrLine =
    result.internalRateOfReturnPct !== null
      ? `- Internal rate of return: **${result.internalRateOfReturnPct.toFixed(1)}%**`
      : "- Internal rate of return: not computable from these flows.";
  const paybackLine =
    result.paybackYearsDiscounted !== null
      ? `- Discounted payback: **${result.paybackYearsDiscounted.toFixed(1)} years** from the first analysis year`
      : "- Discounted payback: not computable from these flows.";

  let out = `# Benefit-Cost Screening — ${options.contextLabel}

- Engine version: \`${engineVersion}\`
- Generated: \`${result.generatedAt}\`

## Determination

${bcrLine}
- Net present value: **${formatUsd(result.netPresentValue)}** (present-value benefits ${formatUsd(result.presentValueBenefits)} minus present-value costs ${formatUsd(result.presentValueCosts)})
${irrLine}
${paybackLine}

## Assumptions

- Base year (discounting epoch): **${result.baseYear}**; analysis years ${firstAnalysisYear}–${lastAnalysisYear}.
- Analysis horizon: **${result.analysisHorizonYears} years**.
- Discount rate: **${result.discountRatePct}%** real; CO2e stream discounted at **${result.co2DiscountRatePct}%**.
- Flows are end-of-year amounts discounted to the base year; results keep full precision and are rounded only for display.

## Line items

| Item | Kind | Undiscounted total | Present value |
|---|---|---:|---:|
`;

  for (const item of result.benefitItems) {
    out += lineItemRow(item, "benefit");
  }
  for (const item of result.costItems) {
    out += lineItemRow(item, "cost");
  }
  out += `
- Present-value benefits: **${formatUsd(result.presentValueBenefits)}**
- Present-value costs: **${formatUsd(result.presentValueCosts)}**
`;

  const monteCarlo = options.monteCarlo;
  if (monteCarlo) {
    const bcrProbability = `${(monteCarlo.probabilityBcrAtLeastOne * 100).toFixed(1)}%`;
    const npvProbability = `${(monteCarlo.probabilityNpvPositive * 100).toFixed(1)}%`;
    out += `
## Uncertainty (Monte Carlo)

- Iterations: **${monteCarlo.iterations}**, seed \`${monteCarlo.seed}\` — rerun with the same seed to reproduce these figures exactly.
- P(BCR ≥ 1): **${bcrProbability}**; P(NPV > 0): **${npvProbability}**.
- NPV p10–p90: **${formatUsd(monteCarlo.npv.percentiles.p10)}** to **${formatUsd(monteCarlo.npv.percentiles.p90)}** (median ${formatUsd(monteCarlo.npv.median)}).
`;
    if (monteCarlo.bcrNullCount > 0) {
      out += `- ${monteCarlo.bcrNullCount} iteration(s) had zero present-value costs and were excluded from BCR statistics.\n`;
    }
  }

  if (options.tdmSummaryLines && options.tdmSummaryLines.length > 0) {
    out += `
## Travel demand management context

`;
    for (const line of options.tdmSummaryLines) {
      out += `- ${line}\n`;
    }
  }

  out += `
## Citations

- ${BCA_METHOD_CITATION}

## Notes

- ${BCA_SCREENING_CAVEAT}
`;
  if (options.parameterNotes) {
    for (const note of options.parameterNotes) {
      out += `- ${note}\n`;
    }
  }
  out += `
---

*OpenPlan — benefit-cost screening memo.*
`;

  return out;
}

/**
 * Grounded fact blocks for the headline metrics (NPV, BCR, PV benefits,
 * PV costs). Not consumed by a route yet; future-proofs narrative
 * integration through the planner-pack grounding contract.
 */
export function bcaFactBlocks(result: BcaResult, sourceLabel: string): FactBlock[] {
  const framing = `${result.analysisHorizonYears}-year horizon at a ${result.discountRatePct}% discount rate (base year ${result.baseYear})`;
  const bcrClaim =
    result.benefitCostRatio !== null
      ? `Screening-level benefit-cost estimate (not an analysis of record): the benefit-cost ratio is ${result.benefitCostRatio.toFixed(2)} over a ${framing}.`
      : `Screening-level benefit-cost estimate (not an analysis of record): the benefit-cost ratio is not computable because present-value costs are zero over a ${framing}.`;

  const claims: Array<{ id: string; text: string }> = [
    {
      id: "bca-npv",
      text: `Screening-level benefit-cost estimate (not an analysis of record): the net present value is ${formatUsd(result.netPresentValue)} over a ${framing}.`,
    },
    { id: "bca-bcr", text: bcrClaim },
    {
      id: "bca-pv-benefits",
      text: `Screening-level benefit-cost estimate (not an analysis of record): present-value benefits total ${formatUsd(result.presentValueBenefits)} over a ${framing}.`,
    },
    {
      id: "bca-pv-costs",
      text: `Screening-level benefit-cost estimate (not an analysis of record): present-value costs total ${formatUsd(result.presentValueCosts)} over a ${framing}.`,
    },
  ];

  return claims.map(({ id, text }) => ({
    fact_id: id,
    fact_type: "bca_screening_metric",
    claim_text: text,
    method_ref: "bca.screening",
    artifact_refs: [{ path: sourceLabel, type: "analysis" }],
    source_table: sourceLabel,
  }));
}
