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
  it("prices a listed model id at its exact list price", () => {
    // Opus 5.5: $4/M input + $20/M output; Opus 4.8: $5/$25.
    expect(estimateAnthropicCostUsd("claude-opus-5-5", 1_000_000, 0)).toBe(4);
    expect(estimateAnthropicCostUsd("claude-opus-5-5", 0, 1_000_000)).toBe(20);
    expect(estimateAnthropicCostUsd("claude-opus-4-8", 1_000_000, 1_000_000)).toBe(30);
    // Haiku 5.5: $0.10/$0.50 up to 100K prompt tokens, $0.50/$2.50 for the whole call beyond.
    expect(estimateAnthropicCostUsd("claude-haiku-5-5", 100_000, 10_000)).toBe(0.015);
    expect(estimateAnthropicCostUsd("claude-haiku-5-5", 200_000, 10_000)).toBe(0.125);
    expect(estimateAnthropicCostUsd("claude-fable-5-1", 1_000_000, 0)).toBe(10);
  });

  it("falls back to family pricing for an (env-overridable) id the list does not carry", () => {
    // opus family: $15/M input + $75/M output
    expect(estimateAnthropicCostUsd("claude-opus-4-1", 1_000_000, 0)).toBe(15);
    expect(estimateAnthropicCostUsd("claude-opus-4-1", 0, 1_000_000)).toBe(75);
    expect(estimateAnthropicCostUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBe(6);
    expect(estimateAnthropicCostUsd("claude-sonnet-4-5", 1_000_000, 0)).toBe(3);
  });

  it("returns null for unknown families or missing usage — no guessed warnings", () => {
    expect(estimateAnthropicCostUsd("some-custom-model", 1000, 1000)).toBeNull();
    expect(estimateAnthropicCostUsd(null, 1000, 1000)).toBeNull();
    expect(estimateAnthropicCostUsd("claude-opus-4-8", null, null)).toBeNull();
  });

  it("composes with the threshold warning for a realistic heavy chat call", () => {
    // 100k input + 10k output on Opus 5.5 = $0.60, above the $0.50 threshold.
    const estimate = estimateAnthropicCostUsd("claude-opus-5-5", 100_000, 10_000);
    expect(estimate).toBe(0.6);
    expect(buildAnalysisCostThresholdWarning(estimate)).toEqual({
      thresholdKind: "single_call",
      thresholdUsd: 0.5,
      estimatedCostUsd: 0.6,
    });
  });
});
