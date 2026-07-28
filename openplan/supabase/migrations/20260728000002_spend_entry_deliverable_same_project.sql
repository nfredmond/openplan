-- A spend entry attributed to a deliverable must name a deliverable of ITS
-- OWN project. The API has enforced this since 20260727000012 shipped; this
-- puts the invariant at the schema level so no future write path — service
-- role included — can attribute spend across projects. Same shape as
-- run_project_matches_workspace (20260728... precedent 20260727000003).
CREATE OR REPLACE FUNCTION public.spend_entry_deliverable_matches_project(
  p_project_id UUID,
  p_deliverable_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    p_deliverable_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.project_deliverables d
      WHERE d.id = p_deliverable_id
        AND d.project_id = p_project_id
    );
$$;

REVOKE ALL ON FUNCTION public.spend_entry_deliverable_matches_project(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spend_entry_deliverable_matches_project(UUID, UUID) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_spend_entries_deliverable_same_project'
  ) THEN
    ALTER TABLE public.project_spend_entries
      ADD CONSTRAINT project_spend_entries_deliverable_same_project
      CHECK (public.spend_entry_deliverable_matches_project(project_id, deliverable_id));
  END IF;
END
$$;
