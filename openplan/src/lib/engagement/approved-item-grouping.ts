/**
 * Splitting approved public comments into threads.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT A HELPER INSIDE THE PORTAL COMPONENT
 *   It has two callers with nothing else in common: the client component that
 *   renders the comment feed, and the SERVER component that renders the
 *   resident's entry page. It used to live in the portal component, which
 *   begins `"use client"` — and in the App Router every export of a client
 *   module becomes a client reference, so calling one during a server render
 *   throws at REQUEST time:
 *
 *     Attempted to call groupApprovedItems() from the server but
 *     groupApprovedItems is on the client.
 *
 *   That shipped in the map-first rebuild on 2026-08-13 and returned HTTP 500
 *   on the resident-facing portal for every campaign, with 30 tests green — the
 *   suite renders the components directly and so never crosses the boundary the
 *   error is about. Confirmed by loading the real page (`curl` → 500) before
 *   fixing it.
 *
 *   Keeping it here means neither caller can drag the other across that line,
 *   because this module has no directive and no React import.
 */

/** One approved public comment, as both the feed and the entry page read it. */
export type ApprovedItem = {
  id: string;
  categoryId: string | null;
  title: string | null;
  body: string;
  submittedBy: string | null;
  latitude: number | null;
  longitude: number | null;
  geometry?: unknown;
  votesCount?: number;
  parentItemId?: string | null;
  photoUrl?: string | null;
  createdAt: string;
};

export type ApprovedItemGrouping = {
  topLevel: ApprovedItem[];
  repliesByParent: Map<string, ApprovedItem[]>;
};

/**
 * E6 — split approved items into top-level comments and the replies nested under
 * them. A reply whose parent is not itself an approved top-level item (e.g. the
 * parent was un-approved after the reply cleared moderation) is dropped from the
 * public view rather than shown stripped of its context. Replies read oldest-
 * first so a thread flows chronologically. Preserves the caller's ordering of
 * top-level items (the loader sorts newest-first).
 */
export function groupApprovedItems(items: ApprovedItem[]): ApprovedItemGrouping {
  const topLevel = items.filter((item) => !item.parentItemId);
  const topLevelIds = new Set(topLevel.map((item) => item.id));
  const repliesByParent = new Map<string, ApprovedItem[]>();
  for (const item of items) {
    const parentId = item.parentItemId;
    if (!parentId || !topLevelIds.has(parentId)) continue; // top-level or orphaned
    const bucket = repliesByParent.get(parentId);
    if (bucket) bucket.push(item);
    else repliesByParent.set(parentId, [item]);
  }
  for (const bucket of repliesByParent.values()) {
    bucket.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }
  return { topLevel, repliesByParent };
}
