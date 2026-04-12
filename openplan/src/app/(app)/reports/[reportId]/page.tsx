import { notFound, redirect } from "next/navigation";
import {
  Clock3,
  FileOutput,
  Hash,
  Link2,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { ReportDetailControls } from "@/components/reports/report-detail-controls";
import { RtpReportDetail } from "@/components/reports/rtp-report-detail";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { buildProjectFundingSnapshot } from "@/lib/projects/funding";
import { buildPortfolioFundingSnapshot, type PortfolioFundingSnapshot } from "@/lib/projects/funding";
import { buildRtpCycleReadiness, buildRtpCycleWorkflowSummary } from "@/lib/rtp/catalog";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import { createClient } from "@/lib/supabase/server";
import {
  describeComparisonSnapshotAggregate,
  describeFundingSnapshot,
  getRtpPacketPresetAlignment,
  describeEvidenceChainSummary,
  formatDateTime,
  formatReportStatusLabel,
  parseStoredComparisonSnapshotAggregate,
  formatReportTypeLabel,
  parseStoredEvidenceChainSummary,
  parseStoredFundingSnapshot,
  parseStoredScenarioSpineSummary,
  reportStatusTone,
  titleize,
} from "@/lib/reports/catalog";
import { buildEvidenceChainSummary } from "@/lib/reports/evidence-chain";
import { extractEngagementCampaignId } from "@/lib/reports/engagement";
import { type ReportScenarioSetLink } from "@/lib/reports/scenario-provenance";
import { looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";
import {
  buildProjectStageGateSummary,
  type ProjectStageGateSummary,
  type ProjectStageGateSnapshot,
  type StageGateSnapshotGateSummary,
  type StageGateWorkflowState,
} from "@/lib/stage-gates/summary";

type RouteParams = {
  params: Promise<{ reportId: string }>;
};

type ReportArtifact = {
  id: string;
  artifact_kind: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

type LinkedRunRow = {
  id: string;
  title: string;
  summary_text: string | null;
  created_at: string;
};

type EngagementCampaignLinkRow = {
  id: string;
  title: string;
  summary: string | null;
  public_description: string | null;
  status: string;
  engagement_type: string;
  share_token: string | null;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
  updated_at: string;
};

type ProjectRecordSnapshotEntry = {
  count: number;
  latestTitle: string | null;
  latestAt: string | null;
};

type StageGateSnapshotControlHealth = ProjectStageGateSnapshot["controlHealth"];

type CurrentProjectRecordEntry = ProjectRecordSnapshotEntry;

type DriftStatus = "unchanged" | "updated" | "count changed" | "gate changed";

type DriftItem = {
  key: string;
  label: string;
  status: DriftStatus;
  detail: string;
};

type ScenarioSpineRow = {
  scenario_set_id?: string | null;
  updated_at?: string | null;
  snapshot_at?: string | null;
};

type ProjectRecordSnapshotKey =
  | "deliverables"
  | "risks"
  | "issues"
  | "decisions"
  | "meetings";

type EngagementCampaignSnapshot = {
  id: string;
  title: string;
  status: string | null;
  updatedAt: string | null;
};

type EngagementCategoryRow = {
  id: string;
  label: string | null;
  slug: string | null;
  description: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type EngagementItemRow = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  status: string | null;
  source_type: string | null;
  latitude: number | null;
  longitude: number | null;
  moderation_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StageGateDecisionRow = {
  gate_id: string;
  decision: string;
  rationale: string | null;
  decided_at: string | null;
  missing_artifacts?: string[] | null;
};

function asHtmlContent(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  return typeof metadata.htmlContent === "string"
    ? metadata.htmlContent
    : null;
}

function asRunAudit(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || !Array.isArray(metadata.runAudit)) {
    return [];
  }

  return metadata.runAudit.filter(
    (
      item
    ): item is {
      runId: string;
      gate: { decision: string; missingArtifacts: string[] };
    } => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const record = item as Record<string, unknown>;
      const gate = record.gate;

      return (
        typeof record.runId === "string" &&
        Boolean(gate) &&
        typeof gate === "object"
      );
    }
  );
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
  if (!metadata) return null;
  return asRecord(metadata.sourceContext);
}

function asScenarioSetLinks(value: unknown): ReportScenarioSetLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ReportScenarioSetLink =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).scenarioSetId === "string" &&
      typeof (item as Record<string, unknown>).scenarioSetTitle === "string" &&
      Array.isArray((item as Record<string, unknown>).matchedEntries)
  );
}

function asProjectRecordSnapshotEntry(
  value: unknown
): ProjectRecordSnapshotEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    count: asNullableNumber(record.count) ?? 0,
    latestTitle: asNullableString(record.latestTitle),
    latestAt: asNullableString(record.latestAt),
  };
}

function asStageGateSnapshotGateSummary(
  value: unknown
): StageGateSnapshotGateSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const workflowState = asNullableString(record.workflowState) as StageGateWorkflowState | null;
  const missingArtifacts = Array.isArray(record.missingArtifacts)
    ? record.missingArtifacts.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
    : [];

  if (
    !workflowState ||
    !["pass", "hold", "not_started"].includes(workflowState)
  ) {
    return null;
  }

  return {
    gateId: asNullableString(record.gateId) ?? "Unknown gate",
    sequence: asNullableNumber(record.sequence) ?? 0,
    name: asNullableString(record.name) ?? "Unknown gate",
    workflowState,
    rationale: asNullableString(record.rationale) ?? "No rationale provided.",
    missingArtifacts,
    requiredEvidenceCount: asNullableNumber(record.requiredEvidenceCount) ?? 0,
    operatorControlEvidenceCount:
      asNullableNumber(record.operatorControlEvidenceCount) ?? 0,
  };
}

function asStageGateSnapshotControlHealth(
  value: unknown
): StageGateSnapshotControlHealth {
  const record = asRecord(value);

  return {
    totalOperatorControlEvidenceCount:
      asNullableNumber(record?.totalOperatorControlEvidenceCount) ?? 0,
    gatesWithOperatorControlsCount:
      asNullableNumber(record?.gatesWithOperatorControlsCount) ?? 0,
  };
}

function asStageGateSnapshot(
  value: unknown
): ProjectStageGateSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const templateId = asNullableString(record.templateId);
  const templateVersion = asNullableString(record.templateVersion);

  if (!templateId || !templateVersion) {
    return null;
  }

  return {
    templateId,
    templateVersion,
    passCount: asNullableNumber(record.passCount) ?? 0,
    holdCount: asNullableNumber(record.holdCount) ?? 0,
    notStartedCount: asNullableNumber(record.notStartedCount) ?? 0,
    blockedGate: asStageGateSnapshotGateSummary(record.blockedGate),
    nextGate: asStageGateSnapshotGateSummary(record.nextGate),
    controlHealth: asStageGateSnapshotControlHealth(record.controlHealth),
  };
}

function asPortfolioFundingSnapshot(value: unknown): PortfolioFundingSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    capturedAt: asNullableString(record.capturedAt),
    latestSourceUpdatedAt: asNullableString(record.latestSourceUpdatedAt),
    linkedProjectCount: asNullableNumber(record.linkedProjectCount) ?? 0,
    trackedProjectCount: asNullableNumber(record.trackedProjectCount) ?? 0,
    fundedProjectCount: asNullableNumber(record.fundedProjectCount) ?? 0,
    likelyCoveredProjectCount: asNullableNumber(record.likelyCoveredProjectCount) ?? 0,
    gapProjectCount: asNullableNumber(record.gapProjectCount) ?? 0,
    committedFundingAmount: asNullableNumber(record.committedFundingAmount) ?? 0,
    likelyFundingAmount: asNullableNumber(record.likelyFundingAmount) ?? 0,
    totalPotentialFundingAmount: asNullableNumber(record.totalPotentialFundingAmount) ?? 0,
    unfundedAfterLikelyAmount: asNullableNumber(record.unfundedAfterLikelyAmount) ?? 0,
    paidReimbursementAmount: asNullableNumber(record.paidReimbursementAmount) ?? 0,
    outstandingReimbursementAmount: asNullableNumber(record.outstandingReimbursementAmount) ?? 0,
    uninvoicedAwardAmount: asNullableNumber(record.uninvoicedAwardAmount) ?? 0,
    awardRiskCount: asNullableNumber(record.awardRiskCount) ?? 0,
    label: asNullableString(record.label) ?? "Unknown funding posture",
    reason: asNullableString(record.reason) ?? "No RTP funding posture was captured on this packet artifact.",
    reimbursementLabel: asNullableString(record.reimbursementLabel) ?? "Unknown reimbursement posture",
    reimbursementReason:
      asNullableString(record.reimbursementReason) ?? "No RTP reimbursement posture was captured on this packet artifact.",
  };
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function maxTimestamp(
  ...values: Array<string | null | undefined>
): string | null {
  const timestamps = values
    .map((value) => parseTimestamp(value))
    .filter((value): value is number => value !== null);

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function formatCompactDateTime(value: string | null | undefined): string {
  return value ? formatDateTime(value) : "Unavailable";
}

function formatCurrency(value: number | null | undefined): string {
  const numeric = typeof value === "number" ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function asEngagementCampaignSnapshot(
  value: unknown
): EngagementCampaignSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = asNullableString(record.id);
  const title = asNullableString(record.title);

  if (!id || !title) {
    return null;
  }

  return {
    id,
    title,
    status: asNullableString(record.status),
    updatedAt: asNullableString(record.updatedAt),
  };
}

function buildCurrentProjectRecordEntry<T extends { title: string | null; created_at: string | null }>(
  items: T[],
  getAt: (item: T) => string | null
): CurrentProjectRecordEntry {
  return {
    count: items.length,
    latestTitle: items[0]?.title ?? null,
    latestAt: items[0] ? getAt(items[0]) : null,
  };
}

function summarizeProjectRecordDrift(changes: string[]): string {
  if (changes.length === 0) {
    return "Snapshot counts and latest record timing still match live project records.";
  }

  return changes.join(" ");
}

function driftTone(status: DriftStatus): "success" | "warning" | "neutral" | "info" {
  if (status === "unchanged") return "success";
  if (status === "gate changed" || status === "count changed") return "warning";
  if (status === "updated") return "info";
  return "neutral";
}

export default async function ReportDetailPage({ params }: RouteParams) {
  const { reportId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: report } = await supabase
    .from("reports")
    .select(
      "id, workspace_id, project_id, rtp_cycle_id, title, report_type, status, summary, generated_at, latest_artifact_url, latest_artifact_kind, created_at, updated_at"
    )
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    notFound();
  }

  const [
    { data: project },
    { data: rtpCycle },
    { data: workspace },
    { data: sections },
    { data: reportRunLinks },
    { data: artifacts },
    { data: rtpChapters },
    { data: rtpProjectLinks },
    { data: rtpCampaigns },
    operationsSummary,
  ] = await Promise.all([
    supabase
      .from("projects")
        .select(
          "id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at"
        )
        .eq("id", report.project_id)
        .maybeSingle(),
    report.rtp_cycle_id
      ? supabase
          .from("rtp_cycles")
          .select(
            "id, title, status, summary, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, updated_at"
          )
          .eq("id", report.rtp_cycle_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("workspaces")
      .select("id, name, plan, slug")
      .eq("id", report.workspace_id)
      .maybeSingle(),
    supabase
      .from("report_sections")
      .select("id, section_key, title, enabled, sort_order, config_json")
      .eq("report_id", report.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("report_runs")
      .select("id, run_id, sort_order")
      .eq("report_id", report.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("report_artifacts")
      .select("id, artifact_kind, generated_at, metadata_json")
      .eq("report_id", report.id)
      .order("generated_at", { ascending: false }),
    report.rtp_cycle_id
      ? supabase
          .from("rtp_cycle_chapters")
          .select("id, status")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
      : Promise.resolve({ data: [] }),
    report.rtp_cycle_id
      ? supabase
          .from("project_rtp_cycle_links")
          .select("id, project_id")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
      : Promise.resolve({ data: [] }),
    report.rtp_cycle_id
      ? supabase
          .from("engagement_campaigns")
          .select("id")
          .eq("workspace_id", report.workspace_id)
          .eq("rtp_cycle_id", report.rtp_cycle_id)
      : Promise.resolve({ data: [] }),
    loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      report.workspace_id
    ),
  ]);

  const [fundingProfileResult, fundingAwardsResult, fundingOpportunitiesResult, billingInvoicesResult] =
    report.project_id
      ? await Promise.all([
          supabase
            .from("project_funding_profiles")
            .select("id, funding_need_amount, local_match_need_amount, notes, updated_at")
            .eq("project_id", report.project_id)
            .maybeSingle(),
          supabase
            .from("funding_awards")
            .select("id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
            .eq("project_id", report.project_id)
            .order("updated_at", { ascending: false }),
          supabase
            .from("funding_opportunities")
            .select("id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
            .eq("project_id", report.project_id)
            .order("updated_at", { ascending: false }),
          supabase
            .from("billing_invoice_records")
            .select("id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
            .eq("project_id", report.project_id)
            .order("created_at", { ascending: false }),
        ])
      : [
          { data: null, error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  const rtpLinkedProjectIds = report.rtp_cycle_id
    ? ((rtpProjectLinks ?? []) as Array<{ project_id: string | null }>).map((link) => link.project_id).filter((value): value is string => Boolean(value))
    : [];

  const [rtpFundingProfilesResult, rtpFundingAwardsResult, rtpFundingOpportunitiesResult, rtpBillingInvoicesResult] =
    report.rtp_cycle_id && rtpLinkedProjectIds.length > 0
      ? await Promise.all([
          supabase
            .from("project_funding_profiles")
            .select("project_id, funding_need_amount, local_match_need_amount, updated_at")
            .in("project_id", rtpLinkedProjectIds),
          supabase
            .from("funding_awards")
            .select("project_id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
            .in("project_id", rtpLinkedProjectIds),
          supabase
            .from("funding_opportunities")
            .select("project_id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
            .in("project_id", rtpLinkedProjectIds),
          supabase
            .from("billing_invoice_records")
            .select("project_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
            .in("project_id", rtpLinkedProjectIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  const runIds = (reportRunLinks ?? []).map((item) => item.run_id);
  const runsResult = runIds.length
    ? await supabase
        .from("runs")
        .select("id, title, summary_text, created_at")
        .in("id", runIds)
    : { data: [], error: null };

  const sectionList = sections ?? [];
  const engagementCampaignId = extractEngagementCampaignId(sectionList);
  const engagementCampaignResult = engagementCampaignId
    ? await supabase
        .from("engagement_campaigns")
        .select(
          "id, title, summary, public_description, status, engagement_type, share_token, allow_public_submissions, submissions_closed_at, updated_at"
        )
        .eq("workspace_id", report.workspace_id)
        .eq("id", engagementCampaignId)
        .maybeSingle()
    : { data: null, error: null };

  const runMap = new Map(
    (runsResult.data ?? []).map((run) => [run.id, run])
  );
  const runs = (reportRunLinks ?? [])
    .map((link) => runMap.get(link.run_id) ?? null)
    .filter((item): item is LinkedRunRow => Boolean(item));

  const latestArtifact = ((artifacts ?? []) as ReportArtifact[])[0] ?? null;
  const latestHtml = asHtmlContent(latestArtifact?.metadata_json);
  const runAudit = asRunAudit(latestArtifact?.metadata_json);
  const sourceContext = asSourceContext(latestArtifact?.metadata_json);
  const storedEvidenceChainSummary = parseStoredEvidenceChainSummary(
    latestArtifact?.metadata_json ?? null
  );
  const storedScenarioSpineSummary = parseStoredScenarioSpineSummary(
    latestArtifact?.metadata_json ?? null
  );
  const storedFundingSnapshot = parseStoredFundingSnapshot(
    latestArtifact?.metadata_json ?? null
  );
  const liveFundingSnapshot = project
    ? buildProjectFundingSnapshot({
        profile: fundingProfileResult.data,
        awards: fundingAwardsResult.data ?? [],
        opportunities: fundingOpportunitiesResult.data ?? [],
        invoices: billingInvoicesResult.data ?? [],
        capturedAt: latestArtifact?.generated_at ?? null,
        projectUpdatedAt: project.updated_at,
      })
    : null;
  const engagementCampaign =
    (engagementCampaignResult.data as EngagementCampaignLinkRow | null) ?? null;
  const engagementPublicHref =
    engagementCampaign?.share_token && engagementCampaign.status === "active"
      ? `/engage/${engagementCampaign.share_token}`
      : null;
  const engagementSummaryText =
    engagementCampaign?.public_description ||
    engagementCampaign?.summary ||
    null;
  const reportOrigin = asNullableString(sourceContext?.reportOrigin);
  const reportReason = asNullableString(sourceContext?.reportReason);
  const engagementCountsSnapshot = asRecord(sourceContext?.engagementCountsSnapshot);
  const engagementSnapshotCapturedAt = asNullableString(
    sourceContext?.engagementSnapshotCapturedAt
  );
  const engagementSnapshotTotalItems = asNullableNumber(
    engagementCountsSnapshot?.totalItems
  );
  const engagementSnapshotReadyForHandoff = asNullableNumber(
    engagementCountsSnapshot?.readyForHandoffCount
  );
  const engagementCampaignSnapshot = asEngagementCampaignSnapshot(
    sourceContext?.engagementCampaignSnapshot
  );
  const stageGateSnapshot = asStageGateSnapshot(sourceContext?.stageGateSnapshot);
  const scenarioSetLinks = asScenarioSetLinks(sourceContext?.scenarioSetLinks);
  const fundingSnapshot = storedFundingSnapshot ?? liveFundingSnapshot;
  const fundingSummaryDigest = describeFundingSnapshot(fundingSnapshot);
  const projectRecordsSnapshotSource = asRecord(sourceContext?.projectRecordsSnapshot);
  const projectRecordsSnapshot = [
    {
      key: "deliverables",
      label: "Deliverables",
      anchor: "project-deliverables",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.deliverables),
    },
    {
      key: "risks",
      label: "Risks",
      anchor: "project-risks",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.risks),
    },
    {
      key: "issues",
      label: "Issues",
      anchor: "project-issues",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.issues),
    },
    {
      key: "decisions",
      label: "Decisions",
      anchor: "project-decisions",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.decisions),
    },
    {
      key: "meetings",
      label: "Meetings",
      anchor: "project-meetings",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.meetings),
    },
  ].filter(
    (
      item
    ): item is {
      key: string;
      label: string;
      anchor: string;
      value: ProjectRecordSnapshotEntry;
    } => Boolean(item.value)
  );
  const artifactList = (artifacts ?? []) as ReportArtifact[];

  if (report.rtp_cycle_id) {
    const enabledSectionKeys = Array.isArray(sourceContext?.enabledSectionKeys)
      ? sourceContext.enabledSectionKeys.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [];
    const readinessRecord = asRecord(sourceContext?.readiness);
    const workflowRecord = asRecord(sourceContext?.workflow);
    const presetAlignmentRecord = asRecord(sourceContext?.packetPresetAlignment);
    const currentPacketPresetAlignment = getRtpPacketPresetAlignment({
      cycleStatus: rtpCycle?.status,
      sections: (sections ?? []).map((section) => ({
        sectionKey: section.section_key,
        enabled: section.enabled,
        sortOrder: section.sort_order,
      })),
    });
    const currentRtpReadiness = rtpCycle
      ? buildRtpCycleReadiness({
          geographyLabel: rtpCycle.geography_label,
          horizonStartYear: rtpCycle.horizon_start_year,
          horizonEndYear: rtpCycle.horizon_end_year,
          adoptionTargetDate: (rtpCycle as Record<string, unknown>).adoption_target_date as string | null | undefined,
          publicReviewOpenAt: (rtpCycle as Record<string, unknown>).public_review_open_at as string | null | undefined,
          publicReviewCloseAt: (rtpCycle as Record<string, unknown>).public_review_close_at as string | null | undefined,
        })
      : null;
    const currentRtpWorkflow = currentRtpReadiness
      ? buildRtpCycleWorkflowSummary({ status: rtpCycle?.status, readiness: currentRtpReadiness })
      : null;
    const storedRtpFundingSnapshot = asPortfolioFundingSnapshot(sourceContext?.rtpFundingSnapshot);
    const rtpFundingProfileByProjectId = new Map(
      ((rtpFundingProfilesResult.data ?? []) as Array<{ project_id: string; funding_need_amount: number | null; local_match_need_amount: number | null; updated_at: string | null }>).map((profile) => [profile.project_id, profile])
    );
    const rtpFundingAwardsByProjectId = new Map<string, Array<{ awarded_amount: number | string | null; match_amount: number | string | null; risk_flag: string | null; obligation_due_at: string | null; updated_at: string | null; created_at: string | null }>>();
    const rtpFundingOpportunitiesByProjectId = new Map<string, Array<{ expected_award_amount: number | string | null; decision_state: string | null; opportunity_status: string | null; closes_at: string | null; updated_at: string | null; created_at: string | null }>>();
    const rtpFundingInvoicesByProjectId = new Map<string, Array<{ status: string | null; amount: number | string | null; retention_percent: number | string | null; retention_amount: number | string | null; net_amount: number | string | null; due_date: string | null; invoice_date: string | null; created_at: string | null }>>();
    for (const award of (rtpFundingAwardsResult.data ?? []) as Array<{ project_id: string; awarded_amount: number | string | null; match_amount: number | string | null; risk_flag: string | null; obligation_due_at: string | null; updated_at: string | null; created_at: string | null }>) {
      const current = rtpFundingAwardsByProjectId.get(award.project_id) ?? [];
      current.push(award);
      rtpFundingAwardsByProjectId.set(award.project_id, current);
    }
    for (const opportunity of (rtpFundingOpportunitiesResult.data ?? []) as Array<{ project_id: string; expected_award_amount: number | string | null; decision_state: string | null; opportunity_status: string | null; closes_at: string | null; updated_at: string | null; created_at: string | null }>) {
      const current = rtpFundingOpportunitiesByProjectId.get(opportunity.project_id) ?? [];
      current.push(opportunity);
      rtpFundingOpportunitiesByProjectId.set(opportunity.project_id, current);
    }
    for (const invoice of (rtpBillingInvoicesResult.data ?? []) as Array<{ project_id: string; status: string | null; amount: number | string | null; retention_percent: number | string | null; retention_amount: number | string | null; net_amount: number | string | null; due_date: string | null; invoice_date: string | null; created_at: string | null }>) {
      const current = rtpFundingInvoicesByProjectId.get(invoice.project_id) ?? [];
      current.push(invoice);
      rtpFundingInvoicesByProjectId.set(invoice.project_id, current);
    }
    const currentRtpFundingSnapshot = buildPortfolioFundingSnapshot({
      projects: rtpLinkedProjectIds.map((projectId) => ({
        profile: rtpFundingProfileByProjectId.get(projectId) ?? null,
        awards: rtpFundingAwardsByProjectId.get(projectId) ?? [],
        opportunities: rtpFundingOpportunitiesByProjectId.get(projectId) ?? [],
        invoices: rtpFundingInvoicesByProjectId.get(projectId) ?? [],
      })),
      capturedAt: latestArtifact?.generated_at ?? null,
    });
    const rtpComparisonDigest = describeComparisonSnapshotAggregate(
      parseStoredComparisonSnapshotAggregate(latestArtifact?.metadata_json ?? null)
    );
    const currentRtpChapterRows = (rtpChapters ?? []) as Array<{ id: string; status: string | null }>;
    const currentRtpProjectLinks = (rtpProjectLinks ?? []) as Array<{ id: string }>;
    const currentRtpCampaigns = (rtpCampaigns ?? []) as Array<{ id: string }>;
    return (
      <RtpReportDetail
        report={report}
        workspace={workspace}
        cycle={rtpCycle}
        sections={(sections ?? []).map((section) => ({
          id: section.id,
          section_key: section.section_key,
          title: section.title,
          enabled: section.enabled,
          sort_order: section.sort_order,
          config_json: (section.config_json as Record<string, unknown> | null) ?? {},
        }))}
        artifacts={artifactList.map((artifact) => ({
          id: artifact.id,
          artifact_kind: artifact.artifact_kind,
          generated_at: artifact.generated_at,
        }))}
        comparisonDigest={rtpComparisonDigest}
        latestHtml={latestHtml}
        generationContext={{
          generatedAt: latestArtifact?.generated_at ?? null,
          enabledSectionKeys,
          readinessLabel: asNullableString(readinessRecord?.label),
          readinessReason: asNullableString(readinessRecord?.reason),
          workflowLabel: asNullableString(workflowRecord?.label),
          workflowDetail: asNullableString(workflowRecord?.detail),
          chapterCount: asNullableNumber(sourceContext?.chapterCount),
          chapterCompleteCount: asNullableNumber(sourceContext?.chapterCompleteCount),
          chapterReadyForReviewCount: asNullableNumber(sourceContext?.chapterReadyForReviewCount),
          linkedProjectCount: asNullableNumber(sourceContext?.linkedProjectCount),
          engagementCampaignCount: asNullableNumber(sourceContext?.engagementCampaignCount),
          presetStage: asNullableString(presetAlignmentRecord?.presetStage),
          presetLabel: asNullableString(presetAlignmentRecord?.presetLabel),
          presetStatusLabel: asNullableString(presetAlignmentRecord?.statusLabel),
          presetDetail: asNullableString(presetAlignmentRecord?.detail),
          fundingSnapshot: storedRtpFundingSnapshot,
        }}
        currentContext={{
          enabledSectionKeys: (sections ?? [])
            .filter((section) => section.enabled)
            .map((section) => section.section_key),
          readinessLabel: currentRtpReadiness?.label ?? null,
          readinessReason: currentRtpReadiness?.reason ?? null,
          workflowLabel: currentRtpWorkflow?.label ?? null,
          workflowDetail: currentRtpWorkflow?.detail ?? null,
          chapterCount: currentRtpChapterRows.length,
          chapterCompleteCount: currentRtpChapterRows.filter((chapter) => chapter.status === "complete").length,
          chapterReadyForReviewCount: currentRtpChapterRows.filter((chapter) => chapter.status === "ready_for_review").length,
          linkedProjectCount: currentRtpProjectLinks.length,
          engagementCampaignCount: currentRtpCampaigns.length,
          cycleUpdatedAt: rtpCycle?.updated_at ?? null,
          presetStage: currentPacketPresetAlignment.presetStage,
          presetLabel: currentPacketPresetAlignment.presetLabel,
          presetStatusLabel: currentPacketPresetAlignment.statusLabel,
          presetDetail: currentPacketPresetAlignment.detail,
          fundingSnapshot: currentRtpFundingSnapshot,
        }}
        operationsSummary={operationsSummary}
      />
    );
  }

  const enabledSections = sectionList.filter((s) => s.enabled).length;
  const runTitleById = new Map(runs.map((run) => [run.id, run.title]));
  const liveScenarioSetIds = scenarioSetLinks.map((item) => item.scenarioSetId);
  const liveEvidenceChainSummary = buildEvidenceChainSummary({
    linkedRunCount: runs.length,
    scenarioSetLinks,
    projectRecordsSnapshot: {
      deliverables:
        asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.deliverables) ?? {
          count: 0,
          latestTitle: null,
          latestAt: null,
        },
      risks: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.risks) ?? {
        count: 0,
        latestTitle: null,
        latestAt: null,
      },
      issues: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.issues) ?? {
        count: 0,
        latestTitle: null,
        latestAt: null,
      },
      decisions:
        asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.decisions) ?? {
          count: 0,
          latestTitle: null,
          latestAt: null,
        },
      meetings: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.meetings) ?? {
        count: 0,
        latestTitle: null,
        latestAt: null,
      },
    },
    engagementCampaignCurrent: engagementCampaign
      ? {
          status: engagementCampaign.status,
        }
      : null,
    engagementItemCount: asNullableNumber(sourceContext?.engagementItemCount) ?? 0,
    engagementReadyForHandoffCount:
      asNullableNumber(sourceContext?.engagementReadyForHandoffCount) ?? 0,
    stageGateSnapshot:
      stageGateSnapshot ?? {
        templateId: "unknown",
        templateVersion: "unknown",
        passCount: 0,
        holdCount: 0,
        notStartedCount: 0,
        blockedGate: null,
        nextGate: null,
        controlHealth: {
          totalOperatorControlEvidenceCount: 0,
          gatesWithOperatorControlsCount: 0,
        },
      },
  });

  const [
    engagementCategoriesResult,
    engagementItemsResult,
    scenarioSetsResult,
    scenarioAssumptionSetsResult,
    scenarioDataPackagesResult,
    scenarioIndicatorSnapshotsResult,
    scenarioComparisonSnapshotsResult,
    stageGateDecisionsResult,
    deliverablesResult,
    risksResult,
    issuesResult,
    decisionsResult,
    meetingsResult,
  ] = await Promise.all([
    engagementCampaign
      ? supabase
          .from("engagement_categories")
          .select("id, label, slug, description, sort_order, created_at, updated_at")
          .eq("campaign_id", engagementCampaign.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    engagementCampaign
      ? supabase
          .from("engagement_items")
          .select(
            "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at"
          )
          .eq("campaign_id", engagementCampaign.id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_sets")
          .select("id, updated_at")
          .in("id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_assumption_sets")
          .select("scenario_set_id, updated_at")
          .in("scenario_set_id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_data_packages")
          .select("scenario_set_id, updated_at")
          .in("scenario_set_id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_indicator_snapshots")
          .select("scenario_set_id, snapshot_at")
          .in("scenario_set_id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_comparison_snapshots")
          .select("scenario_set_id, updated_at")
          .in("scenario_set_id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    stageGateSnapshot
      ? supabase
          .from("stage_gate_decisions")
          .select("gate_id, decision, rationale, decided_at, missing_artifacts")
          .eq("workspace_id", report.workspace_id)
          .order("decided_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "deliverables")
      ? supabase
          .from("project_deliverables")
          .select("id, title, due_date, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "risks")
      ? supabase
          .from("project_risks")
          .select("id, title, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "issues")
      ? supabase
          .from("project_issues")
          .select("id, title, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "decisions")
      ? supabase
          .from("project_decisions")
          .select("id, title, decided_at, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "meetings")
      ? supabase
          .from("project_meetings")
          .select("id, title, meeting_at, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const liveEngagementCounts = engagementCampaign
    ? summarizeEngagementItems(
        (engagementCategoriesResult.data ?? []) as EngagementCategoryRow[],
        (engagementItemsResult.data ?? []) as EngagementItemRow[]
      )
    : null;
  const liveScenarioSetsById = new Map(
    (((scenarioSetsResult.data ?? []) as Array<{ id: string; updated_at: string | null }>)).map((item) => [
      item.id,
      item.updated_at,
    ])
  );
  const liveScenarioSpinePending = [
    scenarioAssumptionSetsResult.error,
    scenarioDataPackagesResult.error,
    scenarioIndicatorSnapshotsResult.error,
    scenarioComparisonSnapshotsResult.error,
  ].some((error) => looksLikePendingScenarioSpineSchema(error?.message));
  const liveScenarioAssumptionRows = liveScenarioSpinePending
    ? []
    : ((scenarioAssumptionSetsResult.data ?? []) as ScenarioSpineRow[]);
  const liveScenarioDataPackageRows = liveScenarioSpinePending
    ? []
    : ((scenarioDataPackagesResult.data ?? []) as ScenarioSpineRow[]);
  const liveScenarioIndicatorRows = liveScenarioSpinePending
    ? []
    : ((scenarioIndicatorSnapshotsResult.data ?? []) as ScenarioSpineRow[]);
  const liveScenarioComparisonRows = liveScenarioSpinePending
    ? []
    : ((scenarioComparisonSnapshotsResult.data ?? []) as ScenarioSpineRow[]);
  const liveScenarioSpineSummaryById = new Map<string, {
    assumptionSetCount: number;
    dataPackageCount: number;
    indicatorSnapshotCount: number;
    comparisonSnapshotCount: number;
    latestAssumptionSetUpdatedAt: string | null;
    latestDataPackageUpdatedAt: string | null;
    latestIndicatorSnapshotAt: string | null;
    latestComparisonSnapshotUpdatedAt: string | null;
  }>();

  for (const scenarioSetId of liveScenarioSetIds) {
    const assumptionRows = liveScenarioAssumptionRows.filter((row) => row.scenario_set_id === scenarioSetId);
    const dataPackageRows = liveScenarioDataPackageRows.filter((row) => row.scenario_set_id === scenarioSetId);
    const indicatorRows = liveScenarioIndicatorRows.filter((row) => row.scenario_set_id === scenarioSetId);
    const comparisonRows = liveScenarioComparisonRows.filter((row) => row.scenario_set_id === scenarioSetId);

    liveScenarioSpineSummaryById.set(scenarioSetId, {
      assumptionSetCount: assumptionRows.length,
      dataPackageCount: dataPackageRows.length,
      indicatorSnapshotCount: indicatorRows.length,
      comparisonSnapshotCount: comparisonRows.length,
      latestAssumptionSetUpdatedAt: maxTimestamp(...assumptionRows.map((row) => row.updated_at ?? null)),
      latestDataPackageUpdatedAt: maxTimestamp(...dataPackageRows.map((row) => row.updated_at ?? null)),
      latestIndicatorSnapshotAt: maxTimestamp(...indicatorRows.map((row) => row.snapshot_at ?? null)),
      latestComparisonSnapshotUpdatedAt: maxTimestamp(...comparisonRows.map((row) => row.updated_at ?? null)),
    });
  }
  const currentStageGateSummary: ProjectStageGateSummary | null = stageGateSnapshot
    ? buildProjectStageGateSummary(
        (stageGateDecisionsResult.data ?? []) as StageGateDecisionRow[]
      )
    : null;
  const currentProjectRecordsByKey = new Map<ProjectRecordSnapshotKey, CurrentProjectRecordEntry>([
    [
      "deliverables",
      buildCurrentProjectRecordEntry(
        (deliverablesResult.data ?? []) as Array<{
          title: string | null;
          due_date: string | null;
          created_at: string | null;
        }>,
        (item) => item.due_date ?? item.created_at
      ),
    ],
    [
      "risks",
      buildCurrentProjectRecordEntry(
        (risksResult.data ?? []) as Array<{
          title: string | null;
          created_at: string | null;
        }>,
        (item) => item.created_at
      ),
    ],
    [
      "issues",
      buildCurrentProjectRecordEntry(
        (issuesResult.data ?? []) as Array<{
          title: string | null;
          created_at: string | null;
        }>,
        (item) => item.created_at
      ),
    ],
    [
      "decisions",
      buildCurrentProjectRecordEntry(
        (decisionsResult.data ?? []) as Array<{
          title: string | null;
          decided_at: string | null;
          created_at: string | null;
        }>,
        (item) => item.decided_at ?? item.created_at
      ),
    ],
    [
      "meetings",
      buildCurrentProjectRecordEntry(
        (meetingsResult.data ?? []) as Array<{
          title: string | null;
          meeting_at: string | null;
          created_at: string | null;
        }>,
        (item) => item.meeting_at ?? item.created_at
      ),
    ],
  ]);

  const evidenceChainSummary = storedEvidenceChainSummary ?? liveEvidenceChainSummary;
  const evidenceSummaryDigest = describeEvidenceChainSummary(
    sourceContext ? evidenceChainSummary : null
  );
  const driftItems: DriftItem[] = [];

  if (
    engagementCampaign &&
    liveEngagementCounts &&
    (engagementCampaignSnapshot ||
      engagementSnapshotCapturedAt ||
      engagementSnapshotTotalItems !== null ||
      engagementSnapshotReadyForHandoff !== null)
  ) {
    const snapshotStatus = engagementCampaignSnapshot?.status ?? null;
    const snapshotUpdatedAt =
      engagementCampaignSnapshot?.updatedAt ?? engagementSnapshotCapturedAt;
    const liveReadyForHandoff =
      liveEngagementCounts.moderationQueue.readyForHandoffCount;
    const liveTotalItems = liveEngagementCounts.totalItems;

    const status: DriftStatus =
      engagementSnapshotTotalItems !== null &&
      engagementSnapshotReadyForHandoff !== null &&
      (engagementSnapshotTotalItems !== liveTotalItems ||
        engagementSnapshotReadyForHandoff !== liveReadyForHandoff)
        ? "count changed"
        : snapshotStatus !== null && snapshotStatus !== engagementCampaign.status
          ? "updated"
          : snapshotUpdatedAt !== null &&
              snapshotUpdatedAt !== engagementCampaign.updated_at
            ? "updated"
            : "unchanged";

    driftItems.push({
      key: "engagement",
      label: "Engagement handoff",
      status,
      detail:
        `Snapshot ${snapshotStatus ? `${titleize(snapshotStatus)} · ` : ""}${engagementSnapshotReadyForHandoff ?? 0} ready / ${engagementSnapshotTotalItems ?? 0} items · ${formatCompactDateTime(snapshotUpdatedAt)}. ` +
        `Live ${titleize(engagementCampaign.status)} · ${liveReadyForHandoff} ready / ${liveTotalItems} items · ${formatCompactDateTime(engagementCampaign.updated_at)}.`,
    });
  }

  if (scenarioSetLinks.length > 0) {
    const scenarioChanges = scenarioSetLinks
      .map((link) => {
        const snapshotAt = maxTimestamp(
          link.scenarioSetUpdatedAt,
          link.latestMatchedEntryUpdatedAt,
          link.sharedSpine?.latestAssumptionSetUpdatedAt ?? null,
          link.sharedSpine?.latestDataPackageUpdatedAt ?? null,
          link.sharedSpine?.latestIndicatorSnapshotAt ?? null,
          link.sharedSpine?.latestComparisonSnapshotUpdatedAt ?? null
        );
        const currentSetAt = liveScenarioSetsById.get(link.scenarioSetId) ?? null;
        const currentSpine = liveScenarioSpineSummaryById.get(link.scenarioSetId) ?? null;
        const currentAt = maxTimestamp(
          currentSetAt,
          currentSpine?.latestAssumptionSetUpdatedAt ?? null,
          currentSpine?.latestDataPackageUpdatedAt ?? null,
          currentSpine?.latestIndicatorSnapshotAt ?? null,
          currentSpine?.latestComparisonSnapshotUpdatedAt ?? null
        );

        const countChanged = currentSpine
          ? link.sharedSpine
            ? link.sharedSpine.assumptionSetCount !== currentSpine.assumptionSetCount ||
              link.sharedSpine.dataPackageCount !== currentSpine.dataPackageCount ||
              link.sharedSpine.indicatorSnapshotCount !== currentSpine.indicatorSnapshotCount ||
              link.sharedSpine.comparisonSnapshotCount !== currentSpine.comparisonSnapshotCount
            : currentSpine.assumptionSetCount > 0 ||
              currentSpine.dataPackageCount > 0 ||
              currentSpine.indicatorSnapshotCount > 0 ||
              currentSpine.comparisonSnapshotCount > 0
          : false;

        if (!countChanged && (!currentAt || !snapshotAt || currentAt === snapshotAt)) {
          return null;
        }

        if (countChanged && currentSpine) {
          return `${link.scenarioSetTitle}: assumptions ${link.sharedSpine?.assumptionSetCount ?? 0} -> ${currentSpine.assumptionSetCount}, packages ${link.sharedSpine?.dataPackageCount ?? 0} -> ${currentSpine.dataPackageCount}, indicators ${link.sharedSpine?.indicatorSnapshotCount ?? 0} -> ${currentSpine.indicatorSnapshotCount}, comparisons ${link.sharedSpine?.comparisonSnapshotCount ?? 0} -> ${currentSpine.comparisonSnapshotCount}.`;
        }

        return `${link.scenarioSetTitle}: ${formatCompactDateTime(snapshotAt)} -> ${formatCompactDateTime(currentAt)}.`;
      })
      .filter((item): item is string => Boolean(item));

    driftItems.push({
      key: "scenario-basis",
      label: "Scenario basis",
      status: scenarioChanges.length > 0 ? "updated" : "unchanged",
      detail:
        scenarioChanges.length > 0
          ? scenarioChanges.join(" ")
          : "Scenario-set and shared-spine timing still matches the artifact snapshot.",
    });
  }

  if (projectRecordsSnapshot.length > 0) {
    const countChanges: string[] = [];
    const timingChanges: string[] = [];

    for (const item of projectRecordsSnapshot) {
      const currentEntry = currentProjectRecordsByKey.get(
        item.key as ProjectRecordSnapshotKey
      );

      if (!currentEntry) {
        continue;
      }

      if (item.value.count !== currentEntry.count) {
        countChanges.push(
          `${item.label}: ${item.value.count} -> ${currentEntry.count}.`
        );
        continue;
      }

      if (item.value.latestAt !== currentEntry.latestAt) {
        timingChanges.push(
          `${item.label}: ${formatCompactDateTime(item.value.latestAt)} -> ${formatCompactDateTime(currentEntry.latestAt)}.`
        );
      }
    }

    driftItems.push({
      key: "project-records",
      label: "Project records",
      status:
        countChanges.length > 0
          ? "count changed"
          : timingChanges.length > 0
            ? "updated"
            : "unchanged",
      detail: summarizeProjectRecordDrift(
        countChanges.length > 0 ? countChanges : timingChanges
      ),
    });
  }

  if (storedFundingSnapshot && liveFundingSnapshot) {
    const fundingCountChanges: string[] = [];
    const fundingValueChanges: string[] = [];
    const fundingLabelChanges: string[] = [];

    if (storedFundingSnapshot.awardCount !== liveFundingSnapshot.awardCount) {
      fundingCountChanges.push(
        `Awards: ${storedFundingSnapshot.awardCount} -> ${liveFundingSnapshot.awardCount}.`
      );
    }
    if (
      storedFundingSnapshot.pursuedOpportunityCount !==
      liveFundingSnapshot.pursuedOpportunityCount
    ) {
      fundingCountChanges.push(
        `Pursued opportunities: ${storedFundingSnapshot.pursuedOpportunityCount} -> ${liveFundingSnapshot.pursuedOpportunityCount}.`
      );
    }
    if (
      storedFundingSnapshot.reimbursementPacketCount !==
      liveFundingSnapshot.reimbursementPacketCount
    ) {
      fundingCountChanges.push(
        `Reimbursement packets: ${storedFundingSnapshot.reimbursementPacketCount} -> ${liveFundingSnapshot.reimbursementPacketCount}.`
      );
    }

    if (
      storedFundingSnapshot.committedFundingAmount !==
      liveFundingSnapshot.committedFundingAmount
    ) {
      fundingValueChanges.push(
        `Committed awards: ${formatCurrency(storedFundingSnapshot.committedFundingAmount)} -> ${formatCurrency(liveFundingSnapshot.committedFundingAmount)}.`
      );
    }
    if (
      storedFundingSnapshot.unfundedAfterLikelyAmount !==
      liveFundingSnapshot.unfundedAfterLikelyAmount
    ) {
      fundingValueChanges.push(
        `Uncovered after likely dollars: ${formatCurrency(storedFundingSnapshot.unfundedAfterLikelyAmount)} -> ${formatCurrency(liveFundingSnapshot.unfundedAfterLikelyAmount)}.`
      );
    }
    if (
      storedFundingSnapshot.uninvoicedAwardAmount !==
      liveFundingSnapshot.uninvoicedAwardAmount
    ) {
      fundingValueChanges.push(
        `Uninvoiced awards: ${formatCurrency(storedFundingSnapshot.uninvoicedAwardAmount)} -> ${formatCurrency(liveFundingSnapshot.uninvoicedAwardAmount)}.`
      );
    }

    if (storedFundingSnapshot.label !== liveFundingSnapshot.label) {
      fundingLabelChanges.push(
        `Funding posture: ${storedFundingSnapshot.label} -> ${liveFundingSnapshot.label}.`
      );
    }
    if (storedFundingSnapshot.pipelineLabel !== liveFundingSnapshot.pipelineLabel) {
      fundingLabelChanges.push(
        `Pipeline posture: ${storedFundingSnapshot.pipelineLabel} -> ${liveFundingSnapshot.pipelineLabel}.`
      );
    }
    if (
      storedFundingSnapshot.reimbursementLabel !==
      liveFundingSnapshot.reimbursementLabel
    ) {
      fundingLabelChanges.push(
        `Reimbursement posture: ${storedFundingSnapshot.reimbursementLabel} -> ${liveFundingSnapshot.reimbursementLabel}.`
      );
    }

    const fundingTimingChanged =
      storedFundingSnapshot.latestSourceUpdatedAt !== liveFundingSnapshot.latestSourceUpdatedAt;

    driftItems.push({
      key: "funding-posture",
      label: "Funding posture",
      status:
        fundingCountChanges.length > 0
          ? "count changed"
          : fundingValueChanges.length > 0 || fundingLabelChanges.length > 0 || fundingTimingChanged
            ? "updated"
            : "unchanged",
      detail:
        [
          ...fundingCountChanges,
          ...fundingValueChanges,
          ...fundingLabelChanges,
          fundingTimingChanged
            ? `Funding source timing: ${formatCompactDateTime(storedFundingSnapshot.latestSourceUpdatedAt)} -> ${formatCompactDateTime(liveFundingSnapshot.latestSourceUpdatedAt)}.`
            : null,
        ].filter((value): value is string => Boolean(value)).join(" ") ||
        "Funding counts, posture labels, and reimbursement state still match the latest artifact snapshot.",
    });
  }

  if (stageGateSnapshot && currentStageGateSummary) {
    const snapshotBlockedGateId = stageGateSnapshot.blockedGate?.gateId ?? null;
    const currentBlockedGateId = currentStageGateSummary.blockedGate?.gateId ?? null;
    const snapshotNextGateId = stageGateSnapshot.nextGate?.gateId ?? null;
    const currentNextGateId = currentStageGateSummary.nextGate?.gateId ?? null;
    const countsChanged =
      stageGateSnapshot.passCount !== currentStageGateSummary.passCount ||
      stageGateSnapshot.holdCount !== currentStageGateSummary.holdCount ||
      stageGateSnapshot.notStartedCount !== currentStageGateSummary.notStartedCount;
    const gatesChanged =
      snapshotBlockedGateId !== currentBlockedGateId ||
      snapshotNextGateId !== currentNextGateId;

    driftItems.push({
      key: "stage-gates",
      label: "Stage gates",
      status: gatesChanged
        ? "gate changed"
        : countsChanged
          ? "count changed"
          : "unchanged",
      detail: gatesChanged
        ? `Blocked ${snapshotBlockedGateId ?? "none"} -> ${currentBlockedGateId ?? "none"}. Next ${snapshotNextGateId ?? "complete"} -> ${currentNextGateId ?? "complete"}.`
        : countsChanged
          ? `Snapshot ${stageGateSnapshot.passCount} pass / ${stageGateSnapshot.holdCount} hold / ${stageGateSnapshot.notStartedCount} not started. Live ${currentStageGateSummary.passCount} pass / ${currentStageGateSummary.holdCount} hold / ${currentStageGateSummary.notStartedCount} not started.`
          : "Review counts and next steps still match the saved report snapshot.",
    });
  }

  const driftedItems = driftItems.filter((item) => item.status !== "unchanged");
  const driftActionByKey: Record<string, { href: string; label: string } | null> = {
    engagement: engagementCampaign
      ? { href: `/engagement/${engagementCampaign.id}`, label: "Review engagement source" }
      : engagementPublicHref
        ? { href: engagementPublicHref, label: "Review public engagement" }
        : null,
    "scenario-basis": scenarioSetLinks[0]
      ? { href: `/scenarios/${scenarioSetLinks[0].scenarioSetId}`, label: "Review scenario set" }
      : null,
    "project-records": project
      ? { href: `/projects/${project.id}`, label: "Review project records" }
      : null,
    "stage-gates": project
      ? { href: `/projects/${project.id}#project-governance`, label: "Review project settings" }
      : null,
  };

  return (
    <section className="module-page space-y-6">
      {/* ── Hero row ─────────────────────────────────────────── */}
      <header className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        {/* Left: report identity */}
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <ScrollText className="h-3.5 w-3.5" />
            Report detail
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            {report.title}
          </h1>
          <p className="mt-3 max-w-3xl text-[0.9rem] leading-relaxed text-muted-foreground sm:text-base">
            {report.summary ||
              "No summary provided. Use the controls to describe this report\u2019s purpose and generate an HTML packet."}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <StatusBadge tone={reportStatusTone(report.status)}>
              {formatReportStatusLabel(report.status)}
            </StatusBadge>
            <StatusBadge tone="info">
              {formatReportTypeLabel(report.report_type)}
            </StatusBadge>
            {report.latest_artifact_kind ? (
              <StatusBadge tone="neutral">
                {report.latest_artifact_kind.toUpperCase()}
              </StatusBadge>
            ) : null}
          </div>

          <div className="module-summary-grid cols-4 mt-6">
            <div className="module-summary-card">
              <p className="module-summary-label">Project</p>
              <p className="module-summary-value truncate text-xl">
                {project?.name ?? "Unknown"}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Workspace</p>
              <p className="module-summary-value truncate text-xl">
                {workspace?.name ?? "Unknown"}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked runs</p>
              <p className="module-summary-value text-xl tabular-nums">
                {runs.length}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Generated</p>
              <p className="module-summary-value text-base">
                {report.generated_at
                  ? formatDateTime(report.generated_at)
                  : "Not yet"}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Funding posture</p>
              <p className="module-summary-value text-base">
                {fundingSnapshot?.label ?? "Not captured"}
              </p>
              <p className="module-summary-detail">
                {fundingSnapshot
                  ? fundingSnapshot.unfundedAfterLikelyAmount > 0
                    ? `${formatCurrency(fundingSnapshot.unfundedAfterLikelyAmount)} still uncovered after likely dollars.`
                    : fundingSnapshot.uninvoicedAwardAmount > 0
                      ? `${formatCurrency(fundingSnapshot.uninvoicedAwardAmount)} still uninvoiced.`
                      : fundingSnapshot.reimbursementLabel
                  : "Generate a packet to snapshot funding posture into report evidence."}
              </p>
            </div>
          </div>

          {/* Timestamps */}
          <div className="module-inline-list mt-4">
            <span className="module-inline-item">Created {formatDateTime(report.created_at)}</span>
            <span className="module-inline-item">Updated {formatDateTime(report.updated_at)}</span>
            {project?.updated_at ? <span className="module-inline-item">Project snapshot {formatDateTime(project.updated_at)}</span> : null}
          </div>
        </article>

        {/* Right: controls */}
        <div id="report-controls">
          <ReportDetailControls
            report={{
              id: report.id,
              title: report.title,
              summary: report.summary,
              status: report.status,
              hasGeneratedArtifact: Boolean(report.latest_artifact_kind),
            }}
            driftSummary={{
              changedCount: driftedItems.length,
              totalCount: driftItems.length,
              labels: driftedItems.map((item) => item.label),
            }}
            evidenceSummary={evidenceSummaryDigest}
            fundingSummary={fundingSummaryDigest}
          />
        </div>
      </header>

      <WorkspaceCommandBoard
        summary={operationsSummary}
        label="Workspace command board"
        title="What should move around this report"
        description="Report detail now inherits the shared workspace runtime too, so broader packet pressure, funding timing, and setup gaps stay visible while you review drift, provenance, and governance posture on this record."
      />

      {/* ── Composition + provenance row ─────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        {/* Left: packet composition */}
        <article className="module-section-surface space-y-6">
          {/* Sections */}
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Composition
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Packet sections
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {enabledSections}/{sectionList.length} enabled
                  </span>
                </h2>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {sectionList.map((section, index) => (
                <div
                  key={section.id}
                  className="flex items-center gap-3 rounded-[18px] border border-border/80 bg-background/80 px-4 py-3 transition-colors"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-[0.7rem] font-semibold tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold tracking-tight">
                      {section.title}
                    </h3>
                    <p className="text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">
                      {titleize(section.section_key)}
                    </p>
                  </div>
                  <StatusBadge
                    tone={section.enabled ? "success" : "neutral"}
                    className="shrink-0"
                  >
                    {section.enabled ? "Enabled" : "Hidden"}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </div>

          {/* Linked runs */}
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <Hash className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Source data
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Linked runs
                </h2>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {runs.length === 0 ? (
                <EmptyState
                  title="No linked runs"
                  description="Attach analysis runs when creating a report to include their results in the generated packet."
                  compact
                />
              ) : (
                runs.map((run) => (
                  <div
                    key={run.id}
                    className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3"
                  >
                    <h4 className="text-sm font-semibold tracking-tight">
                      {run.title}
                    </h4>
                    <p className="mt-1 line-clamp-2 text-[0.82rem] leading-relaxed text-muted-foreground">
                      {run.summary_text || "No run summary available."}
                    </p>
                    <p className="mt-2 text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                      Created {formatDateTime(run.created_at)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Artifact history */}
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--copper)]/10 text-[color:var(--copper)]">
                <Clock3 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  History
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Generated artifacts
                </h2>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {artifactList.length === 0 ? (
                <EmptyState
                  title="No artifacts yet"
                  description="Use the generation control to produce the first HTML packet for this report."
                  compact
                />
              ) : (
                artifactList.map((artifact) => (
                  <div
                    id={`artifact-${artifact.id}`}
                    key={artifact.id}
                    className="flex items-center justify-between gap-3 rounded-[18px] border border-border/80 bg-background/80 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold tracking-tight">
                        {artifact.artifact_kind.toUpperCase()} artifact
                      </h4>
                      <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                        Generated {formatDateTime(artifact.generated_at)}
                      </p>
                    </div>
                    <StatusBadge tone="info" className="shrink-0">
                      {artifact.id.slice(0, 8)}
                    </StatusBadge>
                  </div>
                ))
              )}
            </div>
          </div>
        </article>

        {/* Right column */}
        <div className="space-y-6">
          {/* Source history */}
          <article className="module-section-surface">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Provenance
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Audit trail
                </h2>
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              <p className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                Generated artifacts include run-level audit metadata so every
                packet can be traced back to its source analysis and reviewed
                for completeness.
              </p>
              {runAudit.length === 0 ? (
                <EmptyState
                  title="No audit data yet"
                  description="Generate the report to capture linked-run transparency notes and artifact gate decisions."
                  compact
                />
              ) : (
                runAudit.map((item) => (
                  <div
                    key={item.runId}
                    className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">
                          {runTitleById.get(item.runId) ?? `Run ${item.runId.slice(0, 8)}`}
                        </h3>
                        <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                          Gate decision: {item.gate.decision}
                        </p>
                      </div>
                      <StatusBadge
                        tone={
                          item.gate.decision === "PASS"
                            ? "success"
                            : "warning"
                        }
                      >
                        {item.gate.decision}
                      </StatusBadge>
                    </div>
                    {item.gate.missingArtifacts.length > 0 ? (
                      <ul className="mt-3 space-y-1.5">
                        {item.gate.missingArtifacts.map(
                          (missingArtifact) => (
                            <li
                              key={missingArtifact}
                              className="rounded-xl border border-border/70 bg-card px-3 py-2 text-sm text-muted-foreground"
                            >
                              {missingArtifact}
                            </li>
                          )
                        )}
                      </ul>
                    ) : (
                      <p className="mt-2.5 text-sm text-muted-foreground">
                        All required artifacts were present for this run.
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
            {sourceContext || engagementCampaign ? (
              <div id="evidence-chain-summary" className="mt-4 space-y-3">
                <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Evidence chain summary
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Quick scan of the source surfaces captured in the latest packet.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Linked runs
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {evidenceChainSummary.linkedRunCount}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Scenario basis
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {evidenceChainSummary.scenarioSetLinkCount} linked set{evidenceChainSummary.scenarioSetLinkCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Scenario spine
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {(storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount) > 0
                        ? `${storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount} pending set${(storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount) === 1 ? "" : "s"}`
                        : `${storedScenarioSpineSummary?.assumptionSetCount ?? evidenceChainSummary.scenarioAssumptionSetCount} assumptions · ${storedScenarioSpineSummary?.dataPackageCount ?? evidenceChainSummary.scenarioDataPackageCount} packages · ${storedScenarioSpineSummary?.indicatorSnapshotCount ?? evidenceChainSummary.scenarioIndicatorSnapshotCount} indicators`}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Project records
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {evidenceChainSummary.totalProjectRecordCount} across {evidenceChainSummary.projectRecordGroupCount} group{evidenceChainSummary.projectRecordGroupCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Governance
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {evidenceChainSummary.stageGateLabel} · {evidenceChainSummary.stageGatePassCount} pass / {evidenceChainSummary.stageGateHoldCount} hold
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3 sm:col-span-2 xl:col-span-2">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Engagement posture
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {evidenceChainSummary.engagementLabel} · {evidenceChainSummary.engagementReadyForHandoffCount}/{evidenceChainSummary.engagementItemCount} handoff-ready items
                    </p>
                    {evidenceChainSummary.stageGateBlockedGateLabel ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Blocked gate at generation: {evidenceChainSummary.stageGateBlockedGateLabel}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Linked evidence
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {String(sourceContext?.linkedRunCount ?? runs.length)} runs,{" "}
                      {String(sourceContext?.deliverableCount ?? 0)} deliverables,{" "}
                      {String(sourceContext?.decisionCount ?? 0)} decisions
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Source snapshot
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {formatDateTime(
                        typeof sourceContext?.projectUpdatedAt === "string"
                          ? sourceContext.projectUpdatedAt
                          : project?.updated_at ?? null
                      )}
                    </p>
                  </div>
                  {engagementCampaign ? (
                    <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3 sm:col-span-2 xl:col-span-1">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Engagement source
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {engagementCampaign.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {titleize(engagementCampaign.status)} · {titleize(engagementCampaign.engagement_type)} · {String(sourceContext?.engagementReadyForHandoffCount ?? 0)} ready for handoff · {String(sourceContext?.engagementItemCount ?? 0)} items
                      </p>
                      {engagementSummaryText ? (
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {engagementSummaryText}
                        </p>
                      ) : null}
                      {reportOrigin ? (
                        <div className="mt-3 rounded-xl border border-border/60 bg-muted/35 p-3">
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Report origin
                          </p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {titleize(reportOrigin)}
                          </p>
                          {reportReason ? (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {reportReason}
                            </p>
                          ) : null}
                          {engagementSnapshotCapturedAt ||
                          engagementSnapshotReadyForHandoff !== null ||
                          engagementSnapshotTotalItems !== null ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {engagementSnapshotCapturedAt
                                ? `Snapshot captured ${formatDateTime(engagementSnapshotCapturedAt)}`
                                : "Snapshot timing unavailable"}
                              {engagementSnapshotReadyForHandoff !== null
                                ? ` · ${engagementSnapshotReadyForHandoff} ready for handoff`
                                : ""}
                              {engagementSnapshotTotalItems !== null
                                ? ` · ${engagementSnapshotTotalItems} items`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <p className="mt-2 text-xs text-muted-foreground">
                        Updated {formatDateTime(engagementCampaign.updated_at)} · {engagementPublicHref ? "Public page available" : "Public page unavailable"}
                        {engagementCampaign.allow_public_submissions
                          ? engagementCampaign.submissions_closed_at
                            ? " · Submissions closed"
                            : " · Submissions open"
                          : " · Public submissions disabled"}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {driftItems.length > 0 ? (
              <div id="drift-since-generation" className="mt-4 space-y-3">
                <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Drift since generation
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Compact live-vs-snapshot checks for the latest artifact source context.
                  </p>
                </div>
                <div className="grid gap-2">
                  {driftItems.map((item) => {
                    const driftAction = driftActionByKey[item.key] ?? null;

                    return (
                      <div
                        key={item.key}
                        className="flex flex-col gap-2 rounded-[18px] border border-border/80 bg-background/80 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold tracking-tight text-foreground">
                              {item.label}
                            </p>
                            <StatusBadge tone={driftTone(item.status)}>
                              {item.status}
                            </StatusBadge>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {item.detail}
                          </p>
                        </div>
                        {driftAction ? (
                          <Link
                            href={driftAction.href}
                            className="inline-flex items-center gap-1 self-start rounded-full border border-border/70 bg-background px-3 py-1 text-[0.72rem] font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            {driftAction.label}
                          </Link>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {stageGateSnapshot ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Governance and stage-gate provenance
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Compact stage-gate snapshot persisted with this artifact using the active OpenPlan summary.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Template
                        </p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {stageGateSnapshot.templateId}
                        </p>
                      </div>
                      {project ? (
                        <Link
                          href={`/projects/${project.id}#project-governance`}
                          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-[0.72rem] font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Open project settings
                        </Link>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Version {stageGateSnapshot.templateVersion} · {stageGateSnapshot.passCount} pass · {stageGateSnapshot.holdCount} hold · {stageGateSnapshot.notStartedCount} not started
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Control health
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {stageGateSnapshot.controlHealth.totalOperatorControlEvidenceCount} operator control evidence items
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {stageGateSnapshot.controlHealth.gatesWithOperatorControlsCount} gate{stageGateSnapshot.controlHealth.gatesWithOperatorControlsCount === 1 ? "" : "s"} in the active template include operator control evidence.
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Blocked gate
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {stageGateSnapshot.blockedGate
                        ? `${stageGateSnapshot.blockedGate.gateId} · ${stageGateSnapshot.blockedGate.name}`
                        : "No gate on hold"}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {stageGateSnapshot.blockedGate
                        ? `${stageGateSnapshot.blockedGate.rationale}${
                            stageGateSnapshot.blockedGate.missingArtifacts.length > 0
                              ? ` Missing artifacts: ${stageGateSnapshot.blockedGate.missingArtifacts.join(", ")}.`
                              : ""
                          }`
                        : "No formal HOLD decision is recorded in this artifact snapshot."}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Next gate
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {stageGateSnapshot.nextGate
                        ? `${stageGateSnapshot.nextGate.gateId} · ${stageGateSnapshot.nextGate.name}`
                        : "Gate sequence complete"}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {stageGateSnapshot.nextGate
                        ? `${stageGateSnapshot.nextGate.requiredEvidenceCount} required evidence item${
                            stageGateSnapshot.nextGate.requiredEvidenceCount === 1 ? "" : "s"
                          } · ${stageGateSnapshot.nextGate.operatorControlEvidenceCount} operator control profile${
                            stageGateSnapshot.nextGate.operatorControlEvidenceCount === 1 ? "" : "s"
                          }`
                        : "Every gate in the active template currently has a recorded PASS decision."}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
            {projectRecordsSnapshot.length > 0 ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Project records provenance
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Latest attached records persisted with this artifact at generation time.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {projectRecordsSnapshot.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {item.label}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {item.value.count} attached
                          </p>
                        </div>
                        {project ? (
                          <Link
                            href={`/projects/${project.id}#${item.anchor}`}
                            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-[0.72rem] font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            Open {item.label.toLowerCase()}
                          </Link>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {item.value.latestTitle
                          ? `Latest: ${item.value.latestTitle}${
                              item.value.latestAt
                                ? ` · ${formatDateTime(item.value.latestAt)}`
                                : ""
                            }`
                          : "No attached records in this artifact snapshot."}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {scenarioSetLinks.length > 0 ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Scenario basis
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Scenario-set provenance was derived from report-linked runs and persisted with this artifact.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Shared spine totals at generation: {storedScenarioSpineSummary?.assumptionSetCount ?? evidenceChainSummary.scenarioAssumptionSetCount} assumption set{(storedScenarioSpineSummary?.assumptionSetCount ?? evidenceChainSummary.scenarioAssumptionSetCount) === 1 ? "" : "s"} · {storedScenarioSpineSummary?.dataPackageCount ?? evidenceChainSummary.scenarioDataPackageCount} data package{(storedScenarioSpineSummary?.dataPackageCount ?? evidenceChainSummary.scenarioDataPackageCount) === 1 ? "" : "s"} · {storedScenarioSpineSummary?.indicatorSnapshotCount ?? evidenceChainSummary.scenarioIndicatorSnapshotCount} indicator snapshot{(storedScenarioSpineSummary?.indicatorSnapshotCount ?? evidenceChainSummary.scenarioIndicatorSnapshotCount) === 1 ? "" : "s"}
                    {(storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount) > 0
                      ? ` · ${storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount} pending schema-backed set${(storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount) === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>
                <div className="grid gap-3">
                  {scenarioSetLinks.map((link) => (
                    <div
                      key={link.scenarioSetId}
                      className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold tracking-tight text-foreground">
                            {link.scenarioSetTitle}
                          </h3>
                          <p className="mt-1 text-[0.75rem] uppercase tracking-[0.12em] text-muted-foreground">
                            {link.comparisonSummary.label} · {link.matchedEntries.length} matched entr{link.matchedEntries.length === 1 ? "y" : "ies"}
                          </p>
                        </div>
                        <StatusBadge
                          tone={
                            link.comparisonSummary.readyAlternatives > 0
                              ? "success"
                              : link.comparisonSummary.baselineEntryPresent
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {link.comparisonSummary.label}
                        </StatusBadge>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        Baseline:{" "}
                        <span className="font-medium text-foreground">
                          {link.baselineLabel ?? "Not set"}
                        </span>
                        {link.baselineRunTitle ? ` · ${link.baselineRunTitle}` : ""}
                      </p>
                      {link.sharedSpine ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {link.sharedSpine.schemaPending
                            ? "Shared scenario spine schema was still pending when this artifact was generated."
                            : `${link.sharedSpine.assumptionSetCount} assumption set${link.sharedSpine.assumptionSetCount === 1 ? "" : "s"} · ${link.sharedSpine.dataPackageCount} data package${link.sharedSpine.dataPackageCount === 1 ? "" : "s"} · ${link.sharedSpine.indicatorSnapshotCount} indicator snapshot${link.sharedSpine.indicatorSnapshotCount === 1 ? "" : "s"} · ${link.sharedSpine.comparisonSnapshotCount} comparison snapshot${link.sharedSpine.comparisonSnapshotCount === 1 ? "" : "s"}`}
                        </p>
                      ) : null}
                      {(link.scenarioSetUpdatedAt || link.latestMatchedEntryUpdatedAt) ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {link.scenarioSetUpdatedAt
                            ? `Scenario set updated ${formatDateTime(link.scenarioSetUpdatedAt)}`
                            : "Scenario set timing unavailable"}
                          {link.latestMatchedEntryUpdatedAt
                            ? ` · Matched entries updated ${formatDateTime(link.latestMatchedEntryUpdatedAt)}`
                            : ""}
                          {link.sharedSpine?.latestIndicatorSnapshotAt
                            ? ` · Indicators updated ${formatDateTime(link.sharedSpine.latestIndicatorSnapshotAt)}`
                            : ""}
                          {link.sharedSpine?.latestComparisonSnapshotUpdatedAt
                            ? ` · Comparisons updated ${formatDateTime(link.sharedSpine.latestComparisonSnapshotUpdatedAt)}`
                            : ""}
                        </p>
                      ) : null}
                      {link.comparisonSnapshots && link.comparisonSnapshots.length > 0 ? (
                        <div className="mt-3 grid gap-2">
                          {link.comparisonSnapshots.slice(0, 3).map((snapshot) => (
                            <div
                              key={snapshot.comparisonSnapshotId}
                              className="rounded-xl border border-border/70 bg-card px-3 py-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-medium text-foreground">
                                  {snapshot.label}
                                </p>
                                <StatusBadge
                                  tone={
                                    snapshot.status === "ready"
                                      ? "success"
                                      : snapshot.status === "archived"
                                        ? "warning"
                                        : "neutral"
                                  }
                                >
                                  {titleize(snapshot.status)}
                                </StatusBadge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {snapshot.candidateEntryLabel
                                  ? `${snapshot.candidateEntryLabel} vs ${link.baselineLabel ?? "Baseline"}`
                                  : "Saved comparison snapshot"}
                                {snapshot.updatedAt
                                  ? ` · Updated ${formatDateTime(snapshot.updatedAt)}`
                                  : ""}
                                {` · ${snapshot.indicatorDeltaCount} indicator delta${snapshot.indicatorDeltaCount === 1 ? "" : "s"}`}
                              </p>
                              {snapshot.summary ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {snapshot.summary}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href={`/scenarios/${link.scenarioSetId}`}
                          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-[0.72rem] font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Open scenario set
                        </Link>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {link.matchedEntries.map((entry) => (
                          <div
                            key={entry.entryId}
                            className="rounded-xl border border-border/70 bg-card px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium text-foreground">
                                {entry.label}
                              </p>
                              <StatusBadge
                                tone={entry.comparisonReady ? "success" : "warning"}
                              >
                                {entry.comparisonLabel}
                              </StatusBadge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {titleize(entry.entryType)}
                              {entry.attachedRunTitle
                                ? ` · ${entry.attachedRunTitle}`
                                : " · Run unavailable"}
                              {entry.runCreatedAt
                                ? ` · Run ${formatDateTime(entry.runCreatedAt)}`
                                : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </article>

          {/* Related links */}
          <article className="module-section-surface">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-500/10 text-slate-700 dark:text-slate-300">
                <Link2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Navigation
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Related surfaces
                </h2>
              </div>
            </div>
            <MetaList className="mt-4">
              {project ? (
                <MetaItem>
                  <Link href={`/projects/${project.id}`} className="inline-flex items-center gap-2 transition hover:text-primary">
                    <FileOutput className="h-4 w-4" />
                    Open project
                  </Link>
                </MetaItem>
              ) : null}
              {project ? (
                <MetaItem>
                  <Link href={`/grants?focusProjectId=${project.id}#grants-awards-reimbursement`} className="inline-flex items-center gap-2 transition hover:text-primary">
                    <Link2 className="h-4 w-4" />
                    Open grants lane for this project
                  </Link>
                </MetaItem>
              ) : null}
              {engagementCampaign ? (
                <MetaItem>
                  <Link href={`/engagement/${engagementCampaign.id}`} className="inline-flex items-center gap-2 transition hover:text-primary">
                    <Link2 className="h-4 w-4" />
                    Open engagement campaign
                  </Link>
                </MetaItem>
              ) : null}
              {engagementPublicHref ? (
                <MetaItem>
                  <Link href={engagementPublicHref} className="inline-flex items-center gap-2 transition hover:text-primary">
                    <Link2 className="h-4 w-4" />
                    Open public engagement page
                  </Link>
                </MetaItem>
              ) : null}
              <MetaItem>
                <Link href="/reports" className="inline-flex items-center gap-2 transition hover:text-primary">
                  <ScrollText className="h-4 w-4" />
                  Back to catalog
                </Link>
              </MetaItem>
            </MetaList>
          </article>

          {/* HTML preview */}
          {latestHtml ? (
            <article className="module-section-surface">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Preview
                  </p>
                  <h2 className="text-xl font-semibold tracking-tight">
                    Latest HTML artifact
                  </h2>
                </div>
                {latestArtifact ? (
                  <StatusBadge tone="info">
                    {formatDateTime(latestArtifact.generated_at)}
                  </StatusBadge>
                ) : null}
              </div>
              <div className="mt-5 overflow-hidden rounded-[18px] border border-border/70 bg-white shadow-inner">
                <iframe
                  title="Latest report artifact preview"
                  className="h-[900px] w-full"
                  sandbox=""
                  srcDoc={latestHtml}
                />
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}
