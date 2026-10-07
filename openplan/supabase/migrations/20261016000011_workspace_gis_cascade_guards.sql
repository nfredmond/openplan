-- Preserve finalized GIS records while allowing deletion of their owning scope.
-- Archive restoration may install child cascades before layer/workspace cascades.
CREATE OR REPLACE FUNCTION public.refuse_finalized_workspace_gis_version_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF OLD.ingest_status = 'ready' THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.workspace_gis_layers layer
      JOIN public.workspaces workspace ON workspace.id = layer.workspace_id
      WHERE layer.id = OLD.layer_id
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Finalized workspace GIS versions are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.refuse_finalized_workspace_gis_feature_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.workspace_gis_layer_versions version
    JOIN public.workspace_gis_layers layer ON layer.id = version.layer_id
    JOIN public.workspaces workspace ON workspace.id = layer.workspace_id
    WHERE version.id = OLD.version_id
  ) THEN
    RETURN OLD;
  END IF;
  -- Moving a feature out of a finalized version also changes that version.
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM public.workspace_gis_layer_versions
    WHERE id = OLD.version_id AND ingest_status = 'ready'
  ) THEN
    RAISE EXCEPTION 'Features of a finalized workspace GIS version are immutable';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM public.workspace_gis_layer_versions
    WHERE id = NEW.version_id AND ingest_status = 'ready'
  ) THEN
    RAISE EXCEPTION 'Features of a finalized workspace GIS version are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
