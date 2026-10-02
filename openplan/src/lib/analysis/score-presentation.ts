import type { CorridorScores } from "@/lib/data-sources/scoring";

export type PresentedScore = {
  value: number | null;
  eligible: boolean;
  withheldReason: string | null;
};

export type ScorePresentation = {
  accessibility: PresentedScore;
  safety: PresentedScore;
  equity: PresentedScore;
  overall: PresentedScore;
  banding: "not_validated";
};

function shown(value: number): PresentedScore {
  return { value, eligible: true, withheldReason: null };
}

function withheld(reason: string): PresentedScore {
  return { value: null, eligible: false, withheldReason: reason };
}

/**
 * One presentation decision for every UI, report, export, comparison, and fact.
 * Numeric formulas remain untouched; this function decides only what may leave
 * storage as planner-facing evidence.
 */
export function resolveScorePresentation(scores: CorridorScores): ScorePresentation {
  const censusAvailable = scores.dataQuality.censusAvailable;
  const transitAvailable = scores.dataQuality.transitDataAvailable;
  const crashAvailable = scores.dataQuality.crashDataAvailable;
  const crashComplete = scores.dataQuality.crashDataComplete;

  const accessibility = !censusAvailable
    ? withheld("Accessibility is withheld because required Census inputs are unavailable.")
    : !transitAvailable
      ? withheld("Accessibility is withheld because transit inputs are unavailable.")
      : shown(scores.accessibilityScore);
  const safety = !crashAvailable
    ? withheld("Safety is withheld because crash evidence is unavailable.")
    : !crashComplete || scores.safetyScore === null
      ? withheld("Safety is withheld because the crash record extract is incomplete.")
      : shown(scores.safetyScore);
  const equity = !censusAvailable
    ? withheld("Equity is withheld because required demographic inputs are unavailable.")
    : shown(scores.equityScore);
  const missing = [accessibility, safety, equity].filter((score) => !score.eligible);
  const overall = missing.length > 0
    ? withheld(`The composite is withheld because ${missing.map((score) => score.withheldReason).join(" ")}`)
    : shown(scores.overallScore);

  return { accessibility, safety, equity, overall, banding: "not_validated" };
}

export function presentableScoreMetrics(presentation: ScorePresentation) {
  return {
    accessibilityScore: presentation.accessibility.value,
    safetyScore: presentation.safety.value,
    equityScore: presentation.equity.value,
    overallScore: presentation.overall.value,
    scorePresentation: presentation,
  };
}

export type HeadlineScoreKey =
  | "accessibilityScore"
  | "safetyScore"
  | "equityScore"
  | "overallScore";

/**
 * Apply the recorded rule to new runs. Historical rows that predate both the
 * eligibility record and source-availability fields keep their recorded
 * value; silently reclassifying old evidence would be a different claim.
 */
export function scoreValueForPresentation(
  metrics: Record<string, unknown> | null | undefined,
  key: HeadlineScoreKey
): number | null {
  if (!metrics) return null;
  const presentation = metrics.scorePresentation as Partial<Record<string, { value?: unknown; eligible?: unknown }>> | undefined;
  const presentationKey = key.replace("Score", "") as "accessibility" | "safety" | "equity" | "overall";
  const recorded = presentation?.[presentationKey];
  if (recorded) {
    return recorded.eligible === true && typeof recorded.value === "number" ? recorded.value : null;
  }
  const quality = metrics.dataQuality as Record<string, unknown> | undefined;
  if (!quality) return typeof metrics[key] === "number" ? metrics[key] as number : null;
  const census = quality?.censusAvailable === true;
  const transit = quality?.transitDataAvailable === true;
  const crashes = quality?.crashDataAvailable === true;
  const eligible = key === "accessibilityScore"
    ? census && transit
    : key === "safetyScore"
      ? crashes
      : key === "equityScore"
        ? census
        : census && transit && crashes;
  return eligible && typeof metrics[key] === "number" ? metrics[key] as number : null;
}

/**
 * A copy of `metrics` whose four headline scores follow the presentation rule:
 * a score that is not eligible is null.
 *
 * For display only, never for writing back. Runs saved before the rule existed
 * (August 2026) store the raw composite with no presentation record, so a page
 * that read `metrics.overallScore` directly showed "Overall 32" for a run with
 * no crash or transit evidence. `scoreValueForPresentation` already knows how
 * to judge those runs from their data-quality flags; this applies it once at
 * the point a result enters a page.
 */
export function withPresentedHeadlineScores<T extends Record<string, unknown>>(metrics: T): T {
  return {
    ...metrics,
    overallScore: scoreValueForPresentation(metrics, "overallScore"),
    accessibilityScore: scoreValueForPresentation(metrics, "accessibilityScore"),
    safetyScore: scoreValueForPresentation(metrics, "safetyScore"),
    equityScore: scoreValueForPresentation(metrics, "equityScore"),
  };
}

export function scoreWithheldReason(
  metrics: Record<string, unknown> | null | undefined,
  key: HeadlineScoreKey
): string | null {
  if (scoreValueForPresentation(metrics, key) !== null) return null;
  const presentation = metrics?.scorePresentation as Partial<Record<string, { withheldReason?: unknown }>> | undefined;
  const presentationKey = key.replace("Score", "") as "accessibility" | "safety" | "equity" | "overall";
  const reason = presentation?.[presentationKey]?.withheldReason;
  return typeof reason === "string" ? reason : null;
}
