import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { loadSynthesisThematicScheduleAuthority } from "./synthesis-thematic-worker-authority";
import { loadSynthesisThematicWorkerInputs } from "./synthesis-thematic-worker-load";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";
import { runSynthesisThematicWorkerAttempt, type SynthesisWorkerOutcome } from "./synthesis-generation-worker";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const initialSchema = z.object({ attemptId: id, taskIndex: natural, authorizationId: id }).strict();
const scheduleSchema = z.object({ version: z.literal(1), thematic: z.literal(true), target: z.string(), authorizationId: id,
  requestId: id, headerSha256: hash, authorizationIntentSha256: hash,
  initialAttempts: z.array(initialSchema), taskIndices: z.array(natural),
}).strict();
const attemptSchema = z.object({ id, request_id: id, authorization_id: id, task_index: natural,
  previous_attempt_id: z.null(), binding_text: z.string().max(4096) }).strict();
const inputSchema = z.object({ attempt_id: id, task_text: z.string().max(1048576), task_sha256: hash, task_bytes: natural }).strict();
type Service = Pick<SupabaseClient, "from" | "rpc">;
type Authority = Awaited<ReturnType<typeof loadSynthesisThematicScheduleAuthority>>;
const JOURNAL_BYTES = 16 * 1024 * 1024;
const differs = (): never => { throw new Error("Thematic schedule differs from its retained authorization or inventory"); };

function selectedTasks(authority: Authority, initial: z.infer<typeof initialSchema>[]) {
  if (authority.authorization.retryTaskIndex !== null) {
    if (initial.length) differs();
    return [authority.authorization.retryTaskIndex];
  }
  const seen = new Set<string>(), claimed = new Set<number>();
  let previous = -1;
  for (const row of initial) {
    if (row.taskIndex <= previous || row.taskIndex >= authority.header.taskCount || seen.has(row.attemptId)) differs();
    seen.add(row.attemptId); claimed.add(row.taskIndex); previous = row.taskIndex;
  }
  const own = initial.filter(row => row.authorizationId === authority.grant.id).map(row => row.taskIndex);
  if (own.length > authority.authorization.maxAttempts) differs();
  const fresh: number[] = [];
  for (let index = 0; index < authority.header.taskCount && fresh.length < authority.authorization.maxAttempts - own.length; index++) {
    if (!claimed.has(index)) fresh.push(index);
  }
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
      .select("id,request_id,authorization_id,task_index,previous_attempt_id,binding_text")
      .eq("request_id", authority.scope.requestId).is("previous_attempt_id", null).gt("task_index", cursor)
      .order("task_index", { ascending: true }).limit(128).abortSignal(synthesisWorkerRequestSignal(signal));
    signal.throwIfAborted();
    if (response.error) throw new Error("Thematic initial attempt inventory unavailable");
    const page = z.array(attemptSchema).max(128).parse(response.data);
    if (!page.length) return entries;
    for (const attempt of page) {
      if (attempt.request_id !== authority.scope.requestId || attempt.task_index <= cursor ||
        attempt.task_index >= authority.header.taskCount || seen.has(attempt.id)) differs();
      const saved = await service.from("engagement_synthesis_thematic_attempt_inputs")
        .select("attempt_id,task_text,task_sha256,task_bytes").eq("attempt_id", attempt.id)
        .abortSignal(synthesisWorkerRequestSignal(signal)).single();
      signal.throwIfAborted();
      if (saved.error) throw new Error("Thematic initial attempt input unavailable");
      const input = inputSchema.parse(saved.data);
      if (input.attempt_id !== attempt.id || digest(input.task_text) !== input.task_sha256 ||
        Buffer.byteLength(input.task_text, "utf8") !== input.task_bytes || input.task_bytes > authority.intent.taskByteLimit) differs();
      const expected = { jobId: authority.scope.requestId, planSha256: authority.header.continuationHeaderSha256,
        configurationRevisionId: authority.intent.configurationRevisionId, configurationHash: authority.intent.configurationHash,
        provider: "api_connection", modelId: authority.intent.modelId, taskSha256: input.task_sha256, attemptId: attempt.id };
      if (!isDeepStrictEqual(JSON.parse(attempt.binding_text), expected)) differs();
      entries.push({ attemptId: attempt.id, taskIndex: attempt.task_index, authorizationId: attempt.authorization_id });
      seen.add(attempt.id); cursor = attempt.task_index;
    }
    // Continue through short pages too. Native claims fence concurrent attempts.
  }
}

/** Drain dependent thematic tasks through existing one-attempt journals. An
 * unresolved dispatch stops this schedule before any successor. Retained output
 * recovery needs historical identity only; the worker independently checks every
 * original predecessor and current permission before any fresh provider call.
 * Grant exhaustion does not establish a valid interpretation or staff approval.
 */
export async function runSynthesisThematicSchedule(args: {
  service: Service; target: string; directory: string; authorizationId: string; signal: AbortSignal;
  runAttempt?: typeof runSynthesisThematicWorkerAttempt;
}) {
  const target = providerApiWorkerTarget(args.target), authorizationId = id.parse(args.authorizationId);
  const directory = join(args.directory, "schedule"), lock = await acquireConnectorLock(directory);
  const signal = AbortSignal.any([args.signal, lock.signal]);
  try {
    signal.throwIfAborted();
    const authority = await loadSynthesisThematicScheduleAuthority(args.service, authorizationId, signal);
    function checkedSchedule(raw: unknown) {
      const schedule = scheduleSchema.parse(raw);
      if (schedule.target !== target || schedule.authorizationId !== authorizationId || schedule.requestId !== authority.scope.requestId ||
        schedule.headerSha256 !== authority.headerSha256 || schedule.authorizationIntentSha256 !== authority.grant.intent_sha256 ||
        !isDeepStrictEqual(schedule.taskIndices, selectedTasks(authority, schedule.initialAttempts))) differs();
      return schedule;
    }
    let schedule: z.infer<typeof scheduleSchema> | null;
    try { schedule = checkedSchedule(await readPrivateJson(join(directory, "pending.json"), JOURNAL_BYTES)); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") schedule = null;
      else throw error;
    }
    // A synced temporary can outlive an interrupted rename. Recover only an
    // exact checked schedule; preserve partial files and refuse disagreement.
    let recovered: z.infer<typeof scheduleSchema> | null = null;
    for (const filename of await readdir(directory)) {
      if (!/^pending-[0-9a-f-]+\.tmp$/.test(filename)) continue;
      signal.throwIfAborted();
      let candidate: z.infer<typeof scheduleSchema>;
      try { candidate = checkedSchedule(await readPrivateJson(join(directory, filename), JOURNAL_BYTES)); }
      catch (error) { if (error instanceof SyntaxError) continue; throw error; }
      if ((schedule && !isDeepStrictEqual(schedule, candidate)) || (recovered && !isDeepStrictEqual(recovered, candidate))) {
        throw new Error("Thematic worker has conflicting saved schedules");
      }
      recovered ??= candidate;
    }
    if (!schedule && recovered) {
      signal.throwIfAborted();
      await writeConnectorJournal(directory, recovered); schedule = recovered;
    }
    if (!schedule) {
      const inputs = await loadSynthesisThematicWorkerInputs(args.service, authority.scope.requestId, signal);
      if (inputs.plan.headerText !== authority.headerText || Date.parse(authority.authorization.expiresAt) <= Date.now()) {
        throw new Error("Thematic authorization is no longer current for a new schedule");
      }
      const initial = await initialAttempts(args.service, authority, signal);
      schedule = { version: 1, thematic: true, target, authorizationId, requestId: authority.scope.requestId,
        headerSha256: authority.headerSha256, authorizationIntentSha256: authority.grant.intent_sha256,
        initialAttempts: initial, taskIndices: selectedTasks(authority, initial) };
      if (Buffer.byteLength(JSON.stringify(schedule), "utf8") > JOURNAL_BYTES) throw new Error("Thematic schedule exceeds its journal byte bound");
      signal.throwIfAborted();
      await writeConnectorJournal(directory, schedule);
    }
    checkedSchedule(schedule);
    const outcomes: Array<SynthesisWorkerOutcome & { taskIndex: number }> = [];
    let stoppedAt: number | null = null;
    for (const taskIndex of schedule.taskIndices) {
      signal.throwIfAborted();
      const result = await (args.runAttempt ?? runSynthesisThematicWorkerAttempt)({ service: args.service, target,
        directory: join(args.directory, String(taskIndex)), authorizationId, taskIndex, signal });
      outcomes.push({ taskIndex, ...result });
      if (result.state === "unobserved") { stoppedAt = taskIndex; break; }
    }
    return { state: stoppedAt === null ? "grant_drained" as const : "predecessor_unobserved" as const,
      requestId: authority.scope.requestId, authorizationId, taskCount: authority.header.taskCount,
      scheduledCount: schedule.taskIndices.length, outsideScheduleCount: authority.header.taskCount - schedule.taskIndices.length,
      stoppedAt, outcomes };
  } finally { await lock.release(); }
}
