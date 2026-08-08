/**
 * WHAT A PLANNER IS TOLD WHEN A RUN FAILS.
 *
 * ====================================================== WHY THIS EXISTS
 *
 * A failed AequilibraE run described itself as **"Run recorded — no linked
 * analysis results yet."**
 *
 * Verified by rendering the real run card: the worker sets the failing STAGE's
 * `error_message` and then patches only `{status: "failed"}` onto the run, so
 * `model_runs.error_message` stays NULL. The card's headline falls through to a
 * neutral sentence written for a run that simply has no results — and a planner
 * reads the most prominent line on a failed run as though nothing went wrong.
 *
 * The in-app engines and the stale-run reaper DO write a run-level message, so
 * this gap is specific to the worker lane: the engine that runs real assignment
 * and is the only one CEQA-eligible.
 *
 * ============================================ THE MESSAGES ALREADY EXIST
 *
 * This module writes almost no new copy, because the worker's own messages are
 * already good. It refuses a run with no study area by naming the launch
 * control; it refuses an oversized study area with the zone count, the limit,
 * and the way to narrow it; and when the Census ACS API rejects an unkeyed
 * request it names the settings page, who can reach it, where to get a free
 * key, and what happens on relaunch. All of that was being written to a stage
 * row and shown under a headline that contradicted it.
 *
 * So the job here is surfacing, not authoring.
 *
 * ================================================ THE HONESTY BOUNDARY
 *
 * **This module never invents a cause.** It does not map `KeyError: 'households'`
 * to a diagnosis, because it does not know one, and a plausible wrong
 * explanation of a failure is worse than an honest raw one — it sends a planner
 * to fix something that was never broken. Everything below chooses WHICH of the
 * engine's own sentences to show and WHAT FRAME to put around it. No sentence
 * describing a cause originates here.
 */

/** A stage row as the run card and the evidence panel already carry it. */
export type RunFailureStageLike = {
  stage_name?: string | null;
  status?: string | null;
  sort_order?: number | null;
  error_message?: string | null;
};

export type RunFailureSummary = {
  /** The sentence that belongs in the run's headline. Always non-empty. */
  headline: string;
  /** The stage that failed, when a stage recorded it. */
  stageName: string | null;
  /**
   * True when the text shown is the engine's internal output rather than
   * something written for a planner. Drives the "this is not something you did"
   * framing — the difference between a planner acting on advice and a planner
   * concluding they broke the software.
   */
  isRawEngineOutput: boolean;
  /** The engine's message, verbatim, with no framing. Null when none exists. */
  rawMessage: string | null;
};

/** Run statuses this module speaks for. Anything else returns null. */
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "cancelled"]);

/**
 * A Python exception rendered as `TypeName: message`, which is exactly what the
 * worker stores (`f"{type(e).__name__}: {e}"`).
 *
 * The prefix is stripped ONLY when what follows still reads as a sentence,
 * because stripping it from `KeyError: 'households'` leaves `'households'` —
 * strictly less information than it started with.
 */
const EXCEPTION_PREFIX = /^[A-Z][A-Za-z0-9_]*(Error|Exception|Warning):\s+/;

/**
 * Whether a message reads as something written for a person.
 *
 * A PRESENTATION heuristic, and deliberately a conservative one. It never
 * changes WHICH text a planner sees — only the sentence wrapped around it — so
 * both misclassifications are harmless: a good message framed as raw output is
 * merely over-cautious, and a terse one shown unframed is exactly the status
 * quo. It cannot hide information, which is the property that makes a heuristic
 * acceptable here at all.
 */
function readsAsPlannerProse(message: string): boolean {
  const words = message.trim().split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;
  return /[.!?)](\s*)$/.test(message.trim());
}

/**
 * The stage that CAUSED the failure.
 *
 * The FIRST failed stage, never the last, and never a `skipped` one. When a
 * stage fails the worker marks every later stage `skipped` with
 * "Blocked by prior stage X (failed)" in the same `error_message` column —
 * a consequence that reads exactly like a cause. Taking the last row would
 * headline a run with "Blocked by prior stage Network Assignment", which tells
 * a planner nothing and hides the message that would have helped.
 */
function causingStage(stages: ReadonlyArray<RunFailureStageLike>): RunFailureStageLike | null {
  const failed = stages.filter((stage) => stage.status === "failed");
  if (failed.length === 0) return null;
  // Sort by declared order where present; a missing sort_order keeps array
  // order rather than jumping to the front.
  const ordered = [...failed].sort((a, b) => {
    const left = typeof a.sort_order === "number" ? a.sort_order : Number.MAX_SAFE_INTEGER;
    const right = typeof b.sort_order === "number" ? b.sort_order : Number.MAX_SAFE_INTEGER;
    return left - right;
  });
  return ordered[0] ?? null;
}

/**
 * What to tell a planner about a run that did not finish.
 *
 * Returns null for any run that is not terminally failed, so a caller can use
 * its own copy for queued, running and succeeded runs.
 */
export function summarizeRunFailure({
  status,
  errorMessage,
  stages,
}: {
  status: string | null | undefined;
  errorMessage?: string | null;
  stages?: ReadonlyArray<RunFailureStageLike> | null;
}): RunFailureSummary | null {
  if (!status || !TERMINAL_FAILURE_STATUSES.has(status)) return null;

  // The run-level message wins when there is one. The in-app engines and the
  // stale-run reaper both write planner-facing text here, and the reaper's is
  // the more useful of the two ("no worker picked this up") because it
  // describes something no stage could know.
  const runLevel = errorMessage?.trim();
  if (runLevel) {
    return {
      headline: runLevel,
      stageName: null,
      isRawEngineOutput: false,
      rawMessage: runLevel,
    };
  }

  const stage = causingStage(stages ?? []);
  const stageName = stage?.stage_name?.trim() || null;
  const stageMessage = stage?.error_message?.trim();

  if (!stageMessage) {
    // A run that failed and recorded nothing. Saying so is the honest answer;
    // the alternative that shipped for months was a sentence implying success.
    return {
      headline: stageName
        ? `This run failed during ${stageName} and no reason was recorded. Re-launch to retry — if it fails again, whoever runs your OpenPlan deployment can check the worker's logs.`
        : "This run failed and no reason was recorded. Re-launch to retry — if it fails again, whoever runs your OpenPlan deployment can check the worker's logs.",
      stageName,
      isRawEngineOutput: false,
      rawMessage: null,
    };
  }

  const withoutPrefix = stageMessage.replace(EXCEPTION_PREFIX, "").trim();
  // Strip the exception type only when a sentence survives it.
  const candidate = readsAsPlannerProse(withoutPrefix) ? withoutPrefix : stageMessage;

  if (readsAsPlannerProse(candidate)) {
    return {
      headline: stageName ? `${stageName} could not finish. ${candidate}` : candidate,
      stageName,
      isRawEngineOutput: false,
      rawMessage: stageMessage,
    };
  }

  // No planner-facing explanation exists. Say that plainly, in the one place a
  // non-technical planner is most likely to conclude they broke the software.
  return {
    headline: stageName
      ? `This run failed during ${stageName}. The modeling engine reported an internal error rather than something you can act on — this is not a setting you got wrong. Send this to whoever runs your OpenPlan deployment: ${candidate}`
      : `This run failed. The modeling engine reported an internal error rather than something you can act on — this is not a setting you got wrong. Send this to whoever runs your OpenPlan deployment: ${candidate}`,
    stageName,
    isRawEngineOutput: true,
    rawMessage: stageMessage,
  };
}
