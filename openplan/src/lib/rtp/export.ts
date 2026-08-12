import { renderChapterMarkdownToHtml } from "@/lib/markdown/render";
import { modelingClaimStatusLabel } from "@/lib/models/evidence-backbone";
import {
  buildReportModelingEvidenceExportProof,
  formatModelingValidationStatusLabel,
  type ReportModelingEvidence,
} from "@/lib/reports/modeling-evidence";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  formatRtpChapterStatusLabel,
  formatRtpCycleStatusLabel,
  formatRtpPortfolioRoleLabel,
  titleizeRtpValue,
  type RtpPublicReviewSummary,
} from "@/lib/rtp/catalog";
import type { ResolvedRtpPriorityCriterion } from "@/lib/rtp/priority-frameworks";
import {
  describeRtpFiscalConstraint,
  rtpFiscalVerdictLabel,
  type RtpFiscalConstraintSummary,
} from "@/lib/rtp/fiscal-constraint";
import {
  describeRtpCommentResponse,
  type RtpCommentResponseSummary,
} from "@/lib/rtp/comment-response";
import { parseOptionalAmount } from "@/lib/money/optional-amount";
import {
  exportProvenanceLine,
  type TranscriptionRecord,
} from "@/lib/rtp/extraction/display";
import {
  buildPortfolioPriorityNarrative,
  buildRtpPriorityRationale,
  computeRtpPriorityScore,
  priorityTierLabel,
} from "@/lib/rtp/priority-scoring";
import type { PortfolioFundingSnapshot, ProjectFundingProfileScan } from "@/lib/projects/funding";

export type RtpExportCycle = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
  adoption_target_date: string | null;
  public_review_open_at: string | null;
  public_review_close_at: string | null;
  summary: string | null;
  updated_at: string;
};

export type RtpExportChapter = {
  id: string;
  title: string;
  section_type: string;
  status: string;
  summary: string | null;
  guidance: string | null;
  content_markdown: string | null;
  sort_order: number;
};

export type RtpExportLinkedProject = {
  id: string;
  project_id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  priority_scores?: Record<string, number> | null;
  /** Optional so a caller that has not loaded them yet renders a stated gap, not a wrong number. */
  horizon_band_id?: string | null;
  estimated_cost?: number | string | null;
  cost_basis_year?: number | null;
  projects:
    | {
        id: string;
        name: string;
        status: string | null;
        delivery_phase: string | null;
        summary: string | null;
        updated_at?: string | null;
      }
    | Array<{
        id: string;
        name: string;
        status: string | null;
        delivery_phase: string | null;
        summary: string | null;
        updated_at?: string | null;
      }>
    | null;
};

export type RtpExportCampaign = {
  id: string;
  title: string;
  status: string;
  engagement_type: string;
  summary: string | null;
  rtp_cycle_chapter_id: string | null;
};

export type RtpExportModelingEvidence = ReportModelingEvidence;

export type RtpExportFundingProfileScan = {
  projectId: string;
  projectName: string | null;
  portfolioRole: string | null;
  priorityRationale: string | null;
  latestFundingSourceUpdatedAt: string | null;
  scan: ProjectFundingProfileScan;
};

export type RtpExportFundingSourceContextReadiness = {
  capturedAt: string;
  status: "ready" | "attention" | "blocked";
  label: string;
  detail: string;
  linkedProjectScanCount: number;
  readyProjectScanCount: number;
  attentionProjectScanCount: number;
  blockedProjectScanCount: number;
  modelingEvidenceCount: number;
  engagementReadyForHandoffCount: number;
  enabledSectionCount: number;
  operatorReviewCaveat: string;
};

export type RtpExportNormalizedLinkedProject = RtpExportLinkedProject & {
  project: {
    id: string;
    name: string;
    status: string | null;
    delivery_phase: string | null;
    summary: string | null;
    updated_at?: string | null;
  } | null;
};

export type RtpExportSectionKey =
  | "cycle_overview"
  | "chapter_digest"
  | "financial_element"
  | "project_lists"
  | "portfolio_posture"
  | "engagement_posture"
  | "comment_response"
  | "adoption_readiness"
  | "appendix_references";

/**
 * Every section key, in the order an exported plan presents them.
 *
 * `satisfies Record<RtpExportSectionKey, true>` is the load-bearing part: a key
 * added to the union above and forgotten here fails the BUILD rather than
 * silently vanishing from every export. That matters because a section key has
 * to be declared in five hand-maintained places (this union, this map,
 * `RTP_SECTION_TEMPLATES.board_packet`, the five `enabledKeysByStage` arrays,
 * and `describeReportSectionKey`), and being registered in four of the five
 * type-checks perfectly while the section quietly disappears from one packet
 * stage. The compiler covers two of them; `rtp-export-sections-stay-in-step`
 * covers the rest.
 */
const RTP_EXPORT_SECTION_ORDER = {
  cycle_overview: true,
  chapter_digest: true,
  financial_element: true,
  project_lists: true,
  portfolio_posture: true,
  engagement_posture: true,
  comment_response: true,
  adoption_readiness: true,
  appendix_references: true,
} as const satisfies Record<RtpExportSectionKey, true>;

export const DEFAULT_RTP_EXPORT_SECTION_KEYS = Object.keys(
  RTP_EXPORT_SECTION_ORDER
) as RtpExportSectionKey[];

/**
 * Where a document's section list came from.
 *
 * `report_sections` — a report's own stored selection, which may omit sections.
 * `whole_plan` — no report exists, so the whole plan is carried.
 *
 * Declared as data rather than inferred from the array, because "nine keys"
 * and "every key, deliberately" are not the same statement to a reader.
 */
export type RtpExportComposition = "report_sections" | "whole_plan";

export function normalizeRtpLinkedProjects(
  linkedProjects: RtpExportLinkedProject[]
): RtpExportNormalizedLinkedProject[] {
  return linkedProjects.map((link) => ({
    ...link,
    project: Array.isArray(link.projects) ? (link.projects[0] ?? null) : link.projects,
  }));
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatRtpExportDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function formatRtpExportDateTime(value: string | null | undefined): string {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatRtpExportCurrency(value: number | null | undefined): string {
  const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function resolveEnabledSectionKeys(sectionKeys?: string[]): RtpExportSectionKey[] {
  const allowed = new Set<RtpExportSectionKey>(DEFAULT_RTP_EXPORT_SECTION_KEYS);
  const resolved = (sectionKeys ?? []).filter((key): key is RtpExportSectionKey => allowed.has(key as RtpExportSectionKey));
  return resolved.length > 0 ? resolved : DEFAULT_RTP_EXPORT_SECTION_KEYS;
}

function buildRtpExportStats(input: {
  cycle: RtpExportCycle;
  chapters: RtpExportChapter[];
  linkedProjects: RtpExportNormalizedLinkedProject[];
  campaigns: RtpExportCampaign[];
}) {
  const { cycle, chapters, linkedProjects, campaigns } = input;
  const readiness = buildRtpCycleReadiness({
    geographyLabel: cycle.geography_label,
    horizonStartYear: cycle.horizon_start_year,
    horizonEndYear: cycle.horizon_end_year,
    adoptionTargetDate: cycle.adoption_target_date,
    publicReviewOpenAt: cycle.public_review_open_at,
    publicReviewCloseAt: cycle.public_review_close_at,
  });
  const workflow = buildRtpCycleWorkflowSummary({ status: cycle.status, readiness });
  const chapterCompleteCount = chapters.filter((chapter) => chapter.status === "complete").length;
  const chapterReadyForReviewCount = chapters.filter((chapter) => chapter.status === "ready_for_review").length;
  const chapterInProgressCount = chapters.filter((chapter) => chapter.status === "in_progress").length;
  const constrainedProjectCount = linkedProjects.filter((link) => link.portfolio_role === "constrained").length;
  const illustrativeProjectCount = linkedProjects.filter((link) => link.portfolio_role === "illustrative").length;
  const candidateProjectCount = linkedProjects.filter((link) => link.portfolio_role === "candidate").length;
  const chapterTargetedCampaignCount = campaigns.filter((campaign) => Boolean(campaign.rtp_cycle_chapter_id)).length;
  const cycleTargetedCampaignCount = campaigns.length - chapterTargetedCampaignCount;

  return {
    readiness,
    workflow,
    chapterCompleteCount,
    chapterReadyForReviewCount,
    chapterInProgressCount,
    constrainedProjectCount,
    illustrativeProjectCount,
    candidateProjectCount,
    chapterTargetedCampaignCount,
    cycleTargetedCampaignCount,
  };
}

function buildRtpAdoptionRecordChecklist(input: {
  cycle: RtpExportCycle;
  chapters: RtpExportChapter[];
  stats: ReturnType<typeof buildRtpExportStats>;
}): Array<{ label: string; status: string; detail: string }> {
  const { cycle, chapters, stats } = input;
  const adoptionChapter = chapters.find(
    (chapter) =>
      chapter.section_type === "compliance" ||
      /adoption|compliance|appendix/i.test(`${chapter.title} ${chapter.section_type}`)
  );
  const publicReviewReady = Boolean(cycle.public_review_open_at && cycle.public_review_close_at);
  const chapterRecordReady = stats.chapterCompleteCount + stats.chapterReadyForReviewCount;

  return [
    {
      label: "Cycle status",
      status: formatRtpCycleStatusLabel(cycle.status),
      detail:
        cycle.status === "adopted"
          ? "Marked adopted for the permanent RTP record."
          : "Not yet marked adopted; keep draft/public-review posture visible for reviewers.",
    },
    {
      label: "Adoption target",
      status: formatRtpExportDate(cycle.adoption_target_date),
      detail: cycle.adoption_target_date
        ? "Target date is available for board calendar and packet cover checks."
        : "Add an adoption target date before board packet circulation.",
    },
    {
      label: "Public review window",
      status: publicReviewReady
        ? `${formatRtpExportDate(cycle.public_review_open_at)} → ${formatRtpExportDate(cycle.public_review_close_at)}`
        : "Not set",
      detail: publicReviewReady
        ? "Review window is recorded for comment-response and adoption findings."
        : "Record both public review open and close dates before adoption findings.",
    },
    {
      label: "Adoption/compliance chapter",
      status: adoptionChapter ? formatRtpChapterStatusLabel(adoptionChapter.status) : "Missing",
      detail: adoptionChapter
        ? `${adoptionChapter.title} is present in the chapter record.`
        : "Add the adoption package and compliance appendix chapter to preserve the board record.",
    },
    {
      label: "Chapter record",
      status: `${chapterRecordReady}/${chapters.length} complete or ready`,
      detail:
        chapters.length > 0
          ? "Use the chapter digest as the board packet completeness backstop."
          : "Create RTP chapters before circulating a board packet.",
    },
  ];
}


/**
 * The sentence that stops the two RTP documents from differing SILENTLY.
 *
 * A board packet composes itself from its report's own `report_sections` rows
 * and may legitimately leave sections out; the direct export has no report and
 * carries the whole plan. That is a fair difference — but for most of this
 * file's life NEITHER document said which it was, so a shorter packet and a
 * longer export were indistinguishable from two versions of the same plan.
 * "Included sections" alone does not close it: a reader sees what is present
 * and cannot see what was dropped. This names the source AND the omissions.
 */
function describeRtpExportComposition(
  composition: RtpExportComposition,
  enabledSectionKeys: RtpExportSectionKey[]
): string {
  const excluded = DEFAULT_RTP_EXPORT_SECTION_KEYS.filter((key) => !enabledSectionKeys.includes(key));

  if (composition === "whole_plan") {
    return "Composed as a whole-plan export: every section of the plan is included, with no report-specific section selection applied.";
  }

  if (excluded.length === 0) {
    return "Composed from this report's own section selection; every section of the plan is included.";
  }

  return `Composed from this report's own section selection. ${excluded.length} of ${DEFAULT_RTP_EXPORT_SECTION_KEYS.length} sections are excluded from this document and say nothing here: ${excluded
    .map((key) => titleizeRtpValue(key))
    .join(", ")}.`;
}

function buildRtpPacketScanSummary(input: {
  enabledSectionKeys: RtpExportSectionKey[];
  composition: RtpExportComposition;
  stats: ReturnType<typeof buildRtpExportStats>;
  chapters: RtpExportChapter[];
  linkedProjects: RtpExportNormalizedLinkedProject[];
  campaigns: RtpExportCampaign[];
}): string {
  const { enabledSectionKeys, composition, stats, chapters, linkedProjects, campaigns } = input;
  const visibleSections = enabledSectionKeys.map((key) => titleizeRtpValue(key)).join(" · ");

  return `
  <section class="packet-scan-summary" aria-label="Packet scan summary">
    <div>
      <p class="eyebrow">Release-review scan summary</p>
      <p class="muted">Use this packet summary for a quick completeness pass before sharing the RTP export with reviewers.</p>
    </div>
    <div class="scan-grid">
      <div class="scan-card"><strong>${esc(`${stats.chapterCompleteCount + stats.chapterReadyForReviewCount}/${chapters.length}`)}</strong><span>chapters complete or ready</span></div>
      <div class="scan-card"><strong>${linkedProjects.length}</strong><span>linked projects in portfolio</span></div>
      <div class="scan-card"><strong>${campaigns.length}</strong><span>engagement targets attached</span></div>
      <div class="scan-card"><strong>${esc(stats.readiness.label)}</strong><span>${esc(stats.workflow.label)}</span></div>
    </div>
    <p class="muted"><strong>Included sections:</strong> ${esc(visibleSections || "Default RTP packet sections")}</p>
    <p class="muted"><strong>How this document was composed:</strong> ${esc(
      describeRtpExportComposition(composition, enabledSectionKeys)
    )}</p>
  </section>`;
}

function modelingEvidenceMarkup(modelingEvidence: RtpExportModelingEvidence[]): string {
  return `
  <section class="section modeling-evidence">
    <h2>Assignment modeling claim posture</h2>
    <p class="muted">Structured source and validation evidence for any assignment-model language carried into this RTP packet.</p>
    ${
      // Stated, never silent. This section used to return an empty string, so a
      // plan with no model run reached a board with a modeling heading and
      // nothing under it — which reads as "the modeling is fine". It means only
      // that no structured modeling evidence was recorded.
      modelingEvidence.length === 0
        ? '<p class="muted">No county model run is attached to this plan, so no structured claim decision, source manifest or validation check is carried here. This document therefore makes no assignment-model claim — that is the absence of evidence, not evidence of a sound model.</p>'
        : modelingEvidence
      .map((item) => {
        const evidence = item.evidence;
        const claim = evidence?.claimDecision ?? null;
        const validationSummary = claim?.validationSummary ?? null;
        const validationRows = evidence?.validationResults ?? [];
        const sourceRows = evidence?.sourceManifests ?? [];
        const exportProof = buildReportModelingEvidenceExportProof(item);
        const validationSummaryText = validationSummary
          ? `${validationSummary.passed} pass · ${validationSummary.warned} warning · ${validationSummary.failed} fail`
          : `${validationRows.length} validation checks`;

        return `<div class="card modeling-evidence-card">
          <h3>${esc(item.geographyLabel?.trim() || item.runName?.trim() || "County model run")}</h3>
          <p class="muted">${esc(item.runName?.trim() || "County run")} · ${esc(
            titleizeRtpValue(item.stage || "unknown")
          )} · updated ${esc(formatRtpExportDateTime(item.updatedAt))}</p>
          ${
            claim
              ? `<p><strong>${esc(modelingClaimStatusLabel(claim.claimStatus))}:</strong> ${esc(
                  evidence?.reportLanguage ??
                    "Structured modeling evidence exists, but no report-language rule was recorded."
                )}</p>
          <p>${esc(claim.statusReason)}</p>
          ${
            claim.reasons.length > 0
              ? `<ul>${claim.reasons.slice(0, 4).map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul>`
              : ""
          }`
              : `<p><strong>Prototype-only:</strong> No structured claim decision is recorded for this county run, so model-backed language should not be used as an outward planning claim.</p>`
          }
          <div class="grid">
            <div class="card"><strong>Source manifests</strong><br/>${sourceRows.length}</div>
            <div class="card"><strong>Validation checks</strong><br/>${esc(validationSummaryText)}</div>
            <div class="card"><strong>Export readiness</strong><br/>${exportProof.exportReady ? "Ready with caveats" : "Hold"}</div>
          </div>
          <p class="muted"><strong>Export proof:</strong> ${esc(exportProof.sourceContext)}</p>
          <p class="muted">${esc(exportProof.exportReadiness)}</p>
          <p class="muted">${esc(exportProof.stalePacketLanguage)}</p>
          ${
            validationRows.length > 0
              ? `<ul class="compact-list">${validationRows
                  .map(
                    (result) =>
                      `<li><strong>${esc(result.metricLabel)}</strong> · ${esc(
                        formatModelingValidationStatusLabel(result.status)
                      )}<br/><span class="muted">${esc(result.detail)}</span></li>`
                  )
                  .join("")}</ul>`
              : '<p class="muted">No validation checks recorded.</p>'
          }
          ${
            sourceRows.length > 0
              ? `<p class="muted"><strong>Sources:</strong> ${esc(
                  sourceRows
                    .map((source) => source.sourceLabel)
                    .filter(Boolean)
                    .join("; ")
                )}</p>`
              : '<p class="muted">No source manifests recorded.</p>'
          }
        </div>`;
      })
      .join("")
    }
  </section>`;
}

function fundingSourceContextMarkup(input: {
  fundingSnapshot?: PortfolioFundingSnapshot | null;
  fundingProfileScans?: RtpExportFundingProfileScan[] | null;
  fundingSourceContextReadiness?: RtpExportFundingSourceContextReadiness | null;
}): string {
  const fundingSnapshot = input.fundingSnapshot ?? null;
  const fundingProfileScans = input.fundingProfileScans ?? [];
  const readiness = input.fundingSourceContextReadiness ?? null;

  // No early return. An absent funding basis used to erase the whole block, so
  // the portfolio section ended without saying whether the plan's money had
  // been looked at at all. The three branches below each state their own gap.

  const caveat =
    readiness?.operatorReviewCaveat ??
    "Operator review required. This funding/source-context scan supports planning packet review only; it is not legal compliance automation, award prediction, or autonomous approval.";

  return `
    <div class="card funding-source-context" style="margin-top:12px;">
      <h3>Funding source context</h3>
      <p class="muted">Captured during packet generation so RTP funding language can be reviewed against the project funding basis used for this artifact.</p>
      ${
        fundingSnapshot
          ? `<div class="grid">
              <div class="card"><strong>${esc(fundingSnapshot.label)}</strong><br/><span class="muted">${esc(fundingSnapshot.reason)}</span></div>
              <div class="card"><strong>${esc(formatRtpExportCurrency(fundingSnapshot.committedFundingAmount))}</strong><br/><span class="muted">committed funding captured</span></div>
              <div class="card"><strong>${esc(formatRtpExportCurrency(fundingSnapshot.unfundedAfterLikelyAmount))}</strong><br/><span class="muted">uncovered after likely dollars</span></div>
              <div class="card"><strong>${esc(fundingSnapshot.reimbursementLabel)}</strong><br/><span class="muted">${esc(fundingSnapshot.reimbursementReason)}</span></div>
            </div>`
          : '<p class="muted">No portfolio funding snapshot was captured.</p>'
      }
      ${
        readiness
          ? `<p><strong>${esc(readiness.label)}:</strong> ${esc(readiness.detail)}</p>
             <p class="muted">${esc(
               `${readiness.readyProjectScanCount} ready · ${readiness.attentionProjectScanCount} attention · ${readiness.blockedProjectScanCount} blocked project scans; ${readiness.modelingEvidenceCount} modeling evidence item(s); ${readiness.engagementReadyForHandoffCount} engagement item(s) ready for handoff.`
             )}</p>`
          : '<p class="muted">No funding source-context readiness was captured when this document was generated, so nothing here says whether the funding basis is fit for outside use.</p>'
      }
      ${
        fundingProfileScans.length > 0
          ? `<ul class="compact-list">${fundingProfileScans
              .map(
                (item) =>
                  `<li><strong>${esc(item.projectName ?? "Linked project")}</strong> · ${esc(
                    formatRtpPortfolioRoleLabel(item.portfolioRole ?? "candidate")
                  )} · ${esc(item.scan.label)}<br/><span class="muted">${esc(item.scan.nextAction)}</span><br/><span class="muted">Latest funding source update: ${esc(
                    formatRtpExportDateTime(item.latestFundingSourceUpdatedAt)
                  )}</span></li>`
              )
              .join("")}</ul>`
          : '<p class="muted">No linked-project funding scans were captured.</p>'
      }
      <p class="muted"><strong>Operator-review caveat:</strong> ${esc(caveat)}</p>
    </div>`;
}

/**
 * Every option the exported document can carry — each one REQUIRED.
 *
 * The required-ness is the load-bearing part, and it is why this type is
 * declared separately from `buildRtpExportHtml`'s own parameter. There are two
 * routes that render an RTP, and for most of this file's life one of them
 * passed ten options and the other passed three; nothing failed, because every
 * option was optional and every section fell back to silence. `RtpExportOptions`
 * is built in exactly ONE place — `buildRtpCycleExportInput` in `./export-input`
 * — so adding a field here fails the build at that single site, for both routes
 * at once, instead of type-checking happily in one and being forgotten in the
 * other.
 *
 * Nullable where the data may genuinely be absent. Absent is not the same as
 * undecided: an absent value is RENDERED as a stated gap, never skipped.
 */
export type RtpExportOptions = {
  /** Which sections this document contains. */
  sectionKeys: string[];
  /** Where that list came from. Printed, so a shorter document says it is one. */
  composition: RtpExportComposition;
  /** This document's own name, printed in the title and the eyebrow. */
  titleSuffix: string;
  publicReviewSummary: (RtpPublicReviewSummary & {
    cycleLevelCampaignCount?: number;
    chapterLevelCampaignCount?: number;
    pendingCommentCount?: number;
    readyCommentCount?: number;
  }) | null;
  modelingEvidence: RtpExportModelingEvidence[];
  fundingSnapshot: PortfolioFundingSnapshot | null;
  fundingProfileScans: RtpExportFundingProfileScan[] | null;
  fundingSourceContextReadiness: RtpExportFundingSourceContextReadiness | null;
  /**
   * The fiscal-constraint finding. Its ABSENCE is rendered rather than skipped:
   * a document with the financial element switched on and no finding must say
   * the finding was not supplied, or a reader takes the silence for "nothing to
   * report".
   */
  fiscalConstraint: RtpFiscalConstraintSummary | null;
  /** Periods, for grouping the project lists. */
  horizonBands: ReadonlyArray<{ id: string; label: string; startYear: number; endYear: number }> | null;
  /** What the public said and what the agency answered. */
  commentResponse: RtpCommentResponseSummary | null;
  /**
   * Which figures in this document were copied out of a plan document, keyed by
   * the id of the row that carries them.
   *
   * IN THE BODY, NOT AN APPENDIX (Nathaniel's Q2 decision, 2026-08-11). A board
   * member reading a programmed cost in the packet is the person who most needs
   * to know it was copied from page 44 of the adopted plan and what that page
   * says — and they need it beside the figure, at the meeting, not in a table
   * at the back.
   *
   * `null` means the citations were not supplied to this document; an empty
   * object means nothing in this plan was transcribed. The two are different
   * and only the second one is a statement about the plan.
   */
  transcriptions: Readonly<Record<string, TranscriptionRecord>> | null;
};

type RtpExportSubject = {
  cycle: RtpExportCycle;
  chapters: RtpExportChapter[];
  linkedProjects: RtpExportNormalizedLinkedProject[];
  campaigns: RtpExportCampaign[];
  /**
   * The priority criteria with the policy bases this workspace's jurisdiction
   * entitles it to cite. Required, not optional: an exported RTP is the
   * document a board adopts, and defaulting this would let the export quietly
   * fall back to whichever jurisdiction happened to be compiled in — which is
   * precisely how California statutes ended up in every agency's plan.
   */
  priorityCriteria: readonly ResolvedRtpPriorityCriterion[];
};

/**
 * A document with every option decided. Both export routes render one of these
 * and neither may assemble it — `buildRtpCycleExportInput` is the only producer.
 */
export type RtpExportDocumentInput = RtpExportSubject & { options: RtpExportOptions };

/**
 * The renderer still accepts a partial bag, for unit tests and for any future
 * one-off surface that renders a fragment of a plan. A ROUTE must never use
 * this form: a partial bag is exactly how the two live documents drifted apart.
 */
export type RtpExportHtmlInput = RtpExportSubject & { options?: Partial<RtpExportOptions> };

export function buildRtpExportHtml(input: RtpExportHtmlInput): string {
  const { cycle, chapters, linkedProjects, campaigns, priorityCriteria, options } = input;
  const campaignsByChapter = new Map<string, RtpExportCampaign[]>();
  const cycleCampaigns: RtpExportCampaign[] = [];
  for (const campaign of campaigns) {
    if (campaign.rtp_cycle_chapter_id) {
      const current = campaignsByChapter.get(campaign.rtp_cycle_chapter_id) ?? [];
      current.push(campaign);
      campaignsByChapter.set(campaign.rtp_cycle_chapter_id, current);
    } else {
      cycleCampaigns.push(campaign);
    }
  }

  const enabledSectionKeys = resolveEnabledSectionKeys(options?.sectionKeys);
  const composition: RtpExportComposition = options?.composition ?? "whole_plan";
  const stats = buildRtpExportStats({ cycle, chapters, linkedProjects, campaigns });
  const adoptionRecordChecklist = buildRtpAdoptionRecordChecklist({ cycle, chapters, stats });
  const titleSuffix = options?.titleSuffix ?? "OpenPlan RTP Export";
  const publicReviewSummary = options?.publicReviewSummary ?? null;
  const modelingEvidence = options?.modelingEvidence ?? [];
  const fundingSourceContext = fundingSourceContextMarkup({
    fundingSnapshot: options?.fundingSnapshot ?? null,
    fundingProfileScans: options?.fundingProfileScans ?? null,
    fundingSourceContextReadiness: options?.fundingSourceContextReadiness ?? null,
  });

  const sections: string[] = [];

  if (enabledSectionKeys.includes("cycle_overview")) {
    sections.push(`
  <section class="section">
    <h2>Cycle overview</h2>
    <p>${esc(cycle.summary?.trim() || "No cycle summary recorded yet.")}</p>
    <p>
      <span class="pill">${esc(formatRtpCycleStatusLabel(cycle.status))}</span>
      <span class="pill">${esc(cycle.geography_label?.trim() || "Geography not set")}</span>
      <span class="pill">Horizon ${esc(
        typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
          ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
          : "Not set"
      )}</span>
      <span class="pill">${esc(stats.readiness.label)}</span>
    </p>

    <div class="grid">
      <div class="card"><strong>Adoption target</strong><br/>${esc(formatRtpExportDate(cycle.adoption_target_date))}</div>
      <div class="card"><strong>Public review window</strong><br/>${esc(
        cycle.public_review_open_at && cycle.public_review_close_at
          ? `${formatRtpExportDate(cycle.public_review_open_at)} → ${formatRtpExportDate(cycle.public_review_close_at)}`
          : "Not set"
      )}</div>
      <div class="card"><strong>Linked projects</strong><br/>${linkedProjects.length}</div>
      <div class="card"><strong>Engagement targets</strong><br/>${campaigns.length}</div>
    </div>
  </section>`);
  }

  if (enabledSectionKeys.includes("chapter_digest")) {
    sections.push(`
  <section class="section">
    <h2>Chapter digest</h2>
    <p class="muted">${esc(`${stats.chapterCompleteCount} complete · ${stats.chapterReadyForReviewCount} ready for review · ${stats.chapterInProgressCount} in progress`)}</p>
    ${chapters
      .map(
        (chapter) => `<div class="card" style="margin-bottom:12px;">
          <h3>${esc(chapter.title)}</h3>
          <p class="muted">${esc(titleizeRtpValue(chapter.section_type))} · ${esc(formatRtpChapterStatusLabel(chapter.status))}</p>
          <p>${esc(chapter.summary?.trim() || "No working summary yet.")}</p>
          <div class="chapter-markdown">${
            chapter.content_markdown?.trim()
              ? renderChapterMarkdownToHtml(chapter.content_markdown)
              : esc("No draft chapter content yet.")
          }</div>
          <p class="muted">${esc(chapter.guidance?.trim() || "No editorial guidance yet.")}</p>
          <p><strong>Chapter campaigns:</strong> ${campaignsByChapter.get(chapter.id)?.length ?? 0}</p>
        </div>`
      )
      .join("")}
  </section>`);
  }

  if (enabledSectionKeys.includes("financial_element")) {
    const fiscal = options?.fiscalConstraint ?? null;
    sections.push(`
  <section class="section">
    <h2>Financial element</h2>
    ${
      fiscal
        ? `<p><strong>${esc(rtpFiscalVerdictLabel(fiscal.verdict))}</strong> · ${esc(
            fiscal.dollarBasis === "year_of_expenditure"
              ? "Year-of-expenditure dollars"
              : "Constant dollars — no inflation rate recorded"
          )}</p>
    <p>${esc(describeRtpFiscalConstraint(fiscal))}</p>
    ${
      fiscal.bands.length > 0
        ? `<table><thead><tr><th>Period</th><th>Revenue</th><th>Projects</th><th>O&amp;M</th><th>Balance</th></tr></thead><tbody>${fiscal.bands
            .map(
              (band) => `<tr><td>${esc(band.label)} (${band.startYear}–${band.endYear})</td><td>${esc(
                formatRtpExportCurrency(band.revenue)
              )}</td><td>${esc(formatRtpExportCurrency(band.capitalCost))}</td><td>${esc(
                formatRtpExportCurrency(band.operationsMaintenanceCost)
              )}</td><td>${esc(
                band.verdict === "not_determined" ? "—" : formatRtpExportCurrency(band.balance)
              )}</td></tr>`
            )
            .join("")}</tbody></table>`
        : '<p class="muted">No horizon periods have been declared for this plan, so revenue and costs belong to no period.</p>'
    }`
        : // Enabled but not supplied. Stated, never silent — a blank financial
          // element in an adopted packet reads as "nothing to report".
          '<p class="muted">The fiscal-constraint finding was not included when this packet was generated, so this section states nothing about whether the plan can be paid for.</p>'
    }
  </section>`);
  }

  if (enabledSectionKeys.includes("project_lists")) {
    const bands = options?.horizonBands ?? [];
    const transcriptions = options?.transcriptions ?? null;
    const bandById = new Map(bands.map((band) => [band.id, band]));
    // Grouped exactly as the on-screen lists are, so the document a board reads
    // and the page a planner edits cannot present the plan differently.
    const groups = new Map<string, { label: string; role: string; rows: RtpExportNormalizedLinkedProject[] }>();
    for (const link of linkedProjects) {
      const band = link.horizon_band_id ? bandById.get(link.horizon_band_id) : undefined;
      const key = `${band?.id ?? "__unassigned__"}::${link.portfolio_role}`;
      const group = groups.get(key) ?? {
        label: band ? `${band.label} (${band.startYear}–${band.endYear})` : "No period assigned",
        role: link.portfolio_role,
        rows: [],
      };
      group.rows.push(link);
      groups.set(key, group);
    }

    // NULL IS NOT AN EMPTY MAP. "The citations were not supplied to this
    // document" and "nothing in this plan was copied out of a document" are
    // different facts, and only the second one is a statement about the plan.
    // The first is stated rather than skipped, because a packet that silently
    // dropped its page citations looks exactly like a plan somebody typed by
    // hand.
    const citationsUnavailable =
      transcriptions === null
        ? '<p class="muted">Where these figures came from could not be read when this document was generated, so no page citations are shown against them. This does not mean they were entered by hand.</p>'
        : "";

    sections.push(`
  <section class="section">
    <h2>Project lists</h2>
    ${citationsUnavailable}
    ${
      groups.size === 0
        ? '<p class="muted">No projects are linked to this plan yet.</p>'
        : [...groups.values()]
            .map((group) => {
              const priced = group.rows
                .map((row) => parseOptionalAmount(row.estimated_cost))
                .filter((amount): amount is number => amount !== null);
              const unpricedCount = group.rows.length - priced.length;
              const total = priced.reduce((sum, amount) => sum + amount, 0);
              // Never "$0" for a group nothing is priced in.
              const subtotal =
                unpricedCount === group.rows.length
                  ? `No costs recorded for ${group.rows.length} project${group.rows.length === 1 ? "" : "s"}`
                  : unpricedCount > 0
                    ? `${formatRtpExportCurrency(total)} so far — ${unpricedCount} of ${group.rows.length} projects ${unpricedCount === 1 ? "has" : "have"} no cost recorded`
                    : `${formatRtpExportCurrency(total)} across ${group.rows.length} project${group.rows.length === 1 ? "" : "s"}`;

              return `<div class="card" style="margin-bottom:12px;">
          <h3>${esc(group.label)} · ${esc(formatRtpPortfolioRoleLabel(group.role))}</h3>
          <p class="muted">${esc(subtotal)}</p>
          <ul>${group.rows
            .map((row) => {
              const cost = parseOptionalAmount(row.estimated_cost);
              // The page this cost was copied from, printed with the figure.
              // Nothing at all for a cost somebody typed — the absence of a
              // citation is the honest rendering of a hand-entered number.
              const transcription = transcriptions?.[row.id] ?? null;
              const citation = transcription
                ? `<span class="muted"> — ${esc(exportProvenanceLine(transcription))}</span>`
                : "";
              return `<li>${esc(row.project?.name ?? "Linked project")} — ${esc(
                cost === null ? "no cost recorded" : formatRtpExportCurrency(cost)
              )}${row.cost_basis_year && cost !== null ? esc(` (${row.cost_basis_year} dollars)`) : ""}${citation}</li>`;
            })
            .join("")}</ul>
        </div>`;
            })
            .join("")
    }
  </section>`);
  }

  if (enabledSectionKeys.includes("comment_response")) {
    const record = options?.commentResponse ?? null;
    sections.push(`
  <section class="section">
    <h2>Comment-response record</h2>
    ${
      record
        ? `<p>${esc(describeRtpCommentResponse(record))}</p>
    ${
      record.entries.length === 0
        ? '<p class="muted">No approved public comments are in the record.</p>'
        : `<ul>${record.entries
            .map(
              (entry) =>
                `<li><p>${esc(entry.comment.body)}</p><p class="muted">${esc(
                  entry.response
                    ? `Our response: ${entry.response.weDid || entry.response.youSaid}`
                    : "No published response yet."
                )}</p></li>`
            )
            .join("")}</ul>`
    }`
        : '<p class="muted">The comment-response record was not included when this packet was generated, so this section states nothing about what the public said or how the agency answered.</p>'
    }
  </section>`);
  }

  if (enabledSectionKeys.includes("portfolio_posture")) {
    const priorityTierCounts = { high: 0, medium: 0, low: 0, unscored: 0 };
    for (const link of linkedProjects) {
      priorityTierCounts[computeRtpPriorityScore(link.priority_scores ?? {}).tier] += 1;
    }
    const priorityRollup = `${priorityTierCounts.high} high · ${priorityTierCounts.medium} moderate · ${priorityTierCounts.low} lower · ${priorityTierCounts.unscored} unscored`;
    const portfolioPriority = buildPortfolioPriorityNarrative(linkedProjects.map((link) => link.priority_scores ?? {}), priorityCriteria);

    sections.push(`
  <section class="section">
    <h2>Portfolio posture</h2>
    <p class="muted">${esc(`${stats.constrainedProjectCount} constrained · ${stats.illustrativeProjectCount} illustrative · ${stats.candidateProjectCount} candidate`)}</p>
    <p class="muted">Priority mix (VMT/GHG/safety/equity + local–federal alignment): ${esc(priorityRollup)}</p>
    ${portfolioPriority.scoredCount > 0 ? `<p><strong>Why this portfolio:</strong> ${esc(portfolioPriority.narrative)}</p>` : ""}
    ${linkedProjects.length === 0 ? '<p class="muted">No linked projects yet.</p>' : ""}
    ${linkedProjects
      .map((link) => {
        const priority = buildRtpPriorityRationale(link.priority_scores ?? {}, priorityCriteria);
        const scored = priority.summary.scoredCriteria > 0;
        const priorityMeta = scored
          ? ` · Priority ${priority.summary.composite}/100 (${esc(priorityTierLabel(priority.summary.tier))})`
          : "";
        const rationaleText = scored
          ? priority.narrative
          : link.priority_rationale?.trim() || link.project?.summary?.trim() || "No prioritization rationale recorded yet.";
        return `<div class="card" style="margin-bottom:12px;">
          <h3>${esc(link.project?.name ?? "Linked project")}</h3>
          <p class="muted">${esc(formatRtpPortfolioRoleLabel(link.portfolio_role))} · ${esc(titleizeRtpValue(link.project?.status || "draft"))}${priorityMeta}</p>
          <p>${esc(rationaleText)}</p>
        </div>`;
      })
      .join("")}
    ${fundingSourceContext}
  </section>`);
  }

  if (enabledSectionKeys.includes("engagement_posture")) {
    sections.push(`
  <section class="section">
    <h2>Engagement posture</h2>
    <p class="muted">${esc(`${stats.cycleTargetedCampaignCount} cycle-targeted · ${stats.chapterTargetedCampaignCount} chapter-targeted`)}</p>
    ${publicReviewSummary ? `<div class="card" style="margin-bottom:12px;"><h3>${esc(publicReviewSummary.label)}</h3><p>${esc(publicReviewSummary.detail)}</p><p class="muted">${esc(`${publicReviewSummary.cycleLevelCampaignCount ?? stats.cycleTargetedCampaignCount} cycle targets · ${publicReviewSummary.chapterLevelCampaignCount ?? stats.chapterTargetedCampaignCount} chapter targets · ${publicReviewSummary.readyCommentCount ?? 0} ready comments · ${publicReviewSummary.pendingCommentCount ?? 0} pending comments`)}</p></div>` : '<p class="muted">No public-review posture was supplied when this document was generated, so the comment counts below are the only account of the review period given here.</p>'}
    ${campaigns.length === 0 ? '<p class="muted">No RTP-linked engagement campaigns yet.</p>' : ""}
    <ul>
      ${campaigns
        .map(
          (campaign) => `<li><strong>${esc(campaign.title)}</strong> · ${esc(titleizeRtpValue(campaign.status))} · ${esc(
            titleizeRtpValue(campaign.engagement_type)
          )}${campaign.rtp_cycle_chapter_id ? " · chapter-targeted" : " · cycle-targeted"}<br/>${esc(
            campaign.summary?.trim() || "No engagement summary recorded yet."
          )}</li>`
        )
        .join("")}
    </ul>
    ${cycleCampaigns.length > 0 ? `<p class="muted">Cycle-level campaigns: ${cycleCampaigns.length}</p>` : ""}
  </section>`);
  }

  if (enabledSectionKeys.includes("adoption_readiness")) {
    sections.push(`
  <section class="section">
    <h2>Adoption readiness</h2>
    <div class="card" style="margin-bottom:12px;">
      <h3>${esc(stats.readiness.label)}</h3>
      <p>${esc(stats.readiness.reason)}</p>
      <p class="muted">${esc(stats.workflow.label)} · ${esc(stats.workflow.detail)}</p>
    </div>
    <div class="card" style="margin-bottom:12px;">
      <h3>Adoption record checklist</h3>
      <p class="muted">Board packet readiness, public-review dates, and adoption/compliance chapter posture in one scan-friendly record.</p>
      <ul class="compact-list">
        ${adoptionRecordChecklist
          .map(
            (item) => `<li><strong>${esc(item.label)}:</strong> ${esc(item.status)}<br/><span class="muted">${esc(item.detail)}</span></li>`
          )
          .join("")}
      </ul>
    </div>
    <div class="grid">
      ${stats.readiness.checks
        .map(
          (check) => `<div class="card"><strong>${esc(check.label)}</strong><br/>${esc(check.ready ? "Ready" : "Missing")}<br/><span class="muted">${esc(check.detail)}</span></div>`
        )
        .join("")}
    </div>
    ${stats.readiness.nextSteps.length > 0 ? `<ul>${stats.readiness.nextSteps.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}
  </section>`);
  }

  // Unconditional. A `length > 0` guard here was what actually dropped this
  // section from a document — not the empty-string return inside the builder,
  // which this guard made unreachable — and a modeling section that vanishes
  // when there is no model is indistinguishable from a plan that has one.
  sections.push(modelingEvidenceMarkup(modelingEvidence));

  if (enabledSectionKeys.includes("appendix_references")) {
    sections.push(`
  <section class="section">
    <h2>Appendix and references</h2>
    <div class="card">
      <p><strong>Packet composition:</strong> ${esc(enabledSectionKeys.join(", "))}</p>
      <p><strong>Cycle updated:</strong> ${esc(new Date(cycle.updated_at).toLocaleString())}</p>
      <p><strong>Chapter count:</strong> ${chapters.length}</p>
      <p><strong>Linked projects:</strong> ${linkedProjects.length}</p>
      <p><strong>Engagement targets:</strong> ${campaigns.length}</p>
      <p class="muted">Use the linked digital RTP document view and dedicated export surfaces for companion review materials.</p>
    </div>
  </section>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(cycle.title)} · ${esc(titleSuffix)}</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; color: #16202a; margin: 40px; line-height: 1.5; }
    h1,h2,h3 { margin: 0 0 10px; }
    .muted { color: #5f6b76; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
    .card { border: 1px solid #d8dee4; border-radius: 16px; padding: 16px; background: #fff; }
    .section { margin-top: 28px; }
    .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; border: 1px solid #d8dee4; font-size: 12px; margin-right: 8px; }
    .eyebrow { margin: 0 0 4px; color: #3e4a55; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .packet-scan-summary { margin-top: 18px; padding: 18px; border: 1px solid #d8dee4; border-radius: 18px; background: #f8fafc; }
    .scan-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
    .scan-card { border: 1px solid #d8dee4; border-radius: 14px; padding: 12px; background: #fff; }
    .scan-card strong { display: block; font-size: 1.05em; }
    .scan-card span { display: block; color: #5f6b76; font-size: 12px; margin-top: 2px; }
    ul { padding-left: 20px; }
    .compact-list li { margin-bottom: 10px; }
    .modeling-evidence-card { margin-bottom: 12px; border-left: 4px solid #7a3d5f; }
    .chapter-markdown { line-height: 1.7; margin-top: 8px; }
    .chapter-markdown > *:first-child { margin-top: 0; }
    .chapter-markdown > *:last-child { margin-bottom: 0; }
    .chapter-markdown h1, .chapter-markdown h2, .chapter-markdown h3, .chapter-markdown h4 {
      font-weight: 600; color: #16202a; margin: 1.2em 0 0.5em; letter-spacing: -0.01em;
    }
    .chapter-markdown h1 { font-size: 1.25em; }
    .chapter-markdown h2 { font-size: 1.12em; }
    .chapter-markdown h3 { font-size: 1em; text-transform: uppercase; letter-spacing: 0.04em; color: #3e4a55; }
    .chapter-markdown p { margin: 0.6em 0; }
    .chapter-markdown ul, .chapter-markdown ol { margin: 0.6em 0; padding-left: 1.3em; }
    .chapter-markdown li { margin: 0.25em 0; }
    .chapter-markdown blockquote {
      margin: 1em 0; padding: 0.6em 0.9em;
      border-left: 3px solid #c9d1d9; background: #f4f4f5;
      border-radius: 0 6px 6px 0; color: #34404a;
    }
    .chapter-markdown blockquote > :first-child { margin-top: 0; }
    .chapter-markdown blockquote > :last-child { margin-bottom: 0; }
    .chapter-markdown code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.9em; padding: 0.1em 0.35em; background: #eef0f2; border-radius: 4px;
    }
    .chapter-markdown pre {
      margin: 0.8em 0; padding: 0.75em 1em; background: #eef0f2;
      border-radius: 6px; overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.9em; line-height: 1.55;
    }
    .chapter-markdown pre code { padding: 0; background: transparent; }
    .chapter-markdown-table-wrap { overflow-x: auto; margin: 0.8em 0; }
    .chapter-markdown-table-wrap table { margin: 0; }
    .chapter-markdown table { width: 100%; border-collapse: collapse; font-size: 0.95em; }
    .chapter-markdown th, .chapter-markdown td {
      padding: 0.45em 0.65em; border-bottom: 1px solid #e2e6ea;
      text-align: left; vertical-align: top;
    }
    .chapter-markdown th { background: #f4f4f5; font-weight: 600; border-bottom-width: 2px; }
    .chapter-markdown a { color: #34404a; text-decoration: underline; text-underline-offset: 2px; }
    .chapter-markdown strong { font-weight: 600; color: #16202a; }
    .chapter-markdown hr { border: 0; border-top: 1px solid #dadfe4; margin: 1.2em 0; }
  </style>
</head>
<body>
  <p class="muted">${esc(titleSuffix)} · Generated ${esc(new Date().toLocaleString())}</p>
  <h1>${esc(cycle.title)}</h1>
  ${buildRtpPacketScanSummary({ enabledSectionKeys, composition, stats, chapters, linkedProjects, campaigns })}
  ${sections.join("\n")}
</body>
</html>`;
}
