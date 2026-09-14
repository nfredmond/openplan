import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";

export const historical: EngagementSynthesis = {
  source: "deterministic-fallback", model: null, fallback_reason: "missing_api_key", item_count: 300, analyzed_item_count: 299,
  overall_sentiment: "neutral", themes: [{ label: "SYNTHETIC legacy theme", sentiment: "neutral", item_count: 2, fact_ids: ["item_old"], summary: "SYNTHETIC stored theme wording." }],
  narrative: "SYNTHETIC stored narrative.", caveat: "SYNTHETIC original caveat.",
  grounding: { mode: "annotated", facts: [], sentences: [], dropped_sentences: [], cited_fact_ids: [], unknown_fact_ids: [], grounded_sentence_count: 0,
    total_sentence_count: 1, is_fully_grounded: false, faithfulness_checked: false },
};
