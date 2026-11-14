/**
 * Finds a campaign's approved staff review through the staff-scoped readers
 * the campaign page uses. See `staff-review-finding.ts` for what an export
 * may say about it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSynthesisApprovalState } from "./synthesis-approval-server";
import { synthesisReviewListSchema } from "./synthesis-review-records";
import { synthesisSourceListSchema } from "./synthesis-sources";
import type { ApprovedStaffReviewFinding, StaffReviewRead } from "./staff-review-finding";

/** Newest saved source sets read. Each holds its own reviews. */
const STAFF_REVIEW_SOURCE_LIMIT = 5;
/** Reviews verified per export, newest first. Each verification replays the review's history. */
const STAFF_REVIEW_CHECK_LIMIT = 10;

type RpcClient = Pick<SupabaseClient, "rpc">;
type ApprovalState = NonNullable<Awaited<ReturnType<typeof loadSynthesisApprovalState>>>;

/** The current revision is approved, and no later approval event withdrew it. */
function currentRevisionApproved(state: ApprovalState): boolean {
  const head = state.history.head;
  return Boolean(head)
    && head!.intent.operation === "approve"
    && head!.intent.revisionId === state.current.revisionId
    && state.review.currentRevisionId === state.review.revision.requestId;
}

function findingFrom(state: ApprovalState): ApprovedStaffReviewFinding {
  const { review } = state;
  const snapshot = review.source.snapshot;
  return {
    reviewId: review.reviewId,
    revisionNo: review.revision.revisionNo,
    approvedAt: state.history.head!.createdAt,
    sourceId: review.sourceId,
    sourceCapturedAt: snapshot.capturedAt,
    selectionStatuses: [...snapshot.selection.statuses],
    includesComments: snapshot.selection.includeItems,
    includesSurveys: snapshot.selection.includeSurveys,
    commentCount: snapshot.counts.items,
    surveyAnswerCount: snapshot.counts.answers,
    assignedCount: review.content.assignedSourceCount,
    unassignedCount: review.content.unassignedSourceIds.length,
    themes: review.content.groups
      .map((group) => ({ label: group.label.trim(), recordCount: group.sourceIds.length, sentiment: group.sentiment }))
      .sort((left, right) => right.recordCount - left.recordCount),
  };
}

/**
 * The newest staff review whose current revision is approved. A review that
 * fails verification is never read as unapproved: when no approved review is
 * found and any review failed, the approval state is unknown.
 */
export async function loadApprovedStaffReview(
  client: RpcClient,
  scope: { campaignId: string; workspaceId: string }
): Promise<StaffReviewRead> {
  const unreadable = { status: "unreadable", reason: "Saved staff reviews could not be read. That is a failed read, not an absence of review." } as const;
  let sources;
  try {
    const listed = await client.rpc("list_engagement_synthesis_sources", { p_campaign: scope.campaignId, p_before: null });
    if (listed.error) return unreadable;
    sources = synthesisSourceListSchema.parse(listed.data);
  } catch {
    return unreadable;
  }
  if (sources.campaignId !== scope.campaignId || sources.workspaceId !== scope.workspaceId) return unreadable;

  let limitReached = sources.entries.length > STAFF_REVIEW_SOURCE_LIMIT || sources.nextCursor !== null;
  let checked = 0;
  let unverified = 0;
  for (const source of sources.entries.slice(0, STAFF_REVIEW_SOURCE_LIMIT)) {
    let reviews;
    try {
      const listed = await client.rpc("list_engagement_synthesis_reviews", { p_campaign: scope.campaignId, p_source: source.requestId, p_before: null });
      if (listed.error) return unreadable;
      reviews = synthesisReviewListSchema.parse(listed.data);
    } catch {
      return unreadable;
    }
    if (reviews.campaignId !== scope.campaignId || reviews.workspaceId !== scope.workspaceId || reviews.sourceId !== source.requestId) return unreadable;
    if (reviews.nextCursor !== null) limitReached = true;
    for (const entry of reviews.entries) {
      if (checked >= STAFF_REVIEW_CHECK_LIMIT) {
        limitReached = true;
        break;
      }
      checked += 1;
      try {
        const state = await loadSynthesisApprovalState(client, { campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: entry.reviewId });
        if (!state) {
          unverified += 1;
          continue;
        }
        if (currentRevisionApproved(state)) return { status: "approved", finding: findingFrom(state), unverifiedReviewCount: unverified };
      } catch {
        unverified += 1;
      }
    }
  }
  if (unverified > 0) {
    return {
      status: "unreadable",
      reason: `${unverified} saved staff review(s) could not be verified, so whether an approved review exists is unknown.`,
    };
  }
  return { status: "none", checkedReviewCount: checked, limitReached };
}

