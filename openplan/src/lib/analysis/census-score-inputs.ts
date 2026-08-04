/**
 * Whether a run's SCORES were built on demographic data that was actually read.
 *
 * WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM `censusReportedFigures`.
 * `censusReportedFigures` fixed the FIGURES: a corridor whose ACS read returned
 * nothing no longer reports "Population: 0" or "0% transit", because those are
 * nulled and a null renders as "Not measured" and is dropped from the model's
 * citable facts. It did not fix the SCORES, and the scores are the largest
 * numbers on the board.
 *
 * `computeAccessibility` reads `census.pctTransit + census.pctWalk +
 * census.pctBike` and `census.pctZeroVehicle` straight off the summary, where an
 * unanswered read leaves placeholder zeros. `computeEquity` reads a tract screen
 * over zero tracts. Driving the real `POST /api/analysis` with an empty ACS
 * result produces, today: **Accessibility 5, Equity 0, Overall 3** — three
 * headline numbers, none of them measurements, one of them the literal 0 that a
 * planner reads as "no equity concern on this corridor". That is the same defect
 * the figures had, one level up and far more visible.
 *
 * THE FIX HERE IS DISCLOSURE, NOT SUPPRESSION, and that is deliberate.
 * Making `computeEquity` return null the way `computeSafety` does is the correct
 * end state, but it is a SCORING change: it moves the composite's weights, it
 * changes numbers on already-persisted runs' successors, and `scoring.ts` is
 * shared with the county-run and model lanes. It deserves its own change with
 * its own evidence. Withholding the number in the meantime would be restricting
 * a planner's access to their own run to avoid printing a caveat, which this
 * codebase treats as its own defect. So the number stays and the sentence that
 * bounds it travels with it, wherever it is read.
 *
 * Shared between the results board and the exported corridor report ON PURPOSE.
 * A capability that lives inside one of its two callers gets reimplemented
 * wrongly by the other; the board and the PDF must not describe the same run
 * differently.
 */

export type CensusScoreInputCoverage = {
  /**
   * `true` — the ACS read answered and the demographic inputs are readings.
   * `false` — it did not, and every demographic input to a score was a zero
   * standing in for a missing value.
   * `null` — this run recorded nothing that says either way. NOT the same as
   * `false`: "we cannot tell" is its own answer and must not be narrated as
   * "there was no data".
   */
  measured: boolean | null;
  /**
   * The sentence to attach to any score built from demographics, or `null` when
   * there is nothing to disclose (measured, or unknowable).
   */
  caveat: string | null;
};

const NOT_MEASURED_CAVEAT =
  "No census data was returned for this study area, so this score was computed as though every " +
  "demographic input were zero. It is deflated by the missing read, not a reading about this corridor.";

const MEASURED: CensusScoreInputCoverage = { measured: true, caveat: null };
const UNKNOWN: CensusScoreInputCoverage = { measured: null, caveat: null };
const NOT_MEASURED: CensusScoreInputCoverage = { measured: false, caveat: NOT_MEASURED_CAVEAT };

type MetricsLike =
  | {
      censusMeasuredUniverses?: { tracts?: boolean } | null;
      dataQuality?: { censusAvailable?: boolean } | null;
      tractCount?: number | null;
    }
  | Record<string, unknown>
  | null
  | undefined;

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Read the demographic-input coverage off a run's persisted metrics.
 *
 * Three sources in descending order of directness, because runs from three eras
 * are all still readable:
 *   1. `censusMeasuredUniverses.tracts` — recorded since the figures boundary
 *      shipped, and the only one that states the fact outright.
 *   2. `dataQuality.censusAvailable` — the scoring engine's own view, persisted
 *      far longer.
 *   3. `tractCount` — the oldest signal, and still unambiguous at zero.
 * A run carrying none of the three returns `null`, and nothing is claimed.
 */
export function resolveCensusScoreInputCoverage(metrics: MetricsLike): CensusScoreInputCoverage {
  const record = (metrics ?? {}) as Record<string, unknown>;

  const universes = record.censusMeasuredUniverses;
  if (universes && typeof universes === "object") {
    const tracts = readBoolean((universes as Record<string, unknown>).tracts);
    if (tracts !== null) return tracts ? MEASURED : NOT_MEASURED;
  }

  const dataQuality = record.dataQuality;
  if (dataQuality && typeof dataQuality === "object") {
    const available = readBoolean((dataQuality as Record<string, unknown>).censusAvailable);
    if (available !== null) return available ? MEASURED : NOT_MEASURED;
  }

  const tractCount = record.tractCount;
  if (typeof tractCount === "number" && Number.isFinite(tractCount)) {
    return tractCount > 0 ? MEASURED : NOT_MEASURED;
  }

  return UNKNOWN;
}

/**
 * Append the caveat to a note, when there is one. Returns the note unchanged
 * otherwise, so a caller can use it unconditionally without building a sentence
 * that says nothing.
 */
export function withCensusInputCaveat(note: string, coverage: CensusScoreInputCoverage): string {
  return coverage.caveat ? `${note} ${coverage.caveat}` : note;
}
