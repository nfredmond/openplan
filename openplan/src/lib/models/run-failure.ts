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
  log_tail?: string | null;
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
  /**
   * Non-null when this run has failed before: a relaunch resets the row in
   * place, so without `model_runs.failure_count` / `last_failure_message`
   * (captured by the relaunch route before the wipe) a third failure read
   * exactly like a first — and the copy suggested "re-launch to retry"
   * forever. `sameAsLast` compares this failure's recorded reason with the
   * previous attempt's; it is the difference between "try again" being advice
   * and being a treadmill.
   */
  repeat: { priorFailures: number; sameAsLast: boolean } | null;
};

/**
 * The reason this failure would be RECORDED under — the same precedence the
 * headline uses (run-level message first, else the causing stage's, verbatim).
 * Exported for the relaunch route, which must capture it into
 * `last_failure_message` BEFORE resetting the row; computing it there by hand
 * would fork the "which message counts" decision this module owns.
 */
export function recordableFailureMessage({
  errorMessage,
  stages,
}: {
  errorMessage?: string | null;
  stages?: ReadonlyArray<RunFailureStageLike> | null;
}): string | null {
  const runLevel = errorMessage?.trim();
  if (runLevel) return runLevel;
  return causingStage(stages ?? [])?.error_message?.trim() || null;
}

/** Run statuses this module speaks for. Anything else returns null. */
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "cancelled"]);

/**
 * Has this run stopped for good?
 *
 * Exported because more than the headline depends on it. A run mode's
 * `runtimeExpectation` ("Keeps working after you leave the page — expect
 * results in a few minutes") is a FORWARD-LOOKING claim, and it was rendered
 * unconditionally — so a terminally failed run carried a progress reassurance
 * directly beneath the sentence explaining that it had failed, which reads as
 * though the failure were transient and something were still retrying.
 *
 * Same family as the "Starting <stage>..." log box: a statement about work in
 * progress outliving the work. Two surfaces need this question answered, so it
 * is answered once.
 */
export function isTerminalRunFailure(status: string | null | undefined): boolean {
  return Boolean(status && TERMINAL_FAILURE_STATUSES.has(status));
}

/**
 * WHAT A STAGE'S LOG BOX MAY SAY ONCE THE STAGE HAS FAILED.
 *
 * The worker stamps `log_tail` with `"Starting <stage>..."` the moment it claims
 * a stage, and its failure handler writes only status, error_message and
 * completed_at. So a stage that failed EARLY — no study area, no Census key,
 * study area too large: exactly the failures a planner can actually fix — still
 * carries the placeholder, and the run card rendered it in a black console box
 * directly beneath the red error. The most visible thing under "this failed" was
 * a line saying it was starting.
 *
 * Decided at DISPLAY time rather than in the worker, so it also covers every
 * stage row already written, and so a deployment running an older worker cannot
 * reintroduce it. The worker should stop leaving the placeholder too, but that
 * fixes only rows written after it ships.
 *
 * Returns the log to show, or null when there is nothing honest to show.
 */
export function stageLogForDisplay(stage: RunFailureStageLike): {
  log: string;
  /** True when the stage did not finish, so the log stops mid-way. */
  isPartial: boolean;
} | null {
  const log = stage.log_tail?.trim();
  if (!log) return null;

  const terminated = stage.status === "failed" || stage.status === "cancelled";
  if (!terminated) return { log, isPartial: false };

  // The claim-time placeholder, matched exactly against what the worker writes
  // (`f"Starting {stage_name}..."`). An inexact match is safe: the log is then
  // shown and labelled as reaching only the point of failure, which is true of
  // the placeholder too — just less useful.
  const stageName = stage.stage_name?.trim();
  if (stageName && log === `Starting ${stageName}...`) return null;

  return { log, isPartial: true };
}

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
  failureCount,
  lastFailureMessage,
}: {
  status: string | null | undefined;
  errorMessage?: string | null;
  stages?: ReadonlyArray<RunFailureStageLike> | null;
  /** `model_runs.failure_count` — prior failed attempts this run was relaunched after. */
  failureCount?: number | null;
  /** `model_runs.last_failure_message` — the previous failed attempt's recorded reason. */
  lastFailureMessage?: string | null;
}): RunFailureSummary | null {
  if (!status || !TERMINAL_FAILURE_STATUSES.has(status)) return null;

  // Repeat framing applies only to a FAILED run with a failed past: a
  // cancelled run is not a failure, and a first failure has nothing to
  // compare against. `sameAsLast` is an exact match of recorded reasons —
  // a conservative comparison that can only under-claim repetition, never
  // invent it.
  const priorFailures = status === "failed" && typeof failureCount === "number" && failureCount > 0
    ? failureCount
    : 0;
  const currentRecorded = recordableFailureMessage({ errorMessage, stages });
  const previousRecorded = lastFailureMessage?.trim() || null;
  const repeat =
    priorFailures > 0
      ? {
          priorFailures,
          sameAsLast:
            currentRecorded !== null &&
            previousRecorded !== null &&
            currentRecorded === previousRecorded,
        }
      : null;

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
      repeat,
    };
  }

  const stage = causingStage(stages ?? []);
  const stageName = stage?.stage_name?.trim() || null;
  const stageMessage = stage?.error_message?.trim();

  if (!stageMessage) {
    // A run that failed and recorded nothing. Saying so is the honest answer;
    // the alternative that shipped for months was a sentence implying success.
    // "Re-launch to retry" is advice for a FIRST failure only: once the run
    // has already been relaunched after failing, repeating it turns the copy
    // into a treadmill, so a repeat sends the planner to the logs instead.
    const advice = repeat
      ? "It has already been relaunched after failing — whoever runs your OpenPlan deployment can check the worker's logs."
      : "Re-launch to retry — if it fails again, whoever runs your OpenPlan deployment can check the worker's logs.";
    return {
      headline: stageName
        ? `This run failed during ${stageName} and no reason was recorded. ${advice}`
        : `This run failed and no reason was recorded. ${advice}`,
      stageName,
      isRawEngineOutput: false,
      rawMessage: null,
      repeat,
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
      repeat,
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
    repeat,
  };
}
