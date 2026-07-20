import { describe, expect, it } from "vitest";

import {
  aggregateCorridorEngagement,
  buildSentimentByItemId,
  type CorridorEngagementItem,
} from "@/lib/engagement/corridor-join";
import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";

function synthesis(themes: EngagementSynthesis["themes"]): EngagementSynthesis {
  return {
    source: "ai", model: "m", fallback_reason: null, item_count: 0, analyzed_item_count: 0,
    overall_sentiment: "mixed", themes, narrative: "", caveat: "",
    grounding: { mode: "annotated", facts: [], sentences: [], dropped_sentences: [], cited_fact_ids: [], unknown_fact_ids: [], grounded_sentence_count: 0, total_sentence_count: 0, is_fully_grounded: true },
  };
}

function item(id: string, category_id: string | null, distance: number): CorridorEngagementItem {
  return { id, campaign_id: "camp", category_id, title: null, body: `comment ${id}`, votes_count: 0, distance_meters: distance };
}

describe("corridor engagement join", () => {
  it("maps item ids to their theme sentiment (first theme wins)", () => {
    const s = synthesis([
      { label: "Safety", sentiment: "negative", item_count: 2, fact_ids: ["item_a", "item_b"], summary: "" },
      { label: "Transit", sentiment: "positive", item_count: 1, fact_ids: ["item_b", "item_c"], summary: "" },
    ]);
    const map = buildSentimentByItemId([s, null]);
    expect(map.get("a")).toBe("negative");
    expect(map.get("b")).toBe("negative"); // first theme wins
    expect(map.get("c")).toBe("positive");
  });

  it("aggregates by sentiment + category and computes negative share of classified", () => {
    const items = [item("a", "cat1", 10), item("b", "cat1", 20), item("c", "cat2", 30), item("d", null, 40)];
    const labels = new Map([["cat1", "Safety"], ["cat2", "Transit"]]);
    const sentiment = new Map<string, "negative" | "positive">([["a", "negative"], ["b", "negative"], ["c", "positive"]]);
    const summary = aggregateCorridorEngagement(items, labels, sentiment);
    expect(summary.total).toBe(4);
    expect(summary.bySentiment.negative).toBe(2);
    expect(summary.bySentiment.positive).toBe(1);
    expect(summary.bySentiment.unknown).toBe(1); // item d has no sentiment
    // negative share is of CLASSIFIED items (3), not total: 2/3 = 67%
    expect(summary.negativeSharePct).toBe(67);
    expect(summary.byCategory[0]).toEqual({ categoryId: "cat1", label: "Safety", count: 2 });
    expect(summary.byCategory.find((c) => c.categoryId === null)?.label).toBe("Uncategorized");
    // nearest ordered by input order (already distance-sorted by the query)
    expect(summary.nearest[0].id).toBe("a");
    expect(summary.nearest[0].distanceMeters).toBe(10);
  });

  it("returns null negative share when nothing is classified", () => {
    const summary = aggregateCorridorEngagement([item("x", null, 5)], new Map(), new Map());
    expect(summary.total).toBe(1);
    expect(summary.negativeSharePct).toBeNull();
  });
});
