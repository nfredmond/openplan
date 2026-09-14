import { z } from "zod";
import { TRANSLATION_LANGUAGES, supportsMachineTranslation } from "./translation-languages";
const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const publicTranslationIntentSchema = z.object({
  language: z.enum(TRANSLATION_LANGUAGES).refine(supportsMachineTranslation),
  sourceHash: hash,
  retryOf: id.optional(),
}).strict();
export type PublicTranslationIntent = z.infer<typeof publicTranslationIntentSchema>;
export const publicTranslationTextSchema = z.string().refine(text => text.trim().length > 0 && text.isWellFormed() && !text.includes("\0") && [...text].length <= 8000);
export const publicTranslationViewSchema = z.object({
  requestId: id, language: z.enum(TRANSLATION_LANGUAGES).refine(supportsMachineTranslation),
  state: z.enum(["queued", "reserved", "running", "completed", "incomplete", "failed", "interrupted", "cancelled"]),
  translated: z.string().nullable(),
}).strict().refine(value => value.state === "completed"
  ? publicTranslationTextSchema.safeParse(value.translated).success
  : value.translated === null);
export type PublicTranslationView = z.infer<typeof publicTranslationViewSchema>;

export const publicTranslationResponseSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("queue"), sourceHash: hash, request: publicTranslationViewSchema, created: z.boolean().optional() }).strict(),
  z.object({ source: z.literal("cache"), sourceHash: hash, language: z.enum(TRANSLATION_LANGUAGES), translated: publicTranslationTextSchema }).strict(),
  z.object({ source: z.literal("missing"), sourceHash: hash, language: z.enum(TRANSLATION_LANGUAGES), translated: z.null() }).strict(),
  z.object({ source: z.literal("unavailable"), sourceHash: hash, language: z.enum(TRANSLATION_LANGUAGES), translated: z.null(), caveat: z.string().min(1).max(1000) }).strict(),
]);
export type PublicTranslationResponse = z.infer<typeof publicTranslationResponseSchema>;
