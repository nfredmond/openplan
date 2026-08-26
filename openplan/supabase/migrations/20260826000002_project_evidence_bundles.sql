-- Immutable project evidence snapshots. A planner reviews the complete
-- project-scoped file inventory, then the server freezes one all-or-nothing ZIP
-- in private storage. This is an evidence handoff, not approval or publication.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-evidence-bundles',
  'project-evidence-bundles',
  false,
  120000000,
  ARRAY['application/zip']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.project_evidence_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  project_revision TIMESTAMPTZ NOT NULL,
  selection_json JSONB NOT NULL,
  manifest_json JSONB,
  manifest_sha256 TEXT CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-f]{64}$'),
  checksums_sha256 TEXT CHECK (checksums_sha256 IS NULL OR checksums_sha256 ~ '^[0-9a-f]{64}$'),
  bundle_sha256 TEXT CHECK (bundle_sha256 IS NULL OR bundle_sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket TEXT,
  storage_path TEXT,
  byte_count BIGINT CHECK (byte_count IS NULL OR byte_count >= 0),
  selected_count INTEGER NOT NULL CHECK (selected_count >= 0 AND selected_count <= 200),
  generated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'ready', 'failed')),
  failure_code TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_evidence_bundle_terminal_shape CHECK (
    (status = 'preparing'
      AND manifest_json IS NULL
      AND manifest_sha256 IS NULL
      AND checksums_sha256 IS NULL
      AND bundle_sha256 IS NULL
      AND storage_bucket IS NULL
      AND storage_path IS NULL
      AND byte_count IS NULL
      AND failure_code IS NULL
      AND completed_at IS NULL)
    OR
    (status = 'ready'
      AND manifest_json IS NOT NULL
      AND manifest_sha256 IS NOT NULL
      AND checksums_sha256 IS NOT NULL
      AND bundle_sha256 IS NOT NULL
      AND storage_bucket = 'project-evidence-bundles'
      AND storage_path IS NOT NULL
      AND byte_count IS NOT NULL
      AND failure_code IS NULL
      AND completed_at IS NOT NULL)
    OR
    (status = 'failed'
      AND failure_code IS NOT NULL
      AND manifest_json IS NULL
      AND manifest_sha256 IS NULL
      AND checksums_sha256 IS NULL
      AND bundle_sha256 IS NULL
      AND storage_bucket IS NULL
      AND storage_path IS NULL
      AND byte_count IS NULL
      AND completed_at IS NOT NULL)
  ),
  CONSTRAINT project_evidence_bundle_storage_path_shape CHECK (
    storage_path IS NULL OR storage_path = workspace_id::text || '/' || project_id::text || '/' || id::text || '.zip'
  )
);

CREATE INDEX IF NOT EXISTS project_evidence_bundles_project_generated_idx
  ON public.project_evidence_bundles(project_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS project_evidence_bundles_workspace_generated_idx
  ON public.project_evidence_bundles(workspace_id, generated_at DESC);

CREATE OR REPLACE FUNCTION public.validate_project_evidence_bundle_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  project_workspace UUID;
BEGIN
  SELECT workspace_id INTO project_workspace FROM public.projects WHERE id = NEW.project_id;
  IF project_workspace IS NULL OR project_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'project evidence bundle must carry its project workspace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_evidence_bundle_scope ON public.project_evidence_bundles;
CREATE TRIGGER trg_project_evidence_bundle_scope
BEFORE INSERT OR UPDATE ON public.project_evidence_bundles
FOR EACH ROW EXECUTE FUNCTION public.validate_project_evidence_bundle_scope();

CREATE OR REPLACE FUNCTION public.protect_project_evidence_bundle_terminal_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('ready', 'failed')
      AND pg_trigger_depth() = 1
      AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id
    ) THEN
      RAISE EXCEPTION 'terminal project evidence bundles are immutable';
    END IF;
    -- Cascading parent deletion runs at a deeper trigger level. Direct
    -- deletion while the parent exists remains impossible.
    RETURN OLD;
  END IF;
  IF OLD.status IN ('ready', 'failed') THEN
    RAISE EXCEPTION 'terminal project evidence bundles are immutable';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.workspace_id <> OLD.workspace_id
    OR NEW.project_id <> OLD.project_id
    OR NEW.project_revision <> OLD.project_revision
    OR NEW.selection_json <> OLD.selection_json
    OR NEW.selected_count <> OLD.selected_count
    OR NEW.generated_by <> OLD.generated_by
    OR NEW.generated_at <> OLD.generated_at
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'project evidence review identity is immutable';
  END IF;
  IF NEW.status NOT IN ('ready', 'failed') THEN
    RAISE EXCEPTION 'a preparing project evidence bundle may only become ready or failed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_evidence_bundle_terminal_update ON public.project_evidence_bundles;
CREATE TRIGGER trg_project_evidence_bundle_terminal_update
BEFORE UPDATE ON public.project_evidence_bundles
FOR EACH ROW EXECUTE FUNCTION public.protect_project_evidence_bundle_terminal_rows();

DROP TRIGGER IF EXISTS trg_project_evidence_bundle_terminal_delete ON public.project_evidence_bundles;
CREATE TRIGGER trg_project_evidence_bundle_terminal_delete
BEFORE DELETE ON public.project_evidence_bundles
FOR EACH ROW EXECUTE FUNCTION public.protect_project_evidence_bundle_terminal_rows();

ALTER TABLE public.project_evidence_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_evidence_bundles_member_read ON public.project_evidence_bundles;
CREATE POLICY project_evidence_bundles_member_read ON public.project_evidence_bundles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_evidence_bundles.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_evidence_bundles.project_id
        AND p.workspace_id = project_evidence_bundles.workspace_id
    )
  );

DROP POLICY IF EXISTS project_evidence_bundles_writer_insert ON public.project_evidence_bundles;
CREATE POLICY project_evidence_bundles_writer_insert ON public.project_evidence_bundles
  FOR INSERT WITH CHECK (
    generated_by = auth.uid()
    AND status = 'preparing'
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_evidence_bundles.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'member')
    )
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_evidence_bundles.project_id
        AND p.workspace_id = project_evidence_bundles.workspace_id
    )
  );

DROP POLICY IF EXISTS project_evidence_bundles_writer_finalize ON public.project_evidence_bundles;
CREATE POLICY project_evidence_bundles_writer_finalize ON public.project_evidence_bundles
  FOR UPDATE USING (
    generated_by = auth.uid()
    AND status = 'preparing'
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_evidence_bundles.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    generated_by = auth.uid()
    AND status IN ('ready', 'failed')
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_evidence_bundles.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'member')
    )
  );

REVOKE ALL ON public.project_evidence_bundles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.project_evidence_bundles TO authenticated;
GRANT ALL ON public.project_evidence_bundles TO service_role;

-- Stored ZIPs are never client-addressable. Authenticated readers receive
-- bytes only through the project- and workspace-scoped download route.
DROP POLICY IF EXISTS project_evidence_bundle_objects_authenticated_select ON storage.objects;
DROP POLICY IF EXISTS project_evidence_bundle_objects_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS project_evidence_bundle_objects_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS project_evidence_bundle_objects_authenticated_delete ON storage.objects;

COMMENT ON TABLE public.project_evidence_bundles IS
  'Immutable retained project evidence snapshots. Ready and failed rows cannot be edited or deleted; a ready row points to one private all-or-nothing ZIP.';
