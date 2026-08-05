import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { PilotWorkflowHandoff } from "@/components/operations/pilot-workflow-handoff";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { ProjectRecordComposer } from "@/components/projects/project-record-composer";
import { ProjectStageGateBoard } from "@/components/projects/project-stage-gate-board";
import { summarizeBillingInvoiceRecords } from "@/lib/invoicing/invoice-records";
import {
  buildGrantDecisionModelingSupport,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import { loadWorkspaceOperationsSummaryForWorkspace, type WorkspaceOperationsSupabaseLike } from "@/lib/operations/workspace-summary";
import {
  buildAerialProjectPosture,
  describeAerialProjectPosture,
} from "@/lib/aerial/public";
import { loadAerialMissionsAndPackagesForProject, loadAerialProjectPosture } from "@/lib/aerial/queries";
import { buildProjectBudgetSnapshot, type DeliverableBudgetSummary } from "@/lib/projects/budget";
import { loadProjectBudgetInputs, type ProjectBudgetQuerySupabaseLike } from "@/lib/projects/budget-queries";
import { buildProjectControlsSummary } from "@/lib/projects/controls";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";
import { buildProjectSpineCrosslinkSummary, geographyLaneInput } from "@/lib/projects/project-spine-crosslinks";
import { placeOfRecordFromProject } from "@/lib/projects/project-place";
import { buildProjectSpineReadinessRollup } from "@/lib/projects/spine-readiness";
import {
  describeComparisonSnapshotAggregate,
  describeEvidenceChainSummary,
  getReportNavigationHref,
  getReportPacketFreshness,
  getReportPacketPriority,
  parseStoredComparisonSnapshotAggregate,
  parseStoredEvidenceChainSummary,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { loadReportRunCitationLinksForReports, resolveCitedRuns } from "@/lib/reports/run-citations";
import { RTP_EVIDENCE_KPI_NAMES, loadRtpEvidenceRunDisclosures, summarizeRtpModelingEvidence, type RtpEvidenceRunRow, type RtpEvidenceSupabaseLike, type RtpModelingEvidenceKpiRow } from "@/lib/rtp/modeling-evidence";
import { COVERAGE_STATE_COPY } from "@/lib/safety/client-types";
import { POSTGREST_NO_ROWS_MATCHED } from "@/lib/http/write-outcome";
import { StateBlock } from "@/components/ui/state-block";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { collectUnlessPending, laneOutcome, laneRows, looksLikePendingSchema } from "./_components/_read-lanes";
import { compareDateValues, invoicePriority, latestKnownDate, milestonePriority, parseSortableDate, submittalPriority } from "./_components/_ordering";
import { createClient } from "@/lib/supabase/server";
import { resolveRtpPriorityFrameworkForWorkspace } from "@/lib/rtp/priority-framework-binding";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  loadProjectStageGateBoard,
  type StageGateDecisionQuerySupabaseLike,
} from "@/lib/stage-gates/decision-queries";
import { resolveWorkspaceStageGateBinding } from "@/lib/stage-gates/template-loader";
import { buildProjectTimelineItems } from "./_components/_timeline";
import { buildProjectReportQueueItems } from "./_components/_report-queue";
import {
  loadProjectRecordLanes,
  type ProjectRecordLaneSupabaseLike,
} from "./_components/_record-lanes";
import { ProjectUnreadableNotice } from "./_components/project-unreadable-notice";
import { ProjectPostureHeader } from "./_components/project-posture-header";
import { ProjectPostureUnified } from "./_components/project-posture-unified";
import { ProjectSpineReadinessRollup } from "./_components/project-spine-readiness-rollup";
import { ProjectBudgetPanel } from "./_components/project-budget-panel";
import { ProjectFundingPanel } from "./_components/project-funding-panel";
import { ProjectDeliveryBoard } from "./_components/project-delivery-board";
import { ProjectRiskAndDecisionLog } from "./_components/project-risk-decision-log";
import { ProjectEvidenceAndActivity } from "./_components/project-evidence-activity";
import { ProjectSpineCrosslinkBoard } from "./_components/project-spine-crosslink-board";
import { ProjectMapPresencePanel } from "./_components/project-map-presence-panel";
import { ProjectIdentityEditor } from "@/components/projects/project-identity-editor";
import { placeIdentityOnly } from "@/lib/geographies/place-of-record";
import {
  CORRIDOR_COLUMNS,
  serializeProjectCorridor,
  type ProjectCorridorRow,
} from "@/lib/cartographic/project-corridor-record";
import { deriveHomeMapView, homeGeographyLabel, parseWorkspaceHomeGeography } from "@/lib/workspaces/home-geography";
import { canAccessWorkspaceAction, isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import type {
  BillingInvoiceRow,
  FundingAwardRow,
  FundingOpportunityRow,
  LinkedDatasetItem,
  MilestoneRow,
  ProjectFundingProfileRow,
  ProjectReportRow,
  ProjectRow,
  ProjectRtpLinkRow,
  RecentRun,
  ReportArtifactRow,
  RtpCycleRow,
  SubmittalRow,
  TimelineItem,
  WorkspaceRow,
} from "./_components/_types";

// A pending COLUMN is a pending schema too, and looksLikePendingSchema used to
// recognise only a pending TABLE. PostgREST answers a select naming a column the
// deployed schema lacks with `column funding_awards.closure_basis does not
// exist` (42703), which matched none of the table-shaped alternatives — so every
// read on this page that outruns the database returned `data: null` with its
// `*Pending` flag false, and the lane rendered its empty state: "No funding
// awards are recorded for this project yet." over a project that has several.
// An absence stated as a fact, produced by the page asking for more than the
// database carries. The column form is what the rest of the repo already treats
// as pending (src/lib/grants/pursuit.ts, src/lib/stage-gates/decision-queries.ts).

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

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Project workbench"
        title="Project access needs a workspace"
        description="Project control rooms are workspace-scoped. You are signed in, but this account is not attached to a workspace yet. Reload your workspace, or ask an owner/admin to add you to the one that owns this project."
        primaryHref="/projects"
        primaryLabel="Back to projects"
      />
    );
  }

  // Read through the caller's RLS client: the projects_read policy already
  // restricts this SELECT to workspaces the caller is a member of, so a
  // non-member gets no row and falls through to notFound() below. There is no
  // separate "must equal my CURRENT workspace" check — that older gate stranded
  // every project outside the newest-first current workspace (all of a
  // multi-workspace member's other projects, and every project created before
  // the workspace-per-project fork was removed). Access = membership of the
  // project's own workspace, which RLS enforces; the page scopes every
  // subsequent query to project.workspace_id, not the current one.
  const projectResult = await supabase
    .from("projects")
    .select(
      "id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at, rtp_posture, rtp_posture_updated_at, latitude, longitude, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_geometry_geojson, place_set_at"
    )
    .eq("id", projectId)
    .single();
  const projectData = projectResult.data ?? null;

  // A 404 IS A CLAIM, AND A FAILED READ MAY NOT MAKE IT. `.single()` reports
  // "no row matched" as PGRST116 with a null row — that is a genuine absence
  // (including the RLS case: a non-member simply sees no row), and notFound()
  // is the truthful answer. Any OTHER error is the query FAILING, and "this
  // project does not exist" is a different fact from "this project could not be
  // read". Both used to arrive here as `data: null` and both rendered as a
  // 404, so a dropped column or a broken policy told a planner their project
  // was gone. The distinction is drawn on the error, never on the empty row.
  if (!projectData) {
    if (projectResult.error && projectResult.error.code !== POSTGREST_NO_ROWS_MATCHED) {
      return <ProjectUnreadableNotice message={projectResult.error.message} />;
    }

    notFound();
  }

  const project = projectData as ProjectRow;

  // Every optional read on this page registers here so an empty panel can be
  // told apart from a panel whose query failed. See src/lib/ui/read-failures.ts.
  const reads = new ReadFailureLog();

  // The home-geography columns come along because the stage-gate binding is only
  // honest next to them: the stored template id has a database default, so
  // whether it was matched to this agency or merely assumed for it can be told
  // apart only by asking where the workspace works. A deployment that predates
  // those columns rejects the extended select, so the read falls back to the
  // original list — the binding then resolves as "jurisdiction unknown", a
  // disclosed fallback rather than a guess.
  const workspaceCoreColumns = "id, name, slug, stage_gate_template_id, stage_gate_template_version, created_at";
  const workspaceRead = await supabase
    .from("workspaces")
    .select(
      `${workspaceCoreColumns}, home_geography_source, home_geography_kind, home_geography_ref, home_country_code, home_subdivision_code`
    )
    .eq("id", project.workspace_id)
    .single();
  const workspaceFallbackRead = workspaceRead.error
    ? await supabase.from("workspaces").select(workspaceCoreColumns).eq("id", project.workspace_id).single()
    : null;
  const workspaceData = (workspaceRead.error ? workspaceFallbackRead?.data : workspaceRead.data) as
    | WorkspaceRow
    | null;

  // Which stage-gate template this workspace is actually on, and whether anyone
  // chose it. Everything gate-shaped below renders from this one answer so the
  // board and the disclosure above it can never describe different templates.
  const stageGateResolution = resolveWorkspaceStageGateBinding(workspaceData);
  const stageGateBinding = stageGateResolution.kind === "resolved" ? stageGateResolution.binding : null;

  // The same jurisdiction answers a second question: which policy bases this
  // workspace's RTP priority criteria may cite. Resolved from the row already
  // read above rather than a second query — and note it selects
  // `home_subdivision_code`, without which every workspace resolves as
  // subdivision-unknown and no state framework can ever match.
  const rtpPriorityCriteria = resolveRtpPriorityFrameworkForWorkspace(parseWorkspaceHomeGeography(workspaceData)).criteria;

  // The project's own corridors, for the backdrop-presence panel. Read through
  // the pending-schema fallback like every other optional table on this page, so
  // a deployment that has not applied the corridor migration renders a stated
  // limitation rather than an error.
  const projectCorridorResult = await supabase
    .from("project_corridors")
    .select(CORRIDOR_COLUMNS)
    .eq("project_id", project.id)
    .order("created_at", { ascending: true });

  const corridorLane = laneOutcome(reads, "corridors drawn on this project", projectCorridorResult);
  const projectCorridorsPending = corridorLane.pending;
  const projectCorridors = (corridorLane.rows as ProjectCorridorRow[]).map(serializeProjectCorridor);

  // Open the picker over the workspace's own geography when it has one. A null
  // here is the point: the component falls back to the neutral continental view
  // rather than showing an unset workspace somebody else's town.
  const workspaceHomeGeography = parseWorkspaceHomeGeography(workspaceData);
  const projectMapHomeView = deriveHomeMapView(workspaceHomeGeography);
  // Named so an unset project can state the REAL fallback instead of inventing one.
  const workspaceHomeGeographyLabel = homeGeographyLabel(workspaceHomeGeography);

  const projectRtpLinkResult = await supabase
    .from("project_rtp_cycle_links")
    .select("id, rtp_cycle_id, portfolio_role, priority_rationale, priority_scores, evidence_model_run_id, created_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });

  const rtpLinkLane = laneOutcome(reads, "RTP cycles this project is linked to", projectRtpLinkResult);
  const projectRtpLinkRows = rtpLinkLane.rows as ProjectRtpLinkRow[];
  const projectRtpLinksPending = rtpLinkLane.pending;

  const linkedRtpCycleIds = projectRtpLinkRows.map((item) => item.rtp_cycle_id);
  const linkedRtpCyclesResult = linkedRtpCycleIds.length
    ? await supabase
        .from("rtp_cycles")
        .select("id, title, status, geography_label, horizon_start_year, horizon_end_year")
        .in("id", linkedRtpCycleIds)
    : { data: [], error: null };
  const linkedRtpCycleLane = laneOutcome(reads, "the linked RTP cycles themselves", linkedRtpCyclesResult);
  const linkedRtpCyclesPending = linkedRtpCycleLane.pending;
  const linkedRtpCycles = linkedRtpCycleLane.rows as RtpCycleRow[];

  const workspaceRtpCyclesResult = await supabase
    .from("rtp_cycles")
    .select("id, title, status, geography_label, horizon_start_year, horizon_end_year")
    .eq("workspace_id", project.workspace_id)
    .order("updated_at", { ascending: false });
  const workspaceRtpCycleLane = laneOutcome(reads, "this workspace's RTP cycles", workspaceRtpCyclesResult);
  const workspaceRtpCyclesPending = workspaceRtpCycleLane.pending;
  const workspaceRtpCycles = workspaceRtpCycleLane.rows as RtpCycleRow[];

  // RTP "why" engine: attributed modeling evidence. Load the workspace's succeeded
  // runs for the evidence-run picker, plus the VMT/GHG KPIs of any run already
  // attached to an RTP entry (the run is always named alongside its numbers).
  const evidenceRunIds = Array.from(
    new Set(projectRtpLinkRows.map((link) => link.evidence_model_run_id).filter((id): id is string => Boolean(id)))
  );
  const [availableRunsResult, evidenceKpisResult] = await Promise.all([
    supabase
      .from("model_runs")
      .select("id, run_title, engine_key, status")
      .eq("workspace_id", project.workspace_id)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(50),
    evidenceRunIds.length
      ? supabase
          .from("model_run_kpis")
          .select("run_id, kpi_name, value, geometry_ref")
          .in("run_id", evidenceRunIds)
          .in("kpi_name", [...RTP_EVIDENCE_KPI_NAMES])
      : Promise.resolve({ data: [], error: null }),
  ]);
  const availableRunRows = laneRows(reads, "model runs available as evidence", availableRunsResult) as RtpEvidenceRunRow[];
  // Engine + status + claim tier for every offered and cited run — even one outside
  // the 50-succeeded-run picker window. Disclosure only; nothing here writes a tier.
  const evidenceDisclosures = await loadRtpEvidenceRunDisclosures(supabase as unknown as RtpEvidenceSupabaseLike, evidenceRunIds, { knownRuns: availableRunRows });
  const availableModelRuns = evidenceDisclosures.pickerRuns;
  const runTitleById = evidenceDisclosures.titleByRunId;
  const evidenceKpiRows = (evidenceKpisResult.data ?? []) as RtpModelingEvidenceKpiRow[];
  // A failed read renders as "could not be read", never "No VMT/GHG KPIs".
  const evidenceKpiOptions = { kpiReadFailed: Boolean(evidenceKpisResult.error) };
  const modelingEvidenceByRunId = new Map(
    evidenceRunIds.map((runId) => [runId, summarizeRtpModelingEvidence(runId, runTitleById.get(runId) ?? null, evidenceKpiRows, evidenceKpiOptions)])
  );

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
        priorityScores: link.priority_scores ?? {},
        evidenceModelRunId: link.evidence_model_run_id ?? null,
        modelingEvidence: link.evidence_model_run_id
          ? modelingEvidenceByRunId.get(link.evidence_model_run_id) ?? null
          : null,
        evidenceRunDisclosure: link.evidence_model_run_id ? evidenceDisclosures.disclosureFor(link.evidence_model_run_id) : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  // Cheap head-count of Knowledge Base documents attached to this project.
  // Pending-schema tolerant: a missing kb_documents table reads as "count
  // unavailable" (null), never as zero.
  const kbDocumentCountResult = await supabase
    .from("kb_documents")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);
  const kbDocumentCount = kbDocumentCountResult.error
    ? null
    : kbDocumentCountResult.count ?? 0;

  // Prefer runs attributed to THIS project (run-provenance migration). A
  // deployment without the project_id column falls back to the workspace-wide
  // recency view this page always had — attribution is additive, not required.
  const projectRunsResult = await supabase
    .from("runs")
    .select("id, title, created_at, summary_text")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(5);
  // Falling back is fine; falling back SILENTLY is not. When the attributed read
  // fails for anything but a pending column, this page stops knowing how much
  // analysis belongs to THIS project — the workspace-recency list that replaces
  // it answers a different question — so the failure is disclosed and the
  // analysis lane refuses rather than counting the substitute as project work.
  const projectRunsPending = looksLikePendingSchema(projectRunsResult.error?.message);
  const projectRunsReadFailed = collectUnlessPending(reads, "analysis runs attributed to this project", projectRunsResult);
  const projectRunsAvailable = !projectRunsResult.error;
  const attributedRuns = projectRunsAvailable ? (projectRunsResult.data ?? []) : [];

  const recentRunsResult =
    attributedRuns.length > 0
      ? projectRunsResult
      : await supabase
          .from("runs")
          .select("id, title, created_at, summary_text")
          .eq("workspace_id", project.workspace_id)
          .order("created_at", { ascending: false })
          .limit(5);
  const recentRunLane = laneOutcome(reads, "recent analysis runs for this project", recentRunsResult);
  const recentRunsPending = recentRunLane.pending;
  const recentRuns = recentRunLane.rows as RecentRun[];

  // Worker model runs attributed to this project — counted for the spine
  // crosslink board. THE ZERO WAS THE DEFECT: `error ? 0 : rows.length` is the
  // whole read-failure-as-absence class in one line, and this count is the only
  // input distinguishing "no worker run is bound to this project" from "the
  // model_runs read failed". A zero here, with no attributed analysis runs
  // either, makes the analysis lane say "No analysis link · Add a model run".
  const projectModelRunsResult = await supabase
    .from("model_runs")
    .select("id")
    .eq("project_id", project.id)
    .limit(50);
  const projectModelRunsPending = looksLikePendingSchema(projectModelRunsResult.error?.message);
  const projectModelRunsReadFailed = collectUnlessPending(reads, "model runs attributed to this project", projectModelRunsResult);
  const projectModelRunCount = projectModelRunsResult.error
    ? 0
    : (projectModelRunsResult.data ?? []).length;

  const operationsSummaryPromise = loadWorkspaceOperationsSummaryForWorkspace(
    supabase as unknown as WorkspaceOperationsSupabaseLike,
    project.workspace_id
  );

  const projectReportResult = await supabase
    .from("reports")
    .select(
      "id, title, summary, report_type, status, updated_at, generated_at, latest_artifact_kind",
      { count: "exact" }
    )
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(4);
  const projectReportLane = laneOutcome(reads, "report packets linked to this project", projectReportResult);
  const projectReportsPending = projectReportLane.pending;
  const projectReportData = projectReportLane.rows;
  const projectReportCount = projectReportsPending ? 0 : projectReportResult.count;

  const scenarioSetsResult = await supabase
    .from("scenario_sets")
    .select("id, title, status, planning_question, updated_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(8);
  const scenarioSetLane = laneOutcome(reads, "this project's scenario sets", scenarioSetsResult);
  const scenarioSets = scenarioSetLane.rows as Array<{
        id: string;
        title: string;
        status: string;
        planning_question: string | null;
        updated_at: string;
      }>;
  const scenarioSetsPending = scenarioSetLane.pending;
  const scenarioSetIds = scenarioSets.map((set) => set.id);
  const scenarioEntriesResult = scenarioSetIds.length
    ? await supabase
        .from("scenario_entries")
        .select("id, scenario_set_id, entry_type, status, attached_run_id")
        .in("scenario_set_id", scenarioSetIds)
    : { data: [], error: null };
  const scenarioEntryLane = laneOutcome(reads, "this project's scenario entries", scenarioEntriesResult);
  const scenarioEntries = scenarioEntryLane.rows as Array<{
        id: string;
        scenario_set_id: string;
        entry_type: string;
        status: string;
        attached_run_id: string | null;
      }>;
  const scenarioEntriesPending = scenarioEntryLane.pending;

  // The gate cockpit: this project's decisions and the board built from them.
  // Both the project scoping and the read-failure disclosure live in the loader —
  // see src/lib/stage-gates/decision-queries.ts for why each one is load-bearing.
  const stageGateBoard = await loadProjectStageGateBoard(supabase as unknown as StageGateDecisionQuerySupabaseLike, {
    workspaceId: project.workspace_id,
    projectId: project.id,
    templateId: stageGateBinding?.templateId ?? null,
  });
  const { decisions: recentGateDecisions, summary: stageGateSummary } = stageGateBoard;

  const milestoneResult = await supabase
    .from("project_milestones")
    .select("id, title, summary, milestone_type, phase_code, status, owner_label, target_date, actual_date, notes, created_at")
    .eq("project_id", project.id)
    .order("target_date", { ascending: true })
    .limit(8);
  const milestones = looksLikePendingSchema(milestoneResult.error?.message) ? [] : ((milestoneResult.data ?? []) as MilestoneRow[]);
  const projectMilestonesPending = looksLikePendingSchema(milestoneResult.error?.message);
  const projectMilestonesReadFailed = projectMilestonesPending ? false : reads.check("this project's milestones", milestoneResult);

  const submittalResult = await supabase
    .from("project_submittals")
    .select("id, title, submittal_type, status, agency_label, reference_number, due_date, submitted_at, review_cycle, notes, created_at")
    .eq("project_id", project.id)
    .order("due_date", { ascending: true })
    .limit(8);
  const submittals = looksLikePendingSchema(submittalResult.error?.message) ? [] : ((submittalResult.data ?? []) as SubmittalRow[]);
  const projectSubmittalsPending = looksLikePendingSchema(submittalResult.error?.message);
  const projectSubmittalsReadFailed = projectSubmittalsPending ? false : reads.check("this project's submittals", submittalResult);

  // Budget & pace inputs: ALL deliverables (with their budget columns), the
  // stated project budget, the spend ledger, and billed client-invoice lines —
  // each read pending-schema tolerant inside the loader.
  const budgetInputs = await loadProjectBudgetInputs(
    supabase as unknown as ProjectBudgetQuerySupabaseLike,
    project.id
  );
  // The loader classifies and RETURNS its failures rather than swallowing them;
  // this is where they become something a planner can see. Without it a failed
  // client-invoice or spend read renders as "Billed to date $0" — an agency's
  // money stated as zero because a query broke. The panel below still shows the
  // decomposed totals, so the banner is the only thing standing between a
  // failed read and a number a planner would act on.
  budgetInputs.readFailures.forEach((failure) => reads.check(failure.label, { error: failure }));
  const projectBudgetSnapshot = buildProjectBudgetSnapshot({
    project: { budget_amount: budgetInputs.statedBudgetAmount },
    deliverables: budgetInputs.deliverables,
    spendEntries: budgetInputs.spendEntries,
    billedLines: budgetInputs.billedLines,
  });
  const budgetSummaryByDeliverableId = new Map<string, DeliverableBudgetSummary>(
    projectBudgetSnapshot.deliverables
      .filter((summary): summary is DeliverableBudgetSummary & { deliverableId: string } => Boolean(summary.deliverableId))
      .map((summary) => [summary.deliverableId, summary])
  );
  // The board and timeline keep their original six-row recency window; the
  // budget snapshot above deliberately sees the full deliverable list.
  const deliverables = budgetInputs.deliverables.slice(0, 6);

  // The four narrative record lanes, each of which renders its own
  // "No X recorded yet." and feeds a header count. See _record-lanes.ts for why
  // they carry an explicit per-lane failure flag rather than an empty array.
  const {
    risks,
    issues,
    decisions,
    meetings,
    risksReadFailed,
    issuesReadFailed,
    decisionsReadFailed,
    meetingsReadFailed,
  } = await loadProjectRecordLanes(
    supabase as unknown as ProjectRecordLaneSupabaseLike,
    project.id,
    reads
  );

  const engagementCampaignsResult = await supabase
    .from("engagement_campaigns")
    .select("id, title, status, updated_at, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);
  const engagementCampaignLane = laneOutcome(reads, "engagement campaigns for this project", engagementCampaignsResult);
  const engagementCampaigns = engagementCampaignLane.rows as Array<{
        id: string;
        title: string;
        status: string;
        updated_at: string;
        created_at: string;
      }>;
  const engagementCampaignIds = engagementCampaigns.map((campaign) => campaign.id);
  const engagementItemsResult = engagementCampaignIds.length
    ? await supabase
        .from("engagement_items")
        .select("campaign_id, updated_at, created_at")
        .in("campaign_id", engagementCampaignIds)
        .order("updated_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  const engagementItems = laneRows(reads, "public comments on this project", engagementItemsResult) as Array<{
        campaign_id: string;
        updated_at: string;
        created_at: string;
      }>;

  // caltrans_posture stays selected as the legacy read fallback for rows that
  // predate the reimbursement-profile backfill (20260727000009).
  const projectInvoiceSelectLegacy =
    "id, funding_award_id, invoice_number, consultant_name, billing_basis, status, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at, funding_awards(id, title)";
  const projectInvoiceSelect = projectInvoiceSelectLegacy.replace(
    "caltrans_posture,",
    "caltrans_posture, reimbursement_profile_id, reimbursement_posture, reimbursement_profile_selection,"
  );

  // Cast to one loose shape: the two select strings would otherwise infer
  // different structural types (Supabase clients are untyped by convention).
  const selectProjectInvoices = async (columns: string) =>
    (await supabase
      .from("billing_invoice_records")
      .select(columns)
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(6)) as { data: unknown[] | null; error: { message?: string } | null };

  let invoiceResult = await selectProjectInvoices(projectInvoiceSelect);
  if (invoiceResult.error && looksLikePendingSchema(invoiceResult.error.message)) {
    // A database that has the register but not the profile columns yet still
    // gets its invoices; rows from this path simply carry no profile fields.
    invoiceResult = await selectProjectInvoices(projectInvoiceSelectLegacy);
  }

  const projectInvoicesPending = looksLikePendingSchema(invoiceResult.error?.message);
  const invoiceLabel = "reimbursement invoices for this project";
  const projectInvoicesReadFailed = projectInvoicesPending ? false : reads.check(invoiceLabel, invoiceResult);
  const projectInvoices = looksLikePendingSchema(invoiceResult.error?.message)
    ? []
    : ((invoiceResult.data ?? []) as BillingInvoiceRow[]).map((invoice) => ({
        ...invoice,
        fundingAward: Array.isArray(invoice.funding_awards) ? (invoice.funding_awards[0] ?? null) : invoice.funding_awards ?? null,
      }));

  // Claim-progress math must not run on the display-capped recent-6 query
  // above — an award with a longer history would show an understated
  // claimed-to-date as if it were fact. Award-scoped, effectively uncapped.
  const selectAwardInvoices = async (columns: string, awardIds: string[]) =>
    (await supabase
      .from("billing_invoice_records")
      .select(columns)
      .in("funding_award_id", awardIds)
      .order("created_at", { ascending: false })
      .limit(1000)) as { data: unknown[] | null; error: { message?: string } | null };

  const projectFundingProfileResult = await supabase
    .from("project_funding_profiles")
    .select("id, project_id, funding_need_amount, local_match_need_amount, notes, updated_at")
    .eq("project_id", project.id)
    .maybeSingle();
  const projectFundingProfilePending = looksLikePendingSchema(projectFundingProfileResult.error?.message);
  // No panel asserts "no funding profile", but the crosslink board's funding
  // lane does — so the flag this used to throw away is what stops that lane
  // reading "Funding target missing" over a profile nobody could load.
  const projectFundingProfileReadFailed = collectUnlessPending(reads, "this project's funding profile", projectFundingProfileResult);
  const projectFundingProfile = projectFundingProfilePending
    ? null
    : ((projectFundingProfileResult.data ?? null) as ProjectFundingProfileRow | null);

  // The closure-provenance columns (20260729000001) are selected here because
  // the funding panel cannot tell an earned close-out from one asserted on
  // import without them — and a `.select()` string is not schema-checked, so a
  // column left out arrives as `undefined` with no error anywhere. The panel
  // renders that absence as "closure basis not loaded"; it is the pages that
  // decide whether a planner ever sees the real answer. On a deployment behind
  // this migration the read fails the pending-schema test below, which is the
  // page's existing disclosed degrade rather than a silent empty list.
  const fundingAwardsResult = await supabase
    .from("funding_awards")
    .select(
      "id, project_id, program_id, funding_opportunity_id, title, awarded_amount, match_amount, match_posture, obligation_due_at, spending_status, closure_basis, closed_at, closure_note, reopened_at, risk_flag, notes, updated_at, created_at, funding_opportunities(id, title), programs(id, title)"
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
  // CLASSIFY FIRST, THEN COLLECT WHAT IS LEFT. `looksLikePendingSchema` answers
  // exactly one question — is this deployment behind a migration — and every
  // other error falls through it into `data ?? []`, which the panel renders as
  // "No funding awards are recorded for this project yet." and the tiles total
  // to $0. A revoked grant or a changed policy is not a finding about an
  // agency's money, so anything the classifier does not own is collected here.
  const fundingAwardsReadFailed = fundingAwardsPending
    ? false
    : reads.check("project funding awards", fundingAwardsResult);

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
  const fundingOpportunitiesReadFailed = fundingOpportunitiesPending ? false : reads.check("funding opportunities linked to this project", fundingOpportunitiesResult);

  const datasetLinksResult = await supabase
    .from("data_dataset_project_links")
    .select("dataset_id, relationship_type, linked_at")
    .eq("project_id", project.id)
    .order("linked_at", { ascending: false });

  const datasetLinkLane = laneOutcome(reads, "datasets linked to this project", datasetLinksResult);
  const datasetLinkRows = datasetLinkLane.rows as Array<{
        dataset_id: string;
        relationship_type: string;
        linked_at: string;
      }>;

  const linkedDatasetIds = datasetLinkRows.map((item) => item.dataset_id);

  const datasetsResult = linkedDatasetIds.length
    ? await supabase
        .from("data_datasets")
        .select("id, connector_id, name, status, vintage_label, last_refreshed_at")
        .in("id", linkedDatasetIds)
    : { data: [], error: null };

  const linkedDatasetRows = laneRows(reads, "the linked datasets themselves", datasetsResult) as Array<{
        id: string;
        connector_id: string | null;
        name: string;
        status: string;
        vintage_label: string | null;
        last_refreshed_at: string | null;
      }>;

  const linkedConnectorIds = linkedDatasetRows
    .map((item) => item.connector_id)
    .filter((value): value is string => Boolean(value));

  const connectorsResult = linkedConnectorIds.length
    ? await supabase.from("data_connectors").select("id, display_name").in("id", linkedConnectorIds)
    : { data: [], error: null };

  collectUnlessPending(reads, "this workspace's data connectors", connectorsResult);
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
  const fundingAwardIds = fundingAwards.map((award) => award.id);
  let awardInvoicesResult = fundingAwardIds.length
    ? await selectAwardInvoices(projectInvoiceSelect, fundingAwardIds)
    : { data: [], error: null };
  if (awardInvoicesResult.error && looksLikePendingSchema(awardInvoicesResult.error.message)) {
    awardInvoicesResult = await selectAwardInvoices(projectInvoiceSelectLegacy, fundingAwardIds);
  }
  // On any residual error, fall back to the display-capped rows rather than
  // rendering an empty claim history for awards that have one.
  const awardInvoiceRows = awardInvoicesResult.error
    ? projectInvoices
    : ((awardInvoicesResult.data ?? []) as BillingInvoiceRow[]).map((invoice) => ({
        ...invoice,
        fundingAward: Array.isArray(invoice.funding_awards)
          ? (invoice.funding_awards[0] ?? null)
          : invoice.funding_awards ?? null,
      }));
  const invoiceSummaryByFundingAwardId = new Map(
    fundingAwards.map((award) => [
      award.id,
      summarizeBillingInvoiceRecords(awardInvoiceRows.filter((invoice) => invoice.funding_award_id === award.id)),
    ])
  );
  const invoiceRecordsByFundingAwardId = new Map(
    fundingAwards.map((award) => [award.id, awardInvoiceRows.filter((invoice) => invoice.funding_award_id === award.id)])
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
  const reportArtifactLane = laneOutcome(reads, "the evidence chain on this project's packets", reportArtifactsResult);
  const reportArtifactsPending = reportArtifactLane.pending;
  // Widened for typed evidence citations (legacy fallback inside); typed
  // citations resolve so they render alongside legacy linked-run evidence with
  // a kind label and an honest status.
  const { links: linkedReportRuns } = await loadReportRunCitationLinksForReports(supabase, projectReportIds);
  const linkedReportRunIds = Array.from(
    new Set(linkedReportRuns.map((item) => item.run_id).filter((value): value is string => Boolean(value)))
  );
  const { citedModelRuns, citedCountyRuns } = await resolveCitedRuns(supabase, linkedReportRuns);
  const typedCitationCount = citedModelRuns.length + citedCountyRuns.length;
  const linkedRunsResult = linkedReportRunIds.length
    ? await supabase
        .from("runs")
        .select("id, created_at")
        .in("id", linkedReportRunIds)
    : { data: [], error: null };
  const linkedRuns = laneRows(reads, "model runs linked to this project", linkedRunsResult) as Array<{ id: string; created_at: string }>;
  const latestArtifactByReportId = new Map<string, ReportArtifactRow>();
  for (const artifact of reportArtifactLane.rows as ReportArtifactRow[]) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, artifact);
    }
  }

  const projectReports = ((projectReportData ?? []) as ProjectReportRow[])
    .map((report) => {
      const evidenceChainSummary = parseStoredEvidenceChainSummary(
        latestArtifactByReportId.get(report.id)?.metadata_json ?? null
      );
      const comparisonAggregate = parseStoredComparisonSnapshotAggregate(
        latestArtifactByReportId.get(report.id)?.metadata_json ?? null
      );
      const comparisonDigest = describeComparisonSnapshotAggregate(
        comparisonAggregate
      );
      const evidenceChainDigest = describeEvidenceChainSummary(
        evidenceChainSummary
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
        evidenceChainSummary,
        evidenceChainDigest,
      };
    })
    .sort((left, right) => {
      const leftFreshnessPriority = getReportPacketPriority(left.packetFreshness.label);
      const rightFreshnessPriority = getReportPacketPriority(right.packetFreshness.label);
      const leftPriority =
        leftFreshnessPriority < 2
          ? leftFreshnessPriority
          : left.evidenceChainDigest?.blockedGateDetail
            ? 2
            : 3;
      const rightPriority =
        rightFreshnessPriority < 2
          ? rightFreshnessPriority
          : right.evidenceChainDigest?.blockedGateDetail
            ? 2
            : 3;
      const freshnessPriority = leftPriority - rightPriority;
      if (freshnessPriority !== 0) {
        return freshnessPriority;
      }

      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  const reportRecordCount = projectReportCount ?? projectReports.length;
  const refreshRecommendedReportCount = projectReports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
  ).length;
  const noPacketReportCount = projectReports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
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
  const reportAttentionCount = projectReports.filter(
    (report) =>
      report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED ||
      report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET ||
      Boolean(report.evidenceChainDigest?.blockedGateDetail)
  ).length;
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
  const strongestEngagementEvidence = projectReports
    .map((report) => report.evidenceChainSummary)
    .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary))
    .sort((left, right) => right.engagementItemCount - left.engagementItemCount)[0] ?? null;
  const projectReportQueueItems = buildProjectReportQueueItems(projectReports);
  const projectControlsSummary = buildProjectControlsSummary(
    milestones,
    submittals,
    projectInvoices,
    {
      attentionCount: reportAttentionCount,
      refreshRecommendedCount: refreshRecommendedReportCount,
      noPacketCount: noPacketReportCount,
      governanceHoldCount: governanceHoldReportCount,
      comparisonBackedCount: comparisonBackedReportCount,
      recommendedReportId: recommendedReport?.id ?? null,
      recommendedReportTitle: recommendedReport?.title ?? null,
    },
    now
  );

  // Safety evidence lane: crash acquisitions linked to this project, newest
  // first. The ingest row already carries the honest reported-vs-geocoded
  // counts, so no crash-point rows are read here.
  const safetyIngestResult = await supabase
    .from("safety_crash_ingests")
    .select("id, status, source_label, coverage_state, crash_count, geocoded_count, created_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(8);
  const safetyLane = laneOutcome(reads, "crash acquisitions linked to this project", safetyIngestResult);
  const safetyIngestsPending = safetyLane.pending;
  const projectSafetyIngests = safetyLane.rows as Array<{
        id: string;
        status: string;
        source_label: string | null;
        coverage_state: string;
        crash_count: number | null;
        geocoded_count: number | null;
        created_at: string;
      }>;
  const latestProjectSafetyIngest = projectSafetyIngests[0] ?? null;

  const {
    missions: aerialMissions,
    packages: aerialPackages,
    pending: aerialEvidencePending,
    unreadableReason: aerialUnreadableReason,
  } = await loadAerialMissionsAndPackagesForProject(supabase, project.id);
  // The loader has already classified the pending-migration case, so anything
  // it hands back here is the half the banner owes the reader by name.
  if (aerialUnreadableReason) reads.check("aerial missions and evidence packages", { error: { message: aerialUnreadableReason } });
  const aerialProjectPosture = buildAerialProjectPosture(aerialMissions, aerialPackages);
  const aerialProjectPostureDetail = describeAerialProjectPosture(aerialProjectPosture);
  // Cached posture now lives in the aerial-owned aerial_project_posture table
  // (no longer a column on projects).
  const { posture: aerialCachedPosture, updatedAt: aerialCachedPostureUpdatedAt } =
    await loadAerialProjectPosture(supabase, project.id);
  const projectPlaceOfRecord = placeOfRecordFromProject(project);

  // ONE ANSWER PER LANE, SHARED BY BOTH BOARDS ON THIS SCREEN. The crosslink
  // board and the readiness rollup are built from the same reads and render
  // three inches apart, so a lane that is unreadable on one and "Not linked" on
  // the other is the product contradicting itself in front of a planner. The
  // keys are `ProjectSpineReadinessLaneKey`, which the rollup takes verbatim;
  // the crosslink board maps them onto its own eight lanes below.
  const lanePendingSchema = {
    rtp: projectRtpLinksPending || linkedRtpCyclesPending || workspaceRtpCyclesPending,
    reports: projectReportsPending || reportArtifactsPending,
    grants: projectFundingProfilePending || fundingAwardsPending || fundingOpportunitiesPending || projectInvoicesPending,
    engagement: engagementCampaignLane.pending,
    analysis: recentRunsPending || projectRunsPending || projectModelRunsPending,
    aerial: aerialEvidencePending,
  };
  const laneUnreadable = {
    rtp: rtpLinkLane.failed || linkedRtpCycleLane.failed || workspaceRtpCycleLane.failed,
    reports: projectReportLane.failed || reportArtifactLane.failed,
    grants:
      projectFundingProfileReadFailed || fundingAwardsReadFailed || fundingOpportunitiesReadFailed || projectInvoicesReadFailed,
    engagement: engagementCampaignLane.failed,
    analysis: recentRunLane.failed || projectRunsReadFailed || projectModelRunsReadFailed || projectReportLane.failed,
    aerial: Boolean(aerialUnreadableReason),
  };

  const projectSpineCrosslinkSummary = buildProjectSpineCrosslinkSummary({
    projectId: project.id,
    geography: geographyLaneInput(projectPlaceOfRecord, workspaceHomeGeographyLabel),
    linkedRtpCycleCount,
    reportRecordCount,
    reportAttentionCount,
    evidenceBackedReportCount,
    comparisonBackedReportCount,
    rtpLinks: {
      constrainedCount: constrainedRtpLinkCount,
      illustrativeCount: illustrativeRtpLinkCount,
      candidateCount: candidateRtpLinkCount,
    },
    scenarios: {
      scenarioSetCount: scenarioSets.length,
      activeScenarioSetCount: scenarioSets.filter((set) => set.status === "active").length,
      baselineCount: scenarioEntries.filter((entry) => entry.entry_type === "baseline").length,
      readyAlternativeCount: scenarioEntries.filter(
        (entry) => entry.entry_type === "alternative" && entry.status === "ready"
      ).length,
      attachedRunCount: scenarioEntries.filter((entry) => Boolean(entry.attached_run_id)).length,
    },
    funding: {
      hasTargetNeed: fundingStackSummary.hasTargetNeed,
      label: fundingStackSummary.label,
      reason: fundingStackSummary.reason,
      awardCount: fundingStackSummary.awardCount,
      opportunityCount: fundingStackSummary.opportunityCount,
      reimbursementPacketCount: fundingStackSummary.reimbursementPacketCount,
      unfundedAfterLikelyAmount: fundingStackSummary.unfundedAfterLikelyAmount,
      awardRiskCount: fundingStackSummary.awardRiskCount,
    },
    engagement: {
      label: strongestEngagementEvidence?.engagementLabel ?? "Not linked",
      itemCount: strongestEngagementEvidence?.engagementItemCount ?? 0,
      handoffReadyCount: strongestEngagementEvidence?.engagementReadyForHandoffCount ?? 0,
    },
    analysis: {
      // Project-attributed runs (analysis + worker) when provenance is
      // available; the workspace-recency fallback otherwise.
      recentRunCount:
        attributedRuns.length > 0 || projectModelRunCount > 0
          ? attributedRuns.length + projectModelRunCount
          : (recentRuns?.length ?? 0),
      comparisonBackedReportCount,
    },
    safety: {
      ingestCount: projectSafetyIngests.length,
      crashCount: Number(latestProjectSafetyIngest?.crash_count ?? 0),
      geocodedCount: Number(latestProjectSafetyIngest?.geocoded_count ?? 0),
      coverageLabel: latestProjectSafetyIngest
        ? COVERAGE_STATE_COPY[latestProjectSafetyIngest.coverage_state] ??
          latestProjectSafetyIngest.coverage_state
        : null,
      sourceLabel: latestProjectSafetyIngest?.source_label ?? null,
    },
    aerial: aerialProjectPosture,
    pendingSchema: {
      rtp_packets: lanePendingSchema.rtp || lanePendingSchema.reports,
      scenario_sets: scenarioSetsPending || scenarioEntriesPending,
      funding_profile: lanePendingSchema.grants,
      engagement_evidence: lanePendingSchema.reports,
      analysis_modeling: lanePendingSchema.analysis || lanePendingSchema.reports,
      safety_evidence: safetyIngestsPending,
      aerial_evidence: lanePendingSchema.aerial,
    },
    // The other half of the same question. Every flag here is a read this page
    // has ALREADY disclosed in its banner; without them the board answers "Not
    // linked" for a lane the banner has just called unreadable, and the board is
    // the surface a planner acts on.
    unreadable: {
      rtp_packets: laneUnreadable.rtp || laneUnreadable.reports,
      scenario_sets: scenarioSetLane.failed || scenarioEntryLane.failed,
      funding_profile: laneUnreadable.grants,
      engagement_evidence: laneUnreadable.reports,
      analysis_modeling: laneUnreadable.analysis,
      safety_evidence: safetyLane.failed,
      aerial_evidence: laneUnreadable.aerial,
    },
  });

  const latestPacketGeneratedAt = latestKnownDate(
    ...projectReports.map((report) => latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at)
  );
  const latestFundingUpdatedAt = latestKnownDate(
    projectFundingProfile?.updated_at,
    ...fundingAwards.map((award) => award.updated_at ?? award.created_at),
    ...fundingOpportunities.map((opportunity) => opportunity.updated_at ?? opportunity.created_at),
    ...projectInvoices.map((invoice) => invoice.created_at)
  );
  const fundingSpineRecordCount =
    (projectFundingProfile ? 1 : 0) + fundingAwards.length + fundingOpportunities.length + projectInvoices.length;
  const latestEngagementUpdatedAt = latestKnownDate(
    ...engagementCampaigns.map((campaign) => campaign.updated_at ?? campaign.created_at),
    ...engagementItems.map((item) => item.updated_at ?? item.created_at)
  );
  const latestAnalysisUpdatedAt = latestKnownDate(
    ...linkedRuns.map((run) => run.created_at),
    ...linkedReportRuns.map((link) => link.updated_at ?? link.created_at)
  );
  const latestAerialUpdatedAt = latestKnownDate(
    ...aerialMissions.map((mission) => mission.updated_at ?? mission.collected_at),
    ...aerialPackages.map((pkg) => pkg.updated_at)
  );
  const projectSpineReadiness = buildProjectSpineReadinessRollup({
    projectUpdatedAt: project.updated_at,
    latestPacketGeneratedAt,
    rtp: {
      count: existingRtpLinks.length,
      latestUpdatedAt: latestKnownDate(...projectRtpLinkRows.map((link) => link.created_at)),
      postureUpdatedAt: project.rtp_posture_updated_at,
    },
    reports: {
      count: reportRecordCount,
      latestUpdatedAt: latestKnownDate(...projectReports.map((report) => report.updated_at)),
      refreshRecommendedCount: refreshRecommendedReportCount,
      noPacketCount: noPacketReportCount,
      governanceHoldCount: governanceHoldReportCount,
      evidenceBackedCount: evidenceBackedReportCount,
      comparisonBackedCount: comparisonBackedReportCount,
    },
    grants: {
      count: fundingSpineRecordCount,
      latestUpdatedAt: latestFundingUpdatedAt,
    },
    engagement: {
      count: engagementCampaigns.length,
      latestUpdatedAt: latestEngagementUpdatedAt,
    },
    analysis: {
      // Legacy linked runs plus typed model/county citations — all three are
      // report-cited analysis evidence.
      count: linkedReportRunIds.length + typedCitationCount,
      latestUpdatedAt: latestAnalysisUpdatedAt,
      evidenceBackedReportCount,
    },
    aerial: {
      count: aerialMissions.length + aerialPackages.length,
      latestUpdatedAt: latestAerialUpdatedAt,
      missionCount: aerialProjectPosture.missionCount,
      packageCount: aerialPackages.length,
      readyPackageCount: aerialProjectPosture.readyPackageCount,
      verificationReadiness: aerialProjectPosture.verificationReadiness,
    },
    // Same two maps the crosslink board above is built from. This rollup had no
    // failure channel at all, so a failed aerial read rendered "No aerial
    // mission or evidence package is linked." directly under a board that had
    // just called the same lane unreadable.
    pendingSchema: lanePendingSchema,
    unreadable: laneUnreadable,
  });

  const operationsSummary = await operationsSummaryPromise;

  const timelineItems: TimelineItem[] = buildProjectTimelineItems({
    milestones,
    submittals,
    projectInvoices,
    deliverables,
    risks,
    issues,
    decisions,
    meetings,
    recentRuns,
    citedModelRuns,
    citedCountyRuns,
    recentGateDecisions,
  });

  // Null, not 0, when the read failed: a count is an assertion about the
  // project, and "we counted none" is not what a broken query established. The
  // header renders null the way it already renders an unreadable Knowledge Base
  // count — as "—" with the reason, never as a number.
  const openRiskCount = risksReadFailed
    ? null
    : risks.filter((risk) => risk.status !== "closed" && risk.status !== "mitigated").length;
  const openIssueCount = issuesReadFailed
    ? null
    : issues.filter((issue) => issue.status !== "resolved").length;

  return (
    <section className="module-page">
      <CartographicSurfaceWide />
      <div className="module-breadcrumb">
        <Link href="/projects" className="transition hover:text-foreground">
          Projects
        </Link>
        <ArrowRight className="h-4 w-4" />
        <span className="text-foreground">{project.name}</span>
      </div>

      {reads.any ? (
        <StateBlock
          tone="danger"
          title="Part of this page could not be read"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      ) : null}

      <ProjectPostureHeader
        project={project}
        workspaceData={workspaceData}
        stageGateBinding={stageGateBinding}
        projectControlsSummary={projectControlsSummary}
        linkedRtpCycleCount={linkedRtpCycleCount}
        constrainedRtpLinkCount={constrainedRtpLinkCount}
        illustrativeRtpLinkCount={illustrativeRtpLinkCount}
        candidateRtpLinkCount={candidateRtpLinkCount}
        projectRtpLinksPending={projectRtpLinksPending}
        workspaceRtpCycles={workspaceRtpCycles}
        existingRtpLinks={existingRtpLinks}
        availableModelRuns={availableModelRuns}
        rtpPriorityCriteria={rtpPriorityCriteria}
        deliverableCount={budgetInputs.deliverables.length}
        openRiskCount={openRiskCount}
        openIssueCount={openIssueCount}
        kbDocumentCount={kbDocumentCount}
        reportRecordCount={reportRecordCount}
        reportAttentionCount={reportAttentionCount}
        evidenceBackedReportCount={evidenceBackedReportCount}
        refreshRecommendedReportCount={refreshRecommendedReportCount}
        governanceHoldReportCount={governanceHoldReportCount}
        comparisonBackedReportCount={comparisonBackedReportCount}
        projectReports={projectReports}
        projectReportQueueItems={projectReportQueueItems}
        recommendedReport={recommendedReport}
        projectGrantModelingEvidence={projectGrantModelingEvidence}
        projectGrantModelingReadiness={projectGrantModelingReadiness}
        projectGrantModelingSupport={projectGrantModelingSupport}
      />

      <ProjectPostureUnified
        rtpPosture={project.rtp_posture}
        rtpPostureUpdatedAt={project.rtp_posture_updated_at}
        aerialPosture={aerialCachedPosture}
        aerialPostureUpdatedAt={aerialCachedPostureUpdatedAt}
      />

      <ProjectSpineCrosslinkBoard summary={projectSpineCrosslinkSummary} />
      <ProjectSpineReadinessRollup rollup={projectSpineReadiness} />

      <PilotWorkflowHandoff
        currentStep="context"
        projectId={project.id}
        title="Continue this pilot story"
        description={`${project.name} is the context anchor. Move next into analysis evidence, engagement signal, packet assembly, and readiness proof without losing the project thread.`}
      />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <ProjectRecordComposer projectId={project.id} />
          <WorkspaceRuntimeCue summary={operationsSummary} />
          <WorkspaceCommandBoard
            summary={operationsSummary}
            label="Workspace command board"
            title="What should move around this project"
            description={`Workspace priorities — packet, funding-window, and setup pressure — stay visible while you work on ${project.name}. Use this board to keep the project aligned with the rest of the workspace.`}
          />
        </div>

        <ProjectStageGateBoard
          stageGateSummary={stageGateSummary}
          workspaceId={project.workspace_id}
          projectId={project.id}
          canRecordDecision={canAccessWorkspaceAction("stage_gates.decisions.write", membership.role)}
        />
      </div>

      <ProjectIdentityEditor
        project={{
          id: project.id,
          name: project.name,
          summary: project.summary ?? null,
          status: project.status,
          planType: project.plan_type,
          deliveryPhase: project.delivery_phase,
          place: placeIdentityOnly(projectPlaceOfRecord),
        }}
        canWrite={!isReadOnlyWorkspaceRole(membership.role)}
        workspaceHomeLabel={workspaceHomeGeographyLabel}
      />

      <ProjectMapPresencePanel
        projectId={project.id}
        latitude={project.latitude}
        longitude={project.longitude}
        corridors={projectCorridors}
        corridorsPending={projectCorridorsPending}
        {...(projectMapHomeView ? { homeCenter: projectMapHomeView.center, homeZoom: projectMapHomeView.zoom } : {})}
        canWrite={!isReadOnlyWorkspaceRole(membership.role)}
      />

      <ProjectFundingPanel
        projectId={project.id}
        projectFundingProfile={projectFundingProfile}
        projectFundingProfilePending={projectFundingProfilePending}
        fundingAwardsPending={fundingAwardsPending}
        fundingAwardsReadFailed={fundingAwardsReadFailed}
        fundingOpportunitiesPending={fundingOpportunitiesPending}
        fundingAwards={fundingAwards}
        fundingOpportunities={fundingOpportunities}
        fundingOpportunitiesReadFailed={fundingOpportunitiesReadFailed}
        fundingStackSummary={fundingStackSummary}
        fundingNeedAmount={fundingNeedAmount}
        committedFundingAmount={committedFundingAmount}
        committedMatchAmount={committedMatchAmount}
        likelyFundingAmount={likelyFundingAmount}
        remainingFundingGap={remainingFundingGap}
        awardWatchCount={awardWatchCount}
        nextObligationAward={nextObligationAward}
        pursueFundingCount={pursueFundingCount}
        monitorFundingCount={monitorFundingCount}
        skipFundingCount={skipFundingCount}
        pursuedFundingAmount={pursuedFundingAmount}
        openFundingCount={openFundingCount}
        invoiceSummaryByFundingAwardId={invoiceSummaryByFundingAwardId}
        invoiceRecordsByFundingAwardId={invoiceRecordsByFundingAwardId}
        unlinkedProjectInvoices={unlinkedProjectInvoices}
        unlinkedProjectInvoiceSummary={unlinkedProjectInvoiceSummary}
        comparisonBackedFundingReport={comparisonBackedFundingReport}
      />

      <ProjectDeliveryBoard
        project={project}
        projectControlsSummary={projectControlsSummary}
        invoiceSummary={invoiceSummary}
        recommendedReport={recommendedReport}
        firstBlockedMilestone={firstBlockedMilestone}
        firstOverdueMilestone={firstOverdueMilestone}
        firstOverdueSubmittal={firstOverdueSubmittal}
        firstOverdueInvoice={firstOverdueInvoice}
        projectMilestonesPending={projectMilestonesPending}
        milestones={milestones}
        milestonesReadFailed={projectMilestonesReadFailed}
        prioritizedMilestones={prioritizedMilestones}
        projectSubmittalsPending={projectSubmittalsPending}
        submittals={submittals}
        submittalsReadFailed={projectSubmittalsReadFailed}
        prioritizedSubmittals={prioritizedSubmittals}
        projectInvoicesPending={projectInvoicesPending}
        projectInvoices={projectInvoices}
        invoicesReadFailed={projectInvoicesReadFailed}
        prioritizedProjectInvoices={prioritizedProjectInvoices}
        deliverables={deliverables}
        budgetSummaryByDeliverableId={budgetSummaryByDeliverableId}
      />

      <ProjectBudgetPanel
        projectId={project.id}
        snapshot={projectBudgetSnapshot}
        pendingSchema={{
          deliverableBudgetColumns: budgetInputs.pending.deliverableBudgetColumns,
          spendEntries: budgetInputs.pending.spendEntries,
          clientInvoices: budgetInputs.pending.clientInvoices,
        }}
        deliverableOptions={budgetInputs.deliverables.map((deliverable) => ({
          id: deliverable.id,
          title: deliverable.title,
        }))}
      />

      <ProjectRiskAndDecisionLog
        projectId={project.id}
        risks={risks}
        issues={issues}
        decisions={decisions}
        meetings={meetings}
        risksReadFailed={risksReadFailed}
        issuesReadFailed={issuesReadFailed}
        decisionsReadFailed={decisionsReadFailed}
        meetingsReadFailed={meetingsReadFailed}
      />

      <ProjectEvidenceAndActivity
        dataHubMigrationPending={dataHubMigrationPending}
        linkedDatasets={linkedDatasets}
        linkedDatasetsReadFailed={datasetLinkLane.failed}
        recentRuns={recentRuns}
        recentRunsReadFailed={recentRunLane.failed}
        aerialProjectPosture={aerialProjectPosture}
        aerialProjectPostureDetail={aerialProjectPostureDetail}
        aerialMissions={aerialMissions}
        aerialPackages={aerialPackages}
        aerialReadFailed={Boolean(aerialUnreadableReason)}
        aerialSchemaPending={aerialEvidencePending}
        projectId={project.id}
        projectPlaceLabel={project.place_label ?? null}
        timelineItems={timelineItems}
      />
    </section>
  );
}
