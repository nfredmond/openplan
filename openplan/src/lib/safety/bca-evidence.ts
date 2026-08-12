/**
 * Crash evidence → BCA screening suggestion (pure).
 *
 * A PROJECTION, NOT A SECOND SOURCE OF TRUTH. This file used to hold its own
 * ingest type, its own severity-count type, its own citation sentence and its
 * own caveat list — a second, parallel copy of what `crash-evidence.ts` now
 * declares once for each surface citing observed collision records. It has been
 * reduced to what is genuinely BCA-specific: folding the neutral severity bands
 * onto the three dimensions `src/lib/bca/parameters.ts` monetizes, dividing by
 * the year span, and saying the two things a benefit-cost reader in particular
 * must be told.
 *
 * WHAT REMAINS BCA-SPECIFIC, and why each is a refusal rather than a feature:
 *
 *   1. OBSERVED IS NOT AVOIDED. The screening input is the annual crashes a
 *      countermeasure is expected to AVOID. This offers the observed annual
 *      frequency as the ceiling for that judgement and says so every time.
 *      Nothing here estimates an avoided count; that is the analyst's call and a
 *      plausible machine-authored figure would be indistinguishable from a
 *      correct one on a screening sheet.
 *   2. NOTHING IS OFFERED WHEN THERE IS NOTHING HONEST TO OFFER. A non-ready
 *      acquisition, a zero-crash acquisition, an acquisition whose counts could
 *      not be read, and an acquisition whose stored collisions are ALL
 *      unclassified each return null. Null means "offer nothing"; it never means
 *      "suggest zeros". Zeros in a benefit-cost screen are not a neutral
 *      default — they are the claim that the road is safe.
 *
 * The severe-injury band folds into the single non-fatal `injury` dimension
 * because that is the dimension the monetization defaults carry. The `unknown`
 * band folds into NOTHING: a collision the source gave no casualty count for
 * cannot be assigned a monetized outcome, and it is disclosed instead.
 */

import {
  separatesSeriousInjuries,
  totalCountedCrashes,
  type SafetyCrashEvidence,
} from "./crash-evidence";

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

/** The sentence that must appear on every suggestion. Exported so a test can pin its presence, not its prose. */
export const BCA_OBSERVED_IS_NOT_AVOIDED_CAVEAT =
  "These are observed annual crash frequencies from the linked acquisition, not crashes avoided — the screening input is the annual crashes a countermeasure is expected to avoid, which the operator must judge (the observed figures are a ceiling, not that estimate).";

function roundAnnual(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Project one acquisition's evidence onto the BCA's crash dimensions, or return
 * null when there is nothing honest to suggest.
 *
 * Takes the shared `SafetyCrashEvidence` rather than an ingest row plus counts:
 * the citation and the coverage caveats then travel with the numbers by
 * construction, and there is no arrangement of arguments that produces a figure
 * without its provenance.
 */
export function buildBcaCrashInputSuggestion(
  evidence: SafetyCrashEvidence
): BcaCrashInputSuggestion | null {
  if (evidence.status !== "ready") return null;
  if (evidence.reportedTotal <= 0) return null;

  const counts = evidence.severityCounts;
  // A failed count read is not "no crashes". Rendering zeros here would put a
  // lookup failure into a benefit-cost screening as an observed safety record.
  if (!counts) return null;

  // The three monetized dimensions. `unknown` is deliberately excluded: it is
  // the band for a collision the source supplied no casualty count for, and
  // assigning it an outcome is inventing one. An acquisition whose stored
  // collisions are ALL unknown therefore falls out here with null rather than
  // with three zeros.
  const monetizableTotal = counts.fatal + counts.severe_injury + counts.injury + counts.pdo;
  if (monetizableTotal <= 0) return null;

  const yearSpan = Math.max(1, evidence.years.length);

  const suggestedInputs = {
    fatal: roundAnnual(counts.fatal / yearSpan),
    injury: roundAnnual((counts.severe_injury + counts.injury) / yearSpan),
    propertyDamageOnly: roundAnnual(counts.pdo / yearSpan),
  };

  // The BCA-specific sentence first, then every disclosure the acquisition
  // already carries. One caveat vocabulary for the whole module — a second
  // wording of "some of these were not geocoded" is how two screens end up
  // quoting different shortfalls for the same retrieval.
  const caveats: string[] = [BCA_OBSERVED_IS_NOT_AVOIDED_CAVEAT];

  if (evidence.mappedTotal < evidence.reportedTotal) {
    caveats.push(
      `Severity is only known for the ${evidence.mappedTotal.toLocaleString("en-US")} of ${evidence.reportedTotal.toLocaleString("en-US")} reported crashes that carry coordinates, so these frequencies understate the reported burden.`
    );
  }

  if (evidence.unclassifiedCount !== null && evidence.unclassifiedCount > 0) {
    const total = totalCountedCrashes(counts) ?? 0;
    caveats.push(
      `${evidence.unclassifiedCount.toLocaleString("en-US")} of the ${total.toLocaleString("en-US")} stored collisions carry no casualty count from the source, so they appear in none of the three frequencies above. Those three do not add up to the acquisition's total, and the missing rows are unknown outcomes rather than property damage.`
    );
  }

  if (!separatesSeriousInjuries(evidence.severityCompleteness)) {
    caveats.push(
      "This source could not separate suspected serious injuries; they are folded into the injury dimension."
    );
  }

  if (evidence.truncated) {
    caveats.push(
      "Retrieval stopped at the record cap, so the underlying extract is a partial slice of the study area."
    );
  }

  return { suggestedInputs, citationText: evidence.citationText, caveats };
}
