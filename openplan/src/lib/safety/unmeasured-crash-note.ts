/**
 * The sentence shown where a safety score would be, when there is none.
 *
 * WHY THIS IS SHARED, AND WHY IT TAKES THE STATE.
 *
 * There are two entirely different reasons a run carries no safety score, and
 * `CrashSummarySourceState` has distinguished them since it was written:
 *
 *   - `out-of-coverage`    no registered adapter covers the study area at all;
 *   - `source-unavailable` an adapter does cover it, but the source did not answer.
 *
 * The results board and the generated report each hard-coded the FIRST wording
 * and showed it for both. Measured against a real run: a Columbus, Ohio study
 * area recorded `state: "source-unavailable"` with the note "NHTSA Fatality
 * Analysis Reporting System (FARS) could not be reached", while the screen — and
 * the exported report — told the planner "No crash source covered this study
 * area". FARS is national; it covers Ohio. The product invented a coverage gap
 * to explain an outage, which is the one thing this lane exists not to do: a
 * planner who believes their state has no crash coverage abandons the safety
 * lane, where a planner told the source was down retries it.
 *
 * It lives in its own module rather than inside either caller because a shared
 * sentence that lives in one of its two call sites gets reimplemented wrongly by
 * the other — which is exactly how these two came to disagree with the data they
 * were both rendering.
 *
 * THE DEFAULT MUST NAME NO CAUSE. Runs recorded before the state was stored
 * carry no state at all, and guessing on their behalf would reintroduce the
 * defect for every historical run.
 */

/** The unmeasured-safety states a crash snapshot can record. */
export type CrashUnmeasuredState = "out-of-coverage" | "source-unavailable";

/**
 * A trailing sentence used in every branch. The score's absence must never read
 * as a favorable finding — an area nobody measured is not an area that is safe.
 */
const NOT_A_SAFETY_FINDING = "An unmeasured corridor is not a safe one.";

export interface UnmeasuredCrashNoteOptions {
  /** `sourceSnapshots.crashes.state`. Absent on runs older than that field. */
  state?: string | null;
  /** Human label for the adapter that was tried, e.g. "CCRS (California)". */
  label?: string | null;
}

/**
 * Explain a missing safety score from what the run actually recorded.
 *
 * Any unrecognised or absent state falls through to a cause-neutral sentence:
 * the score is reported as missing, and no reason is asserted that the run does
 * not support.
 */
export function unmeasuredCrashNote({ state, label }: UnmeasuredCrashNoteOptions = {}): string {
  const sourceName = typeof label === "string" && label.trim() ? label.trim() : null;

  if (state === "out-of-coverage") {
    return `No crash source covered this study area, so no safety score was produced. ${NOT_A_SAFETY_FINDING}`;
  }

  if (state === "source-unavailable") {
    const named = sourceName ? `${sourceName} could not be reached` : "The crash source could not be reached";
    return `${named}, so no safety score was produced. This is an outage, not a finding that this area has no crash data — the same run may succeed later. ${NOT_A_SAFETY_FINDING}`;
  }

  return `No safety score was produced for this run, and it did not record why. ${NOT_A_SAFETY_FINDING}`;
}
