/**
 * MODEL RUN DISPATCH — pushing a queued run at a worker, and saying honestly
 * what (if anything) has taken it.
 *
 * WHAT THIS DOES NOT DO
 *   It does not create compute. On a deployment where nobody runs a worker,
 *   nothing here makes a model run execute, and no sentence in this module may
 *   suggest otherwise. What it removes is a narrower, real defect: today the
 *   ONLY way a run reaches a worker is for that worker to be a long-lived
 *   process polling this database. An operator who would rather run a stateless
 *   pool — a container that wakes on a request, executes, and goes away — has no
 *   way to be told there is work. Push is that seam.
 *
 * PUSH IS A DOORBELL, NOT A HANDOFF — and that is what keeps it safe
 *   The run and its stages are written to the database exactly as before, in
 *   status `queued`. This module then POSTs a POINTER (the run id) to the
 *   configured worker. It does NOT mark the run as owned, assigned, or claimed,
 *   and there is deliberately no "this one was pushed, pollers keep off" flag.
 *
 *   That is the whole reason a pushed run cannot be double-executed. The worker
 *   claims each stage with a conditional PATCH (`id=eq.X&status=eq.queued`,
 *   `return=representation`), so exactly one process can move a stage out of
 *   `queued`; every other process — pushed or polling — gets an empty result set
 *   and moves on. The atomic claim already in the worker is the lock, so this
 *   layer must not invent a second one. An "assigned" flag would be strictly
 *   worse: a pushed worker that died between accepting and claiming would leave
 *   a run that no poller is allowed to rescue.
 *
 *   The consequence to hold on to: a deployment running today's polling worker
 *   and nothing else is completely unaffected. With no push endpoint configured
 *   this module makes no request at all.
 *
 * THE THREE ANSWERS A PLANNER IS OWED
 *   Before this, a launched worker-backed run said "queued" whether a worker had
 *   taken it, a poller might eventually take it, or nothing on earth would ever
 *   look at it. Those are three different futures and they were rendered
 *   identically. `describeModelRunDispatch` turns the dispatch outcome plus the
 *   deployment's own declaration into one of four states — the fourth being
 *   "OpenPlan cannot tell", which is the truthful answer when a deployment
 *   configures no push endpoint and declares nothing.
 */

import {
  MODELING_WORKER_TOKEN_ENV,
  MODELING_WORKER_URL_ENV,
  type ModelingWorkerDeclaration,
} from "@/lib/config/deployment-health";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WORKER_BACKED_ENGINE_KEYS } from "./worker-backed-launch";

/**
 * Where to push, and the shared secret to present. The NAMES live beside the
 * deployment-health check that has to print them (see there); this module is
 * what reads them. Both are required: a URL without a token would have OpenPlan
 * ringing an UNAUTHENTICATED compute trigger, which is an abuse surface rather
 * than a convenience, and the worker we ship refuses to serve without one for
 * the same reason.
 */
export { MODELING_WORKER_TOKEN_ENV, MODELING_WORKER_URL_ENV };

/**
 * Optional operator bound on how many worker-backed runs one workspace may have
 * in flight at once. Same mould as `run-cap.ts`: UNSET MEANS UNLIMITED and the
 * counting query is skipped entirely, the refusal names whoever operates the
 * deployment, and it is never a tier — there is nothing to buy.
 */
export const MODELING_QUEUE_DEPTH_ENV = "OPENPLAN_MODELING_QUEUE_DEPTH";

/**
 * Path appended to the configured base URL, mirroring how the aerial dispatcher
 * appends its own contract path. Appending (rather than treating the variable as
 * a complete endpoint) means an operator behind a gateway sets the prefix once —
 * `https://gw.example/aeq` reaches `https://gw.example/aeq/api/v1/model-runs` —
 * and the path stays owned by the contract on both sides.
 */
export const MODEL_RUN_DISPATCH_PATH = "/api/v1/model-runs";

/** Versioned so a worker can refuse a payload shape it does not understand. */
export const MODEL_RUN_DISPATCH_CONTRACT = "openplan-modeling-dispatch.v1";

/**
 * The stage names a worker-backed run is made of, in the order they run.
 *
 * They live here, with the dispatch contract, because a stage NAME is the whole
 * agreement between the app that writes the row and the worker that claims it:
 * the AequilibraE worker's poll query filters on exactly these three strings, so
 * a name spelt differently in one of the routes that inserts them is a run
 * nothing will ever pick up, with no error anywhere. They were written out
 * literally in four places before this; one source is the point.
 */
export const AEQUILIBRAE_SCREENING_STAGE_NAMES = [
  "AequilibraE Setup",
  "Network Assignment",
  "Artifact Extraction",
] as const;

/** Owned by the ActivitySim worker, not the AequilibraE one. */
export const ACTIVITYSIM_PREFLIGHT_STAGE_NAME = "ActivitySim Bundle & Preflight";
export const ACTIVITYSIM_ASSIGNMENT_STAGE_NAME = "ActivitySim Network Assignment";

/**
 * The stages a run of this engine is made of. Behavioral demand runs the same
 * three screening stages, hands execution to the ActivitySim worker, then hands
 * its vehicle matrix back to AequilibraE for same-network assignment. Each
 * worker claims only the names it owns.
 */
export function workerRunStageNames(engineKey: string | null | undefined): readonly string[] {
  return engineKey === "behavioral_demand"
    ? [
        ...AEQUILIBRAE_SCREENING_STAGE_NAMES,
        ACTIVITYSIM_PREFLIGHT_STAGE_NAME,
        ACTIVITYSIM_ASSIGNMENT_STAGE_NAME,
      ]
    : AEQUILIBRAE_SCREENING_STAGE_NAMES;
}

/** Queued stage rows for a run, ordered as `workerRunStageNames` lists them. */
export function queuedStageRows(runId: string, stageNames: readonly string[]) {
  return stageNames.map((stageName, index) => ({
    run_id: runId,
    stage_name: stageName,
    sort_order: index + 1,
    status: "queued",
  }));
}

const DISPATCH_TIMEOUT_MS = 10_000;

export type ModelRunDispatchTarget = {
  /** Full endpoint, path already appended. Never rendered to a planner. */
  endpoint: string;
  token: string;
  /** Host only — safe to show, and enough for an operator to recognise. */
  host: string;
};

/**
 * A configuration problem worth reporting rather than silently ignoring.
 *
 * `null` when this deployment simply has no push endpoint, which is a perfectly
 * good configuration (the polling worker is unaffected). Non-null when the
 * operator evidently MEANT to configure one and it will not be used — telling
 * them "no push endpoint is configured" in that state would be technically true
 * and practically a lie.
 */
export function describeDispatchConfigurationProblem(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const url = env[MODELING_WORKER_URL_ENV]?.trim();
  const token = env[MODELING_WORKER_TOKEN_ENV]?.trim();

  if (!url) {
    return token
      ? `${MODELING_WORKER_TOKEN_ENV} is set but ${MODELING_WORKER_URL_ENV} is not, so there is nowhere to push a run and the token does nothing.`
      : null;
  }

  if (!token) {
    return `${MODELING_WORKER_URL_ENV} is set but ${MODELING_WORKER_TOKEN_ENV} is not. OpenPlan will not trigger an unauthenticated worker, so nothing is pushed and runs fall back to waiting for a poller.`;
  }

  try {
    // Parsed here rather than at dispatch time so a typo is reported on the
    // deployment dashboard instead of surfacing once per launch as a failure.
    new URL(url);
  } catch {
    return `${MODELING_WORKER_URL_ENV} is not a valid URL, so no run can be pushed to it.`;
  }

  return null;
}

/** The push target, or null when this deployment has none it can safely use. */
export function resolveModelRunDispatchTarget(
  env: NodeJS.ProcessEnv = process.env
): ModelRunDispatchTarget | null {
  const rawUrl = env[MODELING_WORKER_URL_ENV]?.trim();
  const token = env[MODELING_WORKER_TOKEN_ENV]?.trim();
  if (!rawUrl || !token) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  return {
    endpoint: `${rawUrl.replace(/\/+$/, "")}${MODEL_RUN_DISPATCH_PATH}`,
    token,
    host: parsed.host,
  };
}

/** Does this deployment have a usable push endpoint? Configuration, not a probe. */
export function isPushDispatchConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveModelRunDispatchTarget(env) !== null;
}

export type ModelRunDispatchOutcome =
  /** No push endpoint here. Nothing was sent; the run waits on the queue. */
  | { state: "not_configured" }
  /** A worker answered 200/202. Something has the run. */
  | { state: "accepted"; workerHost: string; jobReference: string | null }
  /** A push endpoint is configured and did not take it. The run stays queued. */
  | { state: "dispatch_failed"; workerHost: string; detail: string };

export type ModelRunDispatchPayload = {
  contract: typeof MODEL_RUN_DISPATCH_CONTRACT;
  requestId: string;
  runId: string;
  engineKey: string;
  /**
   * The stage rows just written for this run. Advisory only — the receiving
   * worker claims from the database, and claims only the stages it owns by name
   * (a `behavioral_demand` run's final ActivitySim stage belongs to a different
   * worker). Sent so a pool can log what it was woken for.
   */
  stageNames: string[];
  occurredAt: string;
};

export function buildModelRunDispatchPayload(params: {
  requestId: string;
  runId: string;
  engineKey: string;
  stageNames: string[];
  occurredAt?: string;
}): ModelRunDispatchPayload {
  return {
    contract: MODEL_RUN_DISPATCH_CONTRACT,
    requestId: params.requestId,
    runId: params.runId,
    engineKey: params.engineKey,
    stageNames: params.stageNames,
    occurredAt: params.occurredAt ?? new Date().toISOString(),
  };
}

/**
 * Push a queued run at the configured worker.
 *
 * NEVER THROWS, and never fails the launch. A push that does not land leaves
 * exactly the state that existed before this module: a queued run on a queue a
 * poller may still be serving. Turning a failed doorbell into a failed launch
 * would break deployments that run the poller and mistyped a URL.
 *
 * 200 and 202 are both acceptance. Unlike the aerial contract — where the
 * response body is load-bearing because the worker owes us callbacks keyed by
 * the reference it returns — this worker owes us nothing over HTTP: it reports
 * by writing the same stage rows the poller writes. So the body is read only for
 * an optional job reference to put in the audit log, and a pool that answers a
 * bare 202 is fully supported.
 */
/**
 * The sentence inside a refusal, if the worker wrote one.
 *
 * A refusal is the one response body a PLANNER ends up reading, because it is
 * quoted into the launch answer — and the worker we ship refuses in JSON
 * (`{"error":"pool_at_capacity","detail":"…"}`). Pasting that object onto a
 * screen would bury the only sentence that says what happened and what to do
 * next. Unrecognised bodies are passed through as-is rather than dropped:
 * anything can be behind that URL, and an unfamiliar shape is still evidence.
 */
function explainWorkerRefusal(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    for (const key of ["detail", "message", "error"]) {
      const value = parsed?.[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
    }
  } catch {
    // Not JSON; the raw text is the best available answer.
  }
  return body.slice(0, 300);
}

export async function dispatchModelRun(
  payload: ModelRunDispatchPayload,
  options: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {}
): Promise<ModelRunDispatchOutcome> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const target = resolveModelRunDispatchTarget(env);

  if (!target) {
    const problem = describeDispatchConfigurationProblem(env);
    if (problem) {
      // A configured-but-unusable endpoint is reported as a dispatch failure
      // rather than as "no endpoint", because the operator believes they have
      // one and the planner needs the same truth either way: nothing took it.
      return {
        state: "dispatch_failed",
        workerHost: env[MODELING_WORKER_URL_ENV]?.trim() ? "the configured worker" : "no worker",
        detail: problem,
      };
    }
    return { state: "not_configured" };
  }

  let response: Response;
  try {
    response = await fetcher(target.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : "request failed";
    return {
      state: "dispatch_failed",
      workerHost: target.host,
      detail: `Could not reach the worker: ${detail}`,
    };
  }

  if (response.status !== 200 && response.status !== 202) {
    const body = (await response.text().catch(() => "")).trim();
    const explanation = explainWorkerRefusal(body);
    return {
      state: "dispatch_failed",
      workerHost: target.host,
      detail: explanation
        ? `The worker answered ${response.status}: ${explanation}`
        : `The worker answered ${response.status}.`,
    };
  }

  const accepted = (await response.json().catch(() => null)) as { jobReference?: unknown } | null;
  const jobReference =
    accepted && typeof accepted.jobReference === "string" && accepted.jobReference.trim()
      ? accepted.jobReference.trim().slice(0, 200)
      : null;

  return { state: "accepted", workerHost: target.host, jobReference };
}

/**
 * What a planner is told after a worker-backed run is queued.
 *
 * `unknown` is not a hedge, it is the answer. A deployment with no push endpoint
 * and no declaration has told OpenPlan nothing, and the worker is a poller with
 * no heartbeat to read — so any of "it is running", "it will run", "it will not
 * run" would be a confident claim drawn from no evidence.
 */
export type ModelRunExecutionOutlook = {
  state: "accepted" | "waiting_for_poller" | "unattended" | "unknown";
  /** One clause naming what has, or has not, taken the run. */
  headline: string;
  /** The evidence and the consequence. Never an upgrade, never a purchase. */
  detail: string;
};

export function describeModelRunDispatch(
  outcome: ModelRunDispatchOutcome,
  declaration: ModelingWorkerDeclaration
): ModelRunExecutionOutlook {
  if (outcome.state === "accepted") {
    return {
      state: "accepted",
      headline: `A processing worker at ${outcome.workerHost} accepted this run.`,
      // The last two sentences are not hedging, they are the boundary of what an
      // acceptance can mean. The worker answers before it executes — it has to,
      // because a run takes minutes and no timeout in the path would survive
      // holding the connection — so "accepted" is a statement about a process
      // that might not exist in a minute, which on a scale-to-zero pool is a
      // routine event rather than an exotic one. Saying only "a worker took it"
      // would leave a planner reading a stalled run as a run in progress, which
      // is the same defect as reporting a queued run nothing will ever look at.
      detail:
        "OpenPlan pushed the run to that worker and it answered that it had taken it. Progress appears as its stages complete; the worker reports by writing to this database, so OpenPlan is reading its work rather than watching the process. That is also the limit of what acceptance proves: if the worker stops before finishing — a pool instance reclaimed mid-run, a crash, a redeploy — the run stops progressing rather than failing by itself. OpenPlan marks a run failed once it has been stalled long enough, so it will not sit here looking alive indefinitely, and any stage the worker never claimed is still queued for another worker to take.",
    };
  }

  const pushFailed = outcome.state === "dispatch_failed";

  // Deliberately does NOT say OpenPlan "tried and the worker refused". A
  // `dispatch_failed` covers two different things — a request that was made and
  // rejected, and a push endpoint too incompletely configured to call at all —
  // and the second one makes no request. Asserting an attempt there would be a
  // confident statement about something that did not happen, and it contradicted
  // the very next sentence, which said nothing was pushed. `outcome.detail`
  // already distinguishes the two ("The worker answered 401…" versus "…is set
  // but …_TOKEN is not"), so this clause states only what is true of both: the
  // run did not reach a worker, and it is still queued.
  const pushFailure = pushFailed
    ? `OpenPlan could not hand this run to a worker. ${outcome.detail} The run is still on the queue.`
    : "This OpenPlan installation is not set up to hand runs straight to a worker, so the run sits on the queue until a worker checks for it.";

  /**
   * What the operator could do next — which is NOT the same sentence in both
   * cases, and that is the point. "Configure a push endpoint" is an instruction
   * that cannot succeed for the deployment that already has one and just watched
   * it fail; it is the one deployment most likely to be reading this, because a
   * scale-to-zero pool that fails to wake is exactly the case push exists for.
   */
  const operatorNext = pushFailed
    ? `The message above came back from the push endpoint this installation already configures, so whoever operates it has something specific to check rather than something to set up.`
    : `Whoever operates this OpenPlan installation can also configure a push endpoint (${MODELING_WORKER_URL_ENV} / ${MODELING_WORKER_TOKEN_ENV}), which OpenPlan calls at launch and gets an answer from.`;

  if (declaration === "absent") {
    return {
      state: "unattended",
      headline: "Nothing on this OpenPlan installation is going to execute this run.",
      detail: `${pushFailure} This installation also declares that no AequilibraE worker checks it for runs, so the run will sit queued and then be failed rather than finishing. Nothing about this workspace or this study area caused that, and there is nothing to buy — OpenPlan is free. ${
        pushFailed
          ? operatorNext
          : `Whoever operates this OpenPlan installation either runs the polling worker or configures a push endpoint (${MODELING_WORKER_URL_ENV} / ${MODELING_WORKER_TOKEN_ENV}).`
      }`,
    };
  }

  if (declaration === "deployed") {
    return {
      state: "waiting_for_poller",
      headline: "This run is waiting for the modeling worker to pick it up.",
      detail: `${pushFailure} This installation declares that an AequilibraE worker checks it for runs, which is a statement of configuration and not a live check — the worker cannot be probed from here. If that worker is running, it will claim this run the next time it checks.`,
    };
  }

  return {
    state: "unknown",
    headline: "OpenPlan cannot tell whether anything will execute this run.",
    detail: `${pushFailure} Nothing declares whether an AequilibraE worker checks this installation for runs, and the worker cannot be probed and reports no status of its own, so there is no evidence either way until the run either starts or is failed for having been abandoned. ${operatorNext}`,
  };
}

/* ── Operator bound on the worker queue ──────────────────────────────────────
 *
 * Modelled on `run-cap.ts` and for the same reason: someone running a public
 * deployment on their own compute may need to bound it, and that is deployment
 * CONFIGURATION rather than a tier of service. Unset — the default, and what a
 * self-hosting agency gets — is unlimited, and the counting query never runs.
 *
 * This bounds runs IN FLIGHT (queued or running on a worker-backed engine),
 * which is the thing that actually costs a worker pool something, and it is
 * per-workspace because that is what the caller's own client can see under RLS.
 * It is deliberately NOT a monthly total: `run-cap.ts` already owns that, and
 * two overlapping monthly caps would be a maze.
 */

const IN_FLIGHT_RUN_STATUSES = ["queued", "running"] as const;

export type ModelingQueueDepthResult =
  | { ok: true; bounded: boolean; limit: number | null; inFlight: number }
  | { ok: false; exceeded: true; limit: number; inFlight: number; message: string }
  | { ok: false; lookupError: true; message: string; code: string | null };

/** The configured bound, or null for unlimited. A non-positive or malformed
 * value is treated as UNSET, never as zero — a typo must not lock every
 * workspace out of worker-backed modeling. */
export function resolveModelingQueueDepth(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env[MODELING_QUEUE_DEPTH_ENV]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function modelingQueueDepthMessage(limit: number, inFlight: number): string {
  return (
    `This OpenPlan installation limits a workspace to ${limit} model run${limit === 1 ? "" : "s"} on the processing worker at once, and this workspace has ${inFlight} in flight. ` +
    `Wait for one to finish, or contact whoever operates this installation to raise or remove the limit — OpenPlan itself is free and has no usage tiers.`
  );
}

export async function checkModelingQueueDepth(
  supabase: SupabaseClient,
  params: { workspaceId: string; env?: NodeJS.ProcessEnv }
): Promise<ModelingQueueDepthResult> {
  const env = params.env ?? process.env;
  const limit = resolveModelingQueueDepth(env);
  if (limit === null) return { ok: true, bounded: false, limit: null, inFlight: 0 };

  const { count, error } = await supabase
    .from("model_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", params.workspaceId)
    .in("engine_key", [...WORKER_BACKED_ENGINE_KEYS])
    .in("status", [...IN_FLIGHT_RUN_STATUSES]);

  if (error) {
    return { ok: false, lookupError: true, message: error.message, code: error.code ?? null };
  }

  const inFlight = count ?? 0;
  if (inFlight >= limit) {
    return {
      ok: false,
      exceeded: true,
      limit,
      inFlight,
      message: modelingQueueDepthMessage(limit, inFlight),
    };
  }

  return { ok: true, bounded: true, limit, inFlight };
}

/** Narrow: the counting query itself failed (500-class). */
export function isQueueDepthLookupError(
  result: ModelingQueueDepthResult
): result is Extract<ModelingQueueDepthResult, { lookupError: true }> {
  return result.ok === false && "lookupError" in result;
}

/** Narrow: the configured bound is full (429-class). */
export function isQueueDepthExceeded(
  result: ModelingQueueDepthResult
): result is Extract<ModelingQueueDepthResult, { exceeded: true }> {
  return result.ok === false && "exceeded" in result;
}
