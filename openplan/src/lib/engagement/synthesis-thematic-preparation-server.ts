import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisThematicRequest } from "./synthesis-thematic-requests-server";
import { verifySynthesisThematicChoice } from "./synthesis-thematic-choices-server";
import { verifySynthesisContextRequest } from "./synthesis-context-requests-server";
import { verifySynthesisSource } from "./synthesis-sources-server";
import { synthesisGenerationRequestIntentSchema } from "./synthesis-generation-plan";
import { readSynthesisThematicParentResults } from "./synthesis-generation-selected-results-server";
import { reconstructSynthesisContextHistoryInputs, verifySynthesisContextHistoryRecheck } from "./synthesis-context-history-inputs";
import { replaySynthesisContextHistory } from "./synthesis-context-history-server";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.string().datetime({ offset: true });
const target = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id, targetRecordId: target }).strict();
const requestSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id,
  request: z.object({ id, actorId: id, intentText: z.string().max(4096), intentSha256: hash, createdAt: date }).strict(), cancellation: z.unknown() }).strict();
const sourceSchema = z.object({ requestId: id, campaignId: id, workspaceId: id, snapshotSha256: hash, createdAt: date }).strict();
const bundleSchema = z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_thematic_preparation"),
  thematic: z.unknown(), parent: requestSchema, context: z.unknown(), choice: z.unknown(), source: sourceSchema }).strict();
const sourceRowSchema = z.object({ id, campaign_id: id, workspace_id: id, snapshot_text: z.string(), snapshot_sha256: hash, created_at: date }).strict();
const sourceColumns = "id,campaign_id,workspace_id,snapshot_text,snapshot_sha256,created_at";
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const differs = (): never => { throw new Error("Thematic preparation differs from retained inputs"); };
type Service = Pick<SupabaseClient, "rpc" | "from">;
type Scope = z.infer<typeof scopeSchema>;

/** Verify a native delegation receipt. It is not a staff impersonation token,
 * input seal or resource grant. The reader rechecks authority after private replay.
 */
export function verifySynthesisThematicPreparation(raw: unknown, rawScope: Scope) {
  const scope = scopeSchema.parse(rawScope), bundle = bundleSchema.parse(raw);
  const requestScope = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: scope.requestId };
  const thematic = verifySynthesisThematicRequest(bundle.thematic, requestScope);
  const choice = verifySynthesisThematicChoice(bundle.choice, requestScope, scope.targetRecordId);
  const contextScope = { ...requestScope, requestId: choice.choice.contextRequestId };
  const context = verifySynthesisContextRequest(bundle.context, contextScope);
  const { parent, source } = bundle, parentIntent = synthesisGenerationRequestIntentSchema.parse(JSON.parse(parent.request.intentText));
  if (thematic.state.cancellation !== null || choice.record.createdBy !== thematic.state.request.actorId
    || parent.campaignId !== scope.campaignId || parent.workspaceId !== scope.workspaceId || parent.request.id !== thematic.binding.parentRequestId
    || digest(parent.request.intentText) !== parent.request.intentSha256
    || source.requestId !== thematic.intent.sourceId || source.campaignId !== scope.campaignId || source.workspaceId !== scope.workspaceId
    || source.snapshotSha256 !== thematic.intent.sourceSha256
    || parentIntent.sourceId !== source.requestId || parentIntent.sourceSha256 !== source.snapshotSha256
    || context.intent.sourceId !== source.requestId || context.intent.sourceSha256 !== source.snapshotSha256
    || context.binding.parentRequestId !== parent.request.id || context.binding.selectionSequence !== thematic.binding.selectionSequence
    || context.binding.segmentResultsManifestSha256 !== thematic.binding.segmentResultsManifestSha256
    || context.binding.contextManifestSha256 !== thematic.binding.contextManifestSha256 || context.binding.targetRecordId !== scope.targetRecordId) differs();
  return { scope, thematic, choice, context, parent, source };
}

async function readDelegation(service: Service, scope: Scope, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await service.rpc("read_engagement_synthesis_thematic_preparation", { p_request: scope.requestId, p_target: scope.targetRecordId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Thematic preparation access unavailable");
  return verifySynthesisThematicPreparation(response.data, scope);
}

type Delegation = ReturnType<typeof verifySynthesisThematicPreparation>;
const requestScopeSchema = scopeSchema.omit({ targetRecordId: true });

// These originals are immutable and pinned to a fixed parent selection sequence.
// Historical cancellations may arrive later; current authority is never cached.
function sharedIdentity(delegation: Delegation) {
  return { thematicRequest: delegation.thematic.state.request, thematicBinding: delegation.thematic.state.thematic,
    parentRequest: delegation.parent.request, source: delegation.source };
}

async function reconstructSharedInputs(service: Service, scope: Scope, delegation: Delegation, signal: AbortSignal) {
  const { thematic, parent } = delegation;
  const sourceResponse = await service.from("engagement_synthesis_sources").select(sourceColumns).eq("id", delegation.source.requestId)
    .abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle();
  signal.throwIfAborted();
  if (sourceResponse.error) throw new Error("Thematic preparation source unavailable");
  const row = sourceRowSchema.parse(sourceResponse.data);
  if (row.id !== delegation.source.requestId || row.campaign_id !== scope.campaignId || row.workspace_id !== scope.workspaceId
    || row.snapshot_sha256 !== delegation.source.snapshotSha256 || Date.parse(row.created_at) !== Date.parse(delegation.source.createdAt)) differs();
  const sourceScope = { requestId: row.id, campaignId: scope.campaignId, workspaceId: scope.workspaceId };
  const saved = { ...delegation.source, snapshotText: row.snapshot_text };
  const source = verifySynthesisSource(saved, sourceScope);
  const parentResults = await readSynthesisThematicParentResults(service, scope.requestId, scope.targetRecordId,
    { request: { id: parent.request.id, intentText: parent.request.intentText, intentSha256: parent.request.intentSha256 },
      saved, scope: sourceScope, actorId: parent.request.actorId, throughSequence: thematic.binding.selectionSequence }, signal);
  const parentHistory = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requesterId: parent.request.actorId, ...parentResults };
  return { source, saved, parentHistory };
}

type SharedInputs = Awaited<ReturnType<typeof reconstructSharedInputs>> & { identity: ReturnType<typeof sharedIdentity> };

async function replayPreparation(service: Service, scope: Scope, signal: AbortSignal, cached: SharedInputs | null) {
  signal.throwIfAborted();
  const delegation = await readDelegation(service, scope, signal), { thematic, choice, context, parent } = delegation;
  const identity = sharedIdentity(delegation);
  if (cached && !isDeepStrictEqual(cached.identity, identity)) differs();
  const { source, saved, parentHistory } = cached ? structuredClone(cached) : await reconstructSharedInputs(service, scope, delegation, signal);
  const contextScope = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: context.state.request.id };
  const inputs = await reconstructSynthesisContextHistoryInputs(service, contextScope, context, parentHistory, saved, signal);
  const history = await replaySynthesisContextHistory(service, { ...contextScope, throughSequence: choice.choice.selectionSequence }, inputs,
    async (_throughSequence, afterTaskIndex) => await service.rpc("read_engagement_synthesis_thematic_preparation_selections",
      { p_request: scope.requestId, p_target: scope.targetRecordId, p_stage: "context", p_after_task_index: afterTaskIndex, p_limit: 128 })
      .abortSignal(synthesisWorkerRequestSignal(signal)),
    async () => {
      const current = await readDelegation(service, scope, signal);
      // Historical cancellations may arrive during replay. Input identities,
      // chosen hashes, original actors and the new request must remain unchanged.
      if (!isDeepStrictEqual(current.thematic, thematic) || !isDeepStrictEqual(current.choice, choice)
        || !isDeepStrictEqual(current.parent.request, parent.request) || !isDeepStrictEqual(current.source, delegation.source)) differs();
      return verifySynthesisContextHistoryRecheck(context, current.context, contextScope);
    }, signal);
  const last = history.entries.at(-1);
  if (history.manifest.status !== "frames_complete" || history.finalOutputText === null || history.sha256 !== choice.choice.historyManifestSha256
    || last?.captureSha256 !== choice.choice.finalCaptureSha256 || last?.resultSha256 !== choice.choice.finalResultSha256) {
    throw new Error("Thematic chosen history is incomplete or differs from its pinned originals");
  }
  return { preparation: { delegation, source, parent: parentHistory, history }, shared: { identity, source, saved, parentHistory } };
}

/** Reuse verified immutable source and anchored parent originals within one
 * request. Each contribution still obtains fresh native scope and replays its
 * own history, including the final authority check. Cache only a complete
 * successful replay, and detach cache values from mutable caller results.
 * Concurrent initial reads may repeat work; they never share pending authority.
 */
export function createSynthesisThematicPreparationReader(service: Service, rawScope: z.infer<typeof requestScopeSchema>) {
  const requestScope = requestScopeSchema.parse(rawScope);
  let cached: SharedInputs | null = null;
  return async (targetRecordId: string, signal: AbortSignal) => {
    signal.throwIfAborted(); const scope = scopeSchema.parse({ ...requestScope, targetRecordId });
    const result = await replayPreparation(service, scope, signal, cached);
    if (cached && !isDeepStrictEqual(cached.identity, result.shared.identity)) differs();
    if (cached === null) cached = structuredClone(result.shared);
    return result.preparation;
  };
}

/** Replay one chosen context under the new requester's explicit native scope.
 * This performs no provider call or write. Durable preparation must retain its
 * proof and seal complete source membership before authorizing thematic tasks.
 */
export async function loadSynthesisThematicPreparation(service: Service, rawScope: Scope, signal: AbortSignal) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope);
  return (await replayPreparation(service, scope, signal, null)).preparation;
}
