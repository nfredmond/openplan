import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();
const anthropicMock = vi.fn((modelId: string) => ({ __modelId: modelId }));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (...args: unknown[]) => anthropicMock(...(args as [string])),
}));

import { generateGrantInterpretation } from "@/lib/ai/interpret";

const SUMMARY = "A corridor with moderate density and limited transit.";
const METRICS = { jobs: 1000, population: 5000 };

describe("generateGrantInterpretation", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it("returns missing_api_key fallback when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await generateGrantInterpretation(METRICS, SUMMARY);

    expect(result).toEqual({
      text: SUMMARY,
      source: "summary-fallback",
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
      fallbackReason: "missing_api_key",
    });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns generation_error fallback when generateText throws", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    generateTextMock.mockRejectedValueOnce(new Error("upstream timeout"));

    const result = await generateGrantInterpretation(METRICS, SUMMARY);

    expect(result.source).toBe("summary-fallback");
    expect(result.fallbackReason).toBe("generation_error");
    expect(result.text).toBe(SUMMARY);
    expect(result.estimatedCostUsd).toBeNull();
  });

  it("returns empty_output fallback when model returns whitespace-only text", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    generateTextMock.mockResolvedValueOnce({
      text: "   \n  ",
      usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
    });

    const result = await generateGrantInterpretation(METRICS, SUMMARY);

    expect(result.source).toBe("summary-fallback");
    expect(result.fallbackReason).toBe("empty_output");
    expect(result.text).toBe(SUMMARY);
  });

  it("returns populated usage + cost on successful AI completion", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    generateTextMock.mockResolvedValueOnce({
      text: "Interpreted narrative for the corridor.",
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
    });

    const result = await generateGrantInterpretation(METRICS, SUMMARY);

    expect(result).toEqual({
      text: "Interpreted narrative for the corridor.",
      source: "ai",
      model: "claude-3-5-haiku-latest",
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
      estimatedCostUsd: 0.0015,
      fallbackReason: null,
    });
  });

  it("rounds estimated cost to 6 decimal places", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    generateTextMock.mockResolvedValueOnce({
      text: "ok",
      usage: { inputTokens: 1234, outputTokens: 5678, totalTokens: 6912 },
    });

    const result = await generateGrantInterpretation(METRICS, SUMMARY);

    // input: 1234/1_000_000 * 1.0 = 0.001234
    // output: 5678/1_000_000 * 5.0 = 0.02839
    // total: 0.029624
    expect(result.estimatedCostUsd).toBe(0.029624);
  });
});
