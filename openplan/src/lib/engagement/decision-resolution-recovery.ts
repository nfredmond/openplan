import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { decisionResolutionIntentSchema, decisionResolutionScopeSchema, readDecisionResolution } from "./decision-request-resolution";
import type { DecisionResolutionPacket, DecisionResolutionScope } from "./decision-request-resolution";
import type { DecisionStorage } from "./pending-decision-link";

const uuid = z.string().uuid();
const scopeKey = (scope: DecisionResolutionScope) => `${scope.actorId}:${scope.workspaceId}:${scope.campaignId}:`;
export const decisionResolutionPrefix = (scope: DecisionResolutionScope) => `openplan:decision-resolution:${scopeKey(scope)}`;
const archivePrefix = (scope: DecisionResolutionScope) => `openplan:decision-resolution-archive:${scopeKey(scope)}`;
const requestPrefix = (scope: DecisionResolutionScope) => `openplan:decision-link:${scopeKey(scope)}`;
const same = (left: unknown, right: unknown) => canonicalizeActionPayload(left) === canonicalizeActionPayload(right);

/** Recover identity only from keys owned by this account, workspace and campaign. */
export function decisionResolutionRequestId(key: string, scope: DecisionResolutionScope) {
  decisionResolutionScopeSchema.parse({ campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: scope.actorId });
  if (key.startsWith(requestPrefix(scope))) return uuid.parse(key.slice(requestPrefix(scope).length));
  if (key.startsWith(decisionResolutionPrefix(scope))) {
    const parts = key.slice(decisionResolutionPrefix(scope).length).split(":");
    if (parts.length !== 2) throw new Error("Decision recovery key differs");
    uuid.parse(parts[1]); return uuid.parse(parts[0]);
  }
  throw new Error("Decision recovery copy belongs to a different scope");
}
export const pendingDecisionResolutionSchema = decisionResolutionScopeSchema.extend({
  version: z.literal(1), createdAt: z.string().datetime({ offset: true }), sourceKey: z.string(),
  intents: z.array(decisionResolutionIntentSchema).min(1).max(2),
}).strict().superRefine((value, context) => {
  try {
    const requestId = decisionResolutionRequestId(value.sourceKey, value);
    if (value.sourceKey === decisionResolutionPrefix(value) + requestId + ":" + value.intents[0].resolutionId
      || value.intents.some(intent => intent.requestId !== requestId)
      || new Set(value.intents.map(intent => intent.resolutionId)).size !== value.intents.length
      || new Set(value.intents.map(intent => intent.copyJson)).size !== value.intents.length) throw new Error();
  } catch { context.addIssue({ code: "custom", message: "Decision recovery bundle differs from its original request" }); }
});
export type PendingDecisionResolution = z.infer<typeof pendingDecisionResolutionSchema>;
export const pendingDecisionResolutionKey = (value: PendingDecisionResolution) => decisionResolutionPrefix(value) + value.intents[0].requestId + ":" + value.intents[0].resolutionId;
export const decisionResolutionHasCopy = (value: PendingDecisionResolution, raw: string) => value.intents.some(intent => JSON.parse(intent.copyJson) === raw);

/** Freeze both surviving copies before resolving; an intact foreign scope is never reattributed. */
export function prepareDecisionResolution(storage: DecisionStorage, scope: DecisionResolutionScope, key: string, reason: string, pageCopy?: string) {
  const requestId = decisionResolutionRequestId(key, scope), raw = storage.getItem(key);
  const copies = raw === null ? [] : [raw];
  if (pageCopy !== undefined && !copies.includes(pageCopy)) copies.push(pageCopy);
  if (copies.length === 0) throw new Error("Original decision recovery copy is unavailable");
  for (const copy of copies) {
    let value: unknown;
    try { value = JSON.parse(copy); } catch { continue; }
    const parsedScope = decisionResolutionScopeSchema.safeParse(value && typeof value === "object" ? {
      campaignId: Reflect.get(value, "campaignId"), workspaceId: Reflect.get(value, "workspaceId"), actorId: Reflect.get(value, "actorId"),
    } : null);
    if (parsedScope.success && !same(parsedScope.data, scope)) throw new Error("Original decision recovery scope differs");
    const resolution = pendingDecisionResolutionSchema.safeParse(value);
    if (resolution.success && pendingDecisionResolutionKey(resolution.data) !== key) throw new Error("Original resolution identity differs");
    const request = z.object({ intent: z.object({ requestId: uuid }) }).safeParse(value);
    if (request.success && request.data.intent.requestId !== requestId) throw new Error("Original decision request identity differs");
  }
  return pendingDecisionResolutionSchema.parse({ version: 1, ...scope, sourceKey: key, createdAt: new Date().toISOString(),
    intents: copies.map(copy => ({ resolutionId: crypto.randomUUID(), requestId, copyJson: JSON.stringify(copy), reason })) });
}

export function retainDecisionResolution(storage: DecisionStorage, raw: PendingDecisionResolution) {
  const value = pendingDecisionResolutionSchema.parse(raw), key = pendingDecisionResolutionKey(value), old = storage.getItem(key);
  if (old !== null && !same(pendingDecisionResolutionSchema.parse(JSON.parse(old)), value)) throw new Error("A different decision resolution is already retained");
  const bytes = JSON.stringify(value); storage.setItem(key, bytes);
  if (storage.getItem(key) !== bytes) throw new Error("Decision resolution was not retained");
  return value;
}
export function readDecisionResolutionRecovery(storage: DecisionStorage, scope: DecisionResolutionScope) {
  decisionResolutionScopeSchema.parse({ campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: scope.actorId });
  const pending: PendingDecisionResolution[] = [], unreadable: string[] = [], archives: Array<{ key: string; raw: string }> = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null);
  for (const key of keys) {
    if (key.startsWith(archivePrefix(scope))) { const raw = storage.getItem(key); if (raw !== null) archives.push({ key, raw }); continue; }
    if (!key.startsWith(decisionResolutionPrefix(scope))) continue;
    try {
      const raw = storage.getItem(key); if (raw === null) continue;
      const value = pendingDecisionResolutionSchema.parse(JSON.parse(raw));
      if (pendingDecisionResolutionKey(value) !== key || !same({ campaignId: value.campaignId, workspaceId: value.workspaceId, actorId: value.actorId }, scope)) throw new Error();
      pending.push(value);
    } catch { unreadable.push(key); }
  }
  return { pending, unreadable, archives };
}

/** Retire only matching bytes after every receipt and the durable archive are verified. */
export async function archiveDecisionResolution(storage: DecisionStorage, raw: PendingDecisionResolution, packets: DecisionResolutionPacket[], assertCurrent: () => void) {
  const value = pendingDecisionResolutionSchema.parse(raw);
  if (packets.length !== value.intents.length) throw new Error("Decision recovery receipt inventory differs");
  for (let index = 0; index < packets.length; index++) await readDecisionResolution(packets[index], { campaignId: value.campaignId, workspaceId: value.workspaceId, actorId: value.actorId }, value.intents[index]);
  assertCurrent();
  const key = pendingDecisionResolutionKey(value), pending = storage.getItem(key);
  if (pending === null || !same(pendingDecisionResolutionSchema.parse(JSON.parse(pending)), value)) throw new Error("Retained decision resolution changed");
  const archive = archivePrefix(value) + value.intents[0].requestId + ":" + value.intents[0].resolutionId;
  const bytes = JSON.stringify({ version: 1, request: value, receipts: packets.map(packet => ({ ...packet, replayed: false })) });
  const old = storage.getItem(archive);
  if (old !== null && old !== bytes) throw new Error("An earlier decision recovery archive differs");
  storage.setItem(archive, bytes);
  if (storage.getItem(archive) !== bytes || storage.getItem(key) !== pending) throw new Error("Decision recovery archive readback differs");
  assertCurrent();
  const currentSource = storage.getItem(value.sourceKey);
  if (currentSource !== null && decisionResolutionHasCopy(value, currentSource)) {
    storage.removeItem(value.sourceKey);
    if (storage.getItem(value.sourceKey) !== null) throw new Error("Original decision recovery copy could not be retired");
  }
  if (storage.getItem(key) !== pending) throw new Error("Decision resolution changed before retirement");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Decision resolution could not be retired");
  return { archive, sourceChanged: currentSource !== null && !decisionResolutionHasCopy(value, currentSource) };
}
