import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadSynthesisThematicHistoryInputs, recheckSynthesisThematicHistoryAccess } from "./synthesis-thematic-history-inputs";
import { loadSynthesisThematicScheduleAuthority } from "./synthesis-thematic-worker-authority";
import { replaySynthesisThematicContinuation } from "./synthesis-thematic-continuation";
import { SynthesisThematicOutputError } from "./synthesis-thematic-proposal";
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
type Status = "unselected" | "cleared" | "claimed" | "awaiting_output" | "provider_incomplete" | "invalid_output"
  | "predecessor_changed" | "blocked_by_predecessor" | "resource_limit" | "verified";
type Selection = { receiptText: string; receiptSha256: string; receipt: z.infer<typeof receiptSchema> };
type Entry = { taskIndex: number; selection: Selection | null; status: Status; attemptId: string | null; authorizationId: string | null;
  taskSha256: string | null; dispatchSha256: string | null; captureSha256: string | null; resultSha256: string | null;
  capture: ReturnType<typeof verifySynthesisGenerationApiResult> | null; result: { canonical: string; sha256: string } | null };
const differs = (): never => { throw new Error("Historical thematic execution differs from retained originals"); };

/** Inspect selected originals as the current staff member, including a cancelled
 * or departed requester's work. Capture authenticity is checked for every chosen
 * attempt, even beyond a broken continuation. Only a complete replay can become
 * a machine proposal for explicit staff review. No selection write or dispatch runs.
 */
export async function loadSynthesisThematicHistory(client: Pick<SupabaseClient, "rpc">,
  service: Pick<SupabaseClient, "from" | "rpc">, rawScope: z.infer<typeof scopeSchema>, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const args = scopeSchema.parse(rawScope), scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const inputs = await loadSynthesisThematicHistoryInputs(client, service, scope, signal);
  if (inputs.preparationStatus === "inputs_not_sealed") {
    const manifest = { schemaVersion: 1, purpose: "private_synthesis_thematic_history", ...scope,
      thematicRequestSha256: inputs.request.state.thematic.thematicSha256, headerSha256: null,
      throughSequence: null, status: "inputs_not_sealed" as const, storedFrameCount: 0, verifiedTaskCount: 0, entries: [] };
    const canonical = JSON.stringify(manifest);
    return { request: inputs.request, plan: null, entries: [], manifest, canonical, sha256: digest(canonical),
      resourceAssessment: null, interpretation: "machine_unreviewed" as const, finalOutputText: null, proposal: null };
  }
  return replaySynthesisThematicHistory(service, args, inputs, async (throughSequence, afterTaskIndex) => {
    return await client.rpc("read_engagement_synthesis_generation_selection_history", { p_campaign: scope.campaignId,
      p_request: scope.requestId, p_through_sequence: throughSequence, p_after_task_index: afterTaskIndex, p_limit: 128 })
      .abortSignal(synthesisWorkerRequestSignal(signal));
  }, () => recheckSynthesisThematicHistoryAccess(client, inputs.request, scope, signal), signal);
}

/** Internal historical replay after explicit native scope has been established.
 * Current staff access and historical pagination remain separate from execution.
 * Every selected capture is authenticated before continuation and proposal checks.
 */
async function replaySynthesisThematicHistory(service: Pick<SupabaseClient, "from" | "rpc">,
  rawScope: z.infer<typeof scopeSchema>, inputs: Exclude<Awaited<ReturnType<typeof loadSynthesisThematicHistoryInputs>>, { preparationStatus: "inputs_not_sealed" }>,
  readPage: (throughSequence: number | null, afterTaskIndex: number) => Promise<{ data: unknown; error: unknown }>,
  recheck: () => Promise<typeof inputs.request>, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const args = scopeSchema.parse(rawScope), scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const { plan, request } = inputs;
  const entries: Entry[] = [], selections = new Map<number, Selection>();
  let throughSequence: number | null = inputs.preparationStatus === "sealed" ? args.throughSequence ?? null : null;
  if (inputs.preparationStatus === "sealed") {
    let afterTaskIndex = -1;
    const seenIds = new Set<string>(), seenSequences = new Set<number>(), seenAttempts = new Set<string>();
    for (;;) {
      signal.throwIfAborted();
      const response = await readPage(throughSequence, afterTaskIndex);
      signal.throwIfAborted();
      if (response.error) throw new Error("Historical thematic selections unavailable");
      const page = pageSchema.parse(response.data);
      if (page.requestId !== scope.requestId || page.afterTaskIndex !== afterTaskIndex ||
        (throughSequence !== null && page.throughSequence !== throughSequence) || (page.hasMore && page.entries.length === 0)) differs();
      throughSequence ??= page.throughSequence;
      for (const original of page.entries) {
        if (Buffer.byteLength(original.receiptText, "utf8") > 32768 || digest(original.receiptText) !== original.receiptSha256) differs();
        const receipt = receiptSchema.parse(JSON.parse(original.receiptText));
        if (receipt.requestId !== scope.requestId || receipt.actorId !== request.state.request.actorId || receipt.taskIndex <= afterTaskIndex ||
          receipt.taskIndex >= plan.header.taskCount || receipt.sequence > throughSequence || seenIds.has(receipt.id) || seenSequences.has(receipt.sequence) ||
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
  async function row(kind: "attempt" | "input" | "dispatch" | "output", value: string) {
    signal.throwIfAborted();
    const queries = {
      attempt: () => service.from("engagement_synthesis_generation_attempts").select("id,request_id,authorization_id,task_index,previous_attempt_id,worker_id,binding_text").eq("id", value),
      input: () => service.from("engagement_synthesis_thematic_attempt_inputs").select("attempt_id,task_text,task_sha256,task_bytes,predecessor_attempt_id,predecessor_selection_id,predecessor_capture_sha256,previous_result_sha256").eq("attempt_id", value),
      dispatch: () => service.from("engagement_synthesis_generation_dispatches").select("attempt_id,expires_at,receipt_text,receipt_sha256").eq("attempt_id", value),
      output: () => service.from("engagement_synthesis_generation_outputs").select("attempt_id,capture_text,capture_sha256").eq("attempt_id", value),
    };
    const response = await queries[kind]().abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle();
    signal.throwIfAborted();
    if (response.error) throw new Error("Historical thematic execution unavailable");
    return response.data;
  }
  const grants = new Map<string, Awaited<ReturnType<typeof loadSynthesisThematicScheduleAuthority>>>();
  const processor = replaySynthesisThematicContinuation(inputs.prepared);
  let predecessor: { attemptId: string; selectionId: string; captureSha256: string; resultSha256: string } | null = null;
  let replayed = 0;
  for (let taskIndex = 0; taskIndex < plan.header.taskCount; taskIndex++) {
    const selected = selections.get(taskIndex) ?? null;
    const entry: Entry = { taskIndex: taskIndex, selection: selected, status: selected ? "cleared" : "unselected",
      attemptId: selected?.receipt.attemptId ?? null, authorizationId: null, taskSha256: null, dispatchSha256: null, captureSha256: null,
      resultSha256: null, capture: null, result: null };
    entries.push(entry);
    if (entry.attemptId === null) continue;
    const attempt = attemptSchema.parse(await row("attempt", entry.attemptId));
    if (attempt.id !== entry.attemptId || attempt.request_id !== scope.requestId || attempt.task_index !== taskIndex ||
      (selected!.receipt.origin === "authorization" && selected!.receipt.authorizationId !== attempt.authorization_id)) differs();
    let authority = grants.get(attempt.authorization_id);
    if (!authority) {
      authority = await loadSynthesisThematicScheduleAuthority(service, attempt.authorization_id, signal);
      grants.set(attempt.authorization_id, authority);
    }
    if (!isDeepStrictEqual(authority.scope, scope) || authority.headerText !== plan.headerText ||
      authority.authorization.retryOfAttemptId !== attempt.previous_attempt_id) differs();
    const input = inputSchema.parse(await row("input", attempt.id));
    const bytes = Buffer.byteLength(input.task_text, "utf8");
    if (input.attempt_id !== attempt.id || digest(input.task_text) !== input.task_sha256 || bytes !== input.task_bytes || bytes > request.intent.taskByteLimit) differs();
    const predecessors = [input.predecessor_attempt_id, input.predecessor_selection_id, input.predecessor_capture_sha256, input.previous_result_sha256];
    if (taskIndex === 0 ? predecessors.some(value => value !== null) : predecessors.some(value => value === null)) differs();
    const checked = checkedSynthesisWorkerJob({ binding: { jobId: scope.requestId, planSha256: plan.continuation.headerSha256,
      configurationRevisionId: request.intent.configurationRevisionId, configurationHash: request.intent.configurationHash,
      provider: "api_connection", modelId: request.intent.modelId, taskSha256: input.task_sha256, attemptId: attempt.id },
      workspaceId: scope.workspaceId, campaignId: scope.campaignId, actorId: request.state.request.actorId, connectionId: request.intent.connectionId,
      headerSha256: plan.headerSha256, authorizationId: authority.grant.id, authorizationIntentText: authority.grant.intent_text,
      authorizationIntentSha256: authority.grant.intent_sha256, credentialSha256: authority.grant.credential_sha256, taskIndex: taskIndex, taskCanonical: input.task_text });
    if (!isDeepStrictEqual(JSON.parse(attempt.binding_text), checked.job.binding)) differs();
    entry.authorizationId = attempt.authorization_id; entry.taskSha256 = input.task_sha256;
    let rawDispatch = await row("dispatch", attempt.id);
    const rawOutput = await row("output", attempt.id);
    // Dispatch and output can commit between these independent reads. An
    // observed output must have its immutable dispatch by the subsequent read.
    if (rawDispatch === null && rawOutput !== null) rawDispatch = await row("dispatch", attempt.id);
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
    if (replayed !== taskIndex) { entry.status = "blocked_by_predecessor"; continue; }
    if (input.predecessor_attempt_id !== (predecessor?.attemptId ?? null) || input.predecessor_selection_id !== (predecessor?.selectionId ?? null) ||
      input.predecessor_capture_sha256 !== (predecessor?.captureSha256 ?? null) || input.previous_result_sha256 !== (predecessor?.resultSha256 ?? null)) {
      entry.status = "predecessor_changed"; continue;
    }
    const next = processor.next();
    if (next.status === "resource_limit") { entry.status = "resource_limit"; continue; }
    if (next.status !== "ready" || next.taskIndex !== taskIndex || next.task.canonical !== input.task_text) return differs();
    try {
      entry.result = processor.accept({ taskSha256: next.task.sha256, outputText: entry.capture.capture.outputText, finishReason: entry.capture.capture.finishReason });
    } catch (error) {
      if (!(error instanceof SynthesisThematicOutputError)) throw error;
      entry.status = "invalid_output"; continue;
    }
    entry.status = "verified"; entry.resultSha256 = entry.result.sha256; replayed++;
    predecessor = { attemptId: attempt.id, selectionId: selected!.receipt.id, captureSha256: output.capture_sha256, resultSha256: entry.result.sha256 };
  }
  // Assess only the next task after the verified replay prefix. This is a
  // resource measurement, separate from selections, attempts and worker liveness.
  const nextResourceTask = inputs.preparationStatus === "sealed" ? processor.next() : null;
  const resourceAssessment = nextResourceTask?.status === "resource_limit"
    ? { taskIndex: nextResourceTask.taskIndex, requiredTaskBytes: nextResourceTask.requiredTaskBytes,
      taskByteLimit: nextResourceTask.taskByteLimit } : null;
  const current = await recheck();
  const status = inputs.preparationStatus !== "sealed" ? inputs.preparationStatus : replayed === plan.header.taskCount ? "proposal_complete" : "incomplete";
  const manifest = { schemaVersion: 1, purpose: "private_synthesis_thematic_history", ...scope, thematicRequestSha256: request.state.thematic.thematicSha256,
    headerSha256: plan.headerSha256, throughSequence, status, storedFrameCount: inputs.storedFrameCount, verifiedTaskCount: replayed,
    entries: entries.map(({ taskIndex, selection, status, attemptId, authorizationId, taskSha256, dispatchSha256, captureSha256, resultSha256 }) => ({
      taskIndex, selectionSha256: selection?.receiptSha256 ?? null, status, attemptId, authorizationId, taskSha256, dispatchSha256, captureSha256, resultSha256 })) };
  const completion = processor.next();
  if (status === "proposal_complete" && completion.status !== "proposal_complete") return differs();
  const canonical = JSON.stringify(manifest);
  return { request: current, plan, entries, manifest, canonical, sha256: digest(canonical), resourceAssessment,
    interpretation: "machine_unreviewed" as const, finalOutputText: status === "proposal_complete" ? entries.at(-1)!.capture!.capture.outputText : null,
    proposal: status === "proposal_complete" && completion.status === "proposal_complete" ? completion.proposal : null };
}
