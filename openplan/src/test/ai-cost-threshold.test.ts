import { describe, expect, it } from "vitest";
import {
  ANALYSIS_SINGLE_CALL_COST_WARN_USD,
  buildAnalysisCostThresholdWarning,
  estimateAnthropicCostUsd,
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

describe("estimateAnthropicCostUsd", () => {
  it("prices by model family matched from the (env-overridable) model id", () => {
    // opus: $15/M input + $75/M output
    expect(estimateAnthropicCostUsd("claude-opus-4-8", 1_000_000, 0)).toBe(15);
    expect(estimateAnthropicCostUsd("claude-opus-4-8", 0, 1_000_000)).toBe(75);
    // haiku pricing matches the analysis interpreter's constants ($1/$5 per M)
    expect(estimateAnthropicCostUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBe(6);
    expect(estimateAnthropicCostUsd("claude-sonnet-4-5", 1_000_000, 0)).toBe(3);
  });

  it("returns null for unknown families or missing usage — no guessed warnings", () => {
    expect(estimateAnthropicCostUsd("some-custom-model", 1000, 1000)).toBeNull();
    expect(estimateAnthropicCostUsd(null, 1000, 1000)).toBeNull();
    expect(estimateAnthropicCostUsd("claude-opus-4-8", null, null)).toBeNull();
  });

  it("composes with the threshold warning for a realistic heavy chat call", () => {
    // 20k input + 6k output on opus ≈ $0.75 — above the $0.50 threshold.
    const estimate = estimateAnthropicCostUsd("claude-opus-4-8", 20_000, 6_000);
    expect(estimate).toBe(0.75);
    expect(buildAnalysisCostThresholdWarning(estimate)).toEqual({
      thresholdKind: "single_call",
      thresholdUsd: 0.5,
      estimatedCostUsd: 0.75,
    });
  });
});
