import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisThematicRequest } from "./synthesis-thematic-requests-server";
import { verifySynthesisSource } from "./synthesis-sources-server";
import { createSynthesisThematicInputManifest, verifySynthesisThematicInputMetadata, verifySynthesisThematicInputSeal } from "./synthesis-thematic-input-manifest";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.string().datetime({ offset: true });
const target = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const referenceSchema = z.object({ requestId: id, campaignId: id, workspaceId: id, snapshotSha256: hash, createdAt: date }).strict();
const pageSchema = scopeSchema.extend({ schemaVersion: z.literal(1), thematic: z.unknown(), source: referenceSchema,
  afterTargetRecordId: target.nullable(), hasMore: z.boolean(), entries: z.array(z.unknown()).max(128),
  seal: z.object({ manifestText: z.string().max(8192), manifestSha256: hash, receiptText: z.string().max(8192), receiptSha256: hash }).strict().nullable() }).strict();
const sourceRowSchema = z.object({ id, campaign_id: id, workspace_id: id, snapshot_text: z.string(), snapshot_sha256: hash, created_at: date }).strict();
const sourceColumns = "id,campaign_id,workspace_id,snapshot_text,snapshot_sha256,created_at";
type Service = Pick<SupabaseClient, "rpc" | "from">;
type Scope = z.infer<typeof scopeSchema>;
const differs = (): never => { throw new Error("Thematic input inventory identity differs"); };

/** Read every retained proof through bounded native pages, with current scope
 * rechecked after private source access and pagination. Inputs may still be
 * incomplete. This reader does not turn metadata into original-history replay.
 */
export async function loadSynthesisThematicInputInventory(service: Service, rawScope: Scope, signal: AbortSignal) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope);
  async function page(afterTargetRecordId: string | null, limit: number) {
    signal.throwIfAborted();
    const response = await service.rpc("read_engagement_synthesis_thematic_input_inventory", {
      p_request: scope.requestId, p_after_target: afterTargetRecordId, p_limit: limit,
    }).abortSignal(synthesisWorkerRequestSignal(signal));
    signal.throwIfAborted();
    if (response.error) throw new Error("Thematic input inventory unavailable");
    const value = pageSchema.parse(response.data), request = verifySynthesisThematicRequest(value.thematic, scope);
    if (value.requestId !== scope.requestId || value.campaignId !== scope.campaignId || value.workspaceId !== scope.workspaceId
      || value.afterTargetRecordId !== afterTargetRecordId || value.entries.length > limit || (value.hasMore && !value.entries.length)
      || value.source.requestId !== request.intent.sourceId || value.source.snapshotSha256 !== request.intent.sourceSha256
      || value.source.campaignId !== scope.campaignId || value.source.workspaceId !== scope.workspaceId) differs();
    return { value, request };
  }
  let current = await page(null, 128);
  const first = current;
  const response = await service.from("engagement_synthesis_sources").select(sourceColumns).eq("id", first.value.source.requestId)
    .abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle();
  signal.throwIfAborted();
  if (response.error) throw new Error("Thematic inventory source unavailable");
  const row = sourceRowSchema.parse(response.data), reference = first.value.source;
  if (row.id !== reference.requestId || row.campaign_id !== scope.campaignId || row.workspace_id !== scope.workspaceId
    || row.snapshot_sha256 !== reference.snapshotSha256 || Date.parse(row.created_at) !== Date.parse(reference.createdAt)) differs();
  const source = verifySynthesisSource({ ...reference, snapshotText: row.snapshot_text }, { ...scope, requestId: reference.requestId });
  const entries: ReturnType<typeof verifySynthesisThematicInputMetadata>["metadata"][] = [];
  let cursor: string | null = null;
  function sameOriginals(next: typeof current) {
    if (!isDeepStrictEqual(next.request.state.request, first.request.state.request)
      || !isDeepStrictEqual(next.request.state.thematic, first.request.state.thematic)
      || !isDeepStrictEqual(next.value.source, first.value.source)
      || (current.request.state.cancellation !== null && !isDeepStrictEqual(next.request.state.cancellation, current.request.state.cancellation))
      || (current.value.seal !== null && !isDeepStrictEqual(next.value.seal, current.value.seal))) differs();
  }
  for (;;) {
    signal.throwIfAborted();
    for (const raw of current.value.entries) {
      const { metadata } = verifySynthesisThematicInputMetadata(raw, scope);
      if (cursor !== null && metadata.targetRecordId <= cursor) differs();
      entries.push(metadata); cursor = metadata.targetRecordId;
    }
    if (!current.value.hasMore) break;
    const next = await page(cursor, 128); sameOriginals(next); current = next;
  }
  // A new tail or changed identity requires retry. An insertion behind the
  // cursor still cannot produce a complete manifest: exact membership is checked
  // separately against the original source before sealing.
  const final = await page(cursor, 1); sameOriginals(final);
  if (final.value.entries.length || final.value.hasMore) throw new Error("Thematic input inventory changed while reading; retry");
  return { request: final.request, source, entries, seal: final.value.seal };
}

/** Seal complete-source byte custody. The database independently recomputes
 * actual membership and the exact chain under the request lock. An uncertain
 * acknowledgement is recovered by a later read and exact retry. This prepares
 * no executable task and grants no provider authorization.
 */
export async function retainSynthesisThematicInputSeal(service: Service, rawScope: Scope, signal: AbortSignal) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope);
  const inventory = await loadSynthesisThematicInputInventory(service, scope, signal);
  const { snapshot: _snapshot, definitions: _definitions, ...saved } = inventory.source;
  const plan = createSynthesisThematicInputManifest(inventory.request.state, scope, saved, inventory.entries);
  if (inventory.seal !== null) return { plan, seal: verifySynthesisThematicInputSeal(inventory.seal, plan) };
  if (inventory.request.state.cancellation !== null) throw new Error("Thematic input sealing was cancelled");
  signal.throwIfAborted();
  const response = await service.rpc("seal_engagement_synthesis_thematic_inputs", { p_request: scope.requestId,
    p_manifest_text: plan.manifestText }).abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Thematic input seal save unconfirmed; read custody or retry the same seal");
  return { plan, seal: verifySynthesisThematicInputSeal(response.data, plan) };
}
