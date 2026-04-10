import { type EvidenceChainSummary } from "@/lib/reports/evidence-chain";

export const REPORT_TYPE_OPTIONS = [
  { value: "project_status", label: "Project Status Packet" },
  { value: "analysis_summary", label: "Analysis Summary Packet" },
  { value: "board_packet", label: "Board / Binder Packet" },
] as const;

export const REPORT_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "generated", label: "Generated" },
  { value: "archived", label: "Archived" },
] as const;

export type ReportType = (typeof REPORT_TYPE_OPTIONS)[number]["value"];
export type ReportStatus = (typeof REPORT_STATUS_OPTIONS)[number]["value"];
export type ReportStatusTone =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

export type ReportPacketFreshness = {
  label: string;
  tone: ReportStatusTone;
  detail: string;
};

export type ReportFreshnessFilter = "all" | "refresh" | "missing" | "current";
export type ReportPostureFilter =
  | "all"
  | "evidence-backed"
  | "governance-hold"
  | "no-evidence";

export type ReportEvidenceChainDigest = {
  headline: string;
  detail: string;
  blockedGateDetail: string | null;
};

export function getReportPacketActionLabel(freshnessLabel: string) {
  switch (freshnessLabel) {
    case "Refresh recommended":
      return "Next action: open this report and regenerate the packet.";
    case "No packet":
      return "Next action: open this report and generate the first packet.";
    default:
      return "Next action: review the packet or create a new revision if scope changed.";
  }
}

export function getReportPacketPriority(freshnessLabel: string) {
  switch (freshnessLabel) {
    case "Refresh recommended":
      return 0;
    case "No packet":
      return 1;
    default:
      return 2;
  }
}

export function getReportNavigationHref(reportId: string, freshnessLabel: string) {
  switch (freshnessLabel) {
    case "Refresh recommended":
      return `/reports/${reportId}#drift-since-generation`;
    case "No packet":
      return `/reports/${reportId}#report-controls`;
    default:
      return `/reports/${reportId}#evidence-chain-summary`;
  }
}

export function normalizeReportFreshnessFilter(
  value: string | null | undefined
): ReportFreshnessFilter {
  switch (value) {
    case "refresh":
    case "missing":
    case "current":
      return value;
    default:
      return "all";
  }
}

export function matchesReportFreshnessFilter(
  filter: ReportFreshnessFilter,
  freshnessLabel: string
) {
  switch (filter) {
    case "refresh":
      return freshnessLabel === "Refresh recommended";
    case "missing":
      return freshnessLabel === "No packet";
    case "current":
      return freshnessLabel === "Packet current";
    default:
      return true;
  }
}

export function normalizeReportPostureFilter(
  value: string | null | undefined
): ReportPostureFilter {
  switch (value) {
    case "evidence-backed":
    case "governance-hold":
    case "no-evidence":
      return value;
    default:
      return "all";
  }
}

export function matchesReportPostureFilter(
  filter: ReportPostureFilter,
  input: {
    hasEvidenceChain: boolean;
    hasBlockedGovernance: boolean;
  }
) {
  switch (filter) {
    case "evidence-backed":
      return input.hasEvidenceChain;
    case "governance-hold":
      return input.hasBlockedGovernance;
    case "no-evidence":
      return !input.hasEvidenceChain;
    default:
      return true;
  }
}

export type ReportSectionTemplate = {
  sectionKey: string;
  title: string;
  enabled: boolean;
  sortOrder: number;
  configJson?: Record<string, unknown>;
};

const SECTION_TEMPLATES: Record<ReportType, ReportSectionTemplate[]> = {
  project_status: [
    {
      sectionKey: "project_overview",
      title: "Project overview",
      enabled: true,
      sortOrder: 0,
    },
    {
      sectionKey: "status_snapshot",
      title: "Current status",
      enabled: true,
      sortOrder: 1,
    },
    {
      sectionKey: "deliverables",
      title: "Deliverables",
      enabled: true,
      sortOrder: 2,
    },
    {
      sectionKey: "risks_issues",
      title: "Risks and issues",
      enabled: true,
      sortOrder: 3,
    },
    {
      sectionKey: "decisions_meetings",
      title: "Decisions and meetings",
      enabled: true,
      sortOrder: 4,
    },
    {
      sectionKey: "activity_timeline",
      title: "Recent activity timeline",
      enabled: true,
      sortOrder: 5,
    },
    {
      sectionKey: "assumptions_provenance",
      title: "Methods and provenance",
      enabled: true,
      sortOrder: 6,
    },
  ],
  analysis_summary: [
    {
      sectionKey: "project_overview",
      title: "Project overview",
      enabled: true,
      sortOrder: 0,
    },
    {
      sectionKey: "run_summaries",
      title: "Selected run summaries",
      enabled: true,
      sortOrder: 1,
    },
    { sectionKey: "key_metrics", title: "Key metrics", enabled: true, sortOrder: 2 },
    {
      sectionKey: "artifacts_context",
      title: "Attached map and artifact context",
      enabled: true,
      sortOrder: 3,
    },
    {
      sectionKey: "methods_assumptions",
      title: "Methods and assumptions",
      enabled: true,
      sortOrder: 4,
    },
  ],
  board_packet: [
    { sectionKey: "cover_page", title: "Cover page", enabled: true, sortOrder: 0 },
    {
      sectionKey: "executive_summary",
      title: "Executive summary",
      enabled: true,
      sortOrder: 1,
    },
    {
      sectionKey: "project_records_digest",
      title: "Project records digest",
      enabled: true,
      sortOrder: 2,
    },
    {
      sectionKey: "analysis_summaries",
      title: "Analysis summaries",
      enabled: true,
      sortOrder: 3,
    },
    {
      sectionKey: "appendix_references",
      title: "Appendix and references",
      enabled: true,
      sortOrder: 4,
    },
  ],
};

export function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatReportTypeLabel(reportType: string | null | undefined): string {
  return (
    REPORT_TYPE_OPTIONS.find((option) => option.value === reportType)?.label ??
    titleize(reportType)
  );
}

export function formatReportStatusLabel(status: string | null | undefined): string {
  return (
    REPORT_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
    titleize(status)
  );
}

export function createDefaultReportSections(reportType: ReportType): ReportSectionTemplate[] {
  return SECTION_TEMPLATES[reportType].map((section) => ({
    ...section,
    configJson: section.configJson ?? {},
  }));
}

export function defaultReportTitle(projectName: string, reportType: ReportType): string {
  const label = formatReportTypeLabel(reportType).replace(/\s+Packet$/i, "").trim();
  return `${projectName} ${label}`;
}

export function defaultTargetedReportTitle(targetTitle: string, reportType: ReportType): string {
  const label = formatReportTypeLabel(reportType).replace(/\s+Packet$/i, "").trim();
  return `${targetTitle} ${label}`;
}

export function reportStatusTone(
  status: string | null | undefined
): ReportStatusTone {
  if (status === "generated") return "success";
  if (status === "archived") return "warning";
  return "neutral";
}

export function getReportPacketFreshness({
  latestArtifactKind,
  generatedAt,
  updatedAt,
}: {
  latestArtifactKind: string | null | undefined;
  generatedAt: string | null | undefined;
  updatedAt: string | null | undefined;
}): ReportPacketFreshness {
  if (!latestArtifactKind || !generatedAt) {
    return {
      label: "No packet",
      tone: "warning",
      detail: "No generated packet is attached to this report yet.",
    };
  }

  const generatedAtMs = new Date(generatedAt).getTime();
  const updatedAtMs = new Date(updatedAt ?? generatedAt).getTime();

  if (Number.isFinite(generatedAtMs) && Number.isFinite(updatedAtMs) && updatedAtMs > generatedAtMs) {
    return {
      label: "Refresh recommended",
      tone: "warning",
      detail: "The report record changed after the latest packet was generated.",
    };
  }

  return {
    label: "Packet current",
    tone: "success",
    detail: "The latest packet is current with the saved report record.",
  };
}

export function describeEvidenceChainSummary(
  summary: EvidenceChainSummary | null | undefined
): ReportEvidenceChainDigest | null {
  if (!summary) {
    return null;
  }

  const scenarioLabel = `${summary.scenarioSetLinkCount} scenario set${summary.scenarioSetLinkCount === 1 ? "" : "s"}`;
  const projectRecordLabel = `${summary.totalProjectRecordCount} project record${summary.totalProjectRecordCount === 1 ? "" : "s"}`;
  const linkedRunLabel = `${summary.linkedRunCount} linked run${summary.linkedRunCount === 1 ? "" : "s"}`;

  return {
    headline: `${linkedRunLabel} · ${scenarioLabel} · ${projectRecordLabel}`,
    detail: `${summary.engagementLabel} engagement · ${summary.engagementReadyForHandoffCount}/${summary.engagementItemCount} handoff-ready · ${summary.stageGateLabel} governance`,
    blockedGateDetail: summary.stageGateBlockedGateLabel
      ? `Blocked gate: ${summary.stageGateBlockedGateLabel}`
      : null,
  };
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
