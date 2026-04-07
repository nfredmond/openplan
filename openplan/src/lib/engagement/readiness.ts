type EngagementModerationQueue = {
  actionableCount: number;
  readyForHandoffCount: number;
};

type EngagementCountsLike = {
  totalItems: number;
  uncategorizedItems: number;
  moderationQueue: EngagementModerationQueue;
};

type EngagementHandoffReadinessInput = {
  campaignStatus: string;
  projectLinked: boolean;
  categoryCount: number;
  counts: EngagementCountsLike;
};

export type EngagementHandoffReadinessCheck = {
  id: "project" | "categories" | "review_queue" | "approved_items" | "campaign_status";
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

export function getEngagementHandoffReadiness(
  input: EngagementHandoffReadinessInput
): EngagementHandoffReadiness {
  const { campaignStatus, projectLinked, categoryCount, counts } = input;

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
      id: "review_queue",
      label: "Review queue resolved",
      passed: counts.moderationQueue.actionableCount === 0,
      detail:
        counts.moderationQueue.actionableCount === 0
          ? "No pending or flagged items remain in the active moderation queue."
          : `${counts.moderationQueue.actionableCount} pending or flagged item${counts.moderationQueue.actionableCount === 1 ? " still needs" : "s still need"} operator review.`,
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
  } else if (counts.moderationQueue.actionableCount > 0) {
    nextAction = `Resolve the ${counts.moderationQueue.actionableCount} pending or flagged moderation item${counts.moderationQueue.actionableCount === 1 ? "" : "s"} before calling this packet ready.`;
  } else if (counts.moderationQueue.readyForHandoffCount === 0) {
    nextAction = "Approve and categorize at least one item so the handoff packet includes review-ready signal, not just setup state.";
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
