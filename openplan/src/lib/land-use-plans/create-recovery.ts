import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { studyAreaCaptureSchema } from "@/lib/geographies/study-area-capture";
import { assessmentFromDraft, planContextDraftSchema } from "./plan-context-draft";
import { matchesPlanCreation, planCreationCommandSchema, planCreationResultSchema, serializePlanCreation, type PlanCreationScope } from "./create-command";
import { creationStopResultSchema, verifyCreationStop, type CreationStopResult } from "./create-stop";

const scopeSchema = z.object({ actorId: z.string().uuid(), workspaceId: z.string().uuid() }).strict();
const fieldsSchema = z.object({
  title: z.string().max(180), authorityLabel: z.string().max(180),
  descriptorId: z.string().min(1).max(120), planKindKey: z.string().min(1).max(120),
  descriptorHash: z.string().regex(/^[a-f0-9]{64}$/), context: planContextDraftSchema,
}).strict();
export type PlanCreationFields = z.infer<typeof fieldsSchema>;
const draftSchema = scopeSchema.extend({ schemaVersion: z.literal(1), kind: z.literal("draft"),
  instanceId: z.string().uuid(), savedAt: z.iso.datetime(), fields: fieldsSchema }).strict();
export type CreationDraft = z.infer<typeof draftSchema>;
const pendingSchema = scopeSchema.extend({ schemaVersion: z.literal(1), kind: z.literal("pending"),
  draft: draftSchema, commandText: z.string().min(2).max(2_000_000), stopRequested: z.literal(true).optional(),
  importedResult: z.union([planCreationResultSchema, creationStopResultSchema]).optional() }).strict();
export type CreationPending = z.infer<typeof pendingSchema>;
const confirmedSchema = pendingSchema.extend({ kind: z.literal("confirmed"), result: planCreationResultSchema }).strict();
export type CreationConfirmed = z.infer<typeof confirmedSchema>;
const cancelledSchema = pendingSchema.extend({ kind: z.literal("cancelled"), stopRequested: z.literal(true), result: creationStopResultSchema }).strict();
type Value = CreationDraft | CreationPending | CreationConfirmed | z.infer<typeof cancelledSchema>;
export type CreationRecord = { key: string; raw: string; value: Value | null };
type Store = Pick<Storage, "length" | "key" | "getItem" | "setItem">;
const same = (a: unknown, b: unknown) => canonicalizeActionPayload(a) === canonicalizeActionPayload(b);
const scopeOf = (v: PlanCreationScope) => scopeSchema.parse({ actorId: v.actorId, workspaceId: v.workspaceId });
const prefix = (v: PlanCreationScope) => `openplan:plan-creation:${v.actorId}:${v.workspaceId}:`;
const keyOf = (v: Value) => v.kind === "draft" ? `${prefix(v)}draft:${v.instanceId}`
  : `${prefix(v)}command:${planCreationCommandSchema.parse(JSON.parse(v.commandText)).commandId}`;
function unchanged<T>(schema: z.ZodType<T>, raw: unknown): T {
  const value = schema.parse(raw);
  if (!same(value, raw)) throw new Error("The saved copy changed during validation. Keep it for review.");
  return value;
}

/** Normalize only before capture. Incomplete drafts never become executable requests. */
export function creationCommandFromDraft(draft: CreationDraft, commandId: string) {
  const { fields } = unchanged(draftSchema, draft), area = fields.context.place;
  const place = studyAreaCaptureSchema.parse(area.mode === "place"
    ? { mode: area.mode, label: area.label, kind: area.kind, geoid: area.geoid }
    : { mode: area.mode, label: area.label, geometry: JSON.parse(area.geometryText) });
  return planCreationCommandSchema.parse({ commandId, title: fields.title, authorityLabel: fields.authorityLabel,
    descriptorId: fields.descriptorId, planKindKey: fields.planKindKey, expectedDescriptorHash: fields.descriptorHash,
    place, assessment: assessmentFromDraft(fields.context) });
}

function parseRecord(raw: string, scope: PlanCreationScope): Value {
  if (new TextEncoder().encode(raw).length > 12_000_000) throw new Error("This saved copy exceeds the recovery size limit.");
  const value = unchanged(z.discriminatedUnion("kind", [draftSchema, pendingSchema, confirmedSchema, cancelledSchema]), JSON.parse(raw));
  if (!same(scopeOf(value), scopeOf(scope))) throw new Error("This copy belongs to another account or workspace.");
  if (value.kind !== "draft") {
    if (!same(scopeOf(value.draft), scopeOf(scope))) throw new Error("The retained draft has another owner.");
    if (new TextEncoder().encode(value.commandText).length > 2_000_000) throw new Error("The retained request exceeds the creation size limit.");
    const command = unchanged(planCreationCommandSchema, JSON.parse(value.commandText));
    if (!same(command, creationCommandFromDraft(value.draft, command.commandId))) throw new Error("The request does not match its original draft.");
    if (value.kind === "confirmed" && !matchesPlanCreation(value.result, command, scope)) throw new Error("The receipt does not match its retained request.");
    if (value.kind === "cancelled" && verifyCreationStop(value.result, scope, value.commandText).outcome !== "cancelled") throw new Error("A stopped copy requires a matching stop receipt.");
  }
  return value;
}

/** Inspect without sending or repairing anything, including unreadable copies. */
export function readCreationRecords(storage: Store, scope: PlanCreationScope): CreationRecord[] {
  const checked = scopeSchema.parse(scope);
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(prefix(checked)))).sort();
  return keys.flatMap(key => {
    const raw = storage.getItem(key);
    if (raw === null) return [];
    let value: Value | null = null;
    try { const parsed = parseRecord(raw, checked); if (keyOf(parsed) === key) value = parsed; } catch { /* Preserve unreadable bytes. */ }
    return [{ key, raw, value }];
  });
}

/** Each page owns a draft key. Compare exact bytes before overwriting that key. */
export function saveCreationDraft(storage: Store, input: CreationDraft, previousRaw: string | null): CreationRecord {
  const raw = JSON.stringify(input), value = parseRecord(raw, scopeOf(input)), key = keyOf(value);
  if (value.kind !== "draft") throw new Error("Only an owned draft can be edited.");
  if (storage.getItem(key) !== previousRaw) throw new Error("This draft changed in another page. Keep your text and download a copy.");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("The browser could not retain this draft. Download a copy before leaving.");
  return { key, raw, value };
}

/** Retain the original request before transport. Never replace a different command copy. */
export function retainCreationRequest(storage: Store, draft: CreationDraft, commandId: string): CreationPending {
  const input: CreationPending = { ...scopeOf(draft), schemaVersion: 1, kind: "pending", draft,
    commandText: serializePlanCreation(creationCommandFromDraft(draft, commandId)) };
  importCreationRecord(storage, scopeOf(draft), JSON.stringify(input));
  return input;
}

/** Import preserves scope and identity. A different existing copy must be reviewed separately. */
export function importCreationRecord(storage: Store, scope: PlanCreationScope, raw: string): Value {
  const parsed = parseRecord(raw, scope);
  // A file is a recovery aid, not current proof that creation happened or stopped.
  // Reconfirm terminal files through the stop command, which cannot create a plan.
  const value = parsed.kind === "confirmed" || parsed.kind === "cancelled"
    ? pendingSchema.parse({ ...scopeOf(parsed), schemaVersion: 1, kind: "pending", draft: parsed.draft,
      commandText: parsed.commandText, stopRequested: true, importedResult: parsed.result }) : parsed;
  const key = keyOf(value), existing = storage.getItem(key), retained = JSON.stringify(value);
  if (existing !== null && existing !== retained) throw new Error("Another saved copy uses this identity. Keep both files for review.");
  storage.setItem(key, retained);
  if (storage.getItem(key) !== retained) throw new Error("The request could not be retained. Nothing was sent.");
  return value;
}

/** Explicit retries use retained bytes and leave them in place until a matching receipt is saved. */
export async function sendCreationRequest(storage: Store, input: CreationPending, transport: typeof fetch = fetch, signal?: AbortSignal) {
  const raw = JSON.stringify(input), value = parseRecord(raw, scopeOf(input));
  if (value.kind !== "pending" || value.stopRequested || storage.getItem(keyOf(value)) !== raw) throw new Error("The retained request changed or is being stopped. Read its copy before retrying.");
  const active = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  active.throwIfAborted();
  const response = await transport("/api/land-use-plans", { method: "POST", cache: "no-store", signal: active,
    headers: { "Content-Type": "application/json", "x-openplan-expected-user": value.actorId, "x-openplan-expected-workspace": value.workspaceId }, body: value.commandText });
  active.throwIfAborted();
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "Check the account and current staff access. The original request remains saved."
    : response.status === 409 ? "Creation is not confirmed. Keep this request and retry it before starting another plan. A rules or request conflict may need review."
      : "Creation is unconfirmed. Keep the original request and retry it after checking the connection.");
  const result = unchanged(planCreationResultSchema, await response.json()); active.throwIfAborted();
  if (response.status !== (result.replayed ? 200 : 201) || !matchesPlanCreation(result, planCreationCommandSchema.parse(JSON.parse(value.commandText)), scopeOf(value))) {
    throw new Error("The reply does not match the retained creation request. Keep it for recovery.");
  }
  return result;
}

/** Keep the confirmed receipt and its original draft. Never clear a newer or unknown copy. */
export function confirmCreationRequest(storage: Store, pending: CreationPending, result: CreationConfirmed["result"]): CreationConfirmed {
  const raw = JSON.stringify({ ...pending, kind: "confirmed", result }), value = parseRecord(raw, scopeOf(pending));
  if (value.kind !== "confirmed") throw new Error("A confirmed receipt is required.");
  const key = keyOf(value);
  if (storage.getItem(key) !== JSON.stringify(pending)) throw new Error("Creation succeeded, but its saved copy changed. Keep both copies.");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Creation succeeded, but the browser could not retain its receipt. Exact retry remains available.");
  return value;
}

/** Retain explicit stop intent first so reload cannot offer creation again while stop is uncertain. */
export function retainCreationStop(storage: Store, pending: CreationPending): CreationPending {
  const original = JSON.stringify(pending), checked = parseRecord(original, scopeOf(pending));
  if (checked.kind !== "pending" || storage.getItem(keyOf(checked)) !== original) throw new Error("The request changed. Read its saved copy before stopping it.");
  const value: CreationPending = { ...checked, stopRequested: true }, raw = JSON.stringify(value);
  storage.setItem(keyOf(value), raw);
  if (storage.getItem(keyOf(value)) !== raw) throw new Error("Stop intent could not be saved. Nothing was sent.");
  return value;
}

export async function sendCreationStop(storage: Store, input: CreationPending, transport: typeof fetch = fetch, signal?: AbortSignal): Promise<CreationStopResult> {
  const raw = JSON.stringify(input), value = parseRecord(raw, scopeOf(input));
  if (value.kind !== "pending" || !value.stopRequested || storage.getItem(keyOf(value)) !== raw) throw new Error("A retained stop request is required.");
  const command = planCreationCommandSchema.parse(JSON.parse(value.commandText));
  const active = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]); active.throwIfAborted();
  const response = await transport(`/api/land-use-plans/creation-requests/${command.commandId}/stop`, {
    method: "POST", cache: "no-store", signal: active, body: value.commandText,
    headers: { "Content-Type": "application/json", "x-openplan-expected-user": value.actorId, "x-openplan-expected-workspace": value.workspaceId },
  });
  active.throwIfAborted();
  if (response.status !== 200) throw new Error("Stopping is unconfirmed. Keep the saved request and retry the stop action with current staff access.");
  const result = verifyCreationStop(await response.json(), scopeOf(value), value.commandText); active.throwIfAborted(); return result;
}

export function confirmCreationStop(storage: Store, pending: CreationPending, receipt: CreationStopResult) {
  const result = verifyCreationStop(receipt, scopeOf(pending), pending.commandText);
  if (!pending.stopRequested) throw new Error("This request has no retained stop intent.");
  if (result.outcome === "created") return confirmCreationRequest(storage, pending, result.result);
  const raw = JSON.stringify({ ...pending, kind: "cancelled", result }), value = parseRecord(raw, scopeOf(pending)), key = keyOf(value);
  if (storage.getItem(key) !== JSON.stringify(pending)) throw new Error("Stopping succeeded, but the saved request changed. Keep both copies.");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Stopping succeeded, but its receipt could not be retained. Retry the stop action.");
  return value;
}
