import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisGenerationApiDispatchReceipt } from "./synthesis-generation-api";
import { verifySynthesisGenerationApiResult } from "./synthesis-generation-api-result";
import { createSynthesisGenerationInput } from "./synthesis-generation-input";
import { createSynthesisGenerationRecords } from "./synthesis-generation-records";
import { synthesisGenerationRequestIntentSchema } from "./synthesis-generation-plan";
import { assembleSynthesisGenerationResults, synthesisGenerationAttemptBindingSchema,
  type SynthesisGenerationResult } from "./synthesis-generation-results";
import { readSynthesisGenerationSelections, readSynthesisGenerationHistoricalSelections, readSynthesisContextParentSelections } from "./synthesis-generation-selections-server";
import { verifySynthesisSource } from "./synthesis-sources-server";
import { loadSynthesisWorkerAuthorization, synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const attemptSchema = z.object({ id, authorization_id: id, request_id: id,
  task_index: z.number().int().nonnegative().safe(), previous_attempt_id: id.nullable(), worker_id: id,
  binding_text: z.string().max(4096),
}).strict();
const dispatchSchema = z.object({ attempt_id: id, expires_at: date, receipt_text: z.string().max(16384), receipt_sha256: hash }).strict();
const outputSchema = z.object({ attempt_id: id, capture_text: z.string().max(33619968), capture_sha256: hash }).strict();
const columns = {
  attempt: "id,authorization_id,request_id,task_index,previous_attempt_id,worker_id,binding_text",
  dispatch: "attempt_id,expires_at,receipt_text,receipt_sha256",
  output: "attempt_id,capture_text,capture_sha256",
} as const;
const differs = (): never => { throw new Error("Selected synthesis output differs from its retained execution"); };

/** Join the anchored native choices to immutable execution records and original
 * provider bytes. This service-only reader does not authorize access or dispatch;
 * its caller must supply the authorized source scope and original requester.
 * Current-staff historical access needs its own permission boundary. Missing
 * output remains incomplete, and later arrivals require another read.
 */
async function readSelectedResults(service: Pick<SupabaseClient, "from" | "rpc">,
  args: Parameters<typeof readSynthesisGenerationSelections>[1], signal: AbortSignal,
  loadSelections: () => ReturnType<typeof readSynthesisGenerationSelections> = () => readSynthesisGenerationSelections(service, args, signal),
) {
  const selected = await loadSelections();
  const results: SynthesisGenerationResult[] = [];
  const executions: Array<{ taskIndex: number; attemptId: string; authorizationId: string;
    dispatchSha256: string | null; outputSha256: string | null }> = [];
  const grants = new Map<string, Awaited<ReturnType<typeof loadSynthesisWorkerAuthorization>>>();
  async function row(table: string, projection: string, key: string, value: string) {
    signal.throwIfAborted();
    const response = await service.from(table).select(projection).eq(key, value)
      .abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle();
    if (response.error) throw new Error("Selected synthesis execution unavailable; retry the read");
    signal.throwIfAborted();
    return response.data;
  }
  for (const { receipt } of selected.entries) {
    if (receipt.attemptId === null) continue;
    const attempt = attemptSchema.parse(await row("engagement_synthesis_generation_attempts", columns.attempt, "id", receipt.attemptId));
    if (attempt.id !== receipt.attemptId || attempt.request_id !== selected.requestId || attempt.task_index !== receipt.taskIndex ||
      (receipt.origin === "authorization" && attempt.authorization_id !== receipt.authorizationId)) differs();
    let grant = grants.get(attempt.authorization_id);
    if (!grant) {
      grant = await loadSynthesisWorkerAuthorization(service, attempt.authorization_id, signal);
      grants.set(attempt.authorization_id, grant);
    }
    if (grant.request.id !== selected.requestId || grant.request.actor_id !== args.actorId ||
      grant.request.campaign_id !== args.scope.campaignId || grant.request.workspace_id !== args.scope.workspaceId ||
      grant.plan.headerText !== selected.plan.headerText ||
      grant.authorization.retryOfAttemptId !== attempt.previous_attempt_id ||
      (grant.authorization.retryTaskIndex !== null && grant.authorization.retryTaskIndex !== attempt.task_index)) differs();
    const binding = synthesisGenerationAttemptBindingSchema.parse(JSON.parse(attempt.binding_text));
    const expected = { jobId: selected.requestId, planSha256: selected.plan.header.taskManifestSha256,
      configurationRevisionId: grant.intent.configurationRevisionId, configurationHash: grant.intent.configurationHash,
      provider: "api_connection" as const, modelId: grant.intent.modelId,
      taskSha256: selected.plan.entries[receipt.taskIndex].sha256, attemptId: attempt.id };
    if (!isDeepStrictEqual(binding, expected)) differs();
    const rawDispatch = await row("engagement_synthesis_generation_dispatches", columns.dispatch, "attempt_id", attempt.id);
    const rawOutput = await row("engagement_synthesis_generation_outputs", columns.output, "attempt_id", attempt.id);
    let dispatchSha256: string | null = null, outputSha256: string | null = null;
    if (rawDispatch !== null) {
      const dispatch = dispatchSchema.parse(rawDispatch);
      const verified = verifySynthesisGenerationApiDispatchReceipt({ binding, workerId: attempt.worker_id,
        authorizationId: attempt.authorization_id, dispatch: { receiptText: dispatch.receipt_text, receiptSha256: dispatch.receipt_sha256 } });
      if (dispatch.attempt_id !== attempt.id || Date.parse(dispatch.expires_at) !== Date.parse(verified.receipt.expiresAt) ||
        Date.parse(verified.receipt.expiresAt) > Date.parse(grant.authorization.expiresAt) ||
        verified.receipt.maxOutputTokens !== grant.authorization.maxOutputTokens ||
        verified.receipt.responseByteLimit !== grant.authorization.responseByteLimit) differs();
      dispatchSha256 = dispatch.receipt_sha256;
      if (rawOutput !== null) {
        const output = outputSchema.parse(rawOutput);
        if (output.attempt_id !== attempt.id || Buffer.byteLength(output.capture_text, "utf8") > verified.receipt.responseByteLimit * 8 + 65536) differs();
        const result = verifySynthesisGenerationApiResult(binding, { canonical: output.capture_text, sha256: output.capture_sha256 },
          { dispatchSha256, responseByteLimit: verified.receipt.responseByteLimit });
        results.push({ canonical: result.canonical, sha256: result.sha256 }); outputSha256 = result.sha256;
      }
    } else if (rawOutput !== null) differs();
    executions.push({ taskIndex: receipt.taskIndex, attemptId: attempt.id, authorizationId: attempt.authorization_id, dispatchSha256, outputSha256 });
  }
  const input = createSynthesisGenerationInput(args.saved, args.scope);
  const records = createSynthesisGenerationRecords(input, args.saved, args.scope);
  // The request checksum and source are already reconstructed by the selection reader.
  const request = z.object({ intentText: z.string() }).parse(args.request);
  const intent = synthesisGenerationRequestIntentSchema.parse(JSON.parse(request.intentText));
  const inventory = assembleSynthesisGenerationResults({ job: { jobId: selected.requestId,
    planSha256: selected.plan.header.taskManifestSha256, configurationRevisionId: intent.configurationRevisionId,
    configurationHash: intent.configurationHash, provider: "api_connection", modelId: intent.modelId },
    selections: selected.selections, results, plan: selected.plan.taskPlan, records, input,
    saved: args.saved, scope: args.scope, taskByteLimit: intent.taskByteLimit });
  return { selections: selected, executions, inventory };
}

export function readSynthesisGenerationSelectedResults(service: Pick<SupabaseClient, "from" | "rpc">,
  args: Parameters<typeof readSynthesisGenerationSelections>[1], signal: AbortSignal,
) {
  return readSelectedResults(service, args, signal);
}

/** Read a fixed parent snapshot through the retained child's native scope.
 * Original grant, dispatch and provider-response verification remain identical
 * to segment history. This service read supplies no execution permission.
 */
export function readSynthesisContextParentResults(service: Pick<SupabaseClient, "from" | "rpc">,
  contextRequestId: string, args: Parameters<typeof readSynthesisGenerationSelections>[1], signal: AbortSignal,
) {
  return readSelectedResults(service, args, signal, () => readSynthesisContextParentSelections(service, contextRequestId, args, signal));
}

const historyScopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id,
  throughSequence: z.number().int().nonnegative().safe().optional() }).strict();
const historyRequestSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id,
  request: z.object({ id, actorId: id, intentText: z.string().max(4096), intentSha256: hash, createdAt: date }).strict(),
  cancellation: z.unknown(),
}).strict();

/** Load authority and source through the current staff member's authenticated
 * client before using private service reads. Recheck that access before returning.
 * Neither historical membership nor the request's author can stand in for it.
 */
export async function loadSynthesisGenerationHistory(client: Pick<SupabaseClient, "rpc">,
  service: Pick<SupabaseClient, "from" | "rpc">,
  rawScope: z.infer<typeof historyScopeSchema>, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const scope = historyScopeSchema.parse(rawScope);
  async function readRequest() {
    signal.throwIfAborted();
    const response = await client.rpc("read_engagement_synthesis_generation_request", { p_campaign: scope.campaignId, p_request: scope.requestId })
      .abortSignal(synthesisWorkerRequestSignal(signal));
    if (response.error) throw new Error("Synthesis history access unavailable; reload with current staff access");
    signal.throwIfAborted();
    const record = historyRequestSchema.parse(response.data);
    if (record.campaignId !== scope.campaignId || record.workspaceId !== scope.workspaceId || record.request.id !== scope.requestId) differs();
    return record.request;
  }
  const request = await readRequest();
  const intent = synthesisGenerationRequestIntentSchema.parse(JSON.parse(request.intentText));
  const sourceScope = { requestId: intent.sourceId, campaignId: scope.campaignId, workspaceId: scope.workspaceId };
  const response = await client.rpc("read_engagement_synthesis_sources", { p_campaign: scope.campaignId, p_request: intent.sourceId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  if (response.error) throw new Error("Synthesis history source unavailable");
  signal.throwIfAborted();
  const source = verifySynthesisSource(response.data, sourceScope);
  const saved = { ...sourceScope, snapshotText: source.snapshotText, snapshotSha256: source.snapshotSha256, createdAt: source.createdAt };
  const args = { request: { id: request.id, intentText: request.intentText, intentSha256: request.intentSha256 },
    saved, scope: sourceScope, actorId: request.actorId, throughSequence: scope.throughSequence };
  const result = await readSelectedResults(service, args, signal, () => readSynthesisGenerationHistoricalSelections(client, args, signal));
  if (!isDeepStrictEqual(request, await readRequest())) differs();
  return { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requesterId: request.actorId, ...result };
}
