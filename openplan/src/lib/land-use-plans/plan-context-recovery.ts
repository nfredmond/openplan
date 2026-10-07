import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { placeOfRecordFromCapturedArea } from "@/lib/geographies/study-area-capture";
import { subdivisionCodeFromTigerwebGeoid, TIGERWEB_GEOGRAPHY_SOURCE } from "@/lib/workspaces/home-geography";
import { savedPlanContextSchema } from "./plan-context";
import { planContextSaveSchema, planContextSaveResultSchema, type PlanContextSaveResult } from "./plan-context-command";
import { contextCommandFromDraft, planContextDraftSchema, type PlanContextDraft } from "./plan-context-draft";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.object({ actorId: uuid, workspaceId: uuid, planId: uuid }).strict();
export type PlanContextClientScope = z.infer<typeof scopeSchema>;
const baseSchema = z.object({ versionId: uuid, contextHash: hash.nullable(), descriptorId: z.string().min(1).max(120), planKindKey: z.string().min(1).max(120) }).strict();
export type PlanContextBase = z.infer<typeof baseSchema>;
export const planContextReadSchema = scopeSchema.extend({
  contextState: z.discriminatedUnion("status", [z.object({ status: z.literal("legacy") }).strict(),
    z.object({ status: z.literal("retained"), context: savedPlanContextSchema }).strict()]),
  contextHash: hash.nullable(), descriptorId: baseSchema.shape.descriptorId, planKindKey: baseSchema.shape.planKindKey,
  versionId: uuid.nullable(), canWrite: z.boolean(),
}).strict().refine(value => (value.contextState.status === "legacy") === (value.contextHash === null), "The saved context and its hash disagree.");
export type PlanContextRead = z.infer<typeof planContextReadSchema>;
const draftSchema = scopeSchema.extend({ schemaVersion: z.literal(1), kind: z.literal("draft"), instanceId: uuid,
  savedAt: z.iso.datetime(), base: baseSchema, draft: planContextDraftSchema }).strict();
export type StoredPlanContextDraft = z.infer<typeof draftSchema>;
const pendingSchema = scopeSchema.extend({ schemaVersion: z.literal(1), kind: z.literal("pending"), savedAt: z.iso.datetime(),
  base: baseSchema, draft: planContextDraftSchema, commandText: z.string().min(2).max(2_000_000),
  retainedPlace: savedPlanContextSchema.shape.place.nullable() }).strict();
export type PendingPlanContext = z.infer<typeof pendingSchema>;
export type PlanContextStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type PlanContextRecoveryRecord = { key: string; raw: string; value: StoredPlanContextDraft | PendingPlanContext | null; archived: boolean };
const MAX_COPY_BYTES = 12_000_000;
const same = (a: unknown, b: unknown) => canonicalizeActionPayload(a) === canonicalizeActionPayload(b);
const prefix = (scope: PlanContextClientScope) => `openplan:plan-context:${scope.actorId}:${scope.workspaceId}:${scope.planId}:`;
const scopeOf = (value: PlanContextClientScope) => scopeSchema.parse({ actorId: value.actorId, workspaceId: value.workspaceId, planId: value.planId });
function checkScope(value: PlanContextClientScope, scope: PlanContextClientScope) {
  if (value.actorId !== scope.actorId || value.workspaceId !== scope.workspaceId || value.planId !== scope.planId) throw new Error("This copy belongs to another account, workspace or plan.");
}
function parseUnchanged<T>(schema: z.ZodType<T>, raw: unknown): T {
  const value = schema.parse(raw);
  if (!same(value, raw)) throw new Error("The saved copy needs review. Its values are not normalized.");
  return value;
}
const bounded = (signal?: AbortSignal) => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);

/** An unreadable current context is not historical absence and cannot seed a new form. */
export async function loadPlanContext(scope: PlanContextClientScope, transport: typeof fetch = fetch, signal?: AbortSignal): Promise<PlanContextRead> {
  const checked = scopeSchema.parse(scope), active = bounded(signal); active.throwIfAborted();
  const response = await transport(`/api/land-use-plans/${checked.planId}/context`, { cache: "no-store", signal: active });
  active.throwIfAborted();
  if (response.status !== 200) throw new Error("The current plan context could not be read. Keep saved drafts and try again.");
  const result = parseUnchanged(planContextReadSchema, await response.json()); active.throwIfAborted(); checkScope(result, checked);
  return result;
}

function validatePending(input: unknown, scope: PlanContextClientScope): PendingPlanContext {
  const pending = parseUnchanged(pendingSchema, input); checkScope(pending, scope);
  if (new TextEncoder().encode(pending.commandText).length > 2_000_000) throw new Error("This request exceeds the plan context size limit.");
  const command = parseUnchanged(planContextSaveSchema, JSON.parse(pending.commandText));
  const expected = contextCommandFromDraft(pending.draft, { commandId: command.commandId, versionId: pending.base.versionId,
    expectedContextHash: pending.base.contextHash, descriptorId: pending.base.descriptorId, planKindKey: pending.base.planKindKey });
  if (!same(command, expected)) throw new Error("The request does not match its retained draft and original plan version.");
  if (command.place.mode === "retained" ? pending.retainedPlace === null || pending.base.contextHash === null : pending.retainedPlace !== null) {
    throw new Error("The request has no matching saved study area.");
  }
  return pending;
}
function recordKey(value: StoredPlanContextDraft | PendingPlanContext) {
  return value.kind === "draft" ? `${prefix(value)}draft:${value.instanceId}`
    : `${prefix(value)}pending:${planContextSaveSchema.parse(JSON.parse(value.commandText)).commandId}`;
}
function parseRecord(raw: string, scope: PlanContextClientScope) {
  if (new TextEncoder().encode(raw).length > MAX_COPY_BYTES) throw new Error("This copy exceeds the plan context recovery size limit.");
  const value: unknown = JSON.parse(raw);
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "pending") return validatePending(value, scope);
  const draft = parseUnchanged(draftSchema, value); checkScope(draft, scope); return draft;
}

/** Reading preserves malformed copies and never sends, repairs or deletes them. */
export function readPlanContextRecovery(storage: PlanContextStorage, scope: PlanContextClientScope): PlanContextRecoveryRecord[] {
  const checked = scopeSchema.parse(scope);
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix(checked)))).sort();
  return keys.flatMap(key => {
    const raw = storage.getItem(key); if (raw === null) return [];
    const archived = key.startsWith(`${prefix(checked)}copy:`);
    let value: PlanContextRecoveryRecord["value"] = null;
    try { value = parseRecord(raw, checked); if (!archived && recordKey(value) !== key) value = null; } catch { /* Keep exact unreadable bytes for download or preservation. */ }
    return [{ key, raw, value, archived }];
  });
}

/** A browser instance owns one mutable key. Updates require its exact previous bytes. */
export function retainPlanContextDraft(storage: PlanContextStorage, input: StoredPlanContextDraft, previousRaw: string | null) {
  const value = parseUnchanged(draftSchema, input), key = recordKey(value), raw = JSON.stringify(value);
  if (storage.getItem(key) !== previousRaw) throw new Error("This draft copy changed. Keep your text and open a new recovery copy.");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("The draft could not be retained in this browser. Download a copy before leaving.");
  return { key, raw, value, archived: false } satisfies PlanContextRecoveryRecord;
}

/** Restoring creates a new owned draft and preserves its original base, including stale versions. */
export function restorePlanContextDraft(storage: PlanContextStorage, scope: PlanContextClientScope, raw: string, instanceId: string, savedAt: string) {
  const source = parseRecord(raw, scopeSchema.parse(scope));
  const restored: StoredPlanContextDraft = { ...scope, schemaVersion: 1, kind: "draft", instanceId, savedAt, base: source.base, draft: source.draft };
  return retainPlanContextDraft(storage, restored, null);
}
export function planContextDraftMatchesCurrent(draft: StoredPlanContextDraft, current: PlanContextRead) {
  return same(scopeOf(draft), scopeOf(current)) && same(draft.base, { versionId: current.versionId, contextHash: current.contextHash, descriptorId: current.descriptorId, planKindKey: current.planKindKey });
}

export function retainPlanContextCommand(storage: PlanContextStorage, input: PendingPlanContext) {
  const value = validatePending(input, scopeOf(input)), key = recordKey(value), raw = JSON.stringify(value), existing = storage.getItem(key);
  if (existing !== null && existing !== raw) throw new Error("This request already has a different saved copy. Keep both copies.");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("The request could not be retained in this browser. Nothing was sent.");
  return value;
}
export function restorePlanContextCommand(storage: PlanContextStorage, scope: PlanContextClientScope, raw: string) {
  const value = parseRecord(raw, scopeSchema.parse(scope));
  if (value.kind !== "pending") throw new Error("This is a draft, not a submitted request. Review it before preparing a save.");
  return retainPlanContextCommand(storage, value);
}

function matchingResult(result: PlanContextSaveResult, pending: PendingPlanContext) {
  const command = planContextSaveSchema.parse(JSON.parse(pending.commandText)), place = result.context.place;
  if (result.commandId !== command.commandId || result.versionId !== command.versionId || result.context.savedBy !== pending.actorId
    || !same(result.context.assessment, command.assessment)) return false;
  if (command.place.mode === "retained") return same(place, pending.retainedPlace);
  if (command.place.mode !== "place") return same(place, placeOfRecordFromCapturedArea(command.place));
  return place.source === TIGERWEB_GEOGRAPHY_SOURCE && place.kind === command.place.kind && place.ref === command.place.geoid
    && place.label === command.place.label && place.countryCode === "US"
    && place.subdivisionCode === subdivisionCodeFromTigerwebGeoid(command.place.kind, command.place.geoid);
}

/** Only explicit staff action sends retained bytes. Unknown replies leave the request intact. */
export async function sendPlanContextCommand(storage: PlanContextStorage, input: PendingPlanContext, transport: typeof fetch = fetch, signal?: AbortSignal) {
  const pending = validatePending(input, scopeOf(input));
  if (storage.getItem(recordKey(pending)) !== JSON.stringify(pending)) throw new Error("The retained request changed. Read its recovery copy before retrying.");
  const active = bounded(signal); active.throwIfAborted();
  const response = await transport(`/api/land-use-plans/${pending.planId}/context`, { method: "POST", cache: "no-store", signal: active,
    headers: { "Content-Type": "application/json", "x-openplan-expected-user": pending.actorId, "x-openplan-expected-workspace": pending.workspaceId }, body: pending.commandText });
  active.throwIfAborted();
  if (!response.ok) throw new Error(response.status === 409 ? "The saved plan changed. Keep this request and compare the current context before preparing another save."
    : response.status === 401 || response.status === 403 ? "Check the account and current staff access. The original request remains available."
      : "The save is unconfirmed. Keep the original request and retry it after checking the connection.");
  const result = parseUnchanged(planContextSaveResultSchema, await response.json()); active.throwIfAborted();
  if (!matchingResult(result, pending) || response.status !== (result.replayed ? 200 : 201)) throw new Error("The reply does not match the retained request. Keep it for recovery.");
  return result;
}

/** Clear a command only after a matching receipt and caller-side scope/refresh checks. Drafts stay separate. */
export function acknowledgePlanContextCommand(storage: PlanContextStorage, pending: PendingPlanContext, receipt: PlanContextSaveResult) {
  const checked = validatePending(pending, scopeOf(pending));
  if (!matchingResult(parseUnchanged(planContextSaveResultSchema, receipt), checked)) throw new Error("This receipt does not confirm the retained request.");
  const key = recordKey(checked), raw = JSON.stringify(checked);
  if (storage.getItem(key) !== raw) throw new Error("The save is confirmed, but its browser copy changed. Keep both copies.");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("The save is confirmed, but its browser copy could not be cleared. Exact retry remains available.");
}

/** Preserve exact bytes before moving a record aside. Never clear a different or newer copy. */
export function preservePlanContextRecord(storage: PlanContextStorage, scope: PlanContextClientScope, record: PlanContextRecoveryRecord) {
  const checked = scopeSchema.parse(scope);
  if (!record.key.startsWith(prefix(checked)) || record.archived || storage.getItem(record.key) !== record.raw) throw new Error("This recovery copy changed. Read it again before preserving it.");
  const copyKey = `${prefix(checked)}copy:${crypto.randomUUID()}`;
  if (storage.getItem(copyKey) !== null) throw new Error("A recovery copy already uses this identifier.");
  storage.setItem(copyKey, record.raw);
  if (storage.getItem(copyKey) !== record.raw || storage.getItem(record.key) !== record.raw) throw new Error("The copy could not be verified. The original stays in place.");
  storage.removeItem(record.key);
  if (storage.getItem(record.key) !== null) throw new Error("The copy is preserved, but the original could not be moved aside.");
}

export function makePlanContextDraft(scope: PlanContextClientScope, base: PlanContextBase, draft: PlanContextDraft, instanceId: string): StoredPlanContextDraft {
  return draftSchema.parse({ ...scope, base, draft, instanceId, schemaVersion: 1, kind: "draft", savedAt: new Date().toISOString() });
}
