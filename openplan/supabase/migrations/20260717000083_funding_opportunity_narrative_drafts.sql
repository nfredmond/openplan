-- Stored AI narrative drafts for funding opportunities.
--
-- Each row is one generated draft (append-only history; the UI surfaces the
-- latest row per opportunity). Drafts are advisory writing support only and
-- always require operator review before leaving OpenPlan.

CREATE TABLE IF NOT EXISTS public.funding_opportunity_narrative_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.funding_opportunities(id) ON DELETE CASCADE,
  draft_markdown TEXT NOT NULL,
  model TEXT,
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'fallback')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funding_opportunity_narrative_drafts_opportunity_idx
  ON public.funding_opportunity_narrative_drafts(opportunity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS funding_opportunity_narrative_drafts_workspace_idx
  ON public.funding_opportunity_narrative_drafts(workspace_id, created_at DESC);

ALTER TABLE public.funding_opportunity_narrative_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'funding_opportunity_narrative_drafts'
      AND policyname = 'funding_opportunity_narrative_drafts_member_read'
  ) THEN
    CREATE POLICY funding_opportunity_narrative_drafts_member_read
      ON public.funding_opportunity_narrative_drafts
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
      AND tablename = 'funding_opportunity_narrative_drafts'
      AND policyname = 'funding_opportunity_narrative_drafts_member_insert'
  ) THEN
    CREATE POLICY funding_opportunity_narrative_drafts_member_insert
      ON public.funding_opportunity_narrative_drafts
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
        AND created_by = auth.uid()
      );
  END IF;
END
$$;

REVOKE ALL ON TABLE public.funding_opportunity_narrative_drafts FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.funding_opportunity_narrative_drafts TO authenticated;
GRANT ALL ON TABLE public.funding_opportunity_narrative_drafts TO service_role;

COMMENT ON TABLE public.funding_opportunity_narrative_drafts IS
  'AI-generated grant narrative drafts per funding opportunity. Append-only; workspace members read and insert through RLS. Drafts are writing support only and require operator review.';
