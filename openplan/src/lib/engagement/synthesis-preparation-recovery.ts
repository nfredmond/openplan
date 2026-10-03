import { z } from "zod";
import { verifySynthesisPreparation } from "./synthesis-preparation-state";
import type { ReviewStorage } from "./synthesis-review-recovery";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const stage = z.enum(["segment", "context", "thematic"]);
const scopeSchema = z.object({ userId: id, workspaceId: id, campaignId: id, sourceId: id,
  sourceSha256: hash, requestId: id, intentSha256: hash, stage }).strict();
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("enqueue"), requestId: id, stage, intentSha256: hash }).strict(),
  z.object({ operation: z.literal("retry"), requestId: id, attempt: z.number().int().nonnegative().safe() }).strict(),
]);
const pendingSchema = scopeSchema.extend({ version: z.literal(1), command: commandSchema }).strict().superRefine((value, ctx) => {
  const command = value.command;
  if (command.requestId !== value.requestId || (command.operation === "enqueue" &&
    (command.stage !== value.stage || command.intentSha256 !== value.intentSha256))) {
    ctx.addIssue({ code: "custom", message: "Preparation command differs from its retained request" });
  }
});
export type SynthesisPreparationClientScope = z.infer<typeof scopeSchema>;
export type PendingSynthesisPreparation = z.infer<typeof pendingSchema>;
const key = (scope: SynthesisPreparationClientScope) => `openplan:synthesis-preparation:${scope.userId}:${scope.workspaceId}:${scope.campaignId}:${scope.sourceId}:${scope.requestId}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const matches = (value: SynthesisPreparationClientScope, scope: SynthesisPreparationClientScope) =>
  (Object.keys(scopeSchema.shape) as Array<keyof SynthesisPreparationClientScope>).every(field => value[field] === scope[field]);

export class SynthesisPreparationSaveError extends Error {
  constructor(public readonly status: number) {
    super(status === 409
      ? "Preparation changed. Keep this command and inspect the current request before retrying."
      : "Preparation is unconfirmed. Keep this command and retry after checking access.");
  }
}

/** Local custody is scoped to the original account, source and request. It grants no authority. */
export function readPendingSynthesisPreparation(storage: ReviewStorage, rawScope: SynthesisPreparationClientScope) {
  const scope = scopeSchema.parse(rawScope), raw = storage.getItem(key(scope));
  if (raw === null) return null;
  const value = pendingSchema.parse(JSON.parse(raw));
  if (!matches(value, scope)) throw new Error("Preparation recovery belongs to another request, source or account");
  return value;
}

/** Read back the complete command before any network write. Never replace an unresolved command. */
export function retainPendingSynthesisPreparation(storage: ReviewStorage, pending: PendingSynthesisPreparation) {
  const value = pendingSchema.parse(pending);
  const current = readPendingSynthesisPreparation(storage, preparationScope(value));
  if (current && !same(current, value)) throw new Error("Another preparation command is pending");
  const raw = JSON.stringify(value);
  storage.setItem(key(value), raw);
  if (storage.getItem(key(value)) !== raw) throw new Error("Preparation command could not be retained for retry");
  return value;
}

function preparationScope(value: SynthesisPreparationClientScope): SynthesisPreparationClientScope {
  return { userId: value.userId, workspaceId: value.workspaceId, campaignId: value.campaignId,
    sourceId: value.sourceId, sourceSha256: value.sourceSha256, requestId: value.requestId,
    intentSha256: value.intentSha256, stage: value.stage };
}

/** Replays only the saved enqueue or observed-attempt retry. A receipt can include later progress. */
export async function sendPendingSynthesisPreparation(storage: ReviewStorage, pending: PendingSynthesisPreparation,
  transport: typeof fetch = fetch, signal?: AbortSignal) {
  const value = pendingSchema.parse(pending), scope = preparationScope(value);
  if (!same(readPendingSynthesisPreparation(storage, scope), value)) throw new Error("Preparation recovery changed. Reopen its saved command.");
  const retained = retainPendingSynthesisPreparation(storage, value), command = retained.command;
  const boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  boundedSignal.throwIfAborted();
  const response = await transport(`/api/engagement/campaigns/${value.campaignId}/synthesis/preparation`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": value.userId,
      "x-openplan-expected-workspace": value.workspaceId }, body: JSON.stringify(command), cache: "no-store", signal: boundedSignal,
  });
  boundedSignal.throwIfAborted();
  if (!response.ok) throw new SynthesisPreparationSaveError(response.status);
  const raw = await response.json();
  boundedSignal.throwIfAborted();
  const state = verifySynthesisPreparation(raw, { campaignId: value.campaignId, workspaceId: value.workspaceId, requestId: value.requestId });
  if (!state || state.actorId !== value.userId || state.intentSha256 !== value.intentSha256 || state.stage !== value.stage ||
    (command.operation === "enqueue" && state.replayed === undefined) ||
    (command.operation === "retry" && state.attempts < command.attempt)) {
    throw new Error("Preparation receipt differs. Keep the exact command for recovery.");
  }
  let cleanupError: string | null = null;
  try {
    if (!same(readPendingSynthesisPreparation(storage, scope), retained)) throw new Error("Preparation recovery changed");
    storage.removeItem(key(retained));
    if (storage.getItem(key(retained)) !== null) throw new Error("Preparation recovery could not be cleared");
  } catch { cleanupError = "Preparation confirmed. Browser cleanup failed; keep the saved command and inspect its current status."; }
  return { state, cleanupError };
}

/** Preserve unreadable originals and any newer in-memory command before clearing the active slot. */
export function preservePendingSynthesisPreparation(storage: ReviewStorage, rawScope: SynthesisPreparationClientScope,
  latest?: PendingSynthesisPreparation) {
  const scope = scopeSchema.parse(rawScope), activeKey = key(scope), raw = storage.getItem(activeKey);
  if (latest && !matches(pendingSchema.parse(latest), scope)) throw new Error("Latest preparation recovery belongs to another request or account");
  for (const copy of new Set([raw, latest ? JSON.stringify(latest) : null])) {
    if (copy === null) continue;
    const archive = `${activeKey}:preserved:${crypto.randomUUID()}`;
    storage.setItem(archive, copy);
    if (storage.getItem(archive) !== copy || storage.getItem(activeKey) !== raw) throw new Error("Preparation recovery could not be preserved");
  }
  if (storage.getItem(activeKey) !== raw) throw new Error("Preparation recovery changed during preservation");
  storage.removeItem(activeKey);
  if (storage.getItem(activeKey) !== null) throw new Error("Preserved preparation recovery could not be moved aside");
}

export function listPreservedSynthesisPreparations(storage: ReviewStorage, rawScope: SynthesisPreparationClientScope) {
  const scope = scopeSchema.parse(rawScope), prefix = `${key(scope)}:preserved:`;
  const copies: Array<{ key: string; raw: string; value: PendingSynthesisPreparation | null }> = [];
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
    const raw = storage.getItem(name); if (raw === null) continue;
    const parsed = (() => { try { return pendingSchema.safeParse(JSON.parse(raw)); } catch { return null; } })();
    copies.push({ key: name, raw, value: parsed?.success && matches(parsed.data, scope) ? parsed.data : null });
  }
  return copies;
}
