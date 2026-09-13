import { z } from "zod";
import { translationPublicationEvidenceSchema } from "./translation-publication-reference";
import { translationSourceVersionSchema, translationVersionSchema } from "./translation-snapshot";

export const retainedTranslationSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  entity_type: z.enum(["campaign", "category", "survey_question", "survey_question_option", "close_loop_entry"]),
  entity_id: z.string().uuid(),
  field: z.string().min(1),
  locale: z.string().min(1),
  translated_text: z.string().min(1),
  source: z.enum(["operator", "machine"]),
  machine_model: z.string().nullable(),
  source_text_hash: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const translationHistoryMetadataSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  translation_id: z.string().uuid(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  actor_id: z.string().uuid().nullable(),
  recorded_at: z.string().datetime({ offset: true }),
  event: z.enum(["legacy_baseline", "created", "corrected", "accepted", "removed"]),
  record_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  write_request_id: z.string().uuid().nullable(),
});

export const translationHistoryChangeSchema = z.object({
  requestId: z.string().uuid(), operation: z.enum(["save", "accept", "withdraw", "publish_generated"]), reason: z.string().nullable(),
  source: translationSourceVersionSchema, expectedTranslation: translationVersionSchema.nullable(),
  generation: translationPublicationEvidenceSchema.optional(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/), resultSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const translationHistoryEntrySchema = translationHistoryMetadataSchema.extend({
  record: retainedTranslationSchema, change: translationHistoryChangeSchema.nullable(),
}).superRefine((row, context) => {
  if (row.change && (row.change.operation === "publish_generated") !== (row.change.generation !== undefined)) {
    context.addIssue({ code: "custom", path: ["change"], message: "Publication generation evidence is incomplete or unrelated" });
  }
  if (row.write_request_id !== (row.change?.requestId ?? null)) {
    context.addIssue({ code: "custom", path: ["change"], message: "History request evidence is incomplete" });
  }
});
export type TranslationHistoryEntry = z.infer<typeof translationHistoryEntrySchema>;
