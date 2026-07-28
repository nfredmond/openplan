export const ANALYSIS_SINGLE_CALL_COST_WARN_USD = 0.5;

export type AnalysisCostThresholdWarning = {
  thresholdKind: "single_call";
  thresholdUsd: number;
  estimatedCostUsd: number;
};

export function buildAnalysisCostThresholdWarning(
  estimatedCostUsd: number | null,
): AnalysisCostThresholdWarning | null {
  if (estimatedCostUsd === null) return null;
  if (estimatedCostUsd <= ANALYSIS_SINGLE_CALL_COST_WARN_USD) return null;

  return {
    thresholdKind: "single_call",
    thresholdUsd: ANALYSIS_SINGLE_CALL_COST_WARN_USD,
    estimatedCostUsd,
  };
}

/**
 * Approximate USD-per-million-token list prices by Anthropic model family,
 * matched by id substring (model ids are configurable via env overrides, so
 * exact-id tables would silently stop estimating on every override). An
 * unrecognized id estimates to null — the threshold warning then simply does
 * not fire, which is the honest failure mode for a screening-grade estimate.
 */
const ANTHROPIC_FAMILY_PRICING: Array<{ match: string; inputUsdPerMTokens: number; outputUsdPerMTokens: number }> = [
  { match: "opus", inputUsdPerMTokens: 15, outputUsdPerMTokens: 75 },
  { match: "sonnet", inputUsdPerMTokens: 3, outputUsdPerMTokens: 15 },
  { match: "haiku", inputUsdPerMTokens: 1, outputUsdPerMTokens: 5 },
];

/**
 * Estimate the USD cost of one Anthropic call from token usage. Returns null
 * when the model family is unrecognized or no usage is available.
 */
export function estimateAnthropicCostUsd(
  modelId: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | null {
  if (!modelId) return null;
  const normalized = modelId.toLowerCase();
  const pricing = ANTHROPIC_FAMILY_PRICING.find((entry) => normalized.includes(entry.match));
  if (!pricing) return null;

  const input = typeof inputTokens === "number" && Number.isFinite(inputTokens) ? inputTokens : null;
  const output = typeof outputTokens === "number" && Number.isFinite(outputTokens) ? outputTokens : null;
  if (input === null && output === null) return null;

  const raw =
    ((input ?? 0) / 1_000_000) * pricing.inputUsdPerMTokens +
    ((output ?? 0) / 1_000_000) * pricing.outputUsdPerMTokens;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
