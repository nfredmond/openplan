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
