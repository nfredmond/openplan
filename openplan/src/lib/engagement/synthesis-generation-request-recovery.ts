import { z } from "zod";
import { synthesisGenerationRequestIntentSchema, synthesisGenerationCancellationReceiptSchema } from "./synthesis-generation-request-records";
import { inspectSynthesisGenerationRequest } from "./synthesis-generation-request-browser";
import { synthesisContinuationCommandSchema, synthesisContinuationProposalSchema, type SynthesisContinuationProposal } from "./synthesis-continuation-records";
import { inspectSynthesisContinuation } from "./synthesis-continuation-browser";
import type { ReviewStorage } from "./synthesis-review-recovery";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.object({ userId: id, workspaceId: id, campaignId: id, sourceId: id, sourceSha256: hash }).strict();
const operationSchema = z.enum(["create", "cancel", "continue"]);
const intentTextSchema = z.string().max(4096).refine(text => new TextEncoder().encode(text).byteLength <= 4096, "Generation intent exceeds 4096 bytes");
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), requestId: id, intentText: intentTextSchema }).strict(),
  z.object({ operation: z.literal("continue"), requestId: id, intentText: intentTextSchema, continuation: synthesisContinuationProposalSchema }).strict(),
  z.object({ operation: z.literal("cancel"), requestId: id, cancellationId: id,
    reason: synthesisGenerationCancellationReceiptSchema.shape.reason }).strict(),
]);
const pendingSchema = scopeSchema.extend({ version: z.literal(1), intentText: intentTextSchema, command: commandSchema }).strict().superRefine((value, ctx) => {
  let raw: unknown;
  try { raw = JSON.parse(value.intentText); } catch { ctx.addIssue({ code: "custom", message: "Generation intent is unreadable" }); return; }
  const parsed = synthesisGenerationRequestIntentSchema.safeParse(raw);
  if (!parsed.success || parsed.data.sourceId !== value.sourceId || parsed.data.sourceSha256 !== value.sourceSha256 ||
    (value.command.operation !== "cancel" && value.command.intentText !== value.intentText)) {
    ctx.addIssue({ code: "custom", message: "Generation command differs from its retained intent or source" });
  }
  if (value.command.operation === "continue" && !synthesisContinuationCommandSchema.safeParse({ ...value.command.continuation,
    requestId: value.command.requestId, intentText: value.intentText }).success) ctx.addIssue({ code: "custom", message: "Continuation differs from its saved parent or source" });
});
export type SynthesisGenerationClientScope = z.infer<typeof scopeSchema>;
export type PendingSynthesisGenerationCommand = z.infer<typeof pendingSchema>;
type Operation = z.infer<typeof operationSchema>;
const key = (scope: SynthesisGenerationClientScope, operation: Operation, proposal?: SynthesisContinuationProposal) => {
  const base = `openplan:synthesis-generation:${scope.userId}:${scope.workspaceId}:${scope.campaignId}:${scope.sourceId}:${operation}`;
  if (operation !== "continue") { if (proposal) throw new Error("Unexpected continuation recovery scope"); return base; }
  const parsed = synthesisContinuationProposalSchema.parse(proposal);
  if (parsed.parent.sourceId !== scope.sourceId || parsed.parent.sourceSha256 !== scope.sourceSha256) throw new Error("Continuation recovery source differs");
  return `${base}:${parsed.parent.parentRequestId}:${parsed.stage}:${parsed.stage === "context" ? parsed.targetRecordId : "all"}`;
};
const proposalOf = (value: PendingSynthesisGenerationCommand) => value.command.operation === "continue" ? value.command.continuation : undefined;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Later selected outputs and resource choices cannot replace an uncertain saved
// command. Recover its original pins within the same immutable parent/source and
// contribution slot; never move it to a different actor, source or request.
function sameProposalSlot(saved: SynthesisContinuationProposal | undefined, current: SynthesisContinuationProposal | undefined) {
  if (!saved || !current) return saved === current;
  const a = synthesisContinuationProposalSchema.parse(saved), b = synthesisContinuationProposalSchema.parse(current);
  const immutable = ["parentRequestId", "parentActorId", "parentIntentSha256", "sourceId", "sourceSha256"] as const;
  return a.stage === b.stage && immutable.every(key => a.parent[key] === b.parent[key]) &&
    (a.stage !== "context" || b.stage === "context" && a.targetRecordId === b.targetRecordId);
}
const matches = (value: SynthesisGenerationClientScope, scope: SynthesisGenerationClientScope) =>
  (Object.keys(scopeSchema.shape) as Array<keyof SynthesisGenerationClientScope>).every(field => value[field] === scope[field]);
const clientScope = (value: SynthesisGenerationClientScope): SynthesisGenerationClientScope => ({ userId: value.userId,
  workspaceId: value.workspaceId, campaignId: value.campaignId, sourceId: value.sourceId, sourceSha256: value.sourceSha256 });

export class SynthesisGenerationSaveError extends Error {
  constructor(public readonly status: number) {
    super(status === 409
      ? "The generation request changed or was cancelled. Keep this command and inspect the saved request."
      : "The generation request is unconfirmed. Keep this command and retry after checking access.");
  }
}

/** Separate slots allow cancellation without discarding an uncertain creation. */
export function readPendingSynthesisGeneration(storage: ReviewStorage, rawScope: SynthesisGenerationClientScope, rawOperation: Operation, proposal?: SynthesisContinuationProposal) {
  const scope = scopeSchema.parse(rawScope), operation = operationSchema.parse(rawOperation), raw = storage.getItem(key(scope, operation, proposal));
  if (raw === null) return null;
  const value = pendingSchema.parse(JSON.parse(raw));
  if (!matches(value, scope) || value.command.operation !== operation || !sameProposalSlot(proposalOf(value), proposal)) throw new Error("Generation recovery belongs to another source, account or operation");
  return value;
}

/** Retain exact intent text, including whitespace, before the first attempt or retry. */
export function retainPendingSynthesisGeneration(storage: ReviewStorage, pending: PendingSynthesisGenerationCommand) {
  const value = pendingSchema.parse(pending), scope = clientScope(value), operation = value.command.operation, proposal = proposalOf(value);
  const current = readPendingSynthesisGeneration(storage, scope, operation, proposal);
  if (current && !same(current, value)) throw new Error("Another generation command is pending");
  const raw = JSON.stringify(value);
  storage.setItem(key(scope, operation, proposal), raw);
  if (storage.getItem(key(scope, operation, proposal)) !== raw) throw new Error("Generation command could not be retained for retry");
  return value;
}

/** Never resend automatically or infer provider authorization from a request receipt. */
export async function sendPendingSynthesisGeneration(storage: ReviewStorage, pending: PendingSynthesisGenerationCommand,
  transport: typeof fetch = fetch, signal?: AbortSignal) {
  const value = pendingSchema.parse(pending), scope = clientScope(value), operation = value.command.operation, proposal = proposalOf(value);
  if (!same(readPendingSynthesisGeneration(storage, scope, operation, proposal), value)) throw new Error("Generation recovery changed. Reopen its saved command.");
  const retained = retainPendingSynthesisGeneration(storage, value), command = retained.command;
  const boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  boundedSignal.throwIfAborted();
  const continuation = command.operation === "continue" ? synthesisContinuationCommandSchema.parse({ ...command.continuation,
    requestId: command.requestId, intentText: command.intentText }) : null;
  const response = await transport(`/api/engagement/campaigns/${scope.campaignId}/synthesis/${continuation ? "continuation" : "generation"}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.userId,
      "x-openplan-expected-workspace": scope.workspaceId }, body: JSON.stringify(continuation ?? command), cache: "no-store", signal: boundedSignal,
  });
  boundedSignal.throwIfAborted();
  if (!response.ok) throw new SynthesisGenerationSaveError(response.status);
  const raw = await response.json();
  boundedSignal.throwIfAborted();
  const receiptScope = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: command.requestId };
  const result = continuation ? await inspectSynthesisContinuation(raw, receiptScope, continuation)
    : await inspectSynthesisGenerationRequest(raw, receiptScope);
  boundedSignal.throwIfAborted();
  const { state, cancellation } = result;
  if (state.replayed === undefined ||
    (state.request && (state.request.actorId !== value.userId || state.request.intentText !== value.intentText)) ||
    (command.operation !== "cancel" && !state.request) ||
    (command.operation === "cancel" && (!cancellation || cancellation.id !== command.cancellationId ||
      cancellation.actorId !== value.userId || cancellation.reason !== command.reason))) {
    throw new Error("Generation receipt differs. Keep the exact command for recovery.");
  }
  let cleanupError: string | null = null;
  try {
    if (!same(readPendingSynthesisGeneration(storage, scope, operation, proposal), retained)) throw new Error("Generation recovery changed");
    storage.removeItem(key(scope, operation, proposal));
    if (storage.getItem(key(scope, operation, proposal)) !== null) throw new Error("Generation recovery could not be cleared");
  } catch { cleanupError = "Generation command confirmed. Browser cleanup failed; keep its saved copy and inspect the current request."; }
  return { ...result, cleanupError };
}

/** Preserve raw originals and newer memory before allowing another command in this slot. */
export function preservePendingSynthesisGeneration(storage: ReviewStorage, rawScope: SynthesisGenerationClientScope,
  rawOperation: Operation, latest?: PendingSynthesisGenerationCommand, proposal?: SynthesisContinuationProposal) {
  const scope = scopeSchema.parse(rawScope), operation = operationSchema.parse(rawOperation), activeKey = key(scope, operation, proposal);
  const raw = storage.getItem(activeKey);
  if (latest && (!matches(pendingSchema.parse(latest), scope) || latest.command.operation !== operation || !sameProposalSlot(proposalOf(latest), proposal))) throw new Error("Latest generation recovery belongs to another source, account or operation");
  for (const copy of new Set([raw, latest ? JSON.stringify(latest) : null])) {
    if (copy === null) continue;
    const archive = `${activeKey}:preserved:${crypto.randomUUID()}`;
    storage.setItem(archive, copy);
    if (storage.getItem(archive) !== copy || storage.getItem(activeKey) !== raw) throw new Error("Generation recovery could not be preserved");
  }
  if (storage.getItem(activeKey) !== raw) throw new Error("Generation recovery changed during preservation");
  storage.removeItem(activeKey);
  if (storage.getItem(activeKey) !== null) throw new Error("Preserved generation recovery could not be moved aside");
}

export function listPreservedSynthesisGeneration(storage: ReviewStorage, rawScope: SynthesisGenerationClientScope, rawOperation: Operation, proposal?: SynthesisContinuationProposal) {
  const scope = scopeSchema.parse(rawScope), operation = operationSchema.parse(rawOperation), prefix = `${key(scope, operation, proposal)}:preserved:`;
  const copies: Array<{ key: string; raw: string; value: PendingSynthesisGenerationCommand | null }> = [];
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
    const raw = storage.getItem(name); if (raw === null) continue;
    const parsed = (() => { try { return pendingSchema.safeParse(JSON.parse(raw)); } catch { return null; } })();
    copies.push({ key: name, raw, value: parsed?.success && matches(parsed.data, scope) && parsed.data.command.operation === operation && sameProposalSlot(proposalOf(parsed.data), proposal) ? parsed.data : null });
  }
  return copies;
}
