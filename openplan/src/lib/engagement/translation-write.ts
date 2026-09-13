import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { translationSourceVersionSchema, translationVersionSchema } from "./translation-snapshot";

export const TRANSLATION_WRITE_BODY_LIMIT = 8 * 1024 * 1024;
export const TRANSLATION_WRITE_BATCH_MAX = 200;
const uuid = z.string().uuid();
const locale = z.string().max(35).regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
const fields = {
  campaign: ["title", "summary", "public_description"], category: ["label", "description"],
  survey_question: ["prompt", "help_text"], survey_question_option: ["label"],
  close_loop_entry: ["theme_title", "you_said", "we_did"],
} satisfies Record<string, string[]>;
const address = {
  entityType: z.enum(["campaign", "category", "survey_question", "survey_question_option", "close_loop_entry"]),
  entityId: uuid, field: z.string(), expectedSource: translationSourceVersionSchema,
  expectedTranslation: translationVersionSchema.nullable(),
};
// PostgreSQL length(text) counts code points, not UTF-16 units. Keep the words
// unchanged while matching that limit, including supplementary characters.
const translationWords = z.string().max(16000).refine(text => text.trim().length > 0 && [...text].length <= 8000 && !text.includes("\0"), "Translation must contain 1–8000 characters");
const common = {
  requestId: uuid, locale,
  reason: z.string().max(4000).refine(text => [...text].length <= 2000 && !text.includes("\0"), "Reason is too long or contains an unsupported character").nullable(),
};
export const translationWriteIntentSchema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.literal("save"), entries: z.array(z.object({ ...address, text: translationWords }).strict()).min(1).max(TRANSLATION_WRITE_BATCH_MAX) }).strict(),
  z.object({ ...common, operation: z.literal("accept"), entries: z.array(z.object(address).strict()).min(1).max(TRANSLATION_WRITE_BATCH_MAX) }).strict(),
  z.object({ ...common, operation: z.literal("withdraw"), entries: z.array(z.object(address).strict()).min(1).max(TRANSLATION_WRITE_BATCH_MAX) }).strict(),
]).superRefine((intent, context) => {
  const seen = new Set<string>();
  for (const [index, entry] of intent.entries.entries()) {
    const key = JSON.stringify([entry.entityType, entry.entityId, entry.field]);
    if (!fields[entry.entityType].includes(entry.field) || seen.has(key)) {
      context.addIssue({ code: "custom", path: ["entries", index], message: "Invalid or duplicate translation address" });
    }
    seen.add(key);
    if (intent.operation !== "save" && entry.expectedTranslation === null) {
      context.addIssue({ code: "custom", path: ["entries", index, "expectedTranslation"], message: "A saved translation version is required" });
    }
    if (intent.operation !== "withdraw" && (!entry.expectedSource.available || !entry.expectedSource.text?.trim())) {
      context.addIssue({ code: "custom", path: ["entries", index, "expectedSource"], message: "Published source words are required" });
    }
  }
  if ((intent.operation !== "save" || intent.entries.some(entry => entry.expectedTranslation !== null)) && !intent.reason?.trim()) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for changing saved wording" });
  }
});
export type TranslationWriteIntent = z.infer<typeof translationWriteIntentSchema>;
export type TranslationWriteScope = { campaignId: string; workspaceId: string };

export const translationSavedRowSchema = z.object({
  id: uuid, workspace_id: uuid, campaign_id: uuid, entity_type: address.entityType, entity_id: uuid,
  field: z.string(), locale, translated_text: z.string(), source: z.enum(["operator", "machine"]),
  machine_model: z.string().nullable(), source_text_hash: z.string().nullable(), created_by: uuid.nullable(),
  updated_at: z.string().datetime({ offset: true }),
}).passthrough();
export const translationWriteResultSchema = z.object({
  campaignId: uuid, requestId: uuid, operation: z.enum(["save", "accept", "withdraw"]), locale,
  replayed: z.boolean(), entries: z.array(z.object({ entry: translationSavedRowSchema, revision: z.number().int().positive(), removed: z.boolean() }).strict()),
}).strict();
export type TranslationWriteResult = z.infer<typeof translationWriteResultSchema>;
export type TranslationWriteFailure = {
  kind: "conflict" | "forbidden" | "invalid" | "unavailable"; status: number; message: string;
};

/** Validate the exact acknowledgement before clearing locally retained words. */
export function readTranslationWriteResult(data: unknown, scope: TranslationWriteScope, intent: TranslationWriteIntent): TranslationWriteResult {
  const result = translationWriteResultSchema.parse(data);
  if (result.campaignId !== scope.campaignId || result.requestId !== intent.requestId || result.operation !== intent.operation
    || result.locale !== intent.locale || result.entries.length !== intent.entries.length) throw new Error("Translation receipt does not match the request");
  const wanted = new Map(intent.entries.map(entry => [JSON.stringify([entry.entityType, entry.entityId, entry.field]), entry]));
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  for (const saved of result.entries) {
    const row = saved.entry;
    const key = JSON.stringify([row.entity_type, row.entity_id, row.field]);
    const expected = wanted.get(key);
    if (!expected || seen.has(key) || seenIds.has(row.id) || row.campaign_id !== scope.campaignId || row.workspace_id !== scope.workspaceId || row.locale !== intent.locale
      || saved.removed !== (intent.operation === "withdraw")) throw new Error("Translation receipt contains an unexpected result");
    seen.add(key);
    seenIds.add(row.id);
    const before = expected.expectedTranslation;
    if (before ? row.id !== before.id || saved.revision < before.revision || saved.revision > before.revision + 1 : saved.revision !== 1) {
      throw new Error("Translation receipt version does not match the request");
    }
    if (intent.operation !== "save" && before && saved.revision !== before.revision + 1) throw new Error("Translation receipt did not retain the requested change");
    if (intent.operation !== "withdraw" && (row.source !== "operator" || row.machine_model !== null)) throw new Error("Translation receipt changed authorship unexpectedly");
    if (intent.operation === "save" && "text" in expected && row.translated_text !== expected.text) throw new Error("Translation receipt changed the submitted words");
  }
  return result;
}

function failure(code?: string): TranslationWriteFailure {
  if (code === "PT409" || code === "23505") return { kind: "conflict", status: 409, message: "The source, saved translation or request has changed. Review the current copy; your proposed words are retained." };
  if (code === "42501") return { kind: "forbidden", status: 403, message: "You no longer have permission to change this campaign's translations." };
  if (code === "22023" || code === "22P02") return { kind: "invalid", status: 400, message: "Review the translation fields, saved versions and change reason. Your words have not been discarded." };
  return { kind: "unavailable", status: 503, message: "OpenPlan could not confirm this save. Keep your words and retry the same request." };
}

/** Send one validated intent once. Uncertain transport never creates a new identity or automatically retries. */
export async function writeTranslations(client: Pick<SupabaseClient, "rpc">, scope: TranslationWriteScope, intent: TranslationWriteIntent): Promise<
  { result: TranslationWriteResult; error: null } | { result: null; error: TranslationWriteFailure }
> {
  const parsed = translationWriteIntentSchema.safeParse(intent);
  if (!parsed.success) return { result: null, error: failure("22023") };
  try {
    const body = parsed.data;
    const reply = await client.rpc("write_engagement_translations", {
      p_campaign: scope.campaignId, p_request: body.requestId, p_operation: body.operation,
      p_locale: body.locale, p_reason: body.reason, p_entries: body.entries,
    });
    if (reply.error) return { result: null, error: failure(reply.error.code) };
    return { result: readTranslationWriteResult(reply.data, scope, body), error: null };
  } catch {
    return { result: null, error: failure() };
  }
}
