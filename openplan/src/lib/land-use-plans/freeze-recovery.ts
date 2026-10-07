import { z } from "zod";
import { matchesPlanFreezeCommand, planFreezeCommandSchema, planFreezeResultSchema } from "./freeze-command";

const uuid = z.string().uuid();
const scopeSchema = z.object({ actorId: uuid, workspaceId: uuid, planId: uuid }).strict();
export type PlanFreezeClientScope = z.infer<typeof scopeSchema>;
const pendingSchema = scopeSchema.extend({
  schemaVersion: z.literal(1), versionNumber: z.number().int().positive(), savedAt: z.iso.datetime(),
  commandText: z.string().min(2).max(8192),
}).strict();
export type PendingPlanFreeze = z.infer<typeof pendingSchema>;
export type PlanFreezeStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type PlanFreezeRecoveryRecord = { key: string; raw: string; pending: PendingPlanFreeze | null; archived: boolean };
const prefix = (scope: PlanFreezeClientScope) => `openplan:plan-freeze:${scope.actorId}:${scope.workspaceId}:${scope.planId}:`;
const scopeOf = (value: PlanFreezeClientScope) => ({ actorId: value.actorId, workspaceId: value.workspaceId, planId: value.planId });

function validatePending(value: unknown, scope: PlanFreezeClientScope) {
  const pending = pendingSchema.parse(value);
  if (pending.actorId !== scope.actorId || pending.workspaceId !== scope.workspaceId || pending.planId !== scope.planId) throw new Error("This request belongs to another account, workspace or plan.");
  planFreezeCommandSchema.parse(JSON.parse(pending.commandText));
  return pending;
}
function pendingKey(pending: PendingPlanFreeze) {
  return `${prefix(pending)}pending:${planFreezeCommandSchema.parse(JSON.parse(pending.commandText)).commandId}`;
}

/** Each command owns an immutable key, so another request cannot be erased by cleanup. */
export function readPlanFreezeRecovery(storage: PlanFreezeStorage, input: PlanFreezeClientScope): PlanFreezeRecoveryRecord[] {
  const scope = scopeSchema.parse(input), records: PlanFreezeRecoveryRecord[] = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(prefix(scope)))).sort();
  for (const key of keys) {
    const raw = storage.getItem(key); if (raw === null) continue;
    const archived = key.startsWith(`${prefix(scope)}copy:`);
    let pending: PendingPlanFreeze | null = null;
    try {
      pending = validatePending(JSON.parse(raw), scope);
      if (!archived && pendingKey(pending) !== key) pending = null;
    } catch { /* Keep unreadable originals available for a recovery copy. */ }
    records.push({ key, raw, pending, archived });
  }
  return records;
}

export function retainPlanFreeze(storage: PlanFreezeStorage, input: PendingPlanFreeze) {
  const pending = validatePending(input, scopeSchema.parse(scopeOf(input))), key = pendingKey(pending), raw = JSON.stringify(pending);
  const existing = storage.getItem(key);
  if (existing !== null && existing !== raw) throw new Error("This request already has a different saved copy. Keep both copies and review the plan.");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("The freeze request could not be saved in this browser. Nothing was sent.");
  return pending;
}

/** Only explicit user action sends or retries a saved request. Reading never sends it. */
export async function sendPlanFreeze(storage: PlanFreezeStorage, pending: PendingPlanFreeze, transport: typeof fetch = fetch, signal?: AbortSignal) {
  const valid = validatePending(pending, scopeSchema.parse(scopeOf(pending))), key = pendingKey(valid);
  if (storage.getItem(key) !== JSON.stringify(valid)) throw new Error("The saved request changed. Reopen its recovery copy before retrying.");
  const command = planFreezeCommandSchema.parse(JSON.parse(valid.commandText));
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  bounded.throwIfAborted();
  const response = await transport(`/api/land-use-plans/${valid.planId}/freeze`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": valid.actorId, "x-openplan-expected-workspace": valid.workspaceId },
    body: valid.commandText, cache: "no-store", signal: bounded,
  });
  bounded.throwIfAborted();
  if (!response.ok) {
    throw new Error(response.status === 409 ? "The saved draft or checklist changed. Keep the request and review the current draft before freezing again."
      : response.status === 401 || response.status === 403 ? "Check your account and current staff access. The saved request remains available."
      : "The freeze is unconfirmed. Keep this request and retry it after checking the connection.");
  }
  const result = planFreezeResultSchema.parse(await response.json());
  bounded.throwIfAborted();
  if (!matchesPlanFreezeCommand(result, command) || response.status !== (result.replayed ? 200 : 201)) {
    throw new Error("The reply does not match this freeze request. Keep the original request for recovery.");
  }
  return result;
}

/** Remove only this confirmed command, after the caller checks its current scope. */
export function acknowledgePlanFreeze(storage: PlanFreezeStorage, pending: PendingPlanFreeze) {
  const key = pendingKey(pending), raw = JSON.stringify(pending);
  if (storage.getItem(key) !== raw) throw new Error("The freeze is confirmed, but its browser copy changed. Keep the saved copies.");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("The freeze is confirmed, but its browser copy could not be cleared. It remains safe to retry.");
}

/** Preserve the exact original before moving an unresolved or unreadable record aside. */
export function preservePlanFreeze(storage: PlanFreezeStorage, scope: PlanFreezeClientScope, record: PlanFreezeRecoveryRecord) {
  const checked = scopeSchema.parse(scope);
  if (!record.key.startsWith(prefix(checked)) || record.archived || storage.getItem(record.key) !== record.raw) throw new Error("The saved request changed. Read it again before preserving it.");
  const copyKey = `${prefix(checked)}copy:${crypto.randomUUID()}`;
  if (storage.getItem(copyKey) !== null) throw new Error("A recovery copy already uses this identifier.");
  storage.setItem(copyKey, record.raw);
  if (storage.getItem(copyKey) !== record.raw || storage.getItem(record.key) !== record.raw) throw new Error("The recovery copy could not be verified. The pending request stays in place.");
  storage.removeItem(record.key);
  if (storage.getItem(record.key) !== null) throw new Error("The copy is preserved, but the pending request could not be moved aside.");
}

export function restorePlanFreeze(storage: PlanFreezeStorage, scope: PlanFreezeClientScope, raw: string) {
  if (raw.length > 32_768) throw new Error("This file is larger than a freeze request.");
  return retainPlanFreeze(storage, validatePending(JSON.parse(raw), scopeSchema.parse(scope)));
}
