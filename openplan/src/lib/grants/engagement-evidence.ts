// Public-engagement evidence for the grants lane.
//
// Community support is a scored criterion in RAISE, SS4A, and ATIIP-class
// programs, and OpenPlan already computes citable engagement artifacts: the
// per-campaign AI synthesis cache (E1, `engagement_campaigns.ai_synthesis_json`)
// and the spatial representativeness screening cache (E5b,
// `representativeness_json`). This module READS those caches — it never
// recomputes them — and turns them into narrative fact claims for the
// [fact:N] grounding contract plus a compact evidence-readiness cue, mirroring
// `bca-evidence.ts`. House pattern: stored JSON is parsed defensively; a row
// that does not carry the expected shape is treated as if no evidence exists.

// Type-only import: ai-synthesis.ts pulls the AI SDK in at module top, and this
// module is reached from client components via evidence-readiness. The runtime
// sentiment set is mirrored locally (locked together by a test).
import type { EngagementSentiment } from "@/lib/engagement/ai-synthesis";
import { REPRESENTATIVENESS_SCREENING_CAVEAT } from "@/lib/engagement/representativeness";
import { formatSavedDate } from "@/lib/grants/bca-evidence";

const SENTIMENT_VALUES: readonly EngagementSentiment[] = [
  "positive",
  "mixed",
  "neutral",
  "negative",
];

export const ENGAGEMENT_NARRATIVE_CAVEAT =
  "Community-input statements summarize submitted public comments only — a screening-grade synthesis of who chose to comment, not a statistically representative survey, a vote, or a legal-sufficiency finding.";

export interface ProjectEngagementCampaignRowLike {
  id: string;
  project_id: string | null;
  title: string;
  status: string;
  updated_at: string | null;
  ai_synthesis_json: unknown;
  ai_synthesized_at: string | null;
  representativeness_json: unknown;
  representativeness_computed_at: string | null;
}

export type EngagementSynthesisEvidence = {
  source: "ai" | "deterministic-fallback";
  analyzedItemCount: number;
  overallSentiment: EngagementSentiment;
  /** Top themes by item count (at most three), for narrative facts. */
  themes: Array<{ label: string; sentiment: EngagementSentiment; itemCount: number }>;
};

export type EngagementRepresentativenessEvidence = {
  respondentCount: number;
  tractCount: number;
  /** Metric labels whose status is "under" (e.g. "Zero-vehicle households"). */
  underRepresentedLabels: string[];
  /** True when no metric could be compared (small-N / no geolocated respondents). */
  insufficient: boolean;
};

export type ProjectEngagementEvidence = {
  projectId: string;
  /** Non-archived campaigns linked to the project. */
  campaignCount: number;
  leadCampaign: {
    id: string;
    title: string;
    status: string;
    synthesis: EngagementSynthesisEvidence | null;
    synthesizedAt: string | null;
    representativeness: EngagementRepresentativenessEvidence | null;
    representativenessComputedAt: string | null;
  };
};

function finiteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function normalizeSentiment(value: unknown): EngagementSentiment | null {
  return typeof value === "string" && (SENTIMENT_VALUES as readonly string[]).includes(value)
    ? (value as EngagementSentiment)
    : null;
}

/**
 * Defensive parse of a stored `ai_synthesis_json` value down to the fields the
 * grants lane cites. Returns null when the headline fields are missing so a
 * malformed cache reads as "no synthesis" rather than a fabricated claim.
 */
export function parseStoredEngagementSynthesis(value: unknown): EngagementSynthesisEvidence | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const source =
    record.source === "ai" || record.source === "deterministic-fallback" ? record.source : null;
  const analyzedItemCount = finiteCount(record.analyzed_item_count);
  const overallSentiment = normalizeSentiment(record.overall_sentiment);
  if (!source || analyzedItemCount === null || overallSentiment === null) return null;

  const themesRaw = Array.isArray(record.themes) ? record.themes : [];
  const themes = themesRaw
    .flatMap((theme) => {
      if (!theme || typeof theme !== "object") return [];
      const themeRecord = theme as Record<string, unknown>;
      const label = typeof themeRecord.label === "string" ? themeRecord.label.trim() : "";
      const itemCount = finiteCount(themeRecord.item_count);
      const sentiment = normalizeSentiment(themeRecord.sentiment);
      return label && itemCount !== null && itemCount > 0 && sentiment !== null
        ? [{ label, sentiment, itemCount }]
        : [];
    })
    .sort((left, right) => right.itemCount - left.itemCount)
    .slice(0, 3);

  return { source, analyzedItemCount, overallSentiment, themes };
}

const REPRESENTATION_STATUSES = ["over", "under", "balanced", "insufficient"] as const;

/**
 * Defensive parse of a stored `representativeness_json` value down to the
 * screening verdict the grants lane cites.
 */
export function parseStoredRepresentativeness(
  value: unknown
): EngagementRepresentativenessEvidence | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const respondentCount = finiteCount(record.respondentCount);
  const tractCount = finiteCount(record.tractCount);
  if (respondentCount === null || tractCount === null || !Array.isArray(record.metrics)) {
    return null;
  }

  const metrics = record.metrics.flatMap((metric) => {
    if (!metric || typeof metric !== "object") return [];
    const metricRecord = metric as Record<string, unknown>;
    const label = typeof metricRecord.label === "string" ? metricRecord.label.trim() : "";
    const status = (REPRESENTATION_STATUSES as readonly string[]).includes(
      String(metricRecord.status)
    )
      ? (metricRecord.status as (typeof REPRESENTATION_STATUSES)[number])
      : null;
    return label && status ? [{ label, status }] : [];
  });
  if (metrics.length === 0) return null;

  return {
    respondentCount,
    tractCount,
    underRepresentedLabels: metrics
      .filter((metric) => metric.status === "under")
      .map((metric) => metric.label),
    insufficient: metrics.every((metric) => metric.status === "insufficient"),
  };
}

const LEAD_ELIGIBLE_STATUSES = new Set(["draft", "active", "closed"]);

/**
 * Group campaign rows by project and pick a lead campaign per project: the one
 * with a parseable synthesis covering the most comments, tie-broken by most
 * recent update. Archived campaigns are excluded entirely. Rows without a
 * project link are skipped (the grants lane only cites project-linked input).
 */
export function buildProjectEngagementEvidenceByProjectId(
  rows: ProjectEngagementCampaignRowLike[] | null | undefined
): Map<string, ProjectEngagementEvidence> {
  type Candidate = {
    row: ProjectEngagementCampaignRowLike;
    synthesis: EngagementSynthesisEvidence | null;
    representativeness: EngagementRepresentativenessEvidence | null;
  };

  const candidatesByProject = new Map<string, Candidate[]>();
  for (const row of rows ?? []) {
    if (!row.project_id || !LEAD_ELIGIBLE_STATUSES.has(row.status)) continue;
    const candidates = candidatesByProject.get(row.project_id) ?? [];
    candidates.push({
      row,
      synthesis: parseStoredEngagementSynthesis(row.ai_synthesis_json),
      representativeness: parseStoredRepresentativeness(row.representativeness_json),
    });
    candidatesByProject.set(row.project_id, candidates);
  }

  const evidenceByProject = new Map<string, ProjectEngagementEvidence>();
  for (const [projectId, candidates] of candidatesByProject.entries()) {
    const lead = [...candidates].sort((left, right) => {
      const leftItems = left.synthesis?.analyzedItemCount ?? -1;
      const rightItems = right.synthesis?.analyzedItemCount ?? -1;
      if (rightItems !== leftItems) return rightItems - leftItems;
      return (
        (Date.parse(right.row.updated_at ?? "") || 0) -
        (Date.parse(left.row.updated_at ?? "") || 0)
      );
    })[0];

    evidenceByProject.set(projectId, {
      projectId,
      campaignCount: candidates.length,
      leadCampaign: {
        id: lead.row.id,
        title: lead.row.title,
        status: lead.row.status,
        synthesis: lead.synthesis,
        synthesizedAt: lead.row.ai_synthesized_at,
        representativeness: lead.representativeness,
        representativenessComputedAt: lead.row.representativeness_computed_at,
      },
    });
  }

  return evidenceByProject;
}

function sentimentPhrase(sentiment: EngagementSentiment): string {
  return sentiment === "mixed" ? "mixed" : `predominantly ${sentiment}`;
}

/**
 * Single-sentence claims for the narrative fact list. Synthesis-derived claims
 * carry ENGAGEMENT_NARRATIVE_CAVEAT verbatim; the representativeness claim
 * carries the screening's own caveat — mirroring how BCA facts embed
 * BCA_NARRATIVE_CAVEAT.
 */
export function buildEngagementFactClaims(
  evidence: ProjectEngagementEvidence,
  projectName?: string | null
): string[] {
  const subject = projectName ? `the ${projectName} project` : "the linked project";
  const lead = evidence.leadCampaign;
  const claims: string[] = [
    `${evidence.campaignCount} public engagement campaign(s) are on record for ${subject}; the lead campaign is "${lead.title}" (status: ${lead.status}).`,
  ];

  if (lead.synthesis) {
    const method =
      lead.synthesis.source === "ai"
        ? "An AI-assisted synthesis"
        : "A keyword-based synthesis (computed while AI was offline)";
    claims.push(
      `${method} of ${lead.synthesis.analyzedItemCount} approved public comments on "${lead.title}", generated ${formatSavedDate(lead.synthesizedAt)}, found ${sentimentPhrase(lead.synthesis.overallSentiment)} community sentiment. ${ENGAGEMENT_NARRATIVE_CAVEAT}`
    );
    if (lead.synthesis.themes.length > 0) {
      const themeList = lead.synthesis.themes
        .map((theme) => `"${theme.label}" (${theme.itemCount} comment(s), ${theme.sentiment})`)
        .join(", ");
      claims.push(
        `Leading comment themes from that synthesis: ${themeList}. ${ENGAGEMENT_NARRATIVE_CAVEAT}`
      );
    }
  }

  if (lead.representativeness) {
    const computedOn = formatSavedDate(lead.representativenessComputedAt);
    if (lead.representativeness.insufficient) {
      claims.push(
        `A spatial representativeness screening computed ${computedOn} had too few geolocated respondents to compare respondent-area demographics against the study area. ${REPRESENTATIVENESS_SCREENING_CAVEAT}`
      );
    } else if (lead.representativeness.underRepresentedLabels.length > 0) {
      claims.push(
        `A spatial representativeness screening computed ${computedOn} (${lead.representativeness.respondentCount} geolocated respondents across ${lead.representativeness.tractCount} study-area tracts) flagged groups whose areas appear under-represented in the comments: ${lead.representativeness.underRepresentedLabels.join(", ")}. ${REPRESENTATIVENESS_SCREENING_CAVEAT}`
      );
    } else {
      claims.push(
        `A spatial representativeness screening computed ${computedOn} (${lead.representativeness.respondentCount} geolocated respondents across ${lead.representativeness.tractCount} study-area tracts) found no group whose areas appear under-represented in the comments. ${REPRESENTATIVENESS_SCREENING_CAVEAT}`
      );
    }
  }

  return claims;
}

/** One-line cue detail for evidence-readiness surfaces. */
export function summarizeEngagementForCue(evidence: ProjectEngagementEvidence): string {
  const lead = evidence.leadCampaign;
  const campaignPart = `${evidence.campaignCount} campaign(s); lead "${lead.title}" (${lead.status})`;

  if (!lead.synthesis) {
    return `${campaignPart}. No comment synthesis is saved yet, so community input is not citable in narratives.`;
  }

  const synthesisPart = `${
    lead.synthesis.source === "ai" ? "AI synthesis" : "keyword synthesis (AI offline)"
  } of ${lead.synthesis.analyzedItemCount} approved comment(s), ${sentimentPhrase(
    lead.synthesis.overallSentiment
  )} sentiment`;
  const representativenessPart = lead.representativeness
    ? lead.representativeness.insufficient
      ? "representativeness screening saved (insufficient sample)"
      : lead.representativeness.underRepresentedLabels.length > 0
        ? `representativeness screening flags: ${lead.representativeness.underRepresentedLabels.join(", ")}`
        : "representativeness screening saved (no under-represented groups flagged)"
    : "no representativeness screening saved";

  return `${campaignPart}. ${synthesisPart}; ${representativenessPart}.`;
}
