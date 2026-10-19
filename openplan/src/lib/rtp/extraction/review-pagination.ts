import { z } from "zod";

export const PENDING_REVIEW_PAGE_SIZE = 25;
export const READING_HISTORY_PAGE_SIZE = 50;
export const MAX_READING_HISTORY_PAGE = 100_000;

const cursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() });
export type PendingReviewCursor = z.infer<typeof cursorSchema>;
export type ReviewSearch = Record<string, string | string[] | undefined>;

/** Validate both cursor parts before placing them in a PostgREST filter. */
export function readReviewPagination(search: ReviewSearch) {
  const hasCursor = search.afterCreatedAt !== undefined || search.afterId !== undefined;
  const cursor = hasCursor ? cursorSchema.safeParse({ createdAt: search.afterCreatedAt, id: search.afterId }) : null;
  const history = z.coerce.number().int().min(1).max(MAX_READING_HISTORY_PAGE).safeParse(search.historyPage ?? 1);
  return {
    invalidCursor: cursor !== null && !cursor.success,
    cursor: cursor?.success ? cursor.data : null,
    invalidHistory: Array.isArray(search.historyPage) || !history.success,
    historyPage: history.success && !Array.isArray(search.historyPage) ? history.data : 1,
  };
}

/** Timestamp and UUID vocabulary excludes filter delimiters. Ties use the UUID. */
export function pendingReviewAfterFilter(cursor: PendingReviewCursor): string {
  return `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`;
}

export function reviewPageHref(cycleId: string, cursor: PendingReviewCursor | null, historyPage = 1): string {
  const query = new URLSearchParams();
  if (cursor) { query.set("afterCreatedAt", cursor.createdAt); query.set("afterId", cursor.id); }
  if (historyPage !== 1) query.set("historyPage", String(historyPage));
  return `/rtp/${encodeURIComponent(cycleId)}/extraction${query.size ? `?${query}` : ""}`;
}
