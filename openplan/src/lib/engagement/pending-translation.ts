import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { readTranslationWriteResult, translationSavedRowSchema, translationWriteIntentSchema, type TranslationWriteResult } from "./translation-write";

import { readTranslationPublicationSelection, readTranslationPublicationResult, translationPublicationIntentSchema, type TranslationPublicationResult } from "./translation-publication";
import { translationGenerationReadSchema } from "./translation-generation-request";

const commonPending = {
  version: z.literal(1), userId: z.string().uuid(), workspaceId: z.string().uuid(), campaignId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }), phase: z.enum(["unconfirmed", "conflict", "rejected"]),
  before: z.array(z.object({ entry: translationSavedRowSchema, revision: z.number().int().positive() }).strict().nullable()),
};
export const pendingTranslationSchema = z.union([
  z.object({ ...commonPending, intent: translationWriteIntentSchema }).strict(),
  z.object({ ...commonPending, intent: translationPublicationIntentSchema,
    retained: z.array(translationGenerationReadSchema).min(1).max(200),
  }).strict(),
]).superRefine((pending, context) => {
  if ("retained" in pending) {
    try { readTranslationPublicationSelection(pending, pending.intent, pending.retained); }
    catch { context.addIssue({ code: "custom", path: ["retained"], message: "Publication needs the exact viewed output and original source and saved version" }); }
  }
  if (pending.before.length !== pending.intent.entries.length) {
    context.addIssue({ code: "custom", path: ["before"], message: "Each requested translation needs its observed baseline" });
    return;
  }
  for (const [index, requested] of pending.intent.entries.entries()) {
    const baseline = pending.before[index];
    const expected = requested.expectedTranslation;
    const row = baseline?.entry;
    if (expected === null ? baseline !== null : !row || baseline?.revision !== expected.revision || row.id !== expected.id
      || row.campaign_id !== pending.campaignId || row.workspace_id !== pending.workspaceId || row.locale !== pending.intent.locale
      || row.entity_type !== requested.entityType || row.entity_id !== requested.entityId || row.field !== requested.field) {
      context.addIssue({ code: "custom", path: ["before", index], message: "The observed baseline does not match the exact requested version" });
    }
    if (pending.intent.operation === "accept" && row?.source !== "machine") {
      context.addIssue({ code: "custom", path: ["before", index], message: "Only observed machine wording can be accepted" });
    }
  }
});
export type PendingTranslation = z.infer<typeof pendingTranslationSchema>;
export type PendingTranslationResult = TranslationWriteResult | TranslationPublicationResult;
export type TranslationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function prefix(userId: string, campaignId: string) {
  return `openplan:translation-write:${encodeURIComponent(userId)}:${encodeURIComponent(campaignId)}:`;
}
export function pendingTranslationKey(pending: Pick<PendingTranslation, "userId" | "campaignId" | "intent">) {
  return prefix(pending.userId, pending.campaignId) + pending.intent.requestId;
}
function identity(pending: PendingTranslation) {
  const { phase: _phase, ...fixed } = pending;
  return canonicalizeActionPayload(fixed);
}

/** Each request has its own key, so a second tab cannot replace another request's proposed words. */
export function retainPendingTranslation(storage: TranslationStorage, value: PendingTranslation): PendingTranslation {
  const pending = pendingTranslationSchema.parse(value);
  const key = pendingTranslationKey(pending);
  const old = storage.getItem(key);
  if (old !== null && identity(pendingTranslationSchema.parse(JSON.parse(old))) !== identity(pending)) {
    throw new Error("This recovery key already retains a different request");
  }
  const serialized = JSON.stringify(pending);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("Translation request was not retained");
  return pending;
}

/** Keep unreadable records visible for recovery; a damaged record is never treated as no pending work. */
export function readPendingTranslations(storage: TranslationStorage, userId: string, campaignId: string, workspaceId: string): {
  pending: PendingTranslation[]; unreadableKeys: string[];
} {
  const pending: PendingTranslation[] = [];
  const unreadableKeys: string[] = [];
  const keys = new Set<string>();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(prefix(userId, campaignId))) keys.add(key);
  }
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try {
      const value = pendingTranslationSchema.parse(JSON.parse(raw));
      if (value.workspaceId !== workspaceId || pendingTranslationKey(value) !== key) throw new Error("Recovery scope differs");
      pending.push(value);
    } catch { unreadableKeys.push(key); }
  }
  pending.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.intent.requestId.localeCompare(right.intent.requestId));
  return { pending, unreadableKeys };
}

/** Clear only the same frozen payload, including its baseline, after a confirmed save or retained archive. */
export function clearPendingTranslation(storage: TranslationStorage, pending: PendingTranslation) {
  const key = pendingTranslationKey(pending);
  const raw = storage.getItem(key);
  if (raw !== null && identity(pendingTranslationSchema.parse(JSON.parse(raw))) !== identity(pending)) throw new Error("Another translation payload is retained here");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Translation recovery record was not cleared");
}

/** Preserve the original bytes before removing an unreadable or resolved request from the active queue. */
export function archivePendingTranslation(storage: TranslationStorage, key: string, userId: string, campaignId: string): string | null {
  if (!key.startsWith(prefix(userId, campaignId))) throw new Error("Recovery key belongs to another campaign or user");
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const archiveKey = `openplan:translation-archive:${encodeURIComponent(userId)}:${encodeURIComponent(campaignId)}:${crypto.randomUUID()}`;
  storage.setItem(archiveKey, raw);
  if (storage.getItem(archiveKey) !== raw) throw new Error("Translation recovery archive was not retained");
  if (storage.getItem(key) !== raw) throw new Error("Translation recovery record changed during archiving");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Translation recovery record was not cleared after archiving");
  return archiveKey;
}

/** Acceptance and withdrawal must acknowledge the exact words the operator saw. */
export function confirmPendingTranslation(data: unknown, value: PendingTranslation): PendingTranslationResult {
  const pending = pendingTranslationSchema.parse(value);
  if ("retained" in pending) return readTranslationPublicationResult(data, { campaignId: pending.campaignId,
    workspaceId: pending.workspaceId, publisherId: pending.userId }, pending.intent, pending.retained);
  const result = readTranslationWriteResult(data, pending, pending.intent);
  for (const saved of result.entries) {
    const index = pending.intent.entries.findIndex(entry => entry.entityType === saved.entry.entity_type && entry.entityId === saved.entry.entity_id && entry.field === saved.entry.field);
    const before = pending.before[index];
    if (pending.intent.operation === "save") {
      if (saved.entry.created_by !== pending.userId) throw new Error("Saved translation actor differs");
      // Only a save with unchanged retained content may reuse its revision.
      // updated_at can advance without the history trigger recording a change.
      if (before && saved.revision === before.revision && ["translated_text", "source", "machine_model", "source_text_hash", "created_by"].some(
        field => saved.entry[field] !== before.entry[field],
      )) throw new Error("Changed translation was acknowledged without a new revision");
      continue;
    }
    if (!before || saved.entry.translated_text !== before.entry.translated_text || saved.entry.created_by !== before.entry.created_by
      || (pending.intent.operation === "withdraw" && (saved.entry.source !== before.entry.source || saved.entry.machine_model !== before.entry.machine_model))) {
      throw new Error("Acknowledged translation differs from the retained baseline");
    }
  }
  return result;
}

/** Display wording from an already parsed pending request without revalidating the entire batch for each row. */
export function pendingTranslationWords(pending: PendingTranslation, index: number): string | undefined {
  if ("retained" in pending) {
    const reference = pending.intent.entries[index]?.generation;
    return reference && pending.retained.find(request => request.requestId === reference.requestId)?.fields.find(field => field.id === reference.fieldId)?.output?.text;
  }
  const entry = pending.intent.entries[index];
  return entry && "text" in entry ? entry.text : pending.before[index]?.entry.translated_text;
}
