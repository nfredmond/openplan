-- Bind a model to the ingested network bundle its runs should be read against.
-- Same shape as 20260424000070 (reports -> county_runs): a plain STABLE SQL
-- helper backing a CHECK constraint so a model can never point at a network
-- package version owned by another workspace. The function is NOT used in RLS.

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS network_package_version_id UUID REFERENCES public.network_package_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS models_network_package_version_idx
  ON public.models (network_package_version_id)
  WHERE network_package_version_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.model_network_package_version_matches_workspace(
  p_workspace_id UUID,
  p_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    p_version_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.network_package_versions npv
      JOIN public.network_packages np ON np.id = npv.package_id
      WHERE npv.id = p_version_id
        AND np.workspace_id = p_workspace_id
    );
$$;

REVOKE ALL ON FUNCTION public.model_network_package_version_matches_workspace(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.model_network_package_version_matches_workspace(UUID, UUID) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'models_network_package_version_workspace_match'
  ) THEN
    ALTER TABLE public.models
      ADD CONSTRAINT models_network_package_version_workspace_match
      CHECK (public.model_network_package_version_matches_workspace(workspace_id, network_package_version_id));
  END IF;
END
$$;
