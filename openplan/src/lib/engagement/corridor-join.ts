/**
 * E4 — the engagement <-> modeling wedge. Given the approved engagement items a
 * PostGIS query found near a corridor/study-area geometry (see the
 * `engagement_items_near_geometry` function), aggregate them into the summary a
 * planner wants: "N comments within this corridor, X% negative, top categories,
 * nearest comments." Sentiment is drawn from the E1 AI synthesis (each theme
 * carries a sentiment and the source item fact ids), so no new inference here.
 *
 * Pure/deterministic so it is unit-testable; the route does the fetching.
 */

import type { EngagementSentiment, EngagementSynthesis } from "@/lib/engagement/ai-synthesis";

export type CorridorEngagementItem = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  title: string | null;
  body: string | null;
  votes_count: number | null;
  distance_meters: number | null;
};

export type CategoryCount = { categoryId: string | null; label: string; count: number };

export type CorridorEngagementSummary = {
  total: number;
  bySentiment: Record<EngagementSentiment | "unknown", number>;
  negativeSharePct: number | null;
  byCategory: CategoryCount[];
  nearest: Array<{
    id: string;
    title: string | null;
    snippet: string;
    categoryLabel: string | null;
    sentiment: EngagementSentiment | "unknown";
    distanceMeters: number | null;
    votes: number;
  }>;
};

const EMPTY_SENTIMENT: Record<EngagementSentiment | "unknown", number> = {
  positive: 0,
  mixed: 0,
  neutral: 0,
  negative: 0,
  unknown: 0,
};

/** Map each source item id → its theme sentiment, across one or more campaign
 * syntheses. Theme fact ids are `item_<id>` (see ai-synthesis.itemFactId). When
 * an item appears in multiple themes the first wins (themes are ordered). */
export function buildSentimentByItemId(
  syntheses: Array<EngagementSynthesis | null | undefined>
): Map<string, EngagementSentiment> {
  const out = new Map<string, EngagementSentiment>();
  for (const synthesis of syntheses) {
    if (!synthesis) continue;
    for (const theme of synthesis.themes) {
      for (const factId of theme.fact_ids) {
        const itemId = factId.startsWith("item_") ? factId.slice("item_".length) : factId;
        if (!out.has(itemId)) out.set(itemId, theme.sentiment);
      }
    }
  }
  return out;
}

function snippet(body: string | null, title: string | null, max = 160): string {
  const text = (body ?? title ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Aggregate the matched items into the corridor engagement summary. */
export function aggregateCorridorEngagement(
  items: CorridorEngagementItem[],
  categoryLabelById: Map<string, string>,
  sentimentByItemId: Map<string, EngagementSentiment>,
  nearestLimit = 8
): CorridorEngagementSummary {
  const bySentiment: Record<EngagementSentiment | "unknown", number> = { ...EMPTY_SENTIMENT };
  const categoryCounts = new Map<string, { label: string; count: number }>();

  for (const item of items) {
    const sentiment = sentimentByItemId.get(item.id) ?? "unknown";
    bySentiment[sentiment] += 1;

    const key = item.category_id ?? "__uncategorized__";
    const label = item.category_id ? categoryLabelById.get(item.category_id) ?? "Category" : "Uncategorized";
    const bucket = categoryCounts.get(key) ?? { label, count: 0 };
    bucket.count += 1;
    categoryCounts.set(key, bucket);
  }

  const total = items.length;
  const classified = total - bySentiment.unknown;
  const negativeSharePct = classified > 0 ? Math.round((bySentiment.negative / classified) * 100) : null;

  const byCategory: CategoryCount[] = Array.from(categoryCounts.entries())
    .map(([key, v]) => ({ categoryId: key === "__uncategorized__" ? null : key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);

  const nearest = items.slice(0, nearestLimit).map((item) => ({
    id: item.id,
    title: item.title,
    snippet: snippet(item.body, item.title),
    categoryLabel: item.category_id ? categoryLabelById.get(item.category_id) ?? null : null,
    sentiment: sentimentByItemId.get(item.id) ?? ("unknown" as const),
    distanceMeters: item.distance_meters === null ? null : Math.round(item.distance_meters),
    votes: item.votes_count ?? 0,
  }));

  return { total, bySentiment, negativeSharePct, byCategory, nearest };
}
