import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parseChatRpcResult } from "./provider-chat-rpc";
import { providerRpcError, ProviderRequestError } from "./provider-server";
import { CHAT_LIMITS, CHAT_PROFILE, CHAT_PROJECTION, CHAT_INSTRUCTIONS, canonicalChat, chatDefinitions, chatGrantDigest, chatHash,
  chatScopeSchema, chatSelectionSchema, chatProjectionDefinition, checkChatGrant, parseChatJson, unknownChatCost, type AssistantChatAcceptedGrantV1 } from "./provider-chat-task";
import { prepareChatProjection, type ChatSession } from "./provider-chat-projection";
import { invokeReservedChatTool, retainChatToolReservation } from "./chat-tools";
import { ChatModelStepError, runChatModelStep } from "./provider-chat-worker";
import { checkChatStream, chatWireMessageSchema, type ChatWireMessage } from "./provider-chat-transport";

export async function chatSessionRpc(session: ChatSession, operation: string, turnId: string | null, payload: Record<string, unknown> = {}) {
  const { data, error } = await session.rpc("assistant_chat_session", { p_operation: operation, p_turn_id: turnId, p_payload: { canonicalPayload: canonicalChat(payload) } });
  providerRpcError(error);
  return parseChatRpcResult(data);
}
function released(value: Record<string, unknown>) {
  if (value.released === false) throw new ProviderRequestError(typeof value.failureCode === "string" ? value.failureCode : "chat_release_unavailable", 409);
  return value;
}
const admissionSelection = chatSelectionSchema.omit({ capabilityRecordId: true, capabilityRecordHash: true, chargeAcknowledgment: true, costDisclosure: true });
const admissionRecord = z.object({ workspaceId: z.string().uuid(), selection: admissionSelection, profileCanonical: z.string(), projectionCanonical: z.string(),
  catalogCanonicals: z.array(z.string()).min(1).max(4), evidence: z.object({ sourceReview: z.string().min(1), databaseEvidence: z.string().min(1),
    protocolEvidence: z.string().min(1), browserEvidence: z.string().min(1), admittedBy: z.string().uuid(), admittedAt: z.string() }).strict() }).strict();
export type ChatOption = { id: string; recordHash: string; record: z.infer<typeof admissionRecord> };
export async function loadChatOptions(session: ChatSession, workspaceId: string): Promise<ChatOption[]> {
  const response = await chatSessionRpc(session, "options", null, { workspaceId });
  const rows = z.array(z.object({ id: z.string().uuid(), recordCanonical: z.string(), recordHash: z.string() }).strict()).parse(response.admissions);
  return rows.map(row => {
    if (chatHash(row.recordCanonical) !== row.recordHash) throw new Error("chat_admission_hash_mismatch");
    const record = admissionRecord.parse(parseChatJson(row.recordCanonical));
    if (record.workspaceId !== workspaceId || record.profileCanonical !== canonicalChat(CHAT_PROFILE) || record.projectionCanonical !== canonicalChat(chatProjectionDefinition())) throw new Error("chat_admission_definition_mismatch");
    return { id: row.id, recordHash: row.recordHash, record };
  });
}
export const chatPrepareSchema = z.object({ prepareRequestId: z.string().uuid(), acceptanceRequestId: z.string().uuid(), turnRequestId: z.string().uuid(),
  scope: chatScopeSchema, question: z.string().min(1).max(2000), capabilityRecordId: z.string().uuid() }).strict();
export async function prepareChatGrant(session: ChatSession, userId: string, origin: string, raw: unknown) {
  const input = chatPrepareSchema.parse(raw), scope = { ...input.scope, selectedProjectIds: [...input.scope.selectedProjectIds].sort() };
  const existing = released(await chatSessionRpc(session, "lookup_prepare", null, { prepareRequestId: input.prepareRequestId }));
  if (existing.found === true) {
    const prior = checkChatGrant(parseChatJson(z.string().parse(existing.canonical)));
    const { dataClasses: _classes, resourceRules: _rules, projectionDefinitions: _projections, historyPolicy: _history, ...priorScope } = prior.scope;
    if (canonicalChat(priorScope) !== canonicalChat(scope) || prior.packet.question !== input.question || prior.selection.capabilityRecordId !== input.capabilityRecordId ||
      prior.acceptanceRequestId !== input.acceptanceRequestId || prior.turnRequestId !== input.turnRequestId || prior.owner.appOrigin !== origin) throw new ProviderRequestError("chat_prepare_retry_conflict", 409);
    return { released: true, canonical: existing.canonical, digest: existing.digest, turnId: prior.turnId };
  }
  const options = await loadChatOptions(session, scope.target.workspaceId), option = options.find(o => o.id === input.capabilityRecordId);
  if (!option) throw new ProviderRequestError("chat_profile_unassessed", 409);
  const definitions = chatDefinitions(scope), execution = option.record.selection.execution;
  if (execution.installationId !== process.env.OPENPLAN_INSTALLATION_ID || execution.poolId !== process.env.OPENPLAN_CHAT_POOL_ID ||
    execution.poolConfigurationRevision !== process.env.OPENPLAN_CHAT_POOL_REVISION || !option.record.catalogCanonicals.includes(definitions.catalogCanonical)) throw new ProviderRequestError("chat_execution_pool_unavailable", 503);
  const turnId = randomUUID(), now = Date.now();
  const envelopes = await prepareChatProjection(session, userId, scope, turnId);
  const selection = chatSelectionSchema.parse({ ...option.record.selection, capabilityRecordId: option.id, capabilityRecordHash: option.recordHash,
    chargeAcknowledgment: { accepted: true, acknowledgedByUserId: userId, disclosureVersion: 1,
      mode: option.record.selection.authMode === "connection_no_key" ? "keyless_unknown_operation" : "possible_unknown_charging" }, costDisclosure: unknownChatCost });
  const grant = checkChatGrant({ domain: "OpenPlan.AssistantChatGrant", version: 1, grantId: randomUUID(), turnId,
    prepareRequestId: input.prepareRequestId, acceptanceRequestId: input.acceptanceRequestId, turnRequestId: input.turnRequestId,
    owner: { userId, workspaceId: scope.target.workspaceId, installationId: execution.installationId, appOrigin: origin },
    task: { family: "assistant_chat", version: 1 }, profile: { id: CHAT_PROFILE.id, revision: 1, definitionHash: chatHash(definitions.profileCanonical),
      definitionCanonical: definitions.profileCanonical, projectionId: CHAT_PROJECTION.id, projectionRevision: 1, limits: CHAT_LIMITS },
    catalog: { revision: 1, definitionHash: chatHash(definitions.catalogCanonical), definitionCanonical: definitions.catalogCanonical, tools: definitions.tools.map(t => t.name) },
    scope: { ...scope, dataClasses: ["workspace_identity", "planner_request", ...(scope.selectedProjectIds.length ? ["selected_project_summary", "draft_submittal_intent"] : []),
      ...(scope.includeWorkspaceIndex ? ["workspace_project_index"] : [])].sort(), resourceRules: "explicit_project_ids;index_does_not_expand_scope",
      projectionDefinitions: canonicalChat(chatProjectionDefinition()), historyPolicy: "none" },
    packet: { version: 1, question: input.question, history: [], capturedAt: new Date(now).toISOString(), initialEnvelopes: envelopes }, selection,
    preparedAt: new Date(now).toISOString(), acceptBefore: new Date(now + 5 * 60000).toISOString(), expiresAt: new Date(now + 20 * 60000).toISOString() });
  const canonical = canonicalChat(grant), digest = chatGrantDigest(grant);
  return released(await chatSessionRpc(session, "prepare", turnId, { canonical, digest }));
}
const terminalSchema = z.object({ version: z.literal(1), responseId: z.string(), model: z.string(), reason: z.enum(["stop", "tool_calls"]), bodyHash: z.string(),
  responseBytes: z.number().int(), rawBody: z.string(), inputTokens: z.number().int().nullable(), outputTokens: z.number().int().nullable(), text: z.string(),
  calls: z.array(z.object({ toolCallId: z.string(), name: z.enum(["list_projects", "get_surface_context", "propose_create_project_record"]), input: z.unknown(), argumentsCanonical: z.string() }).strict()), frameCount: z.number().int() }).strict();
export const chatSnapshotSchema = z.object({ released: z.literal(true), turnId: z.string().uuid(), attemptId: z.string().uuid(), state: z.string(), revision: z.number(), cursor: z.number(),
  leaseExpiresAt: z.string().nullable(), canonical: z.string(), digest: z.string(), modelSteps: z.number().int(), usageUnknown: z.boolean(), reportedOutputTokens: z.number(), responseBytes: z.number(),
  events: z.array(z.object({ sequence: z.number(), kind: z.string(), body: z.unknown(), body_hash: z.string(), previous_hash: z.string().nullable() }).passthrough()),
  steps: z.array(z.object({ id: z.string().uuid(), sequence: z.number(), state: z.string(), receipt: terminalSchema.nullable(), receipt_hash: z.string().nullable() }).passthrough()),
  calls: z.array(z.object({ id: z.string().uuid(), step_id: z.string().uuid(), call_id: z.string(), name: z.string(), state: z.string(), input: z.unknown(), result: z.unknown().nullable(), result_hash: z.string().nullable() }).passthrough()),
  sources: z.array(z.unknown()), intents: z.array(z.record(z.string(), z.unknown())) }).strict();
export type ChatSnapshot = z.infer<typeof chatSnapshotSchema>;
export async function readChatSnapshot(session: ChatSession, turnId: string, afterSequence = 0) {
  const raw = released(await chatSessionRpc(session, "read", turnId, { afterSequence })), snapshot = chatSnapshotSchema.parse(raw);
  const grant = checkChatGrant(parseChatJson(snapshot.canonical));
  if (grant.turnId !== snapshot.turnId || chatGrantDigest(grant) !== snapshot.digest) throw new Error("chat_retained_grant_mismatch");
  for (const step of snapshot.steps) if (step.receipt && (chatHash(canonicalChat(step.receipt)) !== step.receipt_hash ||
    canonicalChat(checkChatStream(step.receipt.rawBody, grant.selection.modelId, grant.catalog.tools)) !== canonicalChat(step.receipt))) throw new Error("chat_retained_terminal_mismatch");
  return { snapshot, grant };
}
export function chatTranscript(grant: AssistantChatAcceptedGrantV1, snapshot: ChatSnapshot): ChatWireMessage[] {
  const messages: ChatWireMessage[] = [{ role: "system", content: CHAT_INSTRUCTIONS }, { role: "user", content: canonicalChat({ question: grant.packet.question,
    target: grant.scope.target, history: [], sources: grant.packet.initialEnvelopes.map(e => ({ envelopeId: e.envelopeId, dataClass: e.dataClass,
      capturedAt: e.capturedAt, content: parseChatJson(e.canonicalProjectedContent), omissions: e.omissions, truncation: e.truncation })) }) }];
  for (const step of [...snapshot.steps].sort((a, b) => a.sequence - b.sequence)) {
    if (step.state !== "completed" || !step.receipt) throw new Error("chat_prior_step_uncertain");
    const receipt = step.receipt;
    messages.push({ role: "assistant", content: receipt.text || null, ...(receipt.calls.length ? { tool_calls: receipt.calls.map(c => ({ id: c.toolCallId,
      type: "function" as const, function: { name: c.name, arguments: c.argumentsCanonical } })) } : {}) });
    for (const call of receipt.calls) {
      const retained = snapshot.calls.find(c => c.step_id === step.id && c.call_id === call.toolCallId);
      if (!retained || retained.state !== "completed" || !retained.result || chatHash(canonicalChat(retained.result)) !== retained.result_hash) throw new Error("chat_tool_result_uncertain");
      messages.push({ role: "tool", tool_call_id: call.toolCallId, content: canonicalChat(retained.result) });
    }
  }
  return z.array(chatWireMessageSchema).parse(messages);
}

// A drive is a fresh start of one accepted turn. Reconnects call GET/read only.
// A duplicate start returns retained status and cannot dispatch a model again.
export async function driveChatTurn(session: ChatSession, userId: string, turnId: string, signal: AbortSignal) {
  const started = await chatSessionRpc(session, "start", turnId);
  if (started.started !== true) return chatSessionRpc(session, "metadata", turnId);
  const cancelled = new AbortController(), combined = AbortSignal.any([signal, cancelled.signal]);
  let watching = true, timer: ReturnType<typeof setTimeout> | undefined;
  const watch = async () => {
    try { const current = await chatSessionRpc(session, "metadata", turnId); if (current.state !== "running") cancelled.abort(); }
    catch { cancelled.abort(); }
    if (watching && !combined.aborted) timer = setTimeout(() => { void watch(); }, 2000);
  };
  try {
    await watch();
    for (let sequence = 1; sequence <= CHAT_LIMITS.modelSteps; sequence++) {
      combined.throwIfAborted();
      const { snapshot, grant } = await readChatSnapshot(session, turnId);
      if (snapshot.state !== "running" || !snapshot.leaseExpiresAt || grant.owner.userId !== userId) throw new Error("chat_turn_not_running");
      const stepId = randomUUID(), messages = chatTranscript(grant, snapshot);
      const result = await runChatModelStep({ grant, expectedGrantDigest: snapshot.digest, messages, leaseExpiresAt: snapshot.leaseExpiresAt, signal: combined,
        authorize: async body => { released(await chatSessionRpc(session, "dispatch", turnId, { digest: snapshot.digest, stepId, sequence, request: body, bodyHash: chatHash(body) })); },
        onProgress: async (frameSequence, text) => { released(await chatSessionRpc(session, "progress", turnId, { digest: snapshot.digest, stepId, frameSequence, text, bodyHash: chatHash(text) })); } });
      released(await chatSessionRpc(session, "finish_step", turnId, { digest: snapshot.digest, stepId, receipt: result.receipt, receiptHash: result.receiptHash, bodyHash: result.receiptHash }));
      if (result.receipt.reason === "stop" || sequence === CHAT_LIMITS.modelSteps) break;
      const pending = await readChatSnapshot(session, turnId);
      for (const call of result.receipt.calls) {
        combined.throwIfAborted();
        const retained = pending.snapshot.calls.find(c => c.step_id === stepId && c.call_id === call.toolCallId);
        if (!retained) throw new Error("chat_tool_not_retained");
        const claimed = released(await chatSessionRpc(session, "claim_tool", turnId, { callId: retained.id, digest: snapshot.digest }));
        if (claimed.cached === true) continue;
        const reservation = retainChatToolReservation(claimed);
        const completed = await invokeReservedChatTool({ session, userId, grant, reservation });
        released(await chatSessionRpc(session, "finish_tool", turnId, { digest: snapshot.digest, callId: retained.id, handle: reservation.handle,
          result: completed.result, envelopes: completed.envelopes, ...("executableCanonical" in completed ? { executableCanonical: completed.executableCanonical } : {}), bodyHash: chatHash(canonicalChat(completed.result)) }));
      }
    }
    return await chatSessionRpc(session, "metadata", turnId);
  } catch (error) {
    // Never retry a consumed model/tool or repair output. A failed access RPC
    // cannot authorize this transition; minimal metadata remains recoverable.
    try { await chatSessionRpc(session, "interrupt", turnId, error instanceof ChatModelStepError ? { state: error.state, failureCode: error.code } :
      { state: "uncertain", failureCode: "chat_broker_or_delivery_uncertain" }); } catch { /* lease retirement preserves uncertainty */ }
    return chatSessionRpc(session, "metadata", turnId);
  } finally { watching = false; if (timer) clearTimeout(timer); cancelled.abort(); }
}

export function chatOwnerView(snapshot: ChatSnapshot, grant: AssistantChatAcceptedGrantV1) {
  return { turnId: snapshot.turnId, state: snapshot.state, cursor: snapshot.events.at(-1)?.sequence ?? snapshot.cursor, digest: snapshot.digest, modelSteps: snapshot.modelSteps,
    usageUnknown: snapshot.usageUnknown || snapshot.steps.length === 0 || snapshot.steps.some(s => s.state !== "completed"),
    checkedResponses: snapshot.steps.filter(s => s.state === "completed").length, unconfirmedReservations: snapshot.steps.filter(s => s.state !== "completed").length,
    reportedOutputTokens: snapshot.reportedOutputTokens, responseBytes: snapshot.responseBytes,
    events: snapshot.events.map(e => ({ sequence: e.sequence, kind: e.kind, body: e.body, bodyHash: e.body_hash, previousHash: e.previous_hash })),
    texts: snapshot.steps.filter(s => s.receipt).map(s => ({ stepId: s.id, text: s.receipt!.text, terminal: s.receipt!.reason, receiptHash: s.receipt_hash })),
    intents: snapshot.intents.map(i => ({ intentId: i.id, state: i.state, executionState: i.execution_state, receiptState: i.receipt_state,
      executableHash: i.executable_hash, originalApprovalId: i.original_approval_id, recoveryHref: i.recovery_href })),
    question: grant.packet.question, capturedAt: grant.packet.capturedAt, complete: snapshot.state === "succeeded" && snapshot.steps.at(-1)?.receipt?.reason === "stop" };
}
