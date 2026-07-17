-- Grounding metadata for AI narrative drafts.
--
-- Each draft now stores the deterministic per-sentence citation validation
-- result produced by the Planner Pack grounding contract
-- (src/lib/planner-pack/grounding.ts, 'annotated' mode): which sentences
-- cite known [fact:N] ids, which are flagged for operator review, and the
-- grounded/total sentence counts the UI surfaces. Columns are nullable so
-- pre-grounding drafts remain readable.

ALTER TABLE public.funding_opportunity_narrative_drafts
  ADD COLUMN IF NOT EXISTS grounding_json JSONB,
  ADD COLUMN IF NOT EXISTS grounded_sentence_count INT,
  ADD COLUMN IF NOT EXISTS total_sentence_count INT;

COMMENT ON COLUMN public.funding_opportunity_narrative_drafts.grounding_json IS
  'Deterministic citation-validation result (annotated mode): fact list, per-sentence citations, and flagged sentences. Null for drafts generated before grounding.';

COMMENT ON COLUMN public.funding_opportunity_narrative_drafts.grounded_sentence_count IS
  'Number of sentences in draft_markdown that cite at least one known [fact:N] id.';

COMMENT ON COLUMN public.funding_opportunity_narrative_drafts.total_sentence_count IS
  'Total number of factual-claim sentences the grounding validator classified in draft_markdown.';
