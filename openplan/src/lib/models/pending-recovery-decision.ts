import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { recoveryDecisionSchema, recoveryIdentitySchema, recoveryRpcArguments, matchesRecoveryReceipt } from "./recovery-decision";

export const recoveryScopeSchema = z.object({ userId: recoveryIdentitySchema, workspaceId: recoveryIdentitySchema, modelId: recoveryIdentitySchema, runId: recoveryIdentitySchema }).strict();
export type RecoveryScope = z.infer<typeof recoveryScopeSchema>;
export type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;
const recordSchema = z.object({ version: z.literal(1), scope: recoveryScopeSchema, decision: recoveryDecisionSchema,
  phase: z.enum(["pending", "conflict", "confirmed"]), receipt: z.unknown(),
}).strict();
export type SavedRecoveryDecision = z.infer<typeof recordSchema>;
const same = (a: unknown, b: unknown) => canonicalizeActionPayload(a) === canonicalizeActionPayload(b);
const prefix = (scope: RecoveryScope) => `openplan:model-recovery:${scope.userId}:${scope.workspaceId}:${scope.modelId}:${scope.runId}:`;
export const recoveryDecisionKey = (value: SavedRecoveryDecision) => prefix(value.scope) + value.decision.requestId;
export const recoveryHeaders = (scope: RecoveryScope) => ({ "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId });
export const recoveryEndpoint = (scope: RecoveryScope) => `/api/models/${scope.modelId}/runs/${scope.runId}/recovery`;

function checked(value: unknown, scope: RecoveryScope): SavedRecoveryDecision {
  const parsed = recordSchema.parse(value), state = parsed.decision.expectedState;
  if (!same(parsed.scope, scope) || state.workspace_id !== scope.workspaceId || state.model_id !== scope.modelId || state.run_id !== scope.runId) throw new Error("Saved decision belongs to another account or run");
  if (parsed.phase === "confirmed") {
    if (!matchesRecoveryReceipt(parsed.receipt, recoveryRpcArguments(parsed.decision, scope.workspaceId, scope.runId, scope.userId))) throw new Error("Saved receipt differs from the decision");
  } else if (parsed.receipt !== null) throw new Error("Unconfirmed decision has an unexpected receipt");
  return parsed;
}

/** Confirm durable browser retention before any consequential request is sent. */
export function retainRecoveryDecision(storage: RecoveryStorage, value: SavedRecoveryDecision, updating = false) {
  const parsed = checked(value, value.scope), key = recoveryDecisionKey(parsed), old = storage.getItem(key);
  if (updating && old === null) throw new Error("Saved decision is missing. Nothing new was sent.");
  if (old !== null) {
    const previous = checked(JSON.parse(old), parsed.scope);
    if (!same(previous.decision, parsed.decision) || (previous.phase === "confirmed" && !same(previous, parsed))) throw new Error("Saved decision changed in another tab; its copy was kept.");
  }
  if (storage.getItem(key) !== old) throw new Error("Saved decision changed in another tab; its copy was kept.");
  const text = JSON.stringify(parsed); storage.setItem(key, text);
  if (storage.getItem(key) !== text) throw new Error("Browser storage did not retain the decision. Nothing new was sent.");
  return parsed;
}

export function readRecoveryDecisions(storage: RecoveryStorage, scope: RecoveryScope) {
  recoveryScopeSchema.parse(scope);
  const records: SavedRecoveryDecision[] = [], unreadable: Array<{ key: string; raw: string }> = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null && key.startsWith(prefix(scope)));
  for (const key of keys) {
    const raw = storage.getItem(key); if (raw === null) continue;
    try {
      const value = checked(JSON.parse(raw), scope);
      if (key !== recoveryDecisionKey(value)) throw new Error("Saved request identity differs");
      records.push(value);
    } catch { unreadable.push({ key, raw }); }
  }
  return { records, unreadable };
}

/** A retry sends the frozen decision; it never replaces it with a fresh observation. */
export async function sendRecoveryDecision(storage: RecoveryStorage, saved: SavedRecoveryDecision, transport: typeof fetch = fetch) {
  if (saved.phase !== "pending") throw new Error("Only an unconfirmed decision can be retried");
  const retained = retainRecoveryDecision(storage, saved, true);
  try {
    const response = await transport(recoveryEndpoint(retained.scope), { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", ...recoveryHeaders(retained.scope) }, body: JSON.stringify(retained.decision), signal: AbortSignal.timeout(30000) });
    const receipt: unknown = await response.json();
    if (response.ok && matchesRecoveryReceipt(receipt, recoveryRpcArguments(retained.decision, retained.scope.workspaceId, retained.scope.runId, retained.scope.userId))) {
      return retainRecoveryDecision(storage, { ...retained, phase: "confirmed", receipt }, true);
    }
    if (response.status === 409) return retainRecoveryDecision(storage, { ...retained, phase: "conflict" }, true);
  } catch { /* The saved request survives transport and receipt-storage failures. */ }
  return retained;
}
