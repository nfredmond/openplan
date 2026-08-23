/**
 * Opportunity evidence assembly for grounded grant drafting.
 *
 * Extracted verbatim from the narrative-draft route so ONE code path builds
 * the workspace evidence bundle (project + funding stack + RTP/MTP programming
 * + modeling digest + screening BCA + engagement synthesis + Knowledge Base
 * excerpts) and ONE
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
  buildProjectGrantAerialOrthoEvidenceByProjectId,
  buildProjectGrantDualDemandAgreementEvidenceByProjectId,
  buildProjectGrantModelingEvidenceByProjectId,
  describeProjectGrantModelingReadiness,
  type ProjectGrantModelingArtifactRow,
  type ProjectGrantModelingEvidence,
  type ProjectGrantModelingReportRow,
  type ProjectGrantDualDemandAgreementEvidence,
  type ProjectGrantAerialOrthoEvidence,
} from "@/lib/grants/modeling-evidence";
import {
  AGREEMENT_METHOD_SENSITIVITY_STATEMENT,
  AGREEMENT_NO_AVERAGE_STATEMENT,
} from "@/lib/models/verified-dual-demand-agreement";
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
  DEFAULT_CRASH_PROXIMITY_METERS,
  readNearbyCrashes,
  summarizeCampaignCorroboration,
  type NearbyCrashRow,
} from "@/lib/engagement/crash-corroboration";
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
import { formatMoney } from "@/lib/money/format";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

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

/** Linked-project identity/stage detail (all pursuit kinds). */
export type NarrativeLinkedProjectStage = {
  name: string;
  status: string | null;
  deliveryPhase: string | null;
  summary: string | null;
};

/**
 * One RTP/MTP cycle the linked project is recorded in, as programming FACTS the
 * drafter may cite. Every field is read verbatim off the workspace's own rows
 * (the project↔cycle link, the cycle, and the horizon band it points at) —
 * nothing here is inferred, because "this project is in the fiscally
 * constrained plan" is a scored criterion in most federal programs and a wrong
 * claim about it is a misrepresentation to a funder.
 */
export type NarrativeRtpProgrammingLink = {
  /** The cycle's own title, e.g. "2050 Regional Transportation Plan". */
  cycleTitle: string;
  /** The cycle's recorded status: draft | public_review | adopted | archived. */
  cycleStatus: string | null;
  horizonStartYear: number | null;
  horizonEndYear: number | null;
  /** The cycle's recorded adoption target date (YYYY-MM-DD), when present. */
  adoptionTargetDate: string | null;
  /** The link row's recorded role: candidate | constrained | illustrative. */
  portfolioRole: string | null;
  /** The linked horizon band's own label, when the link names a band. */
  horizonBandLabel: string | null;
};

/** One completed project offered as past-performance evidence (proposals). */
export type NarrativeCompletedProject = {
  id: string;
  name: string;
  summary: string | null;
  deliveryPhase: string | null;
  updatedAt: string | null;
};

/**
 * One read that FAILED while assembling the bundle.
 *
 * `subject` names what could not be read, in the words a planner would use for
 * it, because the caller renders it. `message` is the database's own words, for
 * the caller's audit line.
 */
export type NarrativeEvidenceReadFailure = {
  subject: string;
  message: string;
};

/** Everything the drafting prompts need, assembled from live workspace data. */
export type OpportunityEvidenceBundle = {
  opportunity: NarrativeEvidenceOpportunity;
  projectName: string | null;
  fundingSummary: ProjectFundingStackSummary | null;
  modelingEvidence: ProjectGrantModelingEvidence | null;
  modelingHeadline: string | null;
  modelingReadinessDetail: string | null;
  dualDemandAgreementEvidence?: ProjectGrantDualDemandAgreementEvidence | null;
  aerialOrthoEvidence?: ProjectGrantAerialOrthoEvidence | null;
  bcaScreening: ProjectBcaScreeningSummary | null;
  engagementEvidence: ProjectEngagementEvidence | null;
  evidenceReadinessSummary: string;
  kbExcerpts: KnowledgeBaseExcerpt[];
  /** The linked project's identity/stage detail, when a project is linked. */
  linkedProjectStage: NarrativeLinkedProjectStage | null;
  /**
   * The linked project's RTP/MTP programming record, newest link first.
   *
   * `[]` means the reads SUCCEEDED and the project is linked to no cycle — a
   * citable absence the fact list states explicitly, because a drafter told
   * nothing would otherwise be free to imply programming that does not exist.
   * `null` means either no project is linked (nothing to say) or a read in
   * this family failed — and every such failure is reported in `readFailures`,
   * so a caller can never mistake "could not read the programming record" for
   * "no programming recorded". The absence fact is emitted ONLY for `[]`.
   */
  rtpProgramming: NarrativeRtpProgrammingLink[] | null;
  /**
   * Proposal pursuits only: the workspace's completed-projects history, as
   * past-performance evidence. Null for grant pursuits AND when the read
   * failed — absence of facts is honest degradation, never an invented claim.
   * Null ALONE cannot tell those two apart, which is what `readFailures` below
   * is for: a failed read is reported there as well.
   */
  completedProjects: NarrativeCompletedProject[] | null;
  /**
   * Reads that FAILED while assembling this bundle, in the order attempted.
   * Empty means every read succeeded, so an empty evidence family really is
   * "nothing on record".
   *
   * THE SEAM, AND WHY IT IS RETURNED RATHER THAN SWALLOWED OR THROWN. Every
   * evidence family here is legitimately optional — a project with no
   * benefit-cost screening and no engagement campaign is an ordinary project —
   * and the drafting prompts turn that genuine absence into a literal
   * instruction to the model: "Do not reference community input, public
   * comments, or outreach results." A failed read produces the identical empty
   * value. A caller that cannot tell the two apart deletes an agency's Title VI
   * outreach record and its modeling evidence from a competitive federal grant
   * application, and nobody is told the read failed. So a non-empty list here
   * means UNKNOWN, not absent, and a caller that would otherwise instruct the
   * model to omit evidence must refuse to draft instead.
   *
   * Returning it (rather than throwing) is the seam this repo has settled on —
   * see `loadOpportunityPursuitContext` in `src/lib/grants/pursuit.ts` — so the
   * caller decides whether it is a page disclosure or a route status.
   */
  readFailures: NarrativeEvidenceReadFailure[];
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
  return formatMoney(value, { precision: "whole" });
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
 *
 * NEVER THROWS AND NEVER SWALLOWS. Every failed read is returned in
 * `readFailures` for the caller to surface. A caller whose prompt turns an
 * empty evidence family into "do not reference this evidence" MUST check that
 * list first — see the field's own note for what happens when it does not.
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
  let dualDemandAgreementEvidence: ProjectGrantDualDemandAgreementEvidence | null = null;
  let aerialOrthoEvidence: ProjectGrantAerialOrthoEvidence | null = null;
  let bcaScreening: ProjectBcaScreeningSummary | null = null;
  let engagementEvidence: ProjectEngagementEvidence | null = null;
  let linkedProjectStage: NarrativeLinkedProjectStage | null = null;
  let completedProjects: NarrativeCompletedProject[] | null = null;
  let rtpProgramming: NarrativeRtpProgrammingLink[] | null = null;

  // Every read below is checked through this, so an evidence family that comes
  // back empty is distinguishable from one that could not be read at all.
  const readFailures: NarrativeEvidenceReadFailure[] = [];
  const collectReadFailure = (subject: string, result: { error?: QueryError } | null | undefined) => {
    const error = result?.error;
    if (!error) return;
    const message = typeof error.message === "string" && error.message.trim() ? error.message.trim() : null;
    readFailures.push({ subject, message: message ?? "no message reported" });
  };

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
      rtpLinksResult,
    ] = await Promise.all([
      client
        .from("projects")
        .select("id, name, status, delivery_phase, summary")
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
        .eq("workspace_id", opportunity.workspace_id)
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
      client
        .from("project_rtp_cycle_links")
        .select("rtp_cycle_id, portfolio_role, horizon_band_id, created_at")
        .eq("project_id", opportunity.project_id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    collectReadFailure("the linked project", projectResult);
    collectReadFailure("the project's funding profile", profileResult);
    collectReadFailure("the project's funding awards", awardsResult);
    collectReadFailure("the project's other funding opportunities", projectOpportunitiesResult);
    collectReadFailure("the project's grant invoices", invoicesResult);
    collectReadFailure("the project's reports", reportsResult);
    collectReadFailure("the project's benefit-cost screenings", bcaScreeningsResult);
    collectReadFailure("the project's engagement campaigns", engagementCampaignsResult);
    collectReadFailure("the project's RTP programming record", rtpLinksResult);

    const projectRow = projectResult.data as {
      id: string;
      name: string;
      status?: unknown;
      delivery_phase?: unknown;
      summary?: unknown;
    } | null;
    projectName = projectRow?.name ?? null;
    if (projectRow) {
      linkedProjectStage = {
        name: projectRow.name,
        status: typeof projectRow.status === "string" ? projectRow.status : null,
        deliveryPhase:
          typeof projectRow.delivery_phase === "string" ? projectRow.delivery_phase : null,
        summary: typeof projectRow.summary === "string" && projectRow.summary.trim() ? projectRow.summary : null,
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
    const artifactsResult = reportIds.length
      ? await client
          .from("report_artifacts")
          .select("id, report_id, generated_at, metadata_json")
          .in("report_id", reportIds)
          .order("generated_at", { ascending: false })
      : { data: [], error: null };
    collectReadFailure("the project's report artifacts", artifactsResult);

    modelingEvidence =
      buildProjectGrantModelingEvidenceByProjectId(
        reports,
        (artifactsResult.data ?? []) as ProjectGrantModelingArtifactRow[]
      ).get(opportunity.project_id) ?? null;
    const dualDemandEvidenceResult = buildProjectGrantDualDemandAgreementEvidenceByProjectId(
      reports,
      (artifactsResult.data ?? []) as ProjectGrantModelingArtifactRow[],
    );
    dualDemandAgreementEvidence =
      dualDemandEvidenceResult.evidenceByProjectId.get(opportunity.project_id) ?? null;
    for (const failure of dualDemandEvidenceResult.readFailures) {
      readFailures.push({
        subject: "the project's frozen dual-model agreement evidence",
        message: `Report ${failure.reportId}: ${failure.reason}`,
      });
    }
    const aerialEvidenceResult = buildProjectGrantAerialOrthoEvidenceByProjectId(
      reports,
      (artifactsResult.data ?? []) as ProjectGrantModelingArtifactRow[],
    );
    aerialOrthoEvidence = aerialEvidenceResult.evidenceByProjectId.get(opportunity.project_id) ?? null;
    for (const failure of aerialEvidenceResult.readFailures) {
      readFailures.push({
        subject: "the project's frozen aerial orthophoto evidence",
        message: `Report ${failure.reportId}: ${failure.reason}`,
      });
    }

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

    // The engagement <-> safety reading, for the lead campaign only.
    //
    // A SECOND read rather than part of the batch above, because which campaign
    // leads is only known once the batch has been grouped. It is computed live:
    // there is no cache, and a planner who acquires crash data BECAUSE a
    // campaign raised a location needs the very next draft to reflect it.
    if (engagementEvidence) {
      // The assembler's contract is NEVER THROWS AND NEVER SWALLOWS, so a
      // client that cannot make this call at all becomes a reported failure
      // rather than an exception thrown through every other evidence family.
      //
      // `.then(() => call())` rather than `Promise.resolve(call())`: the latter
      // evaluates the call FIRST, so a client that throws synchronously throws
      // straight past the catch. Deferring it into the microtask turns both
      // kinds of failure into the same rejection.
      const corroborationResult = await Promise.resolve()
        .then(() =>
          readNearbyCrashes(
            client as unknown as Parameters<typeof readNearbyCrashes>[0],
            opportunity.workspace_id,
            engagementEvidence!.leadCampaign.id,
            DEFAULT_CRASH_PROXIMITY_METERS
          )
        )
        .catch((error: unknown) => ({
          data: null,
          error: { message: error instanceof Error ? error.message : "crash-proximity read threw" },
        }));

      const failureMessage = corroborationResult.error?.message ?? null;
      // A DEPLOYMENT THAT HAS NOT APPLIED 20260821000001 YET IS NOT A FAILURE.
      // PostgREST answers a missing function with "Could not find the function
      // … in the schema cache", and this route REFUSES TO DRAFT when any read
      // failed — so classifying that as a failure would break every grant
      // narrative on every deployment during its migrate window, to protect an
      // evidence family that deployment cannot have. It degrades to no reading:
      // nothing false is stated, the same as a workspace that has acquired no
      // crash data.
      if (corroborationResult.error && !looksLikePendingSchema(failureMessage)) {
        collectReadFailure(
          "reported collisions near the lead engagement campaign's mapped comments",
          corroborationResult as { error?: QueryError }
        );
      }
      // Left null on any error, and a genuine failure is recorded above — a
      // caller that cannot tell "no collisions acquired" from "could not read"
      // would draft a grant that silently drops this evidence family.
      if (!corroborationResult.error) {
        engagementEvidence.leadCampaign.crashCorroboration = summarizeCampaignCorroboration(
          (corroborationResult.data ?? []) as NearbyCrashRow[],
          DEFAULT_CRASH_PROXIMITY_METERS
        );
      }
    }

    // RTP/MTP programming: resolve each link row's cycle (title/status/horizon)
    // and horizon band (label) so the facts can name them. Any failure in this
    // family leaves rtpProgramming null WITH the failure reported above/below —
    // only a fully successful read may claim "[]", because [] becomes the
    // explicit "no programming recorded" fact.
    type RtpLinkRow = {
      rtp_cycle_id: string | null;
      portfolio_role: string | null;
      horizon_band_id: string | null;
    };
    if (!rtpLinksResult.error) {
      const rtpLinkRows = ((rtpLinksResult.data ?? []) as RtpLinkRow[]).filter(
        (row) => typeof row.rtp_cycle_id === "string"
      );
      if (rtpLinkRows.length === 0) {
        rtpProgramming = [];
      } else {
        const cycleIds = Array.from(new Set(rtpLinkRows.map((row) => row.rtp_cycle_id as string)));
        const bandIds = Array.from(
          new Set(
            rtpLinkRows.flatMap((row) =>
              typeof row.horizon_band_id === "string" ? [row.horizon_band_id] : []
            )
          )
        );
        const [cyclesResult, bandsResult] = await Promise.all([
          client
            .from("rtp_cycles")
            .select("id, title, status, horizon_start_year, horizon_end_year, adoption_target_date")
            .in("id", cycleIds),
          bandIds.length
            ? client.from("rtp_horizon_bands").select("id, label").in("id", bandIds)
            : { data: [], error: null },
        ]);
        collectReadFailure("the RTP cycles the project is programmed in", cyclesResult);
        collectReadFailure("the RTP horizon bands the project is programmed in", bandsResult);

        if (!cyclesResult.error && !bandsResult.error) {
          type RtpCycleRow = {
            id: string;
            title?: unknown;
            status?: unknown;
            horizon_start_year?: unknown;
            horizon_end_year?: unknown;
            adoption_target_date?: unknown;
          };
          type RtpBandRow = { id: string; label?: unknown };
          const cyclesById = new Map(
            ((cyclesResult.data ?? []) as RtpCycleRow[]).map((row) => [row.id, row] as const)
          );
          const bandLabelsById = new Map(
            ((bandsResult.data ?? []) as RtpBandRow[]).map(
              (row) => [row.id, typeof row.label === "string" ? row.label : null] as const
            )
          );
          rtpProgramming = rtpLinkRows.flatMap((row) => {
            const cycle = cyclesById.get(row.rtp_cycle_id as string);
            // A link whose cycle row did not come back cannot be stated as a
            // fact about a named plan; the cycle FK cascades on delete, so this
            // is a should-not-happen edge, dropped rather than half-invented.
            if (!cycle || typeof cycle.title !== "string") return [];
            return [
              {
                cycleTitle: cycle.title,
                cycleStatus: typeof cycle.status === "string" ? cycle.status : null,
                horizonStartYear:
                  typeof cycle.horizon_start_year === "number" ? cycle.horizon_start_year : null,
                horizonEndYear:
                  typeof cycle.horizon_end_year === "number" ? cycle.horizon_end_year : null,
                adoptionTargetDate:
                  typeof cycle.adoption_target_date === "string"
                    ? cycle.adoption_target_date.slice(0, 10)
                    : null,
                portfolioRole: typeof row.portfolio_role === "string" ? row.portfolio_role : null,
                horizonBandLabel:
                  typeof row.horizon_band_id === "string"
                    ? bandLabelsById.get(row.horizon_band_id) ?? null
                    : null,
              },
            ];
          });
        }
      }
    }
  }

  // Proposal pursuits ground past-performance claims on the workspace's
  // completed-projects history. A failed read leaves completedProjects null AND
  // is reported in readFailures — null alone reads as "this workspace has
  // completed nothing", which is the claim a caller must not make on a failure.
  if (isProposal) {
    const { data: completedRows, error: completedError } = await client
      .from("projects")
      .select("id, name, summary, delivery_phase, updated_at")
      .eq("workspace_id", opportunity.workspace_id)
      .eq("status", "complete")
      .order("updated_at", { ascending: false })
      .limit(10);

    collectReadFailure("the workspace's completed projects", { error: completedError });
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
    dualDemandAgreementEvidence,
    aerialOrthoEvidence,
    bcaScreening,
    engagementEvidence,
    evidenceReadinessSummary,
    kbExcerpts,
    linkedProjectStage,
    completedProjects,
    rtpProgramming,
    readFailures,
  };
}

/**
 * The recorded portfolio role, glossed in the words a reviewer scores against.
 * An unknown role is stated verbatim rather than glossed — never upgraded.
 */
function describeRtpPortfolioRole(role: string | null): string {
  if (role === "constrained") {
    return `recorded with portfolio role "constrained" (on the fiscally constrained project list)`;
  }
  if (role === "illustrative") {
    return `recorded with portfolio role "illustrative" (an unconstrained/illustrative project, NOT part of the fiscally constrained list)`;
  }
  if (role === "candidate") {
    return `recorded with portfolio role "candidate" (not yet assigned to the constrained or illustrative list)`;
  }
  return role
    ? `recorded with portfolio role "${role}"`
    : "recorded with no portfolio role";
}

/** One citable claim per RTP/MTP cycle the project is recorded in. */
function rtpProgrammingClaims(
  links: NarrativeRtpProgrammingLink[],
  projectName: string | null
): string[] {
  const projectLabel = projectName ?? "The linked project";
  return links.map((link) => {
    const parts = [
      `${projectLabel} is listed in the regional transportation plan cycle "${link.cycleTitle}"${link.cycleStatus ? ` (cycle status "${link.cycleStatus}")` : ""}, ${describeRtpPortfolioRole(link.portfolioRole)}`,
    ];
    if (link.horizonStartYear != null && link.horizonEndYear != null) {
      parts.push(`plan horizon ${link.horizonStartYear}–${link.horizonEndYear}`);
    }
    if (link.horizonBandLabel) {
      parts.push(`programmed in the "${link.horizonBandLabel}" horizon band`);
    }
    if (link.adoptionTargetDate && link.cycleStatus !== "adopted") {
      parts.push(`recorded adoption target date ${link.adoptionTargetDate}`);
    }
    return `${parts.join("; ")}.`;
  });
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
  const dualDemandAgreementClaims = bundle.dualDemandAgreementEvidence
    ? bundle.dualDemandAgreementEvidence.leadReport.agreements.flatMap((agreement) => [
        `Frozen dual-model agreement aggregate from report "${bundle.dualDemandAgreementEvidence?.leadReport.title}" and source run ${agreement.modelRunId}: ${agreement.methods.first} compared with ${agreement.methods.second}; ${agreement.aggregate.linksCompared} links compared; ${agreement.aggregate.linksCarryingMeaningfulTraffic} carried meaningful traffic; meaningful-link agreement share ${agreement.aggregate.agreeShareMeaningfulLinks === null ? "not available" : `${(agreement.aggregate.agreeShareMeaningfulLinks * 100).toFixed(1)}%`}; median meaningful-link GEH ${agreement.aggregate.medianGehMeaningfulLinks ?? "not available"}; attribution scale ${agreement.permittedAttributionScale}. Packet freshness: ${bundle.dualDemandAgreementEvidence?.leadReport.packetFreshness.label} — ${bundle.dualDemandAgreementEvidence?.leadReport.packetFreshness.detail} ${AGREEMENT_METHOD_SENSITIVITY_STATEMENT} ${AGREEMENT_NO_AVERAGE_STATEMENT}`,
        ...agreement.namedCorridors.map((corridor) =>
          `Planner-selected corridor evidence frozen in report "${bundle.dualDemandAgreementEvidence?.leadReport.title}": ${corridor.corridor}; ${agreement.methods.first} volume ${corridor.firstVolume}; ${agreement.methods.second} volume ${corridor.secondVolume}; GEH ${corridor.geh}; classification ${corridor.classification}; source run ${agreement.modelRunId}; attribution scale ${agreement.permittedAttributionScale}. Packet freshness: ${bundle.dualDemandAgreementEvidence?.leadReport.packetFreshness.label} — ${bundle.dualDemandAgreementEvidence?.leadReport.packetFreshness.detail} ${AGREEMENT_METHOD_SENSITIVITY_STATEMENT} ${AGREEMENT_NO_AVERAGE_STATEMENT}`
        ),
      ])
    : [];
  const aerialOrthoClaims = bundle.aerialOrthoEvidence
    ? bundle.aerialOrthoEvidence.leadReport.snapshots.map((snapshot) => {
        const [west, south, east, north] = snapshot.bounds;
        return `Planner-selected orthophoto evidence frozen in report "${bundle.aerialOrthoEvidence?.leadReport.title}": mission ${snapshot.missionTitle}; captured ${snapshot.collectedAt ?? "not recorded"}; held ${snapshot.heldAt ?? "not recorded"}; frozen ${snapshot.frozenAt}; resolution ${snapshot.pixelSizeM === null ? "not recorded" : `${snapshot.pixelSizeM} meters per pixel`}; map placement west ${west}, south ${south}, east ${east}, north ${north}; source SHA-256 ${snapshot.sourceChecksumSha256}; frozen SHA-256 ${snapshot.frozenChecksumSha256}. Packet freshness: ${bundle.aerialOrthoEvidence?.leadReport.packetFreshness.label} — ${bundle.aerialOrthoEvidence?.leadReport.packetFreshness.detail} ${snapshot.caveat}`;
      })
    : [];

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
    include("project") && bundle.linkedProjectStage
      ? `The linked project ${bundle.linkedProjectStage.name} is recorded in status "${bundle.linkedProjectStage.status ?? "unknown"}"${bundle.linkedProjectStage.deliveryPhase ? ` and delivery phase "${bundle.linkedProjectStage.deliveryPhase}"` : ""}.`
      : null,
    include("project") && bundle.linkedProjectStage?.summary
      ? `The linked project's recorded summary: ${bundle.linkedProjectStage.summary}`
      : null,
    // RTP/MTP programming: citable under both the project and funding families,
    // because plan consistency is scored in readiness sections and fiscal
    // constraint in funding sections. `null` (no project linked, or a failed
    // read already reported in readFailures) yields NO fact either way — a
    // failed read may never be stated as "no programming recorded".
    ...((include("project") || include("funding")) && bundle.rtpProgramming
      ? bundle.rtpProgramming.length > 0
        ? rtpProgrammingClaims(bundle.rtpProgramming, bundle.projectName)
        : [
            `No regional transportation plan (RTP/MTP) programming is on record for ${bundle.projectName ?? "the linked project"} — the project is not listed in any RTP/MTP cycle in this workspace.`,
          ]
      : []),
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
    ...(include("modeling") ? dualDemandAgreementClaims : []),
    ...(include("project") ? aerialOrthoClaims : []),
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
