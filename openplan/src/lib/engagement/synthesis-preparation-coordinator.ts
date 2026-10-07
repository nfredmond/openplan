import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { listSynthesisPreparationCandidates } from "./synthesis-preparation-candidates";
import { runSynthesisPreparationJournal } from "./synthesis-preparation-journal";
import { prepareSynthesisStage } from "./synthesis-preparation-driver";
import { verifySynthesisPreparationOutcome } from "./synthesis-preparation-worker";

const id = z.string().uuid().regex(/^[a-f0-9-]+$/);
const entrySchema = z.object({ directoryId: id, requestId: id }).strict();
const schema = z.object({ version: z.literal(1), target: z.string(), after: id.nullable(), retryAfter: id.nullable(),
  pending: z.array(entrySchema) }).strict();
const resultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not_active"), requestId: id, token: id }).strict(),
  z.object({ state: z.literal("acknowledged"), requestId: id, token: id, outcome: z.unknown() }).strict(),
]);
const JOURNAL_BYTES = 16 * 1024 * 1024;
type Entry = z.infer<typeof entrySchema>;
type State = z.infer<typeof schema>;
function checkedState(raw: unknown, target: string): State {
  const state = schema.parse(raw), requests = new Set<string>();
  if (state.target !== target) throw new Error("Preparation coordinator target differs");
  let previous = "";
  for (const entry of state.pending) {
    if (entry.directoryId <= previous || requests.has(entry.requestId)) throw new Error("Preparation coordinator inventory differs");
    previous = entry.directoryId; requests.add(entry.requestId);
  }
  return state;
}

/** One pass retries up to64 retained attempts, then discovers one queue page.
 * Unconfirmed attempts keep their exact directories and cannot receive another
 * local attempt. Rotating retries lets unrelated work continue. Terminal child
 * journals remain on disk after removal from the active index. A wrapped queue
 * cursor is a pagination fact, not a claim that all preparation is complete.
 */
export async function runSynthesisPreparationQueuePass(args: {
  service: Pick<SupabaseClient, "from" | "rpc">; target: string; directory: string; signal: AbortSignal;
}) {
  const target = providerApiWorkerTarget(args.target);
  args.signal.throwIfAborted();
  const lock = await acquireConnectorLock(args.directory), signal = AbortSignal.any([args.signal, lock.signal]);
  try {
    signal.throwIfAborted();
    let state: State;
    try { state = checkedState(await readPrivateJson(join(args.directory, "pending.json"), JOURNAL_BYTES), target); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      state = { version: 1, target, after: null, retryAfter: null, pending: [] };
    }
    const save = async () => {
      signal.throwIfAborted();
      checkedState(state, target);
      if (Buffer.byteLength(JSON.stringify(state), "utf8") > JOURNAL_BYTES) throw new Error("Preparation coordinator journal exceeds its byte bound");
      await writeConnectorJournal(args.directory, state);
      signal.throwIfAborted();
    };
    // Establish target custody before any native discovery or attempt.
    await save();
    const outcomes: Array<Entry & { state: "acknowledged" | "not_active" | "unconfirmed" }> = [];
    async function attempt(entry: Entry, retry: boolean) {
      signal.throwIfAborted();
      let status: "acknowledged" | "not_active" | "unconfirmed" = "unconfirmed";
      try {
        const result = resultSchema.parse(await runSynthesisPreparationJournal({ service: args.service, target,
          directory: join(args.directory, entry.directoryId), requestId: entry.requestId, signal,
          prepare: (lease, stageSignal) => prepareSynthesisStage(args.service, lease, stageSignal) }));
        signal.throwIfAborted();
        if (result.requestId !== entry.requestId) throw new Error("Preparation coordinator result differs");
        if (result.state === "acknowledged") verifySynthesisPreparationOutcome(result.outcome);
        status = result.state;
      } catch { signal.throwIfAborted(); }
      if (status !== "unconfirmed") state.pending = state.pending.filter(saved => saved.directoryId !== entry.directoryId);
      if (retry) state.retryAfter = entry.directoryId;
      await save();
      outcomes.push({ ...entry, state: status });
    }
    const later = state.pending.filter(entry => state.retryAfter === null || entry.directoryId > state.retryAfter);
    const retries = (later.length ? later : state.pending).slice(0, 64);
    for (const entry of retries) await attempt(entry, true);
    signal.throwIfAborted();
    const page = await listSynthesisPreparationCandidates({ service: args.service, after: state.after, signal });
    signal.throwIfAborted();
    const requests = new Set(state.pending.map(entry => entry.requestId));
    const fresh = page.requestIds.filter(requestId => !requests.has(requestId)).map(requestId => ({ requestId, directoryId: randomUUID() }));
    state.pending = [...state.pending, ...fresh].sort((left, right) => left.directoryId.localeCompare(right.directoryId, "en-US"));
    state.after = page.nextAfter;
    // Sync every new directory identity and the cursor together before claiming.
    await save();
    for (const entry of fresh) await attempt(entry, false);
    return { outcomes, pendingCount: state.pending.length, queueWrapped: page.nextAfter === null };
  } finally { await lock.release(); }
}
