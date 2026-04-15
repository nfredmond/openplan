import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  Clock3,
  Database,
  FileClock,
  FileSpreadsheet,
  FileStack,
  FolderKanban,
  MessagesSquare,
  Radar,
  Scale,
  ShieldCheck,
  Siren,
  Target,
} from "lucide-react";
import Link from "next/link";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { FundingOpportunityDecisionControls } from "@/components/programs/funding-opportunity-decision-controls";
import { ProjectFundingAwardCreator } from "@/components/projects/project-funding-award-creator";
import { ProjectFundingProfileEditor } from "@/components/projects/project-funding-profile-editor";
import { ProjectRtpLinker } from "@/components/projects/project-rtp-linker";
import { ProjectRecordComposer } from "@/components/projects/project-record-composer";
import { ReportPacketCommandQueue } from "@/components/reports/report-packet-command-queue";
import { StatusBadge } from "@/components/ui/status-badge";
import { summarizeBillingInvoiceRecords } from "@/lib/billing/invoice-records";
import {
  buildGrantDecisionModelingSupport,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import { loadWorkspaceOperationsSummaryForWorkspace, type WorkspaceOperationsSupabaseLike } from "@/lib/operations/workspace-summary";
import {
  buildAerialProjectPosture,
  describeAerialProjectPosture,
  aerialMissionStatusTone,
  aerialVerificationReadinessTone,
  formatAerialMissionStatusLabel,
  formatAerialMissionTypeLabel,
  formatAerialVerificationReadinessLabel,
} from "@/lib/aerial/catalog";
import { buildProjectControlsSummary } from "@/lib/projects/controls";
import {
  buildProjectFundingStackSummary,
  projectFundingReimbursementTone,
  projectFundingStackTone,
} from "@/lib/projects/funding";
import {
  formatFundingAwardMatchPostureLabel,
  formatFundingAwardRiskFlagLabel,
  formatFundingAwardSpendingStatusLabel,
  formatFundingOpportunityDecisionLabel,
  formatFundingOpportunityStatusLabel,
  fundingAwardMatchPostureTone,
  fundingAwardRiskFlagTone,
  fundingAwardSpendingStatusTone,
  fundingOpportunityDecisionTone,
  fundingOpportunityStatusTone,
} from "@/lib/programs/catalog";
import {
  describeComparisonSnapshotAggregate,
  describeEvidenceChainSummary,
  formatReportStatusLabel,
  formatReportTypeLabel,
  getReportNavigationHref,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
  parseStoredComparisonSnapshotAggregate,
  parseStoredEvidenceChainSummary,
  reportStatusTone,
} from "@/lib/reports/catalog";
import { createClient } from "@/lib/supabase/server";
import { buildProjectStageGateSummary } from "@/lib/stage-gates/summary";

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string;
  delivery_phase: string;
  created_at: string;
  updated_at: string;
};

type ProjectReportRow = {
  id: string;
  title: string;
  summary: string | null;
  report_type: string;
  status: string;
  updated_at: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
};

type ReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

type TimelineItem = {
  id: string;
  type: string;
  title: string;
  description: string;
  at: string | null;
  badge: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
};

type LinkedDatasetItem = {
  datasetId: string;
  name: string;
  status: string;
  relationshipType: string;
  connectorLabel: string | null;
  vintageLabel: string | null;
  lastRefreshedAt: string | null;
};

type ProjectRtpLinkRow = {
  id: string;
  rtp_cycle_id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  created_at: string;
};

type RtpCycleRow = {
  id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
};

type MilestoneRow = {
  id: string;
  title: string;
  summary: string | null;
  milestone_type: string;
  phase_code: string;
  status: string;
  owner_label: string | null;
  target_date: string | null;
  actual_date: string | null;
  notes: string | null;
  created_at: string;
};

type SubmittalRow = {
  id: string;
  title: string;
  submittal_type: string;
  status: string;
  agency_label: string | null;
  reference_number: string | null;
  due_date: string | null;
  submitted_at: string | null;
  review_cycle: number;
  notes: string | null;
  created_at: string;
};

type BillingInvoiceRow = {
  id: string;
  funding_award_id: string | null;
  invoice_number: string;
  consultant_name: string | null;
  billing_basis: string;
  status: string;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  supporting_docs_status: string;
  submitted_to: string | null;
  caltrans_posture: string;
  notes: string | null;
  created_at: string;
  funding_awards:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
};

type FundingOpportunityRow = {
  id: string;
  program_id: string | null;
  project_id: string | null;
  title: string;
  opportunity_status: string;
  decision_state: string;
  agency_name: string | null;
  owner_label: string | null;
  cadence_label: string | null;
  expected_award_amount: number | string | null;
  opens_at: string | null;
  closes_at: string | null;
  decision_due_at: string | null;
  fit_notes: string | null;
  readiness_notes: string | null;
  decision_rationale: string | null;
  decided_at: string | null;
  summary: string | null;
  updated_at: string;
  created_at: string;
  programs:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
};

type ProjectFundingProfileRow = {
  id: string;
  project_id: string;
  funding_need_amount: number | null;
  local_match_need_amount: number | null;
  notes: string | null;
  updated_at: string;
};

type FundingAwardRow = {
  id: string;
  project_id: string;
  program_id: string | null;
  funding_opportunity_id: string | null;
  title: string;
  awarded_amount: number | string;
  match_amount: number | string;
  match_posture: string;
  obligation_due_at: string | null;
  spending_status: string;
  risk_flag: string;
  notes: string | null;
  updated_at: string;
  created_at: string;
  funding_opportunities:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
  programs:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
};

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function fmtCurrency(value: number | string | null | undefined): string {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  const safeValue = Number.isFinite(parsed) ? parsed : 0;
  return safeValue.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function parseSortableDate(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function compareDateValues(left: string | null | undefined, right: string | null | undefined): number {
  return parseSortableDate(left) - parseSortableDate(right);
}

function buildProjectControlHref(targetId: string, targetRowId?: string | null): string {
  return `#${targetRowId ?? targetId}`;
}

function toneForStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "draft") return "neutral";
  if (status === "on_hold") return "warning";
  if (status === "complete") return "info";
  return "neutral";
}

function toneForDecision(decision: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (decision === "PASS" || decision === "approved") return "success";
  if (decision === "HOLD" || decision === "proposed") return "warning";
  if (decision === "rejected") return "danger";
  return "neutral";
}

function toneForDeliverableStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "complete") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "warning";
  return "neutral";
}

function toneForMilestoneStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "complete") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "warning";
  if (status === "scheduled") return "neutral";
  return "neutral";
}

function toneForSubmittalStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "accepted") return "success";
  if (status === "submitted") return "info";
  if (status === "internal_review") return "warning";
  if (status === "revise_and_resubmit") return "danger";
  return "neutral";
}

function toneForInvoiceStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "submitted" || status === "approved_for_payment") return "info";
  if (status === "internal_review") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function toneForRiskSeverity(severity: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (severity === "critical") return "danger";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  if (severity === "low") return "success";
  return "neutral";
}

function toneForDatasetStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "ready") return "success";
  if (status === "refreshing") return "info";
  if (status === "stale") return "warning";
  if (status === "error") return "danger";
  return "neutral";
}

function toneForControlHealth(health: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (health === "stable") return "success";
  if (health === "attention") return "warning";
  if (health === "active") return "info";
  return "neutral";
}

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

function milestonePriority(milestone: MilestoneRow, now: Date): number {
  if (milestone.status === "blocked") return 0;
  if (milestone.status !== "complete" && parseSortableDate(milestone.target_date) < now.getTime()) return 1;
  if (milestone.status !== "complete") return 2;
  return 3;
}

function submittalPriority(submittal: SubmittalRow, now: Date): number {
  if (submittal.status !== "accepted" && parseSortableDate(submittal.due_date) < now.getTime()) return 0;
  if (submittal.status !== "accepted") return 1;
  return 2;
}

function invoicePriority(invoice: BillingInvoiceRow, now: Date): number {
  const dueAt = parseSortableDate(invoice.due_date);
  if (!["paid", "rejected"].includes(invoice.status) && dueAt < now.getTime()) return 0;
  if (["internal_review", "submitted", "approved_for_payment"].includes(invoice.status)) return 1;
  if (invoice.status === "draft") return 2;
  return 3;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: projectData } = await supabase
    .from("projects")
    .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at")
    .eq("id", projectId)
    .single();

  if (!projectData) {
    notFound();
  }

  const project = projectData as ProjectRow;

  const { data: workspaceData } = await supabase
    .from("workspaces")
    .select("id, name, plan, slug, stage_gate_template_id, stage_gate_template_version, created_at")
    .eq("id", project.workspace_id)
    .single();

  const projectRtpLinkResult = await supabase
    .from("project_rtp_cycle_links")
    .select("id, rtp_cycle_id, portfolio_role, priority_rationale, created_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });

  const projectRtpLinkRows = looksLikePendingSchema(projectRtpLinkResult.error?.message)
    ? []
    : ((projectRtpLinkResult.data ?? []) as ProjectRtpLinkRow[]);
  const projectRtpLinksPending = looksLikePendingSchema(projectRtpLinkResult.error?.message);

  const linkedRtpCycleIds = projectRtpLinkRows.map((item) => item.rtp_cycle_id);
  const linkedRtpCyclesResult = linkedRtpCycleIds.length
    ? await supabase
        .from("rtp_cycles")
        .select("id, title, status, geography_label, horizon_start_year, horizon_end_year")
        .in("id", linkedRtpCycleIds)
    : { data: [], error: null };

  const linkedRtpCycles = looksLikePendingSchema(linkedRtpCyclesResult.error?.message)
    ? []
    : ((linkedRtpCyclesResult.data ?? []) as RtpCycleRow[]);

  const workspaceRtpCyclesResult = await supabase
    .from("rtp_cycles")
    .select("id, title, status, geography_label, horizon_start_year, horizon_end_year")
    .eq("workspace_id", project.workspace_id)
    .order("updated_at", { ascending: false });

  const workspaceRtpCycles = looksLikePendingSchema(workspaceRtpCyclesResult.error?.message)
    ? []
    : ((workspaceRtpCyclesResult.data ?? []) as RtpCycleRow[]);

  const rtpCycleById = new Map(linkedRtpCycles.map((cycle) => [cycle.id, cycle]));
  const existingRtpLinks = projectRtpLinkRows
    .map((link) => {
      const cycle = rtpCycleById.get(link.rtp_cycle_id);
      if (!cycle) return null;
      return {
        id: link.id,
        rtpCycleId: cycle.id,
        title: cycle.title,
        status: cycle.status,
        geographyLabel: cycle.geography_label,
        horizonStartYear: cycle.horizon_start_year,
        horizonEndYear: cycle.horizon_end_year,
        portfolioRole: link.portfolio_role,
        priorityRationale: link.priority_rationale,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const { data: recentRuns } = await supabase
    .from("runs")
    .select("id, title, created_at, summary_text")
    .eq("workspace_id", project.workspace_id)
    .order("created_at", { ascending: false })
    .limit(5);

  const operationsSummaryPromise = loadWorkspaceOperationsSummaryForWorkspace(
    supabase as unknown as WorkspaceOperationsSupabaseLike,
    project.workspace_id
  );

  const {
    data: projectReportData,
    count: projectReportCount,
  } = await supabase
    .from("reports")
    .select(
      "id, title, summary, report_type, status, updated_at, generated_at, latest_artifact_kind",
      { count: "exact" }
    )
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(4);

  const { data: recentGateDecisions } = await supabase
    .from("stage_gate_decisions")
    .select("id, gate_id, decision, rationale, decided_at, missing_artifacts")
    .eq("workspace_id", project.workspace_id)
    .order("decided_at", { ascending: false })
    .limit(200);

  const milestoneResult = await supabase
    .from("project_milestones")
    .select("id, title, summary, milestone_type, phase_code, status, owner_label, target_date, actual_date, notes, created_at")
    .eq("project_id", project.id)
    .order("target_date", { ascending: true })
    .limit(8);
  const milestones = looksLikePendingSchema(milestoneResult.error?.message) ? [] : ((milestoneResult.data ?? []) as MilestoneRow[]);
  const projectMilestonesPending = looksLikePendingSchema(milestoneResult.error?.message);

  const submittalResult = await supabase
    .from("project_submittals")
    .select("id, title, submittal_type, status, agency_label, reference_number, due_date, submitted_at, review_cycle, notes, created_at")
    .eq("project_id", project.id)
    .order("due_date", { ascending: true })
    .limit(8);
  const submittals = looksLikePendingSchema(submittalResult.error?.message) ? [] : ((submittalResult.data ?? []) as SubmittalRow[]);
  const projectSubmittalsPending = looksLikePendingSchema(submittalResult.error?.message);

  const { data: deliverables } = await supabase
    .from("project_deliverables")
    .select("id, title, summary, owner_label, due_date, status, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: risks } = await supabase
    .from("project_risks")
    .select("id, title, description, severity, status, mitigation, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: issues } = await supabase
    .from("project_issues")
    .select("id, title, description, severity, status, owner_label, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: decisions } = await supabase
    .from("project_decisions")
    .select("id, title, rationale, status, impact_summary, decided_at, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: meetings } = await supabase
    .from("project_meetings")
    .select("id, title, notes, meeting_at, attendees_summary, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const invoiceResult = await supabase
    .from("billing_invoice_records")
    .select(
      "id, funding_award_id, invoice_number, consultant_name, billing_basis, status, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at, funding_awards(id, title)"
    )
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(6);
  const projectInvoices = looksLikePendingSchema(invoiceResult.error?.message)
    ? []
    : ((invoiceResult.data ?? []) as BillingInvoiceRow[]).map((invoice) => ({
        ...invoice,
        fundingAward: Array.isArray(invoice.funding_awards) ? (invoice.funding_awards[0] ?? null) : invoice.funding_awards ?? null,
      }));
  const projectInvoicesPending = looksLikePendingSchema(invoiceResult.error?.message);

  const projectFundingProfileResult = await supabase
    .from("project_funding_profiles")
    .select("id, project_id, funding_need_amount, local_match_need_amount, notes, updated_at")
    .eq("project_id", project.id)
    .maybeSingle();
  const projectFundingProfile = looksLikePendingSchema(projectFundingProfileResult.error?.message)
    ? null
    : ((projectFundingProfileResult.data ?? null) as ProjectFundingProfileRow | null);
  const projectFundingProfilePending = looksLikePendingSchema(projectFundingProfileResult.error?.message);

  const fundingAwardsResult = await supabase
    .from("funding_awards")
    .select(
      "id, project_id, program_id, funding_opportunity_id, title, awarded_amount, match_amount, match_posture, obligation_due_at, spending_status, risk_flag, notes, updated_at, created_at, funding_opportunities(id, title), programs(id, title)"
    )
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(8);
  const fundingAwards = looksLikePendingSchema(fundingAwardsResult.error?.message)
    ? []
    : ((fundingAwardsResult.data ?? []) as FundingAwardRow[]).map((item) => ({
        ...item,
        opportunity: Array.isArray(item.funding_opportunities)
          ? (item.funding_opportunities[0] ?? null)
          : item.funding_opportunities ?? null,
        program: Array.isArray(item.programs) ? (item.programs[0] ?? null) : item.programs ?? null,
      }));
  const fundingAwardsPending = looksLikePendingSchema(fundingAwardsResult.error?.message);

  const fundingOpportunitiesResult = await supabase
    .from("funding_opportunities")
    .select(
      "id, program_id, project_id, title, opportunity_status, decision_state, agency_name, owner_label, cadence_label, expected_award_amount, opens_at, closes_at, decision_due_at, fit_notes, readiness_notes, decision_rationale, decided_at, summary, updated_at, created_at, programs(id, title)"
    )
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);
  const fundingOpportunities = looksLikePendingSchema(fundingOpportunitiesResult.error?.message)
    ? []
    : ((fundingOpportunitiesResult.data ?? []) as FundingOpportunityRow[]).map((item) => ({
        ...item,
        program: Array.isArray(item.programs) ? (item.programs[0] ?? null) : item.programs ?? null,
      }));
  const fundingOpportunitiesPending = looksLikePendingSchema(fundingOpportunitiesResult.error?.message);

  const datasetLinksResult = await supabase
    .from("data_dataset_project_links")
    .select("dataset_id, relationship_type, linked_at")
    .eq("project_id", project.id)
    .order("linked_at", { ascending: false });

  const datasetLinkRows = looksLikePendingSchema(datasetLinksResult.error?.message)
    ? []
    : ((datasetLinksResult.data ?? []) as Array<{
        dataset_id: string;
        relationship_type: string;
        linked_at: string;
      }>);

  const linkedDatasetIds = datasetLinkRows.map((item) => item.dataset_id);

  const datasetsResult = linkedDatasetIds.length
    ? await supabase
        .from("data_datasets")
        .select("id, connector_id, name, status, vintage_label, last_refreshed_at")
        .in("id", linkedDatasetIds)
    : { data: [], error: null };

  const linkedDatasetRows = looksLikePendingSchema(datasetsResult.error?.message)
    ? []
    : ((datasetsResult.data ?? []) as Array<{
        id: string;
        connector_id: string | null;
        name: string;
        status: string;
        vintage_label: string | null;
        last_refreshed_at: string | null;
      }>);

  const linkedConnectorIds = linkedDatasetRows
    .map((item) => item.connector_id)
    .filter((value): value is string => Boolean(value));

  const connectorsResult = linkedConnectorIds.length
    ? await supabase.from("data_connectors").select("id, display_name").in("id", linkedConnectorIds)
    : { data: [], error: null };

  const connectorMap = new Map(
    (looksLikePendingSchema(connectorsResult.error?.message)
      ? []
      : ((connectorsResult.data ?? []) as Array<{ id: string; display_name: string }>)).map((connector) => [
      connector.id,
      connector.display_name,
    ])
  );

  const datasetMap = new Map(linkedDatasetRows.map((dataset) => [dataset.id, dataset]));
  const linkedDatasets: LinkedDatasetItem[] = datasetLinkRows
    .map((link) => {
      const dataset = datasetMap.get(link.dataset_id);
      if (!dataset) return null;
      return {
        datasetId: dataset.id,
        name: dataset.name,
        status: dataset.status,
        relationshipType: link.relationship_type,
        connectorLabel: dataset.connector_id ? connectorMap.get(dataset.connector_id) ?? null : null,
        vintageLabel: dataset.vintage_label,
        lastRefreshedAt: dataset.last_refreshed_at,
      } satisfies LinkedDatasetItem;
    })
    .filter((item): item is LinkedDatasetItem => Boolean(item))
    .slice(0, 6);

  const dataHubMigrationPending = looksLikePendingSchema(datasetLinksResult.error?.message);

  const stageGateSummary = buildProjectStageGateSummary(recentGateDecisions as Array<{
    gate_id: string;
    decision: string;
    rationale: string | null;
    decided_at: string | null;
    missing_artifacts?: string[] | null;
  }>);

  const now = new Date();
  const prioritizedMilestones = [...milestones].sort((left, right) => {
    const priorityDiff = milestonePriority(left, now) - milestonePriority(right, now);
    if (priorityDiff !== 0) return priorityDiff;
    return compareDateValues(left.target_date, right.target_date);
  });
  const prioritizedSubmittals = [...submittals].sort((left, right) => {
    const priorityDiff = submittalPriority(left, now) - submittalPriority(right, now);
    if (priorityDiff !== 0) return priorityDiff;
    return compareDateValues(left.due_date, right.due_date);
  });
  const prioritizedProjectInvoices = [...projectInvoices].sort((left, right) => {
    const priorityDiff = invoicePriority(left, now) - invoicePriority(right, now);
    if (priorityDiff !== 0) return priorityDiff;
    return compareDateValues(left.due_date, right.due_date);
  });
  const firstBlockedMilestone = prioritizedMilestones.find((milestone) => milestone.status === "blocked") ?? null;
  const firstOverdueMilestone =
    prioritizedMilestones.find(
      (milestone) => milestone.status !== "complete" && parseSortableDate(milestone.target_date) < now.getTime()
    ) ?? null;
  const firstOverdueSubmittal =
    prioritizedSubmittals.find(
      (submittal) => submittal.status !== "accepted" && parseSortableDate(submittal.due_date) < now.getTime()
    ) ?? null;
  const firstOverdueInvoice =
    prioritizedProjectInvoices.find(
      (invoice) => !["paid", "rejected"].includes(invoice.status) && parseSortableDate(invoice.due_date) < now.getTime()
    ) ?? null;
  const awardLinkedProjectInvoices = projectInvoices.filter((invoice) => Boolean(invoice.funding_award_id));
  const fundingStackSummary = buildProjectFundingStackSummary(
    projectFundingProfile,
    fundingAwards,
    fundingOpportunities,
    awardLinkedProjectInvoices
  );
  const fundingNeedAmount = fundingStackSummary.fundingNeedAmount;
  const committedFundingAmount = fundingStackSummary.committedFundingAmount;
  const committedMatchAmount = fundingStackSummary.committedMatchAmount;
  const likelyFundingAmount = fundingStackSummary.likelyFundingAmount;
  const remainingFundingGap = fundingStackSummary.unfundedAfterLikelyAmount;
  const awardWatchCount = fundingStackSummary.awardRiskCount;
  const nextObligationAward = fundingAwards.find((award) => award.obligation_due_at === fundingStackSummary.nextObligationAt) ?? null;
  const pursueFundingCount = fundingOpportunities.filter((item) => item.decision_state === "pursue").length;
  const monitorFundingCount = fundingOpportunities.filter((item) => item.decision_state === "monitor").length;
  const skipFundingCount = fundingOpportunities.filter((item) => item.decision_state === "skip").length;
  const openFundingCount = fundingOpportunities.filter((item) => item.opportunity_status === "open").length;
  const pursuedFundingAmount = fundingOpportunities.reduce((sum, item) => {
    if (item.decision_state !== "pursue" || item.opportunity_status === "awarded" || item.opportunity_status === "archived") {
      return sum;
    }
    return sum + Number(item.expected_award_amount ?? 0);
  }, 0);
  const linkedRtpCycleCount = existingRtpLinks.length;
  const constrainedRtpLinkCount = existingRtpLinks.filter((link) => link.portfolioRole === "constrained").length;
  const illustrativeRtpLinkCount = existingRtpLinks.filter((link) => link.portfolioRole === "illustrative").length;
  const candidateRtpLinkCount = existingRtpLinks.filter((link) => link.portfolioRole === "candidate").length;
  const invoiceSummary = summarizeBillingInvoiceRecords(projectInvoices);
  const invoiceSummaryByFundingAwardId = new Map(
    fundingAwards.map((award) => [
      award.id,
      summarizeBillingInvoiceRecords(projectInvoices.filter((invoice) => invoice.funding_award_id === award.id)),
    ])
  );
  const invoiceRecordsByFundingAwardId = new Map(
    fundingAwards.map((award) => [award.id, projectInvoices.filter((invoice) => invoice.funding_award_id === award.id)])
  );
  const unlinkedProjectInvoices = projectInvoices.filter((invoice) => !invoice.funding_award_id);
  const unlinkedProjectInvoiceSummary = summarizeBillingInvoiceRecords(unlinkedProjectInvoices);
  const projectReportIds = ((projectReportData ?? []) as ProjectReportRow[]).map(
    (report) => report.id
  );
  const reportArtifactsResult = projectReportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", projectReportIds)
        .order("generated_at", { ascending: false })
    : { data: [], error: null };
  const latestArtifactByReportId = new Map<string, ReportArtifactRow>();
  for (const artifact of (reportArtifactsResult.data ?? []) as ReportArtifactRow[]) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, artifact);
    }
  }

  const projectReports = ((projectReportData ?? []) as ProjectReportRow[])
    .map((report) => {
      const comparisonAggregate = parseStoredComparisonSnapshotAggregate(
        latestArtifactByReportId.get(report.id)?.metadata_json ?? null
      );
      const comparisonDigest = describeComparisonSnapshotAggregate(
        comparisonAggregate
      );
      const evidenceChainDigest = describeEvidenceChainSummary(
        parseStoredEvidenceChainSummary(
          latestArtifactByReportId.get(report.id)?.metadata_json ?? null
        )
      );

      return {
        ...report,
        packetFreshness: getReportPacketFreshness({
          latestArtifactKind: report.latest_artifact_kind,
          generatedAt: latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at,
          updatedAt: report.updated_at,
        }),
        comparisonAggregate,
        comparisonDigest,
        evidenceChainDigest,
      };
    })
    .sort((left, right) => {
      const freshnessPriority =
        getReportPacketPriority(left.packetFreshness.label) -
        getReportPacketPriority(right.packetFreshness.label);
      if (freshnessPriority !== 0) {
        return freshnessPriority;
      }

      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  const reportRecordCount = projectReportCount ?? projectReports.length;
  const refreshRecommendedReportCount = projectReports.filter(
    (report) => report.packetFreshness.label === "Refresh recommended"
  ).length;
  const noPacketReportCount = projectReports.filter(
    (report) => report.packetFreshness.label === "No packet"
  ).length;
  const evidenceBackedReportCount = projectReports.filter(
    (report) => Boolean(report.evidenceChainDigest)
  ).length;
  const comparisonBackedReportCount = projectReports.filter(
    (report) => Boolean(report.comparisonDigest)
  ).length;
  const governanceHoldReportCount = projectReports.filter(
    (report) => Boolean(report.evidenceChainDigest?.blockedGateDetail)
  ).length;
  const reportAttentionCount = refreshRecommendedReportCount + noPacketReportCount;
  const recommendedReport = projectReports[0] ?? null;
  const comparisonBackedFundingReport =
    projectReports.find((report) => Boolean(report.comparisonDigest)) ?? null;
  const projectGrantModelingEvidence =
    comparisonBackedFundingReport?.comparisonAggregate && comparisonBackedFundingReport.comparisonDigest
      ? {
          projectId: project.id,
          comparisonBackedCount: comparisonBackedReportCount,
          leadComparisonReport: {
            id: comparisonBackedFundingReport.id,
            title: comparisonBackedFundingReport.title,
            href: getReportNavigationHref(
              comparisonBackedFundingReport.id,
              comparisonBackedFundingReport.packetFreshness.label
            ),
            packetFreshness: comparisonBackedFundingReport.packetFreshness,
            comparisonAggregate: comparisonBackedFundingReport.comparisonAggregate,
            comparisonDigest: comparisonBackedFundingReport.comparisonDigest,
          },
        }
      : null;
  const projectGrantModelingReadiness = describeProjectGrantModelingReadiness(
    projectGrantModelingEvidence
  );
  const projectGrantModelingSupport = buildGrantDecisionModelingSupport(
    projectGrantModelingEvidence,
    project.name
  );
  const projectReportQueueItems = projectReports.slice(0, 4).map((report) => {
    const badges: Array<{ label: string; value?: string | number | null }> = [];
    if (report.packetFreshness.label !== "Packet current") {
      badges.push({ label: report.packetFreshness.label });
    }
    if (report.comparisonDigest) {
      badges.push({ label: "Comparison-backed" });
    }
    if (report.evidenceChainDigest?.blockedGateDetail) {
      badges.push({ label: "Governance hold" });
    }

    return {
      key: report.id,
      href: getReportNavigationHref(report.id, report.packetFreshness.label),
      title: report.title,
      subtitle:
        report.packetFreshness.label === "Refresh recommended"
          ? `First action: refresh ${report.title}`
          : report.packetFreshness.label === "No packet"
            ? `First action: generate ${report.title}`
            : report.evidenceChainDigest?.blockedGateDetail
              ? `First action: review governance hold in ${report.title}`
              : report.comparisonDigest
                ? `First action: review comparison-backed packet ${report.title}`
                : `First action: review ${report.title}`,
      detail:
        report.evidenceChainDigest?.blockedGateDetail ??
        report.comparisonDigest?.detail ??
        report.packetFreshness.detail,
      badges,
    };
  });
  const projectControlsSummary = buildProjectControlsSummary(
    milestones,
    submittals,
    projectInvoices,
    {
      refreshRecommendedCount: refreshRecommendedReportCount,
      noPacketCount: noPacketReportCount,
      comparisonBackedCount: comparisonBackedReportCount,
      recommendedReportId: recommendedReport?.id ?? null,
      recommendedReportTitle: recommendedReport?.title ?? null,
    },
    now
  );

  const aerialMissionsResult = await supabase
    .from("aerial_missions")
    .select("id, title, status, mission_type, geography_label, collected_at, updated_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false });
  const aerialMissions = looksLikePendingSchema(aerialMissionsResult.error?.message)
    ? []
    : ((aerialMissionsResult.data ?? []) as Array<{
        id: string;
        title: string;
        status: string;
        mission_type: string;
        geography_label: string | null;
        collected_at: string | null;
        updated_at: string;
      }>);
  const aerialMissionIds = aerialMissions.map((m) => m.id);
  const aerialPackagesResult = aerialMissionIds.length
    ? await supabase
        .from("aerial_evidence_packages")
        .select("id, mission_id, title, package_type, status, verification_readiness, updated_at")
        .in("mission_id", aerialMissionIds)
        .order("updated_at", { ascending: false })
    : { data: [], error: null };
  const aerialPackages = looksLikePendingSchema(aerialPackagesResult.error?.message)
    ? []
    : ((aerialPackagesResult.data ?? []) as Array<{
        id: string;
        mission_id: string;
        title: string;
        package_type: string;
        status: string;
        verification_readiness: string;
        updated_at: string;
      }>);
  const aerialProjectPosture = buildAerialProjectPosture(aerialMissions, aerialPackages);
  const aerialProjectPostureDetail = describeAerialProjectPosture(aerialProjectPosture);

  const operationsSummary = await operationsSummaryPromise;

  const timelineItems: TimelineItem[] = [
    ...milestones.map((item) => ({
      id: `milestone-${item.id}`,
      type: "milestone",
      title: item.title,
      description: item.summary || item.notes || "Milestone added to the project control room.",
      at: item.actual_date || item.target_date || item.created_at,
      badge: `Milestone · ${titleize(item.status)}`,
      tone: toneForMilestoneStatus(item.status),
    })),
    ...submittals.map((item) => ({
      id: `submittal-${item.id}`,
      type: "submittal",
      title: item.title,
      description:
        item.notes ||
        `${titleize(item.submittal_type)}${item.agency_label ? ` · ${item.agency_label}` : ""}`,
      at: item.submitted_at || item.due_date || item.created_at,
      badge: `Submittal · ${titleize(item.status)}`,
      tone: toneForSubmittalStatus(item.status),
    })),
    ...projectInvoices.map((item) => ({
      id: `invoice-${item.id}`,
      type: "invoice",
      title: item.invoice_number,
      description: `${fmtCurrency(item.net_amount)} net${item.submitted_to ? ` · ${item.submitted_to}` : ""}`,
      at: item.invoice_date || item.created_at,
      badge: `Invoice · ${titleize(item.status)}`,
      tone: toneForInvoiceStatus(item.status),
    })),
    ...(deliverables ?? []).map((item) => ({
      id: `deliverable-${item.id}`,
      type: "deliverable",
      title: item.title,
      description: item.summary || "Deliverable added to project.",
      at: item.created_at,
      badge: `Deliverable · ${titleize(item.status)}`,
      tone: toneForDeliverableStatus(item.status),
    })),
    ...(risks ?? []).map((item) => ({
      id: `risk-${item.id}`,
      type: "risk",
      title: item.title,
      description: item.description || "Risk recorded for this project.",
      at: item.created_at,
      badge: `Risk · ${titleize(item.severity)}`,
      tone: toneForRiskSeverity(item.severity),
    })),
    ...(issues ?? []).map((item) => ({
      id: `issue-${item.id}`,
      type: "issue",
      title: item.title,
      description: item.description || "Issue logged for this project.",
      at: item.created_at,
      badge: `Issue · ${titleize(item.status)}`,
      tone: toneForRiskSeverity(item.severity),
    })),
    ...(decisions ?? []).map((item) => ({
      id: `decision-${item.id}`,
      type: "decision",
      title: item.title,
      description: item.rationale,
      at: item.decided_at || item.created_at,
      badge: `Decision · ${titleize(item.status)}`,
      tone: toneForDecision(item.status),
    })),
    ...(meetings ?? []).map((item) => ({
      id: `meeting-${item.id}`,
      type: "meeting",
      title: item.title,
      description: item.notes || item.attendees_summary || "Meeting logged for this project.",
      at: item.meeting_at || item.created_at,
      badge: "Meeting",
      tone: "info" as const,
    })),
    ...(recentRuns ?? []).map((item) => ({
      id: `run-${item.id}`,
      type: "run",
      title: item.title,
      description: item.summary_text || "Analysis run created.",
      at: item.created_at,
      badge: "Analysis Run",
      tone: "success" as const,
    })),
    ...(recentGateDecisions ?? []).map((item) => ({
      id: `gate-${item.id}`,
      type: "gate",
      title: item.gate_id,
      description: item.rationale,
      at: item.decided_at,
      badge: `Stage Gate · ${item.decision}`,
      tone: toneForDecision(item.decision),
    })),
  ]
    .sort((a, b) => {
      const aTime = a.at ? new Date(a.at).getTime() : 0;
      const bTime = b.at ? new Date(b.at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 12);

  const openRiskCount = (risks ?? []).filter((risk) => risk.status !== "closed" && risk.status !== "mitigated").length;
  const openIssueCount = (issues ?? []).filter((issue) => issue.status !== "resolved").length;

  return (
    <section className="module-page">
      <div className="module-breadcrumb">
        <Link href="/projects" className="transition hover:text-foreground">
          Projects
        </Link>
        <ArrowRight className="h-4 w-4" />
        <span className="text-foreground">{project.name}</span>
      </div>

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <StatusBadge tone={toneForStatus(project.status)}>{titleize(project.status)}</StatusBadge>
            <span className="module-record-chip"><span>Type</span><strong>{titleize(project.plan_type)}</strong></span>
          </div>
          <p className="text-[0.73rem] text-muted-foreground">
            {titleize(project.delivery_phase)} · Controls {titleize(projectControlsSummary.controlHealth)}{linkedRtpCycleCount > 0 ? ` · RTP ${linkedRtpCycleCount} linked` : ""} · {workspaceData?.name ?? "Unknown workspace"} · Updated {fmtDateTime(project.updated_at)}
          </p>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{project.name}</h1>
            <p className="module-intro-description">
              {project.summary ||
                "Use this detail view to keep runs, milestones, submittals, invoices, deliverables, risks, issues, decisions, meetings, and linked datasets tied to the project."}
            </p>
          </div>

          <div className="module-summary-grid cols-6">
            <div className="module-summary-card">
              <p className="module-summary-label">Deliverables</p>
              <p className="module-summary-value">{deliverables?.length ?? 0}</p>
              <p className="module-summary-detail">Outputs actively tracked in this control room.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Open risks</p>
              <p className="module-summary-value">{openRiskCount}</p>
              <p className="module-summary-detail">Risks still requiring active attention or mitigation.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Open issues</p>
              <p className="module-summary-value">{openIssueCount}</p>
              <p className="module-summary-detail">Current blockers surfaced for delivery and analysis flow.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Milestones</p>
              <p className="module-summary-value">{projectControlsSummary.milestoneCount}</p>
              <p className="module-summary-detail">Phase checkpoints and operator deadlines on the record.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Pending submittals</p>
              <p className="module-summary-value">{projectControlsSummary.pendingSubmittalCount}</p>
              <p className="module-summary-detail">Packets still in draft, review, or submitted posture.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">RTP cycles</p>
              <p className="module-summary-value">{linkedRtpCycleCount}</p>
              <p className="module-summary-detail">Regional plan cycles this project is now attached to.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <FolderKanban className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Project control room</p>
              <h2 className="module-operator-title">LAPM-oriented controls are now visible, not implied</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            OpenPlan now treats milestones, submittals, and invoice posture as first-class project controls instead of burying them inside generic notes.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Workspace tier: {titleize(workspaceData?.plan ?? "pilot")}</div>
            <div className="module-operator-item">
              Stage-gate template: {workspaceData?.stage_gate_template_id ?? "Not available"}
            </div>
            <div className="module-operator-item">
              Template version: {workspaceData?.stage_gate_template_version ?? "Not available"} · Workspace slug: {workspaceData?.slug ?? "Unknown"}
            </div>
            <div className="module-operator-item">CALTRANS posture is aligned to gate domains and invoice/submittal workflow, while exact exhibit/form IDs remain deferred in v0.1.</div>
          </div>
        </article>
      </header>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              <Target className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Portfolio</p>
              <h2 className="module-section-title">RTP portfolio posture</h2>
              <p className="module-section-description">
                Start making project prioritization explicit by attaching this project to one or more RTP cycles with a clear role and rationale.
              </p>
            </div>
          </div>
        </div>

        <div className="module-summary-grid cols-4 mt-5">
          <div className="module-summary-card">
            <p className="module-summary-label">Linked cycles</p>
            <p className="module-summary-value">{linkedRtpCycleCount}</p>
            <p className="module-summary-detail">Total RTP update cycles connected to this project.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Constrained</p>
            <p className="module-summary-value">{constrainedRtpLinkCount}</p>
            <p className="module-summary-detail">Projects positioned inside the fiscally constrained portfolio.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Illustrative</p>
            <p className="module-summary-value">{illustrativeRtpLinkCount}</p>
            <p className="module-summary-detail">Projects visible for aspiration or later advancement.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Candidate</p>
            <p className="module-summary-value">{candidateRtpLinkCount}</p>
            <p className="module-summary-detail">Projects still being framed before final portfolio posture.</p>
          </div>
        </div>

        <div className="mt-5">
          {projectRtpLinksPending ? (
            <div className="rounded-[0.5rem] border border-amber-300/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
              RTP linkage schema is not available yet in this environment. Run the latest migration, then this project can attach into RTP cycle portfolio tracking.
            </div>
          ) : (
            <ProjectRtpLinker
              projectId={project.id}
              availableCycles={workspaceRtpCycles.map((cycle) => ({
                id: cycle.id,
                title: cycle.title,
                status: cycle.status,
                geographyLabel: cycle.geography_label,
                horizonStartYear: cycle.horizon_start_year,
                horizonEndYear: cycle.horizon_end_year,
              }))}
              existingLinks={existingRtpLinks}
            />
          )}
        </div>
      </article>

      <article id="project-reporting" className="module-section-surface scroll-mt-24">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
              <FileStack className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Reporting</p>
              <h2 className="module-section-title">Packet freshness and regeneration cues</h2>
              <p className="module-section-description">
                Project-level reporting should tell the team whether they already have a usable packet, need to regenerate one, or still need the first report record.
              </p>
            </div>
          </div>
        </div>

        <div className="module-summary-grid cols-6 mt-5">
          <div className="module-summary-card">
            <p className="module-summary-label">Report records</p>
            <p className="module-summary-value">{reportRecordCount}</p>
            <p className="module-summary-detail">Report packets and drafts linked to this project.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Needs attention</p>
            <p className="module-summary-value">{reportAttentionCount}</p>
            <p className="module-summary-detail">Reports that still need packet updates.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Evidence-backed</p>
            <p className="module-summary-value">{evidenceBackedReportCount}</p>
            <p className="module-summary-detail">Reports with source-summary details attached.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Refresh recommended</p>
            <p className="module-summary-value">{refreshRecommendedReportCount}</p>
            <p className="module-summary-detail">Report packets that drifted after generation.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Governance holds</p>
            <p className="module-summary-value">{governanceHoldReportCount}</p>
            <p className="module-summary-detail">Packets that surfaced a blocked gate in the latest evidence snapshot.</p>
          </div>
        </div>

        {projectReports.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">
            No reports are linked to this project yet. Create the first report packet to start a review trail.
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <ReportPacketCommandQueue
              title="Project packet queue"
              description="The next report packet actions inside this project, ordered before the full report list below."
              items={projectReportQueueItems}
              emptyLabel="No queued report packet work in this project right now."
            />

            <div className="grid gap-4 md:grid-cols-[0.92fr_1.08fr]">
            <div
              className={`rounded-[0.75rem] border p-5 ${
                reportAttentionCount > 0
                  ? "border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20"
                  : "border-emerald-400/35 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Reporting posture
              </p>
              <h3 className="mt-2 text-sm font-semibold text-foreground">
                {reportAttentionCount > 0 && recommendedReport
                  ? `${recommendedReport.title} needs attention`
                  : "Packet trail looks current"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {recommendedReport
                  ? getReportPacketActionLabel(recommendedReport.packetFreshness.label)
                  : "Open reports to create the first packet for this project."}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {recommendedReport?.packetFreshness.detail ??
                  "No reports are linked to this project yet."}
              </p>
              {recommendedReport?.comparisonDigest ? (
                <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-2.5">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Comparison posture
                  </p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/90">
                    {recommendedReport.comparisonDigest.headline}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {recommendedReport.comparisonDigest.detail}
                  </p>
                </div>
              ) : null}
              {projectGrantModelingEvidence ? (
                <div
                  id="project-packet-release-review"
                  className="mt-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2.5"
                >
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Packet release review
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StatusBadge tone={projectGrantModelingReadiness?.tone ?? "neutral"}>
                      {projectGrantModelingReadiness?.label ?? "No visible support"}
                    </StatusBadge>
                    <StatusBadge tone={projectGrantModelingEvidence.leadComparisonReport.packetFreshness.tone}>
                      {projectGrantModelingEvidence.leadComparisonReport.packetFreshness.label}
                    </StatusBadge>
                    <StatusBadge tone="info">
                      Suggested {titleize(projectGrantModelingSupport.recommendedDecisionState)}
                    </StatusBadge>
                  </div>
                  <p className="mt-2 text-xs font-medium leading-relaxed text-foreground/90">
                    {projectGrantModelingSupport.recommendedNextActionTitle}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {projectGrantModelingSupport.recommendedNextActionSummary}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={projectGrantModelingEvidence.leadComparisonReport.href}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary/35 hover:text-primary"
                    >
                      Open packet review
                    </Link>
                    <Link
                      href={`/grants?focusProjectId=${project.id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary/35 hover:text-primary"
                    >
                      Open Grants OS
                    </Link>
                  </div>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {recommendedReport ? (
                  <Link
                    href={getReportNavigationHref(
                      recommendedReport.id,
                      recommendedReport.packetFreshness.label
                    )}
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary/35 hover:text-primary"
                  >
                    Open report
                  </Link>
                ) : null}
                <Link
                  href="/reports"
                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary/35 hover:text-primary"
                >
                  Open reports
                </Link>
              </div>
            </div>

            <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Recent report records
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-foreground">
                    {reportRecordCount > projectReports.length
                      ? `Showing ${projectReports.length} most recent of ${reportRecordCount}`
                      : `Showing ${projectReports.length} most recent report records`}
                  </h3>
                </div>
                {reportAttentionCount > 0 ? (
                  <StatusBadge tone="warning">{reportAttentionCount} need attention</StatusBadge>
                ) : (
                  <StatusBadge tone="success">Packets current</StatusBadge>
                )}
                {comparisonBackedReportCount > 0 ? (
                  <StatusBadge tone="info">{comparisonBackedReportCount} comparison-backed</StatusBadge>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {projectReports.map((report) => (
                  <Link
                    key={report.id}
                    id={`project-report-${report.id}`}
                    href={`/reports/${report.id}`}
                    className="block rounded-[0.5rem] border border-border/70 bg-card/70 p-4 transition-colors hover:border-primary/35 hover:bg-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <h4 className="text-sm font-semibold text-foreground">{report.title}</h4>
                        <p className="text-sm text-muted-foreground">
                          {report.summary || "No summary provided yet."}
                        </p>
                      </div>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <StatusBadge tone={reportStatusTone(report.status)}>
                        {formatReportStatusLabel(report.status)}
                      </StatusBadge>
                      <StatusBadge tone="info">
                        {formatReportTypeLabel(report.report_type)}
                      </StatusBadge>
                    </div>
                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">{report.packetFreshness.label} · {report.packetFreshness.detail}</p>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      {report.packetFreshness.detail}
                    </p>
                    {report.evidenceChainDigest ? (
                      <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-2.5">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Evidence posture
                        </p>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/90">
                          {report.evidenceChainDigest.headline}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {report.evidenceChainDigest.detail}
                        </p>
                        {report.evidenceChainDigest.blockedGateDetail ? (
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {report.evidenceChainDigest.blockedGateDetail}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {report.comparisonDigest ? (
                      <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-2.5">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Comparison posture
                        </p>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/90">
                          {report.comparisonDigest.headline}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {report.comparisonDigest.detail}
                        </p>
                      </div>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
            </div>
          </div>
        )}
      </article>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <ProjectRecordComposer projectId={project.id} />
          <WorkspaceRuntimeCue summary={operationsSummary} />
          <WorkspaceCommandBoard
            summary={operationsSummary}
            label="Workspace command board"
            title="What should move around this project"
            description={`This project now sits inside the same shared workspace command queue as the dashboard, registries, detail pages, and assistant runtime. Use it to keep ${project.name} aligned with broader packet, funding-window, and setup pressure across the workspace.`}
          />
        </div>

        <article id="project-governance" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Governance</p>
                <h2 className="module-section-title">Stage-gate compliance cockpit</h2>
                <p className="module-section-description">
                  This is the project-delivery control layer: where LAPM, CEQA/VMT, outreach, and programming readiness stop being abstract and start becoming an explicit workflow.
                </p>
              </div>
            </div>
          </div>

          <div className="module-summary-grid cols-4 mt-5">
            <div className="module-summary-card">
              <p className="module-summary-label">Pass gates</p>
              <p className="module-summary-value">{stageGateSummary.passCount}</p>
              <p className="module-summary-detail">Recorded passes against the active California gate scaffold.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Hold gates</p>
              <p className="module-summary-value">{stageGateSummary.holdCount}</p>
              <p className="module-summary-detail">Gates currently blocked by missing evidence or unresolved rationale.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Not started</p>
              <p className="module-summary-value">{stageGateSummary.notStartedCount}</p>
              <p className="module-summary-detail">Template-defined gates with no recorded decision yet.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Next gate</p>
              <p className="module-summary-value text-base leading-tight">
                {stageGateSummary.nextGate ? `G${String(stageGateSummary.nextGate.sequence).padStart(2, "0")}` : "None"}
              </p>
              <p className="module-summary-detail">{stageGateSummary.nextGate?.name ?? "All gates currently pass."}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 mt-5">
            <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
              <div className="flex items-center gap-3">
                <FileClock className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Blocking condition</p>
                  <h3 className="text-sm font-semibold text-foreground">{stageGateSummary.blockedGate?.name ?? "No gate currently on formal hold"}</h3>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {stageGateSummary.blockedGate?.rationale ?? "Record the first hold decision to show the current blocker here."}
              </p>
              {stageGateSummary.blockedGate?.missingArtifacts.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {stageGateSummary.blockedGate.missingArtifacts.map((artifact) => (
                    <StatusBadge key={artifact} tone="warning">Missing {artifact}</StatusBadge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
              <div className="flex items-center gap-3">
                <Clock3 className="h-5 w-5 text-sky-500" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Readiness cue</p>
                  <h3 className="text-sm font-semibold text-foreground">
                    {stageGateSummary.nextGate ? `${stageGateSummary.nextGate.gateId} · ${stageGateSummary.nextGate.name}` : "Gate sequence complete"}
                  </h3>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {stageGateSummary.nextGate
                  ? `${stageGateSummary.nextGate.requiredEvidenceCount} required evidence item${stageGateSummary.nextGate.requiredEvidenceCount === 1 ? "" : "s"} defined in the active template. ${stageGateSummary.nextGate.operatorControlEvidenceCount > 0 ? `${stageGateSummary.nextGate.operatorControlEvidenceCount} PM/invoicing control profile${stageGateSummary.nextGate.operatorControlEvidenceCount === 1 ? " is" : "s are"} available for this review.` : "Build the evidence pack before expecting a pass decision."}`
                  : "Every stage gate in the active template currently has a recorded PASS decision."}
              </p>
            </div>
          </div>

          <div className="mt-5 module-record-list">
            {stageGateSummary.gates.map((gate) => (
              <div key={gate.gateId} className="module-record-row">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={gate.workflowState === "pass" ? "success" : gate.workflowState === "hold" ? "warning" : "neutral"}>
                      {gate.decisionLabel}
                    </StatusBadge>
                    <StatusBadge tone="neutral">{gate.gateId}</StatusBadge>
                    <StatusBadge tone="info">{gate.requiredEvidenceCount} required evidence</StatusBadge>
                    {gate.operatorControlEvidenceCount > 0 ? (
                      <StatusBadge tone="info">{gate.operatorControlEvidenceCount} PM/invoicing controls</StatusBadge>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{gate.sequence}. {gate.name}</h3>
                      <p className="module-record-stamp">{gate.decidedAt ? fmtDateTime(gate.decidedAt) : "No decision yet"}</p>
                    </div>
                    <p className="module-record-summary">{gate.rationale}</p>
                  </div>

                  <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                    {[
                      ...gate.lapmMappings.slice(0, 2).map((item) => `LAPM ${item}`),
                      ...gate.ceqaVmtMappings.slice(0, 2).map((item) => `CEQA/VMT ${item}`),
                      ...gate.outreachMappings.slice(0, 1).map((item) => `Outreach ${item}`),
                      ...gate.stipRtipMappings.slice(0, 1).map((item) => `Programming ${item}`),
                    ].join(" · ") || "No compliance mappings recorded"}
                  </p>

                  {gate.evidencePreview.length > 0 ? (
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">Evidence preview</p>
                      <ul className="list-disc space-y-1 pl-5">
                        {gate.evidencePreview.map((evidence) => (
                          <li key={evidence.evidence_id}>
                            <div>
                              {evidence.title}
                              {evidence.conditional_required_when ? ` (${evidence.conditional_required_when})` : ""}
                            </div>
                            {evidence.operatorControlTitle ? (
                              <div className="mt-1 space-y-1 pl-1 text-xs text-muted-foreground">
                                <p>
                                  PM/invoicing controls: {evidence.operatorControlTitle} · {evidence.operatorControlFieldCount} field{evidence.operatorControlFieldCount === 1 ? "" : "s"}
                                </p>
                                {evidence.operatorControlGoal ? <p>{evidence.operatorControlGoal}</p> : null}
                                {evidence.operatorControlAcceptancePreview.length > 0 ? (
                                  <ul className="list-disc space-y-1 pl-5">
                                    {evidence.operatorControlAcceptancePreview.map((criterion) => (
                                      <li key={`${evidence.evidence_id}-${criterion}`}>{criterion}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {gate.missingArtifacts.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {gate.missingArtifacts.map((artifact) => (
                        <StatusBadge key={`${gate.gateId}-${artifact}`} tone="warning">Missing {artifact}</StatusBadge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="module-note mt-5 text-sm">
            California/LAPM alignment is honest here: OpenPlan now tracks gate logic, evidence posture, milestones, submittals, and invoicing cues, but it does not yet generate exact exhibit/form packets automatically.
          </div>
        </article>
      </div>

      <article id="project-funding-opportunities" className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Funding strategy</p>
              <h2 className="module-section-title">Candidate funding opportunities</h2>
              <p className="module-section-description">
                This project can now carry real pursue, monitor, or skip decisions against funding opportunities, with fit and readiness notes kept on the record.
              </p>
            </div>
          </div>
        </div>

        {projectFundingProfilePending || fundingAwardsPending ? (
          <div className="module-alert mt-5 text-sm">Funding stack and award records will appear after the funding award migrations are applied to the database.</div>
        ) : (
          <>
            <div className="module-summary-grid cols-6 mt-5">
              <div className="module-summary-card">
                <p className="module-summary-label">Funding need</p>
                <p className="module-summary-value text-base leading-tight">{fmtCurrency(fundingNeedAmount)}</p>
                <p className="module-summary-detail">Current project-level target need for funding stack planning.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Committed awards</p>
                <p className="module-summary-value text-base leading-tight">{fmtCurrency(committedFundingAmount)}</p>
                <p className="module-summary-detail">Awarded dollars already attached to this project.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Likely pursued</p>
                <p className="module-summary-value text-base leading-tight">{fmtCurrency(likelyFundingAmount)}</p>
                <p className="module-summary-detail">Expected dollars tied to opportunities currently marked pursue.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Still unfunded</p>
                <p className="module-summary-value text-base leading-tight">{fmtCurrency(remainingFundingGap)}</p>
                <p className="module-summary-detail">Gap still remaining after committed awards and likely pursued dollars.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Match tracked</p>
                <p className="module-summary-value text-base leading-tight">{fmtCurrency(committedMatchAmount)}</p>
                <p className="module-summary-detail">Local or partner match currently attached to awards.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Award risk</p>
                <p className="module-summary-value">{awardWatchCount}</p>
                <p className="module-summary-detail">Award record(s) flagged watch or critical.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3 mt-5">
              <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Funding stack posture</p>
                <div className="mt-2">
                  <StatusBadge tone={projectFundingStackTone(fundingStackSummary.pipelineStatus)}>{fundingStackSummary.pipelineLabel}</StatusBadge>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-foreground">
                  {fundingStackSummary.hasTargetNeed
                    ? `${Math.round((fundingStackSummary.pipelineCoverageRatio ?? 0) * 100)}% covered by committed + likely funding`
                    : "Funding target not set yet"}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {fundingStackSummary.hasTargetNeed
                    ? `${fmtCurrency(committedFundingAmount)} committed, ${fmtCurrency(likelyFundingAmount)} likely, leaving ${fmtCurrency(remainingFundingGap)} still unfunded against a ${fmtCurrency(fundingNeedAmount)} target need.`
                    : fundingStackSummary.pipelineReason}
                </p>
                {comparisonBackedFundingReport?.comparisonDigest ? (
                  <div className="module-note mt-3 text-sm">
                    Saved comparison context from {comparisonBackedFundingReport.title} can support grant planning language or prioritization framing for this funding stack. It is planning evidence to review against each funding source, not proof of award likelihood.
                  </div>
                ) : null}
              </div>
              <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Reimbursement posture</p>
                <div className="mt-2">
                  <StatusBadge tone={projectFundingReimbursementTone(fundingStackSummary.reimbursementStatus)}>
                    {fundingStackSummary.reimbursementLabel}
                  </StatusBadge>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-foreground">
                  {committedFundingAmount > 0
                    ? `${Math.round((fundingStackSummary.reimbursementCoverageRatio ?? 0) * 100)}% of committed awards invoiced`
                    : "No committed awards yet"}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {committedFundingAmount > 0
                    ? `${fmtCurrency(fundingStackSummary.requestedReimbursementAmount)} requested on linked award invoices, ${fmtCurrency(fundingStackSummary.paidReimbursementAmount)} paid, ${fmtCurrency(fundingStackSummary.outstandingReimbursementAmount)} outstanding, and ${fmtCurrency(fundingStackSummary.uninvoicedAwardAmount)} still not yet invoiced.`
                    : fundingStackSummary.reimbursementReason}
                </p>
                {unlinkedProjectInvoices.length > 0 ? (
                  <div className="module-note mt-3 text-sm">
                    {unlinkedProjectInvoices.length} project invoice record{unlinkedProjectInvoices.length === 1 ? " is" : "s are"} still unlinked to a funding award, totaling {fmtCurrency(unlinkedProjectInvoiceSummary.totalNetAmount)}. Those records are excluded from award reimbursement posture until linked in the billing register below.
                  </div>
                ) : null}
              </div>
              <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Next obligation</p>
                <h3 className="mt-2 text-sm font-semibold text-foreground">{nextObligationAward?.title ?? "No obligation date recorded"}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {nextObligationAward
                    ? `Obligation due ${fmtDateTime(nextObligationAward.obligation_due_at)}.`
                    : "Record obligation timing on awards so reimbursement and delivery risk can surface earlier."}
                </p>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr] mt-5">
              <ProjectFundingProfileEditor
                projectId={project.id}
                initialFundingNeedAmount={projectFundingProfile?.funding_need_amount ?? null}
                initialLocalMatchNeedAmount={projectFundingProfile?.local_match_need_amount ?? null}
                initialNotes={projectFundingProfile?.notes ?? null}
              />

              <ProjectFundingAwardCreator
                projectId={project.id}
                opportunityOptions={fundingOpportunities.map((opportunity) => ({ id: opportunity.id, title: opportunity.title }))}
              />
            </div>

            {projectFundingProfile?.notes ? (
              <div className="module-note mt-5 text-sm">Funding notes: {projectFundingProfile.notes}</div>
            ) : null}

            {unlinkedProjectInvoices.length > 0 ? (
              <div className="module-alert mt-5 text-sm">
                {unlinkedProjectInvoices.length} project invoice record{unlinkedProjectInvoices.length === 1 ? " is" : "s are"} not yet linked to a funding award. Reimbursement posture for the award stack only counts linked invoice chains, so review the billing register below to resolve the mismatch.
              </div>
            ) : null}

            {fundingAwards.length === 0 ? (
              <div className="module-empty-state mt-5 text-sm">No funding awards are recorded for this project yet.</div>
            ) : (
              <div className="mt-5 module-record-list">
                {fundingAwards.map((award) => {
                  const awardInvoiceSummary = invoiceSummaryByFundingAwardId.get(award.id);
                  const awardInvoices = invoiceRecordsByFundingAwardId.get(award.id) ?? [];

                  return (
                    <div key={award.id} className="module-record-row">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone={fundingAwardMatchPostureTone(award.match_posture)}>
                            {formatFundingAwardMatchPostureLabel(award.match_posture)}
                          </StatusBadge>
                          <StatusBadge tone={fundingAwardSpendingStatusTone(award.spending_status)}>
                            {formatFundingAwardSpendingStatusLabel(award.spending_status)}
                          </StatusBadge>
                          <StatusBadge tone={fundingAwardRiskFlagTone(award.risk_flag)}>
                            {formatFundingAwardRiskFlagLabel(award.risk_flag)}
                          </StatusBadge>
                          {award.program ? <StatusBadge tone="info">{award.program.title}</StatusBadge> : null}
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <h3 className="module-record-title">{award.title}</h3>
                            <p className="module-record-stamp">Updated {fmtDateTime(award.updated_at)}</p>
                          </div>
                          <p className="module-record-summary">{award.notes || "No award notes recorded yet."}</p>
                        </div>

                        <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                          Awarded {fmtCurrency(award.awarded_amount)} · Match {fmtCurrency(award.match_amount)} · Reimbursed {fmtCurrency(awardInvoiceSummary?.paidNetAmount ?? 0)} · Outstanding {fmtCurrency(awardInvoiceSummary?.outstandingNetAmount ?? 0)} · Obligation {fmtDateTime(award.obligation_due_at)}{award.opportunity?.title ? ` · ${award.opportunity.title}` : ""}
                        </p>

                        <div className="mt-4 rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                Linked invoice chain
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {awardInvoices.length > 0
                                  ? `${awardInvoices.length} linked invoice record${awardInvoices.length === 1 ? "" : "s"} totaling ${fmtCurrency(awardInvoiceSummary?.totalNetAmount ?? 0)} net requested.`
                                  : "No invoice records are linked to this award yet."}
                              </p>
                            </div>
                            <Link href="#project-invoices" className="module-inline-action w-fit">
                              Review billing register
                            </Link>
                          </div>

                          {awardInvoices.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {awardInvoices.map((invoice) => (
                                <div key={invoice.id} className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleize(invoice.status)}</StatusBadge>
                                    <StatusBadge tone="info">{titleize(invoice.billing_basis)}</StatusBadge>
                                    <StatusBadge tone="neutral">{fmtCurrency(invoice.net_amount)}</StatusBadge>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {invoice.invoice_date ? `Invoice ${fmtDateTime(invoice.invoice_date)}` : "Invoice date not set"}
                                        {invoice.due_date ? ` · Due ${fmtDateTime(invoice.due_date)}` : ""}
                                        {invoice.submitted_to ? ` · ${invoice.submitted_to}` : ""}
                                      </p>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      Gross {fmtCurrency(invoice.amount)}
                                      {Number(invoice.retention_amount ?? 0) > 0 ? ` · Retention ${fmtCurrency(invoice.retention_amount)}` : ""}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {fundingOpportunitiesPending ? (
          <div className="module-alert mt-5 text-sm">Funding opportunities will appear after the funding catalog migrations are applied to the database.</div>
        ) : (
          <>
            <div className="module-summary-grid cols-6 mt-5">
              <div className="module-summary-card">
                <p className="module-summary-label">Tracked</p>
                <p className="module-summary-value">{fundingOpportunities.length}</p>
                <p className="module-summary-detail">Open and upcoming opportunities linked to this project.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Pursue</p>
                <p className="module-summary-value">{pursueFundingCount}</p>
                <p className="module-summary-detail">Opportunities the team intends to actively package.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Monitor</p>
                <p className="module-summary-value">{monitorFundingCount}</p>
                <p className="module-summary-detail">Watchlist opportunities not yet fully committed.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Likely dollars</p>
                <p className="module-summary-value text-base leading-tight">{fmtCurrency(pursuedFundingAmount)}</p>
                <p className="module-summary-detail">Expected dollars attached to pursue decisions.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Skip</p>
                <p className="module-summary-value">{skipFundingCount}</p>
                <p className="module-summary-detail">Intentionally declined opportunities with rationale recorded.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Open now</p>
                <p className="module-summary-value">{openFundingCount}</p>
                <p className="module-summary-detail">Current calls that can move into active pursuit.</p>
              </div>
            </div>

            {fundingOpportunities.length === 0 ? (
              <div className="module-empty-state mt-5 text-sm">No funding opportunities are linked to this project yet.</div>
            ) : (
              <div className="mt-5 module-record-list">
                {fundingOpportunities.map((opportunity) => (
                  <div key={opportunity.id} className="module-record-row">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={fundingOpportunityStatusTone(opportunity.opportunity_status)}>
                          {formatFundingOpportunityStatusLabel(opportunity.opportunity_status)}
                        </StatusBadge>
                        <StatusBadge tone={fundingOpportunityDecisionTone(opportunity.decision_state)}>
                          {formatFundingOpportunityDecisionLabel(opportunity.decision_state)}
                        </StatusBadge>
                        {opportunity.program ? <StatusBadge tone="info">{opportunity.program.title}</StatusBadge> : null}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{opportunity.title}</h3>
                          <p className="module-record-stamp">Updated {fmtDateTime(opportunity.updated_at)}</p>
                        </div>
                        <p className="module-record-summary">
                          {opportunity.summary || "No summary recorded yet for this funding opportunity."}
                        </p>
                      </div>

                      <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                        {fmtCurrency(opportunity.expected_award_amount)} likely · Closes {fmtDateTime(opportunity.closes_at)}{opportunity.agency_name ? ` · ${opportunity.agency_name}` : ""}
                      </p>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Fit notes</p>
                          <p className="mt-2">{opportunity.fit_notes || "No fit notes recorded yet."}</p>
                        </div>
                        <div className="rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Readiness notes</p>
                          <p className="mt-2">{opportunity.readiness_notes || "No readiness notes recorded yet."}</p>
                        </div>
                        <div className="rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Decision rationale</p>
                          <p className="mt-2">{opportunity.decision_rationale || "No decision rationale recorded yet."}</p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <FundingOpportunityDecisionControls
                          opportunityId={opportunity.id}
                          initialDecisionState={opportunity.decision_state as "monitor" | "pursue" | "skip"}
                          initialExpectedAwardAmount={opportunity.expected_award_amount}
                          initialFitNotes={opportunity.fit_notes}
                          initialReadinessNotes={opportunity.readiness_notes}
                          initialDecisionRationale={opportunity.decision_rationale}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </article>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Target className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Project controls</p>
              <h2 className="module-section-title">Milestone, submittal, and invoice readiness</h2>
              <p className="module-section-description">
                This is the operator-facing slice for LAPM-style project controls. It is deliberately honest: workflow posture is live now, while exact Caltrans exhibit/form numbering remains deferred.
              </p>
            </div>
          </div>
        </div>

        <div className="module-summary-grid cols-5 mt-5">
          <div className="module-summary-card">
            <p className="module-summary-label">Delivery phase</p>
            <p className="module-summary-value text-base leading-tight">{titleize(project.delivery_phase)}</p>
            <p className="module-summary-detail">Current top-level phase on the project record.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Milestones</p>
            <p className="module-summary-value">{projectControlsSummary.milestoneCount}</p>
            <p className="module-summary-detail">{projectControlsSummary.completedMilestoneCount} complete · {projectControlsSummary.blockedMilestoneCount} blocked.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Pending submittals</p>
            <p className="module-summary-value">{projectControlsSummary.pendingSubmittalCount}</p>
            <p className="module-summary-detail">{projectControlsSummary.overdueSubmittalCount} overdue for review or agency response.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Overdue controls</p>
            <p className="module-summary-value">{projectControlsSummary.overdueMilestoneCount + projectControlsSummary.overdueSubmittalCount}</p>
            <p className="module-summary-detail">Milestones + submittals currently behind target dates.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Outstanding invoices</p>
            <p className="module-summary-value text-base leading-tight">{fmtCurrency(invoiceSummary.outstandingNetAmount)}</p>
            <p className="module-summary-detail">{invoiceSummary.submittedCount} invoice record(s) still in review or payment flow.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Control deadlines</p>
            <p className="module-summary-value">{projectControlsSummary.deadlineSummary.totalCount}</p>
            <p className="module-summary-detail">
              {projectControlsSummary.deadlineSummary.overdueCount} overdue · {projectControlsSummary.deadlineSummary.upcomingCount} upcoming.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5 mt-5">
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recommended next action</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge tone={projectControlsSummary.recommendedNextAction.tone}>
                {projectControlsSummary.recommendedNextAction.label}
              </StatusBadge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{projectControlsSummary.recommendedNextAction.detail}</p>
            <div className="mt-3">
              <Link
                href={buildProjectControlHref(
                  projectControlsSummary.recommendedNextAction.targetId,
                  projectControlsSummary.recommendedNextAction.targetRowId
                )}
                className="module-inline-action w-fit"
              >
                Open control lane
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Next milestone</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{projectControlsSummary.nextMilestone?.title ?? "No upcoming milestone recorded"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectControlsSummary.nextMilestone
                ? `${titleize(projectControlsSummary.nextMilestone.phase_code)} · target ${fmtDateTime(projectControlsSummary.nextMilestone.target_date)}`
                : "Add the next phase checkpoint or approval target to make schedule pressure visible."}
            </p>
            <div className="mt-3">
              <Link
                href={buildProjectControlHref("project-milestones", projectControlsSummary.nextMilestone?.id ? `project-milestone-${projectControlsSummary.nextMilestone.id}` : undefined)}
                className="module-inline-action w-fit"
              >
                Open milestone
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Next submittal</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{projectControlsSummary.nextSubmittal?.title ?? "No upcoming submittal recorded"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectControlsSummary.nextSubmittal
                ? `${titleize(projectControlsSummary.nextSubmittal.submittal_type)} · due ${fmtDateTime(projectControlsSummary.nextSubmittal.due_date)}`
                : "Add the next packet, reimbursement claim, or agency handoff to expose review cadence."}
            </p>
            <div className="mt-3">
              <Link
                href={buildProjectControlHref("project-submittals", projectControlsSummary.nextSubmittal?.id ? `project-submittal-${projectControlsSummary.nextSubmittal.id}` : undefined)}
                className="module-inline-action w-fit"
              >
                Open submittal
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice posture</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{invoiceSummary.totalCount ? `${invoiceSummary.totalCount} invoice record(s)` : "No invoice records yet"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {invoiceSummary.totalCount
                ? `${fmtCurrency(invoiceSummary.paidNetAmount)} paid · ${invoiceSummary.overdueCount} overdue. Net requested ${fmtCurrency(invoiceSummary.totalNetAmount)}.`
                : "The register is ready for consulting/project-delivery invoices instead of SaaS-only subscription state."}
            </p>
            <div className="mt-3">
              <Link href="#project-invoices" className="module-inline-action w-fit">
                Open invoice lane
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Deadline queue</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">
              {projectControlsSummary.deadlineSummary.nextDeadline?.title ?? "No control deadlines recorded"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectControlsSummary.deadlineSummary.nextDeadline
                ? `${projectControlsSummary.deadlineSummary.nextDeadline.label} · ${fmtDateTime(projectControlsSummary.deadlineSummary.nextDeadline.deadlineAt)}`
                : "Add milestone, submittal, or invoice due dates so the control room can surface real deadline pressure."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {projectControlsSummary.deadlineSummary.nextDeadline ? (
                <StatusBadge tone={projectControlsSummary.deadlineSummary.nextDeadline.tone}>
                  {projectControlsSummary.deadlineSummary.nextDeadline.label}
                </StatusBadge>
              ) : null}
              {projectControlsSummary.deadlineSummary.overdueCount > 0 ? (
                <StatusBadge tone="danger">{projectControlsSummary.deadlineSummary.overdueCount} overdue</StatusBadge>
              ) : null}
            </div>
            <div className="mt-3">
              <Link
                href={
                  projectControlsSummary.deadlineSummary.nextDeadline
                    ? buildProjectControlHref(
                        projectControlsSummary.deadlineSummary.nextDeadline.targetId,
                        projectControlsSummary.deadlineSummary.nextDeadline.targetRowId
                      )
                    : "#project-milestones"
                }
                className="module-inline-action w-fit"
              >
                Open deadline lane
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>

        {projectControlsSummary.deadlineSummary.items.length > 0 ? (
          <div className="mt-5 rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Control deadline queue</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  The first few dated control items across milestones, submittals, and invoices, ordered by urgency.
                </p>
              </div>
              <StatusBadge tone={projectControlsSummary.deadlineSummary.overdueCount > 0 ? "danger" : "info"}>
                {projectControlsSummary.deadlineSummary.overdueCount > 0
                  ? `${projectControlsSummary.deadlineSummary.overdueCount} overdue`
                  : `${projectControlsSummary.deadlineSummary.upcomingCount} upcoming`}
              </StatusBadge>
            </div>
            <div className="mt-4 space-y-3">
              {projectControlsSummary.deadlineSummary.items.map((item) => (
                <Link
                  key={`${item.kind}-${item.title}-${item.deadlineAt}`}
                  href={buildProjectControlHref(item.targetId, item.targetRowId)}
                  className="flex items-start justify-between gap-3 rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(item.kind)}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">{fmtDateTime(item.deadlineAt)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Open lane</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {(projectControlsSummary.attentionSummary.reportPackets.count > 0 ||
          projectControlsSummary.attentionSummary.blockedMilestones.count > 0 ||
          projectControlsSummary.attentionSummary.overdueMilestones.count > 0 ||
          projectControlsSummary.attentionSummary.overdueSubmittals.count > 0 ||
          projectControlsSummary.attentionSummary.overdueInvoices.count > 0) ? (
          <div className="mt-5 rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Attention lanes</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Fast paths into the control lanes currently creating schedule or payment risk.
                </p>
              </div>
              <StatusBadge tone="danger">Operator attention</StatusBadge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {projectControlsSummary.attentionSummary.reportPackets.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.reportPackets.targetId,
                    projectControlsSummary.attentionSummary.reportPackets.targetRowId
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Report packets</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.reportPackets.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Refresh stale packets or generate missing artifacts before delivery review.</p>
                  {recommendedReport ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {recommendedReport.title}</p>
                  ) : null}
                </Link>
              ) : null}
              {projectControlsSummary.attentionSummary.blockedMilestones.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.blockedMilestones.targetId,
                    firstBlockedMilestone ? `project-milestone-${firstBlockedMilestone.id}` : undefined
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Blocked milestones</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.blockedMilestones.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Clear milestone blockers before the next delivery move.</p>
                  {firstBlockedMilestone ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {firstBlockedMilestone.title}</p>
                  ) : null}
                </Link>
              ) : null}
              {projectControlsSummary.attentionSummary.overdueMilestones.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.overdueMilestones.targetId,
                    firstOverdueMilestone ? `project-milestone-${firstOverdueMilestone.id}` : undefined
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overdue milestones</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.overdueMilestones.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Rebaseline checkpoints that are already behind target.</p>
                  {firstOverdueMilestone ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {firstOverdueMilestone.title}</p>
                  ) : null}
                </Link>
              ) : null}
              {projectControlsSummary.attentionSummary.overdueSubmittals.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.overdueSubmittals.targetId,
                    firstOverdueSubmittal ? `project-submittal-${firstOverdueSubmittal.id}` : undefined
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overdue submittals</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.overdueSubmittals.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Bring late packets back into explicit review cadence.</p>
                  {firstOverdueSubmittal ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {firstOverdueSubmittal.title}</p>
                  ) : null}
                </Link>
              ) : null}
              {projectControlsSummary.attentionSummary.overdueInvoices.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.overdueInvoices.targetId,
                    firstOverdueInvoice ? `project-invoice-${firstOverdueInvoice.id}` : undefined
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overdue invoices</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.overdueInvoices.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Resolve payment or documentation drift in the invoice lane.</p>
                  {firstOverdueInvoice ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {firstOverdueInvoice.invoice_number}</p>
                  ) : null}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="module-note mt-5 text-sm">
          Exact CALTRANS/LAPM exhibit/form IDs, claim packet generation, and agency-specific packet templates remain deferred. What works now is the operator control surface: milestone tracking, submittal tracking, and invoice register scaffolding tied to the project record.
        </div>
      </article>

      <div className="grid gap-6 xl:grid-cols-3">
        <article id="project-milestones" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                <Target className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Milestones</p>
                <h2 className="module-section-title">Phase checkpoints</h2>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge tone={projectControlsSummary.blockedMilestoneCount > 0 ? "danger" : "neutral"}>
              {projectControlsSummary.blockedMilestoneCount} blocked
            </StatusBadge>
            <StatusBadge tone={projectControlsSummary.overdueMilestoneCount > 0 ? "warning" : "info"}>
              {projectControlsSummary.overdueMilestoneCount} overdue
            </StatusBadge>
            <StatusBadge tone="neutral">{projectControlsSummary.completedMilestoneCount} complete</StatusBadge>
          </div>
          {projectMilestonesPending ? (
            <div className="module-alert mt-5 text-sm">Project milestones will appear after the Lane C migration is applied to the database.</div>
          ) : milestones.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No milestones recorded yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {prioritizedMilestones.map((milestone) => (
                <div key={milestone.id} id={`project-milestone-${milestone.id}`} className="module-record-row scroll-mt-24">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForMilestoneStatus(milestone.status)}>{titleize(milestone.status)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(milestone.phase_code)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(milestone.milestone_type)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{milestone.title}</h3>
                        <p className="module-record-stamp">{milestone.target_date ? `Target ${fmtDateTime(milestone.target_date)}` : "No target date"}</p>
                      </div>
                      <p className="module-record-summary">{milestone.summary || milestone.notes || "No milestone summary yet."}</p>
                    </div>
                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                      {milestone.owner_label ? `${milestone.owner_label}` : ""}
                      {milestone.actual_date ? `${milestone.owner_label ? " · " : ""}Actual ${fmtDateTime(milestone.actual_date)}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-submittals" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <FileClock className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Submittals</p>
                <h2 className="module-section-title">Packets in review flow</h2>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge tone={projectControlsSummary.overdueSubmittalCount > 0 ? "danger" : "info"}>
              {projectControlsSummary.overdueSubmittalCount} overdue
            </StatusBadge>
            <StatusBadge tone="neutral">{projectControlsSummary.pendingSubmittalCount} pending</StatusBadge>
            {projectControlsSummary.nextSubmittal ? (
              <StatusBadge tone="info">Next due {fmtDateTime(projectControlsSummary.nextSubmittal.due_date)}</StatusBadge>
            ) : null}
          </div>
          {projectSubmittalsPending ? (
            <div className="module-alert mt-5 text-sm">Project submittals will appear after the Lane C migration is applied to the database.</div>
          ) : submittals.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No submittals recorded yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {prioritizedSubmittals.map((submittal) => (
                <div key={submittal.id} id={`project-submittal-${submittal.id}`} className="module-record-row scroll-mt-24">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForSubmittalStatus(submittal.status)}>{titleize(submittal.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(submittal.submittal_type)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{submittal.title}</h3>
                        <p className="module-record-stamp">{submittal.due_date ? `Due ${fmtDateTime(submittal.due_date)}` : "No due date"}</p>
                      </div>
                      <p className="module-record-summary">{submittal.notes || "No submittal notes yet."}</p>
                    </div>
                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                      Cycle {submittal.review_cycle}{submittal.agency_label ? ` · ${submittal.agency_label}` : ""}{submittal.reference_number ? ` · Ref ${submittal.reference_number}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-invoices" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <FileSpreadsheet className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Invoices</p>
                <h2 className="module-section-title">Project-linked billing register</h2>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge tone={invoiceSummary.overdueCount > 0 ? "danger" : "info"}>{invoiceSummary.overdueCount} overdue</StatusBadge>
            <StatusBadge tone="neutral">{invoiceSummary.submittedCount} in review/payment</StatusBadge>
            <StatusBadge tone="info">Outstanding {fmtCurrency(invoiceSummary.outstandingNetAmount)}</StatusBadge>
          </div>
          {projectInvoicesPending ? (
            <div className="module-alert mt-5 text-sm">Invoice records will appear after the Lane C migration is applied to the database.</div>
          ) : projectInvoices.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No invoice records linked to this project yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {prioritizedProjectInvoices.map((invoice) => (
                <div key={invoice.id} id={`project-invoice-${invoice.id}`} className="module-record-row scroll-mt-24">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleize(invoice.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(invoice.billing_basis)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(invoice.supporting_docs_status)}</StatusBadge>
                      {invoice.fundingAward ? <StatusBadge tone="neutral">Award {invoice.fundingAward.title}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{invoice.invoice_number}</h3>
                        <p className="module-record-stamp">{fmtCurrency(invoice.net_amount)}</p>
                      </div>
                      <p className="module-record-summary">
                        {invoice.notes || `${titleize(invoice.caltrans_posture)}${invoice.submitted_to ? ` · ${invoice.submitted_to}` : ""}`}
                      </p>
                    </div>
                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                      {invoice.invoice_date ? `Invoice ${fmtDateTime(invoice.invoice_date)}` : ""}
                      {invoice.due_date ? ` · Due ${fmtDateTime(invoice.due_date)}` : ""}
                      {invoice.fundingAward ? ` · ${invoice.fundingAward.title}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <article id="project-deliverables" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <ClipboardCheck className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Deliverables</p>
                <h2 className="module-section-title">Outputs to ship</h2>
              </div>
            </div>
          </div>
          {!deliverables || deliverables.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No deliverables yet. Add the first required output in the creation lane.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {deliverables.map((deliverable) => (
                <div key={deliverable.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDeliverableStatus(deliverable.status)}>{titleize(deliverable.status)}</StatusBadge>
                      {deliverable.owner_label ? <StatusBadge tone="neutral">{deliverable.owner_label}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{deliverable.title}</h3>
                        {deliverable.due_date ? <p className="module-record-stamp">Due {fmtDateTime(deliverable.due_date)}</p> : null}
                      </div>
                      <p className="module-record-summary">{deliverable.summary || "No summary yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-risks" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Risks</p>
                <h2 className="module-section-title">Threats and mitigations</h2>
              </div>
            </div>
          </div>
          {!risks || risks.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No risks recorded yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {risks.map((risk) => (
                <div key={risk.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForRiskSeverity(risk.severity)}>{titleize(risk.severity)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(risk.status)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="module-record-title">{risk.title}</h3>
                      <p className="module-record-summary">{risk.description || "No description yet."}</p>
                    </div>
                    {risk.mitigation ? (
                      <p className="mt-1.5 text-[0.73rem] text-muted-foreground">{risk.mitigation}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-issues" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-rose-500/10 text-rose-700 dark:text-rose-300">
                <Siren className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Issues</p>
                <h2 className="module-section-title">Active blockers</h2>
              </div>
            </div>
          </div>
          {!issues || issues.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No issues logged yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {issues.map((issue) => (
                <div key={issue.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForRiskSeverity(issue.severity)}>{titleize(issue.severity)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(issue.status)}</StatusBadge>
                      {issue.owner_label ? <StatusBadge tone="neutral">{issue.owner_label}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="module-record-title">{issue.title}</h3>
                      <p className="module-record-summary">{issue.description || "No description yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article id="project-decisions" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-violet-500/10 text-violet-700 dark:text-violet-300">
                <Scale className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Decisions</p>
                <h2 className="module-section-title">Why the project moved this way</h2>
              </div>
            </div>
          </div>
          {!decisions || decisions.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No decisions logged yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {decisions.map((decision) => (
                <div key={decision.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDecision(decision.status)}>{titleize(decision.status)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{decision.title}</h3>
                        {decision.decided_at ? <p className="module-record-stamp">{fmtDateTime(decision.decided_at)}</p> : null}
                      </div>
                      <p className="module-record-summary">{decision.rationale}</p>
                    </div>
                    {decision.impact_summary ? (
                      <p className="mt-1.5 text-[0.73rem] text-muted-foreground">{decision.impact_summary}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-meetings" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <MessagesSquare className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Meetings</p>
                <h2 className="module-section-title">Notes and coordination history</h2>
              </div>
            </div>
          </div>
          {!meetings || meetings.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No meetings logged yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {meetings.map((meeting) => (
                <div key={meeting.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone="info">Meeting</StatusBadge>
                      {meeting.attendees_summary ? <StatusBadge tone="neutral">Attendees logged</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{meeting.title}</h3>
                        {meeting.meeting_at ? <p className="module-record-stamp">{fmtDateTime(meeting.meeting_at)}</p> : null}
                      </div>
                      {meeting.attendees_summary ? (
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Attendees: {meeting.attendees_summary}</p>
                      ) : null}
                      <p className="module-record-summary">{meeting.notes || "No notes yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <Database className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Data dependencies</p>
                <h2 className="module-section-title">Linked datasets</h2>
              </div>
            </div>
          </div>
          {dataHubMigrationPending ? (
            <div className="module-alert mt-5 text-sm">
              Project-linked datasets will appear here once the Data Hub schema is available in this environment.
            </div>
          ) : linkedDatasets.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No datasets linked yet. Use <Link href="/data-hub" className="font-semibold text-foreground underline">Data Hub</Link> to register a source and connect it back to this project.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {linkedDatasets.map((dataset) => (
                <div key={dataset.datasetId} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDatasetStatus(dataset.status)}>{titleize(dataset.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(dataset.relationshipType)}</StatusBadge>
                      {dataset.connectorLabel ? <StatusBadge tone="neutral">{dataset.connectorLabel}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{dataset.name}</h3>
                        <p className="module-record-stamp">Refreshed {fmtDateTime(dataset.lastRefreshedAt)}</p>
                      </div>
                      <p className="module-record-summary">{dataset.vintageLabel ? `Vintage: ${dataset.vintageLabel}` : "Vintage not captured yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <Clock3 className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Recent analysis activity</p>
                <h2 className="module-section-title">Latest runs in this project workspace</h2>
              </div>
            </div>
          </div>
          {!recentRuns || recentRuns.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No runs yet. Use <Link href="/explore" className="font-semibold text-foreground underline">Analysis Studio</Link> to create the first project-linked run.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {recentRuns.map((run) => (
                <div key={run.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone="success">Analysis run</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{run.title}</h3>
                        <p className="module-record-stamp">{fmtDateTime(run.created_at)}</p>
                      </div>
                      <p className="module-record-summary">{run.summary_text || "Run created with no summary yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <Radar className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Aerial evidence</p>
              <h2 className="module-section-title">Field collection and evidence packages</h2>
              <p className="module-section-description">
                Aerial missions and evidence packages linked to this project. Evidence package readiness flows into the project evidence chain.
              </p>
            </div>
          </div>
        </div>

        {aerialProjectPosture.missionCount === 0 ? (
          <div className="module-empty-state mt-5 text-sm">
            No aerial missions linked yet. Add a mission to start connecting field collection to this project evidence chain.
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="module-metric-card">
                <p className="module-metric-label">Missions</p>
                <p className="module-metric-value text-sm">{aerialProjectPosture.missionCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {aerialProjectPosture.activeMissionCount} active, {aerialProjectPosture.completeMissionCount} complete.
                </p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Evidence packages</p>
                <p className="module-metric-value text-sm">{aerialPackages.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {aerialProjectPosture.readyPackageCount} ready or shared.
                </p>
              </div>
              <div className="module-metric-card col-span-2">
                <p className="module-metric-label">Verification readiness</p>
                <div className="mt-1">
                  <StatusBadge tone={aerialVerificationReadinessTone(aerialProjectPosture.verificationReadiness)}>
                    {formatAerialVerificationReadinessLabel(aerialProjectPosture.verificationReadiness)}
                  </StatusBadge>
                </div>
                {aerialProjectPostureDetail ? (
                  <p className="mt-2 text-xs text-muted-foreground">{aerialProjectPostureDetail}</p>
                ) : null}
              </div>
            </div>

            <div className="module-record-list">
              {aerialMissions.map((mission) => {
                const missionPackages = aerialPackages.filter((p) => p.mission_id === mission.id);
                return (
                  <div key={mission.id} className="module-record-row">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={aerialMissionStatusTone(mission.status)}>
                          {formatAerialMissionStatusLabel(mission.status)}
                        </StatusBadge>
                        <StatusBadge tone="neutral">{formatAerialMissionTypeLabel(mission.mission_type)}</StatusBadge>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{mission.title}</h3>
                          <p className="module-record-stamp">Updated {fmtDateTime(mission.updated_at)}</p>
                        </div>
                        {mission.geography_label ? (
                          <p className="module-record-summary">{mission.geography_label}</p>
                        ) : null}
                      </div>
                      {missionPackages.length > 0 ? (
                        <div className="module-record-meta">
                          {missionPackages.map((pkg) => (
                            <span key={pkg.id} className="module-record-chip">
                              {pkg.title} · <StatusBadge tone={aerialVerificationReadinessTone(pkg.verification_readiness)}>{formatAerialVerificationReadinessLabel(pkg.verification_readiness)}</StatusBadge>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">No evidence packages yet for this mission.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </article>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <FileClock className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Activity timeline</p>
              <h2 className="module-section-title">Everything happening in one feed</h2>
              <p className="module-section-description">
                The feed is intentionally tighter than the page intro: type first, timestamp second, short read after that.
              </p>
            </div>
          </div>
        </div>
        {timelineItems.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">No project activity yet.</div>
        ) : (
          <div className="mt-5 grid gap-3 xl:grid-cols-2">
            {timelineItems.map((item) => (
              <div key={item.id} className="module-record-row">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={item.tone}>{item.badge}</StatusBadge>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{item.title}</h3>
                      <p className="module-record-stamp">{fmtDateTime(item.at)}</p>
                    </div>
                    <p className="module-record-summary">{item.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
