import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (modelId: string) => ({ __modelId: modelId }),
}));

import {
  buildDeterministicSynthesis,
  buildSynthesisFacts,
  generateEngagementSynthesis,
  itemFactId,
  SYNTHESIS_MAX_ITEMS,
  type SynthesisItem,
} from "@/lib/engagement/ai-synthesis";
import { validateGroundedNarrative } from "@/lib/planner-pack/grounding";

function items(n: number): SynthesisItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    body: `Comment number ${i} about the corridor.`,
    category_label: i % 2 === 0 ? "Safety" : "Transit",
    latitude: 39.2 + i * 0.001,
    longitude: -121.05,
  }));
}

describe("engagement AI synthesis", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY; // force the offline / deterministic path
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("builds one valid, grounding-compatible fact id per item and caps the corpus", () => {
    const { facts, factIdByItemId } = buildSynthesisFacts(items(SYNTHESIS_MAX_ITEMS + 25));
    expect(facts).toHaveLength(SYNTHESIS_MAX_ITEMS); // capped
    // Every fact id must satisfy the grounding token pattern so citations validate.
    const tokenPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
    for (const fact of facts) expect(fact.fact_id).toMatch(tokenPattern);
    expect(factIdByItemId.get(items(1)[0].id)).toBe(itemFactId(items(1)[0].id));
  });

  it("falls back to a fully grounded deterministic synthesis when AI is offline", async () => {
    const synthesis = await generateEngagementSynthesis(items(6));
    expect(synthesis.source).toBe("deterministic-fallback");
    expect(synthesis.fallback_reason).toBe("missing_api_key");
    expect(synthesis.item_count).toBe(6);
    // Themes grouped by category, most-common first.
    expect(synthesis.themes.map((t) => t.label).sort()).toEqual(["Safety", "Transit"]);
    // The deterministic narrative must be fully grounded — every sentence cites
    // a real source comment fact id (the whole point of the grounding contract).
    expect(synthesis.grounding.is_fully_grounded).toBe(true);
    expect(synthesis.grounding.grounded_sentence_count).toBeGreaterThan(0);
  });

  it("produces a narrative whose every cited id is a known item fact", () => {
    const corpus = items(4);
    const synthesis = buildDeterministicSynthesis(corpus);
    const known = new Set(corpus.map((i) => itemFactId(i.id)));
    const validated = validateGroundedNarrative(synthesis.narrative, known, "annotated");
    expect(validated.unknownFactIds).toEqual([]);
    expect(validated.isFullyGrounded).toBe(true);
  });

  it("handles an empty campaign without themes or narrative", async () => {
    const synthesis = await generateEngagementSynthesis([]);
    expect(synthesis.source).toBe("deterministic-fallback");
    expect(synthesis.item_count).toBe(0);
    expect(synthesis.themes).toEqual([]);
    expect(synthesis.narrative).toBe("");
    expect(synthesis.grounding.is_fully_grounded).toBe(true); // vacuously
  });

  it("PINNED: the faithfulness belt flags model-computed aggregate figures on the AI path", async () => {
    // Intended behavior, not an accident: an aggregate percentage the model
    // computed ("40% of comments...") appears in NO cited source comment, so
    // it is not deterministically verifiable from the citations — the belt
    // flags it for staff review. The raw narrative is still stored; only the
    // persisted grounding summary carries the flag.
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const corpus = items(4);
    const [a, b] = [itemFactId(corpus[0].id), itemFactId(corpus[1].id)];
    generateTextMock.mockResolvedValueOnce({
      text: JSON.stringify({
        overall_sentiment: "mixed",
        themes: [{ label: "Safety", sentiment: "mixed", fact_ids: [a], summary: "Safety concerns." }],
        narrative: `40% of comments raise safety concerns. [fact:${a}] [fact:${b}]`,
      }),
    });

    const synthesis = await generateEngagementSynthesis(corpus);

    expect(synthesis.source).toBe("ai");
    // Raw narrative is stored verbatim.
    expect(synthesis.narrative).toContain("40%");
    // The grounding summary flags the aggregate as an unfaithful citation.
    expect(synthesis.grounding.is_fully_grounded).toBe(false);
    expect(synthesis.grounding.faithfulness_checked).toBe(true);
    const flagged = synthesis.grounding.sentences.filter((s) => !s.is_grounded);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.unfaithful_claims).toEqual(["40"]);
  });

  it("keeps a faithful AI narrative fully grounded on the model path", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const corpus = items(2);
    const factId = itemFactId(corpus[0].id);
    generateTextMock.mockResolvedValueOnce({
      text: JSON.stringify({
        overall_sentiment: "neutral",
        themes: [],
        narrative: `Residents discussed corridor conditions. [fact:${factId}]`,
      }),
    });

    const synthesis = await generateEngagementSynthesis(corpus);

    expect(synthesis.source).toBe("ai");
    expect(synthesis.grounding.is_fully_grounded).toBe(true);
    expect(synthesis.grounding.faithfulness_checked).toBe(true);
  });
});
