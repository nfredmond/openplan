import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateTextMock(...args) }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "mock-model" }));

import {
  MODERATION_CAVEAT,
  deterministicItemModeration,
  moderateEngagementItems,
} from "@/lib/engagement/ai-moderation";

describe("deterministicItemModeration", () => {
  it("flags PII (email/phone/SSN) as high severity / review", () => {
    const email = deterministicItemModeration({ id: "a", body: "call me at jane@example.com about the crosswalk" });
    expect(email.flags).toContain("pii");
    expect(email.severity).toBe("high");
    expect(email.suggested_action).toBe("review");

    const phone = deterministicItemModeration({ id: "b", body: "reach me at (530) 555-1234" });
    expect(phone.flags).toContain("pii");

    const ssn = deterministicItemModeration({ id: "c", body: "my ssn is 123-45-6789" });
    expect(ssn.flags).toContain("pii");
  });

  it("flags link-heavy comments as spam (medium)", () => {
    const spam = deterministicItemModeration({
      id: "d",
      body: "buy now http://a.test and http://b.test and www.c.test",
    });
    expect(spam.flags).toContain("spam");
    expect(spam.severity).toBe("medium");
  });

  it("passes a clean comment (no flags, approve)", () => {
    const clean = deterministicItemModeration({ id: "e", body: "The crosswalk near Main Street needs a signal." });
    expect(clean.flags).toEqual([]);
    expect(clean.severity).toBe("none");
    expect(clean.suggested_action).toBe("approve");
  });

  it("does not echo the PII value back in the rationale", () => {
    const email = deterministicItemModeration({ id: "f", body: "email jane@example.com" });
    expect(email.rationale).not.toContain("jane@example.com");
  });
});

describe("moderateEngagementItems (AI-offline)", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it("returns a deterministic fallback with per-item assessments when no API key", async () => {
    const result = await moderateEngagementItems([
      { id: "a", body: "contact me at jane@example.com" },
      { id: "b", body: "The bus stop needs a shelter." },
    ]);
    expect(result.source).toBe("deterministic-fallback");
    expect(result.fallback_reason).toBe("missing_api_key");
    expect(result.item_count).toBe(2);
    expect(result.flagged_count).toBe(1);
    expect(result.items.find((i) => i.item_id === "a")?.flags).toContain("pii");
    expect(result.items.find((i) => i.item_id === "b")?.flags).toEqual([]);
    expect(result.caveat).toBe(MODERATION_CAVEAT);
  });

  it("handles an empty queue", async () => {
    const result = await moderateEngagementItems([]);
    expect(result.item_count).toBe(0);
    expect(result.flagged_count).toBe(0);
  });
});

describe("moderateEngagementItems (AI path merges the full-body heuristic)", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it("still flags PII the length-capped AI prompt could not see", async () => {
    // AI (which only sees the truncated prompt) returns no concern...
    generateTextMock.mockResolvedValue({
      text: '{"items":[{"item_id":"a","flags":[],"severity":"none","rationale":"on topic"}]}',
    });
    // ...but the comment has PII after the 1200-char prompt cap.
    const body = `${"the crosswalk needs work. ".repeat(60)} reach me at jane@example.com`;
    const result = await moderateEngagementItems([{ id: "a", body }]);
    expect(result.source).toBe("ai");
    const a = result.items.find((i) => i.item_id === "a")!;
    expect(a.flags).toContain("pii"); // merged from the full-body deterministic floor
    expect(a.suggested_action).toBe("review");
    expect(a.rationale).not.toContain("jane@example.com");
  });

  it("falls back to deterministic per-item on invalid model output", async () => {
    generateTextMock.mockResolvedValue({ text: "not json" });
    const result = await moderateEngagementItems([{ id: "a", body: "email jane@example.com" }]);
    expect(result.source).toBe("deterministic-fallback");
    expect(result.fallback_reason).toBe("invalid_output");
    expect(result.items[0].flags).toContain("pii");
  });
});
