import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadSynthesisContextHistoryInputs, recheckSynthesisContextHistoryAccess } from "./synthesis-context-history-inputs";
import { loadSynthesisContextScheduleAuthority } from "./synthesis-context-worker-authority";
import { createSynthesisContextContinuation, SynthesisContextOutputError } from "./synthesis-context-continuation";
import { checkedSynthesisWorkerJob, synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";
import { verifySynthesisGenerationApiDispatchReceipt } from "./synthesis-generation-api";
import { verifySynthesisGenerationApiResult } from "./synthesis-generation-api-result";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const date = z.string().datetime({ offset: true });
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id, throughSequence: natural.optional() }).strict();
const receiptSchema = z.object({ schemaVersion: z.literal(1), id, requestId: id, taskIndex: natural, attemptId: id.nullable(),
  previousSelectionId: id.nullable(), sequence: natural.positive(), actorId: id, origin: z.enum(["authorization", "staff"]),
  authorizationId: id.nullable(), reason: z.string().min(1).refine(text => Array.from(text).length <= 4000 && text.trim().length > 0), selectedAt: date }).strict();
const pageSchema = z.object({ schemaVersion: z.literal(1), requestId: id, throughSequence: natural,
  afterTaskIndex: z.number().int().min(-1).safe(), hasMore: z.boolean(),
  entries: z.array(z.object({ receiptText: z.string().max(32768), receiptSha256: hash }).strict()).max(128) }).strict();
const attemptSchema = z.object({ id, request_id: id, authorization_id: id, task_index: natural, previous_attempt_id: id.nullable(), worker_id: id,
  binding_text: z.string().max(4096) }).strict();
const inputSchema = z.object({ attempt_id: id, task_text: z.string().max(1048576), task_sha256: hash, task_bytes: natural,
  predecessor_attempt_id: id.nullable(), predecessor_selection_id: id.nullable(), predecessor_capture_sha256: hash.nullable(), previous_result_sha256: hash.nullable() }).strict();
const dispatchSchema = z.object({ attempt_id: id, expires_at: date, receipt_text: z.string().max(16384), receipt_sha256: hash }).strict();
const outputSchema = z.object({ attempt_id: id, capture_text: z.string().max(33619968), capture_sha256: hash }).strict();
const columns = {
  attempt: "id,request_id,authorization_id,task_index,previous_attempt_id,worker_id,binding_text",
  input: "attempt_id,task_text,task_sha256,task_bytes,predecessor_attempt_id,predecessor_selection_id,predecessor_capture_sha256,previous_result_sha256",
  dispatch: "attempt_id,expires_at,receipt_text,receipt_sha256", output: "attempt_id,capture_text,capture_sha256",
} as const;
type Status = "unselected" | "cleared" | "claimed" | "awaiting_output" | "provider_incomplete" | "invalid_output"
  | "predecessor_changed" | "blocked_by_predecessor" | "resource_limit" | "verified";
type Selection = { receiptText: string; receiptSha256: string; receipt: z.infer<typeof receiptSchema> };
type Entry = { frameIndex: number; selection: Selection | null; status: Status; attemptId: string | null; authorizationId: string | null;
  taskSha256: string | null; dispatchSha256: string | null; captureSha256: string | null; resultSha256: string | null;
  capture: ReturnType<typeof verifySynthesisGenerationApiResult> | null; result: { canonical: string; sha256: string } | null };
const differs = (): never => { throw new Error("Historical context execution differs from retained originals"); };

/** Inspect selected originals as the current staff member, including a cancelled
 * or departed requester's work. Capture authenticity is checked for every chosen
 * attempt, even beyond a broken continuation. Only a complete replay can become
 * contextual input for later thematic work. No selection write or dispatch runs.
 */
export async function loadSynthesisContextHistory(client: Pick<SupabaseClient, "rpc">,
  service: Pick<SupabaseClient, "from" | "rpc">, rawScope: z.infer<typeof scopeSchema>, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const args = scopeSchema.parse(rawScope), scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const inputs = await loadSynthesisContextHistoryInputs(client, service, scope, signal);
  return replaySynthesisContextHistory(service, args, inputs, async (throughSequence, afterTaskIndex) => {
    return await client.rpc("read_engagement_synthesis_generation_selection_history", { p_campaign: scope.campaignId,
      p_request: scope.requestId, p_through_sequence: throughSequence, p_after_task_index: afterTaskIndex, p_limit: 128 })
      .abortSignal(synthesisWorkerRequestSignal(signal));
  }, () => recheckSynthesisContextHistoryAccess(client, inputs.request, scope, signal), signal);
}

/** Internal historical replay after explicit native scope has been established.
 * Both callers retain separate access and pagination functions. Provider bytes,
 * task reconstruction and predecessor checks use the same implementation.
 */
export async function replaySynthesisContextHistory(service: Pick<SupabaseClient, "from" | "rpc">,
  rawScope: z.infer<typeof scopeSchema>, inputs: Awaited<ReturnType<typeof loadSynthesisContextHistoryInputs>>,
  readPage: (throughSequence: number | null, afterTaskIndex: number) => Promise<{ data: unknown; error: unknown }>,
  recheck: () => Promise<typeof inputs.request>, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const args = scopeSchema.parse(rawScope), scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const { plan, request } = inputs;
  const entries: Entry[] = [], selections = new Map<number, Selection>();
  let throughSequence: number | null = args.throughSequence ?? null;
  if (inputs.preparationStatus === "sealed") {
    let afterTaskIndex = -1;
    const seenIds = new Set<string>(), seenSequences = new Set<number>(), seenAttempts = new Set<string>();
    for (;;) {
      signal.throwIfAborted();
      const response = await readPage(throughSequence, afterTaskIndex);
      signal.throwIfAborted();
      if (response.error) throw new Error("Historical context selections unavailable");
      const page = pageSchema.parse(response.data);
      if (page.requestId !== scope.requestId || page.afterTaskIndex !== afterTaskIndex ||
        (throughSequence !== null && page.throughSequence !== throughSequence) || (page.hasMore && page.entries.length === 0)) differs();
      throughSequence ??= page.throughSequence;
      for (const original of page.entries) {
        if (Buffer.byteLength(original.receiptText, "utf8") > 32768 || digest(original.receiptText) !== original.receiptSha256) differs();
        const receipt = receiptSchema.parse(JSON.parse(original.receiptText));
        if (receipt.requestId !== scope.requestId || receipt.actorId !== request.state.request.actorId || receipt.taskIndex <= afterTaskIndex ||
          receipt.taskIndex >= plan.entries.length || receipt.sequence > throughSequence || seenIds.has(receipt.id) || seenSequences.has(receipt.sequence) ||
          (receipt.attemptId !== null && seenAttempts.has(receipt.attemptId))) differs();
        if (receipt.origin === "authorization" ? receipt.authorizationId === null || receipt.previousSelectionId !== null || receipt.attemptId === null
          : receipt.authorizationId !== null) differs();
        seenIds.add(receipt.id); seenSequences.add(receipt.sequence);
        if (receipt.attemptId !== null) seenAttempts.add(receipt.attemptId);
        selections.set(receipt.taskIndex, { ...original, receipt }); afterTaskIndex = receipt.taskIndex;
      }
      if (!page.hasMore) break;
    }
    if (throughSequence > 0 && selections.size === 0) differs();
  }
  async function row(table: string, projection: string, key: string, value: string) {
    signal.throwIfAborted();
    const response = await service.from(table).select(projection).eq(key, value)
      .abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle();
    signal.throwIfAborted();
    if (response.error) throw new Error("Historical context execution unavailable");
    return response.data;
  }
  const grants = new Map<string, Awaited<ReturnType<typeof loadSynthesisContextScheduleAuthority>>>();
  const processor = createSynthesisContextContinuation(request.state, scope, inputs.contentArgs);
  let predecessor: { attemptId: string; selectionId: string; captureSha256: string; resultSha256: string } | null = null;
  let replayed = 0;
  for (const frame of plan.entries) {
    const selected = selections.get(frame.index) ?? null;
    const entry: Entry = { frameIndex: frame.index, selection: selected, status: selected ? "cleared" : "unselected",
      attemptId: selected?.receipt.attemptId ?? null, authorizationId: null, taskSha256: null, dispatchSha256: null, captureSha256: null,
      resultSha256: null, capture: null, result: null };
    entries.push(entry);
    if (entry.attemptId === null) continue;
    const attempt = attemptSchema.parse(await row("engagement_synthesis_generation_attempts", columns.attempt, "id", entry.attemptId));
    if (attempt.id !== entry.attemptId || attempt.request_id !== scope.requestId || attempt.task_index !== frame.index ||
      (selected!.receipt.origin === "authorization" && selected!.receipt.authorizationId !== attempt.authorization_id)) differs();
    let authority = grants.get(attempt.authorization_id);
    if (!authority) {
      authority = await loadSynthesisContextScheduleAuthority(service, attempt.authorization_id, signal);
      grants.set(attempt.authorization_id, authority);
    }
    if (!isDeepStrictEqual(authority.scope, scope) || authority.headerText !== plan.headerText ||
      authority.authorization.retryOfAttemptId !== attempt.previous_attempt_id) differs();
    const input = inputSchema.parse(await row("engagement_synthesis_context_attempt_inputs", columns.input, "attempt_id", attempt.id));
    const bytes = Buffer.byteLength(input.task_text, "utf8");
    if (input.attempt_id !== attempt.id || digest(input.task_text) !== input.task_sha256 || bytes !== input.task_bytes || bytes > request.intent.taskByteLimit) differs();
    const predecessors = [input.predecessor_attempt_id, input.predecessor_selection_id, input.predecessor_capture_sha256, input.previous_result_sha256];
    if (frame.index === 0 ? predecessors.some(value => value !== null) : predecessors.some(value => value === null)) differs();
    const checked = checkedSynthesisWorkerJob({ binding: { jobId: scope.requestId, planSha256: plan.continuation.headerSha256,
      configurationRevisionId: request.intent.configurationRevisionId, configurationHash: request.intent.configurationHash,
      provider: "api_connection", modelId: request.intent.modelId, taskSha256: input.task_sha256, attemptId: attempt.id },
      workspaceId: scope.workspaceId, campaignId: scope.campaignId, actorId: request.state.request.actorId, connectionId: request.intent.connectionId,
      headerSha256: plan.headerSha256, authorizationId: authority.grant.id, authorizationIntentText: authority.grant.intent_text,
      authorizationIntentSha256: authority.grant.intent_sha256, credentialSha256: authority.grant.credential_sha256, taskIndex: frame.index, taskCanonical: input.task_text });
    if (!isDeepStrictEqual(JSON.parse(attempt.binding_text), checked.job.binding)) differs();
    entry.authorizationId = attempt.authorization_id; entry.taskSha256 = input.task_sha256;
    let rawDispatch = await row("engagement_synthesis_generation_dispatches", columns.dispatch, "attempt_id", attempt.id);
    const rawOutput = await row("engagement_synthesis_generation_outputs", columns.output, "attempt_id", attempt.id);
    // Dispatch and output can commit between these independent reads. An
    // observed output must have its immutable dispatch by the subsequent read.
    if (rawDispatch === null && rawOutput !== null) rawDispatch = await row("engagement_synthesis_generation_dispatches", columns.dispatch, "attempt_id", attempt.id);
    if (rawDispatch === null) {
      if (rawOutput !== null) differs();
      entry.status = "claimed"; continue;
    }
    const dispatch = dispatchSchema.parse(rawDispatch);
    const verified = verifySynthesisGenerationApiDispatchReceipt({ binding: checked.job.binding, workerId: attempt.worker_id,
      authorizationId: attempt.authorization_id, dispatch: { receiptText: dispatch.receipt_text, receiptSha256: dispatch.receipt_sha256 } });
    if (dispatch.attempt_id !== attempt.id || Date.parse(dispatch.expires_at) !== Date.parse(verified.receipt.expiresAt) ||
      Date.parse(verified.receipt.expiresAt) > Date.parse(checked.intent.expiresAt) || verified.receipt.maxOutputTokens !== checked.intent.maxOutputTokens ||
      verified.receipt.responseByteLimit !== checked.intent.responseByteLimit) differs();
    entry.dispatchSha256 = dispatch.receipt_sha256;
    if (rawOutput === null) { entry.status = "awaiting_output"; continue; }
    const output = outputSchema.parse(rawOutput);
    if (output.attempt_id !== attempt.id || Buffer.byteLength(output.capture_text, "utf8") > checked.intent.responseByteLimit * 8 + 65536) differs();
    entry.capture = verifySynthesisGenerationApiResult(checked.job.binding, { canonical: output.capture_text, sha256: output.capture_sha256 },
      { dispatchSha256: dispatch.receipt_sha256, responseByteLimit: checked.intent.responseByteLimit });
    entry.captureSha256 = output.capture_sha256;
    if (entry.capture.capture.outcome !== "returned" || entry.capture.capture.outputText === null) { entry.status = "provider_incomplete"; continue; }
    if (replayed !== frame.index) { entry.status = "blocked_by_predecessor"; continue; }
    if (input.predecessor_attempt_id !== (predecessor?.attemptId ?? null) || input.predecessor_selection_id !== (predecessor?.selectionId ?? null) ||
      input.predecessor_capture_sha256 !== (predecessor?.captureSha256 ?? null) || input.previous_result_sha256 !== (predecessor?.resultSha256 ?? null)) {
      entry.status = "predecessor_changed"; continue;
    }
    const next = processor.next();
    if (next.status === "resource_limit") { entry.status = "resource_limit"; continue; }
    if (next.status !== "ready" || next.frameIndex !== frame.index || next.task.canonical !== input.task_text) return differs();
    try {
      entry.result = processor.accept({ taskSha256: next.task.sha256, outputText: entry.capture.capture.outputText, finishReason: entry.capture.capture.finishReason });
    } catch (error) {
      if (!(error instanceof SynthesisContextOutputError)) throw error;
      entry.status = "invalid_output"; continue;
    }
    entry.status = "verified"; entry.resultSha256 = entry.result.sha256; replayed++;
    predecessor = { attemptId: attempt.id, selectionId: selected!.receipt.id, captureSha256: output.capture_sha256, resultSha256: entry.result.sha256 };
  }
  const current = await recheck();
  const status = inputs.preparationStatus !== "sealed" ? inputs.preparationStatus : replayed === plan.entries.length ? "frames_complete" : "incomplete";
  const manifest = { schemaVersion: 1, purpose: "private_synthesis_context_history", ...scope, contextRequestSha256: request.state.context.contextSha256,
    headerSha256: plan.headerSha256, throughSequence, status, storedFrameCount: inputs.storedFrameCount, verifiedFrameCount: replayed,
    entries: entries.map(({ frameIndex, selection, status, attemptId, authorizationId, taskSha256, dispatchSha256, captureSha256, resultSha256 }) => ({
      frameIndex, selectionSha256: selection?.receiptSha256 ?? null, status, attemptId, authorizationId, taskSha256, dispatchSha256, captureSha256, resultSha256 })) };
  const canonical = JSON.stringify(manifest);
  return { request: current, plan, entries, manifest, canonical, sha256: digest(canonical),
    interpretation: "machine_unreviewed" as const, finalOutputText: status === "frames_complete" ? entries.at(-1)!.capture!.capture.outputText : null };
}
