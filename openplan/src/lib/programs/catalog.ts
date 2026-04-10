export const PROGRAM_TYPE_OPTIONS = [
  { value: "rtip", label: "RTIP" },
  { value: "stip", label: "STIP" },
  { value: "itip", label: "ITIP" },
  { value: "tcep", label: "TCEP" },
  { value: "local_measure", label: "Local Measure" },
  { value: "other", label: "Other Program Lane" },
] as const;

export const PROGRAM_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "assembling", label: "Assembling" },
  { value: "submitted", label: "Submitted" },
  { value: "programmed", label: "Programmed" },
  { value: "adopted", label: "Adopted" },
  { value: "archived", label: "Archived" },
] as const;

export const PROGRAM_FUNDING_CLASSIFICATION_OPTIONS = [
  { value: "formula", label: "Formula" },
  { value: "discretionary", label: "Discretionary" },
  { value: "mixed", label: "Mixed" },
  { value: "other", label: "Other" },
] as const;

export const FUNDING_OPPORTUNITY_STATUS_OPTIONS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "awarded", label: "Awarded" },
  { value: "archived", label: "Archived" },
] as const;

export const FUNDING_OPPORTUNITY_DECISION_OPTIONS = [
  { value: "monitor", label: "Monitor" },
  { value: "pursue", label: "Pursue" },
  { value: "skip", label: "Skip" },
] as const;

export const FUNDING_AWARD_MATCH_POSTURE_OPTIONS = [
  { value: "secured", label: "Secured" },
  { value: "partial", label: "Partial" },
  { value: "unfunded", label: "Unfunded" },
  { value: "not_required", label: "Not required" },
] as const;

export const FUNDING_AWARD_SPENDING_STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "active", label: "Active" },
  { value: "delayed", label: "Delayed" },
  { value: "fully_spent", label: "Fully spent" },
] as const;

export const FUNDING_AWARD_RISK_FLAG_OPTIONS = [
  { value: "none", label: "No active risk" },
  { value: "watch", label: "Watch" },
  { value: "critical", label: "Critical" },
] as const;

export const PROGRAM_LINK_TYPE_OPTIONS = [
  { value: "plan", label: "Plan Record" },
  { value: "report", label: "Report" },
  { value: "engagement_campaign", label: "Engagement Campaign" },
  { value: "project_record", label: "Project Record" },
] as const;

export type ProgramType = (typeof PROGRAM_TYPE_OPTIONS)[number]["value"];
export type ProgramStatus = (typeof PROGRAM_STATUS_OPTIONS)[number]["value"];
export type ProgramLinkType = (typeof PROGRAM_LINK_TYPE_OPTIONS)[number]["value"];
export type ProgramFundingClassification = (typeof PROGRAM_FUNDING_CLASSIFICATION_OPTIONS)[number]["value"];
export type FundingOpportunityStatus = (typeof FUNDING_OPPORTUNITY_STATUS_OPTIONS)[number]["value"];
export type FundingOpportunityDecision = (typeof FUNDING_OPPORTUNITY_DECISION_OPTIONS)[number]["value"];
export type FundingAwardMatchPosture = (typeof FUNDING_AWARD_MATCH_POSTURE_OPTIONS)[number]["value"];
export type FundingAwardSpendingStatus = (typeof FUNDING_AWARD_SPENDING_STATUS_OPTIONS)[number]["value"];
export type FundingAwardRiskFlag = (typeof FUNDING_AWARD_RISK_FLAG_OPTIONS)[number]["value"];

export type ProgramReadinessCheck = {
  key:
    | "cycle_name"
    | "project"
    | "plan"
    | "report"
    | "engagement_campaign"
    | "sponsor_agency"
    | "fiscal_window"
    | "schedule";
  label: string;
  ready: boolean;
  detail: string;
};

export type ProgramReadinessSummary = {
  status: "ready" | "incomplete";
  label: string;
  reason: string;
  tone: "success" | "warning" | "neutral";
  ready: boolean;
  readyCheckCount: number;
  totalCheckCount: number;
  missingCheckCount: number;
  missingCheckLabels: string[];
  nextSteps: string[];
  checks: ProgramReadinessCheck[];
};

export type ProgramWorkflowSummary = {
  label: string;
  reason: string;
  tone: "success" | "warning" | "neutral" | "info";
  packageLabel: string;
  packageDetail: string;
  packageTone: "success" | "warning" | "neutral" | "info";
  actionItems: string[];
  reviewNotes: string[];
};

export function titleizeProgramValue(value: string | null | undefined): string {
  if (!value) return "Unknown";

  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatProgramTypeLabel(value: string | null | undefined): string {
  return PROGRAM_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? titleizeProgramValue(value);
}

export function formatProgramStatusLabel(value: string | null | undefined): string {
  return PROGRAM_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? titleizeProgramValue(value);
}

export function formatProgramLinkTypeLabel(value: string | null | undefined): string {
  return PROGRAM_LINK_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? titleizeProgramValue(value);
}

export function formatProgramFundingClassificationLabel(value: string | null | undefined): string {
  return (
    PROGRAM_FUNDING_CLASSIFICATION_OPTIONS.find((option) => option.value === value)?.label ?? titleizeProgramValue(value)
  );
}

export function formatFundingOpportunityStatusLabel(value: string | null | undefined): string {
  return FUNDING_OPPORTUNITY_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? titleizeProgramValue(value);
}

export function formatFundingOpportunityDecisionLabel(value: string | null | undefined): string {
  return FUNDING_OPPORTUNITY_DECISION_OPTIONS.find((option) => option.value === value)?.label ?? titleizeProgramValue(value);
}

export function formatFundingAwardMatchPostureLabel(value: string | null | undefined): string {
  return FUNDING_AWARD_MATCH_POSTURE_OPTIONS.find((option) => option.value === value)?.label ?? titleizeProgramValue(value);
}

export function formatFundingAwardSpendingStatusLabel(value: string | null | undefined): string {
  return FUNDING_AWARD_SPENDING_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? titleizeProgramValue(value);
}

export function formatFundingAwardRiskFlagLabel(value: string | null | undefined): string {
  return FUNDING_AWARD_RISK_FLAG_OPTIONS.find((option) => option.value === value)?.label ?? titleizeProgramValue(value);
}

export function programStatusTone(
  status: string | null | undefined
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "programmed" || status === "adopted") return "success";
  if (status === "submitted") return "info";
  if (status === "assembling") return "warning";
  if (status === "archived" || status === "draft") return "neutral";
  return "neutral";
}

export function fundingOpportunityStatusTone(
  status: string | null | undefined
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "open") return "success";
  if (status === "upcoming") return "info";
  if (status === "awarded") return "success";
  if (status === "closed" || status === "archived") return "neutral";
  return "neutral";
}

export function fundingOpportunityDecisionTone(
  decision: string | null | undefined
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (decision === "pursue") return "success";
  if (decision === "monitor") return "info";
  if (decision === "skip") return "warning";
  return "neutral";
}

export function fundingAwardMatchPostureTone(
  posture: string | null | undefined
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (posture === "secured" || posture === "not_required") return "success";
  if (posture === "partial") return "warning";
  if (posture === "unfunded") return "danger";
  return "neutral";
}

export function fundingAwardSpendingStatusTone(
  status: string | null | undefined
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "info";
  if (status === "fully_spent") return "success";
  if (status === "delayed") return "warning";
  if (status === "not_started") return "neutral";
  return "neutral";
}

export function fundingAwardRiskFlagTone(
  riskFlag: string | null | undefined
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (riskFlag === "critical") return "danger";
  if (riskFlag === "watch") return "warning";
  if (riskFlag === "none") return "success";
  return "neutral";
}

export function formatProgramDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function formatFiscalWindow(
  fiscalYearStart: number | null | undefined,
  fiscalYearEnd: number | null | undefined
): string {
  if (typeof fiscalYearStart === "number" && typeof fiscalYearEnd === "number") {
    return `FY ${fiscalYearStart}-${String(fiscalYearEnd).slice(-2)}`;
  }

  if (typeof fiscalYearStart === "number") {
    return `FY ${fiscalYearStart}+`;
  }

  return "No fiscal window";
}

export function buildProgramReadiness({
  cycleName,
  hasProject,
  planCount,
  reportCount,
  engagementCampaignCount,
  sponsorAgency,
  fiscalYearStart,
  fiscalYearEnd,
  nominationDueAt,
  adoptionTargetAt,
}: {
  cycleName: string | null | undefined;
  hasProject: boolean;
  planCount: number;
  reportCount: number;
  engagementCampaignCount: number;
  sponsorAgency: string | null | undefined;
  fiscalYearStart: number | null | undefined;
  fiscalYearEnd: number | null | undefined;
  nominationDueAt: string | null | undefined;
  adoptionTargetAt: string | null | undefined;
}): ProgramReadinessSummary {
  const hasFiscalWindow = typeof fiscalYearStart === "number" && typeof fiscalYearEnd === "number";
  const hasSchedule = Boolean(nominationDueAt || adoptionTargetAt);

  const checks: ProgramReadinessCheck[] = [
    {
      key: "cycle_name",
      label: "Cycle label",
      ready: Boolean(cycleName?.trim()),
      detail: cycleName?.trim() ? cycleName.trim() : "Name the programming cycle or package lane.",
    },
    {
      key: "project",
      label: "Linked project",
      ready: hasProject,
      detail: hasProject ? "A primary or related project record is attached." : "Attach the candidate project package.",
    },
    {
      key: "plan",
      label: "Plan basis",
      ready: planCount > 0,
      detail:
        planCount > 0
          ? `${planCount} linked plan record${planCount === 1 ? "" : "s"} support the package basis.`
          : "Link at least one adopted or in-flight plan record.",
    },
    {
      key: "report",
      label: "Package output",
      ready: reportCount > 0,
      detail:
        reportCount > 0
          ? `${reportCount} linked report${reportCount === 1 ? "" : "s"} can support the submittal packet.`
          : "Link a report or packet record for the program narrative.",
    },
    {
      key: "engagement_campaign",
      label: "Engagement evidence",
      ready: engagementCampaignCount > 0,
      detail:
        engagementCampaignCount > 0
          ? `${engagementCampaignCount} engagement campaign${engagementCampaignCount === 1 ? "" : "s"} document public input.`
          : "Link engagement evidence that supports the programming recommendation.",
    },
    {
      key: "sponsor_agency",
      label: "Sponsor agency",
      ready: Boolean(sponsorAgency?.trim()),
      detail: sponsorAgency?.trim() ? sponsorAgency.trim() : "Capture the sponsoring agency or MPO lead.",
    },
    {
      key: "fiscal_window",
      label: "Fiscal window",
      ready: hasFiscalWindow,
      detail: hasFiscalWindow
        ? formatFiscalWindow(fiscalYearStart, fiscalYearEnd)
        : "Add the fiscal years covered by this package.",
    },
    {
      key: "schedule",
      label: "Cycle schedule",
      ready: hasSchedule,
      detail: hasSchedule
        ? `Nomination ${nominationDueAt ? "tracked" : "pending"}, adoption ${adoptionTargetAt ? "tracked" : "pending"}.`
        : "Add a nomination due date or adoption target date.",
    },
  ];

  const readyCheckCount = checks.filter((check) => check.ready).length;
  const totalCheckCount = checks.length;
  const missingChecks = checks.filter((check) => !check.ready);
  const missingCheckLabels = missingChecks.map((check) => check.label);
  const ready = missingChecks.length === 0;

  if (ready) {
    return {
      status: "ready",
      label: "Package basis ready",
      reason: "Core cycle metadata and linked package evidence are on record.",
      tone: "success",
      ready,
      readyCheckCount,
      totalCheckCount,
      missingCheckCount: 0,
      missingCheckLabels,
      nextSteps: [],
      checks,
    };
  }

  return {
    status: "incomplete",
    label: readyCheckCount >= 5 ? "Package in progress" : "Needs setup",
    reason: missingChecks[0]?.detail ?? "Add funding-cycle metadata and supporting records.",
    tone: readyCheckCount === 0 ? "neutral" : "warning",
    ready,
    readyCheckCount,
    totalCheckCount,
    missingCheckCount: missingChecks.length,
    missingCheckLabels,
    nextSteps: missingChecks.map((check) => check.detail),
    checks,
  };
}

export function buildProgramWorkflowSummary({
  programStatus,
  readiness,
  planCount,
  reportCount,
  generatedReportCount,
  engagementCampaignCount,
  approvedEngagementItemCount,
  pendingEngagementItemCount,
}: {
  programStatus: string | null | undefined;
  readiness: ProgramReadinessSummary;
  planCount: number;
  reportCount: number;
  generatedReportCount: number;
  engagementCampaignCount: number;
  approvedEngagementItemCount: number;
  pendingEngagementItemCount: number;
}): ProgramWorkflowSummary {
  const actionItems = [...readiness.nextSteps];
  const reviewNotes: string[] = [];

  if (generatedReportCount > 0) {
    reviewNotes.push(`${generatedReportCount} generated report artifact${generatedReportCount === 1 ? "" : "s"} available.`);
  } else if (reportCount > 0) {
    reviewNotes.push("Report records exist, but no generated packet artifacts are visible yet.");
  } else {
    reviewNotes.push("No packet output is linked yet.");
  }

  if (engagementCampaignCount > 0) {
    reviewNotes.push(
      `${approvedEngagementItemCount} approved engagement item${approvedEngagementItemCount === 1 ? "" : "s"} and ${pendingEngagementItemCount} pending.`
    );
  } else {
    reviewNotes.push("No engagement evidence is linked yet.");
  }

  if (programStatus === "programmed" || programStatus === "adopted") {
    return {
      label: "Programmed cycle on record",
      reason: "This package is already marked as programmed or adopted.",
      tone: "success",
      packageLabel: "Cycle action recorded",
      packageDetail: "Use this record to preserve traceability back to plans, reports, and engagement evidence.",
      packageTone: "success",
      actionItems,
      reviewNotes,
    };
  }

  if (programStatus === "submitted") {
    return {
      label: "Awaiting programming action",
      reason: "The package has been submitted and should now be tracked against adoption timing and revisions.",
      tone: "info",
      packageLabel: "Submission logged",
      packageDetail: "Keep packet outputs and public record evidence current while the cycle moves through review.",
      packageTone: "info",
      actionItems,
      reviewNotes,
    };
  }

  if (readiness.ready) {
    return {
      label: "Ready for package assembly",
      reason: "The cycle has the minimum metadata and supporting records needed for operator review.",
      tone: "success",
      packageLabel: "Package basis assembled",
      packageDetail: `${planCount} linked plan basis item${planCount === 1 ? "" : "s"} and ${reportCount} packet record${reportCount === 1 ? "" : "s"} are on file.`,
      packageTone: "success",
      actionItems,
      reviewNotes,
    };
  }

  return {
    label: programStatus === "assembling" ? "Assembling package" : "Needs package setup",
    reason: readiness.reason,
    tone: readiness.readyCheckCount >= 4 ? "warning" : "neutral",
    packageLabel: "Transparent gaps remain",
    packageDetail: "This module shows what is missing instead of implying a complete programming packet.",
    packageTone: readiness.readyCheckCount >= 4 ? "warning" : "neutral",
    actionItems,
    reviewNotes,
  };
}
