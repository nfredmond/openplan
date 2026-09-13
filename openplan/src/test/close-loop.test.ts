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

function responseRow(overrides = {}) {
  return { id: "entry-1", campaign_id: "camp-1", category_id: null, theme_title: "Crossings",
    you_said: "Crossing is difficult", we_did: "Review crossing options", status: "published",
    ai_assisted: false, source_item_ids: [], sort_order: 0, published_at: "2026-09-12T00:00:00Z",
    created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z", ...overrides };
}
function responseSnapshot(publishedOnly = false, entries = [responseRow()]) {
  return { campaignId: "camp-1", publishedOnly, count: entries.length, entries };
}

describe("complete response snapshot loaders", () => {
  it.each([false, true])("requests the exact campaign/publication snapshot: %s", async publishedOnly => {
    const data = responseSnapshot(publishedOnly);
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    const loader = publishedOnly ? loadPublishedCloseLoopEntries : loadCloseLoopEntries;
    expect(await loader({ rpc } as never, "camp-1")).toEqual({ rows: data.entries, error: null });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_response_snapshot", { p_campaign: "camp-1", p_published_only: publishedOnly });
  });

  it("retains more than one server page of responses", async () => {
    const entries = Array.from({ length: 1005 }, (_, i) => responseRow({ id: `entry-${i}` }));
    const rpc = vi.fn().mockResolvedValue({ data: responseSnapshot(false, entries), error: null });
    expect((await loadCloseLoopEntries({ rpc } as never, "camp-1")).rows).toEqual(entries);
  });

  it.each([false, true])("accepts a successful empty snapshot: %s", async publishedOnly => {
    const rpc = vi.fn().mockResolvedValue({ data: responseSnapshot(publishedOnly, []), error: null });
    const loader = publishedOnly ? loadPublishedCloseLoopEntries : loadCloseLoopEntries;
    expect(await loader({ rpc } as never, "camp-1")).toEqual({ rows: [], error: null });
  });

  it.each([false, true])("preserves the database error and withholds even valid partial rows: %s", async publishedOnly => {
    const error = { message: "SYNTHETIC database read failure", code: "08006" };
    const rpc = vi.fn().mockResolvedValue({ data: responseSnapshot(publishedOnly), error });
    const loader = publishedOnly ? loadPublishedCloseLoopEntries : loadCloseLoopEntries;
    expect(await loader({ rpc } as never, "camp-1")).toEqual({ rows: [], error });
  });

  it.each([
    ["null result", null],
    ["missing envelope", []],
    ["malformed entry", responseSnapshot(false, [responseRow({ status: "unreadable" })])],
    ["count mismatch", { ...responseSnapshot(), count: 2 }],
    ["foreign receipt", { ...responseSnapshot(), campaignId: "foreign" }],
    ["wrong publication receipt", { ...responseSnapshot(), publishedOnly: true }],
    ["foreign row", responseSnapshot(false, [responseRow({ campaign_id: "foreign" })])],
    ["duplicate row", responseSnapshot(false, [responseRow(), responseRow()])],
  ])("refuses %s without returning a partial list", async (_label, data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    const result = await loadCloseLoopEntries({ rpc } as never, "camp-1");
    expect(result).toEqual({ rows: [], error: { message: "Saved responses could not be read completely" } });
  });

  it("refuses a draft in a published-only snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: responseSnapshot(true, [responseRow({ status: "draft" })]), error: null });
    expect(await loadPublishedCloseLoopEntries({ rpc } as never, "camp-1")).toEqual({ rows: [], error: { message: "Saved responses could not be read completely" } });
  });
});
