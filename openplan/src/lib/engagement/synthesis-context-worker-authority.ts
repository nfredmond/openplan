import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisContextRequest } from "./synthesis-context-requests-server";
import { synthesisContextRecipe } from "./synthesis-context-continuation";
import { synthesisWorkerAuthorizationIntentSchema, synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const date = z.string().datetime({ offset: true });
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const grantSchema = z.object({ id, request_id: id, intent_text: z.string().max(4096), intent_sha256: hash, credential_sha256: hash.nullable() }).strict();
const requestSchema = z.object({ id, campaign_id: id, workspace_id: id, actor_id: id, source_id: id,
  configuration_revision_id: id, intent_text: z.string().max(4096), intent_sha256: hash, created_at: date }).strict();
const contextSchema = z.object({ request_id: id, parent_request_id: id, context_text: z.string().max(4096), context_sha256: hash, created_at: date }).strict();
const planSchema = z.object({ request_id: id, header_text: z.string().max(4096), header_sha256: hash }).strict();
const sealSchema = z.object({ request_id: id, receipt_text: z.string().max(4096), receipt_sha256: hash }).strict();
const countsSchema = z.object({ frameCount: natural.positive(), frameBytes: natural, tailSha256: hash }).passthrough();
const columns = {
  grant: "id,request_id,intent_text,intent_sha256,credential_sha256",
  request: "id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text,intent_sha256,created_at",
  context: "request_id,parent_request_id,context_text,context_sha256,created_at",
  plan: "request_id,header_text,header_sha256", seal: "request_id,receipt_text,receipt_sha256",
} as const;
const differs = (): never => { throw new Error("Context schedule retained authority differs"); };

/** Inspect immutable scheduling identity even after cancellation or expiry.
 * This does not read current scope, reconstruct source frames or authorize a
 * provider call. New schedules must reconstruct current inputs separately, and
 * each fresh worker claim/dispatch must still enforce current native authority.
 */
export async function loadSynthesisContextScheduleAuthority(service: Pick<SupabaseClient, "from">,
  rawAuthorizationId: string, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const authorizationId = id.parse(rawAuthorizationId);
  async function read(table: string, projection: string, key: string, value: string) {
    signal.throwIfAborted();
    const response = await service.from(table).select(projection).eq(key, value)
      .abortSignal(synthesisWorkerRequestSignal(signal)).single();
    signal.throwIfAborted();
    if (response.error) throw new Error("Context schedule retained authority unavailable");
    return response.data;
  }
  const grant = grantSchema.parse(await read("engagement_synthesis_generation_authorizations", columns.grant, "id", authorizationId));
  if (grant.id !== authorizationId || digest(grant.intent_text) !== grant.intent_sha256) differs();
  const row = requestSchema.parse(await read("engagement_synthesis_generation_requests", columns.request, "id", grant.request_id));
  const context = contextSchema.parse(await read("engagement_synthesis_context_requests", columns.context, "request_id", grant.request_id));
  if (row.id !== grant.request_id || context.request_id !== grant.request_id) differs();
  const scope = { requestId: row.id, campaignId: row.campaign_id, workspaceId: row.workspace_id };
  const request = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: { id: row.id, actorId: row.actor_id, intentText: row.intent_text, intentSha256: row.intent_sha256, createdAt: row.created_at },
    context: { parentRequestId: context.parent_request_id, contextText: context.context_text, contextSha256: context.context_sha256, createdAt: context.created_at },
    cancellation: null };
  const { intent, binding } = verifySynthesisContextRequest(request, scope);
  if (intent.sourceId !== row.source_id || intent.configurationRevisionId !== row.configuration_revision_id) differs();
  const plan = planSchema.parse(await read("engagement_synthesis_generation_plans", columns.plan, "request_id", row.id));
  if (plan.request_id !== row.id || digest(plan.header_text) !== plan.header_sha256) differs();
  const counts = countsSchema.parse(JSON.parse(plan.header_text)), recipe = synthesisContextRecipe();
  const continuation = { schemaVersion: 1, purpose: "private_synthesis_context_continuation_plan", requestId: row.id,
    actorId: row.actor_id, intentSha256: row.intent_sha256, contextRequestSha256: context.context_sha256,
    recipeId: recipe.id, recipeSha256: recipe.sha256, contentManifestSha256: binding.contentManifestSha256,
    targetRecordId: binding.targetRecordId, frameCount: counts.frameCount, taskByteLimit: intent.taskByteLimit };
  const header = { schemaVersion: 1, purpose: "private_synthesis_context_frame_plan", requestId: row.id,
    actorId: row.actor_id, intentSha256: row.intent_sha256, contextRequestSha256: context.context_sha256,
    recipeId: recipe.id, recipeSha256: recipe.sha256, continuationHeaderSha256: digest(JSON.stringify(continuation)),
    contentManifestSha256: binding.contentManifestSha256, contextManifestSha256: binding.contextManifestSha256,
    targetRecordId: binding.targetRecordId, frameByteLimit: binding.frameByteLimit,
    frameCount: counts.frameCount, frameBytes: counts.frameBytes, tailSha256: counts.tailSha256 };
  if (plan.header_text !== JSON.stringify(header)) differs();
  const seal = sealSchema.parse(await read("engagement_synthesis_generation_plan_seals", columns.seal, "request_id", row.id));
  if (seal.request_id !== row.id || digest(seal.receipt_text) !== seal.receipt_sha256) differs();
  z.object({ schemaVersion: z.literal(1), requestId: z.literal(row.id), headerSha256: z.literal(plan.header_sha256),
    frameCount: z.literal(header.frameCount), frameBytes: z.literal(header.frameBytes), tailSha256: z.literal(header.tailSha256), sealedAt: date })
    .strict().parse(JSON.parse(seal.receipt_text));
  const authorization = synthesisWorkerAuthorizationIntentSchema.parse(JSON.parse(grant.intent_text));
  if (authorization.headerSha256 !== plan.header_sha256 || authorization.maxAttempts > header.frameCount ||
    (authorization.retryTaskIndex === null) !== (authorization.retryOfAttemptId === null) ||
    (authorization.retryTaskIndex !== null && (authorization.retryTaskIndex >= header.frameCount || authorization.maxAttempts !== 1))) differs();
  return { grant, scope, intent, authorization, header, headerText: plan.header_text, headerSha256: plan.header_sha256 };
}
