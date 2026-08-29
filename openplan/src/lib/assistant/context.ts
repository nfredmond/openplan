/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  loadProjectStageGateBoard,
  type StageGateDecisionQuerySupabaseLike,
} from "@/lib/stage-gates/decision-queries";
import { STAGE_GATE_BINDING_WORKSPACE_COLUMNS } from "@/lib/stage-gates/rebind";
import { resolveBoundStageGateTemplate } from "@/lib/stage-gates/bound-template";
import { stageGateTemplateRegistry } from "@/lib/stage-gates/template-registry";
import {
  buildProjectStageGateSummary,
  type ProjectStageGateSummary,
} from "@/lib/stage-gates/summary";
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
import {
  buildRtpFiscalConstraint,
  type RtpFiscalConstraintSummary,
} from "@/lib/rtp/fiscal-constraint";
import {
  loadRtpFinancialElement,
  type RtpFinancialElementSupabaseLike,
} from "@/lib/rtp/financial-element-queries";
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
import { loadSentimentHotspots, negativeItemIdsFromSyntheses } from "@/lib/engagement/hotspots";
import type { CampaignRepresentativeness } from "@/lib/engagement/representativeness";
import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  loadCurrentWorkspaceMembership,
  unwrapWorkspaceRecord,
  type WorkspaceMembershipRow,
} from "@/lib/workspaces/current";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSummary,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import {
  isClosingSoonFundingOpportunity,
  isOverdueFundingDecision,
  isPendingFundingDecision,
  type FundingOpportunityDeadlineFacts,
} from "@/lib/operations/funding-decision-status";
import type { AssistantTarget, AssistantTargetKind } from "@/lib/assistant/catalog";
import {
  buildWorkspaceTransitSummary,
  GTFS_ASSISTANT_FEED_COLUMNS,
  GTFS_ASSISTANT_VERSION_COLUMNS,
  type GtfsAssistantFeedRow,
  type GtfsAssistantVersionRow,
  type WorkspaceTransitSummary,
} from "@/lib/gtfs/assistant-summary";
import { filterToCurrentReadyVersion } from "@/lib/gtfs/persist";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { ReadFailureLog, type ReadFailure, type ReadResultLike } from "@/lib/ui/read-failures";
import type { JurisdictionReadinessReport } from "@/lib/jurisdiction-readiness/contracts";
import { resolveJurisdictionReadiness } from "@/lib/jurisdiction-readiness/registry";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";

/**
 * A READ THAT FAILED WHILE THIS CONTEXT WAS ASSEMBLED.
 *
 * WHY THIS FIELD EXISTS AND WHY IT IS ON EVERY CONTEXT. Every loader below
 * builds a fan of counts a copilot then SPEAKS: "3 chapters are ready for
 * review", "No funding opportunities are linked to this project yet", "Linked
 * projects: 0". A Supabase read hands back `null` data for both "there is
 * nothing here" and "this query failed", so a dropped connection, a revoked
 * grant or an RLS change used to arrive at the planner as a confident sentence
 * about their own agency's work — and from there into a grant narrative or an
 * RTP chapter, because this is the grounding the Planning Agent reasons from.
 *
 * THE COUNTS ARE STILL NUMBERS, and that is deliberate: `counts.chapters`
 * cannot become `number | null` without changing the shape every consumer of
 * this module already destructures. So the contract is the one
 * `ProjectStageGateSummary.unknownCount` already sets in this repo — a zero
 * whose read failed is NOT a finding, and ANY SURFACE RENDERING THESE COUNTS
 * MUST CHECK `unreadable` FIRST. `src/lib/assistant/respond.ts` does; the
 * sentences it builds from an unreadable lane say so instead of counting, and
 * `src/test/assistant-respond.test.ts` fails if one of them counts again.
 *
 * WHY `ReadFailureLog` RATHER THAN A LOCAL SHAPE. It is this repo's collector
 * for exactly this contract — "render everything that loaded and disclose the
 * rest" — and its own doc block says routes should not reach for it because a
 * route owes its caller a STATUS. This is neither a page nor a route: it is the
 * data layer behind a panel that speaks in prose, which is the case the
 * collector was written for.
 */
export type AssistantContextReadFailure = ReadFailure;

/**
 * The stable names a failed read is disclosed under.
 *
 * They are constants rather than inline strings because `respond.ts` matches on
 * them to decide whether a sentence may state a count. Two copies of the same
 * label drifting apart would restore the defect silently — the context would
 * disclose "RTP chapters" while the sentence looked for "rtp chapters", find
 * nothing, and go back to speaking the zero.
 *
 * Each reads in the middle of a sentence ("this could not read X"), so: the
 * planner's words, no leading capital, no trailing period.
 */
export const ASSISTANT_READ_SUBJECTS = {
  workspaceMembership: "workspace membership",
  workspaceProjects: "workspace projects",
  recentRuns: "recent analysis runs",
  projectDeliverables: "project deliverables",
  projectRisks: "project risks",
  projectIssues: "project issues",
  projectDecisions: "project decisions",
  projectMeetings: "project meetings",
  linkedDatasets: "linked datasets",
  linkedReports: "linked reports",
  fundingOpportunities: "funding opportunities",
  fundingAwards: "funding awards",
  reimbursementInvoices: "reimbursement invoices",
  reimbursementPackets: "reimbursement packets",
  fundingProfile: "the recorded funding need",
  reportArtifacts: "report artifacts",
  rtpCycles: "RTP cycles",
  rtpChapters: "RTP chapters",
  rtpLinkedProjects: "projects linked to this RTP cycle",
  /**
   * THE THREE FINANCIAL-ELEMENT LANES, WORDED EXACTLY AS THE CYCLE PAGE WORDS
   * THEM. `src/app/(app)/rtp/[rtpCycleId]/page.tsx` classifies the same three
   * reads under these same strings, so a planner who reads "the horizon periods
   * of this plan could not be read" on the page and then asks the copilot hears
   * the same phrase for the same failure. Two spellings of one failure read as
   * two different problems.
   */
  rtpHorizonBands: "the horizon periods of this plan",
  rtpFinancialAssumptions: "the revenue and cost assumptions of this plan",
  rtpPerformanceMeasures: "the performance measures of this plan",
  engagementCampaigns: "engagement campaigns",
  packetReports: "RTP board packets",
  planLinks: "plan links",
  scenarioSets: "scenario sets",
  programLinks: "program links",
  linkedPlans: "linked plans",
  scenarioEntries: "scenario entries",
  attachedRuns: "the runs attached to these scenarios",
  reportRunLinks: "the runs attached to this report",
  reportSections: "report sections",
  modelLinks: "model links",
  modelRuns: "model runs",
  linkedProject: "the linked project record",
  linkedRtpCycle: "the linked RTP cycle",
  linkedEngagementCampaign: "the linked engagement campaign",
  baselineRun: "the baseline run",
  stageGateBinding: "the workspace row that names the bound stage-gate template",
  transitFeeds: "this workspace's transit feeds",
  transitFeedVersions: "the transit feed versions this workspace analyses with",
  /**
   * THE MODULE-LANE SUBJECTS. Where a module's own page already discloses the
   * same failed read, the wording here matches that page exactly (crash imports,
   * aerial missions) — one failure must read as one problem on both surfaces.
   */
  clientInvoices: "client invoices",
  engagementModerationQueue: "the moderation queue of this workspace's campaigns",
  crashImports: "this workspace's crash imports",
  crashSeverityMix: "the severity mix of the latest ready crash import",
  aerialMissions: "this workspace's aerial missions",
  aerialProcessingJobs: "this workspace's aerial processing jobs",
  aerialEvidencePackages: "this workspace's aerial evidence packages",
  knowledgeBaseDocuments: "knowledge base documents",
  dataHubDatasets: "data hub datasets",
  dataHubConnectors: "data hub connectors",
  dataRefreshJobs: "data refresh jobs",
} as const;

/**
 * The context could not be built because a row this context IS ABOUT did not
 * load.
 *
 * WHY THIS THROWS WHERE EVERYTHING ELSE IS COLLECTED. A failed read on a
 * side-panel lane costs a count; a failed read on the ANCHOR row — the project,
 * the cycle, the report, or the caller's membership in the workspace — costs
 * the whole answer, and `loadAssistantContext` has exactly one way to say
 * "no": `null`. All four of its callers spell that `null` out loud as a claim.
 * Three routes answer 404 "Assistant context not found" and the chat tool
 * answers the model "No such surface is visible to this planner. It may not
 * exist or may belong to a workspace they are not a member of." A dropped
 * connection is not evidence that a planner's own project does not exist, and
 * it is certainly not evidence that they are not a member of their workspace.
 *
 * SO WHY NOT RETURN `{ context, error }`, the shape this repo prefers? Because
 * the four callers are in three route files and `chat-tools.ts`, none of which
 * this change owns, and a returned error nobody reads is worse than an
 * exception: it would be dropped at the first `if (!context)`. Every caller
 * already wraps the load in try/catch (the routes answer 500 with an
 * `assistant_context_unhandled_error` audit entry; `guarded()` in chat-tools
 * records a failed tool call), so a throw is the one signal that cannot be
 * mistaken for "not found" by code that was written before this distinction
 * existed. Widening the return type is the better long-term seam and is left as
 * follow-up for whoever owns those routes.
 *
 * It also makes the two membership paths agree. `loadCurrentWorkspaceMembership`
 * has always thrown on a failed read; the explicit-workspaceId branch beside it
 * swallowed the same failure and returned "not a member".
 */
export class AssistantContextUnreadableError extends Error {
  constructor(
    readonly subject: string,
    readonly reason: string
  ) {
    super(`The assistant could not read ${subject} (${reason}), so this context could not be built.`);
    this.name = "AssistantContextUnreadableError";
  }
}

function readFailureMessage(result: ReadResultLike): string {
  const message = result?.error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : "no message reported";
}

/**
 * The row this context is about, or a refusal — never a silent `null`.
 *
 * `data: null` with no error still means "no such row", which is a real answer
 * and stays a `null` return. Only an ERROR becomes the refusal.
 */
function requireAnchorRow<T>(subject: string, result: ReadResultLike): T | null {
  if (result?.error) {
    throw new AssistantContextUnreadableError(subject, readFailureMessage(result));
  }

  return ((result?.data ?? null) as T | null) ?? null;
}

/**
 * Classify a pending migration first, then collect what is left.
 *
 * A deployment that has not run the migration truthfully has none of the rows —
 * the table cannot hold any — so that case resolves to empty with nothing
 * disclosed. Every OTHER failure is recorded by name, which is the half that
 * used to be dropped: `looksLikePendingSchema(r.error?.message) ? [] : r.data`
 * turns a revoked grant into an empty list and hands it to the model as a fact.
 *
 * Returns whether the rows are empty because the schema is pending, so a caller
 * can keep whatever truthful default that case has (the RTP chapter templates,
 * for one).
 */
function collectUnlessPending(reads: ReadFailureLog, subject: string, result: ReadResultLike): boolean {
  const pending = looksLikePendingSchema(result?.error?.message);
  if (!pending) {
    reads.check(subject, result);
  }
  return pending;
}

/**
 * The seven module lanes that ground the copilot on their own surface instead
 * of falling back to the generic workspace context (the state before
 * 2026-08-10: /grants, /invoicing, /engagement, /safety, /aerial,
 * /knowledge-base and /data-hub were all invisible to the assistant).
 *
 * DESIGN CONSTRAINT, and why these are NOT new members of the
 * `AssistantContext` union: `respond.ts` and `operations.ts` (owned by another
 * lane) both dispatch on `context.kind` with a default branch that passes the
 * remaining union members to their workspace builders. A new union member
 * would fail their compile; a module-lane context that IS a
 * `WorkspaceAssistantContext` (workspace grounding plus a `moduleLane` lens,
 * with `kind` widened to name the surface) flows through both untouched and
 * still serializes its module lines in `chat-context.ts`.
 *
 * FAILURE ≠ EMPTY IS IN THE TYPE. Every sub-summary below is `... | null`,
 * and `null` means exactly one thing: THE READ FAILED, and the failure is
 * also disclosed by name in `unreadable`. An empty module is zeros inside a
 * non-null object. A serializer or tool that meets `null` must say the lane
 * could not be read — never that it is empty.
 */
export type AssistantModuleLaneKind =
  | "grants"
  | "invoicing"
  | "engagement"
  | "safety"
  | "aerial"
  | "knowledge_base"
  | "data_hub";

export type GrantsAssistantLaneSummary = {
  module: "grants";
  opportunities: {
    total: number;
    /**
     * Open/upcoming opportunities still marked 'monitor' whose decision due
     * date has NOT lapsed. decision_state is NOT NULL DEFAULT 'monitor', so
     * "awaiting a decision" can never mean a null decision_state.
     */
    awaitingDecision: number;
    monitor: number;
    pursue: number;
    skip: number;
    closingSoon: number;
    overdueDecision: number;
    lead: { id: string; title: string; status: string | null; decisionState: string | null; closesAt: string | null } | null;
  } | null;
  awards: {
    total: number;
    awardedAmount: number | null;
    activeSpending: number;
    riskFlagged: number;
  } | null;
};

export type InvoicingAssistantLaneSummary = {
  module: "invoicing";
  /** Grant reimbursements — the agency invoicing its FUNDER (LAPM-style), not billing anyone for OpenPlan. */
  reimbursements: {
    invoiceCount: number;
    linkedToAwardCount: number;
    awardsWithInvoices: number;
    draft: number;
    internalReview: number;
    submitted: number;
    approvedForPayment: number;
    paid: number;
    rejected: number;
    outstandingNetAmount: number | null;
  } | null;
  /** Client receivables — a consultancy invoicing its own clients. */
  receivables: {
    invoiceCount: number;
    draft: number;
    sent: number;
    paid: number;
    voided: number;
    outstandingAmount: number | null;
  } | null;
};

export type EngagementAssistantLaneSummary = {
  module: "engagement";
  campaigns: {
    total: number;
    draft: number;
    active: number;
    closed: number;
    archived: number;
    /** Active campaigns whose public submission window is open right now. */
    publicOpen: number;
  } | null;
  /** Counts only — comment BODIES are deliberately not loaded into this context. */
  moderation: {
    pending: number;
    flagged: number;
  } | null;
};

export type SafetyAssistantLaneSummary = {
  module: "safety";
  ingests: {
    /** Recent imports only — capped at the same 8 rows the safety page shows. */
    recentCount: number;
    ready: number;
    failed: number;
    noCoverage: number;
    inFlight: number;
    latest: {
      sourceLabel: string | null;
      coverageState: string;
      severityCompleteness: string;
      status: string;
      crashCount: number;
      geocodedCount: number;
      truncated: boolean;
      yearsRequested: number[];
      fetchError: string | null;
      createdAt: string;
    } | null;
  } | null;
  /**
   * Severity mix of the latest READY import. `null` when there is no ready
   * import to count — `unreadable` (below) says whether the count itself
   * failed, which is a different fact from "no ready import exists".
   */
  severityMix: {
    ingestId: string;
    fatal: number;
    severeInjury: number;
    injury: number;
    pdo: number;
  } | null;
};

export type AerialAssistantLaneSummary = {
  module: "aerial";
  missions: {
    total: number;
    planned: number;
    active: number;
    complete: number;
    cancelled: number;
  } | null;
  processing: {
    total: number;
    active: number;
    failed: number;
    succeeded: number;
    custodyComplete: number;
    custodyPartial: number;
    custodyNone: number;
  } | null;
  packages: {
    total: number;
    processing: number;
    qaPending: number;
    ready: number;
    shared: number;
    verificationReady: number;
  } | null;
};

export type KnowledgeBaseAssistantLaneSummary = {
  module: "knowledge_base";
  documents: {
    total: number;
    ready: number;
    inFlight: number;
    extractionFailed: number;
    /** status = 'stored': kept for download/reference, no extraction ATTEMPTED (≠ failed, which tried and found none). */
    stored: number;
    archived: number;
    linkedToProject: number;
    projectCount: number;
  } | null;
};

export type DataHubAssistantLaneSummary = {
  module: "data_hub";
  datasets: {
    total: number;
    ready: number;
    stale: number;
    error: number;
    other: number;
  } | null;
  connectors: {
    total: number;
    active: number;
    degraded: number;
    offline: number;
    withLastError: number;
  } | null;
  refreshJobs: {
    /** Recent jobs only — same 8-row cap as the data hub page. */
    recentCount: number;
    failed: number;
    latest: { status: string; jobName: string | null; errorSummary: string | null } | null;
  } | null;
};

export type AssistantModuleLaneSummary =
  | GrantsAssistantLaneSummary
  | InvoicingAssistantLaneSummary
  | EngagementAssistantLaneSummary
  | SafetyAssistantLaneSummary
  | AerialAssistantLaneSummary
  | KnowledgeBaseAssistantLaneSummary
  | DataHubAssistantLaneSummary;

/**
 * The exact projections the module-lane loaders ask the database for.
 *
 * Exported because the Supabase clients are untyped: a column deleted from one
 * of these strings would render as `undefined` with every mocked test green.
 * The lane tests assert on these strings AND on the loader passing them.
 */
export const MODULE_LANE_FUNDING_OPPORTUNITY_COLUMNS =
  "id, title, opportunity_status, decision_state, closes_at, decision_due_at, updated_at";
export const MODULE_LANE_FUNDING_AWARD_COLUMNS =
  "id, title, awarded_amount, spending_status, risk_flag, updated_at";
export const MODULE_LANE_REIMBURSEMENT_INVOICE_COLUMNS =
  "id, funding_award_id, status, amount, net_amount, due_date";
export const MODULE_LANE_CLIENT_INVOICE_COLUMNS = "id, status, total_amount, due_date";
export const MODULE_LANE_ENGAGEMENT_CAMPAIGN_COLUMNS =
  "id, title, status, allow_public_submissions, submissions_closed_at, updated_at";
export const MODULE_LANE_CRASH_INGEST_COLUMNS =
  "id, project_id, source_label, coverage_state, severity_completeness, status, crash_count, geocoded_count, truncated, years_requested, fetch_error, created_at";
export const MODULE_LANE_AERIAL_MISSION_COLUMNS = "id, status, mission_type";
export const MODULE_LANE_AERIAL_JOB_COLUMNS = "id, status, artifact_custody_state";
export const MODULE_LANE_AERIAL_PACKAGE_COLUMNS = "id, status, verification_readiness";
export const MODULE_LANE_KB_DOCUMENT_COLUMNS = "id, project_id, status, doc_kind, created_at";
export const MODULE_LANE_DATASET_COLUMNS = "id, status, geography_scope, updated_at";
export const MODULE_LANE_CONNECTOR_COLUMNS = "id, status, last_error_message, last_error_at, last_success_at";
export const MODULE_LANE_REFRESH_JOB_COLUMNS = "id, status, job_name, error_summary, created_at";

export type WorkspaceAssistantContext = {
  /**
   * `"workspace" | "analysis_studio"` plus the seven module-lane kinds — see
   * `AssistantModuleLaneKind` above for why a module lane is a widened
   * workspace context rather than a new union member. When `kind` names a
   * module lane, `moduleLane` carries that module's summary (matching
   * discriminant), set by `loadModuleLaneContext` without exception.
   */
  kind: "workspace" | "analysis_studio" | AssistantModuleLaneKind;
  workspace: {
    id: string | null;
    name: string | null;
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
  /**
   * The workspace's own transit feeds, as much as a refetch offer needs to
   * decide whether to appear. Built by `buildWorkspaceTransitSummary`, never
   * assembled here.
   *
   * REQUIRED, unlike `unreadable` below, and the difference is not stylistic.
   * `unreadable` is read defensively wherever it is read; this field is read by
   * `buildWorkspaceOperations` to decide whether to render a quick link, so an
   * absent one is a runtime error rather than a missing disclosure. Making it
   * required means a loader that forgets it fails to compile, which is the only
   * kind of rule this repository has been able to keep.
   */
  transit: WorkspaceTransitSummary;
  /**
   * The module lens over this workspace, present exactly when `kind` is a
   * module-lane kind. Optional for the same reason `unreadable` is — contexts
   * are built as literals by tests other lanes own — but `loadModuleLaneContext`
   * always sets it, and its sub-summaries are `null` ONLY for a failed read.
   */
  moduleLane?: AssistantModuleLaneSummary;
  /**
   * The reads that FAILED while this context loaded — see
   * `AssistantContextReadFailure`. Empty means every lane answered.
   *
   * OPTIONAL FOR ONE REASON ONLY: several test files outside this module build
   * these contexts as literals and are owned by other lanes, so a required
   * field would break their compile rather than their claim. Every loader in
   * this file always sets it. Read it as "absent means nothing failed" and add
   * it to any new literal.
   */
  unreadable?: AssistantContextReadFailure[];
};

export type ProjectAssistantContext = {
  kind: "project";
  workspace: {
    id: string;
    name: string | null;
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
  jurisdictionReadiness?: JurisdictionReadinessReport;
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
  stageGateSummary: ProjectStageGateSummary;
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
  /** Reads that failed while this context loaded — see `AssistantContextReadFailure`. */
  unreadable?: AssistantContextReadFailure[];
};

export type RtpRegistryAssistantContext = {
  kind: "rtp_registry";
  workspace: {
    id: string;
    name: string | null;
    role: string | null;
  };
  defaultModelingCountyRunId: string | null;
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
  /** Reads that failed while this context loaded — see `AssistantContextReadFailure`. */
  unreadable?: AssistantContextReadFailure[];
};

export type PlanAssistantContext = {
  kind: "plan";
  workspace: {
    id: string;
    name: string | null;
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
  /** Reads that failed while this context loaded — see `AssistantContextReadFailure`. */
  unreadable?: AssistantContextReadFailure[];
};

export type RtpAssistantContext = {
  kind: "rtp_cycle";
  workspace: {
    id: string;
    name: string | null;
    role: string | null;
  };
  defaultModelingCountyRunId: string | null;
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
  /**
   * THE FINANCIAL ELEMENT — the half of an RTP a board actually votes on.
   *
   * Until this existed the copilot answered questions about a plan whose own
   * page shows a revenue table, horizon periods and a fiscal-constraint verdict
   * from a projection that selected none of it, and said nothing about any of
   * them. That is not a neutral omission: a planner asking "can we afford this
   * plan?" got an answer built from chapter and packet counts.
   *
   * `summary` IS NULL WHEN A READ THE VERDICT DEPENDS ON FAILED, and that is
   * the entire design. `buildRtpFiscalConstraint` cannot distinguish "this plan
   * has no constrained projects" from "the project read failed" — both arrive
   * as an empty list — so over a failed read it finds no cost, no unpriced
   * project, no blocker, and answers `constrained` against whatever revenue did
   * load. A copilot computing a verdict from a partly-failed read is strictly
   * more dangerous than one blind to the financial element, because it states
   * that an unpriced plan is affordable. A null here means the copilot must say
   * the read failed, NOT that no fiscal issue was found.
   *
   * OPTIONAL FOR THE SAME REASON `unreadable` IS: test files outside this module
   * build `RtpAssistantContext` literals and a required field would break their
   * compile rather than their claim. `loadRtpContext` always sets it.
   */
  fiscal?: {
    summary: RtpFiscalConstraintSummary | null;
    performanceMeasureCount: number;
  };
  operationsSummary: WorkspaceOperationsSummary;
  /** Reads that failed while this context loaded — see `AssistantContextReadFailure`. */
  unreadable?: AssistantContextReadFailure[];
};

export type ProgramAssistantContext = {
  kind: "program";
  workspace: {
    id: string;
    name: string | null;
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
  /** Reads that failed while this context loaded — see `AssistantContextReadFailure`. */
  unreadable?: AssistantContextReadFailure[];
};

export type ScenarioAssistantContext = {
  kind: "scenario_set";
  workspace: {
    id: string;
    name: string | null;
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
  /** Reads that failed while this context loaded — see `AssistantContextReadFailure`. */
  unreadable?: AssistantContextReadFailure[];
};

export type ModelAssistantContext = {
  kind: "model";
  workspace: {
    id: string;
    name: string | null;
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
    /** Null on a run recorded before the column existed — never assumed. */
    engineKey: string | null;
    createdAt: string | null;
    completedAt: string | null;
  }>;
  schemaPending: boolean;
  /** Reads that failed while this context loaded — see `AssistantContextReadFailure`. */
  unreadable?: AssistantContextReadFailure[];
};

export type ReportAssistantContext = {
  kind: "report" | "rtp_packet_report";
  workspace: {
    id: string;
    name: string | null;
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
    hotspots: {
      clusterCount: number;
      significantCount: number;
      testedCount: number;
      globalNegativeSharePct: number | null;
    } | null;
    representativeness: {
      respondentCount: number;
      tractCount: number;
      underRepresented: string[];
      computedAt: string;
    } | null;
  } | null;
  rtpCycle: {
    id: string;
    title: string;
    status: string;
    updatedAt: string;
  } | null;
  /** Reads that failed while this context loaded — see `AssistantContextReadFailure`. */
  unreadable?: AssistantContextReadFailure[];
};

export type RunAssistantContext = {
  kind: "run";
  workspace: {
    id: string;
    name: string | null;
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
  /** Reads that failed while this context loaded — see `AssistantContextReadFailure`. */
  unreadable?: AssistantContextReadFailure[];
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

/**
 * Adapter from the snake_case rows this file reads to the shared funding
 * deadline convention (`@/lib/operations/funding-decision-status`), so the
 * assistant surfaces and the workspace summary count deadlines identically.
 */
function fundingDeadlineFacts(row: {
  opportunity_status?: string | null;
  decision_state?: string | null;
  closes_at?: string | null;
  decision_due_at?: string | null;
}): FundingOpportunityDeadlineFacts {
  return {
    opportunityStatus: row.opportunity_status ?? null,
    decisionState: row.decision_state ?? null,
    closesAt: row.closes_at ?? null,
    decisionDueAt: row.decision_due_at ?? null,
  };
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
  role: string | null;
};

async function loadDefaultAssignmentModelingCountyRunId(
  supabase: SupabaseLike,
  workspaceId: string,
  reads: ReadFailureLog
): Promise<string | null> {
  const result = await supabase
    .from("modeling_claim_decisions")
    .select("county_run_id")
    .eq("workspace_id", workspaceId)
    .eq("track", "assignment")
    .not("county_run_id", "is", null)
    .order("decided_at", { ascending: false })
    .limit(1);

  // A null here reads downstream as "no assignment run has been accepted for
  // this workspace", which is a claim about the agency's modeling posture and
  // steers which packet quick links are offered. A failed read is not that.
  if (collectUnlessPending(reads, "the accepted assignment modeling run", result)) {
    return null;
  }

  return ((result.data ?? []) as Array<{ county_run_id: string | null }>)[0]?.county_run_id ?? null;
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
      role: membership.role ?? null,
    };
  }

  const membershipResult = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  // A swallowed failure here answered "you are not a member of this workspace",
  // which is both false and alarming. The branch above — the same question,
  // asked without a workspace id — has always thrown on a failed read
  // (`loadCurrentWorkspaceMembership`); these two now agree.
  const membership = requireAnchorRow<WorkspaceMembershipRow>(
    ASSISTANT_READ_SUBJECTS.workspaceMembership,
    membershipResult
  );

  if (!membership) {
    return null;
  }

  const workspace = unwrapWorkspaceRecord(membership.workspaces);
  return {
    id: membership.workspace_id,
    name: workspace?.name ?? null,
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

/**
 * The workspace's transit posture, read and then handed straight to the builder.
 *
 * THREE THINGS HERE ARE LOAD-BEARING AND EACH MIRRORS A RULE THE TRANSIT LANE
 * ALREADY HOLDS ELSEWHERE:
 *
 *   1. `.eq("workspace_id", …)` — `gtfs_feeds.workspace_id IS NULL` means a
 *      PUBLIC PRELOADED FEED that every tenant on the deployment reads, and
 *      `.eq()` never matches NULL. So this read returns the workspace's OWN
 *      feeds and only those, which is exactly the set a refetch may act on: the
 *      refresh route refuses a public feed with a 403, because a refresh can
 *      move `current_version_id` and change what every other tenant analyses
 *      with.
 *   2. `filterToCurrentReadyVersion` — never a hand-written `is_current` or
 *      `status` filter. Filtering on `is_current` alone reads a
 *      promoted-then-failed version as service data; filtering on `status` alone
 *      gives a workspace with three successful ingests three service windows.
 *   3. A PENDING SCHEMA IS NOT A FAILURE. A deployment that has not applied the
 *      transit migrations truthfully has no feeds — the tables cannot hold
 *      any — so that case resolves to an empty, READABLE summary rather than a
 *      disclosed read failure a planner can do nothing about.
 */
async function loadWorkspaceTransitSummary(
  supabase: SupabaseLike,
  reads: ReadFailureLog,
  workspaceId: string
): Promise<WorkspaceTransitSummary> {
  const [feedsResult, versionsResult] = await Promise.all([
    supabase
      .from("gtfs_feeds")
      .select(GTFS_ASSISTANT_FEED_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200),
    filterToCurrentReadyVersion(
      supabase
        .from("gtfs_feed_versions")
        .select(GTFS_ASSISTANT_VERSION_COLUMNS)
        .eq("workspace_id", workspaceId)
    ).limit(200),
  ]);

  const feedsPending = collectUnlessPending(reads, ASSISTANT_READ_SUBJECTS.transitFeeds, feedsResult);
  const versionsPending = collectUnlessPending(
    reads,
    ASSISTANT_READ_SUBJECTS.transitFeedVersions,
    versionsResult
  );

  const feedsReadable = feedsPending || !feedsResult?.error;
  const versionsReadable = versionsPending || !versionsResult?.error;

  return buildWorkspaceTransitSummary({
    feeds: (feedsResult?.data ?? []) as unknown as GtfsAssistantFeedRow[],
    currentVersions: (versionsResult?.data ?? []) as unknown as GtfsAssistantVersionRow[],
    // UTC today. A day of slop cannot change a thirty-day window's verdict, and
    // taking the deployment's own zone here would make the same workspace get
    // different answers from different regions of the same host.
    today: new Date().toISOString().slice(0, 10),
    readable: feedsReadable && versionsReadable,
  });
}

async function loadWorkspaceContext(
  supabase: SupabaseLike,
  userId: string,
  target: AssistantTarget
): Promise<WorkspaceAssistantContext | null> {
  const reads = new ReadFailureLog();
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

  reads.check(ASSISTANT_READ_SUBJECTS.workspaceProjects, projectsResult);
  reads.check(ASSISTANT_READ_SUBJECTS.recentRuns, runDataResult);

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
  const runDetailsResult = runIds.length
    ? await supabase
        .from("runs")
        .select("id, title, summary_text, created_at, query_text, metrics")
        .eq("workspace_id", workspace.id)
        .in("id", runIds)
    : { data: [], error: null };
  // The planner asked to be grounded to THESE runs by id. If that read failed,
  // "no baseline run is currently attached" is a statement about their console,
  // not about the database.
  reads.check("the runs this console is grounded to", runDetailsResult);
  const runDetails = runDetailsResult.data;

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
    transit: await loadWorkspaceTransitSummary(supabase, reads, workspace.id),
    unreadable: [...reads.all],
  };
}

// ── Module-lane summaries ──────────────────────────────────────────────────
//
// Each loader below reads ONLY what its serialization speaks: counts, one lead
// record, one caveat. The row caps mirror the module's own page (8 recent
// ingests, 8 refresh jobs, 200-row list caps) so the copilot and the page
// count the same world. Every read runs on the caller's own session client —
// RLS applies — and every failure is disclosed under a named subject while the
// failed sub-summary goes `null`, never zero.

function laneReadFailed(reads: ReadFailureLog, subject: string, result: ReadResultLike): boolean {
  const pending = collectUnlessPending(reads, subject, result);
  return !pending && Boolean(result?.error);
}

async function loadGrantsLaneSummary(
  supabase: SupabaseLike,
  reads: ReadFailureLog,
  workspaceId: string
): Promise<GrantsAssistantLaneSummary> {
  const [opportunitiesResult, awardsResult] = await Promise.all([
    supabase
      .from("funding_opportunities")
      .select(MODULE_LANE_FUNDING_OPPORTUNITY_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("funding_awards")
      .select(MODULE_LANE_FUNDING_AWARD_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  const opportunitiesFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.fundingOpportunities, opportunitiesResult);
  const awardsFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.fundingAwards, awardsResult);

  const opportunityRows = (opportunitiesResult?.data ?? []) as Array<{
    id: string;
    title: string;
    opportunity_status: string | null;
    decision_state: string | null;
    closes_at: string | null;
    decision_due_at: string | null;
  }>;
  const awardRows = (awardsResult?.data ?? []) as Array<{
    id: string;
    title: string | null;
    awarded_amount: number | null;
    spending_status: string | null;
    risk_flag: string | null;
  }>;

  const now = new Date();
  const closing = opportunityRows
    .map((row) => ({ row, days: daysUntil(row.closes_at, now) }))
    .filter((entry): entry is { row: (typeof opportunityRows)[number]; days: number } => entry.days !== null && entry.days >= 0)
    .sort((left, right) => left.days - right.days);

  const awardedAmounts = awardRows
    .map((row) => row.awarded_amount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    module: "grants",
    opportunities: opportunitiesFailed
      ? null
      : {
          total: opportunityRows.length,
          // The shared convention (funding-decision-status.ts): pending =
          // open/upcoming + 'monitor'; overdue = pending past its due date;
          // awaiting = pending, not yet overdue. NEVER `!row.decision_state`
          // — the column is NOT NULL DEFAULT 'monitor', so that predicate
          // counted zero forever while its tests passed on impossible rows.
          awaitingDecision: opportunityRows.filter(
            (row) =>
              isPendingFundingDecision(fundingDeadlineFacts(row)) &&
              !isOverdueFundingDecision(fundingDeadlineFacts(row), now)
          ).length,
          monitor: opportunityRows.filter((row) => row.decision_state === "monitor").length,
          pursue: opportunityRows.filter((row) => row.decision_state === "pursue").length,
          skip: opportunityRows.filter((row) => row.decision_state === "skip").length,
          closingSoon: opportunityRows.filter((row) =>
            isClosingSoonFundingOpportunity(fundingDeadlineFacts(row), now)
          ).length,
          overdueDecision: opportunityRows.filter((row) =>
            isOverdueFundingDecision(fundingDeadlineFacts(row), now)
          ).length,
          lead: closing[0]
            ? {
                id: closing[0].row.id,
                title: closing[0].row.title,
                status: closing[0].row.opportunity_status ?? null,
                decisionState: closing[0].row.decision_state ?? null,
                closesAt: closing[0].row.closes_at ?? null,
              }
            : null,
        },
    awards: awardsFailed
      ? null
      : {
          total: awardRows.length,
          awardedAmount: awardedAmounts.length ? awardedAmounts.reduce((sum, value) => sum + value, 0) : null,
          activeSpending: awardRows.filter((row) => row.spending_status === "active").length,
          riskFlagged: awardRows.filter((row) => Boolean(row.risk_flag) && row.risk_flag !== "none").length,
        },
  };
}

async function loadInvoicingLaneSummary(
  supabase: SupabaseLike,
  reads: ReadFailureLog,
  workspaceId: string
): Promise<InvoicingAssistantLaneSummary> {
  const [reimbursementResult, receivableResult] = await Promise.all([
    supabase
      .from("billing_invoice_records")
      .select(MODULE_LANE_REIMBURSEMENT_INVOICE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("due_date", { ascending: true })
      .limit(200),
    supabase
      .from("client_invoices")
      .select(MODULE_LANE_CLIENT_INVOICE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const reimbursementFailed = laneReadFailed(
    reads,
    ASSISTANT_READ_SUBJECTS.reimbursementInvoices,
    reimbursementResult
  );
  const receivableFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.clientInvoices, receivableResult);

  const reimbursementRows = (reimbursementResult?.data ?? []) as Array<{
    id: string;
    funding_award_id: string | null;
    status: string | null;
    amount: number | null;
    net_amount: number | null;
  }>;
  const receivableRows = (receivableResult?.data ?? []) as Array<{
    id: string;
    status: string | null;
    total_amount: number | null;
  }>;

  const countReimbursement = (status: string) => reimbursementRows.filter((row) => row.status === status).length;
  const outstandingNet = reimbursementRows
    .filter((row) => row.status === "submitted" || row.status === "approved_for_payment")
    .map((row) => row.net_amount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const outstandingReceivable = receivableRows
    .filter((row) => row.status === "sent")
    .map((row) => row.total_amount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    module: "invoicing",
    reimbursements: reimbursementFailed
      ? null
      : {
          invoiceCount: reimbursementRows.length,
          linkedToAwardCount: reimbursementRows.filter((row) => Boolean(row.funding_award_id)).length,
          awardsWithInvoices: new Set(
            reimbursementRows.map((row) => row.funding_award_id).filter((value): value is string => Boolean(value))
          ).size,
          draft: countReimbursement("draft"),
          internalReview: countReimbursement("internal_review"),
          submitted: countReimbursement("submitted"),
          approvedForPayment: countReimbursement("approved_for_payment"),
          paid: countReimbursement("paid"),
          rejected: countReimbursement("rejected"),
          outstandingNetAmount: outstandingNet.length
            ? outstandingNet.reduce((sum, value) => sum + value, 0)
            : null,
        },
    receivables: receivableFailed
      ? null
      : {
          invoiceCount: receivableRows.length,
          draft: receivableRows.filter((row) => row.status === "draft").length,
          sent: receivableRows.filter((row) => row.status === "sent").length,
          paid: receivableRows.filter((row) => row.status === "paid").length,
          voided: receivableRows.filter((row) => row.status === "void").length,
          outstandingAmount: outstandingReceivable.length
            ? outstandingReceivable.reduce((sum, value) => sum + value, 0)
            : null,
        },
  };
}

async function loadEngagementLaneSummary(
  supabase: SupabaseLike,
  reads: ReadFailureLog,
  workspaceId: string
): Promise<EngagementAssistantLaneSummary> {
  const campaignsResult = await supabase
    .from("engagement_campaigns")
    .select(MODULE_LANE_ENGAGEMENT_CAMPAIGN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(200);

  const campaignsFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.engagementCampaigns, campaignsResult);
  const campaignRows = (campaignsResult?.data ?? []) as Array<{
    id: string;
    title: string;
    status: string | null;
    allow_public_submissions: boolean | null;
    submissions_closed_at: string | null;
  }>;

  // Moderation queue COUNTS only — head counts keyed by this workspace's own
  // campaign ids. Comment bodies never enter this context; substance reads
  // belong to the chat tools, where they are budgeted and logged per question.
  let moderation: EngagementAssistantLaneSummary["moderation"] = { pending: 0, flagged: 0 };
  if (campaignsFailed) {
    // Without the campaign list the queue cannot even be scoped; the campaign
    // read failure above already discloses why.
    moderation = null;
  } else if (campaignRows.length > 0) {
    const campaignIds = campaignRows.map((row) => row.id);
    const [pendingResult, flaggedResult] = await Promise.all([
      supabase
        .from("engagement_items")
        .select("id", { count: "exact", head: true })
        .in("campaign_id", campaignIds)
        .eq("status", "pending"),
      supabase
        .from("engagement_items")
        .select("id", { count: "exact", head: true })
        .in("campaign_id", campaignIds)
        .eq("status", "flagged"),
    ]);
    const pendingFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.engagementModerationQueue, pendingResult);
    const flaggedFailed = pendingFailed
      ? true
      : laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.engagementModerationQueue, flaggedResult);
    moderation =
      pendingFailed || flaggedFailed
        ? null
        : {
            pending: (pendingResult as { count?: number | null })?.count ?? 0,
            flagged: (flaggedResult as { count?: number | null })?.count ?? 0,
          };
  }

  return {
    module: "engagement",
    campaigns: campaignsFailed
      ? null
      : {
          total: campaignRows.length,
          draft: campaignRows.filter((row) => row.status === "draft").length,
          active: campaignRows.filter((row) => row.status === "active").length,
          closed: campaignRows.filter((row) => row.status === "closed").length,
          archived: campaignRows.filter((row) => row.status === "archived").length,
          publicOpen: campaignRows.filter(
            (row) => row.status === "active" && Boolean(row.allow_public_submissions) && !row.submissions_closed_at
          ).length,
        },
    moderation,
  };
}

async function loadSafetyLaneSummary(
  supabase: SupabaseLike,
  reads: ReadFailureLog,
  workspaceId: string
): Promise<SafetyAssistantLaneSummary> {
  const ingestsResult = await supabase
    .from("safety_crash_ingests")
    .select(MODULE_LANE_CRASH_INGEST_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(8);

  const ingestsFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.crashImports, ingestsResult);
  const ingestRows = (ingestsResult?.data ?? []) as Array<{
    id: string;
    source_label: string | null;
    coverage_state: string;
    severity_completeness: string;
    status: string;
    crash_count: number | null;
    geocoded_count: number | null;
    truncated: boolean | null;
    years_requested: number[] | null;
    fetch_error: string | null;
    created_at: string;
  }>;

  const latest = ingestRows[0] ?? null;
  const latestReady = ingestRows.find((row) => row.status === "ready") ?? null;

  // Severity mix via head counts against the latest READY import — never by
  // pulling crash rows into the prompt (an import can hold tens of thousands).
  let severityMix: SafetyAssistantLaneSummary["severityMix"] = null;
  if (!ingestsFailed && latestReady) {
    const severityCount = (severity: string) =>
      supabase
        .from("safety_crashes")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("ingest_id", latestReady.id)
        .eq("severity", severity);
    const [fatalResult, severeResult, injuryResult, pdoResult] = await Promise.all([
      severityCount("fatal"),
      severityCount("severe_injury"),
      severityCount("injury"),
      severityCount("pdo"),
    ]);
    const anyFailed = [fatalResult, severeResult, injuryResult, pdoResult].some((result) =>
      Boolean((result as ReadResultLike)?.error)
    );
    if (anyFailed) {
      const firstError = [fatalResult, severeResult, injuryResult, pdoResult].find((result) =>
        Boolean((result as ReadResultLike)?.error)
      );
      laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.crashSeverityMix, firstError as ReadResultLike);
    } else {
      severityMix = {
        ingestId: latestReady.id,
        fatal: (fatalResult as { count?: number | null })?.count ?? 0,
        severeInjury: (severeResult as { count?: number | null })?.count ?? 0,
        injury: (injuryResult as { count?: number | null })?.count ?? 0,
        pdo: (pdoResult as { count?: number | null })?.count ?? 0,
      };
    }
  }

  return {
    module: "safety",
    ingests: ingestsFailed
      ? null
      : {
          recentCount: ingestRows.length,
          ready: ingestRows.filter((row) => row.status === "ready").length,
          failed: ingestRows.filter((row) => row.status === "failed").length,
          noCoverage: ingestRows.filter((row) => row.status === "no_coverage").length,
          inFlight: ingestRows.filter((row) => row.status === "pending" || row.status === "fetching").length,
          latest: latest
            ? {
                sourceLabel: latest.source_label ?? null,
                coverageState: latest.coverage_state,
                severityCompleteness: latest.severity_completeness,
                status: latest.status,
                crashCount: Number(latest.crash_count ?? 0),
                geocodedCount: Number(latest.geocoded_count ?? 0),
                truncated: Boolean(latest.truncated),
                yearsRequested: latest.years_requested ?? [],
                fetchError: latest.fetch_error ?? null,
                createdAt: latest.created_at,
              }
            : null,
        },
    severityMix,
  };
}

async function loadAerialLaneSummary(
  supabase: SupabaseLike,
  reads: ReadFailureLog,
  workspaceId: string
): Promise<AerialAssistantLaneSummary> {
  const [missionsResult, jobsResult, packagesResult] = await Promise.all([
    supabase
      .from("aerial_missions")
      .select(MODULE_LANE_AERIAL_MISSION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .limit(500),
    supabase
      .from("aerial_processing_jobs")
      .select(MODULE_LANE_AERIAL_JOB_COLUMNS)
      .eq("workspace_id", workspaceId)
      .limit(200),
    supabase
      .from("aerial_evidence_packages")
      .select(MODULE_LANE_AERIAL_PACKAGE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .limit(500),
  ]);

  const missionsFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.aerialMissions, missionsResult);
  const jobsFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.aerialProcessingJobs, jobsResult);
  const packagesFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.aerialEvidencePackages, packagesResult);

  const missionRows = (missionsResult?.data ?? []) as Array<{ id: string; status: string | null }>;
  const jobRows = (jobsResult?.data ?? []) as Array<{
    id: string;
    status: string | null;
    artifact_custody_state: string | null;
  }>;
  const packageRows = (packagesResult?.data ?? []) as Array<{
    id: string;
    status: string | null;
    verification_readiness: string | null;
  }>;

  return {
    module: "aerial",
    missions: missionsFailed
      ? null
      : {
          total: missionRows.length,
          planned: missionRows.filter((row) => row.status === "planned").length,
          active: missionRows.filter((row) => row.status === "active").length,
          complete: missionRows.filter((row) => row.status === "complete").length,
          cancelled: missionRows.filter((row) => row.status === "cancelled").length,
        },
    processing: jobsFailed
      ? null
      : {
          total: jobRows.length,
          active: jobRows.filter(
            (row) => row.status === "requested" || row.status === "accepted" || row.status === "running"
          ).length,
          failed: jobRows.filter((row) => row.status === "failed" || row.status === "dispatch_failed").length,
          succeeded: jobRows.filter((row) => row.status === "succeeded").length,
          custodyComplete: jobRows.filter((row) => row.artifact_custody_state === "complete").length,
          custodyPartial: jobRows.filter((row) => row.artifact_custody_state === "partial").length,
          custodyNone: jobRows.filter((row) => row.artifact_custody_state === "none").length,
        },
    packages: packagesFailed
      ? null
      : {
          total: packageRows.length,
          processing: packageRows.filter((row) => row.status === "processing").length,
          qaPending: packageRows.filter((row) => row.status === "qa_pending").length,
          ready: packageRows.filter((row) => row.status === "ready").length,
          shared: packageRows.filter((row) => row.status === "shared").length,
          verificationReady: packageRows.filter((row) => row.verification_readiness === "ready").length,
        },
  };
}

async function loadKnowledgeBaseLaneSummary(
  supabase: SupabaseLike,
  reads: ReadFailureLog,
  workspaceId: string
): Promise<KnowledgeBaseAssistantLaneSummary> {
  const documentsResult = await supabase
    .from("kb_documents")
    .select(MODULE_LANE_KB_DOCUMENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);

  const documentsFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.knowledgeBaseDocuments, documentsResult);
  const documentRows = (documentsResult?.data ?? []) as Array<{
    id: string;
    project_id: string | null;
    status: string | null;
  }>;

  return {
    module: "knowledge_base",
    documents: documentsFailed
      ? null
      : {
          total: documentRows.length,
          ready: documentRows.filter((row) => row.status === "ready").length,
          inFlight: documentRows.filter((row) => row.status === "pending" || row.status === "extracting").length,
          extractionFailed: documentRows.filter((row) => row.status === "failed").length,
          stored: documentRows.filter((row) => row.status === "stored").length,
          archived: documentRows.filter((row) => row.status === "archived").length,
          linkedToProject: documentRows.filter((row) => Boolean(row.project_id)).length,
          projectCount: new Set(
            documentRows.map((row) => row.project_id).filter((value): value is string => Boolean(value))
          ).size,
        },
  };
}

async function loadDataHubLaneSummary(
  supabase: SupabaseLike,
  reads: ReadFailureLog,
  workspaceId: string
): Promise<DataHubAssistantLaneSummary> {
  const [datasetsResult, connectorsResult, refreshJobsResult] = await Promise.all([
    supabase
      .from("data_datasets")
      .select(MODULE_LANE_DATASET_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("data_connectors")
      .select(MODULE_LANE_CONNECTOR_COLUMNS)
      .eq("workspace_id", workspaceId)
      .limit(200),
    supabase
      .from("data_refresh_jobs")
      .select(MODULE_LANE_REFRESH_JOB_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const datasetsFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.dataHubDatasets, datasetsResult);
  const connectorsFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.dataHubConnectors, connectorsResult);
  const refreshJobsFailed = laneReadFailed(reads, ASSISTANT_READ_SUBJECTS.dataRefreshJobs, refreshJobsResult);

  const datasetRows = (datasetsResult?.data ?? []) as Array<{ id: string; status: string | null }>;
  const connectorRows = (connectorsResult?.data ?? []) as Array<{
    id: string;
    status: string | null;
    last_error_message: string | null;
  }>;
  const refreshJobRows = (refreshJobsResult?.data ?? []) as Array<{
    id: string;
    status: string | null;
    job_name: string | null;
    error_summary: string | null;
  }>;

  return {
    module: "data_hub",
    datasets: datasetsFailed
      ? null
      : {
          total: datasetRows.length,
          ready: datasetRows.filter((row) => row.status === "ready").length,
          stale: datasetRows.filter((row) => row.status === "stale").length,
          error: datasetRows.filter((row) => row.status === "error").length,
          other: datasetRows.filter(
            (row) => row.status !== "ready" && row.status !== "stale" && row.status !== "error"
          ).length,
        },
    connectors: connectorsFailed
      ? null
      : {
          total: connectorRows.length,
          active: connectorRows.filter((row) => row.status === "active").length,
          degraded: connectorRows.filter((row) => row.status === "degraded").length,
          offline: connectorRows.filter((row) => row.status === "offline").length,
          withLastError: connectorRows.filter((row) => Boolean(row.last_error_message)).length,
        },
    refreshJobs: refreshJobsFailed
      ? null
      : {
          recentCount: refreshJobRows.length,
          failed: refreshJobRows.filter((row) => row.status === "failed").length,
          latest: refreshJobRows[0]
            ? {
                status: refreshJobRows[0].status ?? "unknown",
                jobName: refreshJobRows[0].job_name ?? null,
                errorSummary: refreshJobRows[0].error_summary ?? null,
              }
            : null,
        },
  };
}

/**
 * A module-lane context IS the workspace context, refocused: the same
 * portfolio grounding every surface gets, plus the module's own summary and a
 * `kind` naming the surface so the catalog offers the module's workflows.
 */
async function loadModuleLaneContext(
  supabase: SupabaseLike,
  userId: string,
  target: AssistantTarget,
  kind: AssistantModuleLaneKind
): Promise<WorkspaceAssistantContext | null> {
  const base = await loadWorkspaceContext(supabase, userId, target);
  const workspaceId = base?.workspace.id;
  if (!base || !workspaceId) {
    return null;
  }

  const reads = new ReadFailureLog();
  const moduleLane = await (() => {
    switch (kind) {
      case "grants":
        return loadGrantsLaneSummary(supabase, reads, workspaceId);
      case "invoicing":
        return loadInvoicingLaneSummary(supabase, reads, workspaceId);
      case "engagement":
        return loadEngagementLaneSummary(supabase, reads, workspaceId);
      case "safety":
        return loadSafetyLaneSummary(supabase, reads, workspaceId);
      case "aerial":
        return loadAerialLaneSummary(supabase, reads, workspaceId);
      case "knowledge_base":
        return loadKnowledgeBaseLaneSummary(supabase, reads, workspaceId);
      case "data_hub":
        return loadDataHubLaneSummary(supabase, reads, workspaceId);
    }
  })();

  return {
    ...base,
    kind,
    moduleLane,
    unreadable: [...(base.unreadable ?? []), ...reads.all],
  };
}

async function loadProjectContext(
  supabase: SupabaseLike,
  userId: string,
  projectId: string
): Promise<ProjectAssistantContext | null> {
  const reads = new ReadFailureLog();
  const projectResult = await supabase
    .from("projects")
    .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at, place_label, place_country_code, place_subdivision_code")
    .eq("id", projectId)
    .maybeSingle();

  const project = requireAnchorRow<{
    id: string;
    workspace_id: string;
    name: string;
    summary: string | null;
    status: string;
    plan_type: string;
    delivery_phase: string;
    updated_at: string;
    place_label: string | null;
    place_country_code: string | null;
    place_subdivision_code: string | null;
  }>("this project record", projectResult);

  if (!project) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, project.workspace_id);
  if (!workspace) {
    return null;
  }

  // The gate board renders under the template this workspace is BOUND to. The
  // binding lives on the workspace row (the stored template id reconciled
  // against the workspace's own geography), so the row is read first, with the
  // shared projection constant, and resolved through the same seam every other
  // surface uses — the board loader does not guess and has no registry-default
  // fallback. When the binding cannot be established (the row is unreadable,
  // or it names a template this deployment does not register) the board is
  // built as EXPLICITLY UNREADABLE below — every gate state unknown, with the
  // reason — because the copilot restates this board as claims about the
  // planner's own project ("no stage gate is currently on hold").
  const workspaceBindingResult = await supabase
    .from("workspaces")
    .select(STAGE_GATE_BINDING_WORKSPACE_COLUMNS)
    .eq("id", project.workspace_id)
    .maybeSingle();
  reads.check(ASSISTANT_READ_SUBJECTS.stageGateBinding, workspaceBindingResult);
  const { templateId: boundStageGateTemplateId, unavailableReason: stageGateBindingUnavailableReason } =
    resolveBoundStageGateTemplate(workspaceBindingResult.data, workspaceBindingResult.error);

  const [
    deliverablesResult,
    risksResult,
    issuesResult,
    decisionsResult,
    meetingsResult,
    stageGateBoard,
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
    // Through the shared loader rather than inline, because the assistant
    // restates this board as a claim about THIS project — "no stage gate is
    // currently on hold" — and the loader is where the two rules that makes
    // honest live: the read is scoped to the project, and a read that FAILED is
    // reported as unreadable instead of as an empty log. With no resolvable
    // binding the loader is not called at all; the unreadable board is built
    // after this fan-out instead.
    boundStageGateTemplateId
      ? loadProjectStageGateBoard(supabase as unknown as StageGateDecisionQuerySupabaseLike, {
          workspaceId: project.workspace_id,
          projectId: project.id,
          templateId: boundStageGateTemplateId,
        })
      : Promise.resolve(null),
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

  // Every count and dollar figure below is spoken by the copilot as a fact
  // about this project. Classify the one failure that truthfully means "none
  // exist" — an unapplied migration — and disclose every other one by name.
  reads.check(ASSISTANT_READ_SUBJECTS.projectDeliverables, deliverablesResult);
  reads.check(ASSISTANT_READ_SUBJECTS.projectRisks, risksResult);
  reads.check(ASSISTANT_READ_SUBJECTS.projectIssues, issuesResult);
  reads.check(ASSISTANT_READ_SUBJECTS.projectDecisions, decisionsResult);
  reads.check(ASSISTANT_READ_SUBJECTS.projectMeetings, meetingsResult);
  reads.check(ASSISTANT_READ_SUBJECTS.recentRuns, runsResult);
  reads.check(ASSISTANT_READ_SUBJECTS.reimbursementPackets, reimbursementSubmittalsResult);

  const datasetLinkRows = collectUnlessPending(reads, ASSISTANT_READ_SUBJECTS.linkedDatasets, datasetLinksResult)
    ? []
    : ((datasetLinksResult.data ?? []) as Array<{
        dataset_id: string;
        relationship_type: string;
        linked_at: string;
      }>);
  const projectFundingProfile = collectUnlessPending(
    reads,
    ASSISTANT_READ_SUBJECTS.fundingProfile,
    projectFundingProfileResult
  )
    ? null
    : ((projectFundingProfileResult.data ?? null) as {
        funding_need_amount: number | null;
        local_match_need_amount?: number | null;
      } | null);
  const fundingOpportunities = collectUnlessPending(
    reads,
    ASSISTANT_READ_SUBJECTS.fundingOpportunities,
    fundingOpportunitiesResult
  )
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
  const fundingAwards = collectUnlessPending(reads, ASSISTANT_READ_SUBJECTS.fundingAwards, fundingAwardsResult)
    ? []
    : ((fundingAwardsResult.data ?? []) as Array<{
        id: string;
        funding_opportunity_id: string | null;
        awarded_amount: number | null;
        match_amount: number | null;
        risk_flag: string | null;
        obligation_due_at: string | null;
      }>);
  const fundingInvoices = collectUnlessPending(
    reads,
    ASSISTANT_READ_SUBJECTS.reimbursementInvoices,
    fundingInvoicesResult
  )
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
  const deadlineNow = new Date();
  const overdueMonitoredFundingOpportunities = fundingOpportunities.filter((opportunity) =>
    isOverdueFundingDecision(fundingDeadlineFacts(opportunity), deadlineNow)
  );
  const leadOverdueFundingOpportunity = [...overdueMonitoredFundingOpportunities].sort((left, right) => {
    const leftDue = left.decision_due_at ? new Date(left.decision_due_at).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.decision_due_at ? new Date(right.decision_due_at).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime();
  })[0] ?? null;
  const closingSoonFundingOpportunities = fundingOpportunities.filter((opportunity) =>
    isClosingSoonFundingOpportunity(fundingDeadlineFacts(opportunity), deadlineNow)
  );
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

  const datasetRows = collectUnlessPending(reads, "the linked dataset records", datasetsResult)
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
    (collectUnlessPending(reads, "the connectors behind these datasets", connectorsResult)
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

  const projectReports = collectUnlessPending(reads, ASSISTANT_READ_SUBJECTS.linkedReports, projectReportsResult)
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
  reads.check(ASSISTANT_READ_SUBJECTS.reportArtifacts, reportArtifactsResult);
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
    jurisdictionReadiness: resolveJurisdictionReadiness(
      {
        countryCode: project.place_country_code,
        subdivisionCode: project.place_subdivision_code,
        label: project.place_label,
      },
      "project-evidence-handoff",
      { registrySha256: jurisdictionReadinessRegistrySha256() },
    ) ?? undefined,
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
      closingSoonCount: fundingOpportunities.filter((opportunity) =>
        isClosingSoonFundingOpportunity(fundingDeadlineFacts(opportunity), deadlineNow)
      ).length,
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
    // The board the loader built under the BOUND template — or, when the
    // binding could not be established, a board that is explicitly unreadable:
    // every gate state unknown, with the reason, on the registry default's
    // gate SHAPE only. That shape asserts nothing (no state, no decision); the
    // alternative — rendering the default's gates as this workspace's with
    // confident states — is the substitution this whole seam exists to refuse.
    stageGateSummary:
      stageGateBoard?.summary ??
      buildProjectStageGateSummary([], {
        templateId: stageGateTemplateRegistry.defaultTemplateId ?? "",
        decisionsUnavailable: {
          reason:
            stageGateBindingUnavailableReason ??
            "the workspace's stage-gate template binding could not be established",
        },
      }),
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
    // The stage-gate board is NOT listed here: it carries its own
    // `decisionsRead` state and `respond.ts` already refuses to count gates
    // when that says the log did not load. Disclosing it twice would have the
    // copilot say the same thing in two voices.
    unreadable: [...reads.all],
  };
}

async function loadRtpRegistryContext(
  supabase: SupabaseLike,
  userId: string,
  target: AssistantTarget
): Promise<RtpRegistryAssistantContext | null> {
  const reads = new ReadFailureLog();
  const workspace = await requireWorkspaceEnvelope(supabase, userId, target.workspaceId);
  if (!workspace?.id) {
    return null;
  }

  const [cyclesResult, defaultModelingCountyRunId] = await Promise.all([
    supabase
      .from("rtp_cycles")
      .select("id, title, status, updated_at")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(200),
    loadDefaultAssignmentModelingCountyRunId(supabase, workspace.id, reads),
  ]);

  reads.check(ASSISTANT_READ_SUBJECTS.rtpCycles, cyclesResult);
  const cycles = (cyclesResult.data ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    updated_at: string;
  }>;
  const cycleIds = cycles.map((cycle) => cycle.id);

  const packetReportResult = cycleIds.length
    ? await supabase
        .from("reports")
        .select("id, rtp_cycle_id, title, generated_at, latest_artifact_kind, updated_at")
        .in("rtp_cycle_id", cycleIds)
        .eq("report_type", "board_packet")
        .order("updated_at", { ascending: false })
    : { data: [], error: null };

  reads.check(ASSISTANT_READ_SUBJECTS.packetReports, packetReportResult);
  const packetReports = (packetReportResult.data ?? []) as Array<{
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
  reads.check(ASSISTANT_READ_SUBJECTS.reportArtifacts, packetArtifactResult);
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
    defaultModelingCountyRunId,
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
    unreadable: [...reads.all],
  };
}

async function loadPlanContext(
  supabase: SupabaseLike,
  userId: string,
  planId: string
): Promise<PlanAssistantContext | null> {
  const reads = new ReadFailureLog();
  const planResult = await supabase
    .from("plans")
    .select("id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, updated_at, projects(id, name)")
    .eq("id", planId)
    .maybeSingle();

  const plan = requireAnchorRow<any>("this plan record", planResult);

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

  reads.check(ASSISTANT_READ_SUBJECTS.planLinks, planLinksResult);
  reads.check(ASSISTANT_READ_SUBJECTS.scenarioSets, scenarioResult);
  reads.check(ASSISTANT_READ_SUBJECTS.engagementCampaigns, campaignResult);
  reads.check(ASSISTANT_READ_SUBJECTS.linkedReports, reportResult);

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
    unreadable: [...reads.all],
  };
}

/**
 * THE CYCLE PROJECTION, AS A NAMED CONSTANT SO A TEST CAN READ IT.
 *
 * `financial_basis_year` and `annual_inflation_rate` are not decoration: they
 * are the two inputs that decide whether the fiscal-constraint figures are
 * year-of-expenditure dollars (which 23 CFR 450.324(f)(11)(iv) requires) or
 * constant dollars carrying a caveat. Dropping either does not produce an
 * error — it produces a plan silently reported in the wrong dollars.
 */
export const RTP_CYCLE_ASSISTANT_COLUMNS =
  "id, workspace_id, title, summary, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, financial_basis_year, annual_inflation_rate, updated_at";

/**
 * THE LINK PROJECTION, AND `portfolio_role` IS THE LOAD-BEARING COLUMN.
 *
 * `buildRtpFiscalConstraint` counts cost ONLY for links whose
 * `portfolio_role` is `RTP_CONSTRAINED_PORTFOLIO_ROLE` — illustrative and
 * candidate projects sit outside the constrained programme by regulation. Ask
 * for the cost columns WITHOUT this one and every link reads as
 * non-constrained: no cost is counted, no unpriced project is found, no blocker
 * is raised, and a plan with no priced projects at all reports
 * `balance >= 0` — `constrained` — against whatever revenue did load. The
 * copilot then tells a planner their unpriced plan is affordable. There is no
 * error and no empty state to notice; the failure is a confident wrong answer.
 */
export const RTP_CYCLE_LINK_ASSISTANT_COLUMNS =
  "id, project_id, portfolio_role, horizon_band_id, estimated_cost, cost_basis_year, projects(id, name)";

type RtpAssistantProjectLinkRow = {
  id: string;
  project_id: string;
  portfolio_role: string | null;
  horizon_band_id: string | null;
  estimated_cost: number | string | null;
  cost_basis_year: number | null;
  projects?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
};

async function loadRtpContext(
  supabase: SupabaseLike,
  userId: string,
  rtpCycleId: string
): Promise<RtpAssistantContext | null> {
  const reads = new ReadFailureLog();
  const cycleResult = await supabase
    .from("rtp_cycles")
    .select(RTP_CYCLE_ASSISTANT_COLUMNS)
    .eq("id", rtpCycleId)
    .maybeSingle();

  const cycle = requireAnchorRow<any>("this RTP cycle record", cycleResult);

  if (!cycle) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, cycle.workspace_id);
  if (!workspace) {
    return null;
  }

  const [
    chaptersResult,
    projectLinksResult,
    campaignsResult,
    packetReportsResult,
    financialElement,
    defaultModelingCountyRunId,
  ] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select("id, status")
      .eq("rtp_cycle_id", cycle.id),
    supabase
      .from("project_rtp_cycle_links")
      .select(RTP_CYCLE_LINK_ASSISTANT_COLUMNS)
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
    // THE SHARED LOADER, NOT THREE HAND-WRITTEN READS. The cycle page, the
    // export route and the report-generate route all go through this one
    // function, and its own header says why: the mapping is where the traps are
    // (PostgREST returns NUMERIC as a string; an absent cost must stay absent
    // rather than become zero). A fourth private copy here would be the seam
    // defect this repo keeps hitting — the copilot's arithmetic drifting from
    // the page's without either side being wrong on its own terms.
    loadRtpFinancialElement(supabase as unknown as RtpFinancialElementSupabaseLike, cycle.id),
    loadDefaultAssignmentModelingCountyRunId(supabase, workspace.id, reads),
  ]);

  // THE TEMPLATE FALLBACK IS FOR ONE FAILURE ONLY. A deployment without the
  // chapter table cannot hold a chapter, so "the template's chapters, none
  // started" is true there. Every other failure used to fall through to the
  // line below and become `[]`, which the copilot speaks as "0 chapters are
  // ready for review and 0 are complete" — a sentence about an agency's RTP
  // that nothing read. Now it is disclosed and `respond.ts` refuses to count.
  const chapters = collectUnlessPending(reads, ASSISTANT_READ_SUBJECTS.rtpChapters, chaptersResult)
    ? RTP_CHAPTER_TEMPLATES.map((template) => ({ id: `template-${template.chapterKey}`, status: "not_started" }))
    : ((chaptersResult.data ?? []) as Array<{ id: string; status: string }>);
  const linkedProjectsPending = collectUnlessPending(
    reads,
    ASSISTANT_READ_SUBJECTS.rtpLinkedProjects,
    projectLinksResult
  );
  const linkedProjects = linkedProjectsPending
    ? []
    : ((projectLinksResult.data ?? []) as RtpAssistantProjectLinkRow[]);
  const campaigns = collectUnlessPending(reads, ASSISTANT_READ_SUBJECTS.engagementCampaigns, campaignsResult)
    ? []
    : ((campaignsResult.data ?? []) as Array<{ id: string }>);
  const packetReports = collectUnlessPending(reads, ASSISTANT_READ_SUBJECTS.packetReports, packetReportsResult)
    ? []
    : ((packetReportsResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        generated_at: string | null;
        latest_artifact_kind: string | null;
        updated_at: string;
      }>);
  // THE FINANCIAL ELEMENT, CLASSIFIED THE SAME WAY EVERYTHING ELSE HERE IS. A
  // deployment that has not run migration 20260805000003 truthfully holds no
  // horizon bands — the table cannot hold one — so that case is silent and
  // resolves to an empty element. Every OTHER failure is disclosed by name, and
  // it is the failure, not the emptiness, that the copilot then speaks.
  const horizonBandsPending = collectUnlessPending(
    reads,
    ASSISTANT_READ_SUBJECTS.rtpHorizonBands,
    financialElement.results.bands
  );
  const financialAssumptionsPending = collectUnlessPending(
    reads,
    ASSISTANT_READ_SUBJECTS.rtpFinancialAssumptions,
    financialElement.results.lines
  );
  collectUnlessPending(
    reads,
    ASSISTANT_READ_SUBJECTS.rtpPerformanceMeasures,
    financialElement.results.measures
  );

  // A READ FAILURE OUTRANKS THE VERDICT — the same rule, and the same three
  // lanes, as `fiscalReadFailed` on the cycle page. `buildRtpFiscalConstraint`
  // reads an empty band list, an empty ledger and an empty project list as
  // facts about the plan, so running it over a failed read manufactures a
  // verdict: no cost, no blocker, `balance >= 0`, `constrained`. Pending schema
  // is deliberately NOT a failure here — a plan whose bands table does not
  // exist genuinely has no bands, and the engine's own `no_horizon_bands`
  // blocker is the right answer for it.
  const fiscalReadFailed =
    (!horizonBandsPending && Boolean(financialElement.results.bands.error)) ||
    (!financialAssumptionsPending && Boolean(financialElement.results.lines.error)) ||
    (!linkedProjectsPending && Boolean(projectLinksResult.error));

  const fiscalSummary = fiscalReadFailed
    ? null
    : buildRtpFiscalConstraint({
        cycleHorizonStartYear: cycle.horizon_start_year,
        cycleHorizonEndYear: cycle.horizon_end_year,
        cycleFinancialBasisYear: cycle.financial_basis_year ?? null,
        annualInflationRate: cycle.annual_inflation_rate ?? null,
        bands: financialElement.bands,
        lines: financialElement.lines,
        projects: linkedProjects.map((link) => {
          const linkedProject = Array.isArray(link.projects)
            ? link.projects[0] ?? null
            : link.projects ?? null;
          return {
            linkId: link.id,
            projectId: link.project_id,
            projectName: linkedProject?.name ?? null,
            portfolioRole: link.portfolio_role ?? null,
            horizonBandId: link.horizon_band_id ?? null,
            estimatedCost: link.estimated_cost ?? null,
            costBasisYear: link.cost_basis_year ?? null,
          };
        }),
      });

  const packetArtifactsResult = packetReports.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at")
        .in(
          "report_id",
          packetReports.map((report) => report.id)
        )
    : { data: [], error: null };
  reads.check(ASSISTANT_READ_SUBJECTS.reportArtifacts, packetArtifactsResult);
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
    defaultModelingCountyRunId,
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
    fiscal: {
      summary: fiscalSummary,
      performanceMeasureCount: financialElement.measures.length,
    },
    operationsSummary: await loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      workspace.id
    ),
    unreadable: [...reads.all],
  };
}

async function loadProgramContext(
  supabase: SupabaseLike,
  userId: string,
  programId: string
): Promise<ProgramAssistantContext | null> {
  const reads = new ReadFailureLog();
  const programResult = await supabase
    .from("programs")
    .select("id, workspace_id, project_id, title, program_type, status, cycle_name, sponsor_agency, summary, nomination_due_at, adoption_target_at, projects(id, name), updated_at")
    .eq("id", programId)
    .maybeSingle();

  const program = requireAnchorRow<any>("this program record", programResult);

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

  reads.check(ASSISTANT_READ_SUBJECTS.programLinks, linksResult);
  reads.check(ASSISTANT_READ_SUBJECTS.linkedPlans, plansResult);
  reads.check(ASSISTANT_READ_SUBJECTS.linkedReports, projectReportsResult);
  reads.check(ASSISTANT_READ_SUBJECTS.engagementCampaigns, campaignsResult);
  reads.check(ASSISTANT_READ_SUBJECTS.fundingOpportunities, fundingOpportunitiesResult);
  reads.check(ASSISTANT_READ_SUBJECTS.fundingAwards, fundingAwardsResult);
  reads.check(ASSISTANT_READ_SUBJECTS.reimbursementInvoices, fundingInvoicesResult);
  reads.check(ASSISTANT_READ_SUBJECTS.reimbursementPackets, reimbursementSubmittalsResult);
  reads.check(ASSISTANT_READ_SUBJECTS.fundingProfile, projectFundingProfileResult);

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
  const fundingDeadlineNow = new Date();
  const closingSoonFundingOpportunities = fundingOpportunities.filter((opportunity) =>
    isClosingSoonFundingOpportunity(fundingDeadlineFacts(opportunity), fundingDeadlineNow)
  );
  const fundingClosingSoonCount = closingSoonFundingOpportunities.length;
  const leadClosingFundingOpportunity = [...closingSoonFundingOpportunities].sort((left, right) => {
    const leftDueRaw = left.closes_at ?? left.decision_due_at;
    const rightDueRaw = right.closes_at ?? right.decision_due_at;
    const leftDue = leftDueRaw ? new Date(leftDueRaw).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = rightDueRaw ? new Date(rightDueRaw).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime();
  })[0] ?? null;
  const overdueMonitoredFundingOpportunities = fundingOpportunities.filter((opportunity) =>
    isOverdueFundingDecision(fundingDeadlineFacts(opportunity), fundingDeadlineNow)
  );
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
  reads.check("the reports linked to this program", explicitReportsResult);
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
  reads.check(ASSISTANT_READ_SUBJECTS.reportArtifacts, reportArtifactsResult);
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
    unreadable: [...reads.all],
  };
}

async function loadScenarioContext(
  supabase: SupabaseLike,
  userId: string,
  scenarioSetId: string
): Promise<ScenarioAssistantContext | null> {
  const reads = new ReadFailureLog();
  const scenarioSetResult = await supabase
    .from("scenario_sets")
    .select("id, workspace_id, project_id, title, summary, planning_question, status, baseline_entry_id")
    .eq("id", scenarioSetId)
    .maybeSingle();

  const scenarioSet = requireAnchorRow<any>("this scenario set record", scenarioSetResult);

  if (!scenarioSet) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, scenarioSet.workspace_id);
  if (!workspace) {
    return null;
  }

  const [projectResult, entriesResult, reportsResult] = await Promise.all([
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

  reads.check(ASSISTANT_READ_SUBJECTS.linkedProject, projectResult);
  reads.check(ASSISTANT_READ_SUBJECTS.scenarioEntries, entriesResult);
  reads.check(ASSISTANT_READ_SUBJECTS.linkedReports, reportsResult);
  const project = projectResult.data;
  const entriesData = entriesResult.data;
  const reportsData = reportsResult.data;

  const runIds = (entriesData ?? [])
    .map((entry: any) => entry.attached_run_id)
    .filter((value: unknown): value is string => Boolean(value));
  const attachedRunsResult = runIds.length
    ? await supabase.from("runs").select("id, title, summary_text, metrics, created_at").in("id", runIds)
    : { data: [], error: null };
  reads.check(ASSISTANT_READ_SUBJECTS.attachedRuns, attachedRunsResult);

  const reportIds = (reportsData ?? []).map((report: any) => report.id);
  const reportRunsResult = reportIds.length
    ? await supabase.from("report_runs").select("report_id, run_id").in("report_id", reportIds)
    : { data: [], error: null };
  reads.check(ASSISTANT_READ_SUBJECTS.reportRunLinks, reportRunsResult);

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
    unreadable: [...reads.all],
  };
}

async function loadModelContext(
  supabase: SupabaseLike,
  userId: string,
  modelId: string
): Promise<ModelAssistantContext | null> {
  const reads = new ReadFailureLog();
  const modelResult = await supabase
    .from("models")
    .select(
      "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, assumptions_summary, input_summary, output_summary, summary, config_json, last_validated_at, last_run_recorded_at"
    )
    .eq("id", modelId)
    .maybeSingle();

  const model = requireAnchorRow<any>("this model record", modelResult);

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
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("model_runs")
      // `engine_key` is projected because the relaunch OFFER is keyed on it: the
      // launch route refuses in-process engines with a 409, so offering a
      // relaunch for one would be a control that can never succeed.
      .select("id, status, run_title, engine_key, created_at, completed_at")
      .eq("model_id", model.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  reads.check(ASSISTANT_READ_SUBJECTS.modelLinks, linksResult);
  reads.check(ASSISTANT_READ_SUBJECTS.scenarioEntries, scenarioEntriesResult);

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

  // `schemaPending` is already surfaced on this context and the model run list
  // is emptied for it. Every OTHER failure emptied the same list silently.
  const schemaPending = collectUnlessPending(reads, ASSISTANT_READ_SUBJECTS.modelRuns, modelRunsResult);

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
          engineKey: (run.engine_key as string | null) ?? null,
          createdAt: run.created_at ?? null,
          completedAt: run.completed_at ?? null,
        })),
    schemaPending,
    unreadable: [...reads.all],
  };
}

async function loadReportContext(
  supabase: SupabaseLike,
  userId: string,
  reportId: string
): Promise<ReportAssistantContext | null> {
  const reads = new ReadFailureLog();
  const reportResult = await supabase
    .from("reports")
    .select(
      "id, workspace_id, project_id, rtp_cycle_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at"
    )
    .eq("id", reportId)
    .maybeSingle();

  const report = requireAnchorRow<any>("this report record", reportResult);

  if (!report) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, report.workspace_id);
  if (!workspace) {
    return null;
  }

  const [projectResult, rtpCycleResult, sectionsResult, reportRunLinksResult, artifactsResult] = await Promise.all([
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
      : Promise.resolve({ data: null, error: null }),
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

  reads.check(ASSISTANT_READ_SUBJECTS.linkedProject, projectResult);
  reads.check(ASSISTANT_READ_SUBJECTS.linkedRtpCycle, rtpCycleResult);
  reads.check(ASSISTANT_READ_SUBJECTS.reportSections, sectionsResult);
  reads.check(ASSISTANT_READ_SUBJECTS.reportRunLinks, reportRunLinksResult);
  reads.check(ASSISTANT_READ_SUBJECTS.reportArtifacts, artifactsResult);
  const project = projectResult.data;
  const rtpCycle = rtpCycleResult.data;
  const sections = sectionsResult.data;
  const reportRunLinks = reportRunLinksResult.data;
  const artifacts = artifactsResult.data;

  const runIds = (reportRunLinks ?? []).map((item: any) => item.run_id);
  const runsResult = runIds.length
    ? await supabase
        .from("runs")
        .select("id, title, summary_text, created_at")
        .in("id", runIds)
    : { data: [], error: null };
  reads.check("the analysis runs behind this report", runsResult);

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
        .select("id, title, status, ai_synthesis_json, representativeness_json")
        .eq("workspace_id", report.workspace_id)
        .eq("id", engagementCampaignId)
        .maybeSingle()
    : { data: null, error: null };
  // The section config NAMES this campaign, so a null here is not "no campaign
  // is attached" — it is "the campaign this report cites did not load", and the
  // engagement block that follows would otherwise read as absent public input.
  reads.check(ASSISTANT_READ_SUBJECTS.linkedEngagementCampaign, engagementCampaignResult);

  // E3 — a compact spatial-hotspots summary so the copilot can reference where
  // resident concerns concentrate. Defensive: never let it break context load.
  let engagementHotspotsSummary: {
    clusterCount: number;
    significantCount: number;
    testedCount: number;
    globalNegativeSharePct: number | null;
  } | null = null;
  if (engagementCampaignId && engagementCampaignResult.data) {
    try {
      const synthesis =
        (engagementCampaignResult.data as { ai_synthesis_json?: EngagementSynthesis | null }).ai_synthesis_json ??
        null;
      const { analysis } = await loadSentimentHotspots(supabase, {
        workspaceId: report.workspace_id,
        campaignId: engagementCampaignId,
        negativeItemIds: negativeItemIdsFromSyntheses([synthesis]),
      });
      engagementHotspotsSummary = {
        clusterCount: analysis.clusterCount,
        significantCount: analysis.significantCount,
        testedCount: analysis.testedCount,
        globalNegativeSharePct: analysis.globalNegativeSharePct,
      };
    } catch (error) {
      // "Defensive" was doing two jobs: keeping the context load alive, and
      // quietly turning a failed hotspot analysis into "no concentration of
      // resident concern was found". Only the first one is defensible.
      engagementHotspotsSummary = null;
      reads.check("engagement sentiment hotspots", {
        error: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  // E5b — the cached representativeness screening (read-only; no recompute).
  const engagementRepresentativenessSummary: {
    respondentCount: number;
    tractCount: number;
    underRepresented: string[];
    computedAt: string;
  } | null = (() => {
    const cached = (
      engagementCampaignResult.data as { representativeness_json?: CampaignRepresentativeness | null } | null
    )?.representativeness_json;
    if (!cached) return null;
    return {
      respondentCount: cached.respondentCount,
      tractCount: cached.tractCount,
      underRepresented: cached.underRepresented,
      computedAt: cached.computedAt,
    };
  })();

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
          hotspots: engagementHotspotsSummary,
          representativeness: engagementRepresentativenessSummary,
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
    unreadable: [...reads.all],
  };
}

async function loadRunContext(
  supabase: SupabaseLike,
  userId: string,
  runId: string,
  baselineRunId?: string | null
): Promise<RunAssistantContext | null> {
  const reads = new ReadFailureLog();
  const runResult = await supabase
    .from("runs")
    .select("id, workspace_id, title, summary_text, created_at, query_text, metrics")
    .eq("id", runId)
    .maybeSingle();

  const run = requireAnchorRow<any>("this analysis run record", runResult);

  if (!run) {
    return null;
  }

  const workspace = await requireWorkspaceEnvelope(supabase, userId, run.workspace_id);
  if (!workspace) {
    return null;
  }

  const baselineRunResult = baselineRunId
    ? await supabase
        .from("runs")
        .select("id, title, created_at, metrics")
        .eq("workspace_id", run.workspace_id)
        .eq("id", baselineRunId)
        .maybeSingle()
    : { data: null, error: null };
  // The planner named this baseline by id. A failed read here is not "no
  // baseline is attached", and every delta the copilot would otherwise decline
  // to compute hangs off it.
  reads.check(ASSISTANT_READ_SUBJECTS.baselineRun, baselineRunResult);
  const baselineRun = baselineRunResult.data;

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
    unreadable: [...reads.all],
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
    case "grants":
    case "invoicing":
    case "engagement":
    case "safety":
    case "aerial":
    case "knowledge_base":
    case "data_hub":
      // The switch discriminant is `target.kind as AssistantTargetKind` (the
      // cast predates this change), so the case arms do not narrow `target.kind`
      // itself; the cast here is tautological within these seven arms.
      return loadModuleLaneContext(supabase, userId, target, target.kind as AssistantModuleLaneKind);
    case "analysis_studio":
      return loadWorkspaceContext(supabase, userId, target);
    case "workspace":
    default:
      return loadWorkspaceContext(supabase, userId, target);
  }
}
