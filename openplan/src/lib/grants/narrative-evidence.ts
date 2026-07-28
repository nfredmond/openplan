/**
 * Opportunity evidence assembly for grounded grant drafting.
 *
 * Extracted verbatim from the narrative-draft route so ONE code path builds
 * the workspace evidence bundle (project + funding stack + modeling digest +
 * screening BCA + engagement synthesis + Knowledge Base excerpts) and ONE
 * code path turns it into the numbered [fact:N] list the grounding contract
 * validates against. The whole-opportunity narrative route and the
 * per-section application drafting route both consume this module, so facts
 * are always REBUILT FRESH from live workspace evidence at generation time —
 * a revision can restyle prose, but it can never smuggle a claim, because the
 * citable fact list is recomputed here on every call and validated
 * deterministically afterwards.
 *
 * Everything here mirrors what the grants page computes; no new claims are
 * invented, and every modeling/BCA/engagement/KB fact carries its caveat
 * verbatim inside the claim text.
 */

import {
  GRANT_MODELING_PLANNING_CAVEAT,
  buildProjectGrantModelingEvidenceByProjectId,
  describeProjectGrantModelingReadiness,
  type ProjectGrantModelingArtifactRow,
  type ProjectGrantModelingEvidence,
  type ProjectGrantModelingReportRow,
} from "@/lib/grants/modeling-evidence";
import {
  buildGrantEvidenceReadinessCues,
  summarizeGrantEvidenceReadiness,
} from "@/lib/grants/evidence-readiness";
import {
  buildBcaScreeningFactClaims,
  buildLatestBcaScreeningByProjectId,
  type ProjectBcaScreeningRowLike,
  type ProjectBcaScreeningSummary,
} from "@/lib/grants/bca-evidence";
import {
  buildEngagementFactClaims,
  buildProjectEngagementEvidenceByProjectId,
  type ProjectEngagementCampaignRowLike,
  type ProjectEngagementEvidence,
} from "@/lib/grants/engagement-evidence";
import {
  buildProjectFundingStackSummary,
  type FundingAwardLike,
  type FundingOpportunityLike,
  type ProjectFundingProfileLike,
  type ProjectFundingStackSummary,
} from "@/lib/projects/funding";
import {
  retrieveKnowledgeBaseExcerpts,
  type KnowledgeBaseExcerpt,
} from "@/lib/knowledge-base/retrieval";
import { buildKnowledgeBaseFactClaims } from "@/lib/grants/kb-evidence";
import {
  buildNarrativeFactList,
  type NarrativeFact,
} from "@/lib/grants/narrative-grounding";
import type { GrantApplicationEvidenceKind } from "@/lib/grants/program-catalog";

/** Fields of the funding-opportunity row the evidence assembly reads. */
export type NarrativeEvidenceOpportunity = {
  id: string;
  workspace_id: string;
  program_id: string | null;
  project_id: string | null;
  title?: string | null;
  opportunity_status?: string | null;
  decision_state?: string | null;
  agency_name?: string | null;
  expected_award_amount?: number | string | null;
  closes_at?: string | null;
  decision_due_at?: string | null;
  fit_notes?: string | null;
  readiness_notes?: string | null;
  decision_rationale?: string | null;
  summary?: string | null;
  /**
   * Pursuit context (migration 20260727000015). Absent or 'grant' means the
   * grant behavior that predates proposals — callers that never load the
   * pursuit columns keep exactly their old fact lists.
   */
  pursuit_kind?: string | null;
  solicitation_number?: string | null;
  submission_format_note?: string | null;
  questions_due_at?: string | null;
};

/** Linked-project stage/delivery detail (proposal schedule facts). */
export type NarrativeLinkedProjectStage = {
  name: string;
  status: string | null;
  deliveryPhase: string | null;
};

/** One completed project offered as past-performance evidence (proposals). */
export type NarrativeCompletedProject = {
  id: string;
  name: string;
  summary: string | null;
  deliveryPhase: string | null;
  updatedAt: string | null;
};

/** Everything the drafting prompts need, assembled from live workspace data. */
export type OpportunityEvidenceBundle = {
  opportunity: NarrativeEvidenceOpportunity;
  projectName: string | null;
  fundingSummary: ProjectFundingStackSummary | null;
  modelingEvidence: ProjectGrantModelingEvidence | null;
  modelingHeadline: string | null;
  modelingReadinessDetail: string | null;
  bcaScreening: ProjectBcaScreeningSummary | null;
  engagementEvidence: ProjectEngagementEvidence | null;
  evidenceReadinessSummary: string;
  kbExcerpts: KnowledgeBaseExcerpt[];
  /** Proposal pursuits only: the linked project's stage/delivery detail. */
  linkedProjectStage: NarrativeLinkedProjectStage | null;
  /**
   * Proposal pursuits only: the workspace's completed-projects history, as
   * past-performance evidence. Null for grant pursuits AND when the read
   * failed — absence of facts is honest degradation, never an invented claim.
   */
  completedProjects: NarrativeCompletedProject[] | null;
};

export type OpportunityEvidenceOptions = {
  /**
   * Extra retrieval hint appended to the Knowledge Base query (e.g. an
   * application section's title and guidance) so per-section drafting
   * surfaces documents matching the section's topic. Retrieval steering
   * only — guidance never becomes a citable fact.
   */
  knowledgeBaseQueryHint?: string | null;
};

type QueryError = { message: string } | null;
type QueryResultLike = PromiseLike<{ data: unknown; error: QueryError }>;
type QueryBuilderLike = QueryResultLike & {
  select: (columns: string) => QueryBuilderLike;
  eq: (column: string, value: unknown) => QueryBuilderLike;
  neq: (column: string, value: unknown) => QueryBuilderLike;
  in: (column: string, values: unknown[]) => QueryBuilderLike;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilderLike;
  limit: (count: number) => QueryBuilderLike;
  maybeSingle: () => PromiseLike<{ data: unknown; error: QueryError }>;
};
type SupabaseQueryClientLike = { from: (table: string) => QueryBuilderLike };

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function fundingSummaryClaims(
  summary: ProjectFundingStackSummary,
  projectName: string | null
): string[] {
  const projectLabel = projectName ?? "The linked project";
  return [
    `${projectLabel} funding posture: ${summary.label} — ${summary.reason}`,
    `${projectLabel} pipeline posture: ${summary.pipelineLabel} — ${summary.pipelineReason}`,
    summary.hasTargetNeed ? `${projectLabel} funding need: ${formatAmount(summary.fundingNeedAmount)}` : null,
    summary.localMatchNeedAmount > 0
      ? `${projectLabel} local match need: ${formatAmount(summary.localMatchNeedAmount)}`
      : null,
    `${projectLabel} committed award dollars: ${formatAmount(summary.committedFundingAmount)} across ${summary.awardCount} award record(s)`,
    `${projectLabel} pursued (likely) opportunity dollars: ${formatAmount(summary.likelyFundingAmount)} across ${summary.pursuedOpportunityCount} pursued opportunit(ies)`,
    `${projectLabel} remaining gap after committed + pursued dollars: ${formatAmount(summary.unfundedAfterLikelyAmount)}`,
    `${projectLabel} reimbursement posture: ${summary.reimbursementLabel} — ${summary.reimbursementReason}`,
  ].filter((claim): claim is string => claim !== null);
}

/**
 * Load the linked project's funding summary + deterministic modeling, BCA,
 * engagement, and Knowledge Base evidence for one opportunity, mirroring what
 * the grants page computes. Read-only; every query is scoped to the
 * opportunity's own project and workspace through the caller's RLS-scoped
 * client.
 */
export async function assembleOpportunityEvidence(
  supabase: unknown,
  opportunity: NarrativeEvidenceOpportunity,
  options?: OpportunityEvidenceOptions
): Promise<OpportunityEvidenceBundle> {
  const client = supabase as SupabaseQueryClientLike;
  const isProposal = opportunity.pursuit_kind === "proposal";

  let projectName: string | null = null;
  let fundingSummary: ProjectFundingStackSummary | null = null;
  let modelingReadinessDetail: string | null = null;
  let modelingHeadline: string | null = null;
  let modelingEvidence: ProjectGrantModelingEvidence | null = null;
  let bcaScreening: ProjectBcaScreeningSummary | null = null;
  let engagementEvidence: ProjectEngagementEvidence | null = null;
  let linkedProjectStage: NarrativeLinkedProjectStage | null = null;
  let completedProjects: NarrativeCompletedProject[] | null = null;

  if (opportunity.project_id) {
    const [
      projectResult,
      profileResult,
      awardsResult,
      projectOpportunitiesResult,
      invoicesResult,
      reportsResult,
      bcaScreeningsResult,
      engagementCampaignsResult,
    ] = await Promise.all([
      client
        .from("projects")
        .select("id, name, status, delivery_phase")
        .eq("id", opportunity.project_id)
        .maybeSingle(),
      client
        .from("project_funding_profiles")
        .select("project_id, funding_need_amount, local_match_need_amount, notes, updated_at")
        .eq("project_id", opportunity.project_id)
        .maybeSingle(),
      client
        .from("funding_awards")
        .select("id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
        .eq("project_id", opportunity.project_id),
      client
        .from("funding_opportunities")
        .select("id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
        .eq("project_id", opportunity.project_id),
      client
        .from("billing_invoice_records")
        .select("id, funding_award_id, status, due_date, amount, retention_percent, retention_amount, net_amount")
        .eq("project_id", opportunity.project_id),
      client
        .from("reports")
        .select("id, project_id, title, updated_at, generated_at, latest_artifact_kind")
        .eq("project_id", opportunity.project_id)
        .order("updated_at", { ascending: false }),
      client
        .from("project_bca_screenings")
        .select("id, project_id, result_json, engine_version, created_at")
        .eq("project_id", opportunity.project_id)
        .order("created_at", { ascending: false })
        .limit(5),
      client
        .from("engagement_campaigns")
        .select(
          "id, project_id, title, status, updated_at, ai_synthesis_json, ai_synthesized_at, representativeness_json, representativeness_computed_at"
        )
        .eq("project_id", opportunity.project_id)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(20),
    ]);

    const projectRow = projectResult.data as {
      id: string;
      name: string;
      status?: unknown;
      delivery_phase?: unknown;
    } | null;
    projectName = projectRow?.name ?? null;
    if (isProposal && projectRow) {
      linkedProjectStage = {
        name: projectRow.name,
        status: typeof projectRow.status === "string" ? projectRow.status : null,
        deliveryPhase:
          typeof projectRow.delivery_phase === "string" ? projectRow.delivery_phase : null,
      };
    }

    type NarrativeInvoiceRow = {
      funding_award_id: string | null;
      status: string | null;
      due_date: string | null;
      amount: number | string | null;
      retention_percent: number | string | null;
      retention_amount: number | string | null;
      net_amount: number | string | null;
    };
    const awardLinkedInvoices = ((invoicesResult.data ?? []) as NarrativeInvoiceRow[]).filter(
      (invoice) => Boolean(invoice.funding_award_id)
    );

    fundingSummary = buildProjectFundingStackSummary(
      (profileResult.data ?? null) as ProjectFundingProfileLike | null,
      (awardsResult.data ?? []) as FundingAwardLike[],
      (projectOpportunitiesResult.data ?? []) as FundingOpportunityLike[],
      awardLinkedInvoices
    );

    const reports = (reportsResult.data ?? []) as ProjectGrantModelingReportRow[];
    const reportIds = reports.map((report) => report.id);
    const { data: artifactsData } = reportIds.length
      ? await client
          .from("report_artifacts")
          .select("report_id, generated_at, metadata_json")
          .in("report_id", reportIds)
          .order("generated_at", { ascending: false })
      : { data: [] };

    modelingEvidence =
      buildProjectGrantModelingEvidenceByProjectId(
        reports,
        (artifactsData ?? []) as ProjectGrantModelingArtifactRow[]
      ).get(opportunity.project_id) ?? null;

    const readiness = describeProjectGrantModelingReadiness(modelingEvidence);
    modelingReadinessDetail = readiness ? `${readiness.label}: ${readiness.detail}` : null;
    modelingHeadline = modelingEvidence
      ? `${modelingEvidence.leadComparisonReport.title} — ${modelingEvidence.leadComparisonReport.comparisonDigest.headline}. ${modelingEvidence.leadComparisonReport.comparisonDigest.detail}`
      : null;

    bcaScreening =
      buildLatestBcaScreeningByProjectId(
        (bcaScreeningsResult.data ?? []) as ProjectBcaScreeningRowLike[]
      ).get(opportunity.project_id) ?? null;

    engagementEvidence =
      buildProjectEngagementEvidenceByProjectId(
        (engagementCampaignsResult.data ?? []) as ProjectEngagementCampaignRowLike[]
      ).get(opportunity.project_id) ?? null;
  }

  // Proposal pursuits ground past-performance claims on the workspace's
  // completed-projects history. A failed read leaves completedProjects null —
  // the model then simply has no past-performance facts to cite.
  if (isProposal) {
    const { data: completedRows, error: completedError } = await client
      .from("projects")
      .select("id, name, summary, delivery_phase, updated_at")
      .eq("workspace_id", opportunity.workspace_id)
      .eq("status", "complete")
      .order("updated_at", { ascending: false })
      .limit(10);

    if (!completedError) {
      completedProjects = ((completedRows ?? []) as Array<Record<string, unknown>>).flatMap(
        (row) =>
          typeof row.id === "string" && typeof row.name === "string"
            ? [
                {
                  id: row.id,
                  name: row.name,
                  summary: typeof row.summary === "string" && row.summary.trim() ? row.summary : null,
                  deliveryPhase:
                    typeof row.delivery_phase === "string" ? row.delivery_phase : null,
                  updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
                },
              ]
            : []
      );
    }
  }

  const evidenceCues = buildGrantEvidenceReadinessCues(
    {
      fit_notes: opportunity.fit_notes ?? null,
      readiness_notes: opportunity.readiness_notes ?? null,
      decision_rationale: opportunity.decision_rationale ?? null,
      expected_award_amount: opportunity.expected_award_amount ?? null,
      project_id: opportunity.project_id ?? null,
      program_id: opportunity.program_id ?? null,
      closes_at: opportunity.closes_at ?? null,
      decision_due_at: opportunity.decision_due_at ?? null,
    },
    modelingEvidence,
    bcaScreening,
    engagementEvidence
  );
  const evidenceReadinessSummary = summarizeGrantEvidenceReadiness(evidenceCues);

  // Knowledge Base excerpts: keyword-match the opportunity + project context
  // against the workspace's uploaded documents so the narrative can cite them.
  // Best-effort — retrieval returns [] if the KB schema/RPC is unavailable.
  const knowledgeBaseQuery = [
    opportunity.title,
    opportunity.summary,
    opportunity.fit_notes,
    projectName,
    options?.knowledgeBaseQueryHint,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(". ");
  const kbExcerpts = await retrieveKnowledgeBaseExcerpts({
    supabase,
    workspaceId: opportunity.workspace_id,
    projectId: opportunity.project_id ?? null,
    query: knowledgeBaseQuery,
    limit: 4,
  });

  return {
    opportunity,
    projectName,
    fundingSummary,
    modelingEvidence,
    modelingHeadline,
    modelingReadinessDetail,
    bcaScreening,
    engagementEvidence,
    evidenceReadinessSummary,
    kbExcerpts,
    linkedProjectStage,
    completedProjects,
  };
}

export type OpportunityFactListOptions = {
  /**
   * Evidence families to scope the fact list to (a catalog section's
   * suggestedEvidence). Omitted or empty means the FULL list — scoping only
   * narrows which claims are citable for a focused section; the opportunity
   * identity anchors and the deterministic readiness guardrail are always
   * included. Facts outside the scope simply cannot be cited, and any
   * sentence asserting them is flagged by the grounding validator.
   */
  suggestedEvidence?: readonly GrantApplicationEvidenceKind[];
};

/**
 * Build the numbered fact list (fact_1..fact_N): every workspace-specific
 * claim the model is allowed to state, in citable form. The generated
 * narrative must cite these with inline [fact:N] tokens; citations are
 * validated deterministically after generation (planner-pack grounding
 * contract). Deterministic over the bundle — same evidence in, same facts
 * out.
 */
export function buildOpportunityFactList(
  bundle: OpportunityEvidenceBundle,
  options?: OpportunityFactListOptions
): NarrativeFact[] {
  const scope = new Set(options?.suggestedEvidence ?? []);
  const include = (kind: GrantApplicationEvidenceKind) => scope.size === 0 || scope.has(kind);

  const { opportunity } = bundle;
  const isProposal = opportunity.pursuit_kind === "proposal";
  const hasModelingEvidence = Boolean(bundle.modelingHeadline && bundle.modelingReadinessDetail);

  return buildNarrativeFactList([
    `The funding opportunity is titled "${opportunity.title}"${opportunity.agency_name ? `, administered by ${opportunity.agency_name}` : ""}.`,
    `The opportunity status is "${opportunity.opportunity_status}" and the workspace decision posture is "${opportunity.decision_state}".`,
    // Proposal solicitation anchors: identity facts, always included for a
    // proposal pursuit regardless of a section's evidence scope.
    isProposal && opportunity.solicitation_number
      ? `The solicitation number on record for this pursuit is "${opportunity.solicitation_number}".`
      : null,
    isProposal && opportunity.submission_format_note
      ? `Submission format note on record (verify against the current solicitation): ${opportunity.submission_format_note}`
      : null,
    isProposal && opportunity.questions_due_at
      ? `Written questions to the issuing agency are due ${String(opportunity.questions_due_at).slice(0, 10)}.`
      : null,
    isProposal && include("project") && bundle.linkedProjectStage
      ? `The linked project ${bundle.linkedProjectStage.name} is recorded in status "${bundle.linkedProjectStage.status ?? "unknown"}"${bundle.linkedProjectStage.deliveryPhase ? ` and delivery phase "${bundle.linkedProjectStage.deliveryPhase}"` : ""}.`
      : null,
    ...(isProposal && include("project") && bundle.completedProjects
      ? bundle.completedProjects.map(
          (project) =>
            `Completed project on record (past performance): ${project.name}${project.summary ? ` — ${project.summary}` : ""}${project.deliveryPhase ? ` (delivery phase: ${project.deliveryPhase})` : ""}.`
        )
      : []),
    include("funding") && opportunity.expected_award_amount != null
      ? `The expected award amount recorded for this opportunity is ${formatAmount(Number(opportunity.expected_award_amount))}.`
      : null,
    include("project") && opportunity.summary ? `Opportunity summary on record: ${opportunity.summary}` : null,
    include("project") && opportunity.fit_notes
      ? `Funding-source fit notes on record: ${opportunity.fit_notes}`
      : null,
    include("project") && opportunity.readiness_notes
      ? `Readiness notes on record: ${opportunity.readiness_notes}`
      : null,
    include("project") && opportunity.decision_rationale
      ? `Decision rationale on record: ${opportunity.decision_rationale}`
      : null,
    ...(include("funding") && bundle.fundingSummary
      ? fundingSummaryClaims(bundle.fundingSummary, bundle.projectName)
      : []),
    include("modeling") && hasModelingEvidence
      ? `${bundle.modelingHeadline} ${GRANT_MODELING_PLANNING_CAVEAT}`
      : null,
    include("modeling") && hasModelingEvidence
      ? `Modeling evidence readiness: ${bundle.modelingReadinessDetail} ${GRANT_MODELING_PLANNING_CAVEAT}`
      : null,
    ...(include("bca") && bundle.bcaScreening
      ? buildBcaScreeningFactClaims(bundle.bcaScreening, bundle.projectName)
      : []),
    ...(include("engagement") && bundle.engagementEvidence
      ? buildEngagementFactClaims(bundle.engagementEvidence, bundle.projectName)
      : []),
    ...(include("kb") ? buildKnowledgeBaseFactClaims(bundle.kbExcerpts, bundle.projectName) : []),
    `Evidence readiness (deterministic guardrail summary): ${bundle.evidenceReadinessSummary}`,
  ]);
}
