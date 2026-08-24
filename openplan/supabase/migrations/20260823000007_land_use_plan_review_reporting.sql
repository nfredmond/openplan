-- Land Use Plans public review and reporting completion.
--
-- This migration does four things the first Land Use Plans release did not:
-- it records immutable public-review releases, freezes the disposition and
-- adoption records that authorize publication, makes finalized GIS versions
-- immutable with a deterministic feature hash, and gives Reports distinct
-- plan-packet types.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.land_use_plan_versions
  DROP CONSTRAINT IF EXISTS land_use_plan_versions_version_kind_check;
ALTER TABLE public.land_use_plan_versions
  ADD CONSTRAINT land_use_plan_versions_version_kind_check
  CHECK (version_kind IN ('original', 'revision', 'amendment'));

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_report_type_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_report_type_check
  CHECK (report_type IN ('project_status', 'analysis_summary', 'board_packet', 'land_use_plan_packet', 'land_use_plan_implementation_report'));

ALTER TABLE public.land_use_plan_designations
  ADD COLUMN public_field_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN legend_field text;

ALTER TABLE public.workspace_gis_layer_versions
  ADD COLUMN feature_hash text,
  ADD COLUMN feature_hash_computed_at timestamptz;

CREATE OR REPLACE FUNCTION public.compute_workspace_gis_feature_hash(p_version_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(
        COALESCE(string_agg(
          f.feature_index::text || ':' || encode(ST_AsEWKB(f.geom), 'hex') || ':' || f.properties::text,
          '|' ORDER BY f.feature_index
        ), ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  FROM public.workspace_gis_features f
  WHERE f.version_id = p_version_id
$$;
REVOKE ALL ON FUNCTION public.compute_workspace_gis_feature_hash(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_workspace_gis_feature_hash(uuid) TO service_role;

UPDATE public.workspace_gis_layer_versions version
SET feature_hash = public.compute_workspace_gis_feature_hash(version.id),
    feature_hash_computed_at = COALESCE(version.finalized_at, now())
WHERE version.ingest_status = 'ready' AND version.feature_hash IS NULL;

ALTER TABLE public.workspace_gis_layer_versions
  ADD CONSTRAINT workspace_gis_ready_version_has_feature_hash CHECK (
    ingest_status <> 'ready'
    OR (feature_hash ~ '^[0-9a-f]{64}$' AND feature_hash_computed_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.hash_workspace_gis_version_on_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.ingest_status <> 'ready' AND NEW.ingest_status = 'ready' THEN
    NEW.feature_hash := public.compute_workspace_gis_feature_hash(NEW.id);
    NEW.feature_hash_computed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_gis_versions_hash_on_finalize
  BEFORE UPDATE ON public.workspace_gis_layer_versions
  FOR EACH ROW EXECUTE FUNCTION public.hash_workspace_gis_version_on_finalize();

CREATE OR REPLACE FUNCTION public.refuse_finalized_workspace_gis_version_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.ingest_status = 'ready' THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.workspace_gis_layers WHERE id = OLD.layer_id
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Finalized workspace GIS versions are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER workspace_gis_versions_refuse_finalized_rewrite
  BEFORE UPDATE OR DELETE ON public.workspace_gis_layer_versions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_finalized_workspace_gis_version_rewrite();

CREATE OR REPLACE FUNCTION public.refuse_finalized_workspace_gis_feature_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE target_version_id uuid;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF EXISTS (
    SELECT 1 FROM public.workspace_gis_layer_versions
    WHERE id = target_version_id AND ingest_status = 'ready'
  ) THEN
    RAISE EXCEPTION 'Features of a finalized workspace GIS version are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER workspace_gis_features_refuse_finalized_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_gis_features
  FOR EACH ROW EXECUTE FUNCTION public.refuse_finalized_workspace_gis_feature_write();

CREATE TABLE public.land_use_plan_process_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  version_id uuid NOT NULL,
  descriptor_id text NOT NULL CHECK (btrim(descriptor_id) <> ''),
  process_key text NOT NULL CHECK (btrim(process_key) <> ''),
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'complete', 'not_applicable')),
  due_on date,
  completed_on date,
  evidence_document_id uuid REFERENCES public.kb_documents(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (version_id, process_key),
  FOREIGN KEY (plan_id, workspace_id)
    REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE CASCADE,
  CHECK (status <> 'complete' OR completed_on IS NOT NULL)
);

CREATE INDEX land_use_plan_process_due_idx
  ON public.land_use_plan_process_records(workspace_id, due_on)
  WHERE due_on IS NOT NULL AND status NOT IN ('complete', 'not_applicable');

CREATE TRIGGER land_use_plan_process_records_updated_at
  BEFORE UPDATE ON public.land_use_plan_process_records
  FOR EACH ROW EXECUTE FUNCTION public.set_land_use_plan_updated_at();

CREATE TABLE public.land_use_plan_review_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  version_id uuid NOT NULL,
  version_content_hash text NOT NULL CHECK (version_content_hash ~ '^[0-9a-f]{64}$'),
  round_number integer NOT NULL CHECK (round_number >= 1),
  share_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex') UNIQUE,
  review_method text NOT NULL CHECK (review_method IN ('engagement_campaign', 'external_process')),
  review_open_on date NOT NULL,
  review_close_on date NOT NULL,
  engagement_campaign_id uuid REFERENCES public.engagement_campaigns(id) ON DELETE NO ACTION,
  external_review_document_id uuid REFERENCES public.kb_documents(id) ON DELETE NO ACTION,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'withdrawn')),
  outcome_snapshot jsonb,
  outcome_hash text,
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  withdrawn_at timestamptz,
  withdrawn_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  withdrawal_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (plan_id, round_number),
  FOREIGN KEY (plan_id, workspace_id)
    REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE NO ACTION,
  CHECK (review_close_on >= review_open_on),
  CHECK (
    (review_method = 'engagement_campaign' AND engagement_campaign_id IS NOT NULL AND external_review_document_id IS NULL)
    OR
    (review_method = 'external_process' AND engagement_campaign_id IS NULL AND external_review_document_id IS NOT NULL)
  ),
  CHECK (
    (status = 'open' AND outcome_snapshot IS NULL AND outcome_hash IS NULL AND closed_at IS NULL AND closed_by IS NULL AND withdrawn_at IS NULL)
    OR
    (status = 'closed' AND jsonb_typeof(outcome_snapshot) = 'object' AND outcome_hash ~ '^[0-9a-f]{64}$' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND withdrawn_at IS NULL)
    OR
    (status = 'withdrawn' AND withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND btrim(withdrawal_reason) <> '')
  )
);

CREATE INDEX land_use_plan_review_release_plan_idx
  ON public.land_use_plan_review_releases(plan_id, round_number DESC);
CREATE INDEX land_use_plan_review_release_due_idx
  ON public.land_use_plan_review_releases(workspace_id, review_close_on)
  WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.guard_land_use_plan_review_release()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.land_use_plans WHERE id = OLD.plan_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Public review releases are append-only';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.land_use_plan_versions version
      WHERE version.id = NEW.version_id
        AND version.plan_id = NEW.plan_id
        AND version.workspace_id = NEW.workspace_id
        AND version.state = 'public_review'
        AND version.content_hash = NEW.version_content_hash
        AND version.frozen_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Review release must name the exact frozen public-review version hash';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.version_id IS DISTINCT FROM OLD.version_id
    OR NEW.version_content_hash IS DISTINCT FROM OLD.version_content_hash
    OR NEW.round_number IS DISTINCT FROM OLD.round_number
    OR NEW.share_token IS DISTINCT FROM OLD.share_token
    OR NEW.review_method IS DISTINCT FROM OLD.review_method
    OR NEW.review_open_on IS DISTINCT FROM OLD.review_open_on
    OR NEW.review_close_on IS DISTINCT FROM OLD.review_close_on
    OR NEW.engagement_campaign_id IS DISTINCT FROM OLD.engagement_campaign_id
    OR NEW.external_review_document_id IS DISTINCT FROM OLD.external_review_document_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Published review release identity is immutable';
  END IF;

  IF OLD.status <> 'open' AND NEW.status <> 'withdrawn' THEN
    RAISE EXCEPTION 'A closed review release is immutable';
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'A withdrawn review release is immutable';
  END IF;
  IF NEW.status = 'closed' THEN
    NEW.outcome_hash := encode(
      extensions.digest(convert_to(NEW.outcome_snapshot::text, 'UTF8'), 'sha256'),
      'hex'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER land_use_plan_review_release_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.land_use_plan_review_releases
  FOR EACH ROW EXECUTE FUNCTION public.guard_land_use_plan_review_release();

ALTER TABLE public.land_use_plan_decisions
  ADD COLUMN review_release_id uuid REFERENCES public.land_use_plan_review_releases(id) ON DELETE NO ACTION,
  ADD COLUMN adoption_manifest jsonb,
  ADD COLUMN adoption_manifest_hash text;

CREATE OR REPLACE FUNCTION public.verify_land_use_plan_decision_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE latest_release public.land_use_plan_review_releases%ROWTYPE;
BEGIN
  SELECT release.* INTO latest_release
  FROM public.land_use_plan_review_releases release
  WHERE release.plan_id = NEW.plan_id AND release.status = 'closed'
  ORDER BY release.round_number DESC
  LIMIT 1;

  IF latest_release.id IS NULL
    OR NEW.review_release_id IS DISTINCT FROM latest_release.id
    OR NEW.version_id IS DISTINCT FROM latest_release.version_id
    OR NEW.version_content_hash IS DISTINCT FROM latest_release.version_content_hash
  THEN
    RAISE EXCEPTION 'Decision must reference the exact latest closed public-review release';
  END IF;

  IF jsonb_typeof(NEW.adoption_manifest) <> 'object'
    OR NEW.adoption_manifest ->> 'planId' IS DISTINCT FROM NEW.plan_id::text
    OR NEW.adoption_manifest ->> 'versionId' IS DISTINCT FROM NEW.version_id::text
    OR NEW.adoption_manifest ->> 'versionContentHash' IS DISTINCT FROM NEW.version_content_hash
    OR NEW.adoption_manifest ->> 'reviewReleaseId' IS DISTINCT FROM NEW.review_release_id::text
    OR NEW.adoption_manifest ->> 'reviewOutcomeHash' IS DISTINCT FROM latest_release.outcome_hash
  THEN
    RAISE EXCEPTION 'Adoption manifest does not match the reviewed version and outcome';
  END IF;

  NEW.adoption_manifest_hash := encode(
    extensions.digest(convert_to(NEW.adoption_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_land_use_plan_adoption_v2(
  p_workspace_id uuid,
  p_plan_id uuid,
  p_version_id uuid,
  p_version_content_hash text,
  p_review_release_id uuid,
  p_adoption_manifest jsonb,
  p_decision_kind text,
  p_decision_body text,
  p_instrument_type text,
  p_instrument_identifier text,
  p_vote text,
  p_decided_on date,
  p_effective_on date,
  p_supporting_document_id uuid,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE decision_id uuid;
BEGIN
  INSERT INTO public.land_use_plan_decisions (
    workspace_id, plan_id, version_id, version_content_hash, review_release_id,
    adoption_manifest, decision_kind, decision_body, instrument_type,
    instrument_identifier, vote, decided_on, effective_on,
    supporting_document_id, created_by
  ) VALUES (
    p_workspace_id, p_plan_id, p_version_id, p_version_content_hash,
    p_review_release_id, p_adoption_manifest, p_decision_kind, p_decision_body,
    p_instrument_type, p_instrument_identifier, p_vote, p_decided_on,
    p_effective_on, p_supporting_document_id, p_created_by
  ) RETURNING id INTO decision_id;

  UPDATE public.land_use_plan_versions
    SET state = 'superseded'
    WHERE plan_id = p_plan_id AND state = 'adopted' AND id <> p_version_id;
  UPDATE public.land_use_plan_versions
    SET state = 'adopted'
    WHERE id = p_version_id AND plan_id = p_plan_id AND content_hash = p_version_content_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'Frozen version changed before adoption'; END IF;

  UPDATE public.land_use_plans
    SET current_adopted_version_id = p_version_id, current_working_version_id = NULL
    WHERE id = p_plan_id AND workspace_id = p_workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan changed before adoption'; END IF;
  RETURN decision_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_land_use_plan_adoption_v2(uuid,uuid,uuid,text,uuid,jsonb,text,text,text,text,text,date,date,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_land_use_plan_adoption_v2(uuid,uuid,uuid,text,uuid,jsonb,text,text,text,text,text,date,date,uuid,uuid) TO service_role;

ALTER TABLE public.land_use_plan_process_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_review_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY land_use_plan_process_records_member_read
  ON public.land_use_plan_process_records FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY land_use_plan_process_records_writer_all
  ON public.land_use_plan_process_records FOR ALL
  USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));
CREATE POLICY land_use_plan_review_releases_member_read
  ON public.land_use_plan_review_releases FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY land_use_plan_review_releases_writer_all
  ON public.land_use_plan_review_releases FOR ALL
  USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));

REVOKE ALL ON TABLE public.land_use_plan_process_records FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.land_use_plan_review_releases FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.land_use_plan_process_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.land_use_plan_review_releases TO authenticated;
GRANT ALL ON TABLE public.land_use_plan_process_records TO service_role;
GRANT ALL ON TABLE public.land_use_plan_review_releases TO service_role;

COMMENT ON TABLE public.land_use_plan_review_releases IS
  'Immutable public record of one exact frozen plan version released for review. Withdrawal hides content but retains this audit row.';
COMMENT ON COLUMN public.land_use_plan_designations.public_field_keys IS
  'Planner-selected source attributes allowed onto public review and adopted-plan maps. Every other source attribute stays private.';
COMMENT ON COLUMN public.land_use_plan_decisions.adoption_manifest IS
  'Frozen plan hash, review outcome, disposition, hearing evidence, decision record, and supporting references. Private consultation material is excluded.';
