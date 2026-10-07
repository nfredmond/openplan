import { z } from "zod";
import { IMPLEMENTATION_REPORT_COMMAND_LIMIT, matchesImplementationReport, implementationReportCommandSchema, implementationReportResultSchema } from "./implementation-report-command";

export const IMPLEMENTATION_REPORT_RECOVERY_LIMIT = 262_144;
const uuid = z.string().uuid();
const scopeSchema = z.object({ actorId: uuid, workspaceId: uuid, planId: uuid }).strict();
export type ImplementationReportClientScope = z.infer<typeof scopeSchema>;
const pendingSchema = scopeSchema.extend({
  schemaVersion: z.literal(1), versionNumber: z.number().int().positive(), savedAt: z.iso.datetime(),
  commandText: z.string().min(2).max(IMPLEMENTATION_REPORT_COMMAND_LIMIT),
}).strict();
export type PendingImplementationReport = z.infer<typeof pendingSchema>;
export type ImplementationReportStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type ImplementationReportRecoveryRecord = { key: string; raw: string; pending: PendingImplementationReport | null; archived: boolean };
const prefix = (scope: ImplementationReportClientScope) => `openplan:plan-implementation-report:${scope.actorId}:${scope.workspaceId}:${scope.planId}:`;
const scopeOf = (value: ImplementationReportClientScope) => ({ actorId: value.actorId, workspaceId: value.workspaceId, planId: value.planId });

function validatePending(value: unknown, scope: ImplementationReportClientScope) {
  const pending = pendingSchema.parse(value);
  if (pending.actorId !== scope.actorId || pending.workspaceId !== scope.workspaceId || pending.planId !== scope.planId) throw new Error("This request belongs to another account, workspace or plan.");
  if (new TextEncoder().encode(pending.commandText).byteLength > IMPLEMENTATION_REPORT_COMMAND_LIMIT) throw new Error("This report request is too large.");
  implementationReportCommandSchema.parse(JSON.parse(pending.commandText));
  return pending;
}
function pendingKey(pending: PendingImplementationReport) {
  return `${prefix(pending)}pending:${implementationReportCommandSchema.parse(JSON.parse(pending.commandText)).commandId}`;
}

/** Each command owns an immutable key, so another request cannot be erased by cleanup. */
export function readImplementationReportRecovery(storage: ImplementationReportStorage, input: ImplementationReportClientScope): ImplementationReportRecoveryRecord[] {
  const scope = scopeSchema.parse(input), records: ImplementationReportRecoveryRecord[] = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(prefix(scope)))).sort();
  for (const key of keys) {
    const raw = storage.getItem(key); if (raw === null) continue;
    const archived = key.startsWith(`${prefix(scope)}copy:`);
    let pending: PendingImplementationReport | null = null;
    try {
      pending = validatePending(JSON.parse(raw), scope);
      if (!archived && pendingKey(pending) !== key) pending = null;
    } catch { /* Keep unreadable originals available for a recovery copy. */ }
    records.push({ key, raw, pending, archived });
  }
  return records;
}

export function retainImplementationReport(storage: ImplementationReportStorage, input: PendingImplementationReport) {
  const pending = validatePending(input, scopeSchema.parse(scopeOf(input))), key = pendingKey(pending), raw = JSON.stringify(pending);
  const existing = storage.getItem(key);
  if (existing !== null && existing !== raw) throw new Error("This request already has a different saved copy. Keep both copies and review the plan.");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("The report request could not be saved in this browser. Nothing was sent.");
  return pending;
}

/** Only explicit user action sends or retries a saved request. Reading never sends it. */
export async function sendImplementationReport(storage: ImplementationReportStorage, pending: PendingImplementationReport, transport: typeof fetch = fetch, signal?: AbortSignal) {
  const valid = validatePending(pending, scopeSchema.parse(scopeOf(pending))), key = pendingKey(valid);
  if (storage.getItem(key) !== JSON.stringify(valid)) throw new Error("The saved request changed. Reopen its recovery copy before retrying.");
  const command = implementationReportCommandSchema.parse(JSON.parse(valid.commandText));
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  bounded.throwIfAborted();
  const response = await transport(`/api/land-use-plans/${valid.planId}/implementation-reports`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": valid.actorId, "x-openplan-expected-workspace": valid.workspaceId },
    body: valid.commandText, cache: "no-store", signal: bounded,
  });
  bounded.throwIfAborted();
  if (!response.ok) {
    throw new Error(response.status === 409 ? "The adopted plan changed. Keep the request and review the current plan before generating another report."
      : response.status === 401 || response.status === 403 ? "Check your account and current staff access. The saved request remains available."
      : "The report generation is unconfirmed. Keep this request and retry it after checking the connection.");
  }
  const result = implementationReportResultSchema.parse(await response.json());
  const commandSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valid.commandText))), byte => byte.toString(16).padStart(2, "0")).join("");
  bounded.throwIfAborted();
  if (result.commandSha256 !== commandSha256 || !matchesImplementationReport(result, scopeOf(valid), command) || response.status !== (result.replayed ? 200 : 201)) {
    throw new Error("The reply does not match this report request. Keep the original request for recovery.");
  }
  return result;
}

/** Remove only this confirmed command, after the caller checks its current scope. */
export function acknowledgeImplementationReport(storage: ImplementationReportStorage, pending: PendingImplementationReport) {
  const key = pendingKey(pending), raw = JSON.stringify(pending);
  if (storage.getItem(key) !== raw) throw new Error("The report generation is confirmed, but its browser copy changed. Keep the saved copies.");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("The report generation is confirmed, but its browser copy could not be cleared. It remains safe to retry.");
}

/** Preserve the exact original before moving an unresolved or unreadable record aside. */
export function preserveImplementationReport(storage: ImplementationReportStorage, scope: ImplementationReportClientScope, record: ImplementationReportRecoveryRecord) {
  const checked = scopeSchema.parse(scope);
  if (!record.key.startsWith(prefix(checked)) || record.archived || storage.getItem(record.key) !== record.raw) throw new Error("The saved request changed. Read it again before preserving it.");
  const copyKey = `${prefix(checked)}copy:${crypto.randomUUID()}`;
  if (storage.getItem(copyKey) !== null) throw new Error("A recovery copy already uses this identifier.");
  storage.setItem(copyKey, record.raw);
  if (storage.getItem(copyKey) !== record.raw || storage.getItem(record.key) !== record.raw) throw new Error("The recovery copy could not be verified. The pending request stays in place.");
  storage.removeItem(record.key);
  if (storage.getItem(record.key) !== null) throw new Error("The copy is preserved, but the pending request could not be moved aside.");
}

export function restoreImplementationReport(storage: ImplementationReportStorage, scope: ImplementationReportClientScope, raw: string) {
  if (new TextEncoder().encode(raw).byteLength > IMPLEMENTATION_REPORT_RECOVERY_LIMIT) throw new Error("This file is larger than a report request.");
  return retainImplementationReport(storage, validatePending(JSON.parse(raw), scopeSchema.parse(scope)));
}
