// Saved benefit-cost screenings as grant evidence.
//
// Pure helpers over project_bca_screenings rows: a defensive parser for the
// server-derived result_json (house pattern — never trust stored JSON
// shapes), narrative fact claims for the [fact:N] grounding contract, and a
// compact summary for evidence cues. Screening-grade language everywhere:
// a saved screening supports prioritization, never award likelihood.

import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { formatUsd } from "@/lib/bca/render";

export interface ProjectBcaScreeningRowLike {
  id: string;
  project_id: string;
  result_json: unknown;
  engine_version: string | null;
  created_at: string | null;
}

export interface ProjectBcaScreeningSummary {
  id: string;
  projectId: string;
  netPresentValue: number;
  benefitCostRatio: number | null;
  presentValueBenefits: number;
  presentValueCosts: number;
  analysisHorizonYears: number;
  discountRatePct: number;
  baseYear: number;
  engineVersion: string;
  createdAt: string | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Defensive parse of a stored screening row. Returns null when result_json
 * does not carry the server-derived headline metrics — callers treat that
 * row as if no screening exists rather than guessing.
 */
export function parseStoredBcaScreening(
  row: ProjectBcaScreeningRowLike | null | undefined
): ProjectBcaScreeningSummary | null {
  if (!row || typeof row.result_json !== "object" || row.result_json === null) return null;
  const result = row.result_json as Record<string, unknown>;

  const netPresentValue = finiteNumber(result.netPresentValue);
  const presentValueBenefits = finiteNumber(result.presentValueBenefits);
  const presentValueCosts = finiteNumber(result.presentValueCosts);
  const analysisHorizonYears = finiteNumber(result.analysisHorizonYears);
  const discountRatePct = finiteNumber(result.discountRatePct);
  const baseYear = finiteNumber(result.baseYear);
  if (
    netPresentValue === null ||
    presentValueBenefits === null ||
    presentValueCosts === null ||
    analysisHorizonYears === null ||
    discountRatePct === null ||
    baseYear === null
  ) {
    return null;
  }

  const rawBcr = result.benefitCostRatio;
  const benefitCostRatio = rawBcr === null ? null : finiteNumber(rawBcr);
  if (benefitCostRatio === null && rawBcr !== null) return null;

  return {
    id: row.id,
    projectId: row.project_id,
    netPresentValue,
    benefitCostRatio,
    presentValueBenefits,
    presentValueCosts,
    analysisHorizonYears,
    discountRatePct,
    baseYear,
    engineVersion: row.engine_version?.trim() || "unknown",
    createdAt: row.created_at ?? null,
  };
}

/**
 * Latest parseable screening per project. Rows must arrive ordered
 * created_at DESC (callers .order like the modeling-evidence builder).
 */
export function buildLatestBcaScreeningByProjectId(
  rows: ProjectBcaScreeningRowLike[]
): Map<string, ProjectBcaScreeningSummary> {
  const byProject = new Map<string, ProjectBcaScreeningSummary>();
  for (const row of rows) {
    if (byProject.has(row.project_id)) continue;
    const parsed = parseStoredBcaScreening(row);
    if (parsed) byProject.set(row.project_id, parsed);
  }
  return byProject;
}

/**
 * UTC date label for a saved screening. Exported so the panel, cue, and
 * narrative facts render the same calendar day for the same row (a local-time
 * formatter can disagree by a day near midnight UTC).
 */
export function formatSavedDate(createdAt: string | null): string {
  if (!createdAt) return "an unrecorded date";
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return "an unrecorded date";
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Single-sentence claims for the narrative fact list. Each is
 * self-contained and ends with the verbatim screening caveat, mirroring how
 * modeling-evidence facts carry GRANT_MODELING_PLANNING_CAVEAT.
 */
export function buildBcaScreeningFactClaims(
  screening: ProjectBcaScreeningSummary,
  projectName?: string | null
): string[] {
  const subject = projectName ? `the ${projectName} project` : "the linked project";
  const savedOn = `saved for ${subject} on ${formatSavedDate(screening.createdAt)}`;
  const npvTail = `a net present value of ${formatUsd(screening.netPresentValue)} over ${screening.analysisHorizonYears} years at a ${screening.discountRatePct}% real discount rate`;
  // Keep the null-BCR case grammatical: a missing ratio becomes a trailing
  // clause instead of being spliced where the ratio value would go.
  const headline =
    screening.benefitCostRatio === null
      ? `A screening-level benefit-cost analysis ${savedOn} computed ${npvTail}; no benefit-cost ratio was computable because no discounted costs were entered.`
      : `A screening-level benefit-cost analysis ${savedOn} computed a benefit-cost ratio of ${screening.benefitCostRatio.toFixed(2)} and ${npvTail}.`;

  return [
    `${headline} ${BCA_NARRATIVE_CAVEAT}`,
    `The saved screening's discounted benefits total ${formatUsd(screening.presentValueBenefits)} against discounted costs of ${formatUsd(screening.presentValueCosts)} (engine ${screening.engineVersion}). ${BCA_NARRATIVE_CAVEAT}`,
  ];
}

/** One-line cue detail for evidence-readiness surfaces. */
export function summarizeBcaScreeningForCue(screening: ProjectBcaScreeningSummary): string {
  const bcrText =
    screening.benefitCostRatio === null
      ? "no computable BCR (no discounted costs)"
      : `BCR ${screening.benefitCostRatio.toFixed(2)}`;
  return `Saved ${formatSavedDate(screening.createdAt)}: ${bcrText}, NPV ${formatUsd(screening.netPresentValue)} over ${screening.analysisHorizonYears} years.`;
}
