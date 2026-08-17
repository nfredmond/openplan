/**
 * How far along a model run is, for runs that legitimately take hours or days.
 *
 * WHY A PERCENTAGE AT ALL, AND WHY THIS ONE.
 *
 * OpenPlan spends runtime to get a defensible number: more boundary crossings,
 * finer zones, an assignment run to a tight convergence gap. A run can take
 * hours. Somebody watching one needs to know it is progressing and roughly how
 * far it has to go, and "the log moved" is not enough over a day.
 *
 * The honest measure is STAGES COMPLETED, because every stage row is created
 * up front when the run is launched — so the denominator is known, not
 * guessed. What is deliberately NOT offered is a time estimate: stages differ
 * in duration by an order of magnitude and an equilibrium assignment's length
 * is not knowable until it converges, so minutes-remaining would be a
 * fabrication presented with a progress bar's authority.
 *
 * The percentage therefore answers "how much of this run is done" and never
 * "how long until it finishes", and `describeProgress` says which stage is
 * running so the number is never the only thing a reader has.
 */

export type ProgressStageLike = {
  stage_name?: string | null;
  status?: string | null;
  sort_order?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
};

export type RunProgress = {
  /** Stages finished, out of the stages the run declared at launch. */
  completed: number;
  total: number;
  /** 0-100, whole numbers. Null when the run declared no stages. */
  percent: number | null;
  /** The stage currently executing, if one is. */
  runningStageName: string | null;
  /** 1-based position of the running stage, for "stage 3 of 6". */
  runningStagePosition: number | null;
  /** True once no stage can still advance. */
  isFinished: boolean;
  /** Human sentence; never mentions time remaining. */
  label: string;
};

const FINISHED_STATUSES = new Set(["succeeded", "completed", "skipped"]);
const TERMINAL_STATUSES = new Set([...FINISHED_STATUSES, "failed", "cancelled"]);

function inOrder(stages: readonly ProgressStageLike[]): ProgressStageLike[] {
  return [...stages].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function summarizeRunProgress(stages: readonly ProgressStageLike[] | null | undefined): RunProgress {
  const ordered = inOrder(stages ?? []);
  const total = ordered.length;
  if (total === 0) {
    return {
      completed: 0,
      total: 0,
      percent: null,
      runningStageName: null,
      runningStagePosition: null,
      isFinished: false,
      label: "Waiting for the run to report its stages.",
    };
  }

  const completed = ordered.filter((stage) => FINISHED_STATUSES.has((stage.status ?? "").toLowerCase())).length;
  const runningIndex = ordered.findIndex((stage) => (stage.status ?? "").toLowerCase() === "running");
  const failed = ordered.find((stage) => (stage.status ?? "").toLowerCase() === "failed");
  const isFinished = ordered.every((stage) => TERMINAL_STATUSES.has((stage.status ?? "").toLowerCase()));

  const running = runningIndex >= 0 ? ordered[runningIndex] : null;
  const percent = Math.round((completed / total) * 100);

  let label: string;
  if (failed) {
    label = `Stopped at ${failed.stage_name ?? "an unnamed stage"} — ${completed} of ${total} stages finished.`;
  } else if (running) {
    label = `Stage ${runningIndex + 1} of ${total}: ${running.stage_name ?? "unnamed stage"}.`;
  } else if (isFinished) {
    label = `All ${total} stages finished.`;
  } else {
    label = `${completed} of ${total} stages finished; the next has not started.`;
  }

  return {
    completed,
    total,
    percent,
    runningStageName: running?.stage_name ?? null,
    runningStagePosition: running ? runningIndex + 1 : null,
    isFinished,
    label,
  };
}

/**
 * How long the running stage has been going, in words.
 *
 * Elapsed time is a FACT and is offered; time remaining is a guess and is not.
 * On a run that lasts a day, "4h 12m in this stage" is the difference between
 * confidence and a support request.
 */
export function describeElapsed(startedAt: string | null | undefined, now: number): string | null {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started) || started > now) return null;
  const seconds = Math.floor((now - started) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainderMinutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * The assignment's convergence, pulled out of the line the worker streams.
 *
 * Reported as the two numbers themselves, NOT as a percentage: convergence is
 * logarithmic and non-monotonic in wall-clock terms, so a bar filling toward
 * the target would imply a rate that does not exist. A reader who can see
 * "0.0034, aiming for 0.0005" knows both where it is and that it is still
 * moving.
 */
export function latestConvergence(log: string | null | undefined): { gap: number; target: number } | null {
  if (!log) return null;
  const matches = [...log.matchAll(/relative gap ([0-9.eE+-]+), target ([0-9.eE+-]+)/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const gap = Number(last[1]);
  const target = Number(last[2]);
  if (!Number.isFinite(gap) || !Number.isFinite(target)) return null;
  return { gap, target };
}
