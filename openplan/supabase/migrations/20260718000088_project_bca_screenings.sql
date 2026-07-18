-- Saved benefit-cost screenings per project.
--
-- Each row is one screening-level BCA run saved from the /grants panel
-- (append-only history; the UI surfaces the latest row per project). The
-- server recomputes the result from inputs_json through the pure engine in
-- src/lib/bca before storing, so result_json is a server-derived record —
-- never client-supplied arithmetic. Screening-grade only: results support
-- prioritization and grant-readiness review, not an application benefit-cost
-- analysis of record.

CREATE TABLE IF NOT EXISTS public.project_bca_screenings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  inputs_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  engine_version TEXT NOT NULL,
  context_label TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_bca_screenings_project_idx
  ON public.project_bca_screenings(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS project_bca_screenings_workspace_idx
  ON public.project_bca_screenings(workspace_id, created_at DESC);

ALTER TABLE public.project_bca_screenings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_bca_screenings'
      AND policyname = 'project_bca_screenings_member_read'
  ) THEN
    CREATE POLICY project_bca_screenings_member_read
      ON public.project_bca_screenings
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
      AND tablename = 'project_bca_screenings'
      AND policyname = 'project_bca_screenings_member_insert'
  ) THEN
    CREATE POLICY project_bca_screenings_member_insert
      ON public.project_bca_screenings
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
        AND created_by = auth.uid()
      );
  END IF;
END
$$;

REVOKE ALL ON TABLE public.project_bca_screenings FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.project_bca_screenings TO authenticated;
GRANT ALL ON TABLE public.project_bca_screenings TO service_role;

COMMENT ON TABLE public.project_bca_screenings IS
  'Screening-level benefit-cost analyses saved per project. Append-only; workspace members read and insert through RLS. result_json is recomputed server-side from inputs_json — screening-grade prioritization support, not an application BCA of record.';

-- Latest screening per project. The grants page reads screenings across the
-- whole workspace; on the append-only base table a workspace-wide LIMIT would
-- silently drop a project whose newest save is older than the cap. This view
-- returns exactly one (newest) row per project, so the read is bounded by
-- project count. security_invoker = true so the querying member's RLS on the
-- base table still applies.
CREATE OR REPLACE VIEW public.project_bca_screenings_latest
  WITH (security_invoker = true) AS
  SELECT DISTINCT ON (project_id)
    id,
    workspace_id,
    project_id,
    inputs_json,
    result_json,
    engine_version,
    context_label,
    created_by,
    created_at
  FROM public.project_bca_screenings
  ORDER BY project_id, created_at DESC;

REVOKE ALL ON public.project_bca_screenings_latest FROM PUBLIC, anon;
GRANT SELECT ON public.project_bca_screenings_latest TO authenticated;
GRANT ALL ON public.project_bca_screenings_latest TO service_role;

COMMENT ON VIEW public.project_bca_screenings_latest IS
  'Newest project_bca_screenings row per project (DISTINCT ON project_id). security_invoker so base-table RLS applies. Backs the workspace-wide grants-page read without a row cap.';
