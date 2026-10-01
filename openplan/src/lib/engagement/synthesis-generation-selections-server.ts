import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSynthesisGenerationPlan } from "./synthesis-generation-plan";
import type { SynthesisSourceScope } from "./synthesis-sources-server";

const id = z.string().uuid();
const natural = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const retainedReceipt = z.object({ receiptText: z.string().max(32768), receiptSha256: hash }).strict();
const pageSchema = z.object({
  schemaVersion: z.literal(1), requestId: id, throughSequence: natural, afterTaskIndex: z.number().int().min(-1).safe(),
  hasMore: z.boolean(), entries: z.array(retainedReceipt).max(128),
}).strict();
const receiptSchema = z.object({
  schemaVersion: z.literal(1), id, requestId: id, taskIndex: natural, attemptId: id.nullable(),
  previousSelectionId: id.nullable(), sequence: natural.positive(), actorId: id, origin: z.enum(["authorization", "staff"]),
  authorizationId: id.nullable(), reason: z.string().min(1).max(4000).refine(text => text.trim().length > 0),
  selectedAt: z.string().datetime({ offset: true }),
}).strict();
type RetainedSelection = z.infer<typeof retainedReceipt> & { receipt: z.infer<typeof receiptSchema> };
const fail = (): never => { throw new Error("Retained synthesis selections differ from their source or cursor"); };

/** Reconstruct the plan and read an anchored native selection inventory. Clearing
 * a choice removes its selected attempt, never its task or source contribution.
 * Receipts remain provenance; selected output content needs separate validation.
 */
type SelectionArgs = {
  request: unknown; saved: unknown; scope: SynthesisSourceScope; actorId: string; throughSequence?: number;
};
async function readSelections(service: Pick<SupabaseClient, "rpc">, args: SelectionArgs, signal?: AbortSignal,
  mode: "current" | "historical" | { contextRequestId: string } = "current",
) {
  signal?.throwIfAborted();
  const actor = id.parse(args.actorId);
  const plan = createSynthesisGenerationPlan(args.request, args.saved, args.scope);
  const entries: RetainedSelection[] = [];
  const seenIds = new Set<string>(), seenSequences = new Set<number>(), seenAttempts = new Set<string>();
  let throughSequence: number | null = args.throughSequence === undefined ? null : natural.parse(args.throughSequence), afterTaskIndex = -1;
  for (;;) {
    signal?.throwIfAborted();
    const contextRequestId = typeof mode === "object" ? id.parse(mode.contextRequestId) : null;
    const command = contextRequestId ? "read_engagement_synthesis_context_parent_selections"
      : mode === "historical" ? "read_engagement_synthesis_generation_selection_history" : "read_engagement_synthesis_generation_selections";
    const parameters = contextRequestId ? { p_request: contextRequestId, p_after_task_index: afterTaskIndex, p_limit: 128 }
      : { ...(mode === "historical" ? { p_campaign: args.scope.campaignId } : {}), p_request: plan.header.requestId,
        p_through_sequence: throughSequence, p_after_task_index: afterTaskIndex, p_limit: 128 };
    const { data, error } = await service.rpc(command, parameters)
      .abortSignal(AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]));
    if (error) throw new Error("Synthesis selection inventory unavailable; reload the retained snapshot");
    const page = pageSchema.parse(data);
    if (page.requestId !== plan.header.requestId || page.afterTaskIndex !== afterTaskIndex ||
      (throughSequence !== null && page.throughSequence !== throughSequence) || (page.hasMore && page.entries.length === 0)) fail();
    throughSequence ??= page.throughSequence;
    for (const raw of page.entries) {
      if (Buffer.byteLength(raw.receiptText, "utf8") > 32768 || createHash("sha256").update(raw.receiptText, "utf8").digest("hex") !== raw.receiptSha256) fail();
      const receipt = receiptSchema.parse(JSON.parse(raw.receiptText));
      if (receipt.requestId !== plan.header.requestId || receipt.actorId !== actor || receipt.taskIndex <= afterTaskIndex ||
        receipt.taskIndex >= plan.entries.length || receipt.sequence > throughSequence || seenIds.has(receipt.id) || seenSequences.has(receipt.sequence) ||
        (receipt.attemptId !== null && seenAttempts.has(receipt.attemptId))) fail();
      if (receipt.origin === "authorization" ? receipt.authorizationId === null || receipt.previousSelectionId !== null || receipt.attemptId === null : receipt.authorizationId !== null) fail();
      seenIds.add(receipt.id); seenSequences.add(receipt.sequence);
      if (receipt.attemptId !== null) seenAttempts.add(receipt.attemptId);
      entries.push({ ...raw, receipt }); afterTaskIndex = receipt.taskIndex;
    }
    if (!page.hasMore) break;
  }
  if (throughSequence > 0 && entries.length === 0) fail();
  const selections = entries.flatMap(({ receipt }) => receipt.attemptId === null ? [] : [{
    taskSha256: plan.entries[receipt.taskIndex].sha256, attemptId: receipt.attemptId,
  }]);
  return { schemaVersion: 1 as const, requestId: plan.header.requestId, throughSequence, entries, selections, plan };
}

export function readSynthesisGenerationSelections(service: Pick<SupabaseClient, "rpc">, args: SelectionArgs, signal?: AbortSignal) {
  return readSelections(service, args, signal);
}

/** Current staff inspect historical choices through their own authenticated
 * client. Receipt actors remain the original authors, not the current reader.
 */
export function readSynthesisGenerationHistoricalSelections(client: Pick<SupabaseClient, "rpc">, args: SelectionArgs, signal?: AbortSignal) {
  return readSelections(client, args, signal, "historical");
}

/** The native child scope fixes parent identity and sequence even after the
 * parent's requester leaves. It does not renew the parent's execution rights.
 */
export function readSynthesisContextParentSelections(service: Pick<SupabaseClient, "rpc">,
  contextRequestId: string, args: SelectionArgs, signal?: AbortSignal,
) {
  return readSelections(service, args, signal, { contextRequestId });
}
