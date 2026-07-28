-- Stored AI narrative drafts for operator-reviewed documents.
--
-- One table serves every document surface that accepts an AI-drafted,
-- operator-ACCEPTED narrative block: report sections today
-- (target_kind = 'report_section', target_id = reports.id, section_key names
-- the section) and RTP chapters (target_kind = 'rtp_chapter',
-- target_id = rtp_cycle_chapters.id, section_key NULL — a chapter IS the
-- section). target_id is deliberately polymorphic (no FK): the target table
-- depends on target_kind, and a dangling draft is inert provenance, never
-- rendered content.
--
-- Report generation remains 100% deterministic: the generate route reads only
-- rows with status = 'accepted', and acceptance is an explicit operator action
-- recorded in the review columns below. Every draft stores the deterministic
-- grounding validation (grounding_json) and a facts_hash of the numbered fact
-- list it was grounded against, so generation can detect that the underlying
-- data changed since acceptance and disclose it.
--
-- Append-only per draft: draft_markdown, grounding_json, the sentence counts,
-- and facts_hash are immutable once inserted. Members may only ever touch the
-- REVIEW fields (status, accepted_markdown, accepted_by, accepted_at) — this
-- is enforced at the database level with a column-scoped UPDATE grant, not
-- just in the app. Terminality of 'dismissed' (a dismissed row never returns
-- to draft/accepted) is app-enforced in the PATCH routes and documented here:
-- RLS policies cannot compare OLD and NEW rows, so the state machine lives in
-- the route handlers.

CREATE TABLE IF NOT EXISTS public.document_narrative_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('report_section', 'rtp_chapter')),
  target_id UUID NOT NULL,
  section_key TEXT,
  draft_markdown TEXT NOT NULL,
  model TEXT NOT NULL,
  grounding_json JSONB NOT NULL,
  grounded_sentence_count INT NOT NULL,
  total_sentence_count INT NOT NULL,
  facts_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted', 'dismissed')),
  accepted_markdown TEXT,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A report-section draft must name its section; a chapter draft must not
  -- (the chapter row IS the target).
  CONSTRAINT document_narrative_drafts_section_key_shape CHECK (
    (target_kind = 'report_section' AND section_key IS NOT NULL)
    OR (target_kind = 'rtp_chapter' AND section_key IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS document_narrative_drafts_workspace_idx
  ON public.document_narrative_drafts(workspace_id);

CREATE INDEX IF NOT EXISTS document_narrative_drafts_target_idx
  ON public.document_narrative_drafts(target_kind, target_id, section_key);

ALTER TABLE public.document_narrative_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'document_narrative_drafts'
      AND policyname = 'document_narrative_drafts_member_read'
  ) THEN
    CREATE POLICY document_narrative_drafts_member_read
      ON public.document_narrative_drafts
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'document_narrative_drafts'
      AND policyname = 'document_narrative_drafts_member_insert'
  ) THEN
    CREATE POLICY document_narrative_drafts_member_insert
      ON public.document_narrative_drafts
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
        AND created_by = auth.uid()
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'document_narrative_drafts'
      AND policyname = 'document_narrative_drafts_member_update'
  ) THEN
    -- Which COLUMNS an update may touch is constrained by the column-scoped
    -- GRANT below, not by this policy; the policy scopes WHICH ROWS a member
    -- may review.
    CREATE POLICY document_narrative_drafts_member_update
      ON public.document_narrative_drafts
      FOR UPDATE USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      ) WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

REVOKE ALL ON TABLE public.document_narrative_drafts FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.document_narrative_drafts TO authenticated;
-- Review fields ONLY: the draft body, its grounding record, and its facts
-- hash are immutable to members. This is the "append-only per draft" contract
-- expressed in the database itself.
GRANT UPDATE (status, accepted_markdown, accepted_by, accepted_at)
  ON public.document_narrative_drafts TO authenticated;
GRANT ALL ON TABLE public.document_narrative_drafts TO service_role;

COMMENT ON TABLE public.document_narrative_drafts IS
  'AI-drafted narrative blocks for operator review (report sections, RTP chapters). Append-only per draft: members may update only the review fields (status, accepted_markdown, accepted_by, accepted_at) via a column-scoped grant. Only status=accepted rows ever reach a generated document, and dismissed is terminal (app-enforced).';

COMMENT ON COLUMN public.document_narrative_drafts.facts_hash IS
  'SHA-256 over the canonicalized numbered fact list the draft was grounded against. Generation recomputes it and discloses a mismatch as "underlying data changed since acceptance".';

COMMENT ON COLUMN public.document_narrative_drafts.accepted_markdown IS
  'The text the operator accepted. Equal to draft_markdown for an as-is acceptance (which requires a fully grounded, faithfulness-checked draft); different when the operator edited, in which case the text is operator-authored.';
