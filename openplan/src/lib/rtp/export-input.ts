/**
 * ONE place that decides what an exported RTP document contains.
 *
 * WHY THIS FILE EXISTS. Two routes render an RTP with the same builder: the
 * report-generate route (the board packet) and the cycle export route (the
 * "Export HTML/PDF" button a planner clicks). They were written years apart,
 * and the packet route passed TEN options while the export route passed three.
 * The difference was invisible on both documents — `resolveEnabledSectionKeys`
 * treats an absent section list as "every section", and the section builders
 * returned an empty string when their data was absent — so the planner's export
 * printed a heading's worth of nothing exactly where the packet had content,
 * and neither document said they differed. Two people comparing them were
 * looking at different plans.
 *
 * Copying the missing options across would have made them agree today and
 * diverge on the next addition, which is how they got here in the first place.
 * CLAUDE.md's rule is the one that applies: a shared capability that lives
 * inside one of its two callers gets reimplemented wrongly by the other.
 *
 * THE STRUCTURAL PART, which is the whole point. `RtpExportOptions`
 * (`./export`) declares every option as a REQUIRED field, and this module is
 * the only place in the repository that builds one. Adding an option to the
 * exported document therefore fails the build HERE — at the single site both
 * routes read from — instead of type-checking happily in one route and being
 * forgotten in the other. Neither route may construct the options bag itself;
 * both consume `RtpCycleExportInputResult.document` whole.
 *
 * The loader neither swallows nor throws, following the seam
 * `loadRtpFinancialElement` already uses: it hands a classified refusal up and
 * the ROUTE answers it. A count derived from a read that failed is a falsehood
 * no downstream reader can see the gap in, because zero looks exactly like
 * zero — and both of these documents are read by boards.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { loadCountyRunModelingEvidence } from "@/lib/models/evidence-backbone";
import type { ReportModelingEvidence } from "@/lib/reports/modeling-evidence";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import {
  buildPortfolioFundingSnapshot,
  buildProjectFundingProfileScan,
  buildProjectFundingSnapshot,
  buildProjectFundingStackSummary,
} from "@/lib/projects/funding";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  buildRtpPublicReviewSummary,
  type RtpPacketRecordKnowledge,
} from "@/lib/rtp/catalog";
import {
  buildRtpExportHtml,
  DEFAULT_RTP_EXPORT_SECTION_KEYS,
  normalizeRtpLinkedProjects,
  type RtpExportCampaign,
  type RtpExportChapter,
  type RtpExportCycle,
  type RtpExportDocumentInput,
  type RtpExportFundingProfileScan,
  type RtpExportFundingSourceContextReadiness,
  type RtpExportLinkedProject,
  type RtpExportNormalizedLinkedProject,
} from "@/lib/rtp/export";
import { buildRtpFiscalConstraint } from "@/lib/rtp/fiscal-constraint";
import {
  loadRtpFinancialElement,
  type RtpFinancialElementSupabaseLike,
} from "@/lib/rtp/financial-element-queries";
import {
  buildRtpCommentResponseRecord,
  loadRtpCommentResponseRecord,
  rtpCommentResponseUnreadableFrom,
  type RtpCommentResponseSupabaseLike,
} from "@/lib/rtp/comment-response";
import {
  loadRtpPriorityFrameworkBinding,
  type RtpPriorityFrameworkQuerySupabaseLike,
} from "@/lib/rtp/priority-framework-queries";

export type RtpExportInputSupabaseLike = Pick<SupabaseClient, "from">;

export type RtpExportInputAudit = {
  warn: (event: string, context?: Record<string, unknown>) => void;
};

/**
 * The projections, declared once.
 *
 * The export route's own copy was missing `project_id`, so every link handed to
 * `buildRtpFiscalConstraint` carried `projectId: undefined` while
 * `RtpExportLinkedProject.project_id` is typed `string`. Supabase clients here
 * are deliberately untyped, so nothing caught it. A projection that lives in
 * one place cannot drift from the other caller's.
 */
export const RTP_EXPORT_CYCLE_COLUMNS =
  "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, financial_basis_year, annual_inflation_rate, updated_at";

export const RTP_EXPORT_CHAPTER_COLUMNS =
  "id, title, section_type, status, summary, guidance, content_markdown, sort_order";

export const RTP_EXPORT_LINKED_PROJECT_COLUMNS =
  "id, project_id, portfolio_role, priority_rationale, priority_scores, horizon_band_id, estimated_cost, cost_basis_year, projects(id, name, status, delivery_phase, summary, updated_at)";

export const RTP_EXPORT_CAMPAIGN_COLUMNS =
  "id, title, status, engagement_type, summary, rtp_cycle_chapter_id";

/** The cycle row both routes read: the exporter's fields plus the fiscal basis. */
export type RtpExportInputCycleRow = RtpExportCycle & {
  financial_basis_year?: number | null;
  annual_inflation_rate?: number | string | null;
};

const FUNDING_SOURCE_CONTEXT_OPERATOR_CAVEAT =
  "Operator review required. This funding/source-context scan supports planning packet review only; it is not legal compliance automation, award prediction, or autonomous approval.";

type ReportCountyRunEvidenceRow = {
  id: string;
  workspace_id: string;
  run_name: string | null;
  geography_label: string | null;
  stage: string | null;
  updated_at: string | null;
};

/**
 * The result of trying to read the modeling evidence a document reports on —
 * RETURNED, not decided here.
 *
 * Every read below used to be answered with `audit.warn()` and an empty list,
 * and the two are not the same act. The warning is something an OPERATOR may
 * find in host logs; the empty list becomes `modelingEvidenceCount: 0` in the
 * artifact record and "0 modeling evidence item(s)" in the funding readiness
 * line — a sentence a board or a funder reads as established fact about the
 * agency's own modeling work.
 */
export type ReportModelingEvidenceRead = {
  items: ReportModelingEvidence[];
  error: { message: string; code: string | null } | null;
};

/**
 * The modeling evidence a document may cite — and ONLY the run the document
 * names.
 *
 * THERE USED TO BE A FALLBACK, and deleting it is the point of this comment.
 * When no run was named, this read the workspace's five most recently updated
 * `county_runs` and printed them under "Assignment modeling claim posture".
 * Nothing in the schema links a `county_run` to an `rtp_cycle`, a `project` or
 * a `report`, so those five rows were selected by RECENCY and presented as the
 * plan's own evidence: a planner exporting a corridor plan for one county could
 * be handed a claim posture describing model runs for a different geography
 * entirely, with no sentence anywhere saying the two were unrelated.
 *
 * A fabricated citation is worse than a stated absence, and the absence is
 * already rendered — `modelingEvidenceMarkup` answers an empty list with "No
 * county model run is attached to this plan… that is the absence of evidence,
 * not evidence of a sound model." So when no run is named there is no query at
 * all, and the document says so.
 *
 * There is no honest way to choose runs for a document that names none. If a
 * plan should carry modeling evidence, something must LINK a run to it; until a
 * column exists for that, the answer is the absence.
 */
export async function loadReportModelingEvidence(input: {
  supabase: RtpExportInputSupabaseLike;
  audit: RtpExportInputAudit;
  reportId: string;
  workspaceId: string;
  modelingCountyRunId?: string | null;
  auditEventPrefix: "rtp_modeling" | "report_modeling";
}): Promise<ReportModelingEvidenceRead> {
  const { supabase, audit, reportId, workspaceId, modelingCountyRunId, auditEventPrefix } = input;
  let countyRuns: ReportCountyRunEvidenceRow[] = [];

  if (!modelingCountyRunId) {
    // No run is named, so nothing is read and nothing is claimed. This is a
    // successful, empty answer — never a refusal: "this document names no model
    // run" is a fact about the document, not a failed query.
    return { items: [], error: null };
  }

  {
    // BOTH county-run reads here are deliberately NOT wrapped in
    // `safeOptionalQuery`. These rows are what the evidence count is counted
    // FROM, so substituting the empty fallback for a classified failure answers
    // "there is no modeling evidence" on the strength of a query that never ran.
    // A missing COLUMN on an existing `county_runs` table is the realistic case,
    // and there the runs are sitting right there while the packet prints zero.
    const countyRunResult = await supabase
      .from("county_runs")
      .select("id, workspace_id, run_name, geography_label, stage, updated_at")
      .eq("id", modelingCountyRunId)
      .maybeSingle();

    if (countyRunResult.error) {
      audit.warn(`${auditEventPrefix}_county_run_lookup_failed`, {
        reportId,
        workspaceId,
        countyRunId: modelingCountyRunId,
        message: countyRunResult.error.message,
        code: countyRunResult.error.code ?? null,
      });
      return {
        items: [],
        error: { message: countyRunResult.error.message, code: countyRunResult.error.code ?? null },
      };
    }

    if (!countyRunResult.data) {
      // A SUCCESSFUL read that found nothing. The linked run is genuinely gone,
      // and "no modeling evidence" is a fact this path established.
      audit.warn(`${auditEventPrefix}_county_run_missing`, {
        reportId,
        workspaceId,
        countyRunId: modelingCountyRunId,
      });
    } else if (countyRunResult.data.workspace_id !== workspaceId) {
      audit.warn(`${auditEventPrefix}_county_run_workspace_mismatch`, {
        reportId,
        workspaceId,
        countyRunId: modelingCountyRunId,
        countyRunWorkspaceId: countyRunResult.data.workspace_id,
      });
    } else {
      countyRuns = [countyRunResult.data as ReportCountyRunEvidenceRow];
    }
  }

  const evidenceReads = await Promise.all(
    countyRuns.map(async (countyRun) => {
      const evidenceResult = await loadCountyRunModelingEvidence({
        supabase,
        countyRunId: countyRun.id,
        track: "assignment",
      });

      if (evidenceResult.error) {
        audit.warn(`${auditEventPrefix}_evidence_lookup_failed`, {
          reportId,
          workspaceId,
          countyRunId: countyRun.id,
          message: evidenceResult.error.message,
          code: evidenceResult.error.code ?? null,
          missingSchema: evidenceResult.error.missingSchema ?? false,
        });
      }

      return { countyRun, evidenceResult };
    })
  );

  // `evidence: null` reads in the document as "this run carries no claim
  // decision, no source manifests, and no validation checks" — the honesty
  // firewall's own vocabulary, stated about a run whose evidence nobody could
  // read. It is the worst of the three shapes here, so it refuses too.
  const failedEvidenceRead = evidenceReads.find((read) => read.evidenceResult.error)?.evidenceResult.error;

  if (failedEvidenceRead) {
    return {
      items: [],
      error: { message: failedEvidenceRead.message, code: failedEvidenceRead.code ?? null },
    };
  }

  return {
    items: evidenceReads.map(({ countyRun, evidenceResult }) => ({
      countyRunId: countyRun.id,
      runName: countyRun.run_name,
      geographyLabel: countyRun.geography_label,
      stage: countyRun.stage,
      updatedAt: countyRun.updated_at,
      evidence: evidenceResult.evidence,
    })),
    error: null,
  };
}

/**
 * One refusal for every packet branch, so the RTP path, the direct export and
 * the project path cannot drift into disagreeing about whether an unreadable
 * evidence table is fatal. A pending migration answers 503 (come back after
 * migrating); anything else answers 500 (this deployment cannot describe what
 * happened) — never a 200 carrying a count nobody established.
 */
export function classifyModelingEvidenceReadFailure(read: ReportModelingEvidenceRead) {
  return classifyRouteReadFailure("the modeling evidence this packet reports on", read, {
    pendingError: "This packet's modeling evidence cannot be read yet",
    pendingHint:
      "Apply the latest Supabase migrations, then generate again. Generating without them would print a modeling-evidence count this deployment never established.",
  });
}

export function summarizeRtpFundingProfileScanReadiness(
  scans: Array<{ scan: { status: string; label: string; nextAction: string } }>,
  input: {
    modelingEvidenceCount: number;
    engagementReadyForHandoffCount: number;
    enabledSectionCount: number;
  }
): RtpExportFundingSourceContextReadiness {
  const blockedCount = scans.filter(
    (item) => item.scan.status === "blocked" || item.scan.status === "not_started"
  ).length;
  const attentionCount = scans.filter((item) => item.scan.status === "attention").length;
  const readyCount = scans.filter((item) => item.scan.status === "ready").length;

  let status: RtpExportFundingSourceContextReadiness["status"] = "ready";
  let label = "RTP funding source context ready for operator review";
  let detail =
    "Generation captured linked-project funding scans, cycle readiness, public-review posture, and packet source context for supervised RTP review.";

  if (blockedCount > 0) {
    status = "blocked";
    label = "RTP funding source context has project blockers";
    detail = `${blockedCount} linked project funding scan${blockedCount === 1 ? "" : "s"} need setup or blocker resolution before the RTP funding basis is used outside OpenPlan.`;
  } else if (attentionCount > 0 || scans.length === 0) {
    status = "attention";
    label = "RTP funding source context needs operator review";
    detail = scans.length === 0
      ? "No linked project funding scans were available when this RTP artifact was generated."
      : `${attentionCount} linked project funding scan${attentionCount === 1 ? "" : "s"} need operator review before strong RTP funding language is reused.`;
  }

  return {
    capturedAt: new Date().toISOString(),
    status,
    label,
    detail,
    linkedProjectScanCount: scans.length,
    readyProjectScanCount: readyCount,
    attentionProjectScanCount: attentionCount,
    blockedProjectScanCount: blockedCount,
    modelingEvidenceCount: input.modelingEvidenceCount,
    engagementReadyForHandoffCount: input.engagementReadyForHandoffCount,
    enabledSectionCount: input.enabledSectionCount,
    operatorReviewCaveat: FUNDING_SOURCE_CONTEXT_OPERATOR_CAVEAT,
  };
}

/**
 * How this particular document presents itself.
 *
 * The two documents may legitimately differ — a board packet composed from a
 * report's own enabled sections is not obliged to equal a whole-plan export.
 * What they may not do is differ SILENTLY, so the composition is a DECLARED
 * choice with a source, not an omitted argument that falls through to a
 * default nobody chose.
 */
export type RtpExportComposition =
  | {
      /** The report's `report_sections` rows decided this. */
      kind: "report_sections";
      sectionKeys: string[];
    }
  | {
      /** No report exists — the direct export carries the whole plan. */
      kind: "whole_plan";
    };

export type RtpExportPresentation = {
  titleSuffix: string;
  composition: RtpExportComposition;
};

export type RtpExportInputRefusal = {
  status: number;
  body: { error: string; hint?: string };
  pending: boolean;
  message: string;
  /** The database's own code when there was one, so a log line stays diagnosable. */
  code: string | null;
  /** The event name the calling route logs, so both routes log the same thing. */
  auditEvent: string;
};

/**
 * Everything the caller may also need for its OWN records — the board packet
 * freezes most of this into `report_artifacts.metadata_json`. Returned rather
 * than recomputed, so the artifact record and the document it describes cannot
 * disagree.
 */
export type RtpExportInputContext = {
  cycle: RtpExportInputCycleRow;
  chapters: RtpExportChapter[];
  linkedProjects: RtpExportNormalizedLinkedProject[];
  campaigns: RtpExportCampaign[];
  chapterCompleteCount: number;
  chapterReadyForReviewCount: number;
  cycleLevelCampaignCount: number;
  chapterLevelCampaignCount: number;
  engagementCounts: ReturnType<typeof summarizeEngagementItems>;
  publicReviewSummary: ReturnType<typeof buildRtpPublicReviewSummary>;
  readiness: ReturnType<typeof buildRtpCycleReadiness>;
  workflow: ReturnType<typeof buildRtpCycleWorkflowSummary>;
  modelingEvidence: ReportModelingEvidence[];
  portfolioFundingSnapshot: ReturnType<typeof buildPortfolioFundingSnapshot>;
  fundingProfileScans: RtpExportFundingProfileScan[];
  fundingSourceContextReadiness: RtpExportFundingSourceContextReadiness;
  /** True when the jurisdiction binding could not be read, so nothing was cited. */
  priorityFrameworkReadFailed: boolean;
};

/**
 * THE DOCUMENT, SEALED — because "neither route may construct an options bag"
 * was a true intention and a false statement.
 *
 * The extraction made this module the only PRODUCER of a complete
 * `RtpExportOptions`, and stopped there. A route still received a plain object
 * and could do this on the way to the renderer:
 *
 *   const exportInput = { ...built.document, options: { ...built.document.options, commentResponse: null } };
 *
 * That compiled, and the whole suite stayed green — so a route could still
 * delete a section of a board document after the shared builder had decided it,
 * which is the divergence this seam exists to make impossible, one line later.
 *
 * The payload therefore leaves this module inside a class with a `#private`
 * field, and the class itself is NOT exported — only its type is. Outside this
 * file there is no expression that reaches `#document`: a spread yields `{}`
 * (which TypeScript refuses to pass back, private fields making the class
 * nominal), and calling the renderer with the spread throws at runtime rather
 * than quietly rendering an edited plan. `renderRtpExportDocumentHtml` below is
 * the only opener, and both routes call it instead of `buildRtpExportHtml`.
 *
 * `buildRtpExportHtml` stays public and partial-tolerant on purpose: unit tests
 * and any future fragment renderer legitimately want it. What is forbidden is a
 * ROUTE reaching it, and that is guarded by name in
 * `rtp-export-paths-carry-the-same-document.test.ts`.
 */
class RtpExportEnvelope {
  readonly #document: RtpExportDocumentInput;

  constructor(document: RtpExportDocumentInput) {
    this.#document = document;
  }

  /** Module-private by construction: the class is not exported, so this is unreachable outside. */
  static open(envelope: RtpExportEnvelope): RtpExportDocumentInput {
    return envelope.#document;
  }
}

export type SealedRtpExportDocument = RtpExportEnvelope;

/** The one way an exported RTP document becomes HTML. */
export function renderRtpExportDocumentHtml(document: SealedRtpExportDocument): string {
  return buildRtpExportHtml(RtpExportEnvelope.open(document));
}

export type RtpCycleExportInputResult =
  | { ok: true; document: SealedRtpExportDocument; context: RtpExportInputContext }
  | { ok: false; refusal: RtpExportInputRefusal };

function refusal(
  auditEvent: string,
  failure: { status: number; body: { error: string; hint?: string }; pending: boolean; message: string },
  code?: string | null
): { ok: false; refusal: RtpExportInputRefusal } {
  return { ok: false, refusal: { ...failure, code: code ?? null, auditEvent } };
}

/**
 * Assemble the ONE document input both RTP export routes render.
 *
 * The caller has already loaded and AUTHORISED the cycle row (the export route
 * needs `workspace_id` to check membership before doing any work, and the
 * packet route reaches the cycle through a report it already checked). It is
 * passed in rather than re-read, and `RTP_EXPORT_CYCLE_COLUMNS` keeps the two
 * projections from drifting.
 */
export async function buildRtpCycleExportInput(input: {
  supabase: RtpExportInputSupabaseLike;
  audit: RtpExportInputAudit;
  cycle: RtpExportInputCycleRow;
  presentation: RtpExportPresentation;
  /**
   * What the CALLER knows about this cycle's packet records — required, and
   * required for the reason `RtpExportOptions`'s fields are.
   *
   * This was `packetRecordCount: 1, generatedPacketCount: 1`, hardcoded here for
   * both callers. It is true of the packet route, which is generating the record
   * it is describing. It was a fabrication in the whole-plan export, which never
   * reads `reports` or `report_artifacts` and may sit behind a cycle that has
   * never had a packet generated at all — so the document asserted a board
   * packet that need not exist.
   */
  packetRecords: RtpPacketRecordKnowledge;
  /** The report this document belongs to, when there is one. */
  reportId?: string | null;
  /** A report may name the county run whose modeling evidence it reports on. */
  modelingCountyRunId?: string | null;
  /** When the funding basis was captured — the report's own generation time. */
  capturedAt?: string | null;
}): Promise<RtpCycleExportInputResult> {
  const { supabase, audit, cycle, presentation } = input;
  const reportId = input.reportId ?? cycle.id;
  const capturedAt = input.capturedAt ?? new Date().toISOString();

  const modelingEvidencePromise = loadReportModelingEvidence({
    supabase,
    audit,
    reportId,
    workspaceId: cycle.workspace_id,
    modelingCountyRunId: input.modelingCountyRunId ?? null,
    auditEventPrefix: "rtp_modeling",
  });

  const [chaptersResult, linksResult, campaignsResult] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select(RTP_EXPORT_CHAPTER_COLUMNS)
      .eq("rtp_cycle_id", cycle.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("project_rtp_cycle_links")
      .select(RTP_EXPORT_LINKED_PROJECT_COLUMNS)
      .eq("rtp_cycle_id", cycle.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("engagement_campaigns")
      .select(RTP_EXPORT_CAMPAIGN_COLUMNS)
      .eq("rtp_cycle_id", cycle.id)
      .order("updated_at", { ascending: false }),
  ]);

  const sourceError = [chaptersResult.error, linksResult.error, campaignsResult.error].find(Boolean);
  if (sourceError) {
    return refusal("rtp_report_generation_load_failed", {
      status: 500,
      body: { error: "Failed to load RTP packet source records" },
      pending: false,
      message: sourceError.message,
    }, sourceError.code ?? null);
  }

  const chapters = (chaptersResult.data ?? []) as unknown as RtpExportChapter[];
  const linkedProjects = normalizeRtpLinkedProjects(
    (linksResult.data ?? []) as unknown as RtpExportLinkedProject[]
  );
  const campaigns = (campaignsResult.data ?? []) as unknown as RtpExportCampaign[];

  const modelingEvidenceRead = await modelingEvidencePromise;
  const modelingEvidenceFailure = classifyModelingEvidenceReadFailure(modelingEvidenceRead);
  if (modelingEvidenceFailure) {
    return refusal("rtp_report_modeling_evidence_load_failed", modelingEvidenceFailure);
  }
  const modelingEvidence = modelingEvidenceRead.items;

  const linkedProjectIds = linkedProjects
    .map((link) => link.project?.id ?? null)
    .filter((value): value is string => Boolean(value));

  const [fundingProfilesResult, fundingAwardsResult, fundingOpportunitiesResult, billingInvoicesResult] =
    linkedProjectIds.length > 0
      ? await Promise.all([
          supabase
            .from("project_funding_profiles")
            .select("project_id, funding_need_amount, local_match_need_amount, updated_at")
            .in("project_id", linkedProjectIds),
          supabase
            .from("funding_awards")
            .select("project_id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
            .in("project_id", linkedProjectIds),
          supabase
            .from("funding_opportunities")
            .select("project_id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
            .in("project_id", linkedProjectIds),
          supabase
            .from("billing_invoice_records")
            .select("project_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
            .in("project_id", linkedProjectIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  // These four reads are TOTALLED into the funding snapshot. A failure read as
  // `?? []` does not leave a gap a reader could notice — it prints $0 committed
  // and a fully unfunded portfolio, under the agency's name, in a document a
  // funder or a board keeps.
  const fundingError = [
    fundingProfilesResult.error,
    fundingAwardsResult.error,
    fundingOpportunitiesResult.error,
    billingInvoicesResult.error,
  ].find(Boolean);
  if (fundingError) {
    return refusal("rtp_report_funding_load_failed", {
      status: 500,
      body: { error: "Failed to load RTP packet funding records" },
      pending: false,
      message: fundingError.message,
    }, fundingError.code ?? null);
  }

  type FundingProfileRow = {
    project_id: string;
    funding_need_amount: number | null;
    local_match_need_amount: number | null;
    updated_at: string | null;
  };
  type FundingAwardRow = {
    project_id: string;
    awarded_amount: number | string | null;
    match_amount: number | string | null;
    risk_flag: string | null;
    obligation_due_at: string | null;
    updated_at: string | null;
    created_at: string | null;
  };
  type FundingOpportunityRow = {
    project_id: string;
    expected_award_amount: number | string | null;
    decision_state: string | null;
    opportunity_status: string | null;
    closes_at: string | null;
    updated_at: string | null;
    created_at: string | null;
  };
  type FundingInvoiceRow = {
    project_id: string;
    status: string | null;
    amount: number | string | null;
    retention_percent: number | string | null;
    retention_amount: number | string | null;
    net_amount: number | string | null;
    due_date: string | null;
    invoice_date: string | null;
    created_at: string | null;
  };

  const fundingProfileByProjectId = new Map(
    ((fundingProfilesResult.data ?? []) as unknown as FundingProfileRow[]).map((profile) => [
      profile.project_id,
      profile,
    ])
  );
  const fundingAwardsByProjectId = new Map<string, FundingAwardRow[]>();
  const fundingOpportunitiesByProjectId = new Map<string, FundingOpportunityRow[]>();
  const fundingInvoicesByProjectId = new Map<string, FundingInvoiceRow[]>();
  for (const award of (fundingAwardsResult.data ?? []) as unknown as FundingAwardRow[]) {
    const current = fundingAwardsByProjectId.get(award.project_id) ?? [];
    current.push(award);
    fundingAwardsByProjectId.set(award.project_id, current);
  }
  for (const opportunity of (fundingOpportunitiesResult.data ?? []) as unknown as FundingOpportunityRow[]) {
    const current = fundingOpportunitiesByProjectId.get(opportunity.project_id) ?? [];
    current.push(opportunity);
    fundingOpportunitiesByProjectId.set(opportunity.project_id, current);
  }
  for (const invoice of (billingInvoicesResult.data ?? []) as unknown as FundingInvoiceRow[]) {
    const current = fundingInvoicesByProjectId.get(invoice.project_id) ?? [];
    current.push(invoice);
    fundingInvoicesByProjectId.set(invoice.project_id, current);
  }

  const portfolioFundingSnapshot = buildPortfolioFundingSnapshot({
    projects: linkedProjectIds.map((projectId) => ({
      projectUpdatedAt: linkedProjects.find((link) => link.project?.id === projectId)?.project?.updated_at ?? null,
      profile: fundingProfileByProjectId.get(projectId) ?? null,
      awards: fundingAwardsByProjectId.get(projectId) ?? [],
      opportunities: fundingOpportunitiesByProjectId.get(projectId) ?? [],
      invoices: fundingInvoicesByProjectId.get(projectId) ?? [],
    })),
    capturedAt,
  });

  const fundingProfileScans: RtpExportFundingProfileScan[] = linkedProjects.map((link) => {
    const projectId = link.project?.id ?? link.project_id;
    const summary = buildProjectFundingStackSummary(
      fundingProfileByProjectId.get(projectId) ?? null,
      fundingAwardsByProjectId.get(projectId) ?? [],
      fundingOpportunitiesByProjectId.get(projectId) ?? [],
      fundingInvoicesByProjectId.get(projectId) ?? []
    );
    const scan = buildProjectFundingProfileScan({ summary, hasComparisonEvidence: false });

    return {
      projectId,
      projectName: link.project?.name ?? null,
      portfolioRole: link.portfolio_role,
      priorityRationale: link.priority_rationale,
      latestFundingSourceUpdatedAt: buildProjectFundingSnapshot({
        profile: fundingProfileByProjectId.get(projectId) ?? null,
        awards: fundingAwardsByProjectId.get(projectId) ?? [],
        opportunities: fundingOpportunitiesByProjectId.get(projectId) ?? [],
        invoices: fundingInvoicesByProjectId.get(projectId) ?? [],
        capturedAt: input.capturedAt ?? null,
        projectUpdatedAt: link.project?.updated_at ?? null,
      }).latestSourceUpdatedAt,
      scan,
    };
  });

  const campaignIds = campaigns.map((campaign) => campaign.id);
  const engagementItemsResult = campaignIds.length
    ? await supabase
        .from("engagement_items")
        .select(
          "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at"
        )
        .in("campaign_id", campaignIds)
    : { data: [], error: null };

  // These rows become the public-review comment counts. A failed read carried
  // through as `?? []` tells a board the cycle drew no comments — a sentence
  // this product has already published twice on the strength of a query that
  // never ran.
  if (engagementItemsResult.error) {
    return refusal("rtp_report_engagement_load_failed", {
      status: 500,
      body: { error: "Failed to load RTP packet engagement records" },
      pending: false,
      message: engagementItemsResult.error.message,
    }, engagementItemsResult.error.code ?? null);
  }

  const engagementCounts = summarizeEngagementItems(
    [],
    (engagementItemsResult.data ?? []) as unknown as Array<{
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
    }>
  );

  const cycleLevelCampaignCount = campaigns.filter((campaign) => !campaign.rtp_cycle_chapter_id).length;
  const chapterLevelCampaignCount = campaigns.length - cycleLevelCampaignCount;
  const readiness = buildRtpCycleReadiness({
    geographyLabel: cycle.geography_label,
    horizonStartYear: cycle.horizon_start_year,
    horizonEndYear: cycle.horizon_end_year,
    adoptionTargetDate: cycle.adoption_target_date,
    publicReviewOpenAt: cycle.public_review_open_at,
    publicReviewCloseAt: cycle.public_review_close_at,
  });
  const workflow = buildRtpCycleWorkflowSummary({ status: cycle.status, readiness });
  const publicReviewSummary = buildRtpPublicReviewSummary({
    status: cycle.status,
    publicReviewOpenAt: cycle.public_review_open_at,
    publicReviewCloseAt: cycle.public_review_close_at,
    cycleLevelCampaignCount,
    chapterCampaignCount: chapterLevelCampaignCount,
    packets: input.packetRecords,
    pendingCommentCount: engagementCounts.moderationQueue.pendingCount,
    approvedCommentCount: engagementCounts.moderationQueue.approvedCount,
    readyCommentCount: engagementCounts.moderationQueue.readyForHandoffCount,
  });

  const sectionKeys =
    presentation.composition.kind === "report_sections"
      ? presentation.composition.sectionKeys
      : [...DEFAULT_RTP_EXPORT_SECTION_KEYS];

  const fundingSourceContextReadiness = summarizeRtpFundingProfileScanReadiness(fundingProfileScans, {
    modelingEvidenceCount: modelingEvidence.length,
    engagementReadyForHandoffCount: engagementCounts.moderationQueue.readyForHandoffCount,
    enabledSectionCount: sectionKeys.length,
  });

  // The exported plan may only cite the law of the jurisdiction the workspace
  // actually works in. A failed read yields an uncited binding, which drops the
  // policy-basis clause rather than substituting a jurisdiction — an export is
  // the document a board adopts, so a wrong citation is worse than none.
  const priorityFramework = await loadRtpPriorityFrameworkBinding(
    supabase as unknown as RtpPriorityFrameworkQuerySupabaseLike,
    cycle.workspace_id
  );
  if (priorityFramework.readFailed) {
    audit.warn("priority_framework_lookup_failed", { rtpCycleId: cycle.id });
  }

  const financialElement = await loadRtpFinancialElement(
    supabase as unknown as RtpFinancialElementSupabaseLike,
    cycle.id
  );
  // `loadRtpFinancialElement` returns its raw results precisely so the caller
  // can disclose a failure, and NEITHER export route looked at them. The cost
  // of not looking is specific and it is money on a board document: an
  // unreadable `rtp_horizon_bands` renders "No horizon periods have been
  // declared for this plan, so revenue and costs belong to no period", and an
  // unreadable `rtp_financial_assumptions` renders the `no_revenue_recorded`
  // blocker. Both are stated as facts ABOUT THE PLAN over a query that never
  // ran. There is no flag on `RtpFiscalConstraintSummary` to carry the doubt,
  // so the honest answer is to refuse the document rather than publish a
  // fiscal verdict nobody established. `measures` is not checked: nothing in
  // either document renders a performance measure yet.
  const financialReadFailure =
    classifyRouteReadFailure("this plan's horizon periods", financialElement.results.bands, {
      pendingError: "This plan's horizon periods cannot be read yet",
      pendingHint:
        "Apply the latest Supabase migrations, then export again. Exporting without them would state that the plan has declared no horizon periods, which this deployment never established.",
    }) ??
    classifyRouteReadFailure("this plan's revenue and cost ledger", financialElement.results.lines, {
      pendingError: "This plan's revenue and cost ledger cannot be read yet",
      pendingHint:
        "Apply the latest Supabase migrations, then export again. Exporting without them would report that no revenue is recorded, which this deployment never established.",
    });
  if (financialReadFailure) {
    return refusal("rtp_report_financial_element_load_failed", financialReadFailure);
  }

  const commentResponseLoad = await loadRtpCommentResponseRecord(
    supabase as unknown as RtpCommentResponseSupabaseLike,
    cycle.id
  );

  const fiscalConstraint = buildRtpFiscalConstraint({
    cycleHorizonStartYear: cycle.horizon_start_year,
    cycleHorizonEndYear: cycle.horizon_end_year,
    cycleFinancialBasisYear: cycle.financial_basis_year ?? null,
    annualInflationRate: cycle.annual_inflation_rate ?? null,
    bands: financialElement.bands,
    lines: financialElement.lines,
    projects: linkedProjects.map((link) => ({
      linkId: link.id,
      projectId: link.project_id,
      projectName: link.project?.name ?? null,
      portfolioRole: link.portfolio_role,
      horizonBandId: link.horizon_band_id ?? null,
      estimatedCost: link.estimated_cost ?? null,
      costBasisYear: link.cost_basis_year ?? null,
    })),
  });

  return {
    ok: true,
    document: new RtpExportEnvelope({
      cycle,
      chapters,
      linkedProjects,
      campaigns,
      priorityCriteria: priorityFramework.binding.criteria,
      // EVERY field of `RtpExportOptions` is required, and this is the only
      // object literal in the repository that satisfies it. A new option added
      // to the exported document fails the build right here, for both routes at
      // once — which is the property that keeps them from diverging again.
      options: {
        sectionKeys,
        composition: presentation.composition.kind,
        titleSuffix: presentation.titleSuffix,
        publicReviewSummary: {
          ...publicReviewSummary,
          cycleLevelCampaignCount,
          chapterLevelCampaignCount,
          pendingCommentCount: engagementCounts.moderationQueue.pendingCount,
          readyCommentCount: engagementCounts.moderationQueue.readyForHandoffCount,
        },
        modelingEvidence,
        fundingSnapshot: portfolioFundingSnapshot,
        fundingProfileScans,
        fundingSourceContextReadiness,
        fiscalConstraint,
        horizonBands: financialElement.bands,
        commentResponse: buildRtpCommentResponseRecord({
          campaigns: commentResponseLoad.campaigns,
          comments: commentResponseLoad.comments,
          responses: commentResponseLoad.responses,
          unreadable: rtpCommentResponseUnreadableFrom(commentResponseLoad.results),
        }),
      },
    }),
    context: {
      cycle,
      chapters,
      linkedProjects,
      campaigns,
      chapterCompleteCount: chapters.filter((chapter) => chapter.status === "complete").length,
      chapterReadyForReviewCount: chapters.filter((chapter) => chapter.status === "ready_for_review").length,
      cycleLevelCampaignCount,
      chapterLevelCampaignCount,
      engagementCounts,
      publicReviewSummary,
      readiness,
      workflow,
      modelingEvidence,
      portfolioFundingSnapshot,
      fundingProfileScans,
      fundingSourceContextReadiness,
      priorityFrameworkReadFailed: priorityFramework.readFailed,
    },
  };
}
