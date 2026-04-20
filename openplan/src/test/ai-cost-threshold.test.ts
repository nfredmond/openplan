import { describe, expect, it } from "vitest";
import {
  ANALYSIS_SINGLE_CALL_COST_WARN_USD,
  buildAnalysisCostThresholdWarning,
} from "@/lib/ai/cost-threshold";

describe("buildAnalysisCostThresholdWarning", () => {
  it("does not warn when cost is missing or at the threshold", () => {
    expect(buildAnalysisCostThresholdWarning(null)).toBeNull();
    expect(buildAnalysisCostThresholdWarning(ANALYSIS_SINGLE_CALL_COST_WARN_USD)).toBeNull();
  });

  it("returns observation-only warning metadata when a call exceeds the threshold", () => {
    expect(buildAnalysisCostThresholdWarning(0.500001)).toEqual({
      thresholdKind: "single_call",
      thresholdUsd: 0.5,
      estimatedCostUsd: 0.500001,
    });
  });
});
