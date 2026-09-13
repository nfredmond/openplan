import { describe, expect, it, vi } from "vitest";
import { campaignTranslationStateFromSnapshot, loadCampaignTranslationState } from "@/lib/engagement/campaign-translations";
import { translationEditorFixture, translationTestId as id, rawTranslationSource, rawOriginalTranslation } from "./helpers/translation-editor-fixture";

describe("atomic translation editor state", () => {
  it("uses raw source and saved words from one snapshot rather than the earlier campaign read", async () => {
    const snapshot = translationEditorFixture();
    const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
    const from = vi.fn(() => { throw new Error("Separate reads are forbidden"); });
    const state = await loadCampaignTranslationState({ rpc, from } as never, { id: snapshot.campaignId, title: "SYNTHETIC outdated page title" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_translation_snapshot", { p_campaign: snapshot.campaignId });
    expect(from).not.toHaveBeenCalled(); expect(state.snapshot).toEqual(snapshot);
    expect(state.fields[0].sourceText).toBe(rawTranslationSource); expect(state.entries[0].text).toBe(rawOriginalTranslation);
    expect(state.sourceLocaleStated).toBe(false); expect(state.sourceLocaleReadable).toBe(true);
    expect(state.coverage?.find(row => row.locale === "es")).toMatchObject({ total: 1, operatorCount: 1, state: "operator_complete" });
  });

  it("withholds the entire editor state after a malformed, partial or refused snapshot", async () => {
    const snapshot = translationEditorFixture();
    for (const result of [
      { data: snapshot, error: { code: "42501", message: "SYNTHETIC access revoked" } },
      { data: { ...snapshot, translations: [] }, error: null },
      { data: { ...snapshot, campaignId: id(99) }, error: null },
      { data: snapshot, error: { code: "PGRST202", message: "SYNTHETIC pending migration" } },
    ]) {
      const state = await loadCampaignTranslationState({ rpc: vi.fn().mockResolvedValue(result) } as never, { id: snapshot.campaignId });
      expect(state.snapshot).toBeNull(); expect(state.fields).toEqual([]); expect(state.entries).toEqual([]); expect(state.coverage).toBeNull();
      expect(state.translationsReadable).toBe(false); expect(state.inventoryComplete).toBe(false); expect(state.sourceLocaleReadable).toBe(false);
      expect(state.readFailures[0].schemaPending).toBe(result.error?.code === "PGRST202");
    }
  });

  it("retains blank or unpublished source translations for withdrawal without inflating coverage", () => {
    const snapshot = translationEditorFixture();
    snapshot.questions = [{ id: id(10), campaign_id: snapshot.campaignId, prompt: "SYNTHETIC draft question", help_text: null, is_active: true, status: "draft" }];
    snapshot.options = [{ id: id(11), campaign_id: snapshot.campaignId, question_id: id(10), label: "SYNTHETIC draft option", is_active: true }];
    snapshot.responses = [{ id: id(12), campaign_id: snapshot.campaignId, theme_title: "SYNTHETIC private theme", you_said: null, we_did: null, status: "draft" }];
    const original = snapshot.translations[0];
    snapshot.translations.push(
      { ...original, id: id(20), field: "summary" },
      { ...original, id: id(21), entity_type: "survey_question_option", entity_id: id(11), field: "label" },
      { ...original, id: id(22), entity_type: "close_loop_entry", entity_id: id(12), field: "theme_title" },
    );
    snapshot.counts = { categories: 0, questions: 1, options: 1, responses: 1, translations: 4 };
    const state = campaignTranslationStateFromSnapshot(snapshot);
    expect(state.fields.map(field => [field.entity, field.field, field.available])).toEqual([
      ["campaign", "title", true], ["survey_question_option", "label", false], ["close_loop_entry", "theme_title", false], ["campaign", "summary", false],
    ]);
    expect(state.fields.find(field => field.field === "summary")?.sourceText).toBe("");
    expect(state.entries).toHaveLength(4);
    expect(state.coverage?.find(row => row.locale === "es")).toMatchObject({ total: 1, operatorCount: 1, missingCount: 0 });
  });

  it("keeps an unsupported recorded source language distinct from an unstated one", () => {
    const snapshot = translationEditorFixture(); snapshot.campaign.default_content_locale = "qaa";
    const state = campaignTranslationStateFromSnapshot(snapshot);
    expect(state.sourceLocaleStated).toBe(true); expect(state.sourceLocaleReadable).toBe(true);
    expect(state.snapshot?.campaign.default_content_locale).toBe("qaa"); expect(state.coverage).toBeNull();
    expect(state.entries[0].text).toBe(rawOriginalTranslation);
  });
});
