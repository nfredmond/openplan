/**
 * Crash evidence → BCA screening suggestion (pure).
 *
 * Maps the observed severity mix of one project-linked crash acquisition onto
 * the benefit-cost screen's crash input dimensions (fatal / injury /
 * property-damage-only — the dimensions `src/lib/bca/parameters.ts`
 * monetizes). This SUGGESTS a starting point; nothing here writes anything,
 * and the operator owns every number that reaches a screening.
 *
 * Two honesty rules are load-bearing:
 *
 *   1. Observed is not avoided. The BCA inputs are annual crashes AVOIDED by a
 *      countermeasure; this helper offers observed annual frequencies as the
 *      ceiling for that judgement and says so in a caveat, every time.
 *   2. Severity is only known for geocoded crashes. Stored crash points are
 *      the geocoded subset of what was reported, so when geocoded < reported
 *      the suggestion carries a caveat naming the gap instead of letting the
 *      smaller number pass as the whole burden.
 */

export type BcaCrashSeverityCounts = {
  fatal: number;
  /** KABCO A rows (present only when the source separates them). */
  severeInjury: number;
  injury: number;
  pdo: number;
};

/** The ingest fields the suggestion reads — a subset of a safety_crash_ingests row. */
export type BcaCrashEvidenceIngest = {
  id: string;
  status: string;
  sourceLabel: string | null;
  attribution?: string | null;
  severityCompleteness: string;
  /** Reported crashes matching the acquisition — geocoded or not. */
  crashCount: number;
  /** Of those, how many carried coordinates and are stored as points. */
  geocodedCount: number;
  truncated: boolean;
  yearsRequested: number[];
};

export type BcaCrashInputSuggestion = {
  /**
   * Observed ANNUAL AVERAGE crash frequencies by BCA dimension, over the
   * acquisition's distinct requested years. Severe-injury rows fold into
   * `injury` because the screen (like the monetization defaults) carries a
   * single non-fatal injury dimension.
   */
  suggestedInputs: {
    fatal: number;
    injury: number;
    propertyDamageOnly: number;
  };
  /** Names the source, the reported-vs-geocoded counts, the years, and the ingest id. */
  citationText: string;
  caveats: string[];
};

function roundAnnual(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatYears(years: number[]): string {
  const distinct = Array.from(new Set(years)).sort((a, b) => a - b);
  if (distinct.length === 0) return "";
  if (distinct.length === 1) return `, year ${distinct[0]}`;
  return `, years ${distinct[0]}–${distinct[distinct.length - 1]}`;
}

/**
 * Build a prefill suggestion from one ready acquisition, or return null when
 * there is nothing honest to suggest: a non-ready ingest, a zero-crash result,
 * or an acquisition whose stored points carry no severity evidence at all.
 * Null means "offer nothing", never "suggest zeros".
 */
export function buildBcaCrashInputSuggestion(
  ingest: BcaCrashEvidenceIngest,
  severityCounts: BcaCrashSeverityCounts
): BcaCrashInputSuggestion | null {
  if (ingest.status !== "ready") return null;
  if (ingest.crashCount <= 0) return null;

  const observedTotal =
    severityCounts.fatal + severityCounts.severeInjury + severityCounts.injury + severityCounts.pdo;
  if (observedTotal <= 0) return null;

  const yearSpan = Math.max(1, new Set(ingest.yearsRequested).size);

  const suggestedInputs = {
    fatal: roundAnnual(severityCounts.fatal / yearSpan),
    injury: roundAnnual((severityCounts.severeInjury + severityCounts.injury) / yearSpan),
    propertyDamageOnly: roundAnnual(severityCounts.pdo / yearSpan),
  };

  const caveats: string[] = [
    "These are observed annual crash frequencies from the linked acquisition, not crashes avoided — the screening input is the annual crashes a countermeasure is expected to avoid, which the operator must judge (the observed figures are a ceiling, not that estimate).",
  ];
  if (ingest.geocodedCount < ingest.crashCount) {
    caveats.push(
      `${ingest.geocodedCount.toLocaleString("en-US")} of ${ingest.crashCount.toLocaleString("en-US")} reported crashes were geocoded; severity is only known for geocoded crashes, so these figures understate the reported burden.`
    );
  }
  if (ingest.severityCompleteness !== "kabco_full") {
    caveats.push(
      "This source could not separate suspected serious injuries; they are folded into the injury dimension."
    );
  }
  if (ingest.truncated) {
    caveats.push(
      "Retrieval stopped at the record cap, so the underlying extract is a partial slice of the study area."
    );
  }

  const sourceName = ingest.sourceLabel ?? "Observed crash source";
  const attributionSuffix = ingest.attribution ? ` ${ingest.attribution}` : "";
  const citationText = `${sourceName}: ${ingest.crashCount.toLocaleString("en-US")} crashes ingested, ${ingest.geocodedCount.toLocaleString("en-US")} geocoded${formatYears(ingest.yearsRequested)}. Source ingest ${ingest.id}.${attributionSuffix}`;

  return { suggestedInputs, citationText, caveats };
}
