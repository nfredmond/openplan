export const PLAN_TYPE_OPTIONS = [
  { value: "corridor", label: "Corridor Plan" },
  { value: "atp", label: "Active Transportation Plan" },
  { value: "safety", label: "Safety Plan" },
  { value: "regional", label: "Regional Plan" },
  { value: "complete_streets", label: "Complete Streets Plan" },
  { value: "other", label: "Other Plan" },
] as const;

export const PLAN_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "adopted", label: "Adopted" },
  { value: "archived", label: "Archived" },
] as const;

export const PLAN_LINK_TYPE_OPTIONS = [
  { value: "scenario_set", label: "Scenario Set" },
  { value: "engagement_campaign", label: "Engagement Campaign" },
  { value: "report", label: "Report" },
  { value: "project_record", label: "Project Record" },
] as const;

export type PlanType = (typeof PLAN_TYPE_OPTIONS)[number]["value"];
export type PlanStatus = (typeof PLAN_STATUS_OPTIONS)[number]["value"];
export type PlanLinkType = (typeof PLAN_LINK_TYPE_OPTIONS)[number]["value"];

export type PlanReadinessCheck = {
  key:
    | "project"
    | "scenario_set"
    | "engagement_campaign"
    | "report"
    | "geography_label"
    | "horizon_year";
  label: string;
  ready: boolean;
  detail: string;
};

export type PlanReadinessSummary = {
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
  checks: PlanReadinessCheck[];
};

export type PlanArtifactCoverageSummary = {
  label: string;
  detail: string;
  tone: "success" | "warning" | "neutral";
  hasScenarioEvidence: boolean;
  hasEngagementInput: boolean;
  hasReportOutput: boolean;
};

export type PlanWorkflowSummary = {
  label: string;
  reason: string;
  tone: "success" | "warning" | "neutral" | "info";
  planningOutputLabel: string;
  planningOutputDetail: string;
  planningOutputTone: "success" | "warning" | "neutral" | "info";
  actionItems: string[];
  reviewNotes: string[];
};

export function titleizePlanValue(value: string | null | undefined): string {
  if (!value) return "Unknown";

  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatPlanTypeLabel(value: string | null | undefined): string {
  return PLAN_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? titleizePlanValue(value);
}

export function formatPlanStatusLabel(value: string | null | undefined): string {
  return PLAN_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? titleizePlanValue(value);
}

export function formatPlanLinkTypeLabel(value: string | null | undefined): string {
  return PLAN_LINK_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? titleizePlanValue(value);
}

export function planStatusTone(status: string | null | undefined): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active" || status === "adopted") return "success";
  if (status === "archived") return "warning";
  if (status === "draft") return "neutral";
  return "neutral";
}

export function formatPlanDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function buildPlanReadiness({
  hasProject,
  scenarioCount,
  engagementCampaignCount,
  reportCount,
  geographyLabel,
  horizonYear,
}: {
  hasProject: boolean;
  scenarioCount: number;
  engagementCampaignCount: number;
  reportCount: number;
  geographyLabel: string | null | undefined;
  horizonYear: number | null | undefined;
}): PlanReadinessSummary {
  const checks: PlanReadinessCheck[] = [
    {
      key: "project",
      label: "Linked project",
      ready: hasProject,
      detail: hasProject ? "A project record is attached." : "Attach a primary or related project record.",
    },
    {
      key: "scenario_set",
      label: "Scenario evidence",
      ready: scenarioCount > 0,
      detail:
        scenarioCount > 0
          ? `${scenarioCount} scenario set${scenarioCount === 1 ? "" : "s"} linked or inherited from the project.`
          : "No linked scenario sets yet.",
    },
    {
      key: "engagement_campaign",
      label: "Engagement input",
      ready: engagementCampaignCount > 0,
      detail:
        engagementCampaignCount > 0
          ? `${engagementCampaignCount} engagement campaign${engagementCampaignCount === 1 ? "" : "s"} linked or inherited from the project.`
          : "No linked engagement campaigns yet.",
    },
    {
      key: "report",
      label: "Report output",
      ready: reportCount > 0,
      detail:
        reportCount > 0
          ? `${reportCount} report${reportCount === 1 ? "" : "s"} linked or inherited from the project.`
          : "No linked report records yet.",
    },
    {
      key: "geography_label",
      label: "Geography label",
      ready: Boolean(geographyLabel?.trim()),
      detail: geographyLabel?.trim() ? geographyLabel.trim() : "Add the geography this plan covers.",
    },
    {
      key: "horizon_year",
      label: "Horizon year",
      ready: typeof horizonYear === "number",
      detail: typeof horizonYear === "number" ? String(horizonYear) : "Add a target horizon year.",
    },
  ];

  const readyCheckCount = checks.filter((check) => check.ready).length;
  const totalCheckCount = checks.length;
  const missingCheckCount = totalCheckCount - readyCheckCount;
  const ready = missingCheckCount === 0;
  const missingChecks = checks.filter((check) => !check.ready);
  const missingCheckLabels = missingChecks.map((check) => check.label);
  const nextSteps = missingChecks.map((check) => check.detail);

  if (ready) {
    return {
      status: "ready",
      label: "Foundation ready",
      reason: "Core metadata and linked planning artifacts are present.",
      tone: "success",
      ready,
      readyCheckCount,
      totalCheckCount,
      missingCheckCount,
      missingCheckLabels,
      nextSteps,
      checks,
    };
  }

  const firstMissing = checks.find((check) => !check.ready);

  return {
    status: "incomplete",
    label: readyCheckCount >= 3 ? "In progress" : "Needs setup",
    reason: firstMissing?.detail ?? "Add metadata and linked artifacts before treating this as planning-ready.",
    tone: readyCheckCount === 0 ? "neutral" : "warning",
    ready,
    readyCheckCount,
    totalCheckCount,
    missingCheckCount,
    missingCheckLabels,
    nextSteps,
    checks,
  };
}

export function buildPlanArtifactCoverage({
  scenarioCount,
  engagementCampaignCount,
  reportCount,
}: {
  scenarioCount: number;
  engagementCampaignCount: number;
  reportCount: number;
}): PlanArtifactCoverageSummary {
  const hasScenarioEvidence = scenarioCount > 0;
  const hasEngagementInput = engagementCampaignCount > 0;
  const hasReportOutput = reportCount > 0;

  if (hasScenarioEvidence && hasEngagementInput && hasReportOutput) {
    return {
      label: "Inputs and outputs linked",
      detail: "Scenario evidence, engagement intake, and report output are all visible on this plan record.",
      tone: "success",
      hasScenarioEvidence,
      hasEngagementInput,
      hasReportOutput,
    };
  }

  if ((hasScenarioEvidence || hasEngagementInput) && !hasReportOutput) {
    return {
      label: "Inputs linked, output pending",
      detail: "The planning basis is connected, but no linked report output is visible yet.",
      tone: "warning",
      hasScenarioEvidence,
      hasEngagementInput,
      hasReportOutput,
    };
  }

  if (!hasScenarioEvidence && !hasEngagementInput && hasReportOutput) {
    return {
      label: "Output linked, inputs thin",
      detail: "A report exists, but supporting scenarios and engagement input are still missing from the plan basis.",
      tone: "warning",
      hasScenarioEvidence,
      hasEngagementInput,
      hasReportOutput,
    };
  }

  if (hasScenarioEvidence || hasEngagementInput || hasReportOutput) {
    return {
      label: "Partial artifact coverage",
      detail: "Some linked planning artifacts are present, but the basis is still uneven.",
      tone: "warning",
      hasScenarioEvidence,
      hasEngagementInput,
      hasReportOutput,
    };
  }

  return {
    label: "No linked artifacts yet",
    detail: "Attach scenarios, engagement campaigns, or reports before treating this plan as operationally reviewable.",
    tone: "neutral",
    hasScenarioEvidence,
    hasEngagementInput,
    hasReportOutput,
  };
}

export function buildPlanWorkflowSummary({
  planStatus,
  readiness,
  linkedProjectCount,
  explicitLinkCount,
  relatedProjectCount,
  scenarioCount,
  readyScenarioCount,
  engagementCampaignCount,
  pendingEngagementItemCount,
  flaggedEngagementItemCount,
  reportCount,
  generatedReportCount,
  reportArtifactCount,
}: {
  planStatus: string | null | undefined;
  readiness: PlanReadinessSummary;
  linkedProjectCount: number;
  explicitLinkCount: number;
  relatedProjectCount: number;
  scenarioCount: number;
  readyScenarioCount: number;
  engagementCampaignCount: number;
  pendingEngagementItemCount: number;
  flaggedEngagementItemCount: number;
  reportCount: number;
  generatedReportCount: number;
  reportArtifactCount: number;
}): PlanWorkflowSummary {
  const hasGeneratedOutput = generatedReportCount > 0 || reportArtifactCount > 0;

  const planningOutput = hasGeneratedOutput
    ? {
        label: "Planning outputs on record",
        detail: `${generatedReportCount} generated report${generatedReportCount === 1 ? "" : "s"} and ${reportArtifactCount} stored artifact${reportArtifactCount === 1 ? "" : "s"} are traceable from this plan.`,
        tone: "success" as const,
      }
    : reportCount > 0
      ? {
          label: "Report records linked",
          detail: "Reports are linked, but no generated packet or stored artifact is visible yet.",
          tone: "warning" as const,
        }
      : {
          label: "No planning outputs linked",
          detail: "This plan record is still missing a visible planning output trail.",
          tone: "neutral" as const,
        };

  const actionItems = [
    ...readiness.nextSteps,
    !reportCount ? "Link a report record when packet drafting starts." : null,
    reportCount > 0 && !hasGeneratedOutput ? "Generate or attach a report artifact so the planning output trail is explicit." : null,
    scenarioCount > 0 && readyScenarioCount === 0 ? "Mark at least one scenario alternative ready before relying on scenario evidence." : null,
    flaggedEngagementItemCount > 0
      ? `Resolve ${flaggedEngagementItemCount} flagged engagement item${flaggedEngagementItemCount === 1 ? "" : "s"} before formal review.`
      : null,
  ].filter((item): item is string => Boolean(item));

  const reviewNotes = [
    linkedProjectCount > 0 && explicitLinkCount > 0
      ? "This plan mixes primary-project inheritance with explicit plan links; review both sources during operator check."
      : null,
    relatedProjectCount > 1
      ? `${relatedProjectCount} project records are attached, so confirm the primary project still represents the main planning anchor.`
      : null,
    engagementCampaignCount > 0 && pendingEngagementItemCount > 0
      ? `${pendingEngagementItemCount} engagement item${pendingEngagementItemCount === 1 ? "" : "s"} are still pending review.`
      : null,
    scenarioCount > 0 && readyScenarioCount > 0
      ? `${readyScenarioCount} scenario set${readyScenarioCount === 1 ? "" : "s"} show at least one ready alternative for review.`
      : null,
  ].filter((item): item is string => Boolean(item));

  if (planStatus === "adopted") {
    return {
      label: "Formal record retained",
      reason: hasGeneratedOutput
        ? "Treat this plan as an adopted record with linked supporting outputs."
        : "This plan is marked adopted, but the supporting output trail still looks thin.",
      tone: hasGeneratedOutput ? "success" : "warning",
      planningOutputLabel: planningOutput.label,
      planningOutputDetail: planningOutput.detail,
      planningOutputTone: planningOutput.tone,
      actionItems: actionItems.slice(0, 4),
      reviewNotes,
    };
  }

  if (readiness.ready && hasGeneratedOutput) {
    return {
      label: "Ready for operator review",
      reason: "Core record fields are present and linked planning outputs are traceable.",
      tone: "success",
      planningOutputLabel: planningOutput.label,
      planningOutputDetail: planningOutput.detail,
      planningOutputTone: planningOutput.tone,
      actionItems: actionItems.slice(0, 4),
      reviewNotes,
    };
  }

  if (readiness.ready && reportCount > 0) {
    return {
      label: "Ready for output check",
      reason: "The planning basis is in place; the next operator step is validating report generation and packet history.",
      tone: "info",
      planningOutputLabel: planningOutput.label,
      planningOutputDetail: planningOutput.detail,
      planningOutputTone: planningOutput.tone,
      actionItems: actionItems.slice(0, 4),
      reviewNotes,
    };
  }

  if (readiness.ready) {
    return {
      label: "Ready for packet assembly",
      reason: "The planning basis is visible, but output generation is still the next workflow step.",
      tone: "info",
      planningOutputLabel: planningOutput.label,
      planningOutputDetail: planningOutput.detail,
      planningOutputTone: planningOutput.tone,
      actionItems: actionItems.slice(0, 4),
      reviewNotes,
    };
  }

  if (reportCount > 0) {
    return {
      label: "Backfill record basis",
      reason: "Outputs are linked, but the formal plan record still has checklist gaps to close.",
      tone: "warning",
      planningOutputLabel: planningOutput.label,
      planningOutputDetail: planningOutput.detail,
      planningOutputTone: planningOutput.tone,
      actionItems: actionItems.slice(0, 4),
      reviewNotes,
    };
  }

  return {
    label: "Assemble planning basis",
    reason: "This plan still needs explicit metadata and linked records before it is ready for review.",
    tone: readiness.readyCheckCount === 0 ? "neutral" : "warning",
    planningOutputLabel: planningOutput.label,
    planningOutputDetail: planningOutput.detail,
    planningOutputTone: planningOutput.tone,
    actionItems: actionItems.slice(0, 4),
    reviewNotes,
  };
}
