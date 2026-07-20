import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateTextMock(...args) }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "mock-model" }));

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
    generateTextMock.mockResolvedValue({ text: "  El paso de peatones necesita una señal.  " });
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
});
