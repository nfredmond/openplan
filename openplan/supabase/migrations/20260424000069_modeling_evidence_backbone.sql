-- Public-data modeling evidence backbone.
--
-- These tables give the three modeling lanes (county assignment, behavioral
-- demand, multimodal accessibility) one shared contract for source manifests,
-- validation checks, and outward-claim decisions.

CREATE TABLE IF NOT EXISTS public.modeling_source_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  model_run_id UUID REFERENCES public.model_runs(id) ON DELETE CASCADE,
  county_run_id UUID REFERENCES public.county_runs(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (
    source_kind IN (
      'census_acs',
      'census_tiger',
      'lodes',
      'gtfs',
      'osm',
      'caltrans_counts',
      'mobility_database',
      'ntd',
      'local_public_counts',
      'network_package',
      'activitysim_config',
      'manual_public',
      'other_public'
    )
  ),
  source_label TEXT NOT NULL,
  source_url TEXT,
  source_vintage TEXT,
  geography_id TEXT,
  geography_label TEXT,
  checksum_sha256 TEXT,
  license_note TEXT,
  citation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (model_run_id IS NOT NULL OR county_run_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS modeling_source_manifests_workspace_idx
  ON public.modeling_source_manifests(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS modeling_source_manifests_model_run_idx
  ON public.modeling_source_manifests(model_run_id)
  WHERE model_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS modeling_source_manifests_county_run_idx
  ON public.modeling_source_manifests(county_run_id)
  WHERE county_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS modeling_source_manifests_county_run_key_idx
  ON public.modeling_source_manifests(county_run_id, source_key);

CREATE UNIQUE INDEX IF NOT EXISTS modeling_source_manifests_model_run_key_idx
  ON public.modeling_source_manifests(model_run_id, source_key);

CREATE TABLE IF NOT EXISTS public.modeling_validation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  model_run_id UUID REFERENCES public.model_runs(id) ON DELETE CASCADE,
  county_run_id UUID REFERENCES public.county_runs(id) ON DELETE CASCADE,
  source_manifest_id UUID REFERENCES public.modeling_source_manifests(id) ON DELETE SET NULL,
  track TEXT NOT NULL CHECK (track IN ('assignment', 'behavioral_demand', 'multimodal_accessibility', 'shared')),
  metric_key TEXT NOT NULL,
  metric_label TEXT NOT NULL,
  observed_value DOUBLE PRECISION,
  threshold_value DOUBLE PRECISION,
  threshold_max_value DOUBLE PRECISION,
  threshold_comparator TEXT NOT NULL DEFAULT 'manual' CHECK (
    threshold_comparator IN ('lte', 'gte', 'between', 'eq', 'exists', 'manual')
  ),
  status TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  blocks_claim_grade BOOLEAN NOT NULL DEFAULT TRUE,
  detail TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (model_run_id IS NOT NULL OR county_run_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS modeling_validation_results_workspace_idx
  ON public.modeling_validation_results(workspace_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS modeling_validation_results_model_run_idx
  ON public.modeling_validation_results(model_run_id, track)
  WHERE model_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS modeling_validation_results_county_run_idx
  ON public.modeling_validation_results(county_run_id, track)
  WHERE county_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.modeling_claim_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  model_run_id UUID REFERENCES public.model_runs(id) ON DELETE CASCADE,
  county_run_id UUID REFERENCES public.county_runs(id) ON DELETE CASCADE,
  track TEXT NOT NULL CHECK (track IN ('assignment', 'behavioral_demand', 'multimodal_accessibility', 'shared')),
  claim_status TEXT NOT NULL CHECK (claim_status IN ('claim_grade_passed', 'screening_grade', 'prototype_only')),
  status_reason TEXT NOT NULL,
  reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (model_run_id IS NOT NULL OR county_run_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS modeling_claim_decisions_workspace_idx
  ON public.modeling_claim_decisions(workspace_id, decided_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS modeling_claim_decisions_model_run_track_idx
  ON public.modeling_claim_decisions(model_run_id, track);

CREATE UNIQUE INDEX IF NOT EXISTS modeling_claim_decisions_county_run_track_idx
  ON public.modeling_claim_decisions(county_run_id, track);

ALTER TABLE public.modeling_source_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modeling_validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modeling_claim_decisions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.modeling_evidence_target_matches_workspace(
  p_workspace_id UUID,
  p_model_run_id UUID,
  p_county_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    (
      p_model_run_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.model_runs mr
        WHERE mr.id = p_model_run_id
          AND mr.workspace_id = p_workspace_id
      )
    )
    AND (
      p_county_run_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.county_runs cr
        WHERE cr.id = p_county_run_id
          AND cr.workspace_id = p_workspace_id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.modeling_evidence_target_matches_workspace(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.modeling_evidence_target_matches_workspace(UUID, UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS modeling_source_manifests_workspace_read ON public.modeling_source_manifests;
CREATE POLICY modeling_source_manifests_workspace_read ON public.modeling_source_manifests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = modeling_source_manifests.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND public.modeling_evidence_target_matches_workspace(
      modeling_source_manifests.workspace_id,
      modeling_source_manifests.model_run_id,
      modeling_source_manifests.county_run_id
    )
  );

DROP POLICY IF EXISTS modeling_source_manifests_workspace_write ON public.modeling_source_manifests;
CREATE POLICY modeling_source_manifests_workspace_write ON public.modeling_source_manifests
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = modeling_source_manifests.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND public.modeling_evidence_target_matches_workspace(
      modeling_source_manifests.workspace_id,
      modeling_source_manifests.model_run_id,
      modeling_source_manifests.county_run_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = modeling_source_manifests.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND public.modeling_evidence_target_matches_workspace(
      modeling_source_manifests.workspace_id,
      modeling_source_manifests.model_run_id,
      modeling_source_manifests.county_run_id
    )
  );

DROP POLICY IF EXISTS modeling_validation_results_workspace_read ON public.modeling_validation_results;
CREATE POLICY modeling_validation_results_workspace_read ON public.modeling_validation_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = modeling_validation_results.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND public.modeling_evidence_target_matches_workspace(
      modeling_validation_results.workspace_id,
      modeling_validation_results.model_run_id,
      modeling_validation_results.county_run_id
    )
  );

DROP POLICY IF EXISTS modeling_validation_results_workspace_write ON public.modeling_validation_results;
CREATE POLICY modeling_validation_results_workspace_write ON public.modeling_validation_results
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = modeling_validation_results.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND public.modeling_evidence_target_matches_workspace(
      modeling_validation_results.workspace_id,
      modeling_validation_results.model_run_id,
      modeling_validation_results.county_run_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = modeling_validation_results.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND public.modeling_evidence_target_matches_workspace(
      modeling_validation_results.workspace_id,
      modeling_validation_results.model_run_id,
      modeling_validation_results.county_run_id
    )
  );

DROP POLICY IF EXISTS modeling_claim_decisions_workspace_read ON public.modeling_claim_decisions;
CREATE POLICY modeling_claim_decisions_workspace_read ON public.modeling_claim_decisions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = modeling_claim_decisions.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND public.modeling_evidence_target_matches_workspace(
      modeling_claim_decisions.workspace_id,
      modeling_claim_decisions.model_run_id,
      modeling_claim_decisions.county_run_id
    )
  );

DROP POLICY IF EXISTS modeling_claim_decisions_workspace_write ON public.modeling_claim_decisions;
CREATE POLICY modeling_claim_decisions_workspace_write ON public.modeling_claim_decisions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = modeling_claim_decisions.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND public.modeling_evidence_target_matches_workspace(
      modeling_claim_decisions.workspace_id,
      modeling_claim_decisions.model_run_id,
      modeling_claim_decisions.county_run_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = modeling_claim_decisions.workspace_id
        AND wm.user_id = auth.uid()
    )
    AND public.modeling_evidence_target_matches_workspace(
      modeling_claim_decisions.workspace_id,
      modeling_claim_decisions.model_run_id,
      modeling_claim_decisions.county_run_id
    )
  );

CREATE OR REPLACE FUNCTION public.set_modeling_source_manifests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_modeling_source_manifests_updated_at ON public.modeling_source_manifests;
CREATE TRIGGER trg_modeling_source_manifests_updated_at
BEFORE UPDATE ON public.modeling_source_manifests
FOR EACH ROW
EXECUTE FUNCTION public.set_modeling_source_manifests_updated_at();

CREATE OR REPLACE FUNCTION public.set_modeling_claim_decisions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_modeling_claim_decisions_updated_at ON public.modeling_claim_decisions;
CREATE TRIGGER trg_modeling_claim_decisions_updated_at
BEFORE UPDATE ON public.modeling_claim_decisions
FOR EACH ROW
EXECUTE FUNCTION public.set_modeling_claim_decisions_updated_at();

COMMENT ON TABLE public.modeling_source_manifests IS
  'Public-data source manifest rows for model/county-run evidence. Captures source kind, vintage, citation, checksum, and geography so outward claims can trace to public inputs.';

COMMENT ON TABLE public.modeling_validation_results IS
  'Machine-readable validation checks tied to modeling runs. These rows drive claim-grade gating instead of letting reports infer readiness from prose.';

COMMENT ON TABLE public.modeling_claim_decisions IS
  'Canonical per-run claim decision: claim_grade_passed, screening_grade, or prototype_only. Reports and commercial surfaces must read this before making outward modeling claims.';
