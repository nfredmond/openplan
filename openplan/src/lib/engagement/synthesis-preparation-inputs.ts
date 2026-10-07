import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisGenerationRequest } from "./synthesis-generation-requests-server";
import { verifySynthesisContextRequest } from "./synthesis-context-requests-server";
import { verifySynthesisThematicRequest } from "./synthesis-thematic-requests-server";
import { verifySynthesisSource } from "./synthesis-sources-server";
import { renewSynthesisPreparation, verifySynthesisPreparationClaim, type SynthesisPreparationLease } from "./synthesis-preparation-worker";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.iso.datetime({ offset: true });
const requestRow = z.object({ id, campaign_id: id, workspace_id: id, actor_id: id, source_id: id,
  intent_text: z.string().max(4096), intent_sha256: hash, created_at: date }).strict();
const contextRow = z.object({ request_id: id, parent_request_id: id, context_text: z.string().max(4096), context_sha256: hash, created_at: date }).strict();
const thematicRow = z.object({ request_id: id, parent_request_id: id, thematic_text: z.string().max(4096), thematic_sha256: hash, created_at: date }).strict();
const sourceRow = z.object({ id, campaign_id: id, workspace_id: id, snapshot_text: z.string(), snapshot_sha256: hash, created_at: date }).strict();
const columns = {
  request: "id,campaign_id,workspace_id,actor_id,source_id,intent_text,intent_sha256,created_at",
  context: "request_id,parent_request_id,context_text,context_sha256,created_at",
  thematic: "request_id,parent_request_id,thematic_text,thematic_sha256,created_at",
  source: "id,campaign_id,workspace_id,snapshot_text,snapshot_sha256,created_at",
};
type Service = Pick<SupabaseClient, "from" | "rpc">;
function differs(): never { throw new Error("Preparation inputs differ from the retained lease or request"); }

/** The current native lease authorizes these internal immutable reads. Recheck it
 * after reading, including original requester access and cancellation. Service
 * credentials alone are not a staff identity or provider execution permission.
 */
export async function loadSynthesisPreparationInputs(service: Service, rawLease: SynthesisPreparationLease, signal: AbortSignal) {
  const lease = verifySynthesisPreparationClaim(rawLease, rawLease.requestId, rawLease.leaseToken);
  if (!lease) differs();
  await renewSynthesisPreparation(service, lease, signal);
  const scope = { requestId: lease.requestId, campaignId: lease.campaignId, workspaceId: lease.workspaceId };
  async function row(table: string, projection: string, key: string, value: string) {
    signal.throwIfAborted();
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    const response = await service.from(table).select(projection).eq(key, value).abortSignal(bounded).maybeSingle();
    bounded.throwIfAborted();
    if (response.error) throw new Error("Preparation input read unavailable");
    return response.data;
  }
  async function request(requestId: string) {
    const raw = requestRow.parse(await row("engagement_synthesis_generation_requests", columns.request, "id", requestId));
    const state = { schemaVersion: 1 as const, campaignId: raw.campaign_id, workspaceId: raw.workspace_id,
      request: { id: raw.id, actorId: raw.actor_id, intentText: raw.intent_text, intentSha256: raw.intent_sha256, createdAt: raw.created_at }, cancellation: null };
    const checked = verifySynthesisGenerationRequest(state, { ...scope, requestId });
    if (!checked.intent || checked.intent.sourceId !== raw.source_id) differs();
    return { state, intent: checked.intent };
  }
  const current = await request(scope.requestId);
  if (current.state.request.actorId !== lease.actorId || current.state.request.intentSha256 !== lease.intentSha256) differs();
  const rawContext = await row("engagement_synthesis_context_requests", columns.context, "request_id", scope.requestId);
  const rawThematic = await row("engagement_synthesis_thematic_requests", columns.thematic, "request_id", scope.requestId);
  if ((lease.stage === "segment" && (rawContext !== null || rawThematic !== null)) ||
    (lease.stage === "context" && (rawContext === null || rawThematic !== null)) ||
    (lease.stage === "thematic" && (rawThematic === null || rawContext !== null))) differs();
  const sourceScope = { ...scope, requestId: current.intent.sourceId };
  const rawSource = sourceRow.parse(await row("engagement_synthesis_sources", columns.source, "id", sourceScope.requestId));
  if (rawSource.id !== sourceScope.requestId || rawSource.campaign_id !== scope.campaignId || rawSource.workspace_id !== scope.workspaceId ||
    rawSource.snapshot_sha256 !== current.intent.sourceSha256) differs();
  const saved = { ...sourceScope, snapshotText: rawSource.snapshot_text, snapshotSha256: rawSource.snapshot_sha256, createdAt: rawSource.created_at };
  const source = verifySynthesisSource(saved, sourceScope);
  const common = { scope, sourceScope, saved, source, request: current.state.request, intent: current.intent };
  if (lease.stage === "segment") {
    await renewSynthesisPreparation(service, lease, signal);
    return { ...common, stage: "segment" as const };
  }
  if (lease.stage === "context") {
    const raw = contextRow.parse(rawContext); if (raw.request_id !== scope.requestId) differs();
    const context = verifySynthesisContextRequest({ ...current.state, context: { parentRequestId: raw.parent_request_id,
      contextText: raw.context_text, contextSha256: raw.context_sha256, createdAt: raw.created_at } }, scope);
    const parent = await request(context.binding.parentRequestId);
    if (parent.intent.sourceId !== current.intent.sourceId || parent.intent.sourceSha256 !== current.intent.sourceSha256) differs();
    // The existing child-scoped selection reader independently refuses a nonsegment parent.
    await renewSynthesisPreparation(service, lease, signal);
    return { ...common, stage: "context" as const, context, parent };
  }
  const raw = thematicRow.parse(rawThematic); if (raw.request_id !== scope.requestId) differs();
  const thematic = verifySynthesisThematicRequest({ ...current.state, thematic: { parentRequestId: raw.parent_request_id,
    thematicText: raw.thematic_text, thematicSha256: raw.thematic_sha256, createdAt: raw.created_at } }, scope);
  await renewSynthesisPreparation(service, lease, signal);
  return { ...common, stage: "thematic" as const, thematic };
}
