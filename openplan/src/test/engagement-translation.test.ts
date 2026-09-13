import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateTextMock(...args) }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "mock-model", createAnthropic: () => () => "mock-model" }));

import {
  TRANSLATION_CAVEAT,
  isTranslationLanguage,
  translateEngagementText,
} from "@/lib/engagement/translation";

describe("isTranslationLanguage", () => {
  it("accepts supported codes and rejects sentinels / junk", () => {
    expect(isTranslationLanguage("es")).toBe(true);
    expect(isTranslationLanguage("zh")).toBe(true);
    expect(isTranslationLanguage("prefer_not_to_say")).toBe(false); // demographics sentinel, not a language
    expect(isTranslationLanguage("other")).toBe(false);
    expect(isTranslationLanguage("klingon")).toBe(false);
    expect(isTranslationLanguage(42)).toBe(false);
  });
});

describe("translateEngagementText", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it("returns source:unavailable (translated:null) with no API key and never calls the model", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await translateEngagementText({ text: "The crosswalk needs a signal.", targetLanguage: "es" });
    expect(result.source).toBe("unavailable");
    expect(result.translated).toBeNull();
    expect(result.caveat).toBe(TRANSLATION_CAVEAT);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns the model translation on the AI path", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    generateTextMock.mockResolvedValue({ text: "  El paso de peatones necesita una señal.  ", finishReason: "stop" });
    const result = await translateEngagementText({ text: "The crosswalk needs a signal.", targetLanguage: "es" });
    expect(result.source).toBe("ai");
    expect(result.target_language).toBe("es");
    expect(result.translated).toBe("El paso de peatones necesita una señal."); // trimmed
  });

  it("falls back to unavailable on a model error (never throws)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    generateTextMock.mockRejectedValue(new Error("model down"));
    const result = await translateEngagementText({ text: "hello", targetLanguage: "vi" });
    expect(result.source).toBe("unavailable");
    expect(result.translated).toBeNull();
  });

  it("returns an empty translation for empty input without calling the model", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const result = await translateEngagementText({ text: "   ", targetLanguage: "ko" });
    expect(result.source).toBe("ai");
    expect(result.translated).toBe("");
    expect(generateTextMock).not.toHaveBeenCalled();
  });
  it("sends the entire valid long source, including its final words", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const text = "a".repeat(4990) + " ENDMARKER";
    generateTextMock.mockResolvedValue({ text: "Synthetic complete translation", finishReason: "stop" });
    const result = await translateEngagementText({ text, targetLanguage: "es" });
    expect(result.source).toBe("ai");
    expect(generateTextMock.mock.lastCall?.[0].prompt).toContain(text);
    expect(generateTextMock.mock.lastCall?.[0].maxOutputTokens).toBe(1500);
    expect(generateTextMock.mock.lastCall?.[0].maxRetries).toBe(0);
  });

  it.each(["length", "content-filter", "error", "tool-calls", "other", undefined])(
    "refuses nonempty output with incomplete or unknown finish reason %s", async (finishReason) => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      generateTextMock.mockResolvedValue({ text: "Synthetic unfinished translation", finishReason });
      const result = await translateEngagementText({ text: "Hello", targetLanguage: "es" });
      expect(result.source).toBe("unavailable");
      expect(result.translated).toBeNull();
      expect(result.model).toBeNull();
    }
  );

  it("refuses oversized UTF-8 input before spending, without translating a prefix", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const result = await translateEngagementText({ text: "界".repeat(20_000), targetLanguage: "es" });
    expect(result.source).toBe("unavailable");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

});
