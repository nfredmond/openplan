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

  it("falls back to the summary when the model produces no grounded, cited sentences", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    // No [fact:*] citations at all -> nothing survives the grounding contract.
    generateTextMock.mockResolvedValueOnce({
      text: "This corridor is a strong candidate for investment.",
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
    });

    const result = await generateGrantInterpretation(METRICS, SUMMARY);

    expect(result.source).toBe("summary-fallback");
    expect(result.fallbackReason).toBe("empty_output");
    expect(result.text).toBe(SUMMARY);
  });

  it("keeps grounded, faithful cited sentences (with their provenance tokens)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    generateTextMock.mockResolvedValueOnce({
      text: "The corridor has 5000 residents. [fact:m_population] It supports 1000 jobs. [fact:m_jobs]",
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
    });

    const result = await generateGrantInterpretation(METRICS, SUMMARY);

    expect(result.source).toBe("ai");
    expect(result.fallbackReason).toBeNull();
    expect(result.model).toBe("claude-haiku-4-5-20251001");
    expect(result.estimatedCostUsd).toBe(0.0015);
    // Provenance tokens are retained in the stored value; render sites strip them.
    expect(result.text).toContain("[fact:m_population]");
    expect(result.text).toContain("[fact:m_jobs]");
    expect(result.text).toContain("5000");
    expect(result.text).toContain("1000");
  });

  it("drops a fabricated figure but keeps the faithful sentence beside it", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    // 9999 appears in no cited fact; 1000 does (m_jobs = "jobs: 1000").
    generateTextMock.mockResolvedValueOnce({
      text: "It supports 1000 jobs. [fact:m_jobs] The corridor has 9999 residents. [fact:m_population]",
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
    });

    const result = await generateGrantInterpretation(METRICS, SUMMARY);

    expect(result.source).toBe("ai");
    expect(result.text).toContain("1000 jobs");
    expect(result.text).not.toContain("9999");
  });

  it("rounds estimated cost to 6 decimal places", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    generateTextMock.mockResolvedValueOnce({
      text: "It supports 1000 jobs. [fact:m_jobs]",
      usage: { inputTokens: 1234, outputTokens: 5678, totalTokens: 6912 },
    });

    const result = await generateGrantInterpretation(METRICS, SUMMARY);

    // input: 1234/1_000_000 * 1.0 = 0.001234
    // output: 5678/1_000_000 * 5.0 = 0.02839
    // total: 0.029624
    expect(result.source).toBe("ai");
    expect(result.estimatedCostUsd).toBe(0.029624);
  });
});
