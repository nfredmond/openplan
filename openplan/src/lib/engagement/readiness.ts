type EngagementModerationQueue = {
  actionableCount: number;
  readyForHandoffCount: number;
};

type EngagementCountsLike = {
  totalItems: number;
  uncategorizedItems: number;
  moderationQueue: EngagementModerationQueue;
  appendixReadiness?: {
    appendixReadyCount: number;
    publicApprovedCategorizedCount: number;
    nonPublicApprovedCategorizedCount: number;
    duplicateReviewCount: number;
    duplicateGroupCount: number;
    duplicateExcludedCount: number;
  };
};

type EngagementHandoffReadinessInput = {
  campaignStatus: string;
  projectLinked: boolean;
  categoryCount: number;
  counts: EngagementCountsLike;
};

export type EngagementHandoffReadinessCheck = {
  id:
    | "project"
    | "categories"
    | "categorization"
    | "review_queue"
    | "duplicate_review"
    | "approved_items"
    | "source_posture"
    | "report_appendix"
    | "campaign_status";
  label: string;
  passed: boolean;
  detail: string;
};

export type EngagementHandoffReadiness = {
  label: "Ready for handoff" | "Nearly ready" | "Needs attention";
  tone: "success" | "warning" | "neutral";
  completeCount: number;
  totalChecks: number;
  checks: EngagementHandoffReadinessCheck[];
  nextAction: string;
};

type EngagementPublicReviewCopyGuardInput = {
  campaignStatus: string;
  allowPublicSubmissions: boolean;
  shareToken: string | null;
  submissionsClosedAt: string | null;
  appendixReadyCount: number;
  actionableCount: number;
};

export type EngagementPublicReviewCopyGuard = {
  label: "Staff handoff only" | "Public-review draft" | "Closeout review";
  tone: "info" | "warning" | "neutral";
  summary: string;
  guardrails: string[];
  nextCopyAction: string;
};

export function getEngagementPublicReviewCopyGuard(
  input: EngagementPublicReviewCopyGuardInput
): EngagementPublicReviewCopyGuard {
  const publicPortalOpen = Boolean(input.shareToken && input.allowPublicSubmissions && !input.submissionsClosedAt);
  const closed = input.campaignStatus === "closed" || Boolean(input.submissionsClosedAt);
  const hasAppendixCandidates = input.appendixReadyCount > 0;

  const guardrails = [
    "Describe this as a planner review aid, not an official-record certification.",
    "Do not state or imply public-records handling, legal notice, or noticing sufficiency has been automated.",
    "Keep public comments, internal notes, meeting/email items, and duplicate-review holds visibly separated before publication.",
    "A planner or authorized agency reviewer must approve any public-review artifact before release.",
  ];

  if (publicPortalOpen) {
    return {
      label: "Public-review draft",
      tone: "warning",
      summary:
        "Public submissions are still open. Treat any appendix, matrix, or report section as a working draft for staff review.",
      guardrails,
      nextCopyAction:
        input.actionableCount > 0
          ? `Resolve ${input.actionableCount} pending or flagged moderation item${input.actionableCount === 1 ? "" : "s"} before using public-review copy externally.`
          : "Use draft-language copy until the intake window is closed and a planner confirms the publication posture.",
    };
  }

  if (closed && hasAppendixCandidates) {
    return {
      label: "Closeout review",
      tone: "info",
      summary:
        "The campaign has appendix candidates and a closeout posture, but staff still owns final publication, record, and noticing determinations.",
      guardrails,
      nextCopyAction:
        "Review the appendix-ready comments, duplicate holds, and source split before exporting board-packet or public-review language.",
    };
  }

  return {
    label: "Staff handoff only",
    tone: "neutral",
    summary:
      "Use this campaign internally until staff confirms the public-review artifact, source split, and handoff language are appropriate.",
    guardrails,
    nextCopyAction: hasAppendixCandidates
      ? "Confirm the campaign closeout/publication posture before describing appendix-ready comments as public-review material."
      : "Approve and categorize public comments before drafting a public-review appendix or comment matrix.",
  };
}

export function getEngagementHandoffReadiness(
  input: EngagementHandoffReadinessInput
): EngagementHandoffReadiness {
  const { campaignStatus, projectLinked, categoryCount, counts } = input;
  const appendixReadiness =
    counts.appendixReadiness ??
    {
      appendixReadyCount: counts.moderationQueue.readyForHandoffCount,
      publicApprovedCategorizedCount: counts.moderationQueue.readyForHandoffCount,
      nonPublicApprovedCategorizedCount: 0,
      duplicateReviewCount: 0,
      duplicateGroupCount: 0,
      duplicateExcludedCount: 0,
    };

  const checks: EngagementHandoffReadinessCheck[] = [
    {
      id: "project",
      label: "Linked project",
      passed: projectLinked,
      detail: projectLinked
        ? "Campaign is tied to a planning project for traceable downstream reporting."
        : "Link a project before treating this campaign as a planning handoff packet.",
    },
    {
      id: "categories",
      label: "Categories defined",
      passed: categoryCount > 0,
      detail:
        categoryCount > 0
          ? `${categoryCount} categor${categoryCount === 1 ? "y" : "ies"} available for classification.`
          : "Define at least one category so intake does not remain a flat unstructured queue.",
    },
    {
      id: "categorization",
      label: "Items categorized",
      passed: counts.totalItems === 0 || counts.uncategorizedItems === 0,
      detail:
        counts.totalItems === 0
          ? "No intake items have been submitted yet; categorization is not blocking setup review."
          : counts.uncategorizedItems === 0
            ? "All submitted items have category assignments for matrix and appendix grouping."
            : `${counts.uncategorizedItems} item${counts.uncategorizedItems === 1 ? " still needs" : "s still need"} a category before final matrix handoff.`,
    },
    {
      id: "review_queue",
      label: "Review queue resolved",
      passed: counts.moderationQueue.actionableCount === 0,
      detail:
        counts.moderationQueue.actionableCount === 0
          ? "No pending or flagged items remain in the active moderation queue."
          : `${counts.moderationQueue.actionableCount} pending or flagged item${counts.moderationQueue.actionableCount === 1 ? " still needs" : "s still need"} operator review.`,
    },
    {
      id: "duplicate_review",
      label: "Duplicate review resolved",
      passed: appendixReadiness.duplicateReviewCount === 0,
      detail:
        appendixReadiness.duplicateReviewCount === 0
          ? "No duplicate-looking active comments are open for appendix review."
          : `${appendixReadiness.duplicateReviewCount} active item${appendixReadiness.duplicateReviewCount === 1 ? " needs" : "s need"} duplicate review before appendix handoff.`,
    },
    {
      id: "approved_items",
      label: "Approved categorized items present",
      passed: counts.moderationQueue.readyForHandoffCount > 0,
      detail:
        counts.moderationQueue.readyForHandoffCount > 0
          ? `${counts.moderationQueue.readyForHandoffCount} approved item${counts.moderationQueue.readyForHandoffCount === 1 ? " is" : "s are"} ready for report inclusion.`
          : "Approve and categorize at least one item before calling the campaign handoff-ready.",
    },
    {
      id: "source_posture",
      label: "Public/private source posture visible",
      passed:
        counts.moderationQueue.readyForHandoffCount > 0 &&
        appendixReadiness.publicApprovedCategorizedCount + appendixReadiness.nonPublicApprovedCategorizedCount ===
          counts.moderationQueue.readyForHandoffCount,
      detail:
        counts.moderationQueue.readyForHandoffCount > 0
          ? `${appendixReadiness.publicApprovedCategorizedCount} public comment${appendixReadiness.publicApprovedCategorizedCount === 1 ? "" : "s"} and ${appendixReadiness.nonPublicApprovedCategorizedCount} internal/meeting/email item${appendixReadiness.nonPublicApprovedCategorizedCount === 1 ? "" : "s"} are separated for staff review.`
          : "Approve categorized items before staff can separate public comments from internal notes for handoff.",
    },
    {
      id: "report_appendix",
      label: "Report appendix candidates",
      passed: appendixReadiness.appendixReadyCount > 0,
      detail:
        appendixReadiness.appendixReadyCount > 0
          ? `${appendixReadiness.appendixReadyCount} approved public comment${appendixReadiness.appendixReadyCount === 1 ? " is" : "s are"} appendix-ready after category and duplicate checks.`
          : appendixReadiness.nonPublicApprovedCategorizedCount > 0
            ? "Approved non-public notes are available, but no approved public comments are ready for appendix use yet."
            : "Approve at least one categorized public comment before building the public-comment appendix.",
    },
    {
      id: "campaign_status",
      label: "Campaign status supports handoff",
      passed: campaignStatus === "active" || campaignStatus === "closed",
      detail:
        campaignStatus === "closed"
          ? "Closed is the strongest closeout posture for planning handoff."
          : campaignStatus === "active"
            ? "Active campaigns can hand off, though closed is the cleanest final posture."
            : `Current status is ${campaignStatus}. Move the campaign to Active or Closed before final handoff.`,
    },
  ];

  const completeCount = checks.filter((check) => check.passed).length;
  const totalChecks = checks.length;

  const label =
    completeCount === totalChecks && campaignStatus === "closed"
      ? "Ready for handoff"
      : completeCount >= totalChecks - 1
        ? "Nearly ready"
        : "Needs attention";

  const tone =
    label === "Ready for handoff"
      ? "success"
      : label === "Nearly ready"
        ? "warning"
        : "neutral";

  let nextAction = "Campaign is in a credible handoff posture for planning review.";

  if (!projectLinked) {
    nextAction = "Link the campaign to the correct project so report creation and planning traceability stay intact.";
  } else if (categoryCount === 0) {
    nextAction = "Add at least one category so incoming items can be classified before handoff.";
  } else if (counts.uncategorizedItems > 0) {
    nextAction = `Categorize the ${counts.uncategorizedItems} uncategorized item${counts.uncategorizedItems === 1 ? "" : "s"} before final report matrix handoff.`;
  } else if (counts.moderationQueue.actionableCount > 0) {
    nextAction = `Resolve the ${counts.moderationQueue.actionableCount} pending or flagged moderation item${counts.moderationQueue.actionableCount === 1 ? "" : "s"} before calling this packet ready.`;
  } else if (appendixReadiness.duplicateReviewCount > 0) {
    nextAction = `Resolve ${appendixReadiness.duplicateReviewCount} duplicate-review item${appendixReadiness.duplicateReviewCount === 1 ? "" : "s"} before using comments in the report appendix.`;
  } else if (counts.moderationQueue.readyForHandoffCount === 0) {
    nextAction = "Approve and categorize at least one item so the handoff packet includes review-ready signal, not just setup state.";
  } else if (appendixReadiness.appendixReadyCount === 0) {
    nextAction = "Separate at least one approved public comment from internal or meeting notes before building the public-comment appendix.";
  } else if (!(campaignStatus === "active" || campaignStatus === "closed")) {
    nextAction = "Move the campaign into Active or Closed status before final handoff.";
  } else if (campaignStatus === "active") {
    nextAction = "Handoff is viable now; close the campaign when intake is complete for the cleanest final packet posture.";
  }

  return {
    label,
    tone,
    completeCount,
    totalChecks,
    checks,
    nextAction,
  };
}
