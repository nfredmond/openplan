import { buildAerialProjectPosture, type AerialProjectPosture } from "@/lib/aerial/public";
import { loadWorkspaceAerialPostureInputs } from "@/lib/aerial/queries";
import { computeNetInvoiceAmount } from "@/lib/invoicing/invoice-records";
import {
  GRANT_MODELING_PLANNING_CAVEAT,
  buildGrantDecisionModelingSupport,
  buildProjectGrantModelingEvidenceByProjectId,
  compareProjectGrantModelingEvidenceForQueue,
  describeProjectGrantModelingReadiness,
  resolveProjectGrantModelingQueuePosture,
  type ProjectGrantModelingArtifactRow,
  type ProjectGrantModelingReportRow,
} from "@/lib/grants/modeling-evidence";
import {
  GRANTS_COMMAND_MODULE_KEY,
  GRANTS_COMMAND_MODULE_LABEL,
  resolveRtpFundingFollowThrough,
} from "@/lib/operations/grants-links";
import { buildPlanReadiness, type PlanReadinessCheck } from "@/lib/plans/catalog";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";
import {
  buildRtpReleaseReviewSummary,
  parseStoredRtpPublicReviewSummary,
} from "@/lib/rtp/catalog";
import {
  describeComparisonSnapshotAggregate,
  getReportNavigationHref,
  getReportPacketFreshness,
  parseStoredFundingSnapshot,
  parseStoredComparisonSnapshotAggregate,
  resolveReportPacketSourceUpdatedAt,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
// The Safety module owns its own claim boundary; the operations queue reuses the
// single-sentence variant verbatim rather than paraphrasing screening output
// into something stronger on its way to the Command Center.
import { SAFETY_SCREENING_NARRATIVE_CAVEAT } from "@/lib/safety/caveats";
import type { StatusTone } from "@/lib/ui/status";

/**
 * `count` rides alongside `data` because PostgREST reports how many rows the
 * FILTER matched, independent of any `limit` the caller applied. That is the
 * one thing a capped read cannot work out for itself, and this module needs it:
 * a breakdown computed from 200 returned rows is only a workspace total when
 * the workspace holds 200 rows or fewer.
 */
type WorkspaceOperationsQueryResult = {
  data: unknown[] | null;
  count?: number | null;
  error?: { message?: string } | null;
};

/**
 * One PostgREST filter builder, modelled the way it actually behaves: every
 * filter returns the builder again, and the builder itself is awaitable.
 *
 * The shape here used to spell out a single fixed call order — `.eq()` then
 * `.order()` then `.limit()` — which was exactly enough for the ten spine reads
 * and nothing else. The workspace-lane reads below need call orders it could
 * not express: a status filter applied after an embedded-table filter, and a
 * `head`-only count that ends at `.eq()` with no `.limit()` after it. Modelling
 * the real builder once is cheaper than growing a second seam type per shape.
 */
type WorkspaceOperationsFilterChain = PromiseLike<WorkspaceOperationsQueryResult> & {
  // `boolean` because two of this module's filters are on boolean columns
  // (`is_active`); PostgREST takes either and the narrower signature only ever
  // forced a cast at the call site.
  eq: (column: string, value: string | boolean) => WorkspaceOperationsFilterChain;
  in: (column: string, values: string[]) => WorkspaceOperationsFilterChain;
  order: (column: string, options: { ascending: boolean }) => WorkspaceOperationsFilterChain;
  limit: (count: number) => WorkspaceOperationsFilterChain;
};

export type WorkspaceOperationsSupabaseLike = {
  from: (table: string) => {
    select: (
      query: string,
      options?: { count?: "exact"; head?: boolean }
    ) => WorkspaceOperationsFilterChain;
  };
};

export type WorkspaceOperationsProjectRow = {
  id: string;
  name: string;
  status: string | null;
  deliveryPhase: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsPlanRow = {
  id: string;
  title: string;
  status: string | null;
  geographyLabel: string | null;
  horizonYear: number | null;
  projectId: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsProgramRow = {
  id: string;
  title: string;
  status: string | null;
  nominationDueAt: string | null;
  adoptionTargetAt: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsFundingOpportunityRow = {
  id: string;
  title: string;
  opportunityStatus: string | null;
  decisionState?: string | null;
  expectedAwardAmount?: number | string | null;
  closesAt: string | null;
  decisionDueAt: string | null;
  programId: string | null;
  projectId?: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsFundingAwardRow = {
  id: string;
  projectId: string;
  fundingOpportunityId: string | null;
  title: string;
  awardedAmount: number | string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsBillingInvoiceRow = {
  id: string;
  projectId: string;
  fundingAwardId: string | null;
  status: string | null;
  amount: number | string | null;
  retentionPercent: number | string | null;
  retentionAmount: number | string | null;
  dueDate: string | null;
};

export type WorkspaceOperationsProjectSubmittalRow = {
  id: string;
  projectId: string;
  submittalType: string | null;
  status: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsReportRow = {
  id: string;
  projectId?: string | null;
  title: string | null;
  status: string | null;
  latestArtifactKind: string | null;
  generatedAt: string | null;
  updatedAt: string | null;
  metadataJson: Record<string, unknown> | null;
};

export type WorkspaceOperationsProjectSourceRow = {
  id: string;
  name: string;
  status: string | null;
  delivery_phase: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsPlanSourceRow = {
  id: string;
  title: string;
  status: string | null;
  geography_label: string | null;
  horizon_year: number | null;
  project_id: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsProgramSourceRow = {
  id: string;
  title: string;
  status: string | null;
  nomination_due_at: string | null;
  adoption_target_at: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsFundingOpportunitySourceRow = {
  id: string;
  title: string;
  opportunity_status: string | null;
  decision_state?: string | null;
  expected_award_amount?: number | string | null;
  closes_at: string | null;
  decision_due_at: string | null;
  program_id: string | null;
  project_id?: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsFundingAwardSourceRow = {
  id: string;
  project_id: string;
  funding_opportunity_id: string | null;
  title: string;
  awarded_amount: number | string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsBillingInvoiceSourceRow = {
  id: string;
  project_id: string;
  funding_award_id: string | null;
  status: string | null;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  due_date: string | null;
};

export type WorkspaceOperationsProjectSubmittalSourceRow = {
  id: string;
  project_id: string;
  submittal_type: string | null;
  status: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsReportSourceRow = {
  id: string;
  project_id?: string | null;
  title: string | null;
  status: string | null;
  latest_artifact_kind: string | null;
  generated_at: string | null;
  updated_at: string | null;
  metadata_json: Record<string, unknown> | null;
};

export type WorkspaceCommandQueueItem = {
  key: string;
  moduleKey?: "grants";
  moduleLabel?: string;
  title: string;
  detail: string;
  href: string;
  targetProjectId?: string | null;
  targetProjectName?: string | null;
  targetOpportunityId?: string | null;
  targetOpportunityTitle?: string | null;
  targetInvoiceId?: string | null;
  targetFundingAwardId?: string | null;
  tone: StatusTone;
  priority: number;
  badges: Array<{
    label: string;
    value?: string | number | null;
  }>;
};

export type WorkspaceOperationsProjectFundingProfileSourceRow = {
  project_id: string;
  funding_need_amount: number | string | null;
  local_match_need_amount?: number | string | null;
};

export type WorkspaceGrantModelingSummary = {
  breakdown: {
    decisionReady: number;
    refreshRecommended: number;
    thin: number;
    noVisibleSupport: number;
  };
  breakdownSummary: string | null;
  operatorDetail: string | null;
  leadDecisionDetail: string | null;
};

/**
 * A read this summary could not complete.
 *
 * Same rule as `ReadFailureLog` in `src/lib/ui/read-failures.ts` — *a read that
 * failed may not be rendered as an answer* — carried across a data boundary
 * instead of held in a per-render collector, because the reads happen in a
 * loader and the disclosure happens in a component several files away.
 *
 * `label` is the planner's name for the missing thing, lower case and with no
 * trailing period, so it reads inside a sentence.
 */
export type WorkspaceModuleReadFailure = {
  label: string;
  message: string;
};

/**
 * ── How to read every number in `WorkspaceModuleObservations` ───────────────
 *
 * `null` means NOT MEASURED. It is never a zero, never a "no", and never a
 * completed check. Two different things produce it and both are honest:
 *
 *   1. the read failed (permission, dropped column, migration not applied) —
 *      the reason is in `unreadable` below, named for the planner; or
 *   2. the workspace holds more rows of that kind than one screening read
 *      returns (`WORKSPACE_MODULE_ROW_CAP`), so the breakdown this module could
 *      compute would be a count within a window rather than a workspace total.
 *
 * Case 2 is the one worth explaining. Every read in this module is capped,
 * because this is a portfolio snapshot rendered on ten pages, not a module
 * report. A capped read still yields an exact TOTAL — PostgREST counts what the
 * filter matched, not what it returned — so totals below are always real. What
 * a capped read cannot yield is a trustworthy *breakdown*: "3 failed model
 * runs" computed from the 200 most recent rows of 5,000 would sit in a stat
 * grid next to workspace totals and be read as one. Rather than caption its way
 * out of that, this module reports the breakdown as not measured and points at
 * the module surface that loads everything — the same choice, for the same
 * reason, as `planNeedsObservableRecordSetup` below.
 *
 * Consumers must therefore branch on `null` explicitly. `?? 0` anywhere in a
 * consumer of these fields reintroduces the defect this shape exists to
 * prevent.
 */
export type WorkspaceEngagementObservation = {
  campaigns: number | null;
  activeCampaigns: number | null;
  /**
   * Public and staff comments sitting in the moderation queue — `pending` plus
   * `flagged`, the same "actionable" split the engagement module itself uses
   * (`src/lib/engagement/summary.ts`). Counted by the database rather than
   * derived from returned rows, because a workspace can hold tens of thousands
   * of comments and this number is the one a planner acts on.
   */
  moderationActionableItems: number | null;
  /** Approved comments — the pool a report or public-review handoff draws from. */
  approvedItems: number | null;
  /** The most recently updated active campaign, for a queue link that lands somewhere. */
  leadActiveCampaign: { id: string; title: string } | null;
  /**
   * How many questions the lead active campaign actually ASKS — active and
   * published, the same pair the public portal filters on.
   *
   * `null` means not measured: either there is no lead active campaign to count
   * for, or the count failed. It must never be read as zero, because zero is
   * what the copilot's offer to draft a survey keys on, and offering to write
   * questions for a campaign that already has some — because the count could not
   * be read — is the copilot acting on a state it never saw.
   */
  leadActiveCampaignLiveSurveyQuestions: number | null;
};

export type WorkspaceSafetyObservation = {
  crashIngests: number | null;
  readyCrashIngests: number | null;
  failedCrashIngests: number | null;
  /**
   * Ingests the configured source could not cover for the requested area. This
   * is a disclosed limit, not a defect and not an empty result: a planner whose
   * area no registered source covers must be told so by name.
   */
  uncoveredCrashIngests: number | null;
};

export type WorkspaceModelingObservation = {
  modelRuns: number | null;
  /** Queued plus running — work in flight, not work that needs attention. */
  activeModelRuns: number | null;
  failedModelRuns: number | null;
  succeededModelRuns: number | null;
  scenarioSets: number | null;
  activeScenarioSets: number | null;
  countyRuns: number | null;
  validatedScreeningCountyRuns: number | null;
};

export type WorkspaceEvidenceObservation = {
  datasets: number | null;
  /** Datasets whose own status says stale or error — refresh work, not absence. */
  datasetsNeedingAttention: number | null;
  knowledgeDocuments: number | null;
  readyKnowledgeDocuments: number | null;
  failedKnowledgeDocuments: number | null;
};

export type WorkspaceReceivablesObservation = {
  clientInvoices: number | null;
  draftClientInvoices: number | null;
  /** Sent and not yet paid or voided. */
  awaitingPaymentClientInvoices: number | null;
};

export type WorkspaceModuleObservations = {
  engagement: WorkspaceEngagementObservation;
  safety: WorkspaceSafetyObservation;
  modeling: WorkspaceModelingObservation;
  evidence: WorkspaceEvidenceObservation;
  receivables: WorkspaceReceivablesObservation;
  /**
   * Every lane read that failed, by name. A lane with an entry here renders as
   * unreadable; without one, an all-null lane means the caller never loaded it.
   */
  unreadable: WorkspaceModuleReadFailure[];
};

export type WorkspaceOperationsSummary = {
  posture: "stable" | "active" | "attention";
  headline: string;
  detail: string;
  counts: {
    projects: number;
    activeProjects: number;
    plans: number;
    // Counts only the plan-record fields this module actually reads — see
    // `planNeedsObservableRecordSetup`. Scenario, engagement, and report linkage
    // are graded on /plans, which loads them; they are indeterminate here, so a
    // zero here means "no observable record gap", not "every plan is complete".
    plansNeedingSetup: number;
    programs: number;
    activePrograms: number;
    reports: number;
    reportRefreshRecommended: number;
    reportNoPacket: number;
    reportPacketCurrent: number;
    rtpFundingReviewPackets: number;
    rtpReviewLoopOpenPackets?: number;
    comparisonBackedReports: number;
    fundingOpportunities: number;
    openFundingOpportunities: number;
    closingSoonFundingOpportunities: number;
    overdueDecisionFundingOpportunities: number;
    projectFundingNeedAnchorProjects: number;
    projectFundingSourcingProjects: number;
    projectFundingDecisionProjects: number;
    projectFundingAwardRecordProjects: number;
    projectFundingReimbursementStartProjects: number;
    projectFundingReimbursementActiveProjects: number;
    projectFundingGapProjects: number;
    queueDepth: number;
    aerialMissions: number;
    aerialActiveMissions: number;
    aerialReadyPackages: number;
  };
  grantModelingSummary?: WorkspaceGrantModelingSummary | null;
  aerialPosture?: AerialProjectPosture | null;
  /**
   * The modules outside the project/plan/program/report/funding spine that this
   * summary reads. OPTIONAL on purpose, and the distinction matters: `undefined`
   * means the caller never asked for them (a builder called with source rows
   * only), while a present object with `null` fields means they were asked for
   * and could not be measured. A consumer that collapses the two would turn "we
   * did not look" into "there is nothing there".
   */
  moduleObservations?: WorkspaceModuleObservations;
  nextCommand: WorkspaceCommandQueueItem | null;
  commandQueue: WorkspaceCommandQueueItem[];
  fullCommandQueue: WorkspaceCommandQueueItem[];
};

function daysUntil(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed - now.getTime()) / 86400000);
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getFundingDecisionOpportunityStatusPriority(opportunityStatus: string | null | undefined) {
  if (opportunityStatus === "open") return 0;
  if (opportunityStatus === "upcoming") return 1;
  return 2;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatGrantModelingPostureLabel(
  readiness: ReturnType<typeof describeProjectGrantModelingReadiness>
) {
  return readiness?.label ?? "No visible support";
}

function buildGrantModelingOpportunityBreakdownSummary(counts: {
  decisionReady: number;
  refreshRecommended: number;
  thin: number;
  noVisibleSupport: number;
}) {
  const total =
    counts.decisionReady +
    counts.refreshRecommended +
    counts.thin +
    counts.noVisibleSupport;

  if (total === 0) {
    return null;
  }

  return `${total} opportunity-linked project${total === 1 ? "" : "s"}: ${counts.decisionReady} appears decision-ready, ${counts.refreshRecommended} refresh recommended, ${counts.thin} appears thin, ${counts.noVisibleSupport} without visible support.`;
}

export type StoredRtpFundingReview = {
  label: string;
  detail: string;
  needsAttention: boolean;
};

export function parseStoredRtpFundingReview(
  metadata: Record<string, unknown> | null | undefined
): StoredRtpFundingReview | null {
  const sourceContext = asRecord(metadata?.sourceContext);
  const snapshot = asRecord(sourceContext?.rtpFundingSnapshot);
  if (!snapshot) {
    return null;
  }

  const gapProjectCount = asNumber(snapshot.gapProjectCount) ?? 0;
  const likelyCoveredProjectCount = asNumber(snapshot.likelyCoveredProjectCount) ?? 0;
  const outstandingReimbursementAmount = asNumber(snapshot.outstandingReimbursementAmount) ?? 0;
  const uninvoicedAwardAmount = asNumber(snapshot.uninvoicedAwardAmount) ?? 0;
  const linkedProjectCount = asNumber(snapshot.linkedProjectCount) ?? 0;

  if (gapProjectCount > 0) {
    return {
      label: "Funding gap review",
      detail: `${gapProjectCount} linked RTP project${gapProjectCount === 1 ? " still carried" : "s still carried"} an uncovered funding gap when this packet was generated.`,
      needsAttention: true,
    };
  }

  if (uninvoicedAwardAmount > 0) {
    return {
      label: "Award follow-through pending",
      detail: `${formatCurrency(uninvoicedAwardAmount)} of awarded funding was still uninvoiced across the linked RTP project stack at generation time.`,
      needsAttention: true,
    };
  }

  if (outstandingReimbursementAmount > 0) {
    return {
      label: "Reimbursement in flight",
      detail: `${formatCurrency(outstandingReimbursementAmount)} was still outstanding in reimbursement requests when this packet was generated.`,
      needsAttention: true,
    };
  }

  if (likelyCoveredProjectCount > 0) {
    return {
      label: "Pipeline-backed review",
      detail: `${likelyCoveredProjectCount} linked RTP project${likelyCoveredProjectCount === 1 ? " depended" : "s depended"} on pursued funding pipeline rather than fully committed dollars at generation time.`,
      needsAttention: true,
    };
  }

  return {
    label: linkedProjectCount > 0 ? "Funding posture aligned" : "No linked projects",
    detail:
      linkedProjectCount > 0
        ? "Stored RTP funding posture did not show a visible gap or reimbursement follow-through issue at generation time."
        : "No linked RTP projects were present in the stored funding posture.",
    needsAttention: false,
  };
}

const REPORT_WRITEBACK_GRACE_MS = 15 * 60 * 1000;

function hasMaterialReportWritebackAfterGeneration(
  generatedAt: string | null | undefined,
  updatedAt: string | null | undefined
) {
  if (!generatedAt || !updatedAt) {
    return false;
  }

  const generatedMs = new Date(generatedAt).getTime();
  const updatedMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(generatedMs) || !Number.isFinite(updatedMs)) {
    return false;
  }

  return updatedMs - generatedMs > REPORT_WRITEBACK_GRACE_MS;
}

function resolveReportSourceUpdatedAt(report: WorkspaceOperationsReportRow): string | null {
  const sourceContext = asRecord(report.metadataJson?.sourceContext);

  const rtpCycleUpdatedAt = typeof sourceContext?.rtpCycleUpdatedAt === "string" ? sourceContext.rtpCycleUpdatedAt : null;
  const projectUpdatedAt = typeof sourceContext?.projectUpdatedAt === "string" ? sourceContext.projectUpdatedAt : null;
  const projectFundingSnapshot = asRecord(sourceContext?.projectFundingSnapshot);
  const latestFundingSourceUpdatedAt =
    typeof projectFundingSnapshot?.latestSourceUpdatedAt === "string"
      ? projectFundingSnapshot.latestSourceUpdatedAt
      : null;

  const trackedSourceUpdatedAt = resolveReportPacketSourceUpdatedAt([
    rtpCycleUpdatedAt,
    projectUpdatedAt,
    latestFundingSourceUpdatedAt,
  ]);

  if (!trackedSourceUpdatedAt) {
    return report.updatedAt;
  }

  return hasMaterialReportWritebackAfterGeneration(report.generatedAt, report.updatedAt)
    ? resolveReportPacketSourceUpdatedAt([trackedSourceUpdatedAt, report.updatedAt])
    : trackedSourceUpdatedAt;
}

function resolveExactWorkspaceBillingInvoiceId(invoices: WorkspaceOperationsBillingInvoiceRow[]): string | null {
  const actionableInvoices = invoices.filter(
    (invoice) => Boolean(invoice.fundingAwardId) && invoice.status !== "paid" && invoice.status !== "rejected"
  );

  if (actionableInvoices.length !== 1) {
    return null;
  }

  return actionableInvoices[0]?.id ?? null;
}

// The three plan readiness checks that are counts of linked planning artifacts
// rather than fields on the plan row itself. `buildPlanReadiness` judges six
// things about a plan; these three are the ones the workspace-level read in this
// module cannot see. It loads plan rows, never `plan_links`, and it never loads
// scenario sets or engagement campaigns at all.
const PLAN_ARTIFACT_LINKAGE_CHECK_KEYS: ReadonlySet<PlanReadinessCheck["key"]> = new Set([
  "scenario_set",
  "engagement_campaign",
  "report",
]);

/**
 * Whether a plan is missing one of the record-level fields this module can
 * actually observe: a linked project, a geography label, a horizon year.
 *
 * The three artifact counts handed to `buildPlanReadiness` below are
 * placeholders, not measurements — the checks they drive are filtered back out
 * before the verdict is taken. They used to be read as measurements, and that
 * was a live defect: a zero count fails a `count > 0` check, `readiness.ready`
 * requires all six checks to pass, so every plan in every workspace counted as
 * needing setup forever. `plansNeedingSetup` could never fall to zero however
 * completely an operator filled a plan out, the Dashboard and Command Center
 * nagged about finished plans, and the "Tighten plan foundations" queue item
 * pinned the command queue permanently open for any workspace holding a single
 * plan.
 *
 * Not knowing is not the same as knowing there is nothing, so at this scope the
 * artifact checks are indeterminate and are left out of the verdict instead of
 * being reported as missing. Loading them here was the alternative and was
 * rejected: it would mean three more reads on every page that renders the
 * command board, and the reads in this module are all capped (`limit(200)`)
 * because it is a portfolio snapshot — a capped artifact read would manufacture
 * exactly the confidently-wrong zero being fixed here, just further from view.
 * Full six-check readiness is computed on `/plans` and `/plans/[planId]`, which
 * load the linkage rows for the plans actually on screen.
 *
 * Keeping `buildPlanReadiness` as the definition of what each check means, and
 * filtering by check key afterwards, is deliberate: the plans module stays the
 * single source of truth, and a check key that no longer exists is a type error
 * rather than a silently skipped check.
 */
function planNeedsObservableRecordSetup(plan: WorkspaceOperationsPlanRow): boolean {
  const readiness = buildPlanReadiness({
    hasProject: Boolean(plan.projectId),
    scenarioCount: 0,
    engagementCampaignCount: 0,
    reportCount: 0,
    geographyLabel: plan.geographyLabel,
    horizonYear: plan.horizonYear,
  });

  return readiness.checks.some(
    (check) => !check.ready && !PLAN_ARTIFACT_LINKAGE_CHECK_KEYS.has(check.key)
  );
}

function mapWorkspaceOperationsProjectRows(
  rows: WorkspaceOperationsProjectSourceRow[]
): WorkspaceOperationsProjectRow[] {
  return rows.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status,
    deliveryPhase: project.delivery_phase,
    updatedAt: project.updated_at,
  }));
}

function mapWorkspaceOperationsPlanRows(rows: WorkspaceOperationsPlanSourceRow[]): WorkspaceOperationsPlanRow[] {
  return rows.map((plan) => ({
    id: plan.id,
    title: plan.title,
    status: plan.status,
    geographyLabel: plan.geography_label,
    horizonYear: plan.horizon_year,
    projectId: plan.project_id,
    updatedAt: plan.updated_at,
  }));
}

function mapWorkspaceOperationsProgramRows(
  rows: WorkspaceOperationsProgramSourceRow[]
): WorkspaceOperationsProgramRow[] {
  return rows.map((program) => ({
    id: program.id,
    title: program.title,
    status: program.status,
    nominationDueAt: program.nomination_due_at,
    adoptionTargetAt: program.adoption_target_at,
    updatedAt: program.updated_at,
  }));
}

function mapWorkspaceOperationsReportRows(rows: WorkspaceOperationsReportSourceRow[]): WorkspaceOperationsReportRow[] {
  return rows.map((report) => ({
    id: report.id,
    projectId: report.project_id,
    title: report.title,
    status: report.status,
    latestArtifactKind: report.latest_artifact_kind,
    generatedAt: report.generated_at,
    updatedAt: report.updated_at,
    metadataJson: report.metadata_json,
  }));
}

function mapWorkspaceOperationsFundingOpportunityRows(
  rows: WorkspaceOperationsFundingOpportunitySourceRow[]
): WorkspaceOperationsFundingOpportunityRow[] {
  return rows.map((opportunity) => ({
    id: opportunity.id,
    title: opportunity.title,
    opportunityStatus: opportunity.opportunity_status,
    decisionState: opportunity.decision_state,
    expectedAwardAmount: opportunity.expected_award_amount,
    closesAt: opportunity.closes_at,
    decisionDueAt: opportunity.decision_due_at,
    programId: opportunity.program_id,
    projectId: opportunity.project_id,
    updatedAt: opportunity.updated_at,
  }));
}

function mapWorkspaceOperationsFundingAwardRows(
  rows: WorkspaceOperationsFundingAwardSourceRow[]
): WorkspaceOperationsFundingAwardRow[] {
  return rows.map((award) => ({
    id: award.id,
    projectId: award.project_id,
    fundingOpportunityId: award.funding_opportunity_id,
    title: award.title,
    awardedAmount: award.awarded_amount,
    updatedAt: award.updated_at,
  }));
}

function mapWorkspaceOperationsBillingInvoiceRows(
  rows: WorkspaceOperationsBillingInvoiceSourceRow[]
): WorkspaceOperationsBillingInvoiceRow[] {
  return rows.map((invoice) => ({
    id: invoice.id,
    projectId: invoice.project_id,
    fundingAwardId: invoice.funding_award_id,
    status: invoice.status,
    amount: invoice.amount,
    retentionPercent: invoice.retention_percent,
    retentionAmount: invoice.retention_amount,
    dueDate: invoice.due_date,
  }));
}

function mapWorkspaceOperationsProjectSubmittalRows(
  rows: WorkspaceOperationsProjectSubmittalSourceRow[]
): WorkspaceOperationsProjectSubmittalRow[] {
  return rows.map((submittal) => ({
    id: submittal.id,
    projectId: submittal.project_id,
    submittalType: submittal.submittal_type,
    status: submittal.status,
    updatedAt: submittal.updated_at,
  }));
}

/**
 * Cap on rows any ONE workspace-lane read pulls back.
 *
 * Same 200 the spine reads above use, and for the same reason: this summary is
 * a portfolio snapshot rendered on ten pages, so no single render may pull a
 * workspace's whole history of anything. What the cap costs is stated at the
 * observation contract — totals stay exact because the database counts the
 * match, and breakdowns go indeterminate rather than pretending the window was
 * the workspace.
 */
const WORKSPACE_MODULE_ROW_CAP = 200;

type WorkspaceModuleRowRead<Row> = {
  rows: Row[];
  /** Rows the filter matched, independent of the cap. `null` when unknown. */
  total: number | null;
  /**
   * True when `rows` is not the whole matching set — because the cap clipped
   * it, or because the read failed and saw nothing at all. Both mean the same
   * thing to every breakdown taken off `rows`: it is not a workspace figure.
   * A failed read sets this even though its `rows` is empty, so that an empty
   * array from a failure cannot be counted as a legitimate zero.
   */
  clipped: boolean;
};

function recordWorkspaceModuleReadFailure(
  label: string,
  result: WorkspaceOperationsQueryResult | undefined,
  unreadable: WorkspaceModuleReadFailure[]
) {
  const message = result?.error?.message;
  unreadable.push({
    label,
    message: typeof message === "string" && message.trim() ? message.trim() : "no message reported",
  });
}

/**
 * The failure log as one sentence, for the summary's own `detail`.
 *
 * `WorkspaceCommandBoard` builds the same sentence from the same labels, which
 * is why they are written as a planner's name for the missing thing. The board
 * can only say this on a page that renders the board; `summary.detail` travels
 * to the Dashboard, `/api/analysis/context` and the assistant's runtime cue,
 * none of which read `unreadable` themselves.
 */
function describeUnreadableWorkspaceReads(failures: WorkspaceModuleReadFailure[]): string {
  const labels = [...new Set(failures.map((failure) => failure.label))];
  const named =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

  return `This snapshot could not read ${named}, so those records were not counted at all.`;
}

function readWorkspaceModuleRows<Row>(
  label: string,
  result: WorkspaceOperationsQueryResult | undefined,
  unreadable: WorkspaceModuleReadFailure[]
): WorkspaceModuleRowRead<Row> {
  if (!result || result.error) {
    recordWorkspaceModuleReadFailure(label, result, unreadable);
    return { rows: [], total: null, clipped: true };
  }

  const rows = (result.data ?? []) as Row[];
  const reportedTotal =
    typeof result.count === "number" && Number.isFinite(result.count) ? result.count : null;
  // A capped read that came back short is its own proof of completeness: the
  // filter matched fewer rows than the cap, so nothing was left behind. Only a
  // read that filled the cap without a reported count is genuinely unbounded.
  const total = reportedTotal ?? (rows.length < WORKSPACE_MODULE_ROW_CAP ? rows.length : null);

  return { rows, total, clipped: total === null || total > rows.length };
}

function readWorkspaceModuleCount(
  label: string,
  result: WorkspaceOperationsQueryResult | undefined,
  unreadable: WorkspaceModuleReadFailure[]
): number | null {
  if (!result || result.error) {
    recordWorkspaceModuleReadFailure(label, result, unreadable);
    return null;
  }

  return typeof result.count === "number" && Number.isFinite(result.count) ? result.count : null;
}

/**
 * A breakdown count over one lane read, or `null` when the read cannot carry
 * one — see the observation contract on `WorkspaceEngagementObservation` above.
 * Every breakdown in this module goes through here so the clipped case cannot
 * be forgotten at one call site and remembered at the next.
 */
function countWithinWorkspaceModuleRead<Row>(
  read: WorkspaceModuleRowRead<Row>,
  predicate: (row: Row) => boolean
): number | null {
  if (read.clipped) {
    return null;
  }

  return read.rows.filter(predicate).length;
}

type WorkspaceEngagementCampaignSourceRow = {
  id: string;
  title: string | null;
  status: string | null;
  updated_at: string | null;
};
type WorkspaceStatusOnlySourceRow = { id: string; status: string | null };
type WorkspaceCountyRunSourceRow = { id: string; stage: string | null };

export function buildWorkspaceOperationsSummaryFromSourceRows({
  projects,
  plans,
  programs,
  reports,
  fundingOpportunities,
  fundingAwards = [],
  fundingInvoices = [],
  projectSubmittals = [],
  projectFundingProfiles = [],
  aerialPosture,
  moduleObservations,
  now,
}: {
  projects: WorkspaceOperationsProjectSourceRow[];
  plans: WorkspaceOperationsPlanSourceRow[];
  programs: WorkspaceOperationsProgramSourceRow[];
  reports: WorkspaceOperationsReportSourceRow[];
  fundingOpportunities: WorkspaceOperationsFundingOpportunitySourceRow[];
  fundingAwards?: WorkspaceOperationsFundingAwardSourceRow[];
  fundingInvoices?: WorkspaceOperationsBillingInvoiceSourceRow[];
  projectSubmittals?: WorkspaceOperationsProjectSubmittalSourceRow[];
  projectFundingProfiles?: WorkspaceOperationsProjectFundingProfileSourceRow[];
  aerialPosture?: AerialProjectPosture | null;
  moduleObservations?: WorkspaceModuleObservations;
  now?: Date;
}) {
  return buildWorkspaceOperationsSummary({
    projects: mapWorkspaceOperationsProjectRows(projects),
    plans: mapWorkspaceOperationsPlanRows(plans),
    programs: mapWorkspaceOperationsProgramRows(programs),
    reports: mapWorkspaceOperationsReportRows(reports),
    fundingOpportunities: mapWorkspaceOperationsFundingOpportunityRows(fundingOpportunities),
    fundingAwards: mapWorkspaceOperationsFundingAwardRows(fundingAwards),
    fundingInvoices: mapWorkspaceOperationsBillingInvoiceRows(fundingInvoices),
    projectSubmittals: mapWorkspaceOperationsProjectSubmittalRows(projectSubmittals),
    projectFundingProfiles,
    aerialPosture,
    moduleObservations,
    now,
  });
}

export async function loadWorkspaceOperationsSummaryForWorkspace(
  supabase: WorkspaceOperationsSupabaseLike,
  workspaceId: string
): Promise<WorkspaceOperationsSummary> {
  const [
    projectsResult,
    plansResult,
    programsResult,
    reportsResult,
    fundingOpportunitiesResult,
    fundingAwardsResult,
    fundingInvoicesResult,
    projectSubmittalsResult,
    projectFundingProfilesResult,
    // ── Workspace-lane reads ────────────────────────────────────────────────
    // Batched with the spine rather than issued after it: these exist so the
    // Command Center stops describing itself as cross-domain while seeing only
    // the delivery/funding spine, and a lane that costs a serial round trip on
    // ten pages would be quietly dropped the first time someone profiled the
    // render. Each carries `count: "exact"` so its TOTAL survives the row cap.
    engagementCampaignsResult,
    engagementModerationQueueResult,
    engagementApprovedItemsResult,
    safetyCrashIngestsResult,
    modelRunsResult,
    scenarioSetsResult,
    countyRunsResult,
    dataDatasetsResult,
    knowledgeDocumentsResult,
    clientInvoicesResult,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, delivery_phase, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("plans")
      .select("id, title, status, geography_label, horizon_year, project_id, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("programs")
      .select("id, title, status, nomination_due_at, adoption_target_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("reports")
      .select("id, project_id, title, status, latest_artifact_kind, generated_at, updated_at, metadata_json")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("funding_opportunities")
      .select("id, title, opportunity_status, decision_state, expected_award_amount, closes_at, decision_due_at, program_id, project_id, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("funding_awards")
      .select("id, project_id, funding_opportunity_id, title, awarded_amount, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("billing_invoice_records")
      .select("id, project_id, funding_award_id, status, amount, retention_percent, retention_amount, due_date")
      .eq("workspace_id", workspaceId)
      .order("due_date", { ascending: true })
      .limit(200),
    supabase
      .from("project_submittals")
      .select("id, project_id, submittal_type, status, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("project_funding_profiles")
      .select("project_id, funding_need_amount, local_match_need_amount")
      .eq("workspace_id", workspaceId)
      .limit(200),
    supabase
      .from("engagement_campaigns")
      .select("id, title, status, updated_at", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(WORKSPACE_MODULE_ROW_CAP),
    // Comment volume is the one thing here that can reach five figures, so the
    // two numbers a planner acts on are counted by the database instead of
    // derived from a capped page of rows. `engagement_items` carries no
    // workspace column — it hangs off a campaign — hence the embedded filter,
    // the same shape /api/map-features/counts uses against this table.
    supabase
      .from("engagement_items")
      .select("id, engagement_campaigns!inner(id)", { count: "exact", head: true })
      .eq("engagement_campaigns.workspace_id", workspaceId)
      .in("status", ["pending", "flagged"]),
    supabase
      .from("engagement_items")
      .select("id, engagement_campaigns!inner(id)", { count: "exact", head: true })
      .eq("engagement_campaigns.workspace_id", workspaceId)
      .eq("status", "approved"),
    supabase
      .from("safety_crash_ingests")
      .select("id, status", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(WORKSPACE_MODULE_ROW_CAP),
    supabase
      .from("model_runs")
      .select("id, status", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(WORKSPACE_MODULE_ROW_CAP),
    supabase
      .from("scenario_sets")
      .select("id, status", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(WORKSPACE_MODULE_ROW_CAP),
    supabase
      .from("county_runs")
      .select("id, stage", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(WORKSPACE_MODULE_ROW_CAP),
    supabase
      .from("data_datasets")
      .select("id, status", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(WORKSPACE_MODULE_ROW_CAP),
    supabase
      .from("kb_documents")
      .select("id, status", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(WORKSPACE_MODULE_ROW_CAP),
    supabase
      .from("client_invoices")
      .select("id, status", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(WORKSPACE_MODULE_ROW_CAP),
  ]);

  // Every read this loader makes is folded into ONE failure log, declared here
  // rather than beside the lane reads below because the spine needs it first.
  // Past this point the builder sees rows and numbers, and any gap it is handed
  // is already known to mean "not measured" rather than "none".
  const unreadable: WorkspaceModuleReadFailure[] = [];

  // ── The spine reads ─────────────────────────────────────────────────────────
  // These nine were spelled `(result.data ?? []) as Row[]`, which answers a read
  // that FAILED exactly the way it answers a workspace that is empty: no
  // projects, no plans, no funding opportunities, no packets — and a command
  // queue that then reports itself clear on ten pages, in `/api/analysis/context`
  // and in five assistant contexts. They now go through the same
  // `readWorkspaceModuleRows` seam the workspace lanes already use, so a failure
  // is named for the planner instead of being rendered as an answer.
  //
  // `total` and `clipped` come back for free and are honest for these reads too
  // (no `count: "exact"`, so a short read reports its own length and a full one
  // reports `null`), but nothing consumes them yet: `WorkspaceOperationsSummary.
  // counts` is a non-nullable `number`, read by a dozen surfaces this module does
  // not own. Making those counts nullable is the remaining half of this fix and
  // is a change to every consumer, not to this file.
  const projects = readWorkspaceModuleRows<WorkspaceOperationsProjectSourceRow>(
    "projects",
    projectsResult,
    unreadable
  );
  const plans = readWorkspaceModuleRows<WorkspaceOperationsPlanSourceRow>("plans", plansResult, unreadable);
  const programs = readWorkspaceModuleRows<WorkspaceOperationsProgramSourceRow>(
    "programs",
    programsResult,
    unreadable
  );
  const reports = readWorkspaceModuleRows<WorkspaceOperationsReportSourceRow>(
    "report records",
    reportsResult,
    unreadable
  );
  const fundingOpportunities = readWorkspaceModuleRows<WorkspaceOperationsFundingOpportunitySourceRow>(
    "funding opportunities",
    fundingOpportunitiesResult,
    unreadable
  );
  const fundingAwards = readWorkspaceModuleRows<WorkspaceOperationsFundingAwardSourceRow>(
    "funding awards",
    fundingAwardsResult,
    unreadable
  );
  const fundingInvoices = readWorkspaceModuleRows<WorkspaceOperationsBillingInvoiceSourceRow>(
    "grant reimbursement invoices",
    fundingInvoicesResult,
    unreadable
  );
  const projectSubmittals = readWorkspaceModuleRows<WorkspaceOperationsProjectSubmittalSourceRow>(
    "project submittals",
    projectSubmittalsResult,
    unreadable
  );
  const projectFundingProfiles = readWorkspaceModuleRows<WorkspaceOperationsProjectFundingProfileSourceRow>(
    "project funding profiles",
    projectFundingProfilesResult,
    unreadable
  );

  const reportSourceRows = reports.rows;
  const reportIds = reportSourceRows.map((report) => report.id).filter((id): id is string => Boolean(id));
  const latestArtifactByReportId = new Map<string, { generated_at: string | null; metadata_json: Record<string, unknown> | null }>();

  if (reportIds.length > 0) {
    // This read supplies the packet timing and stored packet metadata that every
    // report-governance count is taken from. A failure is NOT a fabricated "no
    // packet" verdict — the merge below falls back to the report row's own
    // `generated_at` and `metadata_json`, and `/api/reports/[reportId]/generate`
    // does write both, so the fallback is real. What it is instead is a snapshot
    // one generation behind whenever a newer artifact exists, silently: freshness,
    // the RTP funding review, the release-review loop and the comparison-backed
    // count are all read off metadata this loader failed to refresh. The numbers
    // stay computable; what a planner is owed is that they may be stale.
    const reportArtifactsResult = await supabase
      .from("report_artifacts")
      .select("report_id, generated_at, metadata_json")
      .in("report_id", reportIds)
      .order("generated_at", { ascending: false })
      .limit(Math.max(reportIds.length * 4, reportIds.length));

    const reportArtifacts = readWorkspaceModuleRows<{
      report_id: string;
      generated_at: string | null;
      metadata_json: Record<string, unknown> | null;
    }>("report packet artifacts", reportArtifactsResult, unreadable);

    for (const artifact of reportArtifacts.rows) {
      if (!latestArtifactByReportId.has(artifact.report_id)) {
        latestArtifactByReportId.set(artifact.report_id, {
          generated_at: artifact.generated_at,
          metadata_json: artifact.metadata_json ?? null,
        });
      }
    }
  }

  const mergedReportSourceRows = reportSourceRows.map((report) => {
    const latestArtifact = latestArtifactByReportId.get(report.id);

    return {
      ...report,
      generated_at: latestArtifact?.generated_at ?? report.generated_at,
      metadata_json: latestArtifact?.metadata_json ?? report.metadata_json,
    };
  });

  const { missions: aerialMissions, packages: aerialPackages } =
    await loadWorkspaceAerialPostureInputs(supabase, workspaceId);

  const aerialProjectPosture = buildAerialProjectPosture(aerialMissions, aerialPackages);

  // Every lane read joins the same failure log, HERE in the loader, because this
  // is the only place the `error` half of each result exists. Past this point
  // the builder sees numbers or nulls, and a null it is handed is already known
  // to mean "not measured" rather than "none".
  const engagementCampaigns = readWorkspaceModuleRows<WorkspaceEngagementCampaignSourceRow>(
    "engagement campaigns",
    engagementCampaignsResult,
    unreadable
  );
  const leadActiveCampaignRow =
    engagementCampaigns.rows.find((campaign) => campaign.status === "active") ?? null;

  /**
   * ONE FOLLOW-UP READ, because the question can only be asked once the lead
   * campaign is known.
   *
   * It could have been folded into the parallel block as a workspace-wide count
   * of live questions, which costs nothing extra — and would answer a different
   * question. "This workspace has a survey somewhere" is not "the campaign
   * collecting input right now asks anything", and the offer that reads this is
   * about one campaign. A round trip is the right price for not conflating them.
   *
   * `head: true` — the count is the whole answer; no prompt text is fetched.
   */
  const leadCampaignSurveyResult = leadActiveCampaignRow
    ? await supabase
        .from("engagement_survey_questions")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", leadActiveCampaignRow.id)
        .eq("is_active", true)
        .eq("status", "published")
    : null;
  const safetyCrashIngests = readWorkspaceModuleRows<WorkspaceStatusOnlySourceRow>(
    "safety crash data pulls",
    safetyCrashIngestsResult,
    unreadable
  );
  const modelRuns = readWorkspaceModuleRows<WorkspaceStatusOnlySourceRow>(
    "model runs",
    modelRunsResult,
    unreadable
  );
  const scenarioSets = readWorkspaceModuleRows<WorkspaceStatusOnlySourceRow>(
    "scenario sets",
    scenarioSetsResult,
    unreadable
  );
  const countyRuns = readWorkspaceModuleRows<WorkspaceCountyRunSourceRow>(
    "county validation runs",
    countyRunsResult,
    unreadable
  );
  const dataDatasets = readWorkspaceModuleRows<WorkspaceStatusOnlySourceRow>(
    "data hub datasets",
    dataDatasetsResult,
    unreadable
  );
  const knowledgeDocuments = readWorkspaceModuleRows<WorkspaceStatusOnlySourceRow>(
    "knowledge base documents",
    knowledgeDocumentsResult,
    unreadable
  );
  const clientInvoices = readWorkspaceModuleRows<WorkspaceStatusOnlySourceRow>(
    "client invoices",
    clientInvoicesResult,
    unreadable
  );

  const moduleObservations: WorkspaceModuleObservations = {
    engagement: {
      campaigns: engagementCampaigns.total,
      activeCampaigns: countWithinWorkspaceModuleRead(
        engagementCampaigns,
        (campaign) => campaign.status === "active"
      ),
      moderationActionableItems: readWorkspaceModuleCount(
        "engagement comments awaiting moderation",
        engagementModerationQueueResult,
        unreadable
      ),
      approvedItems: readWorkspaceModuleCount(
        "approved engagement comments",
        engagementApprovedItemsResult,
        unreadable
      ),
      leadActiveCampaign: leadActiveCampaignRow
        ? {
            id: leadActiveCampaignRow.id,
            title: leadActiveCampaignRow.title ?? "Untitled campaign",
          }
        : null,
      leadActiveCampaignLiveSurveyQuestions: leadCampaignSurveyResult
        ? readWorkspaceModuleCount(
            "the lead campaign's survey questions",
            leadCampaignSurveyResult,
            unreadable
          )
        : null,
    },
    safety: {
      crashIngests: safetyCrashIngests.total,
      readyCrashIngests: countWithinWorkspaceModuleRead(
        safetyCrashIngests,
        (ingest) => ingest.status === "ready"
      ),
      failedCrashIngests: countWithinWorkspaceModuleRead(
        safetyCrashIngests,
        (ingest) => ingest.status === "failed"
      ),
      uncoveredCrashIngests: countWithinWorkspaceModuleRead(
        safetyCrashIngests,
        (ingest) => ingest.status === "no_coverage"
      ),
    },
    modeling: {
      modelRuns: modelRuns.total,
      activeModelRuns: countWithinWorkspaceModuleRead(modelRuns, (run) =>
        ["queued", "running"].includes(run.status ?? "")
      ),
      failedModelRuns: countWithinWorkspaceModuleRead(modelRuns, (run) => run.status === "failed"),
      succeededModelRuns: countWithinWorkspaceModuleRead(
        modelRuns,
        (run) => run.status === "succeeded"
      ),
      scenarioSets: scenarioSets.total,
      activeScenarioSets: countWithinWorkspaceModuleRead(
        scenarioSets,
        (scenarioSet) => scenarioSet.status === "active"
      ),
      countyRuns: countyRuns.total,
      validatedScreeningCountyRuns: countWithinWorkspaceModuleRead(
        countyRuns,
        (run) => run.stage === "validated-screening"
      ),
    },
    evidence: {
      datasets: dataDatasets.total,
      datasetsNeedingAttention: countWithinWorkspaceModuleRead(dataDatasets, (dataset) =>
        ["stale", "error"].includes(dataset.status ?? "")
      ),
      knowledgeDocuments: knowledgeDocuments.total,
      readyKnowledgeDocuments: countWithinWorkspaceModuleRead(
        knowledgeDocuments,
        (document) => document.status === "ready"
      ),
      failedKnowledgeDocuments: countWithinWorkspaceModuleRead(
        knowledgeDocuments,
        (document) => document.status === "failed"
      ),
    },
    receivables: {
      clientInvoices: clientInvoices.total,
      draftClientInvoices: countWithinWorkspaceModuleRead(
        clientInvoices,
        (invoice) => invoice.status === "draft"
      ),
      awaitingPaymentClientInvoices: countWithinWorkspaceModuleRead(
        clientInvoices,
        (invoice) => invoice.status === "sent"
      ),
    },
    unreadable,
  };

  return buildWorkspaceOperationsSummaryFromSourceRows({
    projects: projects.rows,
    plans: plans.rows,
    programs: programs.rows,
    reports: mergedReportSourceRows,
    fundingOpportunities: fundingOpportunities.rows,
    fundingAwards: fundingAwards.rows,
    fundingInvoices: fundingInvoices.rows,
    projectSubmittals: projectSubmittals.rows,
    projectFundingProfiles: projectFundingProfiles.rows,
    aerialPosture: aerialProjectPosture,
    moduleObservations,
  });
}

export function buildWorkspaceOperationsSummary({
  projects,
  plans,
  programs,
  reports,
  fundingOpportunities,
  fundingAwards = [],
  fundingInvoices = [],
  projectSubmittals = [],
  projectFundingProfiles = [],
  aerialPosture = null,
  moduleObservations,
  now = new Date(),
}: {
  projects: WorkspaceOperationsProjectRow[];
  plans: WorkspaceOperationsPlanRow[];
  programs: WorkspaceOperationsProgramRow[];
  reports: WorkspaceOperationsReportRow[];
  fundingOpportunities: WorkspaceOperationsFundingOpportunityRow[];
  fundingAwards?: WorkspaceOperationsFundingAwardRow[];
  fundingInvoices?: WorkspaceOperationsBillingInvoiceRow[];
  projectSubmittals?: WorkspaceOperationsProjectSubmittalRow[];
  projectFundingProfiles?: WorkspaceOperationsProjectFundingProfileSourceRow[];
  aerialPosture?: AerialProjectPosture | null;
  moduleObservations?: WorkspaceModuleObservations;
  now?: Date;
}): WorkspaceOperationsSummary {
  const reportRows = reports.map((report) => {
    const freshness = getReportPacketFreshness({
      latestArtifactKind: report.latestArtifactKind,
      generatedAt: report.generatedAt,
      updatedAt: resolveReportSourceUpdatedAt(report),
    });
    const comparisonAggregate = parseStoredComparisonSnapshotAggregate(report.metadataJson);
    const comparisonDigest = describeComparisonSnapshotAggregate(comparisonAggregate);
    const storedRtpFundingReview = parseStoredRtpFundingReview(report.metadataJson);
    const storedRtpPublicReviewSummary = parseStoredRtpPublicReviewSummary(report.metadataJson);
    const storedRtpReleaseReviewSummary = storedRtpPublicReviewSummary
      ? buildRtpReleaseReviewSummary({
          packetFreshnessLabel: freshness.label,
          publicReviewSummary: storedRtpPublicReviewSummary,
        })
      : null;
    const storedFundingSnapshot = parseStoredFundingSnapshot(report.metadataJson);
    const fallbackRtpFundingSnapshot = asRecord(asRecord(report.metadataJson?.sourceContext)?.rtpFundingSnapshot);
    const grantsFollowThrough = resolveRtpFundingFollowThrough(
      storedFundingSnapshot
        ? storedFundingSnapshot
        : fallbackRtpFundingSnapshot
          ? {
              unfundedAfterLikelyAmount: (asNumber(fallbackRtpFundingSnapshot.gapProjectCount) ?? 0) > 0 ? 1 : 0,
              outstandingReimbursementAmount: asNumber(
                fallbackRtpFundingSnapshot.outstandingReimbursementAmount
              ) ?? 0,
              uninvoicedAwardAmount: asNumber(fallbackRtpFundingSnapshot.uninvoicedAwardAmount) ?? 0,
              likelyCoveredProjectCount: asNumber(fallbackRtpFundingSnapshot.likelyCoveredProjectCount) ?? 0,
            }
          : null
    );

    return {
      ...report,
      freshness,
      comparisonAggregate,
      comparisonDigest,
      storedRtpFundingReview,
      storedRtpPublicReviewSummary,
      storedRtpReleaseReviewSummary,
      storedFundingSnapshot,
      grantsFollowThrough,
    };
  });

  const activeProjects = projects.filter((project) => !["complete", "archived", "cancelled"].includes(project.status ?? "")).length;
  const plansNeedingSetup = plans.filter(planNeedsObservableRecordSetup).length;
  const activePrograms = programs.filter((program) => !["adopted", "archived"].includes(program.status ?? "")).length;
  const reportRefreshRecommended = reportRows.filter((report) => report.freshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED).length;
  const reportNoPacket = reportRows.filter((report) => report.freshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET).length;
  const reportPacketCurrent = reportRows.filter((report) => report.freshness.label === PACKET_FRESHNESS_LABELS.CURRENT).length;
  const rtpFundingReviewPackets = reportRows.filter(
    (report) => report.freshness.label === PACKET_FRESHNESS_LABELS.CURRENT && report.storedRtpFundingReview?.needsAttention
  ).length;
  const rtpReviewLoopOpenPackets = reportRows.filter(
    (report) =>
      report.freshness.label === PACKET_FRESHNESS_LABELS.CURRENT
      && !report.storedRtpFundingReview?.needsAttention
      && Boolean(report.storedRtpReleaseReviewSummary)
      // The discriminant, not the label. Rewording "Release review ready" used
      // to move every workspace's next command without failing anything.
      && report.storedRtpReleaseReviewSummary?.state !== "ready"
  ).length;
  const comparisonBackedReports = reportRows.filter(
    (report) => (report.comparisonAggregate?.comparisonSnapshotCount ?? 0) > 0
  ).length;
  const openFundingOpportunities = fundingOpportunities.filter((item) => ["open", "upcoming"].includes(item.opportunityStatus ?? "")).length;
  const closingSoonFundingOpportunities = fundingOpportunities.filter((item) => {
    if ((item.opportunityStatus ?? "") !== "open") return false;
    const days = daysUntil(item.closesAt ?? item.decisionDueAt, now);
    return days !== null && days <= 14;
  }).length;
  const overdueDecisionOpportunities = fundingOpportunities.filter((item) => {
    if (!["open", "upcoming"].includes(item.opportunityStatus ?? "")) return false;
    if ((item.decisionState ?? "") !== "monitor") return false;
    const days = daysUntil(item.decisionDueAt, now);
    return days !== null && days < 0;
  });

  const fundingOpportunitiesByProjectId = new Map<string, WorkspaceOperationsFundingOpportunityRow[]>();
  fundingOpportunities.forEach((opportunity) => {
    if (!opportunity.projectId) return;
    const current = fundingOpportunitiesByProjectId.get(opportunity.projectId) ?? [];
    current.push(opportunity);
    fundingOpportunitiesByProjectId.set(opportunity.projectId, current);
  });
  const projectGrantModelingReportRows = reportRows.reduce<ProjectGrantModelingReportRow[]>(
    (rows, report) => {
      if (!report.projectId || !report.title || !report.updatedAt) {
        return rows;
      }

      rows.push({
        id: report.id,
        project_id: report.projectId,
        title: report.title,
        updated_at: report.updatedAt,
        generated_at: report.generatedAt,
        latest_artifact_kind: report.latestArtifactKind,
      });

      return rows;
    },
    []
  );
  const projectGrantModelingArtifactRows = reportRows.reduce<ProjectGrantModelingArtifactRow[]>(
    (rows, report) => {
      if (!report.projectId || !report.metadataJson) {
        return rows;
      }

      rows.push({
        report_id: report.id,
        generated_at: report.generatedAt ?? report.updatedAt ?? new Date(0).toISOString(),
        metadata_json: report.metadataJson,
      });

      return rows;
    },
    []
  );
  const projectGrantModelingEvidenceByProjectId = buildProjectGrantModelingEvidenceByProjectId(
    projectGrantModelingReportRows,
    projectGrantModelingArtifactRows
  );
  const opportunityLinkedProjectIds = [...fundingOpportunitiesByProjectId.keys()];
  const grantModelingOpportunityBreakdown = opportunityLinkedProjectIds.reduce(
    (counts, projectId) => {
      const posture = resolveProjectGrantModelingQueuePosture(
        projectGrantModelingEvidenceByProjectId.get(projectId) ?? null
      );

      switch (posture) {
        case "decision-ready":
          counts.decisionReady += 1;
          break;
        case "refresh-recommended":
          counts.refreshRecommended += 1;
          break;
        case "thin":
          counts.thin += 1;
          break;
        default:
          counts.noVisibleSupport += 1;
          break;
      }

      return counts;
    },
    {
      decisionReady: 0,
      refreshRecommended: 0,
      thin: 0,
      noVisibleSupport: 0,
    }
  );
  const grantModelingOpportunityBreakdownSummary = buildGrantModelingOpportunityBreakdownSummary(
    grantModelingOpportunityBreakdown
  );
  const fundingProfileProjectIds = new Set(projectFundingProfiles.map((profile) => profile.project_id));
  const fundingAwardOpportunityIds = new Set(
    fundingAwards.map((award) => award.fundingOpportunityId).filter((value): value is string => Boolean(value))
  );
  const fundingAwardsByProjectId = new Map<string, WorkspaceOperationsFundingAwardRow[]>();
  fundingAwards.forEach((award) => {
    const current = fundingAwardsByProjectId.get(award.projectId) ?? [];
    current.push(award);
    fundingAwardsByProjectId.set(award.projectId, current);
  });
  const fundingInvoicesByProjectId = new Map<string, WorkspaceOperationsBillingInvoiceRow[]>();
  fundingInvoices.forEach((invoice) => {
    const current = fundingInvoicesByProjectId.get(invoice.projectId) ?? [];
    current.push(invoice);
    fundingInvoicesByProjectId.set(invoice.projectId, current);
  });
  const reimbursementSubmittalsByProjectId = new Map<string, WorkspaceOperationsProjectSubmittalRow[]>();
  projectSubmittals
    .filter((submittal) => submittal.submittalType === "reimbursement")
    .forEach((submittal) => {
      const current = reimbursementSubmittalsByProjectId.get(submittal.projectId) ?? [];
      current.push(submittal);
      reimbursementSubmittalsByProjectId.set(submittal.projectId, current);
    });
  const projectFundingNeedAnchorProjects = [...fundingOpportunitiesByProjectId.entries()]
    .map(([projectId, opportunities]) => {
      if (fundingProfileProjectIds.has(projectId)) return null;
      const project = projects.find((item) => item.id === projectId);
      if (!project) return null;
      const closingSoonCount = opportunities.filter((opportunity) => {
        if ((opportunity.opportunityStatus ?? "") !== "open") return false;
        const days = daysUntil(opportunity.closesAt ?? opportunity.decisionDueAt, now);
        return days !== null && days <= 14;
      }).length;
      const openCount = opportunities.filter((opportunity) => ["open", "upcoming"].includes(opportunity.opportunityStatus ?? "")).length;
      return {
        project,
        opportunityCount: opportunities.length,
        openCount,
        closingSoonCount,
      };
    })
    .filter((item): item is { project: WorkspaceOperationsProjectRow; opportunityCount: number; openCount: number; closingSoonCount: number } => Boolean(item))
    .sort((left, right) => {
      if (right.closingSoonCount !== left.closingSoonCount) {
        return right.closingSoonCount - left.closingSoonCount;
      }
      if (right.openCount !== left.openCount) {
        return right.openCount - left.openCount;
      }
      return new Date(right.project.updatedAt ?? 0).getTime() - new Date(left.project.updatedAt ?? 0).getTime();
    });
  const fundingGapProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      const invoices = (fundingInvoicesByProjectId.get(profile.project_id) ?? []).filter((invoice) =>
        awards.some((award) => award.id === invoice.fundingAwardId)
      );
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        opportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        })),
        invoices.map((invoice) => ({
          funding_award_id: invoice.fundingAwardId,
          status: invoice.status,
          amount: invoice.amount,
          retention_percent: invoice.retentionPercent,
          retention_amount: invoice.retentionAmount,
          due_date: invoice.dueDate,
        }))
      );
      if (!summary.hasTargetNeed || opportunities.length === 0 || summary.unfundedAfterLikelyAmount <= 0) {
        return null;
      }
      return {
        project,
        summary,
      };
    })
    .filter((item): item is { project: WorkspaceOperationsProjectRow; summary: ReturnType<typeof buildProjectFundingStackSummary> } => Boolean(item))
    .sort((left, right) => right.summary.unfundedAfterLikelyAmount - left.summary.unfundedAfterLikelyAmount);
  const fundingSourcingProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        opportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        }))
      );
      if (!summary.hasTargetNeed || opportunities.length > 0) {
        return null;
      }
      return {
        project,
        summary,
      };
    })
    .filter((item): item is { project: WorkspaceOperationsProjectRow; summary: ReturnType<typeof buildProjectFundingStackSummary> } => Boolean(item))
    .sort((left, right) => right.summary.fundingNeedAmount - left.summary.fundingNeedAmount);
  const fundingDecisionProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      const actionableOpportunities = opportunities.filter(
        (opportunity) => !["awarded", "archived"].includes(opportunity.opportunityStatus ?? "")
      );
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        actionableOpportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        }))
      );
      if (!summary.hasTargetNeed || actionableOpportunities.length === 0 || summary.pursuedOpportunityCount > 0) {
        return null;
      }
      const leadOpportunity = [...actionableOpportunities].sort((left, right) => {
        const leftStatusPriority = getFundingDecisionOpportunityStatusPriority(left.opportunityStatus);
        const rightStatusPriority = getFundingDecisionOpportunityStatusPriority(right.opportunityStatus);
        if (leftStatusPriority !== rightStatusPriority) return leftStatusPriority - rightStatusPriority;
        const leftDueAt = left.closesAt ?? left.decisionDueAt;
        const rightDueAt = right.closesAt ?? right.decisionDueAt;
        if (leftDueAt && rightDueAt) {
          const dueDelta = new Date(leftDueAt).getTime() - new Date(rightDueAt).getTime();
          if (dueDelta !== 0) return dueDelta;
        }
        return new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime();
      })[0] ?? null;
      return {
        project,
        summary,
        leadOpportunity,
        modelingEvidence: projectGrantModelingEvidenceByProjectId.get(profile.project_id) ?? null,
        modelingReadiness: describeProjectGrantModelingReadiness(
          projectGrantModelingEvidenceByProjectId.get(profile.project_id) ?? null
        ),
      };
    })
    .filter(
      (
        item
      ): item is NonNullable<typeof item> => Boolean(item)
    )
    .sort((left, right) => {
      const leftStatusPriority = getFundingDecisionOpportunityStatusPriority(
        left.leadOpportunity?.opportunityStatus
      );
      const rightStatusPriority = getFundingDecisionOpportunityStatusPriority(
        right.leadOpportunity?.opportunityStatus
      );
      if (leftStatusPriority !== rightStatusPriority) {
        return leftStatusPriority - rightStatusPriority;
      }

      const leftDueAt = left.leadOpportunity?.closesAt ?? left.leadOpportunity?.decisionDueAt;
      const rightDueAt = right.leadOpportunity?.closesAt ?? right.leadOpportunity?.decisionDueAt;
      if (leftDueAt && rightDueAt) {
        const dueDelta = new Date(leftDueAt).getTime() - new Date(rightDueAt).getTime();
        if (dueDelta !== 0) {
          return dueDelta;
        }
      } else if (leftDueAt || rightDueAt) {
        return leftDueAt ? -1 : 1;
      }

      const modelingDifference = compareProjectGrantModelingEvidenceForQueue(
        left.modelingEvidence,
        right.modelingEvidence
      );
      if (modelingDifference !== 0) {
        return modelingDifference;
      }

      if (right.summary.fundingNeedAmount !== left.summary.fundingNeedAmount) {
        return right.summary.fundingNeedAmount - left.summary.fundingNeedAmount;
      }

      return new Date(right.project.updatedAt ?? 0).getTime() - new Date(left.project.updatedAt ?? 0).getTime();
    });
  const firstFundingDecisionProject = fundingDecisionProjects[0] ?? null;
  const grantModelingOperatorDetail = grantModelingOpportunityBreakdownSummary
    ? `Within grant decision work, opportunity-linked projects with modeling support that appears decision-ready rise ahead of refresh-recommended, thin, or unsupported work. Across ${grantModelingOpportunityBreakdownSummary} ${GRANT_MODELING_PLANNING_CAVEAT}`
    : null;
  const firstFundingDecisionProjectLeadPacketDetail =
    firstFundingDecisionProject?.modelingEvidence?.leadComparisonReport.title
      ? `${firstFundingDecisionProject.modelingEvidence.leadComparisonReport.title} is the lead packet to review.`
      : "";
  const firstFundingDecisionProjectRecommendation = firstFundingDecisionProject
    ? buildGrantDecisionModelingSupport(
        firstFundingDecisionProject.modelingEvidence,
        firstFundingDecisionProject.project.name
      )
    : null;
  const grantModelingLeadDecisionDetail = firstFundingDecisionProject
    ? `${firstFundingDecisionProject.leadOpportunity?.title ?? "The lead funding decision"} for ${firstFundingDecisionProject.project.name} ${firstFundingDecisionProject.modelingReadiness?.key === "decision-ready" ? "is rising because modeling posture appears decision-ready." : firstFundingDecisionProject.modelingReadiness ? `is still visible in the decision queue while modeling posture reads ${firstFundingDecisionProject.modelingReadiness.label.toLowerCase()}.` : "is still visible in the decision queue while modeling posture shows no visible support."}${firstFundingDecisionProjectLeadPacketDetail ? ` ${firstFundingDecisionProjectLeadPacketDetail}` : ""}${firstFundingDecisionProjectRecommendation ? ` Recommended next move: ${firstFundingDecisionProjectRecommendation.recommendedNextActionTitle}. ${firstFundingDecisionProjectRecommendation.recommendedNextActionSummary}` : ""}`
    : null;
  const grantModelingSummary: WorkspaceGrantModelingSummary | null = grantModelingOpportunityBreakdownSummary
    ? {
        breakdown: grantModelingOpportunityBreakdown,
        breakdownSummary: grantModelingOpportunityBreakdownSummary,
        operatorDetail: grantModelingOperatorDetail,
        leadDecisionDetail: grantModelingLeadDecisionDetail,
      }
    : null;
  const fundingAwardRecordProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        opportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        }))
      );
      const awardedOpportunity = [...opportunities]
        .filter(
          (opportunity) =>
            opportunity.opportunityStatus === "awarded" && !fundingAwardOpportunityIds.has(opportunity.id)
        )
        .sort((left, right) => new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime())[0] ?? null;
      if (!summary.hasTargetNeed || !awardedOpportunity) {
        return null;
      }
      return {
        project,
        summary,
        awardedOpportunity,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      const rightAwardAmount = Number(right.awardedOpportunity.expectedAwardAmount ?? 0);
      const leftAwardAmount = Number(left.awardedOpportunity.expectedAwardAmount ?? 0);
      if (rightAwardAmount !== leftAwardAmount) {
        return rightAwardAmount - leftAwardAmount;
      }
      return new Date(right.project.updatedAt ?? 0).getTime() - new Date(left.project.updatedAt ?? 0).getTime();
    });
  const fundingReimbursementProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      if (awards.length === 0) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const invoices = (fundingInvoicesByProjectId.get(profile.project_id) ?? []).filter((invoice) =>
        awards.some((award) => award.id === invoice.fundingAwardId)
      );
      const reimbursementPackets = reimbursementSubmittalsByProjectId.get(profile.project_id) ?? [];
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        opportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        })),
        invoices.map((invoice) => ({
          funding_award_id: invoice.fundingAwardId,
          status: invoice.status,
          amount: invoice.amount,
          retention_percent: invoice.retentionPercent,
          retention_amount: invoice.retentionAmount,
          due_date: invoice.dueDate,
        }))
      );
      const hasReimbursementFollowThrough =
        summary.reimbursementStatus !== "paid" &&
        (summary.uninvoicedAwardAmount > 0 ||
          summary.requestedReimbursementAmount > 0 ||
          summary.outstandingReimbursementAmount > 0 ||
          summary.draftReimbursementAmount > 0 ||
          summary.paidReimbursementAmount > 0);
      if (!hasReimbursementFollowThrough) return null;
      return {
        project,
        summary,
        reimbursementPacketCount: reimbursementPackets.length,
        invoices,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.summary.uninvoicedAwardAmount - left.summary.uninvoicedAwardAmount);
  const reimbursementStartProjects = fundingReimbursementProjects.filter(
    (item) => item.reimbursementPacketCount === 0 && item.summary.reimbursementStatus === "not_started"
  );
  const reimbursementAdvanceProjects = fundingReimbursementProjects.filter(
    (item) => !(item.reimbursementPacketCount === 0 && item.summary.reimbursementStatus === "not_started")
  );
  const invoiceAwardRelinkProjects = projects
    .map((project) => {
      const awards = fundingAwardsByProjectId.get(project.id) ?? [];
      const unlinkedInvoices = (fundingInvoicesByProjectId.get(project.id) ?? []).filter(
        (invoice) => !invoice.fundingAwardId && !["paid", "rejected"].includes(invoice.status ?? "draft")
      );
      if (awards.length !== 1 || unlinkedInvoices.length !== 1) {
        return null;
      }
      return {
        project,
        award: awards[0],
        invoice: unlinkedInvoices[0],
        overdue:
          Boolean(unlinkedInvoices[0].dueDate) &&
          !Number.isNaN(new Date(unlinkedInvoices[0].dueDate ?? "").getTime()) &&
          new Date(unlinkedInvoices[0].dueDate ?? "").getTime() < now.getTime(),
        netAmount: computeNetInvoiceAmount(
          unlinkedInvoices[0].amount,
          unlinkedInvoices[0].retentionAmount,
          unlinkedInvoices[0].retentionPercent
        ),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      if (Number(right.overdue) !== Number(left.overdue)) {
        return Number(right.overdue) - Number(left.overdue);
      }
      if (right.netAmount !== left.netAmount) {
        return right.netAmount - left.netAmount;
      }
      return new Date(right.project.updatedAt ?? 0).getTime() - new Date(left.project.updatedAt ?? 0).getTime();
    });

  const firstRefreshReport = reportRows.find((report) => report.freshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED);
  const firstMissingReport = reportRows.find((report) => report.freshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET);
  const firstCurrentReport = reportRows.find((report) => report.freshness.label === PACKET_FRESHNESS_LABELS.CURRENT);
  const firstCurrentRtpFundingReviewReport = reportRows.find(
    (report) => report.freshness.label === PACKET_FRESHNESS_LABELS.CURRENT && report.storedRtpFundingReview?.needsAttention
  );
  const firstCurrentRtpReviewLoopReport = reportRows.find(
    (report) =>
      report.freshness.label === PACKET_FRESHNESS_LABELS.CURRENT
      && !report.storedRtpFundingReview?.needsAttention
      && Boolean(report.storedRtpReleaseReviewSummary)
      // The discriminant, not the label. Rewording "Release review ready" used
      // to move every workspace's next command without failing anything.
      && report.storedRtpReleaseReviewSummary?.state !== "ready"
  );
  const firstComparisonBackedReport = reportRows.find(
    (report) => (report.comparisonAggregate?.comparisonSnapshotCount ?? 0) > 0
  );
  const firstClosingOpportunity = fundingOpportunities.find((item) => {
    if ((item.opportunityStatus ?? "") !== "open") return false;
    const days = daysUntil(item.closesAt ?? item.decisionDueAt, now);
    return days !== null && days <= 14;
  });
  const firstClosingProgram = firstClosingOpportunity?.programId
    ? programs.find((program) => program.id === firstClosingOpportunity.programId) ?? null
    : null;
  const firstClosingProject = firstClosingOpportunity?.projectId
    ? projects.find((project) => project.id === firstClosingOpportunity.projectId) ?? null
    : null;
  const firstOverdueDecisionOpportunity = [...overdueDecisionOpportunities].sort((left, right) => {
    const leftTime = left.decisionDueAt ? new Date(left.decisionDueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightTime = right.decisionDueAt ? new Date(right.decisionDueAt).getTime() : Number.POSITIVE_INFINITY;
    return leftTime - rightTime;
  })[0] ?? null;
  const firstOverdueDecisionProgram = firstOverdueDecisionOpportunity?.programId
    ? programs.find((program) => program.id === firstOverdueDecisionOpportunity.programId) ?? null
    : null;
  const firstOverdueDecisionProject = firstOverdueDecisionOpportunity?.projectId
    ? projects.find((project) => project.id === firstOverdueDecisionOpportunity.projectId) ?? null
    : null;
  const firstPlanNeedingSetup = plans.find(planNeedsObservableRecordSetup);
  const firstActiveProgram = programs.find((program) => !["adopted", "archived"].includes(program.status ?? ""));

  const queueCandidates: WorkspaceCommandQueueItem[] = [];

  if (reportRefreshRecommended > 0) {
    queueCandidates.push({
      key: "refresh-report-packets",
      title: "Refresh report packets",
      detail: `${reportRefreshRecommended} report packet${reportRefreshRecommended === 1 ? " needs" : "s need"} regeneration because the underlying record changed after generation.${firstRefreshReport?.title ? ` Start with ${firstRefreshReport.title}.` : ""}`,
      href: firstRefreshReport
        ? getReportNavigationHref(firstRefreshReport.id, firstRefreshReport.freshness.label)
        : "/reports?freshness=refresh",
      tone: "warning",
      priority: 0,
      badges: [
        { label: "Refresh", value: reportRefreshRecommended },
        { label: "Reports", value: reports.length },
      ],
    });
  }

  if (reportNoPacket > 0) {
    queueCandidates.push({
      key: "generate-first-packets",
      title: "Generate first report packets",
      detail: `${reportNoPacket} report record${reportNoPacket === 1 ? " is" : "s are"} still missing a packet artifact.${firstMissingReport?.title ? ` Start with ${firstMissingReport.title}.` : ""}`,
      href: firstMissingReport
        ? getReportNavigationHref(firstMissingReport.id, firstMissingReport.freshness.label)
        : "/reports?freshness=missing",
      tone: "warning",
      priority: 1,
      badges: [
        { label: "Missing", value: reportNoPacket },
        { label: "Reports", value: reports.length },
      ],
    });
  }

  if (reportPacketCurrent > 0) {
    const currentRtpFundingReviewFollowThrough = firstCurrentRtpFundingReviewReport?.grantsFollowThrough ?? null;
    queueCandidates.push({
      key: "review-current-report-packets",
      title: currentRtpFundingReviewFollowThrough
        ? "Run Grants follow-through on current packets"
        : "Review the packets that are ready",
      detail: currentRtpFundingReviewFollowThrough
        ? `${reportPacketCurrent} report packet${reportPacketCurrent === 1 ? " is" : "s are"} up to date with the work behind it, but ${rtpFundingReviewPackets} current RTP packet${rtpFundingReviewPackets === 1 ? " still needs" : "s still need"} funding sorted out in Grants for the projects they include before you share them. Reopen ${currentRtpFundingReviewFollowThrough.actionLabel.toLowerCase()} first because ${currentRtpFundingReviewFollowThrough.title.charAt(0).toLowerCase()}${currentRtpFundingReviewFollowThrough.title.slice(1)}`
        : firstCurrentRtpReviewLoopReport?.storedRtpReleaseReviewSummary
          ? `${reportPacketCurrent} report packet${reportPacketCurrent === 1 ? " is" : "s are"} up to date with the work behind it, but ${rtpReviewLoopOpenPackets} current RTP packet${rtpReviewLoopOpenPackets === 1 ? " still reads" : "s still read"} as ${firstCurrentRtpReviewLoopReport.storedRtpReleaseReviewSummary.label.toLowerCase()}. ${firstCurrentRtpReviewLoopReport.title ?? "The lead RTP packet"}: ${firstCurrentRtpReviewLoopReport.storedRtpReleaseReviewSummary.detail}`
          : `${reportPacketCurrent} report packet${reportPacketCurrent === 1 ? " is" : "s are"} up to date with the work behind it and ready for someone to review.${rtpFundingReviewPackets > 0 ? ` ${rtpFundingReviewPackets} current RTP packet${rtpFundingReviewPackets === 1 ? " still carries" : "s still carry"} funding follow-up from linked projects.${firstCurrentRtpFundingReviewReport?.storedRtpFundingReview ? ` ${firstCurrentRtpFundingReviewReport.title ?? "The lead RTP packet"} is flagged as ${firstCurrentRtpFundingReviewReport.storedRtpFundingReview.label.toLowerCase()}.` : ""}` : firstCurrentReport?.title ? ` Start with ${firstCurrentReport.title}.` : ""}`,
      href: currentRtpFundingReviewFollowThrough?.href
        ?? (firstCurrentRtpReviewLoopReport
          ? getReportNavigationHref(firstCurrentRtpReviewLoopReport.id, firstCurrentRtpReviewLoopReport.freshness.label)
          : firstCurrentReport
            ? getReportNavigationHref(firstCurrentReport.id, firstCurrentReport.freshness.label)
            : "/reports?freshness=current"),
      moduleKey: currentRtpFundingReviewFollowThrough ? GRANTS_COMMAND_MODULE_KEY : undefined,
      moduleLabel: currentRtpFundingReviewFollowThrough ? GRANTS_COMMAND_MODULE_LABEL : undefined,
      tone: rtpFundingReviewPackets > 0 || rtpReviewLoopOpenPackets > 0 ? "warning" : "info",
      priority: 2.5,
      badges: [
        { label: "Current", value: reportPacketCurrent },
        ...(rtpFundingReviewPackets > 0 ? [{ label: "Funding review", value: rtpFundingReviewPackets }] : []),
        ...(rtpReviewLoopOpenPackets > 0 ? [{ label: "Review loop open", value: rtpReviewLoopOpenPackets }] : []),
        { label: "Reports", value: reports.length },
      ],
    });
  }

  if (overdueDecisionOpportunities.length > 0) {
    const overdueCount = overdueDecisionOpportunities.length;
    queueCandidates.push({
      key: "resolve-overdue-funding-decisions",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Resolve overdue funding decisions",
      detail: `${overdueCount} monitored funding opportunit${overdueCount === 1 ? "y is" : "ies are"} past their decision deadline without a pursue or skip call.${firstOverdueDecisionOpportunity?.title ? ` ${firstOverdueDecisionOpportunity.title} is the oldest lapsed decision.` : ""}${firstOverdueDecisionProgram?.title ? ` Reopen ${firstOverdueDecisionProgram.title} first.` : firstOverdueDecisionProject?.name ? ` Reopen ${firstOverdueDecisionProject.name} first.` : ""}`,
      href: firstOverdueDecisionOpportunity?.id
        ? `/grants?focusOpportunityId=${firstOverdueDecisionOpportunity.id}#funding-opportunity-${firstOverdueDecisionOpportunity.id}`
        : "/grants",
      targetProjectId: firstOverdueDecisionOpportunity?.projectId ?? null,
      targetOpportunityId: firstOverdueDecisionOpportunity?.id ?? null,
      targetOpportunityTitle: firstOverdueDecisionOpportunity?.title ?? null,
      tone: "warning",
      priority: 1.8,
      badges: [
        { label: "Overdue decisions", value: overdueCount },
        { label: "Open", value: openFundingOpportunities },
      ],
    });
  }

  if (closingSoonFundingOpportunities > 0) {
    queueCandidates.push({
      key: "funding-windows-closing",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Advance near-term funding windows",
      detail: `${closingSoonFundingOpportunities} open funding opportunit${closingSoonFundingOpportunities === 1 ? "y closes" : "ies close"} within 14 days.${firstClosingOpportunity?.title ? ` ${firstClosingOpportunity.title} is the first deadline to reopen.` : ""}${firstClosingProgram?.title ? ` Reopen ${firstClosingProgram.title} first.` : firstClosingProject?.name ? ` Reopen ${firstClosingProject.name} first.` : ""}`,
      href: firstClosingOpportunity?.programId
        ? `/programs/${firstClosingOpportunity.programId}#program-funding-opportunities`
        : firstClosingOpportunity?.projectId
          ? `/projects/${firstClosingOpportunity.projectId}#project-funding-opportunities`
          : "/programs",
      targetProjectId: firstClosingOpportunity?.projectId ?? null,
      targetOpportunityId: firstClosingOpportunity?.id ?? null,
      targetOpportunityTitle: firstClosingOpportunity?.title ?? null,
      tone: "warning",
      priority: 2,
      badges: [
        { label: "Closing soon", value: closingSoonFundingOpportunities },
        { label: "Open", value: openFundingOpportunities },
      ],
    });
  }

  if (projectFundingNeedAnchorProjects.length > 0) {
    const firstFundingNeedAnchorProject = projectFundingNeedAnchorProjects[0];
    queueCandidates.push({
      key: "anchor-project-funding-needs",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Anchor project funding needs",
      detail: `${projectFundingNeedAnchorProjects.length} project funding lane${projectFundingNeedAnchorProjects.length === 1 ? " has" : "s have"} linked opportunities but still no recorded funding-need anchor.${firstFundingNeedAnchorProject ? ` Reopen ${firstFundingNeedAnchorProject.project.name} first so the gap can be measured honestly.` : ""}`,
      href: firstFundingNeedAnchorProject
        ? `/projects/${firstFundingNeedAnchorProject.project.id}#project-funding-opportunities`
        : "/projects",
      targetProjectId: firstFundingNeedAnchorProject?.project.id ?? null,
      targetProjectName: firstFundingNeedAnchorProject?.project.name ?? null,
      tone: "warning",
      priority: 3,
      badges: [
        { label: "Missing anchors", value: projectFundingNeedAnchorProjects.length },
        { label: "Open windows", value: firstFundingNeedAnchorProject?.openCount ?? null },
      ],
    });
  }

  if (fundingAwardRecordProjects.length > 0) {
    const firstFundingAwardRecordProject = fundingAwardRecordProjects[0];
    queueCandidates.push({
      key: "record-awarded-funding",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Record awarded funding",
      detail: `${fundingAwardRecordProjects.length} project funding stack${fundingAwardRecordProjects.length === 1 ? " has" : "s have"} an opportunity already marked awarded but no funding-award record yet.${firstFundingAwardRecordProject ? ` Reopen ${firstFundingAwardRecordProject.project.name} first and convert ${firstFundingAwardRecordProject.awardedOpportunity.title} into a committed award entry.` : ""}`,
      href: firstFundingAwardRecordProject
        ? `/projects/${firstFundingAwardRecordProject.project.id}#project-funding-opportunities`
        : "/projects",
      targetProjectId: firstFundingAwardRecordProject?.project.id ?? null,
      targetProjectName: firstFundingAwardRecordProject?.project.name ?? null,
      targetOpportunityId: firstFundingAwardRecordProject?.awardedOpportunity.id ?? null,
      targetOpportunityTitle: firstFundingAwardRecordProject?.awardedOpportunity.title ?? null,
      tone: "warning",
      priority: 6,
      badges: [
        { label: "Award records needed", value: fundingAwardRecordProjects.length },
        {
          label: "Lead awarded",
          value: firstFundingAwardRecordProject
            ? formatCurrency(Number(firstFundingAwardRecordProject.awardedOpportunity.expectedAwardAmount ?? 0))
            : null,
        },
      ],
    });
  }

  if (reimbursementStartProjects.length > 0) {
    const firstReimbursementStartProject = reimbursementStartProjects[0];
    queueCandidates.push({
      key: "start-project-reimbursement-packets",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Start reimbursement packets",
      detail: `${reimbursementStartProjects.length} project funding stack${reimbursementStartProjects.length === 1 ? " has" : "s have"} committed awards with uninvoiced dollars but no reimbursement packet started yet.${firstReimbursementStartProject ? ` Reopen ${firstReimbursementStartProject.project.name} first and start the packet against ${formatCurrency(firstReimbursementStartProject.summary.uninvoicedAwardAmount)} still uninvoiced.` : ""}`,
      href: firstReimbursementStartProject
        ? `/projects/${firstReimbursementStartProject.project.id}#project-submittals`
        : "/projects",
      targetProjectId: firstReimbursementStartProject?.project.id ?? null,
      targetProjectName: firstReimbursementStartProject?.project.name ?? null,
      tone: "warning",
      priority: 6.2,
      badges: [
        { label: "Packets needed", value: reimbursementStartProjects.length },
        {
          label: "Uninvoiced",
          value: firstReimbursementStartProject
            ? formatCurrency(firstReimbursementStartProject.summary.uninvoicedAwardAmount)
            : null,
        },
      ],
    });
  }

  if (invoiceAwardRelinkProjects.length > 0) {
    const firstInvoiceAwardRelinkProject = invoiceAwardRelinkProjects[0];
    queueCandidates.push({
      key: "relink-project-invoice-awards",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Relink invoice reimbursement records",
      detail: `${invoiceAwardRelinkProjects.length} project reimbursement lane${invoiceAwardRelinkProjects.length === 1 ? " has" : "s have"} an exact invoice-to-award relink available right now.${firstInvoiceAwardRelinkProject ? ` Reopen ${firstInvoiceAwardRelinkProject.project.name} first and attach ${firstInvoiceAwardRelinkProject.invoice.id} to ${firstInvoiceAwardRelinkProject.award.title}.` : ""}`,
      href: firstInvoiceAwardRelinkProject
        ? `/projects/${firstInvoiceAwardRelinkProject.project.id}#project-invoices`
        : "/projects",
      targetProjectId: firstInvoiceAwardRelinkProject?.project.id ?? null,
      targetProjectName: firstInvoiceAwardRelinkProject?.project.name ?? null,
      targetInvoiceId: firstInvoiceAwardRelinkProject?.invoice.id ?? null,
      targetFundingAwardId: firstInvoiceAwardRelinkProject?.award.id ?? null,
      tone: "warning",
      priority: 6.25,
      badges: [
        { label: "Exact relinks", value: invoiceAwardRelinkProjects.length },
        {
          label: "Lead invoice",
          value: firstInvoiceAwardRelinkProject ? formatCurrency(firstInvoiceAwardRelinkProject.netAmount) : null,
        },
      ],
    });
  }

  if (reimbursementAdvanceProjects.length > 0) {
    const firstReimbursementAdvanceProject = reimbursementAdvanceProjects[0];
    queueCandidates.push({
      key: "advance-project-reimbursement-invoicing",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Advance reimbursement invoicing",
      detail: `${reimbursementAdvanceProjects.length} project funding stack${reimbursementAdvanceProjects.length === 1 ? " has" : "s have"} reimbursement work underway and still needs follow-through.${firstReimbursementAdvanceProject ? ` Reopen ${firstReimbursementAdvanceProject.project.name} first and move ${formatCurrency(
        Math.max(
          firstReimbursementAdvanceProject.summary.outstandingReimbursementAmount,
          firstReimbursementAdvanceProject.summary.draftReimbursementAmount,
          firstReimbursementAdvanceProject.summary.uninvoicedAwardAmount
        )
      )} through billing triage.` : ""}`,
      href: firstReimbursementAdvanceProject
        ? `/projects/${firstReimbursementAdvanceProject.project.id}#project-invoices`
        : "/projects",
      targetProjectId: firstReimbursementAdvanceProject?.project.id ?? null,
      targetProjectName: firstReimbursementAdvanceProject?.project.name ?? null,
      targetInvoiceId: firstReimbursementAdvanceProject
        ? resolveExactWorkspaceBillingInvoiceId(firstReimbursementAdvanceProject.invoices)
        : null,
      tone: "warning",
      priority: 6.3,
      badges: [
        { label: "Reimbursement active", value: reimbursementAdvanceProjects.length },
        {
          label: "Follow-through",
          value: firstReimbursementAdvanceProject
            ? formatCurrency(
                Math.max(
                  firstReimbursementAdvanceProject.summary.outstandingReimbursementAmount,
                  firstReimbursementAdvanceProject.summary.draftReimbursementAmount,
                  firstReimbursementAdvanceProject.summary.uninvoicedAwardAmount
                )
              )
            : null,
        },
      ],
    });
  }

  if (fundingGapProjects.length > 0) {
    const firstFundingGapProject = fundingGapProjects[0];
    queueCandidates.push({
      key: "close-project-funding-gaps",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Close project funding gaps",
      detail: `${fundingGapProjects.length} project funding stack${fundingGapProjects.length === 1 ? " still shows" : "s still show"} an uncovered gap after current pursued dollars.${firstFundingGapProject ? ` ${firstFundingGapProject.project.name} still carries ${formatCurrency(firstFundingGapProject.summary.unfundedAfterLikelyAmount)} uncovered.` : ""}`,
      href: firstFundingGapProject ? `/projects/${firstFundingGapProject.project.id}#project-funding-opportunities` : "/projects",
      targetProjectId: firstFundingGapProject?.project.id ?? null,
      targetProjectName: firstFundingGapProject?.project.name ?? null,
      tone: "warning",
      priority: 7,
      badges: [
        { label: "Gap projects", value: fundingGapProjects.length },
        { label: "Largest gap", value: firstFundingGapProject ? formatCurrency(firstFundingGapProject.summary.unfundedAfterLikelyAmount) : null },
      ],
    });
  }

  if (fundingSourcingProjects.length > 0) {
    const firstFundingSourcingProject = fundingSourcingProjects[0];
    queueCandidates.push({
      key: "source-project-funding-opportunities",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Source project funding opportunities",
      detail: `${fundingSourcingProjects.length} project funding stack${fundingSourcingProjects.length === 1 ? " has" : "s have"} a recorded funding need but still no linked funding opportunities.${firstFundingSourcingProject ? ` Reopen ${firstFundingSourcingProject.project.name} first and source candidate programs.` : ""}`,
      href: firstFundingSourcingProject
        ? `/projects/${firstFundingSourcingProject.project.id}#project-funding-opportunities`
        : "/projects",
      targetProjectId: firstFundingSourcingProject?.project.id ?? null,
      targetProjectName: firstFundingSourcingProject?.project.name ?? null,
      tone: "warning",
      priority: 4,
      badges: [
        { label: "Needs sourcing", value: fundingSourcingProjects.length },
        {
          label: "Largest unfunded need",
          value: firstFundingSourcingProject ? formatCurrency(firstFundingSourcingProject.summary.fundingNeedAmount) : null,
        },
      ],
    });
  }

  if (fundingDecisionProjects.length > 0) {
    const firstFundingDecisionProjectModelingDetail = firstFundingDecisionProject
      ? `Modeling posture for ${firstFundingDecisionProject.project.name}: ${formatGrantModelingPostureLabel(firstFundingDecisionProject.modelingReadiness)}.${firstFundingDecisionProjectRecommendation ? ` Recommended next move: ${firstFundingDecisionProjectRecommendation.recommendedNextActionTitle}. ${firstFundingDecisionProjectRecommendation.recommendedNextActionSummary}` : ""}`
      : "";
    queueCandidates.push({
      key: "advance-project-funding-decisions",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Advance project funding decisions",
      detail: `${fundingDecisionProjects.length} project funding stack${fundingDecisionProjects.length === 1 ? " has" : "s have"} linked opportunities but nothing marked pursue yet.${firstFundingDecisionProject?.leadOpportunity ? ` ${firstFundingDecisionProject.leadOpportunity.title} is the first grant decision to advance for ${firstFundingDecisionProject.project.name}.` : firstFundingDecisionProject ? ` Reopen ${firstFundingDecisionProject.project.name} first and choose the lead opportunity.` : ""}${firstFundingDecisionProjectModelingDetail ? ` ${firstFundingDecisionProjectModelingDetail}` : ""}`,
      href: firstFundingDecisionProject
        ? `/projects/${firstFundingDecisionProject.project.id}#project-funding-opportunities`
        : "/projects",
      targetProjectId: firstFundingDecisionProject?.project.id ?? null,
      targetProjectName: firstFundingDecisionProject?.project.name ?? null,
      targetOpportunityId: firstFundingDecisionProject?.leadOpportunity?.id ?? null,
      targetOpportunityTitle: firstFundingDecisionProject?.leadOpportunity?.title ?? null,
      tone: "warning",
      priority: 5,
      badges: [
        { label: "Decision gaps", value: fundingDecisionProjects.length },
        { label: "Lead need", value: firstFundingDecisionProject ? formatCurrency(firstFundingDecisionProject.summary.fundingNeedAmount) : null },
        { label: "Modeling", value: formatGrantModelingPostureLabel(firstFundingDecisionProject?.modelingReadiness ?? null) },
        { label: "Next move", value: firstFundingDecisionProjectRecommendation?.recommendedNextActionTitle ?? null },
      ],
    });
  }

  if (plansNeedingSetup > 0) {
    queueCandidates.push({
      key: "tighten-plan-foundations",
      title: "Tighten plan foundations",
      detail: `${plansNeedingSetup} plan record${plansNeedingSetup === 1 ? " still needs" : "s still need"} core setup around project linkage, geography, or horizon year.${firstPlanNeedingSetup?.title ? ` Reopen ${firstPlanNeedingSetup.title} first.` : ""}`,
      href: "/plans",
      tone: "info",
      priority: 7,
      badges: [
        { label: "Needs setup", value: plansNeedingSetup },
        { label: "Plans", value: plans.length },
      ],
    });
  }

  if (activePrograms > 0) {
    queueCandidates.push({
      key: "advance-program-packages",
      title: "Advance active program packages",
      detail: `${activePrograms} program package${activePrograms === 1 ? " is" : "s are"} still in assembly, submission, or review posture.${firstActiveProgram?.title ? ` ${firstActiveProgram.title} is a good next package anchor.` : ""}`,
      href: "/programs",
      tone: "info",
      priority: 8,
      badges: [
        { label: "Active programs", value: activePrograms },
        { label: "Programs", value: programs.length },
      ],
    });
  }

  if (comparisonBackedReports > 0) {
    queueCandidates.push({
      key: "review-comparison-backed-reports",
      title: "Review comparison-backed packet posture",
      detail: `${comparisonBackedReports} report${comparisonBackedReports === 1 ? " carries" : "s carry"} saved comparison context that can support grant planning language or prioritization framing while shaping refresh and narrative choices.${grantModelingOpportunityBreakdownSummary ? ` Across ${grantModelingOpportunityBreakdownSummary}` : ""} ${GRANT_MODELING_PLANNING_CAVEAT}${firstComparisonBackedReport?.comparisonDigest?.detail ? ` ${firstComparisonBackedReport.comparisonDigest.detail}` : ""}`,
      href: "/reports?posture=comparison-backed",
      tone: "info",
      priority: 9,
      badges: [
        { label: "Comparison-backed", value: comparisonBackedReports },
        { label: "Ready comparisons", value: firstComparisonBackedReport?.comparisonAggregate?.readyComparisonSnapshotCount ?? null },
        ...(grantModelingOpportunityBreakdownSummary
          ? [
              {
                label: "Modeling triage",
                value: `${grantModelingOpportunityBreakdown.decisionReady} ready · ${grantModelingOpportunityBreakdown.refreshRecommended} refresh · ${grantModelingOpportunityBreakdown.thin} thin · ${grantModelingOpportunityBreakdown.noVisibleSupport} none`,
              },
            ]
          : []),
      ],
    });
  }

  if (aerialPosture && aerialPosture.missionCount > 0) {
    const aerialDetail =
      aerialPosture.verificationReadiness === "ready"
        ? `${aerialPosture.readyPackageCount} evidence package${aerialPosture.readyPackageCount === 1 ? " is" : "s are"} ready to support field verification. Review before the next site visit to ensure materials are current.`
        : aerialPosture.activeMissionCount > 0
        ? `${aerialPosture.activeMissionCount} mission${aerialPosture.activeMissionCount === 1 ? " is" : "s are"} active. Evidence packages are pending QA and verification — check back after collection concludes.`
        : `${aerialPosture.completeMissionCount} of ${aerialPosture.missionCount} mission${aerialPosture.missionCount === 1 ? "" : "s"} complete. Review evidence packages before treating field capture as verification-ready.`;

    queueCandidates.push({
      key: "review-aerial-evidence",
      title: "Review aerial evidence posture",
      detail: aerialDetail,
      href: "/projects",
      tone: aerialPosture.verificationReadiness === "ready" ? "success" : "info",
      priority: 10,
      badges: [
        { label: "Missions", value: aerialPosture.missionCount },
        { label: "Active", value: aerialPosture.activeMissionCount },
        { label: "Packages ready", value: aerialPosture.readyPackageCount },
      ],
    });
  }

  // ── Workspace-lane queue candidates ──────────────────────────────────────
  // Every guard below is `> 0` against a `number | null`, which in TypeScript
  // is false for `null` — deliberately, and this is the whole discipline for
  // these lanes: a number this module could not measure produces NO queue item,
  // because "we could not count the moderation queue" is not the same claim as
  // "the moderation queue is clear", and a command queue is read as the second.
  // A lane that could not be read discloses itself through
  // `moduleObservations.unreadable`, never through a missing or invented item.
  const engagementObservation = moduleObservations?.engagement ?? null;
  const safetyObservation = moduleObservations?.safety ?? null;
  const modelingObservation = moduleObservations?.modeling ?? null;
  const evidenceObservation = moduleObservations?.evidence ?? null;
  const receivablesObservation = moduleObservations?.receivables ?? null;

  const moderationActionableItems = engagementObservation?.moderationActionableItems ?? null;
  if (moderationActionableItems !== null && moderationActionableItems > 0) {
    const leadCampaign = engagementObservation?.leadActiveCampaign ?? null;
    queueCandidates.push({
      key: "moderate-engagement-comments",
      title: "Moderate waiting engagement comments",
      detail: `${moderationActionableItems} comment${moderationActionableItems === 1 ? " is" : "s are"} pending or flagged in the moderation queue, so no report handoff, comment matrix, or public-review appendix drawn from this workspace is settled yet.${leadCampaign ? ` Reopen ${leadCampaign.title} first.` : ""}`,
      href: leadCampaign ? `/engagement/${leadCampaign.id}` : "/engagement",
      tone: "warning",
      priority: 4.5,
      badges: [
        { label: "Awaiting moderation", value: moderationActionableItems },
        { label: "Approved", value: engagementObservation?.approvedItems ?? null },
      ],
    });
  }

  const failedModelRuns = modelingObservation?.failedModelRuns ?? null;
  if (failedModelRuns !== null && failedModelRuns > 0) {
    queueCandidates.push({
      key: "resolve-failed-model-runs",
      title: "Resolve failed model runs",
      detail: `${failedModelRuns} model run${failedModelRuns === 1 ? " has" : "s have"} failed and produced no result. Anything downstream that expected those runs — scenario comparison, packet evidence, grant modeling support — is missing an input rather than showing a low number.`,
      href: "/models",
      tone: "warning",
      priority: 5.5,
      badges: [
        { label: "Failed", value: failedModelRuns },
        { label: "In flight", value: modelingObservation?.activeModelRuns ?? null },
        { label: "Succeeded", value: modelingObservation?.succeededModelRuns ?? null },
      ],
    });
  }

  const failedCrashIngests = safetyObservation?.failedCrashIngests ?? null;
  const uncoveredCrashIngests = safetyObservation?.uncoveredCrashIngests ?? null;
  if (
    (failedCrashIngests !== null && failedCrashIngests > 0) ||
    (uncoveredCrashIngests !== null && uncoveredCrashIngests > 0)
  ) {
    const hasFailures = failedCrashIngests !== null && failedCrashIngests > 0;
    queueCandidates.push({
      key: "resolve-safety-crash-data-pulls",
      title: hasFailures ? "Retry failed crash data pulls" : "Disclose uncovered crash data areas",
      detail: hasFailures
        ? `${failedCrashIngests} crash data pull${failedCrashIngests === 1 ? "" : "s"} did not complete, so the safety screening for ${failedCrashIngests === 1 ? "that study area" : "those study areas"} has no observed crash record behind it. ${SAFETY_SCREENING_NARRATIVE_CAVEAT}`
        : `${uncoveredCrashIngests} crash data pull${uncoveredCrashIngests === 1 ? " found no" : "s found no"} registered source covering the requested area. Say that limit in any safety framing for ${uncoveredCrashIngests === 1 ? "that area" : "those areas"} — an empty result there is a coverage gap, not a finding about collisions. ${SAFETY_SCREENING_NARRATIVE_CAVEAT}`,
      href: "/safety",
      tone: hasFailures ? "warning" : "info",
      priority: 6.5,
      badges: [
        ...(hasFailures ? [{ label: "Failed pulls", value: failedCrashIngests }] : []),
        ...(uncoveredCrashIngests !== null && uncoveredCrashIngests > 0
          ? [{ label: "No coverage", value: uncoveredCrashIngests }]
          : []),
        { label: "Ready", value: safetyObservation?.readyCrashIngests ?? null },
      ],
    });
  }

  const datasetsNeedingAttention = evidenceObservation?.datasetsNeedingAttention ?? null;
  if (datasetsNeedingAttention !== null && datasetsNeedingAttention > 0) {
    queueCandidates.push({
      key: "refresh-attention-datasets",
      title: "Refresh datasets flagged stale or errored",
      detail: `${datasetsNeedingAttention} dataset${datasetsNeedingAttention === 1 ? " reports" : "s report"} a stale or error status in the Data Hub. Analysis, screening, and packet evidence built on ${datasetsNeedingAttention === 1 ? "it" : "them"} is running on data the workspace has already marked as needing a refresh.`,
      href: "/data-hub",
      tone: "warning",
      priority: 8.5,
      badges: [
        { label: "Needs refresh", value: datasetsNeedingAttention },
        { label: "Datasets", value: evidenceObservation?.datasets ?? null },
      ],
    });
  }

  const failedKnowledgeDocuments = evidenceObservation?.failedKnowledgeDocuments ?? null;
  if (failedKnowledgeDocuments !== null && failedKnowledgeDocuments > 0) {
    queueCandidates.push({
      key: "resolve-knowledge-extraction-failures",
      title: "Resolve knowledge base extraction failures",
      detail: `${failedKnowledgeDocuments} uploaded document${failedKnowledgeDocuments === 1 ? " could not be" : "s could not be"} read into text, so ${failedKnowledgeDocuments === 1 ? "it is" : "they are"} absent from every grounded citation and retrieval answer without saying so at the point of use.`,
      href: "/knowledge-base",
      tone: "warning",
      priority: 8.6,
      badges: [
        { label: "Extraction failed", value: failedKnowledgeDocuments },
        { label: "Ready", value: evidenceObservation?.readyKnowledgeDocuments ?? null },
      ],
    });
  }

  const draftClientInvoices = receivablesObservation?.draftClientInvoices ?? null;
  if (draftClientInvoices !== null && draftClientInvoices > 0) {
    queueCandidates.push({
      key: "advance-client-invoice-drafts",
      title: "Advance draft client invoices",
      detail: `${draftClientInvoices} client invoice${draftClientInvoices === 1 ? " is" : "s are"} still in draft and has not been sent, so the work behind ${draftClientInvoices === 1 ? "it" : "them"} is unbilled.`,
      href: "/invoicing",
      tone: "info",
      priority: 9.5,
      badges: [
        { label: "Draft", value: draftClientInvoices },
        { label: "Awaiting payment", value: receivablesObservation?.awaitingPaymentClientInvoices ?? null },
      ],
    });
  }

  const fullCommandQueue = queueCandidates.sort((left, right) => left.priority - right.priority);
  const commandQueue = fullCommandQueue.slice(0, 5);

  const nextCommand = commandQueue[0] ?? null;
  const posture = nextCommand
    ? nextCommand.tone === "warning" || nextCommand.tone === "danger"
      ? "attention"
      : "active"
    : "stable";

  // An empty queue is the loudest claim this summary makes — it is the sentence
  // the Dashboard, the Command Center and the assistant's runtime cue all lead
  // with when nothing needs attention. It may only be spoken when every read
  // behind it actually completed. A failed read produces no queue item (see the
  // `> 0` discipline above), so "clear" and "we could not look" arrive here
  // indistinguishable unless the failure log is consulted.
  //
  // Deliberately NOT split by which read failed. The counts sentence names
  // project and report totals, and one failed spine read makes both wrong; a
  // failed LANE read means a queue item may be missing, which unmakes "clear"
  // just as completely. Both are the same sentence to a planner: this snapshot
  // is incomplete, and its silence is not evidence.
  const unreadableReads = moduleObservations?.unreadable ?? [];
  const headline = nextCommand
    ? nextCommand.title
    : unreadableReads.length > 0
      ? "Workspace command queue could not be read in full"
      : "Workspace command queue is clear";
  const detail = nextCommand
    ? nextCommand.detail
    : unreadableReads.length > 0
      ? `${describeUnreadableWorkspaceReads(unreadableReads)} Nothing needing attention turned up in the records this snapshot could read, which is not the same as nothing needing attention — the unreadable records were not counted at all.`
      : reports.length > 0
        ? `The current workspace has ${reports.length} report record${reports.length === 1 ? "" : "s"}, ${projects.length} project${projects.length === 1 ? "" : "s"}, and no immediate packet or funding-window pressure visible from this snapshot.`
        : "Create the next project, plan, program, or report record so the operations runtime has a real command surface to prioritize.";

  return {
    posture,
    headline,
    detail,
    counts: {
      projects: projects.length,
      activeProjects,
      plans: plans.length,
      plansNeedingSetup,
      programs: programs.length,
      activePrograms,
      reports: reports.length,
      reportRefreshRecommended,
      reportNoPacket,
      reportPacketCurrent,
      rtpFundingReviewPackets,
      rtpReviewLoopOpenPackets,
      comparisonBackedReports,
      fundingOpportunities: fundingOpportunities.length,
      openFundingOpportunities,
      closingSoonFundingOpportunities,
      overdueDecisionFundingOpportunities: overdueDecisionOpportunities.length,
      projectFundingNeedAnchorProjects: projectFundingNeedAnchorProjects.length,
      projectFundingSourcingProjects: fundingSourcingProjects.length,
      projectFundingDecisionProjects: fundingDecisionProjects.length,
      projectFundingAwardRecordProjects: fundingAwardRecordProjects.length,
      projectFundingReimbursementStartProjects: reimbursementStartProjects.length,
      projectFundingReimbursementActiveProjects: reimbursementAdvanceProjects.length,
      projectFundingGapProjects: fundingGapProjects.length,
      queueDepth: fullCommandQueue.length,
      aerialMissions: aerialPosture?.missionCount ?? 0,
      aerialActiveMissions: aerialPosture?.activeMissionCount ?? 0,
      aerialReadyPackages: aerialPosture?.readyPackageCount ?? 0,
    },
    grantModelingSummary,
    aerialPosture: aerialPosture ?? null,
    moduleObservations,
    nextCommand,
    commandQueue,
    fullCommandQueue,
  };
}
