import { z } from "zod";
import type { ReviewStorage } from "./synthesis-review-recovery";
import { parseSynthesisExecutionReceipt, synthesisExecutionScopeSchema, synthesisExecutionCommandSchema,
  synthesisWorkerAuthorizationIntentSchema } from "./synthesis-execution-records";

const pendingSchema = synthesisExecutionScopeSchema.extend({ version: z.literal(1), command: synthesisExecutionCommandSchema }).strict()
  .superRefine((value, context) => {
    try {
      const intent = synthesisWorkerAuthorizationIntentSchema.parse(JSON.parse(value.command.intentText));
      if (new TextEncoder().encode(value.command.intentText).byteLength > 4096 ||
        (intent.retryTaskIndex === null) !== (intent.retryOfAttemptId === null) ||
        (intent.retryTaskIndex !== null && intent.maxAttempts !== 1)) throw new Error("Different retry limits");
    } catch { context.addIssue({ code: "custom", message: "The original execution allowance could not be read" }); }
  });
export type SynthesisExecutionClientScope = z.infer<typeof synthesisExecutionScopeSchema>;
export type PendingSynthesisExecution = z.infer<typeof pendingSchema>;
const scopeOf = (value: SynthesisExecutionClientScope) => synthesisExecutionScopeSchema.parse({ campaignId: value.campaignId,
  workspaceId: value.workspaceId, requestId: value.requestId, actorId: value.actorId, sourceId: value.sourceId,
  sourceSha256: value.sourceSha256, requestIntentSha256: value.requestIntentSha256, stage: value.stage });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const key = (scope: SynthesisExecutionClientScope) => `openplan:synthesis-execution:${scope.actorId}:${scope.workspaceId}:${scope.campaignId}:${scope.requestId}:${scope.stage}`;
const matches = (value: SynthesisExecutionClientScope, scope: SynthesisExecutionClientScope) => same(scopeOf(value), scopeOf(scope));
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");

export class SynthesisExecutionSaveError extends Error {
  constructor(public readonly status: number) {
    super("Execution permission is unconfirmed. Keep the original allowance and check saved permissions before retrying.");
  }
}

/** A retained command blocks another allowance until staff explicitly preserves
 * it. A successful acknowledgement does not silently free the slot for spending.
 */
export function readPendingSynthesisExecution(storage: ReviewStorage, rawScope: SynthesisExecutionClientScope) {
  const scope = synthesisExecutionScopeSchema.parse(rawScope), raw = storage.getItem(key(scope));
  if (raw === null) return null;
  const value = pendingSchema.parse(JSON.parse(raw));
  if (!matches(value, scope)) throw new Error("Execution recovery belongs to another source, request or account");
  return value;
}

export function retainPendingSynthesisExecution(storage: ReviewStorage, pending: PendingSynthesisExecution) {
  const value = pendingSchema.parse(pending), scope = scopeOf(value), current = readPendingSynthesisExecution(storage, scope);
  if (current && !same(current, value)) throw new Error("Another execution allowance is retained. Inspect it before starting another.");
  const raw = JSON.stringify(value);
  storage.setItem(key(scope), raw);
  if (storage.getItem(key(scope)) !== raw) throw new Error("The exact execution allowance could not be retained for recovery");
  return value;
}

/** Send only a previously retained command. Expiry is deliberately not checked
 * here: native exact replay must recover old receipts without renewing them.
 */
export async function sendPendingSynthesisExecution(storage: ReviewStorage, pending: PendingSynthesisExecution,
  transport: typeof fetch = fetch, signal?: AbortSignal) {
  const value = pendingSchema.parse(pending), scope = scopeOf(value);
  if (!same(readPendingSynthesisExecution(storage, scope), value)) throw new Error("The retained execution allowance changed");
  retainPendingSynthesisExecution(storage, value);
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  bounded.throwIfAborted();
  const { campaignId, workspaceId, actorId, ...bodyScope } = scope;
  const response = await transport(`/api/engagement/campaigns/${campaignId}/synthesis/execution`, {
    method: "POST", cache: "no-store", signal: bounded, headers: { "Content-Type": "application/json",
      "x-openplan-expected-user": actorId, "x-openplan-expected-workspace": workspaceId },
    body: JSON.stringify({ ...bodyScope, ...value.command }),
  });
  bounded.throwIfAborted();
  if (!response.ok) throw new SynthesisExecutionSaveError(response.status);
  const result = parseSynthesisExecutionReceipt(await response.json(), value.command, scope.requestId);
  if (await digest(result.receipt.intentText) !== result.receipt.intentSha256) throw new Error("The execution receipt checksum differs");
  bounded.throwIfAborted();
  if (!same(readPendingSynthesisExecution(storage, scope), value)) throw new Error("Execution recovery changed during acknowledgement. Check saved permissions.");
  return result;
}

/** Preserve unreadable originals as well as newer in-memory commands. This does
 * not cancel a grant or permit retrying a provider call with an unknown outcome.
 */
export function preservePendingSynthesisExecution(storage: ReviewStorage, rawScope: SynthesisExecutionClientScope, latest?: PendingSynthesisExecution) {
  const scope = synthesisExecutionScopeSchema.parse(rawScope), active = key(scope), raw = storage.getItem(active);
  if (latest && !matches(pendingSchema.parse(latest), scope)) throw new Error("Execution recovery belongs to another scope");
  for (const copy of new Set([raw, latest ? JSON.stringify(latest) : null])) {
    if (copy === null) continue;
    const archive = `${active}:preserved:${crypto.randomUUID()}`;
    storage.setItem(archive, copy);
    if (storage.getItem(archive) !== copy || storage.getItem(active) !== raw) throw new Error("Execution recovery could not be preserved");
  }
  if (storage.getItem(active) !== raw) throw new Error("Execution recovery changed during preservation");
  storage.removeItem(active);
  if (storage.getItem(active) !== null) throw new Error("Preserved execution recovery could not be moved aside");
}

export function listPreservedSynthesisExecution(storage: ReviewStorage, rawScope: SynthesisExecutionClientScope) {
  const scope = synthesisExecutionScopeSchema.parse(rawScope), prefix = `${key(scope)}:preserved:`;
  const copies: Array<{ key: string; raw: string; value: PendingSynthesisExecution | null }> = [];
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
    const raw = storage.getItem(name); if (raw === null) continue;
    const parsed = (() => { try { return pendingSchema.safeParse(JSON.parse(raw)); } catch { return null; } })();
    copies.push({ key: name, raw, value: parsed?.success && matches(parsed.data, scope) ? parsed.data : null });
  }
  return copies;
}
