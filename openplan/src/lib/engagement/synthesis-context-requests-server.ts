import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadSynthesisGenerationHistory } from "./synthesis-generation-selected-results-server";
import { synthesisGenerationRequestIntentSchema } from "./synthesis-generation-plan";
import { createSynthesisGenerationInput } from "./synthesis-generation-input";
import { createSynthesisGenerationRecords } from "./synthesis-generation-records";
import { createSynthesisGenerationContext } from "./synthesis-generation-context";
import { createSynthesisGenerationContextContent } from "./synthesis-generation-context-content";
import { verifySynthesisSource } from "./synthesis-sources-server";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true }), sequence = z.number().int().nonnegative().safe();
const frameLimit = z.number().int().min(4096).max(1_048_576);
const target = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const contextBindingSchema = z.object({ schemaVersion: z.literal(1), parentRequestId: id, selectionSequence: sequence,
  segmentResultsManifestSha256: hash, contextManifestSha256: hash, contentManifestSha256: hash,
  targetRecordId: target, frameByteLimit: frameLimit }).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id,
  request: z.object({ id, actorId: id, intentText: z.string().max(4096), intentSha256: hash, createdAt: date }).strict(),
  context: z.object({ parentRequestId: id, contextText: z.string().max(4096), contextSha256: hash, createdAt: date }).strict(),
  cancellation: z.unknown(), replayed: z.boolean().optional(),
}).strict();
type Client = Pick<SupabaseClient, "rpc">;
type Service = Pick<SupabaseClient, "rpc" | "from">;

/** Inspect retained request bytes. This proves neither context reconstruction nor
 * execution permission. Current staff access belongs to the native RPC.
 */
export function verifySynthesisContextRequest(raw: unknown, rawScope: z.infer<typeof scopeSchema>) {
  const scope = scopeSchema.parse(rawScope), state = stateSchema.parse(raw);
  if (state.campaignId !== scope.campaignId || state.workspaceId !== scope.workspaceId || state.request.id !== scope.requestId ||
    digest(state.request.intentText) !== state.request.intentSha256 || digest(state.context.contextText) !== state.context.contextSha256) {
    throw new Error("Retained context request identity differs");
  }
  const intent = synthesisGenerationRequestIntentSchema.parse(JSON.parse(state.request.intentText));
  const binding = contextBindingSchema.parse(JSON.parse(state.context.contextText));
  if (binding.parentRequestId !== state.context.parentRequestId || binding.parentRequestId === scope.requestId) {
    throw new Error("Retained context request parent differs");
  }
  return { state, intent, binding };
}

export async function readSynthesisContextRequest(client: Client, rawScope: z.infer<typeof scopeSchema>, signal: AbortSignal) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope);
  const response = await client.rpc("read_engagement_synthesis_context_request", { p_campaign: scope.campaignId, p_request: scope.requestId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  if (response.error) throw new Error("Context request unavailable; retry the authenticated read");
  signal.throwIfAborted(); return verifySynthesisContextRequest(response.data, scope);
}

const createSchema = scopeSchema.extend({ actorId: id, parentRequestId: id, throughSequence: sequence,
  targetRecordId: target, frameByteLimit: frameLimit, intentText: z.string().max(4096) }).strict();

/** Construct the requested identity from authorized historical source and native
 * outputs. The write uses the current staff client, which rechecks access in its
 * transaction. ActorId must come from the route's authenticated principal.
 * This retains intent only. A future versioned executor must independently verify
 * these inputs and obtain explicit plan/resource authorization before dispatch.
 */
export async function createSynthesisContextRequest(client: Client, service: Service,
  raw: z.infer<typeof createSchema>, signal: AbortSignal,
) {
  signal.throwIfAborted(); const args = createSchema.parse(raw);
  if (args.parentRequestId === args.requestId) throw new Error("Context request cannot be its own parent");
  const intent = synthesisGenerationRequestIntentSchema.parse(JSON.parse(args.intentText));
  const history = await loadSynthesisGenerationHistory(client, service, { campaignId: args.campaignId, workspaceId: args.workspaceId,
    requestId: args.parentRequestId, throughSequence: args.throughSequence }, signal);
  signal.throwIfAborted();
  if (history.campaignId !== args.campaignId || history.workspaceId !== args.workspaceId ||
    history.selections.requestId !== args.parentRequestId || history.inventory.job.jobId !== args.parentRequestId ||
    history.selections.throughSequence !== args.throughSequence) throw new Error("Context request history identity differs");
  if (history.inventory.status !== "ready_for_record_consolidation" ||
    !history.inventory.contributionIds.includes(args.targetRecordId)) {
    throw new Error("Context request requires complete retained results and a selected contribution");
  }
  const sourceScope = { requestId: history.inventory.source.requestId, campaignId: args.campaignId, workspaceId: args.workspaceId };
  // Read the original snapshot through the authenticated RPC, not a current
  // campaign query or an unscoped private table. Reconstruct it again below.
  const sourceResponse = await client.rpc("read_engagement_synthesis_sources", { p_campaign: args.campaignId, p_request: sourceScope.requestId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  if (sourceResponse.error) throw new Error("Context request source unavailable");
  signal.throwIfAborted();
  const source = verifySynthesisSource(sourceResponse.data, sourceScope);
  const saved = { ...sourceScope, snapshotText: source.snapshotText, snapshotSha256: source.snapshotSha256, createdAt: source.createdAt };
  if (intent.sourceId !== saved.requestId || intent.sourceSha256 !== saved.snapshotSha256) throw new Error("Context request source differs from its parent");
  const input = createSynthesisGenerationInput(saved, sourceScope), records = createSynthesisGenerationRecords(input, saved, sourceScope);
  const plan = history.selections.plan.taskPlan;
  const reconstruction = { job: history.inventory.job, selections: history.selections.selections, results: history.inventory.results,
    saved, input, records, plan, scope: sourceScope, taskByteLimit: plan.taskByteLimit };
  const context = createSynthesisGenerationContext(history.inventory, reconstruction, args.throughSequence);
  const content = createSynthesisGenerationContextContent(context, history.inventory, reconstruction, args.throughSequence, args.targetRecordId, args.frameByteLimit);
  const binding = contextBindingSchema.parse({ schemaVersion: 1, parentRequestId: args.parentRequestId, selectionSequence: args.throughSequence,
    segmentResultsManifestSha256: history.inventory.manifestSha256, contextManifestSha256: context.manifestSha256,
    contentManifestSha256: content.manifestSha256, targetRecordId: args.targetRecordId, frameByteLimit: args.frameByteLimit });
  const contextText = JSON.stringify(binding);
  signal.throwIfAborted();
  const response = await client.rpc("create_engagement_synthesis_context_request", { p_campaign: args.campaignId, p_request: args.requestId,
    p_intent_text: args.intentText, p_context_text: contextText }).abortSignal(synthesisWorkerRequestSignal(signal));
  if (response.error) throw new Error("Context request save unconfirmed; retain the same identity and retry");
  signal.throwIfAborted();
  const retained = verifySynthesisContextRequest(response.data, { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId });
  if (retained.state.request.actorId !== args.actorId || retained.state.request.intentText !== args.intentText ||
    retained.state.context.contextText !== contextText || retained.state.replayed === undefined) {
    throw new Error("Saved context request differs from its proposed bytes");
  }
  return retained;
}
