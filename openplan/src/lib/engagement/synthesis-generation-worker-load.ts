import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { providerApiConfigurationSchema } from "@/lib/integrations/provider-api-credentials";
import { createSynthesisGenerationPlan, synthesisGenerationRequestIntentSchema, verifySynthesisGenerationPlanState } from "./synthesis-generation-plan";
import { synthesisGenerationAttemptBindingSchema } from "./synthesis-generation-results";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const SYNTHESIS_WORKER_COLUMNS = {
  authorization: "id,request_id,intent_text,intent_sha256,credential_sha256",
  request: "id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text,intent_sha256",
  source: "id,campaign_id,workspace_id,snapshot_text,snapshot_sha256,created_at",
  task: "request_id,task_index,task_text,task_sha256,task_bytes",
  revision: "id,connection_id,workspace_id,configuration,configuration_canonical,configuration_hash",
  credential: "revision_id,connection_id,workspace_id,credential_ciphertext",
} as const;
const grantSchema = z.object({ id, request_id: id, intent_text: z.string(), intent_sha256: hash, credential_sha256: hash.nullable() }).strict();
const requestSchema = z.object({ id, campaign_id: id, workspace_id: id, actor_id: id, source_id: id,
  configuration_revision_id: id, intent_text: z.string(), intent_sha256: hash }).strict();
const sourceSchema = z.object({ id, campaign_id: id, workspace_id: id, snapshot_text: z.string(), snapshot_sha256: hash,
  created_at: z.string().datetime({ offset: true }) }).strict();
const taskSchema = z.object({ request_id: id, task_index: natural, task_text: z.string(), task_sha256: hash, task_bytes: natural }).strict();
const revisionSchema = z.object({ id, connection_id: id, workspace_id: id, configuration: providerApiConfigurationSchema,
  configuration_canonical: z.string().max(32000), configuration_hash: hash }).strict();
const credentialSchema = z.object({ revision_id: id, connection_id: id, workspace_id: id, credential_ciphertext: z.string().max(32000).nullable() }).strict();
const authorizationIntentSchema = z.object({ schemaVersion: z.literal(1), headerSha256: hash,
  maxAttempts: z.number().int().positive().safe(), maxOutputTokens: z.number().int().min(1).max(65536),
  responseByteLimit: z.number().int().min(4096).max(4194304), expiresAt: z.string().datetime({ offset: true }),
  chargesAcknowledged: z.literal(true), retryTaskIndex: natural.nullable(), retryOfAttemptId: id.nullable(),
}).strict();
const synthesisWorkerJobSchema = z.object({ binding: synthesisGenerationAttemptBindingSchema,
  workspaceId: id, campaignId: id, actorId: id, connectionId: id, headerSha256: hash,
  authorizationId: id, authorizationIntentText: z.string().max(4096), authorizationIntentSha256: hash,
  credentialSha256: hash.nullable(), taskIndex: natural, taskCanonical: z.string().max(1_048_576),
}).strict();
type Service = Pick<SupabaseClient, "from" | "rpc">;
function differs(): never { throw new Error("Synthesis worker retained identity differs"); }
export function synthesisWorkerRequestSignal(signal: AbortSignal) { return AbortSignal.any([signal, AbortSignal.timeout(10000)]); }

/** Recheck saved job identity without reopening execution authority. Credentials
 * themselves are absent, so late output recovery does not need to decrypt a key.
 */
export function checkedSynthesisWorkerJob(raw: unknown) {
  const job = synthesisWorkerJobSchema.parse(raw), intent = authorizationIntentSchema.parse(JSON.parse(job.authorizationIntentText));
  if (job.binding.provider !== "api_connection" || digest(job.authorizationIntentText) !== job.authorizationIntentSha256 ||
    intent.headerSha256 !== job.headerSha256 || digest(job.taskCanonical) !== job.binding.taskSha256 ||
    Buffer.byteLength(job.taskCanonical, "utf8") > 1_048_576 ||
    (intent.retryOfAttemptId === null) !== (intent.retryTaskIndex === null) ||
    (intent.retryTaskIndex !== null && (intent.retryTaskIndex !== job.taskIndex || intent.maxAttempts !== 1))) differs();
  return { job, intent };
}

async function read(service: Service, table: string, columns: string, filters: Record<string, string | number>, signal: AbortSignal) {
  signal.throwIfAborted();
  let query = service.from(table).select(columns);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const response = await query.abortSignal(synthesisWorkerRequestSignal(signal)).single();
  if (response.error) throw new Error("Synthesis worker retained row unavailable");
  return response.data;
}

/** Reconstruct the complete saved source, verify the native seal and compare the
 * chosen task before claiming it. A service read never impersonates a staff JWT.
 */
export async function loadSynthesisWorkerJob(service: Service, args: { authorizationId: string; taskIndex: number; attemptId: string }, signal: AbortSignal) {
  signal.throwIfAborted();
  const authorizationId = id.parse(args.authorizationId), taskIndex = natural.parse(args.taskIndex), attemptId = id.parse(args.attemptId);
  const grant = grantSchema.parse(await read(service, "engagement_synthesis_generation_authorizations", SYNTHESIS_WORKER_COLUMNS.authorization, { id: authorizationId }, signal));
  if (grant.id !== authorizationId || digest(grant.intent_text) !== grant.intent_sha256) differs();
  const request = requestSchema.parse(await read(service, "engagement_synthesis_generation_requests", SYNTHESIS_WORKER_COLUMNS.request, { id: grant.request_id }, signal));
  if (request.id !== grant.request_id) differs();
  const intent = synthesisGenerationRequestIntentSchema.parse(JSON.parse(request.intent_text));
  if (intent.sourceId !== request.source_id || intent.configurationRevisionId !== request.configuration_revision_id) differs();
  const source = sourceSchema.parse(await read(service, "engagement_synthesis_sources", SYNTHESIS_WORKER_COLUMNS.source,
    { id: request.source_id, campaign_id: request.campaign_id, workspace_id: request.workspace_id }, signal));
  const scope = { requestId: request.source_id, campaignId: request.campaign_id, workspaceId: request.workspace_id };
  const plan = createSynthesisGenerationPlan({ id: request.id, intentText: request.intent_text, intentSha256: request.intent_sha256 },
    { requestId: source.id, campaignId: source.campaign_id, workspaceId: source.workspace_id,
      snapshotText: source.snapshot_text, snapshotSha256: source.snapshot_sha256, createdAt: source.created_at }, scope);
  const response = await service.rpc("read_engagement_synthesis_generation_plan", { p_request: request.id }).abortSignal(synthesisWorkerRequestSignal(signal));
  if (response.error) throw new Error("Synthesis worker plan unavailable");
  const state = verifySynthesisGenerationPlanState(plan, response.data);
  if (!state.seal || state.cancelled || plan.header.contributionCount === 0 || taskIndex >= plan.entries.length) differs();
  const task = taskSchema.parse(await read(service, "engagement_synthesis_generation_plan_tasks", SYNTHESIS_WORKER_COLUMNS.task,
    { request_id: request.id, task_index: taskIndex }, signal));
  const expected = plan.entries[taskIndex];
  if (task.request_id !== request.id || task.task_index !== taskIndex || task.task_text !== expected.canonical ||
    task.task_sha256 !== expected.sha256 || task.task_bytes !== expected.utf8Bytes) differs();
  const checked = checkedSynthesisWorkerJob({ binding: { jobId: request.id, planSha256: plan.header.taskManifestSha256,
    configurationRevisionId: intent.configurationRevisionId, configurationHash: intent.configurationHash,
    provider: "api_connection", modelId: intent.modelId, taskSha256: task.task_sha256, attemptId },
    workspaceId: request.workspace_id, campaignId: request.campaign_id, actorId: request.actor_id, connectionId: intent.connectionId,
    headerSha256: plan.headerSha256, authorizationId, authorizationIntentText: grant.intent_text,
    authorizationIntentSha256: grant.intent_sha256, credentialSha256: grant.credential_sha256, taskIndex, taskCanonical: task.task_text });
  if (Date.parse(checked.intent.expiresAt) <= Date.now()) throw new Error("Synthesis worker authorization expired");
  return checked.job;
}

/** Read only the pinned revision and compare its ciphertext to the authorization.
 * No current-revision fallback or ambient provider key is permitted.
 */
export async function loadSynthesisWorkerCredential(service: Service, rawJob: unknown, signal: AbortSignal) {
  const { job } = checkedSynthesisWorkerJob(rawJob);
  const revision = revisionSchema.parse(await read(service, "workspace_provider_api_revisions", SYNTHESIS_WORKER_COLUMNS.revision,
    { id: job.binding.configurationRevisionId, connection_id: job.connectionId, workspace_id: job.workspaceId }, signal));
  const credential = credentialSchema.parse(await read(service, "workspace_provider_api_credentials", SYNTHESIS_WORKER_COLUMNS.credential,
    { revision_id: job.binding.configurationRevisionId, connection_id: job.connectionId, workspace_id: job.workspaceId }, signal));
  if (revision.id !== job.binding.configurationRevisionId || revision.connection_id !== job.connectionId || revision.workspace_id !== job.workspaceId ||
    credential.revision_id !== revision.id || credential.connection_id !== job.connectionId || credential.workspace_id !== job.workspaceId ||
    revision.configuration_hash !== job.binding.configurationHash || digest(revision.configuration_canonical) !== revision.configuration_hash ||
    JSON.stringify(revision.configuration) !== revision.configuration_canonical ||
    (credential.credential_ciphertext === null ? null : digest(credential.credential_ciphertext)) !== job.credentialSha256) differs();
  return { workspaceId: job.workspaceId, connectionId: job.connectionId, revisionId: revision.id,
    configuration: revision.configuration, configurationHash: revision.configuration_hash, credentialCiphertext: credential.credential_ciphertext };
}
