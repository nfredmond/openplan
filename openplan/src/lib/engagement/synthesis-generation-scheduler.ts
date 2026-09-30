import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { loadSynthesisWorkerAuthorization, synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";
import { verifySynthesisGenerationPlanState } from "./synthesis-generation-plan";
import { runSynthesisGenerationWorkerAttempt } from "./synthesis-generation-worker";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const initialSchema = z.object({ taskIndex: natural, authorizationId: id }).strict();
const scheduleSchema = z.object({ version: z.literal(1), target: z.string(), authorizationId: id,
  requestId: id, headerSha256: hash, authorizationIntentSha256: hash,
  initialAttempts: z.array(initialSchema), taskIndices: z.array(natural),
}).strict();
const attemptSchema = z.object({ id, request_id: id, authorization_id: id, task_index: natural, binding_text: z.string() }).strict();
type Service = Pick<SupabaseClient, "from" | "rpc">;
type Authority = Awaited<ReturnType<typeof loadSynthesisWorkerAuthorization>>;
const JOURNAL_BYTES = 16 * 1024 * 1024;
function differs(): never { throw new Error("Synthesis schedule differs from its retained authorization or inventory"); }

function selectedTasks(authority: Authority, initial: z.infer<typeof initialSchema>[]) {
  if (authority.authorization.retryTaskIndex !== null) {
    if (initial.length) differs();
    return [authority.authorization.retryTaskIndex];
  }
  let previous = -1;
  const claimed = new Map<number, string>();
  for (const entry of initial) {
    if (entry.taskIndex <= previous || entry.taskIndex >= authority.plan.entries.length) differs();
    claimed.set(entry.taskIndex, entry.authorizationId); previous = entry.taskIndex;
  }
  // Earlier initial attempts remain historical work, including uncertain ones.
  // This grant can recover its own directories or claim still-unattempted tasks.
  const own = initial.filter(entry => entry.authorizationId === authority.grant.id).map(entry => entry.taskIndex);
  if (own.length > authority.authorization.maxAttempts) differs();
  const fresh = authority.plan.entries.filter(task => !claimed.has(task.index))
    .slice(0, authority.authorization.maxAttempts - own.length).map(task => task.index);
  return [...own, ...fresh].sort((left, right) => left - right);
}

async function initialAttempts(service: Service, authority: Authority, signal: AbortSignal) {
  if (authority.authorization.retryTaskIndex !== null) return [];
  const entries: z.infer<typeof initialSchema>[] = [];
  const seen = new Set<string>();
  let cursor = -1;
  for (;;) {
    signal.throwIfAborted();
    const response = await service.from("engagement_synthesis_generation_attempts")
      .select("id,request_id,authorization_id,task_index,binding_text")
      .eq("request_id", authority.request.id).is("previous_attempt_id", null)
      .gt("task_index", cursor).order("task_index", { ascending: true }).limit(128)
      .abortSignal(synthesisWorkerRequestSignal(signal));
    if (response.error) throw new Error("Synthesis initial attempt inventory unavailable");
    const page = z.array(attemptSchema).max(128).parse(response.data);
    if (!page.length) return entries;
    for (const attempt of page) {
      const task = authority.plan.entries[attempt.task_index];
      if (attempt.request_id !== authority.request.id || attempt.task_index <= cursor || !task || seen.has(attempt.id)) differs();
      const expected = { jobId: authority.request.id, planSha256: authority.plan.header.taskManifestSha256,
        configurationRevisionId: authority.intent.configurationRevisionId, configurationHash: authority.intent.configurationHash,
        provider: "api_connection", modelId: authority.intent.modelId, taskSha256: task.sha256, attemptId: attempt.id };
      if (!isDeepStrictEqual(JSON.parse(attempt.binding_text), expected)) differs();
      entries.push({ taskIndex: attempt.task_index, authorizationId: attempt.authorization_id });
      seen.add(attempt.id); cursor = attempt.task_index;
    }
    // Continue after a short page too: an operator may configure a lower server
    // row ceiling. Concurrent claims are ultimately fenced by the native command.
  }
}

/** Drain an explicitly authorized grant through existing one-attempt journals.
 * The directory is the authorization parent used by the single-task CLI. The
 * saved schedule does not replan after interruption or create retry authority.
 * Draining a grant is not full source processing, valid output or staff review.
 */
export async function runSynthesisGenerationSchedule(args: {
  service: Service; target: string; directory: string; authorizationId: string; signal: AbortSignal;
  runAttempt?: typeof runSynthesisGenerationWorkerAttempt;
}) {
  const target = providerApiWorkerTarget(args.target), authorizationId = id.parse(args.authorizationId);
  const scheduleDirectory = join(args.directory, "schedule");
  const lock = await acquireConnectorLock(scheduleDirectory), signal = AbortSignal.any([args.signal, lock.signal]);
  try {
    signal.throwIfAborted();
    const authority = await loadSynthesisWorkerAuthorization(args.service, authorizationId, signal);
    let schedule: z.infer<typeof scheduleSchema> | null;
    try { schedule = scheduleSchema.parse(await readPrivateJson(join(scheduleDirectory, "pending.json"), JOURNAL_BYTES)); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") schedule = null;
      else throw error;
    }
    if (!schedule) {
      const response = await args.service.rpc("read_engagement_synthesis_generation_plan", { p_request: authority.request.id })
        .abortSignal(synthesisWorkerRequestSignal(signal));
      if (response.error) throw new Error("Synthesis worker plan unavailable for a new schedule");
      const current = verifySynthesisGenerationPlanState(authority.plan, response.data);
      if (!current.seal || current.cancelled || Date.parse(authority.authorization.expiresAt) <= Date.now()) {
        throw new Error("Synthesis authorization is no longer current for a new schedule");
      }
      const initial = await initialAttempts(args.service, authority, signal);
      schedule = { version: 1, target, authorizationId, requestId: authority.request.id,
        headerSha256: authority.plan.headerSha256, authorizationIntentSha256: authority.grant.intent_sha256,
        initialAttempts: initial, taskIndices: selectedTasks(authority, initial) };
      if (Buffer.byteLength(JSON.stringify(schedule), "utf8") > JOURNAL_BYTES) throw new Error("Synthesis schedule exceeds its journal byte bound");
      signal.throwIfAborted();
      await writeConnectorJournal(scheduleDirectory, schedule);
    }
    if (schedule.target !== target || schedule.authorizationId !== authorizationId || schedule.requestId !== authority.request.id ||
      schedule.headerSha256 !== authority.plan.headerSha256 || schedule.authorizationIntentSha256 !== authority.grant.intent_sha256 ||
      !isDeepStrictEqual(schedule.taskIndices, selectedTasks(authority, schedule.initialAttempts))) differs();
    const outcomes: Array<{ taskIndex: number; state: "delivered" | "unobserved"; attemptId: string; captureSha256?: string }> = [];
    for (const taskIndex of schedule.taskIndices) {
      signal.throwIfAborted();
      const result = await (args.runAttempt ?? runSynthesisGenerationWorkerAttempt)({ service: args.service, target,
        directory: join(args.directory, String(taskIndex)), authorizationId, taskIndex, signal });
      // The worker rechecks custody even for previously delivered journals.
      // Unobserved tasks consume their existing attempt and get no replacement.
      outcomes.push({ taskIndex, ...result });
    }
    return { state: "grant_drained" as const, requestId: authority.request.id, authorizationId,
      taskCount: authority.plan.entries.length, scheduledCount: schedule.taskIndices.length,
      outsideScheduleCount: authority.plan.entries.length - schedule.taskIndices.length, outcomes };
  } finally { await lock.release(); }
}
