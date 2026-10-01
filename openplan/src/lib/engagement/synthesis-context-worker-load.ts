import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisContextRequest } from "./synthesis-context-requests-server";
import { createSynthesisContextStagingPlan, verifySynthesisContextPlanState } from "./synthesis-context-plan";
import { readSynthesisContextParentResults } from "./synthesis-generation-selected-results-server";
import { createSynthesisGenerationInput } from "./synthesis-generation-input";
import { createSynthesisGenerationRecords } from "./synthesis-generation-records";
import { createSynthesisGenerationContext } from "./synthesis-generation-context";
import type { createSynthesisGenerationContextContent } from "./synthesis-generation-context-content";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const natural = z.number().int().nonnegative().safe(), date = z.string().datetime({ offset: true });
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const requestSchema = z.object({ id, campaign_id: id, workspace_id: id, actor_id: id, source_id: id,
  configuration_revision_id: id, intent_text: z.string().max(4096), intent_sha256: hash, created_at: date }).strict();
const contextSchema = z.object({ request_id: id, parent_request_id: id, context_text: z.string().max(4096),
  context_sha256: hash, created_at: date }).strict();
const sourceSchema = z.object({ id, campaign_id: id, workspace_id: id, snapshot_text: z.string(), snapshot_sha256: hash, created_at: date }).strict();
const frameSchema = z.object({ request_id: id, frame_index: natural, frame_text: z.string(), frame_sha256: hash, frame_bytes: natural }).strict();
const taskSchema = z.object({ request_id: id, task_index: natural, task_text: z.string(), task_sha256: hash, task_bytes: natural,
  cumulative_bytes: natural, chain_sha256: hash }).strict();
const referenceSchema = z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_context_frame_reference"),
  frameIndex: natural, frameSha256: hash, frameBytes: natural, contextManifestSha256: hash,
  targetRecordId: z.string() }).strict();
const columns = {
  request: "id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text,intent_sha256,created_at",
  context: "request_id,parent_request_id,context_text,context_sha256,created_at",
  source: "id,campaign_id,workspace_id,snapshot_text,snapshot_sha256,created_at",
  frame: "request_id,frame_index,frame_text,frame_sha256,frame_bytes",
  task: "request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256",
} as const;
type Service = Pick<SupabaseClient, "from" | "rpc">;
const differs = (): never => { throw new Error("Context worker retained inputs differ"); };

async function read(service: Service, table: string, projection: string, filters: Record<string, string | number>, signal: AbortSignal) {
  signal.throwIfAborted();
  let query = service.from(table).select(projection);
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const response = await query.abortSignal(synthesisWorkerRequestSignal(signal)).single();
  signal.throwIfAborted();
  if (response.error) throw new Error("Context worker retained inputs unavailable");
  return response.data;
}

/** Rebuild the complete context from native source and original parent captures.
 * Current child authority gates the snapshot read. Stored frame hashes alone do
 * not authenticate content: compare every original and reference to reconstruction.
 * This read grants no claim or dispatch permission. Native execution must recheck
 * current authority and selected predecessors after reconstruction finishes.
 */
export async function loadSynthesisContextWorkerInputs(service: Service, rawRequestId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const requestId = id.parse(rawRequestId);
  const row = requestSchema.parse(await read(service, "engagement_synthesis_generation_requests", columns.request, { id: requestId }, signal));
  if (row.id !== requestId) differs();
  const context = contextSchema.parse(await read(service, "engagement_synthesis_context_requests", columns.context, { request_id: requestId }, signal));
  if (context.request_id !== requestId) differs();
  const scope = { requestId, campaignId: row.campaign_id, workspaceId: row.workspace_id };
  const request = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: { id: row.id, actorId: row.actor_id, intentText: row.intent_text, intentSha256: row.intent_sha256, createdAt: row.created_at },
    context: { parentRequestId: context.parent_request_id, contextText: context.context_text, contextSha256: context.context_sha256, createdAt: context.created_at },
    cancellation: null };
  const verified = verifySynthesisContextRequest(request, scope);
  if (verified.intent.sourceId !== row.source_id || verified.intent.configurationRevisionId !== row.configuration_revision_id) differs();
  const response = await service.rpc("read_engagement_synthesis_context_plan", { p_request: requestId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Context worker current scope unavailable");
  const parent = requestSchema.parse(await read(service, "engagement_synthesis_generation_requests", columns.request,
    { id: context.parent_request_id }, signal));
  if (parent.id !== context.parent_request_id || parent.campaign_id !== row.campaign_id ||
    parent.workspace_id !== row.workspace_id || parent.source_id !== row.source_id) differs();
  const source = sourceSchema.parse(await read(service, "engagement_synthesis_sources", columns.source,
    { id: row.source_id, campaign_id: row.campaign_id, workspace_id: row.workspace_id }, signal));
  const sourceScope = { requestId: row.source_id, campaignId: row.campaign_id, workspaceId: row.workspace_id };
  const saved = { requestId: source.id, campaignId: source.campaign_id, workspaceId: source.workspace_id,
    snapshotText: source.snapshot_text, snapshotSha256: source.snapshot_sha256, createdAt: source.created_at };
  const parentResult = await readSynthesisContextParentResults(service, requestId, {
    request: { id: parent.id, intentText: parent.intent_text, intentSha256: parent.intent_sha256 },
    actorId: parent.actor_id, saved, scope: sourceScope, throughSequence: verified.binding.selectionSequence,
  }, signal);
  const input = createSynthesisGenerationInput(saved, sourceScope), records = createSynthesisGenerationRecords(input, saved, sourceScope);
  const parentPlan = parentResult.selections.plan.taskPlan;
  const reconstruction = { job: parentResult.inventory.job, selections: parentResult.selections.selections, results: parentResult.inventory.results,
    input, records, saved, scope: sourceScope, plan: parentPlan, taskByteLimit: parentPlan.taskByteLimit };
  const dependencies = createSynthesisGenerationContext(parentResult.inventory, reconstruction, verified.binding.selectionSequence);
  const contentArgs: Parameters<typeof createSynthesisGenerationContextContent> = [dependencies, parentResult.inventory, reconstruction,
    verified.binding.selectionSequence, verified.binding.targetRecordId, verified.binding.frameByteLimit];
  const plan = createSynthesisContextStagingPlan(request, scope, contentArgs);
  const state = verifySynthesisContextPlanState(plan, response.data);
  if (!state.seal || state.cancelled) throw new Error("Context worker requires an active sealed plan");
  for (const expected of plan.entries) {
    const frame = frameSchema.parse(await read(service, "engagement_synthesis_context_frames", columns.frame,
      { request_id: requestId, frame_index: expected.index }, signal));
    if (frame.request_id !== requestId || frame.frame_index !== expected.index || frame.frame_text !== expected.canonical ||
      frame.frame_sha256 !== expected.sha256 || frame.frame_bytes !== expected.utf8Bytes) differs();
    const task = taskSchema.parse(await read(service, "engagement_synthesis_generation_plan_tasks", columns.task,
      { request_id: requestId, task_index: expected.index }, signal));
    const reference = referenceSchema.parse(JSON.parse(task.task_text));
    if (task.request_id !== requestId || task.task_index !== expected.index || digest(task.task_text) !== task.task_sha256 ||
      Buffer.byteLength(task.task_text, "utf8") !== task.task_bytes || task.cumulative_bytes !== expected.cumulativeBytes || task.chain_sha256 !== expected.chainSha256 ||
      reference.frameIndex !== expected.index || reference.frameSha256 !== expected.sha256 || reference.frameBytes !== expected.utf8Bytes ||
      reference.contextManifestSha256 !== plan.header.contextManifestSha256 || reference.targetRecordId !== plan.header.targetRecordId) differs();
  }
  signal.throwIfAborted();
  return { request, scope, intent: verified.intent, plan, contentArgs };
}
