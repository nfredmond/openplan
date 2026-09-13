import type { TranslationSnapshot } from "@/lib/engagement/translation-snapshot";
import { hashTranslationSource } from "@/lib/engagement/campaign-translations";

export const translationTestId = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const translationTestUser = translationTestId(3);
export const translationTestWorkspace = translationTestId(2);
export const rawTranslationSource = "\u00a0SYNTHETIC source title\ufeff";
export const rawOriginalTranslation = "\u00a0SYNTHETIC original translation\ufeff";

export function translationEditorFixture(): TranslationSnapshot {
  return { schema: 1, campaignId: translationTestId(1), campaign: { id: translationTestId(1), title: rawTranslationSource,
    summary: null, public_description: null, default_content_locale: null }, categories: [], questions: [], options: [], responses: [],
    translations: [{ id: translationTestId(4), workspace_id: translationTestWorkspace, campaign_id: translationTestId(1), entity_type: "campaign",
      entity_id: translationTestId(1), field: "title", locale: "es", translated_text: rawOriginalTranslation, source: "operator", machine_model: null,
      source_text_hash: hashTranslationSource(rawTranslationSource), created_by: translationTestUser, updated_at: "2026-09-13T00:00:00Z", revision: 3 }],
    counts: { categories: 0, questions: 0, options: 0, responses: 0, translations: 1 } };
}
