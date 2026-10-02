import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSynthesisContextRequest } from "./synthesis-context-requests-server";
import { loadSynthesisGenerationHistory } from "./synthesis-generation-selected-results-server";
import { verifySynthesisSource } from "./synthesis-sources-server";
import { createSynthesisGenerationInput } from "./synthesis-generation-input";
import { createSynthesisGenerationRecords } from "./synthesis-generation-records";
import { createSynthesisGenerationContext } from "./synthesis-generation-context";
import type { createSynthesisGenerationContextContent } from "./synthesis-generation-context-content";
import { createSynthesisContextStagingPlan, verifySynthesisContextPlanState } from "./synthesis-context-plan";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const date = z.string().datetime({ offset: true });
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const planSchema = z.object({ request_id: id, header_text: z.string(), header_sha256: hash }).strict();
const sealSchema = z.object({ request_id: id, receipt_text: z.string(), receipt_sha256: hash }).strict();
const frameSchema = z.object({ request_id: id, frame_index: natural, frame_text: z.string(), frame_sha256: hash, frame_bytes: natural }).strict();
const taskSchema = z.object({ request_id: id, task_index: natural, task_text: z.string(), task_sha256: hash, task_bytes: natural,
  cumulative_bytes: natural, chain_sha256: hash }).strict();
const referenceSchema = z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_context_frame_reference"),
  frameIndex: natural, frameSha256: hash, frameBytes: natural, contextManifestSha256: hash, targetRecordId: z.string() }).strict();
const columns = {
  plan: "request_id,header_text,header_sha256", seal: "request_id,receipt_text,receipt_sha256",
  frame: "request_id,frame_index,frame_text,frame_sha256,frame_bytes",
  task: "request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256",
} as const;
type Client = Pick<SupabaseClient, "rpc">;
type Service = Pick<SupabaseClient, "from" | "rpc">;
type Scope = z.infer<typeof scopeSchema>;
type Request = Awaited<ReturnType<typeof readSynthesisContextRequest>>;
const differs = (): never => { throw new Error("Historical context inputs differ from retained originals"); };

function cancellation(request: Request, scope: Scope) {
  if (request.state.cancellation === null) return null;
  const row = z.object({ id, receiptText: z.string(), receiptSha256: hash, createdAt: date }).strict().parse(request.state.cancellation);
  if (digest(row.receiptText) !== row.receiptSha256) differs();
  z.object({ schemaVersion: z.literal(1), id: z.literal(row.id), requestId: z.literal(scope.requestId),
    campaignId: z.literal(scope.campaignId), workspaceId: z.literal(scope.workspaceId), actorId: z.literal(request.state.request.actorId),
    reason: z.string().min(1).refine(text => Array.from(text).length <= 4000 && text.trim().length > 0), requestExisted: z.literal(true), cancelledAt: date,
  }).strict().parse(JSON.parse(row.receiptText));
  return row;
}

/** Recheck the reader's current staff access after private reads. Cancellation
 * may arrive during inspection; immutable request and context bytes may not change.
 * The returned cancellation is custody, never permission for fresh execution.
 */
export async function recheckSynthesisContextHistoryAccess(client: Client, previous: Request, scope: Scope, signal: AbortSignal) {
  const current = await readSynthesisContextRequest(client, scope, signal);
  return verifySynthesisContextHistoryRecheck(previous, current, scope);
}

/** Compare immutable history after a caller re-establishes its own access. */
export function verifySynthesisContextHistoryRecheck(previous: Request, current: Request, scope: Scope) {
  if (!isDeepStrictEqual(previous.state.request, current.state.request) ||
    !isDeepStrictEqual(previous.state.context, current.state.context)) differs();
  const originalCancellation = cancellation(previous, scope), currentCancellation = cancellation(current, scope);
  if (originalCancellation && !isDeepStrictEqual(originalCancellation, currentCancellation)) differs();
  return { ...current, cancellation: currentCancellation };
}

/** Reconstruct historical context under the current staff member's own access.
 * Read immutable storage directly only after authenticated request/source reads.
 * No current execution RPC or provider credential is needed. A retained header
 * alone cannot authenticate frames, and an unsealed prefix remains preparation.
 */
export async function loadSynthesisContextHistoryInputs(client: Client, service: Service, rawScope: Scope, signal: AbortSignal) {
  signal.throwIfAborted();
  const scope = scopeSchema.parse(rawScope), request = await readSynthesisContextRequest(client, scope, signal);
  cancellation(request, scope);
  const { intent, binding } = request;
  const parent = await loadSynthesisGenerationHistory(client, service, { campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    requestId: binding.parentRequestId, throughSequence: binding.selectionSequence }, signal);
  if (parent.campaignId !== scope.campaignId || parent.workspaceId !== scope.workspaceId ||
    parent.selections.requestId !== binding.parentRequestId || parent.inventory.job.jobId !== binding.parentRequestId ||
    parent.selections.throughSequence !== binding.selectionSequence) differs();
  const response = await client.rpc("read_engagement_synthesis_sources", { p_campaign: scope.campaignId, p_request: intent.sourceId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Historical context source unavailable");
  const inputs = await reconstructSynthesisContextHistoryInputs(service, scope, request, parent, response.data, signal);
  const current = await recheckSynthesisContextHistoryAccess(client, request, scope, signal);
  return { ...inputs, request: current };
}

/** Internal replay shared by staff inspection and explicitly authorized thematic
 * preparation. This helper grants no access. Its caller must establish native
 * scope before private reads and recheck that authority before returning data.
 */
export async function reconstructSynthesisContextHistoryInputs(service: Service, scope: Scope, request: Request,
  parent: Awaited<ReturnType<typeof loadSynthesisGenerationHistory>>, rawSource: unknown, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const { intent, binding } = request;
  const sourceScope = { requestId: intent.sourceId, campaignId: scope.campaignId, workspaceId: scope.workspaceId };
  const source = verifySynthesisSource(rawSource, sourceScope);
  const saved = { ...sourceScope, snapshotText: source.snapshotText, snapshotSha256: source.snapshotSha256, createdAt: source.createdAt };
  const input = createSynthesisGenerationInput(saved, sourceScope), records = createSynthesisGenerationRecords(input, saved, sourceScope);
  const parentPlan = parent.selections.plan.taskPlan;
  const reconstruction = { job: parent.inventory.job, selections: parent.selections.selections, results: parent.inventory.results,
    input, records, saved, scope: sourceScope, plan: parentPlan, taskByteLimit: parentPlan.taskByteLimit };
  const dependencies = createSynthesisGenerationContext(parent.inventory, reconstruction, binding.selectionSequence);
  const contentArgs: Parameters<typeof createSynthesisGenerationContextContent> = [dependencies, parent.inventory, reconstruction,
    binding.selectionSequence, binding.targetRecordId, binding.frameByteLimit];
  const plan = createSynthesisContextStagingPlan(request.state, scope, contentArgs);
  async function row(table: string, projection: string, filters: Record<string, string | number>) {
    signal.throwIfAborted();
    let query = service.from(table).select(projection);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const result = await query.abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle();
    signal.throwIfAborted();
    if (result.error) throw new Error("Historical context storage unavailable");
    return result.data;
  }
  // Read the seal before its header and frames. A seal observed here must
  // already have every immutable dependency, even if staging is still active.
  const rawSeal = await row("engagement_synthesis_generation_plan_seals", columns.seal, { request_id: scope.requestId });
  const stored = await row("engagement_synthesis_generation_plans", columns.plan, { request_id: scope.requestId });
  const seal = rawSeal === null ? null : sealSchema.parse(rawSeal);
  if (seal && seal.request_id !== scope.requestId) differs();
  let storedFrameCount = 0;
  if (stored === null) {
    if (seal) differs();
  } else {
    const header = planSchema.parse(stored);
    if (header.request_id !== scope.requestId || header.header_text !== plan.headerText || header.header_sha256 !== plan.headerSha256) differs();
    let gap = false;
    for (const expected of plan.entries) {
      const rawFrame = await row("engagement_synthesis_context_frames", columns.frame, { request_id: scope.requestId, frame_index: expected.index });
      const rawTask = await row("engagement_synthesis_generation_plan_tasks", columns.task, { request_id: scope.requestId, task_index: expected.index });
      if (rawFrame === null && rawTask === null) { gap = true; continue; }
      if (gap || rawFrame === null || rawTask === null) {
        if (seal) differs();
        throw new Error("Historical context preparation changed during inspection; retry the read");
      }
      const frame = frameSchema.parse(rawFrame), task = taskSchema.parse(rawTask), reference = referenceSchema.parse(JSON.parse(task.task_text));
      if (frame.request_id !== scope.requestId || frame.frame_index !== expected.index || frame.frame_text !== expected.canonical ||
        frame.frame_sha256 !== expected.sha256 || frame.frame_bytes !== expected.utf8Bytes ||
        task.request_id !== scope.requestId || task.task_index !== expected.index || digest(task.task_text) !== task.task_sha256 ||
        Buffer.byteLength(task.task_text, "utf8") !== task.task_bytes || task.cumulative_bytes !== expected.cumulativeBytes || task.chain_sha256 !== expected.chainSha256 ||
        reference.frameIndex !== expected.index || reference.frameSha256 !== expected.sha256 || reference.frameBytes !== expected.utf8Bytes ||
        reference.contextManifestSha256 !== plan.header.contextManifestSha256 || reference.targetRecordId !== plan.header.targetRecordId) differs();
      storedFrameCount++;
    }
    const last = plan.entries[storedFrameCount - 1];
    verifySynthesisContextPlanState(plan, { schemaVersion: 1, requestId: scope.requestId, headerText: header.header_text,
      headerSha256: header.header_sha256, nextIndex: storedFrameCount, frameBytes: last?.cumulativeBytes ?? 0,
      tailSha256: last?.chainSha256 ?? plan.seedSha256, cancelled: request.state.cancellation !== null,
      seal: seal && { receiptText: seal.receipt_text, receiptSha256: seal.receipt_sha256 } });
  }
  return { scope, request: { ...request, cancellation: cancellation(request, scope) }, plan, contentArgs, storedFrameCount,
    preparationStatus: stored === null ? "not_prepared" as const : seal === null ? "staging" as const : "sealed" as const };
}
