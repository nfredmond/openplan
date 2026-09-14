import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { translationGenerationRequestSchema, translationGenerationReadSchema, type TranslationGenerationRead } from "./translation-generation-request";
import { translationSnapshotSource, type TranslationSnapshot, type TranslationAddress } from "./translation-snapshot";
import { translationHistoryEntrySchema } from "./translation-history";
import { pendingTranslationSchema, type TranslationStorage } from "./pending-translation";

export const pendingGenerationSchema = z.object({ version: z.literal(1), userId: z.string().uuid(), workspaceId: z.string().uuid(), campaignId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }), phase: z.enum(["unconfirmed", "refused"]), intent: translationGenerationRequestSchema,
}).strict();
export type PendingGeneration = z.infer<typeof pendingGenerationSchema>;
export type GenerationEditorScope = Pick<PendingGeneration, "userId" | "workspaceId" | "campaignId">;
const prefix = (scope: Pick<GenerationEditorScope, "userId" | "campaignId">) => `openplan:translation-generation:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.campaignId)}:`;
export const generationArchivePrefix = (scope: GenerationEditorScope) => `openplan:translation-generation-archive:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.campaignId)}:`;
export const pendingGenerationKey = (pending: PendingGeneration) => prefix(pending) + pending.intent.requestId;
function identity(pending: PendingGeneration) { const { phase: _phase, ...fixed } = pending; return canonicalizeActionPayload(fixed); }

/** Freeze source and saved versions before creating one generation identity. */
export function prepareTranslationGeneration(scope: GenerationEditorScope, snapshot: TranslationSnapshot, addresses: TranslationAddress[], locale: string): PendingGeneration {
  if (snapshot.campaignId !== scope.campaignId) throw new Error("Generation snapshot belongs to another campaign");
  const fields = addresses.map(address => {
    const expectedSource = translationSnapshotSource(snapshot, address);
    if (!expectedSource) throw new Error("Generation source is unavailable");
    const before = snapshot.translations.find(row => row.entity_type === address.entityType && row.entity_id === address.entityId && row.field === address.field && row.locale === locale);
    return { id: crypto.randomUUID(), address: { ...address, expectedSource, expectedTranslation: before ? { id: before.id, revision: before.revision } : null } };
  });
  return pendingGenerationSchema.parse({ version: 1, ...scope, createdAt: new Date().toISOString(), phase: "unconfirmed", intent: { requestId: crypto.randomUUID(), locale, fields } });
}

export function retainPendingGeneration(storage: TranslationStorage, proposed: PendingGeneration) {
  const value = pendingGenerationSchema.parse(proposed), key = pendingGenerationKey(value), old = storage.getItem(key);
  if (old !== null && identity(pendingGenerationSchema.parse(JSON.parse(old))) !== identity(value)) throw new Error("Another generation request is retained here");
  const raw = JSON.stringify(value); storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Generation request was not retained");
  return value;
}
export function readPendingGenerations(storage: TranslationStorage, scope: GenerationEditorScope) {
  const pending: PendingGeneration[] = [], unreadable: string[] = [];
  const keys = new Set<string>();
  for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key?.startsWith(prefix(scope))) keys.add(key); }
  for (const key of keys) {
    const raw = storage.getItem(key); if (raw === null) continue;
    try {
      const value = pendingGenerationSchema.parse(JSON.parse(raw));
      if (value.workspaceId !== scope.workspaceId || pendingGenerationKey(value) !== key) throw new Error("Generation recovery scope differs");
      pending.push(value);
    } catch { unreadable.push(key); }
  }
  pending.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.intent.requestId.localeCompare(b.intent.requestId));
  return { pending, unreadable };
}
export function clearPendingGeneration(storage: TranslationStorage, pending: PendingGeneration) {
  const key = pendingGenerationKey(pending), raw = storage.getItem(key);
  if (raw !== null && identity(pendingGenerationSchema.parse(JSON.parse(raw))) !== identity(pending)) throw new Error("Generation recovery payload changed");
  storage.removeItem(key); if (storage.getItem(key) !== null) throw new Error("Generation recovery could not be cleared");
}
/** Archive exact bytes before allowing a refused or unreadable request to be set aside. */
export function archivePendingGeneration(storage: TranslationStorage, key: string, scope: GenerationEditorScope) {
  if (!key.startsWith(prefix(scope))) throw new Error("Generation recovery key belongs to another scope");
  const raw = storage.getItem(key); if (raw === null) throw new Error("Generation recovery copy is unavailable");
  const archive = generationArchivePrefix(scope) + crypto.randomUUID();
  storage.setItem(archive, raw);
  if (storage.getItem(archive) !== raw || storage.getItem(key) !== raw) throw new Error("Generation recovery archive differs");
  storage.removeItem(key); if (storage.getItem(key) !== null) throw new Error("Generation recovery could not be archived");
  return archive;
}

/** The HTTP reader has already checked the output packet; bind its safe DTO to the selected request. */
export function readViewedTranslationGeneration(raw: unknown, scope: { campaignId: string; workspaceId: string; requestId: string }, pending?: PendingGeneration) {
  const value = translationGenerationReadSchema.parse(raw);
  if (value.requestId !== scope.requestId || value.campaignId !== scope.campaignId || value.workspaceId !== scope.workspaceId ||
    new Set(value.fields.map(field => field.id)).size !== value.fields.length ||
    new Set(value.fields.map(field => canonicalizeActionPayload({ entityType: field.address.entityType, entityId: field.address.entityId, field: field.address.field }))).size !== value.fields.length) {
    throw new Error("Generation read differs from the selected request");
  }
  if (pending) {
    const retained = pendingGenerationSchema.parse(pending);
    if (retained.campaignId !== scope.campaignId || retained.workspaceId !== scope.workspaceId || retained.intent.requestId !== scope.requestId ||
      retained.userId !== value.actorId || retained.intent.locale !== value.locale || retained.intent.fields.length !== value.fields.length ||
      retained.intent.fields.some(wanted => !value.fields.some(field => field.id === wanted.id && canonicalizeActionPayload(field.address) === canonicalizeActionPayload(wanted.address)))) {
      throw new Error("Generation acknowledgement differs from the retained intent");
    }
  }
  return value;
}

/** Recover the original saved version from verified private history, never the current replacement. */
export function prepareRetainedPublication(scope: GenerationEditorScope, viewed: TranslationGenerationRead, fieldIds: string[], reason: string, history: unknown) {
  const request = readViewedTranslationGeneration(viewed, { ...scope, requestId: viewed.requestId });
  const rows = translationHistoryEntrySchema.array().parse(history);
  if (rows.some(row => row.campaign_id !== scope.campaignId || row.record.campaign_id !== scope.campaignId || row.record.workspace_id !== scope.workspaceId || row.record.id !== row.translation_id)) {
    throw new Error("Publication history belongs to another scope");
  }
  const selected = fieldIds.map(id => {
    const field = request.fields.find(field => field.id === id);
    if (!field || !field.attemptId || !field.output) throw new Error("Select retained completed output");
    return field;
  });
  const before = selected.map(field => {
    const expected = field.address.expectedTranslation; if (!expected) return null;
    const matches = rows.filter(row => row.translation_id === expected.id && row.revision === expected.revision);
    if (matches.length !== 1 || matches[0].event === "removed") throw new Error("Original translation baseline could not be recovered");
    return { entry: matches[0].record, revision: matches[0].revision };
  });
  return pendingTranslationSchema.parse({ version: 1, ...scope, createdAt: new Date().toISOString(), phase: "unconfirmed", before, retained: [request],
    intent: { operation: "publish_generated", requestId: crypto.randomUUID(), locale: request.locale, reason,
      entries: selected.map(field => ({ ...field.address, generation: { requestId: request.requestId, fieldId: field.id, attemptId: field.attemptId, deliveryDigest: field.output!.deliveryDigest } })) } });
}
