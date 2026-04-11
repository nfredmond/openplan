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
  | "comparison-backed"
  | "governance-hold"
  | "no-evidence";

export type ReportEvidenceChainDigest = {
  headline: string;
  detail: string;
  blockedGateDetail: string | null;
};

export type ReportScenarioSpineSummary = {
  assumptionSetCount: number;
  dataPackageCount: number;
  indicatorSnapshotCount: number;
  pendingCount: number;
  latestAssumptionSetUpdatedAt: string | null;
  latestDataPackageUpdatedAt: string | null;
  latestIndicatorSnapshotAt: string | null;
};

export type ReportComparisonSnapshotAggregate = {
  comparisonSnapshotCount: number;
  readyComparisonSnapshotCount: number;
  indicatorDeltaCount: number;
  latestComparisonSnapshotUpdatedAt: string | null;
};

export type ReportComparisonSnapshotDigest = {
  headline: string;
  detail: string;
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
    case "comparison-backed":
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
    hasComparisonBacked: boolean;
    hasBlockedGovernance: boolean;
  }
) {
  switch (filter) {
    case "evidence-backed":
      return input.hasEvidenceChain;
    case "comparison-backed":
      return input.hasComparisonBacked;
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

export type ReportSectionPresetComparable = {
  sectionKey: string;
  enabled: boolean;
  sortOrder: number;
};

export type ReportTargetKind = "project" | "rtp_cycle";
export type RtpPacketPresetStage = "draft" | "public_review" | "adopted" | "archived" | "default";

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

const RTP_SECTION_TEMPLATES: Partial<Record<ReportType, ReportSectionTemplate[]>> = {
  board_packet: [
    { sectionKey: "cycle_overview", title: "Cycle overview", enabled: true, sortOrder: 0 },
    { sectionKey: "chapter_digest", title: "Chapter digest", enabled: true, sortOrder: 1 },
    { sectionKey: "portfolio_posture", title: "Portfolio posture", enabled: true, sortOrder: 2 },
    { sectionKey: "engagement_posture", title: "Engagement posture", enabled: true, sortOrder: 3 },
    { sectionKey: "adoption_readiness", title: "Adoption readiness", enabled: true, sortOrder: 4 },
    { sectionKey: "appendix_references", title: "Appendix and references", enabled: true, sortOrder: 5 },
  ],
};

export function resolveRtpPacketPresetStage(status: string | null | undefined): RtpPacketPresetStage {
  switch (status) {
    case "draft":
    case "public_review":
    case "adopted":
    case "archived":
      return status;
    default:
      return "default";
  }
}

function buildRtpPacketPresetTemplates(stage: RtpPacketPresetStage): ReportSectionTemplate[] {
  const baseTemplates = RTP_SECTION_TEMPLATES.board_packet ?? [];
  const enabledKeysByStage: Record<RtpPacketPresetStage, string[]> = {
    draft: ["cycle_overview", "chapter_digest", "portfolio_posture", "adoption_readiness"],
    public_review: [
      "cycle_overview",
      "chapter_digest",
      "portfolio_posture",
      "engagement_posture",
      "adoption_readiness",
      "appendix_references",
    ],
    adopted: ["cycle_overview", "chapter_digest", "portfolio_posture", "engagement_posture", "appendix_references"],
    archived: ["cycle_overview", "portfolio_posture", "appendix_references"],
    default: [
      "cycle_overview",
      "chapter_digest",
      "portfolio_posture",
      "engagement_posture",
      "adoption_readiness",
      "appendix_references",
    ],
  };

  return baseTemplates.map((section) => ({
    ...section,
    enabled: enabledKeysByStage[stage].includes(section.sectionKey),
    configJson: {
      ...(section.configJson ?? {}),
      rtpPacketPresetStage: stage,
    },
  }));
}

export function getRtpPacketPresetAlignment(input: {
  cycleStatus: string | null | undefined;
  sections: ReportSectionPresetComparable[];
}) {
  const stage = resolveRtpPacketPresetStage(input.cycleStatus);
  const preset = buildRtpPacketPresetTemplates(stage);
  const comparablePreset = preset.map((section) => ({
    sectionKey: section.sectionKey,
    enabled: section.enabled,
    sortOrder: section.sortOrder,
  }));
  const comparableCurrent = [...input.sections]
    .map((section) => ({
      sectionKey: section.sectionKey,
      enabled: section.enabled,
      sortOrder: section.sortOrder,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder);

  const aligned =
    comparableCurrent.length === comparablePreset.length &&
    comparableCurrent.every((section, index) => {
      const presetSection = comparablePreset[index];
      return (
        presetSection?.sectionKey === section.sectionKey &&
        presetSection.enabled === section.enabled &&
        presetSection.sortOrder === section.sortOrder
      );
    });

  return {
    presetStage: stage,
    presetLabel: describeRtpPacketPresetStage(stage),
    aligned,
    statusLabel: aligned ? "Preset-aligned" : "Customized",
    tone: aligned ? ("success" as const) : ("info" as const),
    detail: aligned
      ? `Current packet structure still matches the ${describeRtpPacketPresetStage(stage).toLowerCase()}.`
      : `Current packet structure has diverged from the ${describeRtpPacketPresetStage(stage).toLowerCase()}.`,
  };
}

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

export function describeRtpPacketPresetStage(stage: RtpPacketPresetStage): string {
  switch (stage) {
    case "draft":
      return "Draft packet preset";
    case "public_review":
      return "Public review packet preset";
    case "adopted":
      return "Adoption packet preset";
    case "archived":
      return "Archive packet preset";
    default:
      return "Standard RTP packet preset";
  }
}

export function createDefaultTargetedReportSections(
  reportType: ReportType,
  targetKind: ReportTargetKind,
  options?: { rtpCycleStatus?: string | null | undefined }
): ReportSectionTemplate[] {
  const targetTemplates =
    targetKind === "rtp_cycle" && reportType === "board_packet"
      ? buildRtpPacketPresetTemplates(resolveRtpPacketPresetStage(options?.rtpCycleStatus))
      : targetKind === "rtp_cycle"
        ? RTP_SECTION_TEMPLATES[reportType]
        : null;
  const templates = targetTemplates ?? SECTION_TEMPLATES[reportType];
  return templates.map((section) => ({
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

export function describeReportSectionKey(sectionKey: string | null | undefined): string {
  switch (sectionKey) {
    case "cycle_overview":
      return "Core RTP cycle scope, geography, horizon, and board posture.";
    case "chapter_digest":
      return "Draft narrative coverage and workflow status across RTP chapters.";
    case "portfolio_posture":
      return "Linked constrained, illustrative, and candidate projects for this RTP cycle.";
    case "engagement_posture":
      return "Cycle-level and chapter-level public review and consultation targets.";
    case "adoption_readiness":
      return "What remains before the packet is ready for public review, board action, or adoption.";
    case "appendix_references":
      return "Supporting references, exports, and linked packet materials.";
    case "cover_page":
      return "High-level packet cover context.";
    case "executive_summary":
      return "Condensed leadership-ready summary of the packet.";
    case "project_records_digest":
      return "Key project records and controls affecting this packet.";
    case "analysis_summaries":
      return "Analysis, modeling, or supporting evidence summaries attached to the packet.";
    default:
      return "Packet section configuration for this report record.";
  }
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asSourceContext(metadata: Record<string, unknown> | null | undefined) {
  return metadata ? asRecord(metadata.sourceContext) : null;
}

export function parseStoredEvidenceChainSummary(
  metadata: Record<string, unknown> | null | undefined
): EvidenceChainSummary | null {
  const sourceContext = asSourceContext(metadata);
  const summary = asRecord(sourceContext?.evidenceChainSummary);
  if (!summary) {
    return null;
  }

  return {
    linkedRunCount: asNullableNumber(summary.linkedRunCount) ?? 0,
    scenarioSetLinkCount: asNullableNumber(summary.scenarioSetLinkCount) ?? 0,
    scenarioAssumptionSetCount:
      asNullableNumber(summary.scenarioAssumptionSetCount) ?? 0,
    scenarioDataPackageCount:
      asNullableNumber(summary.scenarioDataPackageCount) ?? 0,
    scenarioIndicatorSnapshotCount:
      asNullableNumber(summary.scenarioIndicatorSnapshotCount) ?? 0,
    scenarioSharedSpinePendingCount:
      asNullableNumber(summary.scenarioSharedSpinePendingCount) ?? 0,
    projectRecordGroupCount: asNullableNumber(summary.projectRecordGroupCount) ?? 0,
    totalProjectRecordCount: asNullableNumber(summary.totalProjectRecordCount) ?? 0,
    engagementLabel: asNullableString(summary.engagementLabel) ?? "Unknown",
    engagementItemCount: asNullableNumber(summary.engagementItemCount) ?? 0,
    engagementReadyForHandoffCount:
      asNullableNumber(summary.engagementReadyForHandoffCount) ?? 0,
    stageGateLabel: asNullableString(summary.stageGateLabel) ?? "Unknown",
    stageGatePassCount: asNullableNumber(summary.stageGatePassCount) ?? 0,
    stageGateHoldCount: asNullableNumber(summary.stageGateHoldCount) ?? 0,
    stageGateBlockedGateLabel: asNullableString(summary.stageGateBlockedGateLabel),
  };
}

export function parseStoredScenarioSpineSummary(
  metadata: Record<string, unknown> | null | undefined
): ReportScenarioSpineSummary | null {
  const sourceContext = asSourceContext(metadata);
  const summary = asRecord(sourceContext?.scenarioSpineSummary);
  if (!summary) {
    return null;
  }

  return {
    assumptionSetCount: asNullableNumber(summary.assumptionSetCount) ?? 0,
    dataPackageCount: asNullableNumber(summary.dataPackageCount) ?? 0,
    indicatorSnapshotCount: asNullableNumber(summary.indicatorSnapshotCount) ?? 0,
    pendingCount: asNullableNumber(summary.pendingCount) ?? 0,
    latestAssumptionSetUpdatedAt: asNullableString(summary.latestAssumptionSetUpdatedAt),
    latestDataPackageUpdatedAt: asNullableString(summary.latestDataPackageUpdatedAt),
    latestIndicatorSnapshotAt: asNullableString(summary.latestIndicatorSnapshotAt),
  };
}

export function parseStoredComparisonSnapshotAggregate(
  metadata: Record<string, unknown> | null | undefined
): ReportComparisonSnapshotAggregate | null {
  const sourceContext = asSourceContext(metadata);
  const scenarioSetLinks = sourceContext?.scenarioSetLinks;
  if (!Array.isArray(scenarioSetLinks)) {
    return null;
  }

  let comparisonSnapshotCount = 0;
  let readyComparisonSnapshotCount = 0;
  let indicatorDeltaCount = 0;
  const updatedAtValues: string[] = [];

  for (const item of scenarioSetLinks) {
    const record = asRecord(item);
    const comparisonSnapshots = record?.comparisonSnapshots;
    if (!Array.isArray(comparisonSnapshots)) {
      continue;
    }

    for (const snapshot of comparisonSnapshots) {
      const snapshotRecord = asRecord(snapshot);
      if (!snapshotRecord) {
        continue;
      }

      comparisonSnapshotCount += 1;
      if (asNullableString(snapshotRecord.status) === "ready") {
        readyComparisonSnapshotCount += 1;
      }
      indicatorDeltaCount += asNullableNumber(snapshotRecord.indicatorDeltaCount) ?? 0;

      const updatedAt = asNullableString(snapshotRecord.updatedAt);
      if (updatedAt) {
        updatedAtValues.push(updatedAt);
      }
    }
  }

  if (comparisonSnapshotCount === 0) {
    return {
      comparisonSnapshotCount: 0,
      readyComparisonSnapshotCount: 0,
      indicatorDeltaCount: 0,
      latestComparisonSnapshotUpdatedAt: null,
    };
  }

  const latestComparisonSnapshotUpdatedAt = updatedAtValues.length
    ? updatedAtValues
        .map((value) => ({ value, time: new Date(value).getTime() }))
        .filter((item) => Number.isFinite(item.time))
        .sort((left, right) => right.time - left.time)[0]?.value ?? null
    : null;

  return {
    comparisonSnapshotCount,
    readyComparisonSnapshotCount,
    indicatorDeltaCount,
    latestComparisonSnapshotUpdatedAt,
  };
}

export function describeEvidenceChainSummary(
  summary: EvidenceChainSummary | null | undefined
): ReportEvidenceChainDigest | null {
  if (!summary) {
    return null;
  }

  const scenarioLabel = `${summary.scenarioSetLinkCount} scenario set${summary.scenarioSetLinkCount === 1 ? "" : "s"}`;
  const scenarioSpineLabel = summary.scenarioSharedSpinePendingCount > 0
    ? `${summary.scenarioSharedSpinePendingCount} spine pending`
    : `${summary.scenarioAssumptionSetCount} assumptions · ${summary.scenarioDataPackageCount} packages · ${summary.scenarioIndicatorSnapshotCount} indicators`;
  const projectRecordLabel = `${summary.totalProjectRecordCount} project record${summary.totalProjectRecordCount === 1 ? "" : "s"}`;
  const linkedRunLabel = `${summary.linkedRunCount} linked run${summary.linkedRunCount === 1 ? "" : "s"}`;

  return {
    headline: `${linkedRunLabel} · ${scenarioLabel} · ${projectRecordLabel}`,
    detail: `${scenarioSpineLabel} · ${summary.engagementLabel} engagement · ${summary.engagementReadyForHandoffCount}/${summary.engagementItemCount} handoff-ready · ${summary.stageGateLabel} governance`,
    blockedGateDetail: summary.stageGateBlockedGateLabel
      ? `Blocked gate: ${summary.stageGateBlockedGateLabel}`
      : null,
  };
}

export function describeComparisonSnapshotAggregate(
  summary: ReportComparisonSnapshotAggregate | null | undefined
): ReportComparisonSnapshotDigest | null {
  if (!summary || summary.comparisonSnapshotCount <= 0) {
    return null;
  }

  const comparisonLabel = `${summary.comparisonSnapshotCount} saved comparison${summary.comparisonSnapshotCount === 1 ? "" : "s"}`;
  const readyLabel = `${summary.readyComparisonSnapshotCount} ready`;
  const deltaLabel = `${summary.indicatorDeltaCount} indicator delta${summary.indicatorDeltaCount === 1 ? "" : "s"}`;
  const updatedLabel = summary.latestComparisonSnapshotUpdatedAt
    ? `Latest comparison updated ${formatDateTime(summary.latestComparisonSnapshotUpdatedAt)}`
    : "Latest comparison timing unavailable";

  return {
    headline: `${comparisonLabel} · ${readyLabel}`,
    detail: `${deltaLabel} · ${updatedLabel}`,
  };
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
