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
