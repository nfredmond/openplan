import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadSynthesisThematicWorkerInputs } from "./synthesis-thematic-worker-load";
import { createSynthesisThematicContinuation } from "./synthesis-thematic-continuation";
import { checkedSynthesisWorkerJob, synthesisWorkerAuthorizationIntentSchema, synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";
import { verifySynthesisGenerationApiDispatchReceipt } from "./synthesis-generation-api";
import { verifySynthesisGenerationApiResult } from "./synthesis-generation-api-result";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const date = z.string().datetime({ offset: true });
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const grantSchema = z.object({ id, request_id: id, intent_text: z.string().max(4096), intent_sha256: hash, credential_sha256: hash.nullable() }).strict();
const attemptSchema = z.object({ id, request_id: id, authorization_id: id, task_index: natural, previous_attempt_id: id.nullable(), worker_id: id, binding_text: z.string().max(4096) }).strict();
const inputSchema = z.object({ attempt_id: id, task_text: z.string().max(1048576), task_sha256: hash, task_bytes: natural,
  predecessor_attempt_id: id.nullable(), predecessor_selection_id: id.nullable(), predecessor_capture_sha256: hash.nullable(), previous_result_sha256: hash.nullable() }).strict();
const dispatchSchema = z.object({ attempt_id: id, expires_at: date, receipt_text: z.string().max(16384), receipt_sha256: hash }).strict();
const outputSchema = z.object({ attempt_id: id, capture_text: z.string().max(33619968), capture_sha256: hash }).strict();
const selectionSchema = z.object({ schemaVersion: z.literal(1), id, requestId: id, taskIndex: natural, attemptId: id.nullable(),
  previousSelectionId: id.nullable(), sequence: natural.positive(), actorId: id, origin: z.enum(["authorization", "staff"]),
  authorizationId: id.nullable(), reason: z.string().min(1).max(4000).refine(text => text.trim().length > 0), selectedAt: date }).strict();
const pageSchema = z.object({ schemaVersion: z.literal(1), requestId: id, throughSequence: natural,
  afterTaskIndex: z.number().int().min(-1).safe(), hasMore: z.boolean(),
  entries: z.array(z.object({ receiptText: z.string().max(32768), receiptSha256: hash }).strict()).max(1) }).strict();
type Service = Pick<SupabaseClient, "from" | "rpc">;
type Grant = z.infer<typeof grantSchema>;
type Predecessor = { attemptId: string; selectionId: string; captureSha256: string; resultSha256: string };
const differs = (): never => { throw new Error("Thematic worker predecessor or authorization differs"); };


/** Replay each selected predecessor from its original provider capture. The
 * chain pins selected receipt identities, exact dynamic tasks and derived result
 * hashes. A fresh native claim/dispatch must still fence current selections and
 * authority; reconstruction never substitutes for those transaction checks.
 */
export async function loadSynthesisThematicWorkerJob(service: Service,
  raw: { authorizationId: string; taskIndex: number; attemptId: string }, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const args = z.object({ authorizationId: id, taskIndex: natural, attemptId: id }).strict().parse(raw);
  async function read(query: PromiseLike<{ data: unknown; error: unknown }>) {
    signal.throwIfAborted();
    const response = await query;
    signal.throwIfAborted();
    if (response.error) throw new Error("Thematic worker execution history unavailable");
    return response.data;
  }
  const grants = new Map<string, Grant>();
  async function grant(authorizationId: string) {
    if (grants.has(authorizationId)) return grants.get(authorizationId)!;
    const row = grantSchema.parse(await read(service.from("engagement_synthesis_generation_authorizations").select("id,request_id,intent_text,intent_sha256,credential_sha256")
      .eq("id", authorizationId).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
    if (row.id !== authorizationId || digest(row.intent_text) !== row.intent_sha256) differs();
    grants.set(authorizationId, row); return row;
  }
  const authorized = await grant(args.authorizationId);
  const inputs = await loadSynthesisThematicWorkerInputs(service, authorized.request_id, signal), { plan, intent, request, scope } = inputs;
  if (args.taskIndex >= plan.header.taskCount) throw new Error("Thematic task is outside the retained plan");
  function jobFor(row: Grant, index: number, attemptId: string, taskCanonical: string) {
    const authorization = synthesisWorkerAuthorizationIntentSchema.parse(JSON.parse(row.intent_text));
    if (row.request_id !== scope.requestId || authorization.maxAttempts > plan.header.taskCount) differs();
    return checkedSynthesisWorkerJob({ binding: { jobId: scope.requestId, planSha256: plan.continuation.headerSha256,
      configurationRevisionId: intent.configurationRevisionId, configurationHash: intent.configurationHash, provider: "api_connection",
      modelId: intent.modelId, taskSha256: digest(taskCanonical), attemptId },
    workspaceId: scope.workspaceId, campaignId: scope.campaignId, actorId: request.request.actorId, connectionId: intent.connectionId,
    headerSha256: plan.headerSha256, authorizationId: row.id, authorizationIntentText: row.intent_text,
    authorizationIntentSha256: row.intent_sha256, credentialSha256: row.credential_sha256, taskIndex: index, taskCanonical });
  }
  const processor = createSynthesisThematicContinuation(inputs.prepared);
  let predecessor: Predecessor | null = null, throughSequence: number | null = null;
  const seenSelections = new Set<string>();
  for (let index = 0; index < args.taskIndex; index++) {
    signal.throwIfAborted();
    const next = processor.next();
    if (next.status !== "ready") throw new Error("Thematic predecessor exceeds task resources or available tasks");
    const response = await service.rpc("read_engagement_synthesis_thematic_selections", { p_request: scope.requestId,
      p_through_sequence: throughSequence, p_after_task_index: index - 1, p_limit: 1 }).abortSignal(synthesisWorkerRequestSignal(signal));
    signal.throwIfAborted();
    if (response.error) throw new Error("Thematic worker predecessor selection unavailable");
    const page = pageSchema.parse(response.data);
    if (page.requestId !== scope.requestId || page.afterTaskIndex !== index - 1 || page.entries.length !== 1 ||
      (throughSequence !== null && page.throughSequence !== throughSequence)) differs();
    throughSequence ??= page.throughSequence;
    const original = page.entries[0];
    if (Buffer.byteLength(original.receiptText, "utf8") > 32768 || digest(original.receiptText) !== original.receiptSha256) differs();
    const selected = selectionSchema.parse(JSON.parse(original.receiptText));
    if (selected.requestId !== scope.requestId || selected.taskIndex !== index || selected.actorId !== request.request.actorId ||
      selected.sequence > throughSequence || selected.attemptId === null || seenSelections.has(selected.id)) differs();
    if (selected.origin === "authorization" ? selected.authorizationId === null || selected.previousSelectionId !== null : selected.authorizationId !== null) differs();
    seenSelections.add(selected.id);
    const attempt = attemptSchema.parse(await read(service.from("engagement_synthesis_generation_attempts").select("id,request_id,authorization_id,task_index,previous_attempt_id,worker_id,binding_text")
      .eq("id", id.parse(selected.attemptId)).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
    if (attempt.id !== selected.attemptId || attempt.request_id !== scope.requestId || attempt.task_index !== index ||
      (selected.origin === "authorization" && attempt.authorization_id !== selected.authorizationId)) differs();
    const priorGrant = await grant(attempt.authorization_id), checked = jobFor(priorGrant, index, attempt.id, next.task.canonical);
    if (attempt.previous_attempt_id !== checked.intent.retryOfAttemptId || !isDeepStrictEqual(JSON.parse(attempt.binding_text), checked.job.binding)) differs();
    const input = inputSchema.parse(await read(service.from("engagement_synthesis_thematic_attempt_inputs").select("attempt_id,task_text,task_sha256,task_bytes,predecessor_attempt_id,predecessor_selection_id,predecessor_capture_sha256,previous_result_sha256")
      .eq("attempt_id", attempt.id).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
    if (input.attempt_id !== attempt.id || input.task_text !== next.task.canonical || input.task_sha256 !== next.task.sha256 || input.task_bytes !== next.task.utf8Bytes ||
      input.predecessor_attempt_id !== (predecessor?.attemptId ?? null) || input.predecessor_selection_id !== (predecessor?.selectionId ?? null) ||
      input.predecessor_capture_sha256 !== (predecessor?.captureSha256 ?? null) || input.previous_result_sha256 !== next.previousResultSha256) differs();
    const dispatch = dispatchSchema.parse(await read(service.from("engagement_synthesis_generation_dispatches").select("attempt_id,expires_at,receipt_text,receipt_sha256")
      .eq("attempt_id", attempt.id).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
    const verified = verifySynthesisGenerationApiDispatchReceipt({ binding: checked.job.binding, workerId: attempt.worker_id,
      authorizationId: attempt.authorization_id, dispatch: { receiptText: dispatch.receipt_text, receiptSha256: dispatch.receipt_sha256 } });
    if (dispatch.attempt_id !== attempt.id || Date.parse(dispatch.expires_at) !== Date.parse(verified.receipt.expiresAt) ||
      Date.parse(verified.receipt.expiresAt) > Date.parse(checked.intent.expiresAt) || verified.receipt.maxOutputTokens !== checked.intent.maxOutputTokens ||
      verified.receipt.responseByteLimit !== checked.intent.responseByteLimit) differs();
    const output = outputSchema.parse(await read(service.from("engagement_synthesis_generation_outputs").select("attempt_id,capture_text,capture_sha256")
      .eq("attempt_id", attempt.id).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
    if (output.attempt_id !== attempt.id || Buffer.byteLength(output.capture_text, "utf8") > checked.intent.responseByteLimit * 8 + 65536) differs();
    const capture = verifySynthesisGenerationApiResult(checked.job.binding, { canonical: output.capture_text, sha256: output.capture_sha256 },
      { dispatchSha256: dispatch.receipt_sha256, responseByteLimit: checked.intent.responseByteLimit }).capture;
    if (capture.outcome !== "returned" || capture.outputText === null) throw new Error("Thematic predecessor has no complete original output");
    const result = processor.accept({ taskSha256: next.task.sha256, outputText: capture.outputText, finishReason: capture.finishReason });
    predecessor = { attemptId: attempt.id, selectionId: selected.id, captureSha256: output.capture_sha256, resultSha256: result.sha256 };
  }
  const next = processor.next();
  if (next.status !== "ready" || next.taskIndex !== args.taskIndex) throw new Error("Thematic task exceeds requested resources or available tasks");
  const checked = jobFor(authorized, args.taskIndex, args.attemptId, next.task.canonical);
  if (Date.parse(checked.intent.expiresAt) <= Date.now()) throw new Error("Thematic worker authorization expired");
  signal.throwIfAborted();
  return { job: checked.job, claim: { p_task_text: next.task.canonical,
    p_predecessor_attempt: predecessor?.attemptId ?? null, p_predecessor_selection: predecessor?.selectionId ?? null,
    p_predecessor_capture_sha256: predecessor?.captureSha256 ?? null, p_previous_result_sha256: next.previousResultSha256 } };
}
