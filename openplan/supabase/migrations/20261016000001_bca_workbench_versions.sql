-- Retained BCA input documents. Results are recomputed by the application;
-- client-supplied totals are never accepted as calculation evidence.
CREATE TABLE public.project_bca_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  document_json jsonb NOT NULL CHECK (jsonb_typeof(document_json) = 'object' AND octet_length(document_json::text) <= 1000000),
  engine_version text NOT NULL,
  CHECK (document_json->>'projectId' = project_id::text),
  CHECK (document_json->>'schemaVersion' = '1')
);
CREATE INDEX project_bca_versions_project_idx ON public.project_bca_versions(project_id, created_at DESC, id);
ALTER TABLE public.project_bca_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_bca_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.project_bca_versions TO authenticated;
GRANT ALL ON public.project_bca_versions TO service_role;
CREATE POLICY project_bca_versions_read ON public.project_bca_versions FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.projects p JOIN public.workspace_members m ON m.workspace_id = p.workspace_id WHERE p.id = project_id AND m.user_id = (SELECT auth.uid()))
);
CREATE POLICY project_bca_versions_insert ON public.project_bca_versions FOR INSERT TO authenticated WITH CHECK (
 created_by = (SELECT auth.uid()) AND EXISTS (
 SELECT 1 FROM public.projects p JOIN public.workspace_members m ON m.workspace_id = p.workspace_id
 WHERE p.id = project_id AND m.user_id = (SELECT auth.uid()) AND m.role IN ('owner','admin','member'))
);
COMMENT ON TABLE public.project_bca_versions IS 'Append-only BCA input versions. No application approval or computed-result authority. Exact documents retain program/source assumptions; results are recomputed, not trusted from JSON totals.';

ALTER TABLE public.project_bca_versions ADD CONSTRAINT bca_required_document_fields CHECK (document_json->>'projectId' IS NOT NULL AND document_json->>'schemaVersion' IS NOT NULL);
