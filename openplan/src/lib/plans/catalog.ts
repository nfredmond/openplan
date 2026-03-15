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
  checks: PlanReadinessCheck[];
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
    checks,
  };
}
