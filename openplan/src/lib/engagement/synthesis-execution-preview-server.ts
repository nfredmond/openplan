import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { providerApiConfigurationSchema } from "@/lib/integrations/provider-api-credentials";
import { readSynthesisGenerationRequest, SynthesisGenerationRequestError } from "./synthesis-generation-requests-server";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const date = z.string().datetime({ offset: true });
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id, stage: z.enum(["segment", "context", "thematic"]) }).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), requestId: id, headerText: z.string().max(4096), headerSha256: hash,
  nextIndex: natural, tailSha256: hash, cancelled: z.boolean(), taskBytes: natural.optional(), frameBytes: natural.optional(),
  campaignId: id.optional(), workspaceId: id.optional(),
  seal: z.object({ receiptText: z.string().max(8192), receiptSha256: hash }).strict().nullable(),
}).strict();
const countsSchema = z.object({ schemaVersion: z.literal(1), purpose: z.string(), requestId: id, intentSha256: hash,
  tailSha256: hash, taskCount: natural.optional(), taskBytes: natural.optional(), frameCount: natural.optional(), frameBytes: natural.optional(),
  actorId: id.optional(), campaignId: id.optional(), workspaceId: id.optional(),
}).passthrough();
const sealSchema = z.object({ schemaVersion: z.literal(1), requestId: id, headerSha256: hash, tailSha256: hash, sealedAt: date,
  taskCount: natural.optional(), taskBytes: natural.optional(), frameCount: natural.optional(), frameBytes: natural.optional(),
}).passthrough();
const revisionSchema = z.object({ id, connection_id: id, workspace_id: id, configuration: providerApiConfigurationSchema,
  configuration_canonical: z.string().max(32000), configuration_hash: hash }).strict();
const connectionSchema = z.object({ id, workspace_id: id, current_revision_id: id.nullable(), revoked_at: date.nullable() }).strict();
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const differs = (): never => { throw new SynthesisGenerationRequestError("unavailable", 503); };
const names = { segment: "read_engagement_synthesis_generation_plan", context: "read_engagement_synthesis_context_plan", thematic: "read_engagement_synthesis_thematic_plan" } as const;
const purposes = { segment: "private_synthesis_segment_plan", context: "private_synthesis_context_frame_plan", thematic: "private_synthesis_thematic_frame_plan" } as const;

/** Read a bounded review summary after current staff access, then recheck it.
 * The native header and seal establish retained inventory, not reconstruction
 * of every source/task. Existing durable workers perform that reconstruction
 * before dispatch. No contribution bytes or credential columns are requested.
 */
export async function readSynthesisExecutionPreview(client: Pick<SupabaseClient, "rpc">,
  service: Pick<SupabaseClient, "rpc" | "from">, rawScope: z.infer<typeof scopeSchema>, signal: AbortSignal) {
  signal.throwIfAborted();
  const scope = scopeSchema.parse(rawScope), requestScope = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: scope.requestId };
  const original = await readSynthesisGenerationRequest(client, requestScope, signal);
  const request = original.state.request, intent = original.intent;
  if (!request || !intent) throw new SynthesisGenerationRequestError("conflict", 409);
  const bounded = () => AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const planSignal = bounded();
  const response = await service.rpc(names[scope.stage], { p_request: scope.requestId }).abortSignal(planSignal);
  planSignal.throwIfAborted();
  if (response.error) {
    if (["PT409", "0A000"].includes(response.error.code)) throw new SynthesisGenerationRequestError("conflict", 409);
    if (response.error.code === "42501") throw new SynthesisGenerationRequestError("forbidden", 403);
    differs();
  }
  const state = stateSchema.parse(response.data);
  if (!state.seal) throw new SynthesisGenerationRequestError("conflict", 409);
  const header = countsSchema.parse(JSON.parse(state.headerText));
  const seal = sealSchema.parse(JSON.parse(state.seal.receiptText));
  const segment = scope.stage === "segment", count = segment ? header.taskCount : header.frameCount;
  const bytes = segment ? header.taskBytes : header.frameBytes;
  const taskCount = scope.stage === "context" ? count : header.taskCount;
  if (count === undefined || bytes === undefined || taskCount === undefined ||
    state.requestId !== scope.requestId || header.requestId !== scope.requestId || header.intentSha256 !== request.intentSha256 ||
    header.purpose !== purposes[scope.stage] || digest(state.headerText) !== state.headerSha256 ||
    Buffer.byteLength(state.headerText, "utf8") > 4096 || digest(state.seal.receiptText) !== state.seal.receiptSha256 ||
    state.nextIndex !== count || state.tailSha256 !== header.tailSha256 || (segment ? state.taskBytes : state.frameBytes) !== bytes ||
    seal.requestId !== scope.requestId || seal.headerSha256 !== state.headerSha256 || seal.tailSha256 !== header.tailSha256 ||
    (segment ? seal.taskCount : seal.frameCount) !== count || (segment ? seal.taskBytes : seal.frameBytes) !== bytes ||
    (!segment && header.actorId !== request.actorId) ||
    (scope.stage === "thematic" && (taskCount !== count + 1 || seal.taskCount !== taskCount ||
      header.campaignId !== scope.campaignId || header.workspaceId !== scope.workspaceId ||
      state.campaignId !== scope.campaignId || state.workspaceId !== scope.workspaceId))) differs();
  async function row(table: string, columns: string, filters: Record<string, string>) {
    signal.throwIfAborted();
    let query = service.from(table).select(columns);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const readSignal = bounded(), result = await query.abortSignal(readSignal).single();
    readSignal.throwIfAborted();
    if (result.error) differs();
    return result.data;
  }
  const revision = revisionSchema.parse(await row("workspace_provider_api_revisions",
    "id,connection_id,workspace_id,configuration,configuration_canonical,configuration_hash",
    { id: intent.configurationRevisionId, connection_id: intent.connectionId, workspace_id: scope.workspaceId }));
  const connection = connectionSchema.parse(await row("workspace_provider_api_connections", "id,workspace_id,current_revision_id,revoked_at",
    { id: intent.connectionId, workspace_id: scope.workspaceId }));
  if (revision.id !== intent.configurationRevisionId || revision.connection_id !== intent.connectionId || revision.workspace_id !== scope.workspaceId ||
    revision.configuration_hash !== intent.configurationHash || digest(revision.configuration_canonical) !== intent.configurationHash ||
    JSON.stringify(revision.configuration) !== revision.configuration_canonical || !revision.configuration.modelIds.includes(intent.modelId) ||
    connection.id !== intent.connectionId || connection.workspace_id !== scope.workspaceId) differs();
  const current = await readSynthesisGenerationRequest(client, requestScope, signal);
  if (current.state.request?.intentText !== request.intentText || current.state.request.actorId !== request.actorId) differs();
  signal.throwIfAborted();
  return { schemaVersion: 1 as const, ...scope, actorId: request.actorId, sourceId: intent.sourceId, sourceSha256: intent.sourceSha256,
    requestIntentSha256: request.intentSha256, headerSha256: state.headerSha256, sealSha256: state.seal.receiptSha256,
    taskCount, inputBytes: bytes, sealedAt: seal.sealedAt, cancelled: state.cancelled || current.cancellation !== null,
    provider: { connectionId: intent.connectionId, revisionId: intent.configurationRevisionId, configurationHash: intent.configurationHash,
      label: revision.configuration.label, endpoint: revision.configuration.endpoint, modelId: intent.modelId,
      current: connection.revoked_at === null && connection.current_revision_id === intent.configurationRevisionId } };
}
