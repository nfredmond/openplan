import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisThematicRequest } from "./synthesis-thematic-requests-server";
import { synthesisThematicRecipe } from "./synthesis-thematic-continuation";
import { synthesisWorkerAuthorizationIntentSchema, synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const date = z.string().datetime({ offset: true });
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const grantSchema = z.object({ id, request_id: id, intent_text: z.string().max(4096), intent_sha256: hash, credential_sha256: hash.nullable() }).strict();
const requestSchema = z.object({ id, campaign_id: id, workspace_id: id, actor_id: id, source_id: id,
  configuration_revision_id: id, intent_text: z.string().max(4096), intent_sha256: hash, created_at: date }).strict();
const thematicSchema = z.object({ request_id: id, parent_request_id: id, thematic_text: z.string().max(4096), thematic_sha256: hash, created_at: date }).strict();
const inputSealSchema = z.object({ request_id: id, manifest_text: z.string().max(8192), manifest_sha256: hash,
  receipt_text: z.string().max(8192), receipt_sha256: hash }).strict();
const planSchema = z.object({ request_id: id, header_text: z.string().max(4096), header_sha256: hash }).strict();
const sealSchema = z.object({ request_id: id, receipt_text: z.string().max(8192), receipt_sha256: hash }).strict();
const differs = (): never => { throw new Error("Thematic schedule retained authority differs"); };

/** Inspect immutable scheduling identity after cancellation, revocation or expiry.
 * Counts and content hashes here remain historical commitments, not reconstructed
 * evidence or execution permission. A new schedule replays original inputs, and
 * every fresh task still passes the worker's native claim and dispatch fences.
 */
export async function loadSynthesisThematicScheduleAuthority(service: Pick<SupabaseClient, "from">,
  rawAuthorizationId: string, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const authorizationId = id.parse(rawAuthorizationId);
  async function read(query: PromiseLike<{ data: unknown; error: unknown }>) {
    signal.throwIfAborted(); const response = await query; signal.throwIfAborted();
    if (response.error) throw new Error("Thematic schedule retained authority unavailable");
    return response.data;
  }
  const grant = grantSchema.parse(await read(service.from("engagement_synthesis_generation_authorizations")
    .select("id,request_id,intent_text,intent_sha256,credential_sha256").eq("id", authorizationId)
    .abortSignal(synthesisWorkerRequestSignal(signal)).single()));
  if (grant.id !== authorizationId || digest(grant.intent_text) !== grant.intent_sha256) differs();
  const row = requestSchema.parse(await read(service.from("engagement_synthesis_generation_requests")
    .select("id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text,intent_sha256,created_at")
    .eq("id", grant.request_id).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
  const thematic = thematicSchema.parse(await read(service.from("engagement_synthesis_thematic_requests")
    .select("request_id,parent_request_id,thematic_text,thematic_sha256,created_at")
    .eq("request_id", grant.request_id).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
  if (row.id !== grant.request_id || thematic.request_id !== grant.request_id) differs();
  const scope = { campaignId: row.campaign_id, workspaceId: row.workspace_id, requestId: row.id };
  const request = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: { id: row.id, actorId: row.actor_id, intentText: row.intent_text, intentSha256: row.intent_sha256, createdAt: row.created_at },
    thematic: { parentRequestId: thematic.parent_request_id, thematicText: thematic.thematic_text, thematicSha256: thematic.thematic_sha256, createdAt: thematic.created_at },
    cancellation: null };
  const { intent, binding } = verifySynthesisThematicRequest(request, scope);
  if (intent.sourceId !== row.source_id || intent.configurationRevisionId !== row.configuration_revision_id) differs();
  const inputSeal = inputSealSchema.parse(await read(service.from("engagement_synthesis_thematic_input_seals")
    .select("request_id,manifest_text,manifest_sha256,receipt_text,receipt_sha256")
    .eq("request_id", row.id).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
  if (inputSeal.request_id !== row.id || digest(inputSeal.manifest_text) !== inputSeal.manifest_sha256 ||
    digest(inputSeal.receipt_text) !== inputSeal.receipt_sha256) differs();
  const inputCounts = z.object({ inputCount: natural.positive(), outputBytes: natural.positive(), tailSha256: hash }).passthrough().parse(JSON.parse(inputSeal.manifest_text));
  const manifest = { schemaVersion: 1, purpose: "private_synthesis_thematic_input_manifest", ...scope,
    actorId: row.actor_id, intentSha256: row.intent_sha256, thematicSha256: thematic.thematic_sha256,
    sourceId: intent.sourceId, sourceSha256: intent.sourceSha256, inputCount: inputCounts.inputCount, outputBytes: inputCounts.outputBytes,
    seedSha256: digest(`synthesis-thematic-inputs-v1:${row.id}:${scope.campaignId}:${scope.workspaceId}:${row.actor_id}:${row.intent_sha256}:${thematic.thematic_sha256}:${intent.sourceId}:${intent.sourceSha256}`),
    tailSha256: inputCounts.tailSha256 };
  if (inputSeal.manifest_text !== JSON.stringify(manifest)) differs();
  z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_thematic_input_seal"),
    requestId: z.literal(row.id), manifestSha256: z.literal(inputSeal.manifest_sha256), sealedAt: date })
    .strict().parse(JSON.parse(inputSeal.receipt_text));
  const plan = planSchema.parse(await read(service.from("engagement_synthesis_generation_plans")
    .select("request_id,header_text,header_sha256").eq("request_id", row.id).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
  if (plan.request_id !== row.id || digest(plan.header_text) !== plan.header_sha256) differs();
  const counts = z.object({ frameCount: natural.positive(), frameBytes: natural.positive(), tailSha256: hash, contentManifestSha256: hash })
    .passthrough().parse(JSON.parse(plan.header_text)), recipe = synthesisThematicRecipe();
  const taskCount = natural.parse(counts.frameCount + 1);
  const continuation = { schemaVersion: 1, purpose: "private_synthesis_thematic_continuation_plan", requestId: row.id,
    actorId: row.actor_id, intentSha256: row.intent_sha256, thematicRequestSha256: thematic.thematic_sha256,
    inputManifestSha256: inputSeal.manifest_sha256, inputSealSha256: inputSeal.receipt_sha256, recipeId: recipe.id, recipeSha256: recipe.sha256,
    contentManifestSha256: counts.contentManifestSha256, frameCount: counts.frameCount, taskCount, taskByteLimit: intent.taskByteLimit };
  const header = { schemaVersion: 1, purpose: "private_synthesis_thematic_frame_plan", requestId: row.id,
    campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: row.actor_id,
    intentSha256: row.intent_sha256, thematicRequestSha256: thematic.thematic_sha256, recipeId: recipe.id, recipeSha256: recipe.sha256,
    continuationHeaderSha256: digest(JSON.stringify(continuation)), contentManifestSha256: counts.contentManifestSha256,
    inputManifestSha256: inputSeal.manifest_sha256, inputSealSha256: inputSeal.receipt_sha256,
    frameByteLimit: binding.frameByteLimit, taskByteLimit: intent.taskByteLimit,
    frameCount: counts.frameCount, taskCount, frameBytes: counts.frameBytes, tailSha256: counts.tailSha256 };
  if (plan.header_text !== JSON.stringify(header)) differs();
  const seal = sealSchema.parse(await read(service.from("engagement_synthesis_generation_plan_seals")
    .select("request_id,receipt_text,receipt_sha256").eq("request_id", row.id).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
  if (seal.request_id !== row.id || digest(seal.receipt_text) !== seal.receipt_sha256) differs();
  const receipt = z.object({ schemaVersion: z.literal(1), requestId: z.literal(row.id), headerSha256: z.literal(plan.header_sha256),
    frameCount: z.literal(header.frameCount), taskCount: z.literal(header.taskCount), frameBytes: z.literal(header.frameBytes), tailSha256: z.literal(header.tailSha256),
    proposalReferenceText: z.string(), proposalReferenceSha256: hash, sealedAt: date }).strict().parse(JSON.parse(seal.receipt_text));
  if (digest(receipt.proposalReferenceText) !== receipt.proposalReferenceSha256) differs();
  z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_thematic_proposal_reference"), taskIndex: z.literal(header.frameCount),
    inputManifestSha256: z.literal(header.inputManifestSha256), inputSealSha256: z.literal(header.inputSealSha256),
    continuationHeaderSha256: z.literal(header.continuationHeaderSha256), contentManifestSha256: z.literal(header.contentManifestSha256),
    frameTailSha256: z.literal(header.tailSha256) }).strict().parse(JSON.parse(receipt.proposalReferenceText));
  const authorization = synthesisWorkerAuthorizationIntentSchema.parse(JSON.parse(grant.intent_text));
  if (authorization.headerSha256 !== plan.header_sha256 || authorization.maxAttempts > header.taskCount ||
    (authorization.retryTaskIndex === null) !== (authorization.retryOfAttemptId === null) ||
    (authorization.retryTaskIndex !== null && (authorization.retryTaskIndex >= header.taskCount || authorization.maxAttempts !== 1))) differs();
  return { grant, scope, intent, authorization, header, headerText: plan.header_text, headerSha256: plan.header_sha256 };
}
