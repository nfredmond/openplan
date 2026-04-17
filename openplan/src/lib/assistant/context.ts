/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { buildModelWorkspaceSummary } from "@/lib/models/catalog";
import { extractModelLaunchTemplate } from "@/lib/models/run-launch";
import {
  buildPlanArtifactCoverage,
  buildPlanReadiness,
  buildPlanWorkflowSummary,
} from "@/lib/plans/catalog";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";
import {
  buildProgramReadiness,
  buildProgramWorkflowSummary,
} from "@/lib/programs/catalog";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  RTP_CHAPTER_TEMPLATES,
} from "@/lib/rtp/catalog";
import { compareRtpPacketPostureForCycle } from "@/lib/assistant/rtp-packet-posture";
import {
  describeComparisonSnapshotAggregate,
  getReportPacketFreshness,
  parseStoredComparisonSnapshotAggregate,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import {
  buildScenarioComparisonBoard,
} from "@/lib/scenarios/comparison-board";
import {
  buildScenarioComparisonSummary,
  buildScenarioLinkedReports,
} from "@/lib/scenarios/catalog";
import { extractEngagementCampaignId } from "@/lib/reports/engagement";
import { CURRENT_WORKSPACE_MEMBERSHIP_SELECT, loadCurrentWorkspaceMembership, unwrapWorkspaceRecord } from "@/lib/workspaces/current";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSummary,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import type { AssistantTarget, AssistantTargetKind } from "@/lib/assistant/catalog";

export type WorkspaceAssistantContext = {
  kind: "workspace" | "analysis_studio";
  workspace: {
    id: string | null;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  recentProject: {
    id: string;
    name: string;
    status: string;
    planType: string;
    deliveryPhase: string;
    updatedAt: string;
  } | null;
  recentRuns: Array<{
    id: string;
    title: string;
    createdAt: string;
  }>;
  currentRun: RunAssistantContext["run"] | null;
  baselineRun: RunAssistantContext["baselineRun"];
  operationsSummary: WorkspaceOperationsSummary;
};

export type ProjectAssistantContext = {
  kind: "project";
  workspace: {
    id: string;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  project: {
    id: string;
    name: string;
    summary: string | null;
    status: string;
    planType: string;
    deliveryPhase: string;
    updatedAt: string;
  };
  counts: {
    deliverables: number;
    risks: number;
    issues: number;
    decisions: number;
    meetings: number;
    linkedDatasets: number;
    overlayReadyDatasets: number;
    recentRuns: number;
  };
  fundingSummary: {
    opportunityCount: number;
    openCount: number;
    closingSoonCount: number;
    overdueDecisionCount: number;
    pursueCount: number;
    awardCount: number;
    awardRecordCount: number;
    fundingNeedAmount: number | null;
    gapAmount: number | null;
    requestedReimbursementAmount: number | null;
    uninvoicedAwardAmount: number | null;
    reimbursementStatus: string | null;
    reimbursementPacketCount: number;
    exactInvoiceAwardRelink: {
      invoiceId: string;
      fundingAwardId: string;
    } | null;
    leadOpportunity: {
      id: string;
      title: string;
      status: string | null;
      decisionState: string | null;
      closesAt: string | null;
      decisionDueAt: string | null;
    } | null;
    leadOverdueOpportunity: {
      id: string;
      title: string;
      status: string | null;
      decisionState: string | null;
      closesAt: string | null;
      decisionDueAt: string | null;
    } | null;
    leadClosingOpportunity: {
      id: string;
      title: string;
      status: string | null;
      decisionState: string | null;
      closesAt: string | null;
      decisionDueAt: string | null;
    } | null;
    leadAwardOpportunity: {
      id: string;
      title: string;
      status: string | null;
      decisionState: string | null;
      closesAt: string | null;
      decisionDueAt: string | null;
    } | null;
  };
  stageGateSummary: ReturnType<typeof buildProjectStageGateSummary>;
  linkedDatasets: Array<{
    datasetId: string;
    name: string;
    status: string;
    relationshipType: string;
    geographyScope: string;
    geometryAttachment: string;
    thematicMetricLabel: string | null;
    connectorLabel: string | null;
    overlayReady: boolean;
    thematicReady: boolean;
  }>;
  recentRuns: Array<{
    id: string;
    title: string;
    createdAt: string;
    summaryText: string | null;
  }>;
  reportSummary: {
    linkedReportCount: number;
    evidenceBackedCount: number;
    comparisonBackedCount: number;
    noPacketCount: number;
    refreshRecommendedCount: number;
    recommendedReport: {
      id: string;
      title: string | null;
      packetFreshness: ReturnType<typeof getReportPacketFreshness>;
      comparisonDigest: ReturnType<typeof describeComparisonSnapshotAggregate>;
    } | null;
  };
};

export type RtpRegistryAssistantContext = {
  kind: "rtp_registry";
  workspace: {
    id: string;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  counts: {
    cycles: number;
    draftCycles: number;
    publicReviewCycles: number;
    adoptedCycles: number;
    archivedCycles: number;
    packetReports: number;
    noPacketCount: number;
    refreshRecommendedCount: number;
  };
  recommendedCycle: {
    id: string;
    title: string;
    status: string;
    packetFreshnessLabel: string;
    packetReportCount: number;
    updatedAt: string;
  } | null;
  operationsSummary: WorkspaceOperationsSummary;
};

export type PlanAssistantContext = {
  kind: "plan";
  workspace: {
    id: string;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  project: {
    id: string;
    name: string;
  } | null;
  plan: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    planType: string;
    geographyLabel: string | null;
    horizonYear: number | null;
    updatedAt: string;
  };
  readiness: ReturnType<typeof buildPlanReadiness>;
  artifactCoverage: ReturnType<typeof buildPlanArtifactCoverage>;
  workflow: ReturnType<typeof buildPlanWorkflowSummary>;
  linkageCounts: {
    scenarios: number;
    engagementCampaigns: number;
    reports: number;
    relatedProjects: number;
  };
  operationsSummary: WorkspaceOperationsSummary;
};

export type RtpAssistantContext = {
  kind: "rtp_cycle";
  workspace: {
    id: string;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  rtpCycle: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    geographyLabel: string | null;
    horizonStartYear: number | null;
    horizonEndYear: number | null;
    adoptionTargetDate: string | null;
    publicReviewOpenAt: string | null;
    publicReviewCloseAt: string | null;
    updatedAt: string;
  };
  readiness: ReturnType<typeof buildRtpCycleReadiness>;
  workflow: ReturnType<typeof buildRtpCycleWorkflowSummary>;
  counts: {
    chapters: number;
    readyForReviewChapters: number;
    completeChapters: number;
    linkedProjects: number;
    engagementCampaigns: number;
    packetReports: number;
  };
  packetSummary: {
    linkedReportCount: number;
    noPacketCount: number;
    refreshRecommendedCount: number;
    recommendedReport: {
      id: string;
      title: string | null;
      packetFreshness: ReturnType<typeof getReportPacketFreshness>;
    } | null;
  };
  operationsSummary: WorkspaceOperationsSummary;
};

export type ProgramAssistantContext = {
  kind: "program";
  workspace: {
    id: string;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  project: {
    id: string;
    name: string;
  } | null;
  program: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    programType: string;
    cycleName: string;
    sponsorAgency: string | null;
    updatedAt: string;
  };
  readiness: ReturnType<typeof buildProgramReadiness>;
  workflow: ReturnType<typeof buildProgramWorkflowSummary>;
  linkageCounts: {
    plans: number;
    reports: number;
    engagementCampaigns: number;
    relatedProjects: number;
  };
  fundingSummary: {
    opportunityCount: number;
    openCount: number;
    closingSoonCount: number;
    overdueDecisionCount: number;
    pursueCount: number;
    awardCount: number;
    awardRecordCount: number;
    fundingNeedAmount: number | null;
    gapAmount: number | null;
    requestedReimbursementAmount: number | null;
    uninvoicedAwardAmount: number | null;
    reimbursementStatus: string | null;
    reimbursementPacketCount: number;
    exactInvoiceAwardRelink: {
      invoiceId: string;
      fundingAwardId: string;
    } | null;
    leadOpportunity: {
      id: string;
      title: string;
      status: string | null;
      decisionState: string | null;
      closesAt: string | null;
      decisionDueAt: string | null;
    } | null;
    leadOverdueOpportunity: {
      id: string;
      title: string;
      status: string | null;
      decisionState: string | null;
      closesAt: string | null;
      decisionDueAt: string | null;
    } | null;
    leadClosingOpportunity: {
      id: string;
      title: string;
      status: string | null;
      decisionState: string | null;
      closesAt: string | null;
      decisionDueAt: string | null;
    } | null;
    leadAwardOpportunity: {
      id: string;
      title: string;
      status: string | null;
      decisionState: string | null;
      closesAt: string | null;
      decisionDueAt: string | null;
    } | null;
  };
  packetSummary: {
    linkedReportCount: number;
    attentionCount: number;
    noPacketCount: number;
    refreshRecommendedCount: number;
    recommendedReport: {
      id: string;
      title: string | null;
      packetFreshness: ReturnType<typeof getReportPacketFreshness>;
    } | null;
  };
  operationsSummary: WorkspaceOperationsSummary;
};

export type ScenarioAssistantContext = {
  kind: "scenario_set";
  workspace: {
    id: string;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  project: {
    id: string;
    name: string;
    summary: string | null;
  } | null;
  scenarioSet: {
    id: string;
    title: string;
    summary: string | null;
    planningQuestion: string | null;
    status: string;
  };
  baselineEntry: {
    id: string;
    label: string;
    attachedRunId: string | null;
  } | null;
  alternativeCount: number;
  comparisonSummary: ReturnType<typeof buildScenarioComparisonSummary>;
  comparisonBoard: ReturnType<typeof buildScenarioComparisonBoard>;
  linkedReports: ReturnType<typeof buildScenarioLinkedReports>["linkedReports"];
};

export type ModelAssistantContext = {
  kind: "model";
  workspace: {
    id: string;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  model: {
    id: string;
    title: string;
    status: string;
    modelFamily: string;
    summary: string | null;
    projectId: string | null;
    scenarioSetId: string | null;
  };
  readiness: ReturnType<typeof buildModelWorkspaceSummary>["readiness"];
  workflow: ReturnType<typeof buildModelWorkspaceSummary>["workflow"];
  linkageCounts: ReturnType<typeof buildModelWorkspaceSummary>["linkageCounts"];
  launchTemplate: ReturnType<typeof extractModelLaunchTemplate>;
  scenarioEntryOptions: Array<{
    id: string;
    label: string;
    entryType: string;
    status: string;
    assumptionCount: number;
  }>;
  recentModelRuns: Array<{
    id: string;
    status: string;
    runTitle: string;
    createdAt: string | null;
    completedAt: string | null;
  }>;
  schemaPending: boolean;
};

export type ReportAssistantContext = {
  kind: "report" | "rtp_packet_report";
  workspace: {
    id: string;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  report: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    reportType: string;
    rtpCycleId: string | null;
    generatedAt: string | null;
    latestArtifactKind: string | null;
    updatedAt: string;
  };
  project: {
    id: string;
    name: string;
    summary: string | null;
    updatedAt: string | null;
  } | null;
  sectionCount: number;
  enabledSections: number;
  runs: Array<{
    id: string;
    title: string;
    summaryText: string | null;
    createdAt: string;
  }>;
  artifactCount: number;
  latestArtifact: {
    id: string;
    artifactKind: string;
    generatedAt: string;
  } | null;
  runAudit: Array<{
    runId: string;
    gate: { decision: string; missingArtifacts: string[] };
  }>;
  sourceContext: Record<string, unknown> | null;
  engagementCampaign: {
    id: string;
    title: string;
    status: string;
  } | null;
  rtpCycle: {
    id: string;
    title: string;
    status: string;
    updatedAt: string;
  } | null;
};

export type RunAssistantContext = {
  kind: "run";
  workspace: {
    id: string;
    name: string | null;
    plan: string | null;
    role: string | null;
  };
  run: {
    id: string;
    title: string;
    summary: string | null;
    createdAt: string;
    queryText: string | null;
    metrics: Record<string, unknown>;
  };
  baselineRun: {
    id: string;
    title: string;
    createdAt: string;
    metrics: Record<string, unknown>;
  } | null;
};

export type AssistantContext =
  | WorkspaceAssistantContext
  | ProjectAssistantContext
  | RtpRegistryAssistantContext
  | RtpAssistantContext
  | PlanAssistantContext
  | ProgramAssistantContext
  | ScenarioAssistantContext
  | ModelAssistantContext
  | ReportAssistantContext
  | RunAssistantContext;

type SupabaseLike = {
  from: (table: string) => any;
};

function daysUntil(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed - now.getTime()) / 86400000);
}

function buildLatestArtifactGeneratedAtByReportId(
  rows: Array<{ report_id: string; generated_at: string | null }>
): Map<string, string | null> {
  const latestByReportId = new Map<string, string | null>();

  for (const row of rows) {
    const current = latestByReportId.get(row.report_id);
    const rowTime = row.generated_at ? new Date(row.generated_at).getTime() : Number.NEGATIVE_INFINITY;
    const currentTime = current ? new Date(current).getTime() : Number.NEGATIVE_INFINITY;
    if (!latestByReportId.has(row.report_id) || rowTime > currentTime) {
      latestByReportId.set(row.report_id, row.generated_at);
    }
  }

  return latestByReportId;
}

function resolveExactInvoiceAwardRelink(
  fundingAwards: Array<{ id: string }>,
  fundingInvoices: Array<{ id: string; funding_award_id: string | null; status: string | null }>
): { invoiceId: string; fundingAwardId: string } | null {
  const unlinkedInvoices = fundingInvoices.filter(
    (invoice) => !invoice.funding_award_id && !["paid", "rejected"].includes(invoice.status ?? "draft")
  );

  if (fundingAwards.length !== 1 || unlinkedInvoices.length !== 1) {
    return null;
  }

  return {
    invoiceId: unlinkedInvoices[0].id,
    fundingAwardId: fundingAwards[0].id,
  };
}

type WorkspaceEnvelope = {
  id: string;
  name: string | null;
  plan: string | null;
  role: string | null;
};

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

async function requireWorkspaceEnvelope(
  supabase: SupabaseLike,
  userId: string,
  workspaceId?: string | null
): Promise<WorkspaceEnvelope | null> {
  if (!workspaceId) {
    const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, userId);

    if (!membership) {
      return null;
    }

    return {
      id: membership.workspace_id,
      name: workspace?.name ?? null,
      plan: workspace?.plan ?? null,
      role: membership.role ?? null,
    };
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return null;
  }

  const workspace = unwrapWorkspaceRecord(membership.workspaces);
  return {
    id: membership.workspace_id,
    name: workspace?.name ?? null,
    plan: workspace?.plan ?? null,
    role: membership.role ?? null,
  };
}

function isOverlayReady(dataset: {
  status: string;
  geography_scope: string;
}): boolean {
  return (
    dataset.status === "ready" &&
    ["point", "route", "corridor", "tract", "county", "region", "statewide", "national"].includes(dataset.geography_scope)
  );
}

function isThematicReady(dataset: {
  status: string;
  geography_scope: string;
  geometry_attachment: string;
  thematic_metric_key: string | null;
}): boolean {
  return Boolean(
    dataset.status === "ready" &&
      dataset.thematic_metric_key &&
      ((dataset.geography_scope === "tract" && dataset.geometry_attachment === "analysis_tracts") ||
        ((dataset.geography_scope === "corridor" || dataset.geography_scope === "route") &&
          dataset.geometry_attachment === "analysis_corridor") ||
        (dataset.geography_scope === "point" && dataset.geometry_attachment === "analysis_crash_points"))
  );
}

function asRunAudit(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || !Array.isArray(metadata.runAudit)) {
    return [] as Array<{
      runId: string;
      gate: { decision: string; missingArtifacts: string[] };
    }>;
  }

  return metadata.runAudit.filter(
    (
      item
    ): item is {
      runId: string;
      gate: { decision: string; missingArtifacts: string[] };
    } => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      const gate = record.gate;
      return typeof record.runId === "string" && Boolean(gate) && typeof gate === "object";
    }
  );
}

function asSourceContext(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return null;
  const sourceContext = metadata.sourceContext;
  return sourceContext && typeof sourceContext === "object" ? (sourceContext as Record<string, unknown>) : null;
}

async function loadWorkspaceContext(
  supabase: SupabaseLike,
  userId: string,
  target: AssistantTarget
): Promise<WorkspaceAssistantContext | null> {
  const workspace = await requireWorkspaceEnvelope(supabase, userId, target.workspaceId);
  if (!workspace?.id) {
    return null;
  }

  const [projectsResult, runDataResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, plan_type, delivery_phase, updated_at")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("runs")
      .select("id, title, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const projectData = (projectsResult.data ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    plan_type: string;
    delivery_phase: string;
    updated_at: string;
  }>;
  const runData = runDataResult.data ?? [];

  const runIds = [target.runId, target.baselineRunId].filter((value): value is string => Boolean(value));
  const { data: runDetails } = runIds.length
    ? await supabase
        .from("runs")
        .select("id, title, summary_text, created_at, query_text, metrics")
        .eq("workspace_id", workspace.id)
        .in("id", runIds)
    : { data: [] };

  const typedRunDetails = (runDetails ?? []) as Array<{
    id: string;
    title: string;
    summary_text: string | null;
    created_at: string;
    query_text: string | null;
    metrics: Record<string, unknown> | null;
  }>;
  const runMap = new Map(typedRunDetails.map((run) => [run.id, run]));
  const currentRunRecord = target.runId ? runMap.get(target.runId) ?? null : null;
  const baselineRunRecord = target.baselineRunId ? runMap.get(target.baselineRunId) ?? null : null;
  const currentRun = currentRunRecord
    ? {
        id: currentRunRecord.id,
        title: currentRunRecord.title,
        summary: currentRunRecord.summary_text ?? null,
        createdAt: currentRunRecord.created_at,
        queryText: currentRunRecord.query_text ?? null,
        metrics:
          currentRunRecord.metrics && typeof currentRunRecord.metrics === "object"
            ? currentRunRecord.metrics
            : {},
      }
    : null;
  const baselineRun = baselineRunRecord
    ? {
        id: baselineRunRecord.id,
        title: baselineRunRecord.title,
        createdAt: baselineRunRecord.created_at,
        metrics:
          baselineRunRecord.metrics && typeof baselineRunRecord.metrics === "object"
            ? baselineRunRecord.metrics
            : {},
      }
    : null;

  return {
    kind: target.kind === "analysis_studio" ? "analysis_studio" : "workspace",
    workspace,
    recentProject: projectData[0]
      ? {
          id: projectData[0].id,
          name: projectData[0].name,
          status: projectData[0].status,
          planType: projectData[0].plan_type,
          deliveryPhase: projectData[0].delivery_phase,
          updatedAt: projectData[0].updated_at,
        }
      : null,
    recentRuns: runData.map((run: any) => ({
      id: run.id,
      title: run.title,
      createdAt: run.created_at,
    })),
    currentRun,
    baselineRun,
    operationsSummary: await loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      workspace.id
    ),
  };
}

async function loadProjectContext(
  supabase: SupabaseLike,
  userId: string,
  projectId: string
): Promise<ProjectAssistantContext | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, project.workspace_id);
  if (!workspace) {
    return null;
  }

  const [
    deliverablesResult,
    risksResult,
    issuesResult,
    decisionsResult,
    meetingsResult,
    stageGatesResult,
    runsResult,
    datasetLinksResult,
    projectFundingProfileResult,
    fundingOpportunitiesResult,
    fundingAwardsResult,
    fundingInvoicesResult,
    reimbursementSubmittalsResult,
    projectReportsResult,
  ] = await Promise.all([
    supabase.from("project_deliverables").select("id").eq("project_id", project.id),
    supabase.from("project_risks").select("id, status, severity").eq("project_id", project.id),
    supabase.from("project_issues").select("id, status, severity").eq("project_id", project.id),
    supabase.from("project_decisions").select("id").eq("project_id", project.id),
    supabase.from("project_meetings").select("id").eq("project_id", project.id),
    supabase
      .from("stage_gate_decisions")
      .select("id, gate_id, decision, rationale, decided_at, missing_artifacts")
      .eq("workspace_id", project.workspace_id)
      .order("decided_at", { ascending: false })
      .limit(200),
    supabase
      .from("runs")
      .select("id, title, created_at, summary_text")
      .eq("workspace_id", project.workspace_id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("data_dataset_project_links")
      .select("dataset_id, relationship_type, linked_at")
      .eq("project_id", project.id)
      .order("linked_at", { ascending: false }),
    supabase
      .from("project_funding_profiles")
      .select("funding_need_amount, local_match_need_amount")
      .eq("project_id", project.id)
      .maybeSingle(),
    supabase
      .from("funding_opportunities")
      .select("id, title, opportunity_status, decision_state, expected_award_amount, closes_at, decision_due_at, updated_at")
      .eq("project_id", project.id),
    supabase
      .from("funding_awards")
      .select("id, funding_opportunity_id, awarded_amount, match_amount, risk_flag, obligation_due_at")
      .eq("project_id", project.id),
    supabase
      .from("billing_invoice_records")
      .select("id, funding_award_id, status, amount, retention_percent, retention_amount, due_date")
      .eq("project_id", project.id),
    supabase.from("project_submittals").select("id").eq("project_id", project.id).eq("submittal_type", "reimbursement"),
    supabase
      .from("reports")
      .select("id, title, status, generated_at, latest_artifact_kind, updated_at, metadata_json")
      .eq("project_id", project.id)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  const datasetLinkRows = looksLikePendingSchema(datasetLinksResult.error?.message)
    ? []
    : ((datasetLinksResult.data ?? []) as Array<{
        dataset_id: string;
        relationship_type: string;
        linked_at: string;
      }>);
  const projectFundingProfile = looksLikePendingSchema(projectFundingProfileResult.error?.message)
    ? null
    : ((projectFundingProfileResult.data ?? null) as {
        funding_need_amount: number | null;
        local_match_need_amount?: number | null;
      } | null);
  const fundingOpportunities = looksLikePendingSchema(fundingOpportunitiesResult.error?.message)
    ? []
    : ((fundingOpportunitiesResult.data ?? []) as Array<{
        id: string;
        title: string;
        opportunity_status: string | null;
        decision_state: string | null;
        expected_award_amount?: number | null;
        closes_at: string | null;
        decision_due_at: string | null;
        updated_at: string | null;
      }>);
  const fundingAwards = looksLikePendingSchema(fundingAwardsResult.error?.message)
    ? []
    : ((fundingAwardsResult.data ?? []) as Array<{
        id: string;
        funding_opportunity_id: string | null;
        awarded_amount: number | null;
        match_amount: number | null;
        risk_flag: string | null;
        obligation_due_at: string | null;
      }>);
  const fundingInvoices = looksLikePendingSchema(fundingInvoicesResult.error?.message)
    ? []
    : ((fundingInvoicesResult.data ?? []) as Array<{
        id: string;
        funding_award_id: string | null;
        status: string | null;
        amount: number | null;
        retention_percent: number | null;
        retention_amount: number | null;
        due_date: string | null;
      }>);
  const exactInvoiceAwardRelink = resolveExactInvoiceAwardRelink(fundingAwards, fundingInvoices);
  const fundingAwardOpportunityIds = new Set(
    fundingAwards.map((award) => award.funding_opportunity_id).filter((value): value is string => Boolean(value))
  );
  const fundingStackSummary = buildProjectFundingStackSummary(projectFundingProfile, fundingAwards, fundingOpportunities, fundingInvoices);
  const actionableFundingOpportunities = fundingOpportunities.filter(
    (opportunity) => !["awarded", "archived"].includes(opportunity.opportunity_status ?? "")
  );
  const leadFundingOpportunity = [...actionableFundingOpportunities].sort((left, right) => {
    const leftDecisionPriority = left.decision_state === "skip" ? 2 : left.decision_state === "pursue" ? 1 : 0;
    const rightDecisionPriority = right.decision_state === "skip" ? 2 : right.decision_state === "pursue" ? 1 : 0;
    if (leftDecisionPriority !== rightDecisionPriority) return leftDecisionPriority - rightDecisionPriority;
    const leftStatusPriority = left.opportunity_status === "open" ? 0 : left.opportunity_status === "upcoming" ? 1 : 2;
    const rightStatusPriority = right.opportunity_status === "open" ? 0 : right.opportunity_status === "upcoming" ? 1 : 2;
    if (leftStatusPriority !== rightStatusPriority) return leftStatusPriority - rightStatusPriority;
    const leftDueAt = left.closes_at ?? left.decision_due_at;
    const rightDueAt = right.closes_at ?? right.decision_due_at;
    if (leftDueAt && rightDueAt) {
      const dueDelta = new Date(leftDueAt).getTime() - new Date(rightDueAt).getTime();
      if (dueDelta !== 0) return dueDelta;
    }
    return new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime();
  })[0] ?? null;
  const leadAwardOpportunity = [...fundingOpportunities]
    .filter(
      (opportunity) =>
        opportunity.opportunity_status === "awarded" && !fundingAwardOpportunityIds.has(opportunity.id)
    )
    .sort((left, right) => new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime())[0] ?? null;
  const overdueMonitoredFundingOpportunities = fundingOpportunities.filter((opportunity) => {
    if (!["open", "upcoming"].includes(opportunity.opportunity_status ?? "")) return false;
    if ((opportunity.decision_state ?? "") !== "monitor") return false;
    const days = daysUntil(opportunity.decision_due_at);
    return days !== null && days < 0;
  });
  const leadOverdueFundingOpportunity = [...overdueMonitoredFundingOpportunities].sort((left, right) => {
    const leftDue = left.decision_due_at ? new Date(left.decision_due_at).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.decision_due_at ? new Date(right.decision_due_at).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime();
  })[0] ?? null;
  const closingSoonFundingOpportunities = fundingOpportunities.filter((opportunity) => {
    if ((opportunity.opportunity_status ?? "") !== "open") return false;
    const days = daysUntil(opportunity.closes_at ?? opportunity.decision_due_at);
    return days !== null && days <= 14;
  });
  const leadClosingFundingOpportunity = [...closingSoonFundingOpportunities].sort((left, right) => {
    const leftDueRaw = left.closes_at ?? left.decision_due_at;
    const rightDueRaw = right.closes_at ?? right.decision_due_at;
    const leftDue = leftDueRaw ? new Date(leftDueRaw).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = rightDueRaw ? new Date(rightDueRaw).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime();
  })[0] ?? null;

  const linkedDatasetIds = datasetLinkRows.map((item) => item.dataset_id);
  const datasetsResult = linkedDatasetIds.length
    ? await supabase
        .from("data_datasets")
        .select(
          "id, connector_id, name, status, geography_scope, geometry_attachment, thematic_metric_key, thematic_metric_label"
        )
        .in("id", linkedDatasetIds)
    : { data: [] };

  const datasetRows = looksLikePendingSchema(datasetsResult.error?.message)
    ? []
    : ((datasetsResult.data ?? []) as Array<{
        id: string;
        connector_id: string | null;
        name: string;
        status: string;
        geography_scope: string;
        geometry_attachment: string;
        thematic_metric_key: string | null;
        thematic_metric_label: string | null;
      }>);

  const connectorIds = datasetRows.map((dataset) => dataset.connector_id).filter((value): value is string => Boolean(value));
  const connectorsResult = connectorIds.length
    ? await supabase.from("data_connectors").select("id, display_name").in("id", connectorIds)
    : { data: [] };

  const connectorMap = new Map(
    (looksLikePendingSchema(connectorsResult.error?.message)
      ? []
      : ((connectorsResult.data ?? []) as Array<{ id: string; display_name: string }>)).map((connector) => [
      connector.id,
      connector.display_name,
    ])
  );
  const datasetMap = new Map(datasetRows.map((dataset) => [dataset.id, dataset]));
  const linkedDatasets = datasetLinkRows
    .map((link) => {
      const dataset = datasetMap.get(link.dataset_id);
      if (!dataset) return null;
      return {
        datasetId: dataset.id,
        name: dataset.name,
        status: dataset.status,
        relationshipType: link.relationship_type,
        geographyScope: dataset.geography_scope,
        geometryAttachment: dataset.geometry_attachment,
        thematicMetricLabel: dataset.thematic_metric_label,
        connectorLabel: dataset.connector_id ? connectorMap.get(dataset.connector_id) ?? null : null,
        overlayReady: isOverlayReady(dataset),
        thematicReady: isThematicReady(dataset),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const projectReports = looksLikePendingSchema(projectReportsResult.error?.message)
    ? []
    : ((projectReportsResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        status: string | null;
        generated_at: string | null;
        latest_artifact_kind: string | null;
        updated_at: string | null;
        metadata_json: Record<string, unknown> | null;
      }>);
  const reportArtifactsResult = projectReports.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in(
          "report_id",
          projectReports.map((report) => report.id)
        )
        .order("generated_at", { ascending: false })
        .limit(Math.max(projectReports.length * 4, projectReports.length))
    : { data: [], error: null };
  const latestArtifactByReportId = new Map<
    string,
    { generated_at: string | null; metadata_json: Record<string, unknown> | null }
  >();

  for (const artifact of ((reportArtifactsResult.data ?? []) as Array<{
    report_id: string;
    generated_at: string | null;
    metadata_json: Record<string, unknown> | null;
  }>)) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, {
        generated_at: artifact.generated_at,
        metadata_json: artifact.metadata_json ?? null,
      });
    }
  }

  const linkedReports = projectReports
    .map((report) => {
      const latestArtifact = latestArtifactByReportId.get(report.id);
      const metadata = latestArtifact?.metadata_json ?? report.metadata_json;
      const comparisonAggregate = parseStoredComparisonSnapshotAggregate(metadata);

      return {
        id: report.id,
        title: report.title,
        status: report.status,
        updatedAt: report.updated_at,
        hasEvidence: Boolean(asSourceContext(metadata)),
        comparisonDigest: describeComparisonSnapshotAggregate(comparisonAggregate),
        comparisonSnapshotCount: comparisonAggregate?.comparisonSnapshotCount ?? 0,
        packetFreshness: getReportPacketFreshness({
          latestArtifactKind: report.latest_artifact_kind,
          generatedAt: latestArtifact?.generated_at ?? report.generated_at,
          updatedAt: report.updated_at,
        }),
      };
    })
    .sort((left, right) => {
      const postureDelta = compareRtpPacketPostureForCycle(left.packetFreshness.label, right.packetFreshness.label);
      if (postureDelta !== 0) return postureDelta;
      if (left.comparisonSnapshotCount !== right.comparisonSnapshotCount) {
        return right.comparisonSnapshotCount - left.comparisonSnapshotCount;
      }
      return new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime();
    });

  return {
    kind: "project",
    workspace,
    project: {
      id: project.id,
      name: project.name,
      summary: project.summary,
      status: project.status,
      planType: project.plan_type,
      deliveryPhase: project.delivery_phase,
      updatedAt: project.updated_at,
    },
    counts: {
      deliverables: deliverablesResult.data?.length ?? 0,
      risks: risksResult.data?.length ?? 0,
      issues: issuesResult.data?.length ?? 0,
      decisions: decisionsResult.data?.length ?? 0,
      meetings: meetingsResult.data?.length ?? 0,
      linkedDatasets: linkedDatasets.length,
      overlayReadyDatasets: linkedDatasets.filter((dataset) => dataset.overlayReady).length,
      recentRuns: runsResult.data?.length ?? 0,
    },
    fundingSummary: {
      opportunityCount: fundingOpportunities.length,
      openCount: fundingOpportunities.filter((opportunity) => ["open", "upcoming"].includes(opportunity.opportunity_status ?? "")).length,
      closingSoonCount: fundingOpportunities.filter((opportunity) => {
        if ((opportunity.opportunity_status ?? "") !== "open") return false;
        const days = daysUntil(opportunity.closes_at ?? opportunity.decision_due_at);
        return days !== null && days <= 14;
      }).length,
      overdueDecisionCount: overdueMonitoredFundingOpportunities.length,
      pursueCount: actionableFundingOpportunities.filter((opportunity) => opportunity.decision_state === "pursue").length,
      awardCount: fundingAwards.length,
      awardRecordCount: fundingOpportunities.filter(
        (opportunity) => opportunity.opportunity_status === "awarded" && !fundingAwardOpportunityIds.has(opportunity.id)
      ).length,
      fundingNeedAmount: projectFundingProfile?.funding_need_amount ?? null,
      gapAmount: fundingStackSummary.hasTargetNeed ? fundingStackSummary.unfundedAfterLikelyAmount : null,
      requestedReimbursementAmount: fundingAwards.length > 0 ? fundingStackSummary.requestedReimbursementAmount : null,
      uninvoicedAwardAmount: fundingAwards.length > 0 ? fundingStackSummary.uninvoicedAwardAmount : null,
      reimbursementStatus: fundingAwards.length > 0 ? fundingStackSummary.reimbursementStatus : null,
      reimbursementPacketCount: reimbursementSubmittalsResult.data?.length ?? 0,
      exactInvoiceAwardRelink,
      leadOpportunity: leadFundingOpportunity
        ? {
            id: leadFundingOpportunity.id,
            title: leadFundingOpportunity.title,
            status: leadFundingOpportunity.opportunity_status,
            decisionState: leadFundingOpportunity.decision_state,
            closesAt: leadFundingOpportunity.closes_at,
            decisionDueAt: leadFundingOpportunity.decision_due_at,
          }
        : null,
      leadOverdueOpportunity: leadOverdueFundingOpportunity
        ? {
            id: leadOverdueFundingOpportunity.id,
            title: leadOverdueFundingOpportunity.title,
            status: leadOverdueFundingOpportunity.opportunity_status,
            decisionState: leadOverdueFundingOpportunity.decision_state,
            closesAt: leadOverdueFundingOpportunity.closes_at,
            decisionDueAt: leadOverdueFundingOpportunity.decision_due_at,
          }
        : null,
      leadClosingOpportunity: leadClosingFundingOpportunity
        ? {
            id: leadClosingFundingOpportunity.id,
            title: leadClosingFundingOpportunity.title,
            status: leadClosingFundingOpportunity.opportunity_status,
            decisionState: leadClosingFundingOpportunity.decision_state,
            closesAt: leadClosingFundingOpportunity.closes_at,
            decisionDueAt: leadClosingFundingOpportunity.decision_due_at,
          }
        : null,
      leadAwardOpportunity: leadAwardOpportunity
        ? {
            id: leadAwardOpportunity.id,
            title: leadAwardOpportunity.title,
            status: leadAwardOpportunity.opportunity_status,
            decisionState: leadAwardOpportunity.decision_state,
            closesAt: leadAwardOpportunity.closes_at,
            decisionDueAt: leadAwardOpportunity.decision_due_at,
          }
        : null,
    },
    stageGateSummary: buildProjectStageGateSummary(
      ((stageGatesResult.data ?? []) as Array<{
        gate_id: string;
        decision: string;
        rationale: string | null;
        decided_at: string | null;
        missing_artifacts?: string[] | null;
      }>)
    ),
    linkedDatasets,
    recentRuns: ((runsResult.data ?? []) as Array<{
      id: string;
      title: string;
      created_at: string;
      summary_text: string | null;
    }>).map((run) => ({
      id: run.id,
      title: run.title,
      createdAt: run.created_at,
      summaryText: run.summary_text,
    })),
    reportSummary: {
      linkedReportCount: linkedReports.length,
      evidenceBackedCount: linkedReports.filter((report) => report.hasEvidence).length,
      comparisonBackedCount: linkedReports.filter((report) => report.comparisonSnapshotCount > 0).length,
      noPacketCount: linkedReports.filter((report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET).length,
      refreshRecommendedCount: linkedReports.filter((report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED).length,
      recommendedReport: linkedReports[0]
        ? {
            id: linkedReports[0].id,
            title: linkedReports[0].title,
            packetFreshness: linkedReports[0].packetFreshness,
            comparisonDigest: linkedReports[0].comparisonDigest,
          }
        : null,
    },
  };
}

async function loadRtpRegistryContext(
  supabase: SupabaseLike,
  userId: string,
  target: AssistantTarget
): Promise<RtpRegistryAssistantContext | null> {
  const workspace = await requireWorkspaceEnvelope(supabase, userId, target.workspaceId);
  if (!workspace?.id) {
    return null;
  }

  const { data: cyclesData } = await supabase
    .from("rtp_cycles")
    .select("id, title, status, updated_at")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  const cycles = (cyclesData ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    updated_at: string;
  }>;
  const cycleIds = cycles.map((cycle) => cycle.id);

  const { data: packetReportData } = cycleIds.length
    ? await supabase
        .from("reports")
        .select("id, rtp_cycle_id, title, generated_at, latest_artifact_kind, updated_at")
        .in("rtp_cycle_id", cycleIds)
        .eq("report_type", "board_packet")
        .order("updated_at", { ascending: false })
    : { data: [] };

  const packetReports = (packetReportData ?? []) as Array<{
    id: string;
    rtp_cycle_id: string | null;
    title: string | null;
    generated_at: string | null;
    latest_artifact_kind: string | null;
    updated_at: string;
  }>;
  const packetArtifactResult = packetReports.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at")
        .in(
          "report_id",
          packetReports.map((report) => report.id)
        )
    : { data: [], error: null };
  const latestArtifactGeneratedAtByReportId = buildLatestArtifactGeneratedAtByReportId(
    (packetArtifactResult.data ?? []) as Array<{ report_id: string; generated_at: string | null }>
  );
  const firstPacketByCycleId = new Map<string, { freshness: ReturnType<typeof getReportPacketFreshness> }>();
  const packetReportCountByCycleId = new Map<string, number>();
  const cycleUpdatedAtById = new Map(cycles.map((cycle) => [cycle.id, cycle.updated_at]));

  for (const report of packetReports) {
    if (!report.rtp_cycle_id) {
      continue;
    }
    packetReportCountByCycleId.set(report.rtp_cycle_id, (packetReportCountByCycleId.get(report.rtp_cycle_id) ?? 0) + 1);
    if (firstPacketByCycleId.has(report.rtp_cycle_id)) continue;
    firstPacketByCycleId.set(report.rtp_cycle_id, {
      freshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: latestArtifactGeneratedAtByReportId.get(report.id) ?? report.generated_at,
        updatedAt: cycleUpdatedAtById.get(report.rtp_cycle_id) ?? report.updated_at,
      }),
    });
  }

  const recommendedCycle =
    cycles
      .map((cycle) => ({
        ...cycle,
        packetFreshnessLabel: firstPacketByCycleId.get(cycle.id)?.freshness.label ?? PACKET_FRESHNESS_LABELS.NO_PACKET,
        packetReportCount: packetReportCountByCycleId.get(cycle.id) ?? 0,
      }))
      .sort((left, right) => {
        const leftPriority = left.packetFreshnessLabel === PACKET_FRESHNESS_LABELS.NO_PACKET ? 0 : left.packetFreshnessLabel === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED ? 1 : 2;
        const rightPriority = right.packetFreshnessLabel === PACKET_FRESHNESS_LABELS.NO_PACKET ? 0 : right.packetFreshnessLabel === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED ? 1 : 2;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      })[0] ?? null;

  return {
    kind: "rtp_registry",
    workspace,
    counts: {
      cycles: cycles.length,
      draftCycles: cycles.filter((cycle) => cycle.status === "draft").length,
      publicReviewCycles: cycles.filter((cycle) => cycle.status === "public_review").length,
      adoptedCycles: cycles.filter((cycle) => cycle.status === "adopted").length,
      archivedCycles: cycles.filter((cycle) => cycle.status === "archived").length,
      packetReports: packetReports.length,
      noPacketCount: cycles.filter((cycle) => (firstPacketByCycleId.get(cycle.id)?.freshness.label ?? PACKET_FRESHNESS_LABELS.NO_PACKET) === PACKET_FRESHNESS_LABELS.NO_PACKET).length,
      refreshRecommendedCount: cycles.filter((cycle) => firstPacketByCycleId.get(cycle.id)?.freshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED).length,
    },
    recommendedCycle: recommendedCycle
      ? {
          id: recommendedCycle.id,
          title: recommendedCycle.title,
          status: recommendedCycle.status,
          packetFreshnessLabel: recommendedCycle.packetFreshnessLabel,
          packetReportCount: recommendedCycle.packetReportCount,
          updatedAt: recommendedCycle.updated_at,
        }
      : null,
    operationsSummary: await loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      workspace.id
    ),
  };
}

async function loadPlanContext(
  supabase: SupabaseLike,
  userId: string,
  planId: string
): Promise<PlanAssistantContext | null> {
  const { data: plan } = await supabase
    .from("plans")
    .select("id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, updated_at, projects(id, name)")
    .eq("id", planId)
    .maybeSingle();

  if (!plan) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, plan.workspace_id);
  if (!workspace) {
    return null;
  }

  const project = Array.isArray(plan.projects) ? plan.projects[0] ?? null : plan.projects ?? null;
  const [planLinksResult, scenarioResult, campaignResult, reportResult, operationsSummary] = await Promise.all([
    supabase.from("plan_links").select("plan_id, link_type").eq("plan_id", plan.id),
    plan.project_id
      ? supabase.from("scenario_sets").select("id").eq("project_id", plan.project_id)
      : Promise.resolve({ data: [], error: null }),
    plan.project_id
      ? supabase.from("engagement_campaigns").select("id").eq("project_id", plan.project_id)
      : Promise.resolve({ data: [], error: null }),
    plan.project_id
      ? supabase.from("reports").select("id").eq("project_id", plan.project_id)
      : Promise.resolve({ data: [], error: null }),
    loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      workspace.id
    ),
  ]);

  const planLinks = (planLinksResult.data ?? []) as Array<{ plan_id: string; link_type: string }>;
  const explicitProjectCount = planLinks.filter((link) => link.link_type === "project_record").length;
  const explicitScenarioCount = planLinks.filter((link) => link.link_type === "scenario_set").length;
  const explicitCampaignCount = planLinks.filter((link) => link.link_type === "engagement_campaign").length;
  const explicitReportCount = planLinks.filter((link) => link.link_type === "report").length;
  const scenarioCount = explicitScenarioCount + (scenarioResult.data?.length ?? 0);
  const engagementCampaignCount = explicitCampaignCount + (campaignResult.data?.length ?? 0);
  const reportCount = explicitReportCount + (reportResult.data?.length ?? 0);

  const readiness = buildPlanReadiness({
    hasProject: Boolean(plan.project_id || explicitProjectCount > 0),
    scenarioCount,
    engagementCampaignCount,
    reportCount,
    geographyLabel: plan.geography_label,
    horizonYear: plan.horizon_year,
  });

  const artifactCoverage = buildPlanArtifactCoverage({
    scenarioCount,
    engagementCampaignCount,
    reportCount,
  });

  const workflow = buildPlanWorkflowSummary({
    planStatus: plan.status,
    readiness,
    linkedProjectCount: project ? 1 : 0,
    explicitLinkCount: planLinks.length,
    relatedProjectCount: project ? 1 : 0,
    scenarioCount,
    readyScenarioCount: 0,
    engagementCampaignCount,
    pendingEngagementItemCount: 0,
    flaggedEngagementItemCount: 0,
    reportCount,
    generatedReportCount: 0,
    reportArtifactCount: 0,
  });

  return {
    kind: "plan",
    workspace,
    project: project ? { id: project.id, name: project.name } : null,
    plan: {
      id: plan.id,
      title: plan.title,
      summary: plan.summary,
      status: plan.status,
      planType: plan.plan_type,
      geographyLabel: plan.geography_label,
      horizonYear: plan.horizon_year,
      updatedAt: plan.updated_at,
    },
    readiness,
    artifactCoverage,
    workflow,
    linkageCounts: {
      scenarios: scenarioCount,
      engagementCampaigns: engagementCampaignCount,
      reports: reportCount,
      relatedProjects: explicitProjectCount + (project ? 1 : 0),
    },
    operationsSummary,
  };
}

async function loadRtpContext(
  supabase: SupabaseLike,
  userId: string,
  rtpCycleId: string
): Promise<RtpAssistantContext | null> {
  const { data: cycle } = await supabase
    .from("rtp_cycles")
    .select(
      "id, workspace_id, title, summary, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, updated_at"
    )
    .eq("id", rtpCycleId)
    .maybeSingle();

  if (!cycle) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, cycle.workspace_id);
  if (!workspace) {
    return null;
  }

  const [chaptersResult, projectLinksResult, campaignsResult, packetReportsResult] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select("id, status")
      .eq("rtp_cycle_id", cycle.id),
    supabase
      .from("project_rtp_cycle_links")
      .select("id")
      .eq("rtp_cycle_id", cycle.id),
    supabase
      .from("engagement_campaigns")
      .select("id")
      .eq("rtp_cycle_id", cycle.id),
    supabase
      .from("reports")
      .select("id, title, generated_at, latest_artifact_kind, updated_at")
      .eq("rtp_cycle_id", cycle.id)
      .eq("report_type", "board_packet")
      .order("updated_at", { ascending: false }),
  ]);

  const chapters = looksLikePendingSchema(chaptersResult.error?.message)
    ? RTP_CHAPTER_TEMPLATES.map((template) => ({ id: `template-${template.chapterKey}`, status: "not_started" }))
    : ((chaptersResult.data ?? []) as Array<{ id: string; status: string }>);
  const linkedProjects = looksLikePendingSchema(projectLinksResult.error?.message)
    ? []
    : ((projectLinksResult.data ?? []) as Array<{ id: string }>);
  const campaigns = looksLikePendingSchema(campaignsResult.error?.message)
    ? []
    : ((campaignsResult.data ?? []) as Array<{ id: string }>);
  const packetReports = looksLikePendingSchema(packetReportsResult.error?.message)
    ? []
    : ((packetReportsResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        generated_at: string | null;
        latest_artifact_kind: string | null;
        updated_at: string;
      }>);
  const packetArtifactsResult = packetReports.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at")
        .in(
          "report_id",
          packetReports.map((report) => report.id)
        )
    : { data: [], error: null };
  const latestArtifactGeneratedAtByReportId = buildLatestArtifactGeneratedAtByReportId(
    (packetArtifactsResult.data ?? []) as Array<{ report_id: string; generated_at: string | null }>
  );

  const packetSummaries = packetReports
    .map((report) => ({
      id: report.id,
      title: report.title,
      updatedAt: report.updated_at,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: latestArtifactGeneratedAtByReportId.get(report.id) ?? report.generated_at,
        updatedAt: cycle.updated_at,
      }),
    }))
    .sort((left, right) => {
      const postureDelta = compareRtpPacketPostureForCycle(left.packetFreshness.label, right.packetFreshness.label);
      if (postureDelta !== 0) return postureDelta;
      return new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime();
    });
  const recommendedReport = packetSummaries[0] ?? null;
  const readiness = buildRtpCycleReadiness({
    geographyLabel: cycle.geography_label,
    horizonStartYear: cycle.horizon_start_year,
    horizonEndYear: cycle.horizon_end_year,
    adoptionTargetDate: cycle.adoption_target_date,
    publicReviewOpenAt: cycle.public_review_open_at,
    publicReviewCloseAt: cycle.public_review_close_at,
  });

  return {
    kind: "rtp_cycle",
    workspace,
    rtpCycle: {
      id: cycle.id,
      title: cycle.title,
      summary: cycle.summary,
      status: cycle.status,
      geographyLabel: cycle.geography_label,
      horizonStartYear: cycle.horizon_start_year,
      horizonEndYear: cycle.horizon_end_year,
      adoptionTargetDate: cycle.adoption_target_date,
      publicReviewOpenAt: cycle.public_review_open_at,
      publicReviewCloseAt: cycle.public_review_close_at,
      updatedAt: cycle.updated_at,
    },
    readiness,
    workflow: buildRtpCycleWorkflowSummary({
      status: cycle.status,
      readiness,
    }),
    counts: {
      chapters: chapters.length,
      readyForReviewChapters: chapters.filter((chapter) => chapter.status === "ready_for_review").length,
      completeChapters: chapters.filter((chapter) => chapter.status === "complete").length,
      linkedProjects: linkedProjects.length,
      engagementCampaigns: campaigns.length,
      packetReports: packetReports.length,
    },
    packetSummary: {
      linkedReportCount: packetReports.length,
      noPacketCount: packetSummaries.filter((report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET).length,
      refreshRecommendedCount: packetSummaries.filter((report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED).length,
      recommendedReport,
    },
    operationsSummary: await loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      workspace.id
    ),
  };
}

async function loadProgramContext(
  supabase: SupabaseLike,
  userId: string,
  programId: string
): Promise<ProgramAssistantContext | null> {
  const { data: program } = await supabase
    .from("programs")
    .select("id, workspace_id, project_id, title, program_type, status, cycle_name, sponsor_agency, summary, nomination_due_at, adoption_target_at, projects(id, name), updated_at")
    .eq("id", programId)
    .maybeSingle();

  if (!program) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, program.workspace_id);
  if (!workspace) {
    return null;
  }

  const project = Array.isArray(program.projects) ? program.projects[0] ?? null : program.projects ?? null;
  const [linksResult, plansResult, projectReportsResult, campaignsResult, fundingOpportunitiesResult, fundingAwardsResult, fundingInvoicesResult, reimbursementSubmittalsResult, projectFundingProfileResult, operationsSummary] = await Promise.all([
    supabase.from("program_links").select("program_id, link_type, linked_id").eq("program_id", program.id),
    program.project_id
      ? supabase.from("plans").select("id").eq("project_id", program.project_id)
      : Promise.resolve({ data: [], error: null }),
    program.project_id
      ? supabase
          .from("reports")
          .select("id, title, status, generated_at, latest_artifact_kind, updated_at")
          .eq("project_id", program.project_id)
      : Promise.resolve({ data: [], error: null }),
    program.project_id
      ? supabase.from("engagement_campaigns").select("id").eq("project_id", program.project_id)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("funding_opportunities")
      .select("id, title, opportunity_status, decision_state, expected_award_amount, closes_at, decision_due_at, updated_at")
      .eq("program_id", program.id),
    supabase
      .from("funding_awards")
      .select("id, funding_opportunity_id, awarded_amount, match_amount, risk_flag, obligation_due_at")
      .eq("program_id", program.id),
    program.project_id
      ? supabase
          .from("billing_invoice_records")
          .select("id, funding_award_id, status, amount, retention_percent, retention_amount, due_date")
          .eq("project_id", program.project_id)
      : Promise.resolve({ data: [], error: null }),
    program.project_id
      ? supabase.from("project_submittals").select("id").eq("project_id", program.project_id).eq("submittal_type", "reimbursement")
      : Promise.resolve({ data: [], error: null }),
    program.project_id
      ? supabase
          .from("project_funding_profiles")
          .select("project_id, funding_need_amount, local_match_need_amount")
          .eq("project_id", program.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      workspace.id
    ),
  ]);

  const links = (linksResult.data ?? []) as Array<{ program_id: string; link_type: string; linked_id: string }>;
  const explicitPlanCount = links.filter((link) => link.link_type === "plan").length;
  const explicitReportCount = links.filter((link) => link.link_type === "report").length;
  const explicitCampaignCount = links.filter((link) => link.link_type === "engagement_campaign").length;
  const explicitProjectCount = links.filter((link) => link.link_type === "project_record").length;
  const planCount = explicitPlanCount + (plansResult.data?.length ?? 0);
  const engagementCampaignCount = explicitCampaignCount + (campaignsResult.data?.length ?? 0);
  const fundingOpportunities = (fundingOpportunitiesResult.data ?? []) as Array<{
    id: string;
    title: string;
    opportunity_status: string | null;
    decision_state: string | null;
    expected_award_amount?: number | null;
    closes_at: string | null;
    decision_due_at: string | null;
    updated_at: string | null;
  }>;
  const projectFundingProfile = projectFundingProfileResult.data as {
    project_id: string;
    funding_need_amount: number | null;
    local_match_need_amount?: number | null;
  } | null;
  const fundingAwards = (fundingAwardsResult.data ?? []) as Array<{
    id: string;
    funding_opportunity_id: string | null;
    awarded_amount: number | null;
    match_amount: number | null;
    risk_flag: string | null;
    obligation_due_at: string | null;
  }>;
  const fundingInvoices = ((fundingInvoicesResult.data ?? []) as Array<{
    id: string;
    funding_award_id: string | null;
    status: string | null;
    amount: number | null;
    retention_percent: number | null;
    retention_amount: number | null;
    due_date: string | null;
  }>);
  const exactInvoiceAwardRelink = resolveExactInvoiceAwardRelink(fundingAwards, fundingInvoices);
  const fundingAwardOpportunityIds = new Set(
    fundingAwards.map((award) => award.funding_opportunity_id).filter((value): value is string => Boolean(value))
  );
  const fundingStackSummary = buildProjectFundingStackSummary(projectFundingProfile, fundingAwards, fundingOpportunities, fundingInvoices);
  const fundingOpenCount = fundingOpportunities.filter((opportunity) =>
    ["open", "upcoming"].includes(opportunity.opportunity_status ?? "")
  ).length;
  const closingSoonFundingOpportunities = fundingOpportunities.filter((opportunity) => {
    if ((opportunity.opportunity_status ?? "") !== "open") return false;
    const days = daysUntil(opportunity.closes_at ?? opportunity.decision_due_at);
    return days !== null && days <= 14;
  });
  const fundingClosingSoonCount = closingSoonFundingOpportunities.length;
  const leadClosingFundingOpportunity = [...closingSoonFundingOpportunities].sort((left, right) => {
    const leftDueRaw = left.closes_at ?? left.decision_due_at;
    const rightDueRaw = right.closes_at ?? right.decision_due_at;
    const leftDue = leftDueRaw ? new Date(leftDueRaw).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = rightDueRaw ? new Date(rightDueRaw).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime();
  })[0] ?? null;
  const overdueMonitoredFundingOpportunities = fundingOpportunities.filter((opportunity) => {
    if (!["open", "upcoming"].includes(opportunity.opportunity_status ?? "")) return false;
    if ((opportunity.decision_state ?? "") !== "monitor") return false;
    const days = daysUntil(opportunity.decision_due_at);
    return days !== null && days < 0;
  });
  const fundingOverdueDecisionCount = overdueMonitoredFundingOpportunities.length;
  const leadOverdueFundingOpportunity = [...overdueMonitoredFundingOpportunities].sort((left, right) => {
    const leftDue = left.decision_due_at ? new Date(left.decision_due_at).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.decision_due_at ? new Date(right.decision_due_at).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime();
  })[0] ?? null;
  const actionableFundingOpportunities = fundingOpportunities.filter(
    (opportunity) => !["awarded", "archived"].includes(opportunity.opportunity_status ?? "")
  );
  const fundingPursueCount = actionableFundingOpportunities.filter((opportunity) => opportunity.decision_state === "pursue").length;
  const leadFundingOpportunity = [...actionableFundingOpportunities].sort((left, right) => {
    const leftDecisionPriority = left.decision_state === "skip" ? 2 : left.decision_state === "pursue" ? 1 : 0;
    const rightDecisionPriority = right.decision_state === "skip" ? 2 : right.decision_state === "pursue" ? 1 : 0;
    if (leftDecisionPriority !== rightDecisionPriority) return leftDecisionPriority - rightDecisionPriority;
    const leftStatusPriority = left.opportunity_status === "open" ? 0 : left.opportunity_status === "upcoming" ? 1 : 2;
    const rightStatusPriority = right.opportunity_status === "open" ? 0 : right.opportunity_status === "upcoming" ? 1 : 2;
    if (leftStatusPriority !== rightStatusPriority) return leftStatusPriority - rightStatusPriority;
    const leftDueAt = left.closes_at ?? left.decision_due_at;
    const rightDueAt = right.closes_at ?? right.decision_due_at;
    if (leftDueAt && rightDueAt) {
      const dueDelta = new Date(leftDueAt).getTime() - new Date(rightDueAt).getTime();
      if (dueDelta !== 0) return dueDelta;
    }
    return new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime();
  })[0] ?? null;
  const leadAwardOpportunity = [...fundingOpportunities]
    .filter(
      (opportunity) =>
        opportunity.opportunity_status === "awarded" && !fundingAwardOpportunityIds.has(opportunity.id)
    )
    .sort((left, right) => new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime())[0] ?? null;

  const explicitReportIds = links.filter((link) => link.link_type === "report").map((link) => link.linked_id);
  const explicitReportsResult = explicitReportIds.length
    ? await supabase
        .from("reports")
        .select("id, title, status, generated_at, latest_artifact_kind, updated_at")
        .in("id", explicitReportIds)
    : { data: [], error: null };
  const linkedReportRows = [
    ...((projectReportsResult.data ?? []) as Array<{
      id: string;
      title: string | null;
      status: string | null;
      generated_at: string | null;
      latest_artifact_kind: string | null;
      updated_at: string | null;
    }>),
    ...((explicitReportsResult.data ?? []) as Array<{
      id: string;
      title: string | null;
      status: string | null;
      generated_at: string | null;
      latest_artifact_kind: string | null;
      updated_at: string | null;
    }>),
  ];
  const reportArtifactsResult = linkedReportRows.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at")
        .in(
          "report_id",
          linkedReportRows.map((row) => row.id)
        )
    : { data: [], error: null };
  const latestArtifactGeneratedAtByReportId = buildLatestArtifactGeneratedAtByReportId(
    (reportArtifactsResult.data ?? []) as Array<{ report_id: string; generated_at: string | null }>
  );

  const linkedReports = new Map<string, { id: string; title: string | null; status: string | null; packetFreshness: ReturnType<typeof getReportPacketFreshness>; updatedAt: string | null }>();

  for (const row of (projectReportsResult.data ?? []) as Array<{ id: string; title: string | null; status: string | null; generated_at: string | null; latest_artifact_kind: string | null; updated_at: string | null }>) {
    linkedReports.set(row.id, {
      id: row.id,
      title: row.title,
      status: row.status,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: row.latest_artifact_kind,
        generatedAt: latestArtifactGeneratedAtByReportId.get(row.id) ?? row.generated_at,
        updatedAt: row.updated_at,
      }),
      updatedAt: row.updated_at,
    });
  }

  for (const row of (explicitReportsResult.data ?? []) as Array<{ id: string; title: string | null; status: string | null; generated_at: string | null; latest_artifact_kind: string | null; updated_at: string | null }>) {
    linkedReports.set(row.id, {
      id: row.id,
      title: row.title,
      status: row.status,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: row.latest_artifact_kind,
        generatedAt: latestArtifactGeneratedAtByReportId.get(row.id) ?? row.generated_at,
        updatedAt: row.updated_at,
      }),
      updatedAt: row.updated_at,
    });
  }

  const sortedLinkedReports = [...linkedReports.values()].sort((left, right) => {
    const postureDelta = compareRtpPacketPostureForCycle(left.packetFreshness.label, right.packetFreshness.label);
    if (postureDelta !== 0) return postureDelta;
    return new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime();
  });

  const reportCount = explicitReportCount + (projectReportsResult.data?.length ?? 0);
  const generatedReportCount = sortedLinkedReports.filter((report) => report.status === "generated").length;
  const attentionCount = sortedLinkedReports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED || report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
  ).length;
  const noPacketCount = sortedLinkedReports.filter((report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET).length;
  const refreshRecommendedCount = sortedLinkedReports.filter((report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED).length;

  const readiness = buildProgramReadiness({
    cycleName: program.cycle_name,
    hasProject: Boolean(program.project_id || explicitProjectCount > 0),
    planCount,
    reportCount,
    engagementCampaignCount,
    sponsorAgency: program.sponsor_agency,
    fiscalYearStart: null,
    fiscalYearEnd: null,
    nominationDueAt: program.nomination_due_at,
    adoptionTargetAt: program.adoption_target_at,
  });

  const workflow = buildProgramWorkflowSummary({
    programStatus: program.status,
    readiness,
    planCount,
    reportCount,
    generatedReportCount,
    engagementCampaignCount,
    approvedEngagementItemCount: 0,
    pendingEngagementItemCount: 0,
  });

  return {
    kind: "program",
    workspace,
    project: project ? { id: project.id, name: project.name } : null,
    program: {
      id: program.id,
      title: program.title,
      summary: program.summary,
      status: program.status,
      programType: program.program_type,
      cycleName: program.cycle_name,
      sponsorAgency: program.sponsor_agency,
      updatedAt: program.updated_at,
    },
    readiness,
    workflow,
    linkageCounts: {
      plans: planCount,
      reports: reportCount,
      engagementCampaigns: engagementCampaignCount,
      relatedProjects: explicitProjectCount + (project ? 1 : 0),
    },
    fundingSummary: {
      opportunityCount: fundingOpportunities.length,
      openCount: fundingOpenCount,
      closingSoonCount: fundingClosingSoonCount,
      overdueDecisionCount: fundingOverdueDecisionCount,
      pursueCount: fundingPursueCount,
      awardCount: fundingAwards.length,
      awardRecordCount: fundingOpportunities.filter(
        (opportunity) => opportunity.opportunity_status === "awarded" && !fundingAwardOpportunityIds.has(opportunity.id)
      ).length,
      fundingNeedAmount: projectFundingProfile?.funding_need_amount ?? null,
      gapAmount: fundingStackSummary.hasTargetNeed ? fundingStackSummary.unfundedAfterLikelyAmount : null,
      requestedReimbursementAmount: fundingAwards.length > 0 ? fundingStackSummary.requestedReimbursementAmount : null,
      uninvoicedAwardAmount: fundingAwards.length > 0 ? fundingStackSummary.uninvoicedAwardAmount : null,
      reimbursementStatus: fundingAwards.length > 0 ? fundingStackSummary.reimbursementStatus : null,
      reimbursementPacketCount: reimbursementSubmittalsResult.data?.length ?? 0,
      exactInvoiceAwardRelink,
      leadOpportunity: leadFundingOpportunity
        ? {
            id: leadFundingOpportunity.id,
            title: leadFundingOpportunity.title,
            status: leadFundingOpportunity.opportunity_status,
            decisionState: leadFundingOpportunity.decision_state,
            closesAt: leadFundingOpportunity.closes_at,
            decisionDueAt: leadFundingOpportunity.decision_due_at,
          }
        : null,
      leadOverdueOpportunity: leadOverdueFundingOpportunity
        ? {
            id: leadOverdueFundingOpportunity.id,
            title: leadOverdueFundingOpportunity.title,
            status: leadOverdueFundingOpportunity.opportunity_status,
            decisionState: leadOverdueFundingOpportunity.decision_state,
            closesAt: leadOverdueFundingOpportunity.closes_at,
            decisionDueAt: leadOverdueFundingOpportunity.decision_due_at,
          }
        : null,
      leadClosingOpportunity: leadClosingFundingOpportunity
        ? {
            id: leadClosingFundingOpportunity.id,
            title: leadClosingFundingOpportunity.title,
            status: leadClosingFundingOpportunity.opportunity_status,
            decisionState: leadClosingFundingOpportunity.decision_state,
            closesAt: leadClosingFundingOpportunity.closes_at,
            decisionDueAt: leadClosingFundingOpportunity.decision_due_at,
          }
        : null,
      leadAwardOpportunity: leadAwardOpportunity
        ? {
            id: leadAwardOpportunity.id,
            title: leadAwardOpportunity.title,
            status: leadAwardOpportunity.opportunity_status,
            decisionState: leadAwardOpportunity.decision_state,
            closesAt: leadAwardOpportunity.closes_at,
            decisionDueAt: leadAwardOpportunity.decision_due_at,
          }
        : null,
    },
    packetSummary: {
      linkedReportCount: sortedLinkedReports.length,
      attentionCount,
      noPacketCount,
      refreshRecommendedCount,
      recommendedReport: sortedLinkedReports[0]
        ? {
            id: sortedLinkedReports[0].id,
            title: sortedLinkedReports[0].title,
            packetFreshness: sortedLinkedReports[0].packetFreshness,
          }
        : null,
    },
    operationsSummary,
  };
}

async function loadScenarioContext(
  supabase: SupabaseLike,
  userId: string,
  scenarioSetId: string
): Promise<ScenarioAssistantContext | null> {
  const { data: scenarioSet } = await supabase
    .from("scenario_sets")
    .select("id, workspace_id, project_id, title, summary, planning_question, status, baseline_entry_id")
    .eq("id", scenarioSetId)
    .maybeSingle();

  if (!scenarioSet) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, scenarioSet.workspace_id);
  if (!workspace) {
    return null;
  }

  const [{ data: project }, { data: entriesData }, { data: reportsData }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, summary")
      .eq("id", scenarioSet.project_id)
      .maybeSingle(),
    supabase
      .from("scenario_entries")
      .select(
        "id, scenario_set_id, entry_type, label, slug, summary, assumptions_json, attached_run_id, status, sort_order, created_at, updated_at"
      )
      .eq("scenario_set_id", scenarioSet.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("reports")
      .select("id, title, status, report_type, generated_at, updated_at")
      .eq("project_id", scenarioSet.project_id)
      .order("updated_at", { ascending: false }),
  ]);

  const runIds = (entriesData ?? [])
    .map((entry: any) => entry.attached_run_id)
    .filter((value: unknown): value is string => Boolean(value));
  const attachedRunsResult = runIds.length
    ? await supabase.from("runs").select("id, title, summary_text, metrics, created_at").in("id", runIds)
    : { data: [] };

  const reportIds = (reportsData ?? []).map((report: any) => report.id);
  const reportRunsResult = reportIds.length
    ? await supabase.from("report_runs").select("report_id, run_id").in("report_id", reportIds)
    : { data: [] };

  const runMap = new Map((attachedRunsResult.data ?? []).map((run: any) => [run.id, run]));
  const entries = ((entriesData ?? []) as Array<any>).map((entry) => ({
    ...entry,
    attachedRun: entry.attached_run_id ? runMap.get(entry.attached_run_id) ?? null : null,
  }));

  const baselineEntry =
    entries.find((entry) => entry.id === scenarioSet.baseline_entry_id) ??
    entries.find((entry) => entry.entry_type === "baseline") ??
    null;
  const alternativeEntries = entries.filter((entry) => entry.entry_type === "alternative");

  const comparisonSummary = buildScenarioComparisonSummary({
    baselineEntryId: baselineEntry?.id,
    baselineRunId: baselineEntry?.attached_run_id ?? null,
    candidateRunIds: alternativeEntries.map((entry) => entry.attached_run_id),
  });

  const comparisonBoard = buildScenarioComparisonBoard({
    scenarioSetId: scenarioSet.id,
    baselineEntry,
    alternativeEntries,
  });

  const linkedReports = buildScenarioLinkedReports({
    reports: (reportsData ?? []) as Array<{
      id: string;
      title: string | null;
      status: string | null;
      report_type: string | null;
      generated_at: string | null;
      updated_at: string | null;
    }>,
    reportRuns: ((reportRunsResult.data ?? []) as Array<{ report_id: string; run_id: string }>),
    entries: entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      attached_run_id: entry.attached_run_id,
    })),
    baselineEntryId: baselineEntry?.id ?? null,
  }).linkedReports;

  return {
    kind: "scenario_set",
    workspace,
    project: project
      ? {
          id: project.id,
          name: project.name,
          summary: project.summary,
        }
      : null,
    scenarioSet: {
      id: scenarioSet.id,
      title: scenarioSet.title,
      summary: scenarioSet.summary,
      planningQuestion: scenarioSet.planning_question,
      status: scenarioSet.status,
    },
    baselineEntry: baselineEntry
      ? {
          id: baselineEntry.id,
          label: baselineEntry.label,
          attachedRunId: baselineEntry.attached_run_id ?? null,
        }
      : null,
    alternativeCount: alternativeEntries.length,
    comparisonSummary,
    comparisonBoard,
    linkedReports,
  };
}

async function loadModelContext(
  supabase: SupabaseLike,
  userId: string,
  modelId: string
): Promise<ModelAssistantContext | null> {
  const { data: model } = await supabase
    .from("models")
    .select(
      "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, assumptions_summary, input_summary, output_summary, summary, config_json, last_validated_at, last_run_recorded_at"
    )
    .eq("id", modelId)
    .maybeSingle();

  if (!model) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, model.workspace_id);
  if (!workspace) {
    return null;
  }

  const [linksResult, scenarioEntriesResult, modelRunsResult] = await Promise.all([
    supabase.from("model_links").select("id, model_id, link_type, linked_id, label").eq("model_id", model.id),
    model.scenario_set_id
      ? supabase
          .from("scenario_entries")
          .select("id, label, entry_type, status, assumptions_json")
          .eq("scenario_set_id", model.scenario_set_id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    supabase
      .from("model_runs")
      .select("id, status, run_title, created_at, completed_at")
      .eq("model_id", model.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const { readiness, workflow, linkageCounts } = buildModelWorkspaceSummary({
    modelStatus: model.status,
    projectId: model.project_id,
    scenarioSetId: model.scenario_set_id,
    configVersion: model.config_version,
    ownerLabel: model.owner_label,
    assumptionsSummary: model.assumptions_summary,
    inputSummary: model.input_summary,
    outputSummary: model.output_summary,
    lastValidatedAt: model.last_validated_at,
    lastRunRecordedAt: model.last_run_recorded_at,
    links: (linksResult.data ?? []) as Array<any>,
  });

  const schemaPending = Boolean(modelRunsResult.error && looksLikePendingSchema(modelRunsResult.error.message));

  return {
    kind: "model",
    workspace,
    model: {
      id: model.id,
      title: model.title,
      status: model.status,
      modelFamily: model.model_family,
      summary: model.summary,
      projectId: model.project_id,
      scenarioSetId: model.scenario_set_id,
    },
    readiness,
    workflow,
    linkageCounts,
    launchTemplate: extractModelLaunchTemplate(model.config_json ?? {}),
    scenarioEntryOptions: ((scenarioEntriesResult.data ?? []) as Array<any>).map((entry) => ({
      id: entry.id,
      label: entry.label,
      entryType: entry.entry_type,
      status: entry.status,
      assumptionCount: Object.keys(entry.assumptions_json ?? {}).length,
    })),
    recentModelRuns: schemaPending
      ? []
      : ((modelRunsResult.data ?? []) as Array<any>).map((run) => ({
          id: run.id,
          status: run.status,
          runTitle: run.run_title,
          createdAt: run.created_at ?? null,
          completedAt: run.completed_at ?? null,
        })),
    schemaPending,
  };
}

async function loadReportContext(
  supabase: SupabaseLike,
  userId: string,
  reportId: string
): Promise<ReportAssistantContext | null> {
  const { data: report } = await supabase
    .from("reports")
    .select(
      "id, workspace_id, project_id, rtp_cycle_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at"
    )
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, report.workspace_id);
  if (!workspace) {
    return null;
  }

  const [{ data: project }, { data: rtpCycle }, { data: sections }, { data: reportRunLinks }, { data: artifacts }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, summary, updated_at")
      .eq("id", report.project_id)
      .maybeSingle(),
    report.rtp_cycle_id
      ? supabase
          .from("rtp_cycles")
          .select("id, title, status, updated_at")
          .eq("id", report.rtp_cycle_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("report_sections")
      .select("id, section_key, enabled, config_json")
      .eq("report_id", report.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("report_runs")
      .select("run_id, sort_order")
      .eq("report_id", report.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("report_artifacts")
      .select("id, artifact_kind, generated_at, metadata_json")
      .eq("report_id", report.id)
      .order("generated_at", { ascending: false }),
  ]);

  const runIds = (reportRunLinks ?? []).map((item: any) => item.run_id);
  const runsResult = runIds.length
    ? await supabase
        .from("runs")
        .select("id, title, summary_text, created_at")
        .in("id", runIds)
    : { data: [] };

  const typedReportRuns = (runsResult.data ?? []) as Array<{
    id: string;
    title: string;
    summary_text: string | null;
    created_at: string;
  }>;
  const runMap = new Map(typedReportRuns.map((run) => [run.id, run]));
  const runs = ((reportRunLinks ?? []) as Array<{ run_id: string }>)
    .map((link) => runMap.get(link.run_id) ?? null)
    .filter((item): item is (typeof typedReportRuns)[number] => Boolean(item))
    .map((run) => ({
      id: run.id,
      title: run.title,
      summaryText: run.summary_text,
      createdAt: run.created_at,
    }));

  const latestArtifact = ((artifacts ?? []) as Array<any>)[0] ?? null;
  const effectiveGeneratedAt = latestArtifact?.generated_at ?? report.generated_at;
  const engagementCampaignId = extractEngagementCampaignId(sections ?? []);
  const engagementCampaignResult = engagementCampaignId
    ? await supabase
        .from("engagement_campaigns")
        .select("id, title, status")
        .eq("workspace_id", report.workspace_id)
        .eq("id", engagementCampaignId)
        .maybeSingle()
    : { data: null };

  return {
    kind: report.report_type === "board_packet" && report.rtp_cycle_id ? "rtp_packet_report" : "report",
    workspace,
    report: {
      id: report.id,
      title: report.title,
      summary: report.summary,
      status: report.status,
      reportType: report.report_type,
      rtpCycleId: report.rtp_cycle_id,
      generatedAt: effectiveGeneratedAt,
      latestArtifactKind: report.latest_artifact_kind,
      updatedAt: report.updated_at,
    },
    project: project
      ? {
          id: project.id,
          name: project.name,
          summary: project.summary,
          updatedAt: project.updated_at,
        }
      : null,
    sectionCount: sections?.length ?? 0,
    enabledSections: (sections ?? []).filter((section: any) => section.enabled).length,
    runs,
    artifactCount: artifacts?.length ?? 0,
    latestArtifact: latestArtifact
      ? {
          id: latestArtifact.id,
          artifactKind: latestArtifact.artifact_kind,
          generatedAt: latestArtifact.generated_at,
        }
      : null,
    runAudit: asRunAudit(latestArtifact?.metadata_json ?? null),
    sourceContext: asSourceContext(latestArtifact?.metadata_json ?? null),
    engagementCampaign: engagementCampaignResult.data
      ? {
          id: engagementCampaignResult.data.id,
          title: engagementCampaignResult.data.title,
          status: engagementCampaignResult.data.status,
        }
      : null,
    rtpCycle: rtpCycle
      ? {
          id: rtpCycle.id,
          title: rtpCycle.title,
          status: rtpCycle.status,
          updatedAt: rtpCycle.updated_at,
        }
      : null,
  };
}

async function loadRunContext(
  supabase: SupabaseLike,
  userId: string,
  runId: string,
  baselineRunId?: string | null
): Promise<RunAssistantContext | null> {
  const { data: run } = await supabase
    .from("runs")
    .select("id, workspace_id, title, summary_text, created_at, query_text, metrics")
    .eq("id", runId)
    .maybeSingle();

  if (!run) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, run.workspace_id);
  if (!workspace) {
    return null;
  }

  const { data: baselineRun } = baselineRunId
    ? await supabase
        .from("runs")
        .select("id, title, created_at, metrics")
        .eq("workspace_id", run.workspace_id)
        .eq("id", baselineRunId)
        .maybeSingle()
    : { data: null };

  return {
    kind: "run",
    workspace,
    run: {
      id: run.id,
      title: run.title,
      summary: run.summary_text,
      createdAt: run.created_at,
      queryText: run.query_text,
      metrics: run.metrics && typeof run.metrics === "object" ? (run.metrics as Record<string, unknown>) : {},
    },
    baselineRun: baselineRun
      ? {
          id: baselineRun.id,
          title: baselineRun.title,
          createdAt: baselineRun.created_at,
          metrics:
            baselineRun.metrics && typeof baselineRun.metrics === "object"
              ? (baselineRun.metrics as Record<string, unknown>)
              : {},
        }
      : null,
  };
}

export async function loadAssistantContext(
  supabase: SupabaseLike,
  userId: string,
  target: AssistantTarget
): Promise<AssistantContext | null> {
  switch (target.kind as AssistantTargetKind) {
    case "project":
      return target.id ? loadProjectContext(supabase, userId, target.id) : null;
    case "rtp_registry":
      return loadRtpRegistryContext(supabase, userId, target);
    case "rtp_cycle":
      return target.id ? loadRtpContext(supabase, userId, target.id) : null;
    case "plan":
      return target.id ? loadPlanContext(supabase, userId, target.id) : null;
    case "program":
      return target.id ? loadProgramContext(supabase, userId, target.id) : null;
    case "scenario_set":
      return target.id ? loadScenarioContext(supabase, userId, target.id) : null;
    case "model":
      return target.id ? loadModelContext(supabase, userId, target.id) : null;
    case "report":
    case "rtp_packet_report":
      return target.id ? loadReportContext(supabase, userId, target.id) : null;
    case "run":
      return target.id ? loadRunContext(supabase, userId, target.id, target.baselineRunId) : null;
    case "analysis_studio":
      return loadWorkspaceContext(supabase, userId, target);
    case "workspace":
    default:
      return loadWorkspaceContext(supabase, userId, target);
  }
}
