import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTranslationSnapshot, readTranslationSnapshot, translationSnapshotSource, type TranslationSnapshot } from "@/lib/engagement/translation-snapshot";

const uuid = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const campaign = uuid(1);
function fixture(): TranslationSnapshot {
  return {
    schema: 1, campaignId: campaign,
    campaign: { id: campaign, title: "\u00a0SYNTHETIC source\ufeff", summary: null, public_description: " ", default_content_locale: null },
    categories: [{ id: uuid(2), campaign_id: campaign, label: "SYNTHETIC category", description: null }],
    questions: [{ id: uuid(3), campaign_id: campaign, prompt: "SYNTHETIC published question", help_text: null, is_active: true, status: "published" },
      { id: uuid(4), campaign_id: campaign, prompt: "SYNTHETIC draft question", help_text: "SYNTHETIC help", is_active: true, status: "draft" }],
    options: [{ id: uuid(5), campaign_id: campaign, question_id: uuid(3), label: "SYNTHETIC answer", is_active: true },
      { id: uuid(6), campaign_id: campaign, question_id: uuid(4), label: "SYNTHETIC draft answer", is_active: true }],
    responses: [{ id: uuid(7), campaign_id: campaign, theme_title: "SYNTHETIC response", you_said: "SYNTHETIC input", we_did: "SYNTHETIC action", status: "published" }],
    translations: [{ id: uuid(8), workspace_id: uuid(9), campaign_id: campaign, entity_type: "campaign", entity_id: campaign, field: "title", locale: "es",
      translated_text: "\u00a0SYNTHETIC translated words\ufeff", source: "operator", machine_model: null, source_text_hash: null, created_by: uuid(10), updated_at: "2026-09-13T00:00:00Z", revision: 3 }],
    counts: { categories: 1, questions: 2, options: 2, responses: 1, translations: 1 },
  };
}
function client(data: unknown, error: { code: string; message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, db: { rpc } as unknown as Pick<SupabaseClient, "rpc"> };
}

describe("exact translation source and current-version snapshot", () => {
  it("retains raw source and saved words, unstated locale and exact revision", () => {
    const snapshot = readTranslationSnapshot(fixture(), campaign);
    expect(snapshot.translations[0].translated_text).toBe("\u00a0SYNTHETIC translated words\ufeff");
    expect(snapshot.translations[0].revision).toBe(3);
    expect(translationSnapshotSource(snapshot, { entityType: "campaign", entityId: campaign, field: "title" }))
      .toEqual({ text: "\u00a0SYNTHETIC source\ufeff", sourceLocale: null, available: true });
    expect(translationSnapshotSource(snapshot, { entityType: "campaign", entityId: campaign, field: "summary" }))
      .toEqual({ text: null, sourceLocale: null, available: false });
    expect(translationSnapshotSource(snapshot, { entityType: "campaign", entityId: campaign, field: "public_description" })?.available).toBe(false);
  });

  it("resolves publication through question parents and preserves unavailable wording for withdrawal", () => {
    const snapshot = readTranslationSnapshot(fixture(), campaign);
    const source = (entityType: "survey_question_option" | "survey_question" | "close_loop_entry", entityId: string, field: string) =>
      translationSnapshotSource(snapshot, { entityType, entityId, field });
    expect(source("survey_question_option", uuid(5), "label")?.available).toBe(true);
    expect(source("survey_question_option", uuid(6), "label"))
      .toEqual({ text: "SYNTHETIC draft answer", sourceLocale: null, available: false });
    expect(source("survey_question", uuid(4), "prompt")?.available).toBe(false);
    expect(source("close_loop_entry", uuid(7), "we_did")?.available).toBe(true);
    snapshot.questions[0].is_active = false;
    snapshot.responses[0].status = "draft";
    expect(source("survey_question_option", uuid(5), "label")?.available).toBe(false);
    expect(source("close_loop_entry", uuid(7), "we_did")?.available).toBe(false);
  });

  it("reads one complete scalar result beyond the row cap", async () => {
    const snapshot = fixture();
    snapshot.categories = Array.from({ length: 1005 }, (_, i) => ({ id: uuid(100 + i), campaign_id: campaign, label: `SYNTHETIC category ${i}`, description: null }));
    snapshot.counts.categories = 1005;
    const mock = client(snapshot);
    const loaded = await loadTranslationSnapshot(mock.db, campaign);
    expect(loaded.error).toBeNull();
    expect(loaded.snapshot?.categories).toHaveLength(1005);
    expect(loaded.snapshot?.categories.at(-1)?.label).toBe("SYNTHETIC category 1004");
    expect(mock.rpc.mock.calls).toEqual([["read_engagement_translation_snapshot", { p_campaign: campaign }]]);
  });

  it.each([
    ["envelope campaign", (s: TranslationSnapshot) => { s.campaignId = uuid(20); }],
    ["campaign row", (s: TranslationSnapshot) => { s.campaign.id = uuid(20); }],
    ["foreign source row", (s: TranslationSnapshot) => { s.categories[0].campaign_id = uuid(20); }],
    ["partial inventory", (s: TranslationSnapshot) => { s.categories = []; }],
    ["duplicate identity", (s: TranslationSnapshot) => { s.categories.push(s.categories[0]); s.counts.categories++; }],
    ["orphan option", (s: TranslationSnapshot) => { s.options[0].question_id = uuid(20); }],
    ["missing translation source", (s: TranslationSnapshot) => { s.translations[0].entity_id = uuid(20); }],
    ["duplicate translation address", (s: TranslationSnapshot) => { s.translations.push({ ...s.translations[0], id: uuid(20) }); s.counts.translations++; }],
    ["unavailable revision", (s: TranslationSnapshot) => { s.translations[0].revision = 0; }],
    ["unsafe integer revision", (s: TranslationSnapshot) => { s.translations[0].revision = Number.MAX_SAFE_INTEGER + 1; }],
    ["unknown source column", (s: TranslationSnapshot) => { Object.assign(s.categories[0], { unmappedSourceWords: "SYNTHETIC unrecognized source" }); }],
    ["malformed source identifier", (s: TranslationSnapshot) => { s.categories[0].id = "invalid"; }],
  ] satisfies Array<[string, (s: TranslationSnapshot) => void]>)("withholds %s instead of presenting missing records as absent", async (_label, change) => {
    const snapshot = fixture(); change(snapshot);
    const loaded = await loadTranslationSnapshot(client(snapshot).db, campaign);
    expect(loaded.snapshot).toBeNull();
    expect(loaded.error).not.toBeNull();
  });

  it("withholds missing source columns instead of making them blank", async () => {
    const snapshot = fixture();
    const data = { ...snapshot, categories: snapshot.categories.map(({ description: _description, ...row }) => row) };
    expect((await loadTranslationSnapshot(client(data).db, campaign)).snapshot).toBeNull();
  });

  it("withholds a partial reply with an error and reports pending schema separately", async () => {
    const failed = await loadTranslationSnapshot(client(fixture(), { code: "42501", message: "SYNTHETIC access denied" }).db, campaign);
    expect(failed).toEqual({ snapshot: null, error: { schemaPending: false, message: "SYNTHETIC access denied" } });
    const pending = await loadTranslationSnapshot(client(null, { code: "PGRST202", message: "SYNTHETIC missing RPC" }).db, campaign);
    expect(pending).toEqual({ snapshot: null, error: { schemaPending: true, message: "SYNTHETIC missing RPC" } });
  });
});
