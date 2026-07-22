/**
 * Pure scoring for the RTP "why" engine. Turns per-criterion ratings (0–3) into a
 * composite 0–100 score, a tier, a per-level rollup, and a structured, defensible
 * rationale — the machine-checkable replacement for free-text priority_rationale.
 */
import {
  RTP_PRIORITY_CRITERIA,
  RTP_PRIORITY_LEVELS,
  RTP_PRIORITY_LEVEL_LABEL,
  RTP_PRIORITY_MAX_RATING,
  getRtpPriorityCriterion,
  ratingLabel,
  type RtpPriorityLevel,
} from "./priority-criteria";

export type RtpPriorityScores = Record<string, number>;
export type RtpPriorityTier = "high" | "medium" | "low" | "unscored";

const TOTAL_WEIGHT = RTP_PRIORITY_CRITERIA.reduce((sum, criterion) => sum + criterion.weight, 0);

/**
 * Validate/normalize a raw stored scores object: keep only known criteria keys with
 * integer ratings in 1..3 (0 / invalid dropped). Safe against arbitrary JSON.
 */
export function parsePriorityScores(raw: unknown): RtpPriorityScores {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: RtpPriorityScores = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!getRtpPriorityCriterion(key)) continue;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) continue;
    const clamped = Math.min(RTP_PRIORITY_MAX_RATING, Math.max(0, Math.round(numeric)));
    if (clamped > 0) out[key] = clamped;
  }
  return out;
}

export interface RtpPriorityScoreSummary {
  composite: number; // 0–100 across the full criteria set (breadth + depth)
  tier: RtpPriorityTier;
  scoredCriteria: number;
  byLevel: Record<RtpPriorityLevel, number>; // 0–100 within each priority level
}

export function tierForComposite(composite: number, scoredCriteria: number): RtpPriorityTier {
  if (scoredCriteria === 0) return "unscored";
  if (composite >= 60) return "high";
  if (composite >= 30) return "medium";
  return "low";
}

export function computeRtpPriorityScore(raw: unknown): RtpPriorityScoreSummary {
  const scores = parsePriorityScores(raw);

  let weighted = 0;
  const levelWeighted: Record<RtpPriorityLevel, number> = { local: 0, county: 0, state: 0, federal: 0 };
  const levelWeightTotals: Record<RtpPriorityLevel, number> = { local: 0, county: 0, state: 0, federal: 0 };

  for (const criterion of RTP_PRIORITY_CRITERIA) {
    levelWeightTotals[criterion.level] += criterion.weight;
    const rating = scores[criterion.key] ?? 0;
    const contribution = (rating / RTP_PRIORITY_MAX_RATING) * criterion.weight;
    weighted += contribution;
    levelWeighted[criterion.level] += contribution;
  }

  const composite = TOTAL_WEIGHT > 0 ? Math.round((weighted / TOTAL_WEIGHT) * 100) : 0;
  const byLevel = {} as Record<RtpPriorityLevel, number>;
  for (const level of RTP_PRIORITY_LEVELS) {
    byLevel[level] =
      levelWeightTotals[level] > 0 ? Math.round((levelWeighted[level] / levelWeightTotals[level]) * 100) : 0;
  }

  const scoredCriteria = Object.keys(scores).length;
  return { composite, tier: tierForComposite(composite, scoredCriteria), scoredCriteria, byLevel };
}

export interface RtpPriorityDriver {
  key: string;
  label: string;
  level: RtpPriorityLevel;
  rating: number;
  ratingLabel: string;
  policyBasis: string;
  contribution: number; // weighted contribution to the composite
}

export interface RtpPriorityRationale {
  summary: RtpPriorityScoreSummary;
  drivers: RtpPriorityDriver[];
  narrative: string;
}

/**
 * Build a structured, human-readable "why this project" rationale from the scores.
 * `drivers` are the scored criteria ranked by weighted contribution.
 */
export function buildRtpPriorityRationale(raw: unknown): RtpPriorityRationale {
  const scores = parsePriorityScores(raw);
  const summary = computeRtpPriorityScore(scores);

  const drivers: RtpPriorityDriver[] = Object.entries(scores)
    .map(([key, rating]) => {
      const criterion = getRtpPriorityCriterion(key)!;
      return {
        key,
        label: criterion.label,
        level: criterion.level,
        rating,
        ratingLabel: ratingLabel(rating),
        policyBasis: criterion.policyBasis,
        contribution: (rating / RTP_PRIORITY_MAX_RATING) * criterion.weight,
      };
    })
    .sort((a, b) => b.contribution - a.contribution || a.label.localeCompare(b.label));

  return { summary, drivers, narrative: buildNarrative(summary, drivers) };
}

const TIER_PHRASE: Record<RtpPriorityTier, string> = {
  high: "a high-priority project",
  medium: "a moderate-priority project",
  low: "a lower-priority project",
  unscored: "not yet scored against the RTP priority criteria",
};

function buildNarrative(summary: RtpPriorityScoreSummary, drivers: RtpPriorityDriver[]): string {
  if (summary.scoredCriteria === 0) {
    return "This project has not yet been scored against the RTP priority criteria (VMT, GHG, safety, equity, and local/state/federal alignment).";
  }

  const top = drivers.slice(0, 3);
  const topPhrase = top
    .map((driver) => `${driver.label.toLowerCase()} (${driver.ratingLabel.toLowerCase()})`)
    .join(", ");

  const levels = Array.from(new Set(top.map((driver) => RTP_PRIORITY_LEVEL_LABEL[driver.level].toLowerCase())));
  const levelPhrase = levels.length > 0 ? ` It advances ${levels.join(", ")} priorities` : "";
  const bases = Array.from(new Set(top.map((driver) => driver.policyBasis)));
  const basisPhrase = bases.length > 0 ? ` (${bases.join("; ")})` : "";

  return `Scores ${summary.composite}/100 — ${TIER_PHRASE[summary.tier]}. Its strongest contributions are ${topPhrase}.${levelPhrase}${basisPhrase}.`;
}

export interface RtpPortfolioPrioritySummary {
  projectCount: number;
  scoredCount: number;
  tierCounts: Record<RtpPriorityTier, number>;
  averageComposite: number; // average composite of the scored projects
  topCriteria: Array<{ key: string; label: string; policyBasis: string; totalContribution: number }>;
  narrative: string;
}

/**
 * Synthesize a plan-level "why" across a cycle's scored project links: the tier
 * mix, average score, and the portfolio's strongest collective priorities. This
 * is the board/community-ready statement of what the plan prioritizes and why.
 */
export function buildPortfolioPriorityNarrative(scoresList: unknown[]): RtpPortfolioPrioritySummary {
  const summaries = scoresList.map((scores) => computeRtpPriorityScore(scores));
  const tierCounts: Record<RtpPriorityTier, number> = { high: 0, medium: 0, low: 0, unscored: 0 };
  for (const summary of summaries) tierCounts[summary.tier] += 1;

  const scored = summaries.filter((summary) => summary.scoredCriteria > 0);
  const averageComposite = scored.length
    ? Math.round(scored.reduce((sum, summary) => sum + summary.composite, 0) / scored.length)
    : 0;

  const contributionByKey = new Map<string, number>();
  for (const raw of scoresList) {
    const parsed = parsePriorityScores(raw);
    for (const [key, rating] of Object.entries(parsed)) {
      const criterion = getRtpPriorityCriterion(key);
      if (!criterion) continue;
      const contribution = (rating / RTP_PRIORITY_MAX_RATING) * criterion.weight;
      contributionByKey.set(key, (contributionByKey.get(key) ?? 0) + contribution);
    }
  }

  const topCriteria = Array.from(contributionByKey.entries())
    .map(([key, totalContribution]) => {
      const criterion = getRtpPriorityCriterion(key)!;
      return { key, label: criterion.label, policyBasis: criterion.policyBasis, totalContribution };
    })
    .sort((a, b) => b.totalContribution - a.totalContribution || a.label.localeCompare(b.label))
    .slice(0, 3);

  return {
    projectCount: scoresList.length,
    scoredCount: scored.length,
    tierCounts,
    averageComposite,
    topCriteria,
    narrative: buildPortfolioNarrative(scoresList.length, scored.length, tierCounts, averageComposite, topCriteria),
  };
}

function buildPortfolioNarrative(
  projectCount: number,
  scoredCount: number,
  tierCounts: Record<RtpPriorityTier, number>,
  averageComposite: number,
  topCriteria: RtpPortfolioPrioritySummary["topCriteria"],
): string {
  if (projectCount === 0) return "No projects are linked to this cycle yet.";
  if (scoredCount === 0) {
    return `${projectCount} project${projectCount === 1 ? "" : "s"} linked; none scored against the RTP priority criteria yet.`;
  }

  const mix = `${tierCounts.high} high · ${tierCounts.medium} moderate · ${tierCounts.low} lower priority`;
  const focus = topCriteria.map((criterion) => criterion.label.toLowerCase()).join(", ");
  const bases = Array.from(new Set(topCriteria.map((criterion) => criterion.policyBasis)));
  const basisPhrase = bases.length > 0 ? ` (${bases.join("; ")})` : "";

  return `Across ${projectCount} linked project${projectCount === 1 ? "" : "s"} (${mix}), this portfolio's strongest collective focus is ${focus} — advancing those priorities${basisPhrase}. Average priority score of scored projects: ${averageComposite}/100.`;
}

export function priorityTierTone(tier: RtpPriorityTier): "success" | "info" | "warning" | "neutral" {
  if (tier === "high") return "success";
  if (tier === "medium") return "info";
  if (tier === "low") return "warning";
  return "neutral";
}

export function priorityTierLabel(tier: RtpPriorityTier): string {
  if (tier === "high") return "High priority";
  if (tier === "medium") return "Moderate priority";
  if (tier === "low") return "Lower priority";
  return "Unscored";
}
