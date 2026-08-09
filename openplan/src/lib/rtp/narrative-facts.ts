/**
 * RTP chapter narrative facts — the numbered fact list a chapter draft may
 * cite, assembled from the SAME deterministic summaries the RTP packet path
 * renders (cycle readiness/workflow, linked-project funding, engagement
 * posture, county-run modeling evidence) plus workspace Knowledge Base
 * excerpts matched to the chapter.
 *
 * The draft this grounds is writing ASSIST only: `rtp_cycle_chapters.
 * content_markdown` remains the sole published chapter content, and a draft
 * reaches it exclusively through the operator's own editor insert.
 */

import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { buildNarrativeFactList, type NarrativeFact } from "@/lib/grants/narrative-grounding";
import type { PortfolioFundingSnapshot } from "@/lib/projects/funding";
import { type ReportModelingEvidence } from "@/lib/reports/modeling-evidence";
import { modelingClaimStatusLabel } from "@/lib/models/evidence-backbone";
import {
  formatRtpChapterStatusLabel,
  formatRtpDate,
  titleizeRtpValue,
  type RtpCycleReadinessSummary,
  type RtpCycleWorkflowSummary,
} from "@/lib/rtp/catalog";
import {
  describeRtpFiscalConstraint,
  rtpFiscalVerdictLabel,
  type RtpFiscalConstraintSummary,
} from "@/lib/rtp/fiscal-constraint";

export type RtpChapterFactsInput = {
  chapter: {
    title: string;
    section_type: string | null;
    status: string | null;
    summary: string | null;
    guidance: string | null;
  };
  cycle: {
    title: string;
    status: string | null;
    geography_label: string | null;
    horizon_start_year: number | null;
    horizon_end_year: number | null;
    adoption_target_date: string | null;
    public_review_open_at: string | null;
    public_review_close_at: string | null;
  };
  readiness: RtpCycleReadinessSummary;
  workflow: RtpCycleWorkflowSummary;
  linkedProjects: Array<{ name: string | null; portfolioRole: string | null }>;
  portfolioFunding: PortfolioFundingSnapshot | null;
  engagement: {
    campaignCount: number;
    cycleLevelCampaignCount: number;
    chapterLevelCampaignCount: number;
    totalItems: number;
    approvedCount: number;
    readyForHandoffCount: number;
    pendingCount: number;
  } | null;
  modelingEvidence: ReportModelingEvidence[];
  /**
   * The cycle's own fiscal-constraint finding, or null when the caller could
   * not compute one.
   *
   * WHY A CHAPTER DRAFT NEEDS THIS. Without it, the fact list said nothing at
   * all about fiscal constraint — including when drafting the chapter whose
   * entire subject is fiscal constraint. Observed on a cycle with no revenue
   * rows, no horizon bands and no linked projects, whose verdict is therefore
   * `not_determined`: the draft asserted that "the revenues anticipated over
   * the twenty-four-year planning period are sufficient to cover the costs of
   * projects and programs included in the constrained network".
   *
   * The grounding checker did flag that sentence, but only as UNCITED, because
   * there was no fact for it to contradict. "No citation" reads as "add a
   * source"; a planner can reasonably keep a sentence that looks like standard
   * RTP language. With the verdict present the sentence is contradicted by a
   * fact rather than merely unsupported, and the model has the real finding to
   * cite instead of plausible boilerplate.
   *
   * Null is passed through rather than defaulted, because inventing "not
   * determined" for a cycle whose ledger could not be READ would be the same
   * class of false certainty this fact exists to prevent.
   */
  fiscalConstraint: RtpFiscalConstraintSummary | null;
  /** Pre-built KB claims (buildKnowledgeBaseFactClaims) — each already carries KB_NARRATIVE_CAVEAT. */
  kbClaims: string[];
};

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function portfolioRoleBreakdown(linkedProjects: RtpChapterFactsInput["linkedProjects"]): string {
  const byRole = new Map<string, number>();
  for (const link of linkedProjects) {
    const role = titleizeRtpValue(link.portfolioRole ?? "unassigned");
    byRole.set(role, (byRole.get(role) ?? 0) + 1);
  }
  return Array.from(byRole.entries())
    .map(([role, count]) => `${count} ${role.toLowerCase()}`)
    .join(", ");
}

function modelingEvidenceClaims(modelingEvidence: ReportModelingEvidence[]): string[] {
  return modelingEvidence.map((item) => {
    const label = item.geographyLabel?.trim() || item.runName?.trim() || "County model run";
    const claim = item.evidence?.claimDecision ?? null;
    const validationSummary = claim?.validationSummary ?? null;
    const validationText = validationSummary
      ? ` Validation checks: ${validationSummary.passed} pass, ${validationSummary.warned} warning, ${validationSummary.failed} fail.`
      : "";
    // The claim registry's own report language is the honest framing — never
    // upgraded here, and its absence is stated as a prohibition.
    const claimText = claim
      ? `${modelingClaimStatusLabel(claim.claimStatus)} — ${
          item.evidence?.reportLanguage ?? claim.statusReason
        }`
      : "no structured claim decision is recorded, so model-backed language must not be used as an outward planning claim";
    return `Modeling evidence "${label}" (stage "${titleizeRtpValue(item.stage ?? "unknown")}"): ${claimText}.${validationText}`;
  });
}

/**
 * The numbered fact list for one RTP chapter draft. Every value is a stored
 * record or a deterministic summary already used by the RTP packet path —
 * a chapter draft can only cite what the cycle actually shows.
 */
export function buildRtpChapterFacts(input: RtpChapterFactsInput): NarrativeFact[] {
  const { chapter, cycle, readiness, workflow, linkedProjects, portfolioFunding, engagement } = input;
  const horizonText =
    typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
      ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
      : null;

  return buildNarrativeFactList([
    `The RTP chapter "${chapter.title}"${
      chapter.section_type ? ` (${titleizeRtpValue(chapter.section_type)} section)` : ""
    } is in status "${formatRtpChapterStatusLabel(chapter.status)}" within the RTP cycle "${cycle.title}".`,
    chapter.summary?.trim() ? `Chapter working summary on record: ${chapter.summary.trim()}` : null,
    chapter.guidance?.trim() ? `Chapter editorial guidance on record: ${chapter.guidance.trim()}` : null,
    cycle.geography_label?.trim()
      ? `The RTP cycle covers the geography "${cycle.geography_label.trim()}"${horizonText ? ` with planning horizon ${horizonText}` : ""}.`
      : horizonText
        ? `The RTP cycle planning horizon is ${horizonText}.`
        : null,
    cycle.adoption_target_date
      ? `The target board adoption date on record is ${formatRtpDate(cycle.adoption_target_date)}.`
      : null,
    cycle.public_review_open_at && cycle.public_review_close_at
      ? `The public review window on record runs ${formatRtpDate(cycle.public_review_open_at)} through ${formatRtpDate(cycle.public_review_close_at)}.`
      : null,
    `Cycle readiness: ${readiness.label} — ${readiness.reason} (${readiness.readyCheckCount} of ${readiness.totalCheckCount} readiness checks in place).`,
    `Cycle workflow posture: ${workflow.label} — ${workflow.detail}`,
    linkedProjects.length > 0
      ? `${linkedProjects.length} project(s) are linked to this RTP cycle: ${portfolioRoleBreakdown(linkedProjects)}.`
      : `No projects are linked to this RTP cycle yet.`,
    portfolioFunding
      ? `Linked-project funding posture: ${portfolioFunding.label} — ${portfolioFunding.reason}`
      : null,
    portfolioFunding && portfolioFunding.trackedProjectCount > 0
      ? `Across ${portfolioFunding.trackedProjectCount} tracked project(s): ${formatAmount(portfolioFunding.committedFundingAmount)} committed, ${formatAmount(portfolioFunding.likelyFundingAmount)} pursued-likely, ${formatAmount(portfolioFunding.unfundedAfterLikelyAmount)} uncovered after likely dollars; ${portfolioFunding.fundedProjectCount} funded, ${portfolioFunding.gapProjectCount} with a funding gap.`
      : null,
    engagement && engagement.campaignCount > 0
      ? `${engagement.campaignCount} engagement campaign(s) are attached to this cycle (${engagement.cycleLevelCampaignCount} cycle-level, ${engagement.chapterLevelCampaignCount} chapter-level) with ${engagement.totalItems} submitted comment(s): ${engagement.approvedCount} approved, ${engagement.readyForHandoffCount} ready for handoff, ${engagement.pendingCount} pending moderation. ${ENGAGEMENT_NARRATIVE_CAVEAT}`
      : null,
    /*
      The fiscal verdict in the engine's OWN words.

      `describeRtpFiscalConstraint` is the same sentence the export renders, so
      a chapter draft and the exported financial element cannot describe the
      plan's fiscal posture differently. Restating it here in friendlier prose
      is exactly how two surfaces come to disagree about whether a plan is
      constrained.
    */
    input.fiscalConstraint
      ? `Fiscal constraint finding for this cycle: ${rtpFiscalVerdictLabel(
          input.fiscalConstraint.verdict
        )} — ${describeRtpFiscalConstraint(input.fiscalConstraint)}${
          input.fiscalConstraint.verdict === "not_determined"
            ? " Do not state or imply that this plan is fiscally constrained, that revenues cover programmed costs, or that a constraint demonstration exists, while this finding is not determined."
            : ""
        }`
      : null,
    ...modelingEvidenceClaims(input.modelingEvidence),
    ...input.kbClaims,
  ]);
}
