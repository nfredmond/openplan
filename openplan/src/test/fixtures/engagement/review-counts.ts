/**
 * One campaign's review records with every count the review files state:
 * four approved contributions, one withheld, one pending, one flagged; two
 * published staff responses (one answers two approved contributions, the other
 * answers one of those again and a third), and an unpublished draft that
 * answers the fourth. Labeled test data that represents no place or person.
 *
 * Expected counts. Internal copy: received 7, approved 4, withheld 1, pending
 * 1, flagged 1, published responses 2, answered 3. Public copy: approved 4,
 * published responses 2, answered 3.
 */
import { createHash } from "node:crypto";
import type { EngagementReviewSnapshot } from "@/lib/engagement/review-export";

/** The saved format without private decision history: what a public copy and an earlier internal copy use. */
export type ReviewCountSnapshot = Extract<EngagementReviewSnapshot, { schema: 1 }>;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const REVIEW_COUNT_IDS = {
  answeredOnce: id(1),
  answeredTwice: id(2),
  answeredOnceMore: id(3),
  unanswered: id(4),
  withheld: id(5),
  pending: id(6),
  flagged: id(7),
} as const;

const item = (itemId: string, status: string, title: string) => ({
  id: itemId, status, title, body: `TEST ENTRY by an agent. ${title}.`, created_at: "2026-11-14T16:00:00Z",
  parent_item_id: null, configuration_version_id: null, source_type: "public", submitted_by: null,
});

const response = (responseId: string, sources: string[], publishedAt: string | null) => ({
  id: responseId, theme_title: `TEST response ${responseId.slice(-1)}`, you_said: "TEST you said.", we_did: "TEST we did.",
  source_item_ids: sources, status: publishedAt ? "published" : "draft", published_at: publishedAt, sort_order: 0,
});

export const REVIEW_COUNT_EXPECTED = {
  internal: { received: 7, approved: 4, withheld: 1, pending: 1, flagged: 1, publishedResponses: 2, answered: 3 },
  public: { approved: 4, publishedResponses: 2, answered: 3 },
} as const;

/** The internal copy of the campaign's review records. */
export function internalReviewCountSnapshot(): ReviewCountSnapshot {
  const ids = REVIEW_COUNT_IDS;
  return {
    schema: 1, capturedAt: "2026-11-14T18:00:00Z", scope: "internal", filters: {},
    campaign: { id: id(100), title: "TEST review counts campaign", summary: null, configurationVersionId: null },
    items: [
      item(ids.answeredOnce, "approved", "Answered by one response"),
      item(ids.answeredTwice, "approved", "Answered by two responses"),
      item(ids.answeredOnceMore, "approved", "Answered by the second response"),
      item(ids.unanswered, "approved", "Answered only by a draft"),
      { ...item(ids.withheld, "rejected", "Withheld from public view"), moderation_notes: "TEST off-topic" },
      item(ids.pending, "pending", "Not yet reviewed"),
      item(ids.flagged, "flagged", "Flagged for review"),
    ],
    sessions: [], answers: [], definitions: [],
    responses: [
      response(id(201), [ids.answeredOnce, ids.answeredTwice], "2026-11-14T17:00:00Z"),
      response(id(202), [ids.answeredTwice, ids.answeredOnceMore], "2026-11-14T17:30:00Z"),
      response(id(203), [ids.unanswered], null),
    ],
  };
}

/**
 * The public copy of the same records, the way the snapshot function selects
 * it: approved contributions without review notes, and published responses
 * whose every source is in the copy.
 */
export function publicReviewCountSnapshot(): ReviewCountSnapshot {
  const internal = internalReviewCountSnapshot();
  const items = internal.items.filter((row) => row.status === "approved");
  const kept = new Set(items.map((row) => row.id));
  return {
    ...internal, schema: 1, scope: "public",
    items,
    responses: internal.responses.filter((row) => row.published_at && (row.source_item_ids as string[]).every((source) => kept.has(source))),
  };
}

/** A snapshot as the worker reads it: exact text and its SHA-256. */
export function savedSnapshot(snapshot: EngagementReviewSnapshot) {
  const text = JSON.stringify(snapshot);
  return { text, checksum: createHash("sha256").update(text).digest("hex") };
}
