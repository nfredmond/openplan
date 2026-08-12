-- RTP document extraction — the staging floor between a machine reading an
-- adopted plan and the plan's own numbers entering OpenPlan.
--
-- WHAT THIS IS FOR. An agency's adopted RTP is a PDF. Every figure OpenPlan's
-- financial element needs — the revenue lines, the O&M lines, the performance
-- baselines, the programmed cost of each project — is already in it, on a page,
-- in a table the board voted on. Today a planner re-types all of it, and the
-- retyping is where the errors are. This migration holds the intermediate step:
-- what a model TRANSCRIBED, from which page, in the document's own words,
-- waiting for a person to accept it.
--
-- THE ONE RULE, and the reason every column below is shaped the way it is:
--
--   EXTRACTION IS TRANSCRIPTION WITH PROVENANCE. It is never authorship.
--
-- A candidate row is a PROPOSAL carrying the verbatim text it came from. It is
-- not a figure, not a plan, and nothing reads it as one. `source_quote` is NOT
-- NULL and non-empty, `source_page` is NOT NULL, and `quote_verified` must be
-- TRUE before `status` may ever become 'accepted' — so a value cannot reach an
-- RTP table through this lane without a verbatim quote that a human accepted.
-- That last one is a CHECK constraint rather than a rule in a route, because a
-- rule in a route is a convention and this repository has a long record of
-- conventions being violated exactly once and then forever.
--
-- ============================================================================
-- WHY THIS DOES NOT REOPEN THE 2026-08-05 RTP FINANCIAL REFUSALS
-- ============================================================================
--
-- Five RTP financial writes were refused as assistant actions on 2026-08-05
-- (src/test/refused-rtp-financial-actions-stay-refused.test.ts). Every one of
-- those refusals is an argument about WHERE THE NUMBER COMES FROM, and in each
-- refused case the answer was NOWHERE — the model would have invented it. The
-- refusal for programmed cost says it plainly: "the right value comes from an
-- engineer's estimate that exists nowhere in the database".
--
-- Here the answer is: page 112 of the plan the board adopted. The engineer's
-- estimate that exists nowhere in the database is exactly what that document
-- contains. So the refusals are untouched, and they stay green BY
-- CONSTRUCTION rather than by exemption: this lane registers NO assistant
-- action at all. `ACTION_METADATA` gains nothing, extraction and acceptance are
-- HTTP routes a signed-in human calls, and the refusal guard — which enumerates
-- `Object.keys(ACTION_METADATA)` and nothing else — has no new key to see.
--
-- THE Q4 PAIRING ARGUMENT (Nathaniel, 2026-08-11), which is the delicate one.
--
-- `assign_rtp_project_horizon_band` STAYS REFUSED. Its refusal is not about the
-- payload being unverified — the payload is two verified uuids — it is that the
-- PAIRING is the content: "nothing in the schema records which period a project
-- is planned for, so the choice is an authored phasing judgement, and the band
-- sets the escalation exponent". That is true of an agent choosing a band, and
-- it is still true today.
--
-- It is NOT true of transcribing a row the adopted plan already prints. When
-- the plan's own project table says "Project X — Constrained — 2023–2032 —
-- $12.4M", copying that row is RECORDING A JUDGEMENT THE AGENCY ALREADY MADE,
-- not authoring one. The judgement was made by the agency, ratified by its
-- board, and printed on a page this row cites by number and quotes verbatim.
--
-- The precedent for the shape is the Phase E campaign-template argument in
-- src/lib/engagement/campaign-templates.ts, and it is borrowed here in its own
-- words: wording the signed-in planner did not write lands where they review
-- it, badged, invisible to the public, and a person publishes it. A staged
-- pairing gets exactly the same treatment — it lands in this table, badged with
-- its page and its quote, reaching no plan surface, until a person accepts it
-- through the ordinary write route with the ordinary permission check. The
-- difference between the refused action and this table is not the payload; it
-- is that one of them has a document behind it and a human in front of it.
--
-- WHAT WOULD REOPEN THE REFUSAL. Written here rather than in a plan file
-- because this migration is the artifact a future session will read first:
--
--   1. Registering ANY assistant action that creates or updates a candidate's
--      VALUES, or that accepts one. Acceptance is the human's half.
--   2. Auto-accepting on a confidence score. THERE IS NO CONFIDENCE COLUMN IN
--      THIS MIGRATION AND THERE MUST NEVER BE ONE — a model scoring its own
--      certainty is the model grading itself, and a threshold over that score
--      is a machine authoring a planning number with extra steps.
--   3. Letting a candidate carry a value with no quote. Hence NOT NULL on
--      `source_quote` and `source_page`, and the accepted-implies-verified
--      CHECK.
--   4. Fuzzy-matching a document's project name to a `projects` row without a
--      human binding it. `programmed_project` candidates stage a NAME STRING
--      inside `proposed_json`; there is deliberately no project_id column on
--      this table for a matcher to fill in.
--   5. Widening extraction to COMPUTE anything — year-of-expenditure dollars,
--      band midpoints, totals, balances, scores. The fiscal verdict stays
--      computed at read time from rows a human accepted; extraction supplies
--      inputs to that arithmetic and may never state its answer.
--
-- ============================================================================
-- POSTURE: SERVICE-ROLE-WRITTEN, MEMBER-READ
-- ============================================================================
--
-- Both tables follow kb_documents / aerial_imagery: workspace members may
-- SELECT, `authenticated` is GRANTed SELECT only, and every write goes through
-- an authed route that checks membership and role and then writes with the
-- service role. There are NO write policies, on purpose — a client writing a
-- candidate row directly is a row claiming a quote that never went through the
-- verifier, which is the single thing this table exists to make impossible.
--
-- DELIBERATELY NOT the document_narrative_drafts posture (20260727000013),
-- which grants members INSERT plus a column-scoped UPDATE over its review
-- fields. That design is sound on its own terms and it FAILED IN PRACTICE:
-- 20260804000002 restored client grants by looping every table in `public` with
-- a blanket GRANT, and the column-scoped UPDATE — the entire control — was
-- silently widened to a table-wide one until 20260805000005:176-179 repaired it
-- by hand. A posture whose safety depends on a column list surviving every
-- future blanket grant is a posture with a moving part. "SELECT and nothing
-- else" has none: a blanket grant can widen it, but `grant-inventory.ts` now
-- replays every grant and revoke in application order and fails when a revoked
-- (table, role, privilege) is held at HEAD without a later grant BY NAME.
--
-- ============================================================================
-- GUARD BUDGET — what this migration moves, and what it deliberately does not
-- ============================================================================
--
-- src/test/migrations/inventory.test.ts: +2 policies, +2 permissive,
--   +0 restrictive, +0 permissiveWrites, +0 expanded, +2 tablesWithPolicies,
--   +2 relations, +2 tables, +0 views, +2 rlsEnabledTables. Two tables, one
--   member-SELECT policy each, both written literally.
--
-- src/test/viewer-write-denial-guard.test.ts: NOTHING MOVES, and that zero is
--   the posture rather than an omission. `tablesNeedingGate()` collects tables
--   carrying a role-blind PERMISSIVE WRITE policy; these two carry no
--   permissive write policy at all, so they never enter the set and need no
--   RESTRICTIVE `_writer_only_*` companion. EXPECTED_GATED_TABLES,
--   EXPECTED_RESTRICTIVE_POLICIES and EXPECTED_PERMISSIVE_WRITE_POLICIES all
--   hold. The aerial_imagery precedent (20260811000002) moved the same zero.
--
-- src/test/rls-isolation.test.ts: both tables carry a `workspace_id` column, so
--   the live census ("every workspace_id table is probed, provably deny-all, or
--   excused by name") WILL see them and must be told about them. The live
--   cross-tenant proof is written in this migration's sibling
--   src/test/rtp-extraction-rls.test.ts; merging the census entry is handed to
--   the lane that owns that file, so two sessions do not edit it at once.
--
-- src/test/a-column-nothing-reads-is-a-question.test.ts: this migration
--   introduces columns no `src/` file names YET — the readers are the run
--   route, the review surface and the acceptance resolver, which land in the
--   same release. Every one of them is a column something reads by the time
--   this ships; none is INERT, none is UNBUILT. If any is still unread when the
--   release is cut, that is a shipped-invisible capability and the answer is to
--   wire it up, not to allowlist it.

-- ---------------------------------------------------------------------------
-- 1. RUNS — one row per (cycle, document) extraction attempt.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rtp_extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rtp_cycle_id UUID NOT NULL REFERENCES public.rtp_cycles(id) ON DELETE CASCADE,

  -- ON DELETE RESTRICT, decided by Nathaniel 2026-08-11 (Q1), on the precedent
  -- of rtp_financial_assumptions.horizon_band_id. Once a document backs figures
  -- in an adopted plan, deleting it would strand every provenance chip on the
  -- public plan page — the page would show a citation to a source the system no
  -- longer holds, which is worse than showing no citation. The delete route
  -- refuses by NAME instead, stating the cycle and the count.
  kb_document_id UUID NOT NULL REFERENCES public.kb_documents(id) ON DELETE RESTRICT,

  -- The model id the run actually used, recorded so an extraction can be
  -- re-read years later knowing what produced it. NULLABLE because a run can
  -- fail before any model call — no key configured, the document not ready —
  -- and writing a model id for a call that never happened would be a small lie
  -- in the provenance record.
  model TEXT CHECK (model IS NULL OR length(btrim(model)) > 0),

  -- Where the text this run read came from, copied off the document at run
  -- time so the answer survives a later re-extraction of the same document.
  --
  -- DELIBERATELY NARROWER than kb_documents.extraction_source, which also
  -- admits 'pasted' and 'none'. Neither can produce a page citation: pasted
  -- text has no pages, and a stored file has no text at all. A source that
  -- cannot answer "which page?" cannot be transcribed FROM by this lane, so it
  -- is refused at the schema rather than degraded into a candidate with no
  -- anchor. ('ocr' is admitted here in advance of the OCR worker lane, which
  -- widens the kb_documents CHECK in its own migration; a run row can only
  -- claim 'ocr' once a document can actually carry it.)
  extraction_source TEXT NOT NULL CHECK (extraction_source IN ('text_layer', 'ocr')),

  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  -- How many candidates the verifier PASSED, and how many it DROPPED because
  -- the figures were not in the text the model cited. The discard count is not
  -- bookkeeping: it is what lets the review surface say "41 proposed; 6 dropped
  -- because their figures were not in the text they cited" instead of quietly
  -- showing 35 and looking clean.
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  discarded_count INTEGER NOT NULL DEFAULT 0 CHECK (discarded_count >= 0),

  -- A named reason, never a stack trace and never NULL on a failed run. The
  -- 2026-08-10 modeling defect ("a failed run said Run recorded") happened
  -- because a worker never wrote this column and a crashed run read as benign.
  failure_reason TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A failed run NAMES its failure, and a run that did not fail carries no
  -- failure text. Enforced here rather than trusted to the writer, because the
  -- silent version of this is a run that looks finished and produced nothing.
  CONSTRAINT rtp_extraction_runs_failure_reason_shape CHECK (
    (status = 'failed' AND failure_reason IS NOT NULL AND btrim(failure_reason) <> '')
    OR (status <> 'failed' AND failure_reason IS NULL)
  ),

  -- FAILURE POSTURE, in the schema: no key, no parse, no model answer means
  -- ZERO candidates. There is deliberately no partial-success state and no
  -- deterministic fallback — the deterministic version of transcription is a
  -- human typing, and a half-extraction presented as a finished one is exactly
  -- the failure this feature exists to avoid.
  CONSTRAINT rtp_extraction_runs_failed_produces_nothing CHECK (
    status <> 'failed' OR candidate_count = 0
  )
);

CREATE INDEX IF NOT EXISTS rtp_extraction_runs_workspace_idx
  ON public.rtp_extraction_runs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS rtp_extraction_runs_cycle_idx
  ON public.rtp_extraction_runs(rtp_cycle_id, created_at DESC);

-- The document side of the RESTRICT above: the delete route counts what a
-- document backs before refusing, and that count is a lookup by document.
CREATE INDEX IF NOT EXISTS rtp_extraction_runs_document_idx
  ON public.rtp_extraction_runs(kb_document_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. CANDIDATES — one transcribed proposal, with the page and the words.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rtp_extraction_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rtp_cycle_id UUID NOT NULL REFERENCES public.rtp_cycles(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.rtp_extraction_runs(id) ON DELETE CASCADE,

  -- Which RTP surface this proposal is FOR. 'chapter_block' is here by
  -- Nathaniel's Q3 decision of 2026-08-11 (chapters are in scope, verbatim
  -- blocks only) — and a chapter block does NOT write
  -- rtp_cycle_chapters.content_markdown from here. It lands through the
  -- existing document_narrative_drafts staging machinery, so an adopted plan
  -- can never quote itself wrongly without a human accepting the draft first.
  -- 'cycle_financial_basis' is Q5: the cycle's own basis year and inflation
  -- rate, whose acceptance re-derives every escalated figure in the plan, so
  -- the review surface states that blast radius before the click.
  target_kind TEXT NOT NULL CHECK (target_kind IN (
    'financial_line',
    'performance_measure',
    'horizon_band',
    'programmed_project',
    'cycle_financial_basis',
    'chapter_block'
  )),

  -- EXACTLY WHAT THE TARGET ROUTE'S POST ACCEPTS, and nothing else. A candidate
  -- is a proposed REQUEST BODY, not a row: acceptance re-parses this through
  -- the existing route's own zod, its cross-cycle band check, its amount
  -- bounds, its NULL-is-not-zero discipline and its audit line. There is no
  -- second writer to permission-check or get wrong.
  --
  -- It is JSONB rather than columns because the six target kinds have six
  -- shapes, and flattening them would produce a wide table of mostly-NULL
  -- columns whose real contract still lived in TypeScript. Keeping it opaque
  -- here also answers "which FIELDS came from the document?" for free: a link
  -- row whose portfolio_role a human typed and whose estimated_cost came from
  -- p.44 shows the provenance chip against the cost only, because the keys of
  -- this object are the answer.
  --
  -- NOTE FOR WHOEVER ADDS A TARGET KIND: no uuid the model produced may appear
  -- in here. A project is staged as a NAME STRING (Q6) and bound by a person.
  proposed_json JSONB NOT NULL,

  -- The chunk the quote was copied out of. ON DELETE SET NULL rather than
  -- CASCADE: re-extracting a document replaces its chunks, and a candidate a
  -- planner already reviewed must not evaporate because the text was re-indexed.
  -- The page and the quote below are the durable record; this is the pointer
  -- back into retrieval while it still resolves.
  source_chunk_id UUID REFERENCES public.kb_document_chunks(id) ON DELETE SET NULL,

  -- THE PAGE, taken from the chunk's own page_from — never from the model's
  -- answer, which is kept only as an audit cross-check. NOT NULL: a chunk with
  -- no page (pasted text) cannot be cited, and a candidate that cannot say
  -- which page it came from is refused rather than staged with a blank. Pages
  -- are 1-based, matching lib/knowledge-base/extract.ts.
  source_page INTEGER NOT NULL CHECK (source_page >= 1),

  -- The document's own words, character for character. This is the artifact a
  -- planner reads before accepting, the text the chip cites on the public plan
  -- page, and the thing that makes the whole feature transcription rather than
  -- authorship. Empty is not a quote.
  source_quote TEXT NOT NULL CHECK (btrim(source_quote) <> ''),

  -- Did the deterministic verifier confirm this quote is a substring of the
  -- chunk it cites, and every consequential number in proposed_json present
  -- inside the quote? Written by src/lib/rtp/extraction/verify.ts, which is
  -- pure code and not a model.
  --
  -- This is NOT a confidence score and must never become one. It is a
  -- deterministic yes/no about a substring, checkable by hand from the two
  -- pieces of text stored beside it.
  quote_verified BOOLEAN NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),

  -- The row this candidate BECAME. Polymorphic with no FK, on the
  -- document_narrative_drafts.target_id precedent: the target table depends on
  -- target_kind, and a dangling id is inert provenance rather than rendered
  -- content. The forward direction (row -> candidate) is the FK added in
  -- 20260811000009; this is the backward one, so "what did the planner do with
  -- this proposal?" is answerable from the candidate alone.
  accepted_row_id UUID,

  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- THE RULE, AS A CONSTRAINT. A candidate whose quote the verifier could not
  -- confirm may never be accepted. Today the verifier discards such candidates
  -- before they are ever inserted, so this line should be unreachable — which
  -- is exactly why it is worth having: the day someone decides to stage the
  -- discards "so the planner can see them", the accept path fails closed at the
  -- database instead of quietly becoming a machine authoring a planning number.
  CONSTRAINT rtp_extraction_candidates_accepted_only_when_verified CHECK (
    status <> 'accepted' OR quote_verified
  ),

  -- A reviewed candidate records WHEN it was reviewed; a pending one has been
  -- touched by nobody and points at no row. `reviewed_by` is deliberately NOT
  -- part of this shape: auth.users deletion sets it NULL, and a CHECK that
  -- required it would make deleting a user fail against rows they reviewed.
  CONSTRAINT rtp_extraction_candidates_review_shape CHECK (
    (status = 'pending' AND reviewed_at IS NULL AND accepted_row_id IS NULL)
    OR (status = 'rejected' AND reviewed_at IS NOT NULL AND accepted_row_id IS NULL)
    OR (status = 'accepted' AND reviewed_at IS NOT NULL AND accepted_row_id IS NOT NULL)
  )
);

-- The review surface's own query: this cycle's candidates, pending first,
-- newest first.
CREATE INDEX IF NOT EXISTS rtp_extraction_candidates_cycle_idx
  ON public.rtp_extraction_candidates(rtp_cycle_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS rtp_extraction_candidates_run_idx
  ON public.rtp_extraction_candidates(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS rtp_extraction_candidates_workspace_idx
  ON public.rtp_extraction_candidates(workspace_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Row-level security — members READ; nobody writes as a client.
-- ---------------------------------------------------------------------------

ALTER TABLE public.rtp_extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rtp_extraction_candidates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_extraction_runs'
      AND policyname = 'rtp_extraction_runs_member_read'
  ) THEN
    CREATE POLICY rtp_extraction_runs_member_read
      ON public.rtp_extraction_runs
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_extraction_candidates'
      AND policyname = 'rtp_extraction_candidates_member_read'
  ) THEN
    CREATE POLICY rtp_extraction_candidates_member_read
      ON public.rtp_extraction_candidates
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants — EXPLICIT since 20260804000001 flipped default privileges to deny.
--
-- The revoke runs first on purpose. Postgres revokes column privileges along
-- with the table-level ones, so a revoke placed AFTER the grant would destroy
-- it — the ordering trap 20260805000005's header documents at length. `anon`
-- gets nothing: an anon grant would expose every workspace's unreviewed
-- transcription, including the verbatim quotes, through PostgREST to anyone
-- holding the public key.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.rtp_extraction_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.rtp_extraction_candidates FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.rtp_extraction_runs TO authenticated;
GRANT SELECT ON TABLE public.rtp_extraction_candidates TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rtp_extraction_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rtp_extraction_candidates TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Documentation
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.rtp_extraction_runs IS
  'One attempt at transcribing an adopted RTP document into staged candidates for one cycle. Service-role-written, member-read. kb_document_id is ON DELETE RESTRICT because a deleted document would strand the provenance citations its figures carry on the public plan page; the delete route refuses by name and states the count instead. A failed run names its failure and produces zero candidates — there is no partial success and no deterministic fallback.';

COMMENT ON COLUMN public.rtp_extraction_runs.extraction_source IS
  'Where the text this run read came from: text_layer or ocr, copied off the document at run time. Narrower than kb_documents.extraction_source on purpose — pasted text and stored files cannot answer "which page?", and a source with no page anchor cannot be transcribed from.';

COMMENT ON COLUMN public.rtp_extraction_runs.discarded_count IS
  'Candidates the deterministic verifier DROPPED because their figures were not in the text they cited. Surfaced, not hidden: a review header that showed only what survived would present a clean-looking extraction and conceal how much of it the model got wrong.';

COMMENT ON TABLE public.rtp_extraction_candidates IS
  'A single figure, measure, pairing or verbatim block transcribed out of an adopted plan, carrying the page it came from and the document''s own words. A proposal, never a plan: nothing renders these as agency content, acceptance runs the ordinary RTP write route with the ordinary permission check, and status may not become accepted unless quote_verified is true. Extraction is transcription with provenance; it is never authorship.';

COMMENT ON COLUMN public.rtp_extraction_candidates.proposed_json IS
  'Exactly what the target route''s POST accepts — a proposed request body, not a row. Acceptance re-parses it through that route''s own zod and invariants, so a transcribed figure is validated identically to a typed one. Its KEYS are also the record of which fields came from the document, which is how a provenance chip attaches to one column of a row rather than the whole row.';

COMMENT ON COLUMN public.rtp_extraction_candidates.source_page IS
  'The 1-based page, taken from the cited chunk''s own page_from — never from the model''s stated page, which is kept only as an audit cross-check. NOT NULL: a candidate that cannot say which page it came from is refused, not staged with a blank.';

COMMENT ON COLUMN public.rtp_extraction_candidates.quote_verified IS
  'The deterministic verifier confirmed the quote is a substring of the chunk it cites and that every consequential number in proposed_json appears inside the quote. A yes/no about a substring, checkable by hand from the text stored beside it. NOT a confidence score, and it must never become one — a model scoring its own certainty is the model grading itself.';

COMMENT ON COLUMN public.rtp_extraction_candidates.accepted_row_id IS
  'The row this candidate became, polymorphic with no FK on the document_narrative_drafts.target_id precedent (the target table depends on target_kind). Required once status is accepted, so a proposal can always name what a planner turned it into.';
