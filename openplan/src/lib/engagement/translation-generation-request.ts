import { z } from "zod";
import { translationSourceVersionSchema, translationVersionSchema } from "./translation-snapshot";
import { TRANSLATION_LANGUAGES, supportsMachineTranslation } from "./translation-languages";

export const TRANSLATION_GENERATION_BODY_LIMIT = 8 * 1024 * 1024;
export const translationGenerationAddressSchema = z.object({
  entityType: z.enum(["campaign", "category", "survey_question", "survey_question_option", "close_loop_entry"]),
  entityId: z.string().uuid(), field: z.string().min(1).max(50),
  expectedSource: translationSourceVersionSchema, expectedTranslation: translationVersionSchema.nullable(),
}).strict();
// Field IDs and observed versions are retained by the client with the request.
// The server supplies workspace, actor, model and credentials; retries keep the
// same exact intent instead of silently selecting the latest source or key.
export const translationGenerationRequestSchema = z.object({
  requestId: z.string().uuid(), locale: z.enum(TRANSLATION_LANGUAGES).refine(supportsMachineTranslation),
  fields: z.array(z.object({ id: z.string().uuid(), address: translationGenerationAddressSchema }).strict()).min(1).max(25),
}).strict().superRefine((body, ctx) => {
  const ids = new Set<string>(), addresses = new Set<string>();
  for (const [index, field] of body.fields.entries()) {
    const key = JSON.stringify([field.address.entityType, field.address.entityId, field.address.field]);
    const source = field.address.expectedSource;
    if (ids.has(field.id) || addresses.has(key) || !source.available || !source.text?.trim() || !source.text.isWellFormed() ||
      source.text.includes("\0") || new TextEncoder().encode(source.text).byteLength > 32000) {
      ctx.addIssue({ code: "custom", path: ["fields", index], message: "A unique field with complete, available source words is required" });
    }
    ids.add(field.id); addresses.add(key);
  }
});
export type TranslationGenerationRequest = z.infer<typeof translationGenerationRequestSchema>;
export const translationGenerationRequestAckSchema = z.object({
  requestId: z.string().uuid(), created: z.boolean(),
}).strict();

export const translationGenerationStateSchema = z.enum(["queued", "reserved", "running", "completed", "incomplete", "failed", "interrupted", "cancelled"]);
export const translationGenerationTerminalSchema = z.enum(["completed", "incomplete", "failed", "interrupted", "cancelled"]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const translationGenerationReadSchema = z.object({
  requestId: z.string().uuid(), campaignId: z.string().uuid(), workspaceId: z.string().uuid(), actorId: z.string().uuid(),
  locale: z.enum(TRANSLATION_LANGUAGES), createdAt: z.string().datetime({ offset: true }),
  fields: z.array(z.object({ id: z.string().uuid(), address: translationGenerationAddressSchema,
    state: translationGenerationStateSchema, attemptId: z.string().uuid().nullable(), failureCode: z.string().nullable(),
    output: z.object({ status: z.enum(["completed", "incomplete"]), text: z.string(), model: z.string(),
      sourceHash: digest, outputHash: digest, deliveryDigest: digest, acceptedState: translationGenerationTerminalSchema }).strict().nullable(),
  }).strict()).min(1).max(25),
}).strict();
export type TranslationGenerationRead = z.infer<typeof translationGenerationReadSchema>;
