import { describe, expect, it, vi } from "vitest";
import {
  buildCloseLoopDraftsFromSynthesis,
  loadCloseLoopEntries,
  loadPublishedCloseLoopEntries,
} from "@/lib/engagement/close-loop";
import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";

function synthesis(overrides: Partial<EngagementSynthesis> = {}): EngagementSynthesis {
  return {
    source: "ai",
    model: "claude-haiku-4-5-20251001",
    fallback_reason: null,
    item_count: 3,
    analyzed_item_count: 3,
    overall_sentiment: "mixed",
    themes: [
      { label: "Crossings", sentiment: "negative", item_count: 2, fact_ids: ["item_a1", "item_b2"], summary: "People want safer crossings [fact:item_a1]." },
      { label: "Transit", sentiment: "positive", item_count: 1, fact_ids: ["item_c3"], summary: "Riders like the new stop [fact:item_c3]." },
    ],
    narrative: "…",
    grounding: { facts: [], claims: [] } as unknown as EngagementSynthesis["grounding"],
    caveat: "AI-assisted; verify before publishing.",
    ...overrides,
  };
}

describe("buildCloseLoopDraftsFromSynthesis", () => {
  it("maps each theme to a draft and strips the item_ grounding prefix from source ids", () => {
    const drafts = buildCloseLoopDraftsFromSynthesis(synthesis());
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toEqual({
      themeTitle: "Crossings",
      youSaid: "People want safer crossings [fact:item_a1].",
      sourceItemIds: ["a1", "b2"],
    });
    expect(drafts[1].sourceItemIds).toEqual(["c3"]);
  });

  it("drops themes with an empty label", () => {
    const drafts = buildCloseLoopDraftsFromSynthesis(
      synthesis({ themes: [{ label: "  ", sentiment: "neutral", item_count: 0, fact_ids: [], summary: "x" }] })
    );
    expect(drafts).toHaveLength(0);
  });

  it("returns no drafts for an empty synthesis", () => {
    expect(buildCloseLoopDraftsFromSynthesis(synthesis({ themes: [] }))).toEqual([]);
  });
});

describe("close-loop loaders", () => {
  it("loadCloseLoopEntries reads all entries scoped by campaign, ordered", async () => {
    const order2 = vi.fn().mockResolvedValue({ data: [{ id: "e1" }], error: null });
    const order1 = vi.fn(() => ({ order: order2 }));
    const eq = vi.fn(() => ({ order: order1 }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const rows = await loadCloseLoopEntries({ from } as never, "camp-1");
    expect(from).toHaveBeenCalledWith("engagement_closeloop_entries");
    expect(eq).toHaveBeenCalledWith("campaign_id", "camp-1");
    expect(rows).toEqual([{ id: "e1" }]);
  });

  it("loadPublishedCloseLoopEntries additionally filters status=published", async () => {
    const order2 = vi.fn().mockResolvedValue({ data: [], error: null });
    const order1 = vi.fn(() => ({ order: order2 }));
    const eqStatus = vi.fn(() => ({ order: order1 }));
    const eqCampaign = vi.fn(() => ({ eq: eqStatus }));
    const select = vi.fn(() => ({ eq: eqCampaign }));
    const from = vi.fn(() => ({ select }));

    await loadPublishedCloseLoopEntries({ from } as never, "camp-2");
    expect(eqCampaign).toHaveBeenCalledWith("campaign_id", "camp-2");
    expect(eqStatus).toHaveBeenCalledWith("status", "published");
  });
});
