import { getReportPacketWorkStatus, type ReportStatusTone } from "@/lib/reports/catalog";

export const RTP_CYCLE_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "public_review", label: "Public Review" },
  { value: "adopted", label: "Adopted" },
  { value: "archived", label: "Archived" },
] as const;

export type RtpCycleStatus = (typeof RTP_CYCLE_STATUS_OPTIONS)[number]["value"];

export const RTP_PORTFOLIO_ROLE_OPTIONS = [
  { value: "candidate", label: "Candidate" },
  { value: "constrained", label: "Constrained" },
  { value: "illustrative", label: "Illustrative" },
] as const;

export type RtpPortfolioRole = (typeof RTP_PORTFOLIO_ROLE_OPTIONS)[number]["value"];

export const RTP_CHAPTER_STATUS_OPTIONS = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "ready_for_review", label: "Ready for Review" },
  { value: "complete", label: "Complete" },
] as const;

export type RtpChapterStatus = (typeof RTP_CHAPTER_STATUS_OPTIONS)[number]["value"];

export type RtpChapterTemplate = {
  chapterKey: string;
  title: string;
  sectionType: "policy" | "action" | "financial" | "engagement" | "performance" | "resilience" | "compliance";
  sortOrder: number;
  required: boolean;
  guidance: string;
};

export const RTP_CHAPTER_TEMPLATES: RtpChapterTemplate[] = [
  {
    chapterKey: "vision_goals_policy",
    title: "Vision, goals, and policy framework",
    sectionType: "policy",
    sortOrder: 10,
    required: true,
    guidance: "Capture the policy element, goals, objectives, and performance direction that explain why the RTP exists.",
  },
  {
    chapterKey: "action_element",
    title: "Action element and implementation approach",
    sectionType: "action",
    sortOrder: 20,
    required: true,
    guidance: "Describe implementation actions, delivery posture, partners, and how the RTP translates into near- and mid-term work.",
  },
  {
    chapterKey: "financial_element",
    title: "Financial element and fiscal constraint",
    sectionType: "financial",
    sortOrder: 30,
    required: true,
    guidance: "Track revenue assumptions, year-of-expenditure logic, fiscal constraint, and the bridge between constrained and illustrative programs.",
  },
  {
    chapterKey: "project_portfolio",
    title: "Project portfolio and prioritization",
    sectionType: "performance",
    sortOrder: 40,
    required: true,
    guidance: "Summarize constrained, illustrative, and candidate projects with prioritization logic tied back to adopted goals.",
  },
  {
    chapterKey: "consultation_engagement",
    title: "Consultation, tribal coordination, and public engagement",
    sectionType: "engagement",
    sortOrder: 50,
    required: true,
    guidance: "Record public involvement, interagency consultation, and tribal coordination as a first-class RTP output.",
  },
  {
    chapterKey: "safety_resilience",
    title: "Safety, resilience, and emergency preparedness",
    sectionType: "resilience",
    sortOrder: 60,
    required: true,
    guidance: "Cover transportation safety, emergency preparedness, and rural resilience posture required for the RTP narrative.",
  },
  {
    chapterKey: "adoption_compliance_appendix",
    title: "Adoption package and compliance appendix",
    sectionType: "compliance",
    sortOrder: 70,
    required: true,
    guidance: "Assemble checklist, resolutions, comment-response materials, and board-ready compliance artifacts.",
  },
];

export type RtpCycleReadinessCheck = {
  key: "geography" | "horizon" | "adoption_target" | "public_review_window";
  label: string;
  ready: boolean;
  detail: string;
};

export type RtpCycleReadinessSummary = {
  label: string;
  reason: string;
  tone: "success" | "warning" | "neutral";
  ready: boolean;
  readyCheckCount: number;
  totalCheckCount: number;
  missingCheckLabels: string[];
  nextSteps: string[];
  checks: RtpCycleReadinessCheck[];
};

export type RtpCycleWorkflowSummary = {
  label: string;
  detail: string;
  tone: "success" | "warning" | "neutral" | "info";
  actionItems: string[];
};

export type RtpPublicReviewSummary = {
  label: string;
  detail: string;
  tone: "success" | "warning" | "neutral" | "info";
  actionItems: string[];
};

export type RtpReleaseReviewSummary = {
  label: string;
  detail: string;
  tone: ReportStatusTone;
  nextActionLabel: string;
};

export function titleizeRtpValue(value: string | null | undefined): string {
  if (!value) return "Unknown";

  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatRtpCycleStatusLabel(value: string | null | undefined): string {
  return RTP_CYCLE_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? titleizeRtpValue(value);
}

export function formatRtpPortfolioRoleLabel(value: string | null | undefined): string {
  return RTP_PORTFOLIO_ROLE_OPTIONS.find((option) => option.value === value)?.label ?? titleizeRtpValue(value);
}

export function formatRtpChapterStatusLabel(value: string | null | undefined): string {
  return RTP_CHAPTER_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? titleizeRtpValue(value);
}

export function formatRtpDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function formatRtpDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export function rtpCycleStatusTone(status: string | null | undefined): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "adopted") return "success";
  if (status === "public_review") return "info";
  if (status === "archived") return "warning";
  if (status === "draft") return "neutral";
  return "neutral";
}

export function rtpPortfolioRoleTone(role: string | null | undefined): "info" | "success" | "warning" | "danger" | "neutral" {
  if (role === "constrained") return "success";
  if (role === "illustrative") return "warning";
  if (role === "candidate") return "neutral";
  return "neutral";
}

export function rtpChapterStatusTone(status: string | null | undefined): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "complete") return "success";
  if (status === "ready_for_review") return "info";
  if (status === "in_progress") return "warning";
  if (status === "not_started") return "neutral";
  return "neutral";
}

export function buildRtpCycleReadiness({
  geographyLabel,
  horizonStartYear,
  horizonEndYear,
  adoptionTargetDate,
  publicReviewOpenAt,
  publicReviewCloseAt,
}: {
  geographyLabel: string | null | undefined;
  horizonStartYear: number | null | undefined;
  horizonEndYear: number | null | undefined;
  adoptionTargetDate: string | null | undefined;
  publicReviewOpenAt: string | null | undefined;
  publicReviewCloseAt: string | null | undefined;
}): RtpCycleReadinessSummary {
  const hasReviewWindow = Boolean(publicReviewOpenAt && publicReviewCloseAt);
  const checks: RtpCycleReadinessCheck[] = [
    {
      key: "geography",
      label: "Geography label",
      ready: Boolean(geographyLabel?.trim()),
      detail: geographyLabel?.trim() ? geographyLabel.trim() : "Add the geography this RTP cycle covers.",
    },
    {
      key: "horizon",
      label: "Horizon years",
      ready: typeof horizonStartYear === "number" && typeof horizonEndYear === "number",
      detail:
        typeof horizonStartYear === "number" && typeof horizonEndYear === "number"
          ? `${horizonStartYear}–${horizonEndYear}`
          : "Add the start and end years for the long-range RTP horizon.",
    },
    {
      key: "adoption_target",
      label: "Adoption target",
      ready: Boolean(adoptionTargetDate),
      detail: adoptionTargetDate ? formatRtpDate(adoptionTargetDate) : "Add a target board adoption date.",
    },
    {
      key: "public_review_window",
      label: "Public review window",
      ready: hasReviewWindow,
      detail: hasReviewWindow
        ? `${formatRtpDateTime(publicReviewOpenAt)} to ${formatRtpDateTime(publicReviewCloseAt)}`
        : "Add a public review open/close window before treating the cycle as review-ready.",
    },
  ];

  const readyCheckCount = checks.filter((check) => check.ready).length;
  const missingChecks = checks.filter((check) => !check.ready);

  if (missingChecks.length === 0) {
    return {
      label: "Foundation ready",
      reason: "Core RTP cycle metadata is in place for portfolio and chapter work.",
      tone: "success",
      ready: true,
      readyCheckCount,
      totalCheckCount: checks.length,
      missingCheckLabels: [],
      nextSteps: [],
      checks,
    };
  }

  return {
    label: readyCheckCount >= 2 ? "In progress" : "Needs setup",
    reason: missingChecks[0]?.detail ?? "Add the missing cycle metadata before using this as an RTP control object.",
    tone: readyCheckCount === 0 ? "neutral" : "warning",
    ready: false,
    readyCheckCount,
    totalCheckCount: checks.length,
    missingCheckLabels: missingChecks.map((check) => check.label),
    nextSteps: missingChecks.map((check) => check.detail),
    checks,
  };
}

export function buildRtpCycleWorkflowSummary({
  status,
  readiness,
}: {
  status: string | null | undefined;
  readiness: RtpCycleReadinessSummary;
}): RtpCycleWorkflowSummary {
  if (status === "adopted") {
    return {
      label: "Adopted cycle",
      detail: "The cycle is marked adopted. Keep project, engagement, and funding linkages traceable as updates land.",
      tone: "success",
      actionItems: ["Confirm the project portfolio is current.", "Keep report and adoption artifacts linked."],
    };
  }

  if (status === "public_review") {
    return {
      label: "Public review active",
      detail: "The cycle is in public review posture. Keep chapter and project comment windows explicit and time-bounded.",
      tone: "info",
      actionItems: ["Verify the public review window.", "Prepare comment-response and board packet outputs."],
    };
  }

  if (!readiness.ready) {
    return {
      label: "Setup still needed",
      detail: readiness.reason,
      tone: readiness.tone,
      actionItems: readiness.nextSteps.slice(0, 3),
    };
  }

  return {
    label: "Ready for build-out",
    detail: "The cycle can now anchor project portfolio, chapter, engagement, and funding work.",
    tone: "success",
    actionItems: ["Link projects into the cycle.", "Start chapter scaffolding.", "Attach public engagement windows."],
  };
}

function lowercaseFirst(text: string) {
  return text.length > 0 ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

export function buildRtpReleaseReviewSummary(input: {
  packetFreshnessLabel: string;
  publicReviewSummary: RtpPublicReviewSummary | null;
}): RtpReleaseReviewSummary {
  const packetWorkStatus = getReportPacketWorkStatus(input.packetFreshnessLabel);

  if (packetWorkStatus.key !== "release-review") {
    return {
      label: packetWorkStatus.label,
      detail: packetWorkStatus.detail,
      tone: packetWorkStatus.tone,
      nextActionLabel:
        packetWorkStatus.key === "generate-first" ? "Generate first packet" : "Refresh packet",
    };
  }

  if (!input.publicReviewSummary) {
    return {
      label: packetWorkStatus.label,
      detail: packetWorkStatus.detail,
      tone: packetWorkStatus.tone,
      nextActionLabel: "Open release review",
    };
  }

  const summary = input.publicReviewSummary;

  if (summary.label === "Comment-response foundation ready") {
    return {
      label: "Release review ready",
      detail: `The packet is current and ${lowercaseFirst(summary.detail)}`,
      tone: "success",
      nextActionLabel: "Open release review",
    };
  }

  if (summary.label === "Public review active") {
    return {
      label: "Review loop still open",
      detail: `The packet is current, but ${lowercaseFirst(summary.detail)} Treat release review as in progress until moderation closes.`,
      tone: "warning",
      nextActionLabel: "Close pending comment review",
    };
  }

  if (summary.label === "Public review foundation ready") {
    return {
      label: "Comment basis still forming",
      detail: `The packet is current and ${lowercaseFirst(summary.detail)} Release review can start, but it should not be treated as settled until approved comments are carried into the packet response summary.`,
      tone: "info",
      nextActionLabel: "Build response summary",
    };
  }

  return {
    label: summary.label,
    detail: summary.detail,
    tone: summary.tone,
    nextActionLabel: summary.actionItems[0] ?? "Review public input",
  };
}

export function buildRtpPublicReviewSummary({
  status,
  publicReviewOpenAt,
  publicReviewCloseAt,
  cycleLevelCampaignCount,
  chapterCampaignCount,
  packetRecordCount,
  generatedPacketCount,
  pendingCommentCount,
  approvedCommentCount,
  readyCommentCount,
}: {
  status: string | null | undefined;
  publicReviewOpenAt: string | null | undefined;
  publicReviewCloseAt: string | null | undefined;
  cycleLevelCampaignCount: number;
  chapterCampaignCount: number;
  packetRecordCount: number;
  generatedPacketCount: number;
  pendingCommentCount: number;
  approvedCommentCount: number;
  readyCommentCount: number;
}): RtpPublicReviewSummary {
  const hasReviewWindow = Boolean(publicReviewOpenAt && publicReviewCloseAt);
  const totalCampaignCount = cycleLevelCampaignCount + chapterCampaignCount;
  const hasPacketArtifact = generatedPacketCount > 0;
  const actionItems: string[] = [];

  if (!hasReviewWindow) {
    actionItems.push("Set a public review open and close window before calling the cycle review-ready.");
  }
  if (cycleLevelCampaignCount === 0) {
    actionItems.push("Create one whole-cycle engagement campaign so planwide comments land on a single RTP review target.");
  }
  if (totalCampaignCount === 0) {
    actionItems.push("Add at least one RTP-linked engagement campaign so review comments can feed back into the cycle.");
  }
  if (!hasPacketArtifact) {
    actionItems.push("Create and generate a current RTP packet before board or public review begins.");
  }
  if (pendingCommentCount > 0) {
    actionItems.push(`Resolve ${pendingCommentCount} pending public comment${pendingCommentCount === 1 ? "" : "s"} before final packet closeout.`);
  }
  if (approvedCommentCount === 0) {
    actionItems.push("Approve at least one categorized comment so the cycle has a real comment-response basis, not just setup state.");
  }

  if (status === "public_review" && hasReviewWindow && totalCampaignCount > 0 && hasPacketArtifact) {
    if (pendingCommentCount > 0) {
      return {
        label: "Public review active",
        detail: `${pendingCommentCount} comment${pendingCommentCount === 1 ? " is" : "s are"} still waiting for operator review while ${readyCommentCount} approved item${readyCommentCount === 1 ? " is" : "s are"} already ready for packet handoff.`,
        tone: "warning",
        actionItems: actionItems.slice(0, 3),
      };
    }

    return {
      label: readyCommentCount > 0 ? "Comment-response foundation ready" : "Public review active",
      detail:
        readyCommentCount > 0
          ? `${readyCommentCount} approved comment${readyCommentCount === 1 ? " is" : "s are"} ready for packet handoff and the current RTP packet is in place for review closure.`
          : "The cycle is in public review posture with a live window, engagement linkage, and a generated packet, but approved comment-response material is still missing.",
      tone: readyCommentCount > 0 ? "success" : "info",
      actionItems:
        readyCommentCount > 0
          ? ["Refresh the packet after material comment changes.", "Carry approved comments into the board-ready response summary."]
          : actionItems.slice(0, 3),
    };
  }

  if (hasReviewWindow && totalCampaignCount > 0 && hasPacketArtifact) {
    return {
      label: "Public review foundation ready",
      detail: `The cycle has a review window, ${packetRecordCount} packet record${packetRecordCount === 1 ? "" : "s"} (${generatedPacketCount} generated), and ${totalCampaignCount} linked engagement campaign${totalCampaignCount === 1 ? "" : "s"}.`,
      tone: approvedCommentCount > 0 ? "success" : "info",
      actionItems:
        approvedCommentCount > 0
          ? ["Move the cycle into public review when intake should open.", "Keep packet refreshes tied to approved comment-response changes."]
          : actionItems.slice(0, 3),
    };
  }

  return {
    label: actionItems.length > 2 ? "Needs review foundation" : "Review foundation in progress",
    detail: actionItems[0] ?? "The RTP cycle has the minimum review foundation in place.",
    tone: actionItems.length > 2 ? "warning" : "neutral",
    actionItems: actionItems.slice(0, 4),
  };
}
