import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const id = z.string().uuid();
const words = z.string().nullable();
const revision = z.number().int().positive();
const scoped = { id, campaign_id: id };
export const translationVersionSchema = z.object({ id, revision }).strict();
export const translationSourceVersionSchema = z.object({
  text: words, sourceLocale: words, available: z.boolean(),
}).strict();
export type TranslationVersion = z.infer<typeof translationVersionSchema>;
export type TranslationSourceVersion = z.infer<typeof translationSourceVersionSchema>;

const snapshotSchema = z.object({
  schema: z.literal(1), campaignId: id,
  campaign: z.object({ id, title: words, summary: words, public_description: words, default_content_locale: words }).strict(),
  categories: z.array(z.object({ ...scoped, label: words, description: words }).strict()),
  questions: z.array(z.object({ ...scoped, prompt: words, help_text: words, is_active: z.boolean(), status: z.enum(["draft", "published"]) }).strict()),
  options: z.array(z.object({ ...scoped, question_id: id, label: words, is_active: z.boolean() }).strict()),
  responses: z.array(z.object({ ...scoped, theme_title: words, you_said: words, we_did: words, status: z.enum(["draft", "published"]) }).strict()),
  translations: z.array(z.object({
    ...scoped, workspace_id: id, entity_type: z.enum(["campaign", "category", "survey_question", "survey_question_option", "close_loop_entry"]),
    entity_id: id, field: z.string(), locale: z.string(), translated_text: z.string(), source: z.enum(["operator", "machine"]),
    machine_model: words, source_text_hash: words, created_by: id.nullable(), updated_at: z.string().datetime({ offset: true }), revision,
  }).strict()),
  counts: z.object({ categories: z.number().int().nonnegative(), questions: z.number().int().nonnegative(),
    options: z.number().int().nonnegative(), responses: z.number().int().nonnegative(), translations: z.number().int().nonnegative() }).strict(),
}).strict();
export type TranslationSnapshot = z.infer<typeof snapshotSchema>;
export type TranslationAddress = {
  entityType: TranslationSnapshot["translations"][number]["entity_type"];
  entityId: string;
  field: string;
};

/** Resolve raw source wording and publication state from the same retained read. */
export function translationSnapshotSource(snapshot: TranslationSnapshot, address: TranslationAddress): TranslationSourceVersion | null {
  let text: string | null;
  let visible = true;
  const { entityType, entityId, field } = address;
  if (entityType === "campaign" && entityId === snapshot.campaignId && (field === "title" || field === "summary" || field === "public_description")) {
    text = snapshot.campaign[field];
  } else if (entityType === "category" && (field === "label" || field === "description")) {
    const row = snapshot.categories.find(row => row.id === entityId);
    if (!row) return null;
    text = row[field];
  } else if (entityType === "survey_question" && (field === "prompt" || field === "help_text")) {
    const row = snapshot.questions.find(row => row.id === entityId);
    if (!row) return null;
    text = row[field]; visible = row.is_active && row.status === "published";
  } else if (entityType === "survey_question_option" && field === "label") {
    const row = snapshot.options.find(row => row.id === entityId);
    const parent = row && snapshot.questions.find(question => question.id === row.question_id);
    if (!row || !parent) return null;
    text = row.label; visible = row.is_active && parent.is_active && parent.status === "published";
  } else if (entityType === "close_loop_entry" && (field === "theme_title" || field === "you_said" || field === "we_did")) {
    const row = snapshot.responses.find(row => row.id === entityId);
    if (!row) return null;
    text = row[field]; visible = row.status === "published";
  } else return null;
  return { text, sourceLocale: snapshot.campaign.default_content_locale, available: visible && text !== null && text.trim().length > 0 };
}

/** Reject incomplete, mixed-campaign or unversioned results before exposing an absent state to an editor. */
export function readTranslationSnapshot(data: unknown, campaignId: string): TranslationSnapshot {
  const snapshot = snapshotSchema.parse(data);
  if (snapshot.campaignId !== campaignId || snapshot.campaign.id !== campaignId) throw new Error("Translation snapshot campaign mismatch");
  for (const group of ["categories", "questions", "options", "responses", "translations"] as const) {
    const rows = snapshot[group];
    if (rows.length !== snapshot.counts[group] || new Set(rows.map(row => row.id)).size !== rows.length
      || rows.some(row => row.campaign_id !== campaignId)) throw new Error("Translation snapshot is incomplete or incorrectly scoped");
  }
  if (snapshot.options.some(row => !snapshot.questions.some(question => question.id === row.question_id))) {
    throw new Error("Translation option has no source question");
  }
  const addresses = new Set<string>();
  for (const row of snapshot.translations) {
    const key = JSON.stringify([row.entity_type, row.entity_id, row.field, row.locale]);
    if (addresses.has(key) || translationSnapshotSource(snapshot, { entityType: row.entity_type, entityId: row.entity_id, field: row.field }) === null) {
      throw new Error("Translation has a duplicate or missing source address");
    }
    addresses.add(key);
  }
  return snapshot;
}

/** A failed scalar RPC is unknown data, never an empty inventory or a fallback across separate snapshots. */
export async function loadTranslationSnapshot(client: Pick<SupabaseClient, "rpc">, campaignId: string): Promise<
  { snapshot: TranslationSnapshot; error: null } | { snapshot: null; error: { message: string; schemaPending: boolean } }
> {
  try {
    const reply = await client.rpc("read_engagement_translation_snapshot", { p_campaign: campaignId });
    if (reply.error) return { snapshot: null, error: { message: reply.error.message, schemaPending: ["PGRST202", "42883"].includes(reply.error.code) } };
    return { snapshot: readTranslationSnapshot(reply.data, campaignId), error: null };
  } catch {
    return { snapshot: null, error: { message: "The current translation snapshot could not be read. Refresh and try again.", schemaPending: false } };
  }
}
