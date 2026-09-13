import { z } from "zod";
import { translationSourceVersionSchema } from "./translation-snapshot";
import { translationSavedRowSchema } from "./translation-write";

const uuid = z.string().uuid();
export const translationDraftSchema = z.object({
  locale: translationSavedRowSchema.shape.locale, entityType: translationSavedRowSchema.shape.entity_type,
  entityId: uuid, field: z.string(), text: z.string(), source: translationSourceVersionSchema,
  before: z.object({ entry: translationSavedRowSchema, revision: z.number().int().positive() }).strict().nullable(),
}).strict();
export type TranslationDraft = z.infer<typeof translationDraftSchema>;
export const translationDraftRecordSchema = z.object({ version: z.literal(1), userId: uuid, workspaceId: uuid, campaignId: uuid,
  reason: z.string(), entries: z.array(translationDraftSchema),
}).strict().superRefine((record, context) => {
  const keys = new Set<string>();
  for (const [index, draft] of record.entries.entries()) {
    const key = translationDraftKey(draft);
    const row = draft.before?.entry;
    if (keys.has(key) || row && (row.campaign_id !== record.campaignId || row.workspace_id !== record.workspaceId || row.locale !== draft.locale
      || row.entity_type !== draft.entityType || row.entity_id !== draft.entityId || row.field !== draft.field)) {
      context.addIssue({ code: "custom", path: ["entries", index], message: "Draft scope or original copy differs" });
    }
    keys.add(key);
  }
});
export type TranslationDraftRecord = z.infer<typeof translationDraftRecordSchema>;
export type TranslationDraftScope = Pick<TranslationDraftRecord, "userId" | "workspaceId" | "campaignId">;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function translationDraftKey(draft: Pick<TranslationDraft, "locale" | "entityType" | "entityId" | "field">) {
  return `${draft.locale}::${draft.entityType}:${draft.entityId}:${draft.field}`;
}
export function translationDraftStorageKey(scope: TranslationDraftScope) {
  return `openplan:translation-drafts:${scope.userId}:${scope.workspaceId}:${scope.campaignId}`;
}
export function readTranslationDrafts(storage: DraftStorage, scope: TranslationDraftScope): TranslationDraftRecord {
  const raw = storage.getItem(translationDraftStorageKey(scope));
  if (raw === null) return { version: 1, ...scope, reason: "", entries: [] };
  const record = translationDraftRecordSchema.parse(JSON.parse(raw));
  if (record.userId !== scope.userId || record.workspaceId !== scope.workspaceId || record.campaignId !== scope.campaignId) throw new Error("Draft belongs to another editor");
  return record;
}
export function retainTranslationDrafts(storage: DraftStorage, record: TranslationDraftRecord) {
  const parsed = translationDraftRecordSchema.parse(record);
  const key = translationDraftStorageKey(parsed), raw = JSON.stringify(parsed);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Draft was not retained");
  return parsed;
}
/** Keep the exact damaged or abandoned draft before starting another editor copy. */
export function archiveTranslationDrafts(storage: DraftStorage, scope: TranslationDraftScope) {
  const key = translationDraftStorageKey(scope), raw = storage.getItem(key);
  if (raw === null) return;
  const archive = key + ":archive:" + crypto.randomUUID();
  storage.setItem(archive, raw);
  if (storage.getItem(archive) !== raw || storage.getItem(key) !== raw) throw new Error("Draft archive failed or active copy changed");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Active draft was not cleared");
}
