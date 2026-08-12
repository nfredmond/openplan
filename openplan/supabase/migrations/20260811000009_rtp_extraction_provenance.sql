-- RTP extraction provenance — an accepted figure remembers which page it came
-- from, permanently.
--
-- 20260811000008 holds what a machine transcribed and a planner reviewed. This
-- migration is the other end of that thread: once a candidate is accepted and
-- the ordinary RTP write route has written a real row, the row points BACK at
-- the candidate it came from. That pointer is what lets a revenue line on a
-- board packet say "2026 RTP, p. 112" beside the number, and lets a reviewer
-- click through to the verbatim sentence the agency's own document printed.
--
-- Nathaniel's Q2 decision, 2026-08-11: PROVENANCE EVERYWHERE, INCLUDING THE
-- BODY. A transcribed figure names its source document and page wherever it
-- appears — in-app, on the PUBLIC plan page, and in the board export body, not
-- tucked into an appendix. The chip is a DISCLOSURE, so it strengthens the
-- public-surface claim guards rather than straining them; its wording is
-- written for residents and board members, never for operators.
--
-- WHY NULL IS A REAL ANSWER, AND A PERMANENT ONE.
--
-- `extraction_candidate_id IS NULL` means TYPED BY HAND. Not "unknown", not
-- "not yet backfilled", not "legacy". Every row that exists before this
-- migration was typed by a person, and every row typed by a person afterwards
-- keeps the NULL. There is deliberately no backfill: guessing which historical
-- figures "probably" came from a document would be inventing provenance, which
-- is a worse failure than having none. A surface reads NULL as "the agency
-- entered this" and shows no chip — which is the truth.
--
-- WHY ONE NULLABLE FK PER TABLE, AND NOT A DENORMALIZED TRIPLE.
--
-- The tempting alternative is to copy the document id, the page and the quote
-- onto every row so a surface can render the chip without a join. That is
-- twelve columns instead of four, each needing a reader and each a copy of data
-- the candidate already holds immutably — and the copies drift the first time
-- anybody edits one. The candidate row is append-only in practice (nothing
-- updates its quote, page or proposed_json), so the join is always correct and
-- the FK is the whole record.
--
-- ON DELETE SET NULL rather than RESTRICT: the RESTRICT that matters is one
-- level up, on rtp_extraction_runs.kb_document_id, where deleting the SOURCE
-- DOCUMENT is refused by name. If a candidate is nonetheless removed — a
-- workspace or cycle cascade — the accepted figure must survive. It is a real
-- number in a real adopted plan and it does not stop being one because its
-- staging record went away; it simply reverts to reading like every hand-typed
-- figure beside it, with no chip and no false citation.
--
-- WHICH FIELDS OF A ROW CAME FROM THE DOCUMENT is answered by the candidate's
-- own `proposed_json` keys, not by this column. A project link row whose
-- portfolio_role a planner chose and whose estimated_cost was transcribed from
-- p.44 carries ONE FK and shows the chip against the cost alone.
--
-- FOUR TABLES, AND THE ONES DELIBERATELY LEFT OUT.
--
--   rtp_financial_assumptions  — revenue and O&M lines.
--   rtp_performance_measures   — baselines, targets, data sources.
--   rtp_horizon_bands          — labels and stated year ranges.
--   project_rtp_cycle_links    — programmed cost, basis year, role, band.
--
-- NOT rtp_cycles: a cycle is not a transcribed artifact, and its financial
-- basis year / inflation rate are cycle-level settings whose provenance the
-- candidate itself records (target_kind 'cycle_financial_basis'). NOT
-- rtp_cycle_chapters: chapter text never reaches content_markdown from this
-- lane at all — it lands in document_narrative_drafts (Q3), which already
-- carries its own grounding record, and adding a second provenance column
-- there would be two answers to one question.
--
-- GUARD BUDGET. This migration creates no table, no policy and no grant, so
-- src/test/migrations/inventory.test.ts, viewer-write-denial-guard.test.ts and
-- the rls-isolation census all hold unchanged. It adds four columns and four
-- partial indexes; a-column-nothing-reads-is-a-question.test.ts will see
-- `extraction_candidate_id` until the acceptance lane reads it.

ALTER TABLE public.rtp_financial_assumptions
  ADD COLUMN IF NOT EXISTS extraction_candidate_id UUID
    REFERENCES public.rtp_extraction_candidates(id) ON DELETE SET NULL;

ALTER TABLE public.rtp_performance_measures
  ADD COLUMN IF NOT EXISTS extraction_candidate_id UUID
    REFERENCES public.rtp_extraction_candidates(id) ON DELETE SET NULL;

ALTER TABLE public.rtp_horizon_bands
  ADD COLUMN IF NOT EXISTS extraction_candidate_id UUID
    REFERENCES public.rtp_extraction_candidates(id) ON DELETE SET NULL;

ALTER TABLE public.project_rtp_cycle_links
  ADD COLUMN IF NOT EXISTS extraction_candidate_id UUID
    REFERENCES public.rtp_extraction_candidates(id) ON DELETE SET NULL;

-- Partial indexes: the transcribed rows are the minority and the interesting
-- one. They serve the referential-integrity scan when a candidate is removed,
-- and the question the document-delete refusal has to answer out loud — "this
-- document backs 41 accepted figures in the 2026 RTP" — which is a lookup from
-- candidates to the rows that cite them.
CREATE INDEX IF NOT EXISTS rtp_financial_assumptions_extraction_candidate_idx
  ON public.rtp_financial_assumptions(extraction_candidate_id)
  WHERE extraction_candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS rtp_performance_measures_extraction_candidate_idx
  ON public.rtp_performance_measures(extraction_candidate_id)
  WHERE extraction_candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS rtp_horizon_bands_extraction_candidate_idx
  ON public.rtp_horizon_bands(extraction_candidate_id)
  WHERE extraction_candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_rtp_cycle_links_extraction_candidate_idx
  ON public.project_rtp_cycle_links(extraction_candidate_id)
  WHERE extraction_candidate_id IS NOT NULL;

COMMENT ON COLUMN public.rtp_financial_assumptions.extraction_candidate_id IS
  'The reviewed transcription this line came from, or NULL meaning a planner typed it — permanently, with no backfill. Guessing provenance for historical rows would be inventing it. Which fields were transcribed is read from the candidate''s proposed_json keys.';

COMMENT ON COLUMN public.rtp_performance_measures.extraction_candidate_id IS
  'The reviewed transcription this measure came from, or NULL meaning a planner typed it — permanently, with no backfill. A baseline is a measurement of the world; this column records that the measurement was copied out of the agency''s own adopted document, and names the page.';

COMMENT ON COLUMN public.rtp_horizon_bands.extraction_candidate_id IS
  'The reviewed transcription this band came from, or NULL meaning a planner typed it — permanently, with no backfill. escalation_target_year is only ever transcribed when the document states that exact year: filling it otherwise would delete the public "midpoint assumed and disclosed" caveat.';

COMMENT ON COLUMN public.project_rtp_cycle_links.extraction_candidate_id IS
  'The reviewed transcription this link''s programmed cost, basis year, role or band came from, or NULL meaning a planner typed it — permanently, with no backfill. The project itself is always bound by a person: extraction stages a name string and never a project_id.';
