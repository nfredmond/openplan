import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { finishSynthesisPreparation, runSynthesisPreparationAttempt,
  verifySynthesisPreparationClaim, verifySynthesisPreparationOutcome } from "./synthesis-preparation-worker";

const id = z.string().uuid();
const common = { version: z.literal(1), target: z.string(), requestId: id, token: id };
const storedSchema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("claim") }).strict(),
  z.object({ ...common, phase: z.literal("not_active") }).strict(),
  z.object({ ...common, phase: z.literal("outcome"), lease: z.unknown(), outcome: z.unknown() }).strict(),
  z.object({ ...common, phase: z.literal("acknowledged"), lease: z.unknown(), outcome: z.unknown() }).strict(),
]);
function checkedJournal(raw: unknown, target: string, requestId: string) {
  const saved = storedSchema.parse(raw);
  if (saved.target !== target || saved.requestId !== requestId) throw new Error("Preparation journal scope differs");
  if (saved.phase === "claim" || saved.phase === "not_active") return saved;
  const lease = verifySynthesisPreparationClaim(saved.lease, requestId, saved.token);
  if (!lease) throw new Error("Preparation journal claim missing");
  const outcome = verifySynthesisPreparationOutcome(saved.outcome);
  return saved.phase === "outcome"
    ? { ...saved, phase: "outcome" as const, lease, outcome }
    : { ...saved, phase: "acknowledged" as const, lease, outcome };
}
type Journal = ReturnType<typeof checkedJournal>;
type OutcomeJournal = Extract<Journal, { phase: "outcome" }>;

/** One private directory records one attempt. Its token is synced before claim;
 * its exact outcome is synced before completion. A terminal directory is never
 * reused for a new attempt. Callers retain it and allocate another directory if
 * a later queue pass finds new eligible work. Acknowledged means a past receipt,
 * not current queue status. No journal state grants provider execution.
 */
export async function runSynthesisPreparationJournal(args: Omit<Parameters<typeof runSynthesisPreparationAttempt>[0], "token"> & {
  target: string; directory: string;
}) {
  const target = providerApiWorkerTarget(args.target), requestId = id.parse(args.requestId);
  args.signal.throwIfAborted();
  const lock = await acquireConnectorLock(args.directory);
  const signal = AbortSignal.any([args.signal, lock.signal]);
  const save = async (value: Journal) => {
    signal.throwIfAborted();
    await writeConnectorJournal(args.directory, value);
    signal.throwIfAborted();
  };
  try {
    signal.throwIfAborted();
    let pending: Journal | null = null;
    try { pending = checkedJournal(await readPrivateJson(join(args.directory, "pending.json"), 32_768), target, requestId); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    signal.throwIfAborted();
    if (!pending) {
      pending = { version: 1, target, requestId, token: randomUUID(), phase: "claim" };
      await save(pending);
    }
    const base = { version: 1 as const, target, requestId, token: pending.token };
    if (pending.phase === "not_active") return { state: "not_active" as const, requestId, token: pending.token };
    if (pending.phase === "acknowledged") {
      return { state: "acknowledged" as const, requestId, token: pending.token, outcome: pending.outcome };
    }
    let retained: OutcomeJournal;
    if (pending.phase === "outcome") {
      retained = pending;
      await finishSynthesisPreparation(args.service, retained.lease, retained.outcome, signal);
    } else {
      let savedOutcome: OutcomeJournal | undefined;
      const result = await runSynthesisPreparationAttempt({ service: args.service, requestId, token: pending.token, signal,
        prepare: async (lease, workSignal) => {
          const outcome = verifySynthesisPreparationOutcome(await args.prepare(structuredClone(lease), workSignal));
          workSignal.throwIfAborted();
          savedOutcome = { ...base, phase: "outcome", lease, outcome };
          await save(savedOutcome);
          workSignal.throwIfAborted();
          return outcome;
        },
      });
      if (result.state === "not_active") {
        await save({ ...base, phase: "not_active" });
        return { state: "not_active" as const, requestId, token: pending.token };
      }
      if (!savedOutcome) throw new Error("Preparation journal outcome missing");
      retained = savedOutcome;
    }
    await save({ ...retained, phase: "acknowledged" });
    return { state: "acknowledged" as const, requestId, token: retained.token, outcome: retained.outcome };
  } finally { await lock.release(); }
}
