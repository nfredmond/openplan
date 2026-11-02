/** The four review states, in the order the engagement review files list them. */
export const ENGAGEMENT_REVIEW_STATES = ["pending", "flagged", "approved", "rejected"] as const;
export type EngagementReviewState = (typeof ENGAGEMENT_REVIEW_STATES)[number];

/** How the review files and the project packet name a state. A rejected comment reads as withheld. */
export function engagementReviewStateLabel(state: EngagementReviewState): string {
  return state === "approved" ? "Approved" : state === "rejected" ? "Withheld" : state;
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
