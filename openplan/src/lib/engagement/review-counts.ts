/** The four review states, in the order the engagement review files list them. */
export const ENGAGEMENT_REVIEW_STATES = ["pending", "flagged", "approved", "rejected"] as const;
export type EngagementReviewState = (typeof ENGAGEMENT_REVIEW_STATES)[number];

/**
 * How the review files name a state: the words of the review status picker on
 * the campaign's review files panel. A rejected comment reads as withheld.
 */
export function engagementReviewStateLabel(state: EngagementReviewState): string {
  switch (state) {
    case "approved": return "Approved";
    case "rejected": return "Withheld";
    case "pending": return "Pending";
    case "flagged": return "Flagged for review";
  }
}

/**
 * Contributions by review state. The internal engagement review files and the
 * project packet both count through here, so a board reader who holds both
 * sees the same numbers.
 */
export function countContributionsByReviewState(
  items: ReadonlyArray<{ status?: unknown }>
): Record<EngagementReviewState, number> {
  const counts: Record<EngagementReviewState, number> = { pending: 0, flagged: 0, approved: 0, rejected: 0 };
  for (const item of items) {
    if ((ENGAGEMENT_REVIEW_STATES as readonly unknown[]).includes(item.status)) {
      counts[item.status as EngagementReviewState] += 1;
    }
  }
  return counts;
}

export type EngagementReviewCounts = {
  /** Contributions in the selection, in any state. */
  received: number;
  byState: Record<EngagementReviewState, number>;
  /** Staff responses that are published. */
  publishedResponses: number;
  /** Contributions in the selection that at least one published response answers, each counted once. */
  answered: number;
};

/**
 * The counts a review file or the public response page states: received, by
 * review state, published responses, and contributions answered by a published
 * response. The review PDF, the review workbook, the review ZIP's manifest and
 * the public response page all count here, so the numbers cannot drift apart.
 *
 * A contribution two responses answer is one answered contribution. A source
 * identifier outside `items` (another selection) is not counted.
 */
export function countEngagementReview(input: {
  items: ReadonlyArray<{ id?: unknown; status?: unknown }>;
  responses: ReadonlyArray<{ sourceItemIds: unknown; published: boolean }>;
}): EngagementReviewCounts {
  const itemIds = new Set(input.items.map((item) => item.id));
  const answered = new Set<unknown>();
  let publishedResponses = 0;
  for (const response of input.responses) {
    if (!response.published) continue;
    publishedResponses += 1;
    if (!Array.isArray(response.sourceItemIds)) continue;
    for (const id of response.sourceItemIds) if (itemIds.has(id)) answered.add(id);
  }
  return {
    received: input.items.length,
    byState: countContributionsByReviewState(input.items),
    publishedResponses,
    answered: answered.size,
  };
}
