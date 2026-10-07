import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisGenerationPlanState, type SynthesisGenerationPlan } from "./synthesis-generation-plan";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const headerSchema = z.object({ request_id: id, header_text: z.string(), header_sha256: hash }).strict();
const sealSchema = z.object({ request_id: id, receipt_text: z.string(), receipt_sha256: hash }).strict();
const taskSchema = z.object({ request_id: id, task_index: natural, task_text: z.string(), task_sha256: hash,
  task_bytes: natural, cumulative_bytes: natural, chain_sha256: hash }).strict();

/** Compare saved segment preparation even when no attempt exists yet. The caller
 * must bracket this private read with current authenticated request access.
 */
export async function readSynthesisProgressPlan(service: Pick<SupabaseClient, "from">, plan: SynthesisGenerationPlan, signal: AbortSignal) {
  const requestId = plan.header.requestId;
  async function row(table: string, columns: string) {
    signal.throwIfAborted();
    const result = await service.from(table).select(columns).eq("request_id", requestId)
      .abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle();
    signal.throwIfAborted();
    if (result.error) throw new Error("Saved analysis plan unavailable");
    return result.data;
  }
  // A seal observed first must already have every immutable task and header.
  const rawSeal = await row("engagement_synthesis_generation_plan_seals", "request_id,receipt_text,receipt_sha256");
  const rawHeader = await row("engagement_synthesis_generation_plans", "request_id,header_text,header_sha256");
  const seal = rawSeal === null ? null : sealSchema.parse(rawSeal);
  if (seal && seal.request_id !== requestId) throw new Error("Saved analysis seal scope differs");
  if (rawHeader === null) {
    if (seal) throw new Error("Saved analysis seal has no header");
    return "not_prepared" as const;
  }
  const header = headerSchema.parse(rawHeader);
  if (header.request_id !== requestId || header.header_text !== plan.headerText || header.header_sha256 !== plan.headerSha256) throw new Error("Saved analysis plan differs");
  let nextIndex = 0;
  for (;;) {
    signal.throwIfAborted();
    const result = await service.from("engagement_synthesis_generation_plan_tasks")
      .select("request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256")
      .eq("request_id", requestId).gt("task_index", nextIndex - 1).order("task_index", { ascending: true }).limit(128)
      .abortSignal(synthesisWorkerRequestSignal(signal));
    signal.throwIfAborted();
    if (result.error) throw new Error("Saved analysis tasks unavailable");
    const rows = z.array(taskSchema).max(128).parse(result.data);
    for (const task of rows) {
      const expected = plan.entries[nextIndex];
      if (!expected || task.request_id !== requestId || task.task_index !== nextIndex || task.task_text !== expected.canonical ||
        task.task_sha256 !== expected.sha256 || task.task_bytes !== expected.utf8Bytes || task.cumulative_bytes !== expected.cumulativeBytes ||
        task.chain_sha256 !== expected.chainSha256) throw new Error("Saved analysis task differs");
      nextIndex++;
    }
    if (rows.length < 128) break;
  }
  const last = plan.entries[nextIndex - 1];
  verifySynthesisGenerationPlanState(plan, { schemaVersion: 1, requestId, headerText: header.header_text, headerSha256: header.header_sha256,
    nextIndex, taskBytes: last?.cumulativeBytes ?? 0, tailSha256: last?.chainSha256 ?? plan.seedSha256, cancelled: false,
    seal: seal ? { receiptText: seal.receipt_text, receiptSha256: seal.receipt_sha256 } : null });
  return seal ? "sealed" as const : "staging" as const;
}
