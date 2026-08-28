-- One project revision must cover the records frozen into its governed handoff.
-- Otherwise a related model, crash, engagement item, report, or GIS record can
-- change while the project row stays still and an old bundle still looks current.

CREATE OR REPLACE FUNCTION public.set_projects_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_project_evidence_revision(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_project_id IS NOT NULL THEN
    UPDATE public.projects
    SET updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
    WHERE id = p_project_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_project_evidence_revision(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bump_project_revision_from_direct_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_old_project_id uuid;
  v_new_project_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_project_id := nullif(to_jsonb(OLD)->>'project_id', '')::uuid;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_project_id := nullif(to_jsonb(NEW)->>'project_id', '')::uuid;
  END IF;

  PERFORM public.touch_project_evidence_revision(v_old_project_id);
  IF v_new_project_id IS DISTINCT FROM v_old_project_id THEN
    PERFORM public.touch_project_evidence_revision(v_new_project_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_project_revision_from_direct_evidence() FROM PUBLIC, anon, authenticated;

-- These rows either enter the bundle directly or decide which exact source
-- records the generated project/model/GIS files contain.
DO $direct_triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'project_corridors',
    'plans',
    'kb_documents',
    'reports',
    'client_invoices',
    'funding_opportunities',
    'data_dataset_project_links',
    'models',
    'model_runs',
    'county_runs',
    'safety_crash_ingests',
    'engagement_campaigns',
    'aerial_missions',
    'aerial_processing_jobs',
    'aerial_evidence_packages',
    'land_use_plan_implementation_actions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_project_evidence_revision ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_project_evidence_revision AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_direct_evidence()',
      v_table,
      v_table
    );
  END LOOP;
END
$direct_triggers$;

CREATE OR REPLACE FUNCTION public.bump_project_revision_from_parent_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_old_parent_id uuid;
  v_new_parent_id uuid;
  v_parent_id uuid;
  v_project_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_parent_id := nullif(to_jsonb(OLD)->>TG_ARGV[0], '')::uuid;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_parent_id := nullif(to_jsonb(NEW)->>TG_ARGV[0], '')::uuid;
  END IF;

  FOR v_parent_id IN
    SELECT DISTINCT parent_id
    FROM (VALUES (v_old_parent_id), (v_new_parent_id)) AS parents(parent_id)
    WHERE parent_id IS NOT NULL
  LOOP
    EXECUTE format('SELECT project_id FROM public.%I WHERE id = $1', TG_ARGV[1])
      INTO v_project_id
      USING v_parent_id;
    PERFORM public.touch_project_evidence_revision(v_project_id);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_project_revision_from_parent_evidence() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_report_artifacts_project_evidence_revision ON public.report_artifacts;
CREATE TRIGGER trg_report_artifacts_project_evidence_revision
AFTER INSERT OR UPDATE OR DELETE ON public.report_artifacts
FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_parent_evidence('report_id', 'reports');

DROP TRIGGER IF EXISTS trg_funding_exports_project_evidence_revision ON public.funding_opportunity_application_exports;
CREATE TRIGGER trg_funding_exports_project_evidence_revision
AFTER INSERT OR UPDATE OR DELETE ON public.funding_opportunity_application_exports
FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_parent_evidence('opportunity_id', 'funding_opportunities');

DROP TRIGGER IF EXISTS trg_model_artifacts_project_evidence_revision ON public.model_run_artifacts;
CREATE TRIGGER trg_model_artifacts_project_evidence_revision
AFTER INSERT OR UPDATE OR DELETE ON public.model_run_artifacts
FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_parent_evidence('run_id', 'model_runs');

DROP TRIGGER IF EXISTS trg_safety_crashes_project_evidence_revision ON public.safety_crashes;
CREATE TRIGGER trg_safety_crashes_project_evidence_revision
AFTER INSERT OR UPDATE OR DELETE ON public.safety_crashes
FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_parent_evidence('ingest_id', 'safety_crash_ingests');

DROP TRIGGER IF EXISTS trg_engagement_items_project_evidence_revision ON public.engagement_items;
CREATE TRIGGER trg_engagement_items_project_evidence_revision
AFTER INSERT OR UPDATE OR DELETE ON public.engagement_items
FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_parent_evidence('campaign_id', 'engagement_campaigns');

DROP TRIGGER IF EXISTS trg_aerial_imagery_project_evidence_revision ON public.aerial_imagery;
CREATE TRIGGER trg_aerial_imagery_project_evidence_revision
AFTER INSERT OR UPDATE OR DELETE ON public.aerial_imagery
FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_parent_evidence('mission_id', 'aerial_missions');

DROP TRIGGER IF EXISTS trg_aerial_custody_project_evidence_revision ON public.aerial_artifact_custody;
CREATE TRIGGER trg_aerial_custody_project_evidence_revision
AFTER INSERT OR UPDATE OR DELETE ON public.aerial_artifact_custody
FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_parent_evidence('processing_job_id', 'aerial_processing_jobs');

CREATE OR REPLACE FUNCTION public.bump_project_revision_from_modeling_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_model_run_id uuid;
  v_county_run_id uuid;
  v_project_id uuid;
  v_record jsonb;
BEGIN
  FOREACH v_record IN ARRAY ARRAY[
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  ] LOOP
    IF v_record IS NULL THEN CONTINUE; END IF;
    v_model_run_id := nullif(v_record->>'model_run_id', '')::uuid;
    v_county_run_id := nullif(v_record->>'county_run_id', '')::uuid;
    IF v_model_run_id IS NOT NULL THEN
      SELECT project_id INTO v_project_id FROM public.model_runs WHERE id = v_model_run_id;
      PERFORM public.touch_project_evidence_revision(v_project_id);
    END IF;
    IF v_county_run_id IS NOT NULL THEN
      SELECT project_id INTO v_project_id FROM public.county_runs WHERE id = v_county_run_id;
      PERFORM public.touch_project_evidence_revision(v_project_id);
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_project_revision_from_modeling_evidence() FROM PUBLIC, anon, authenticated;

DO $modeling_triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'modeling_source_manifests',
    'modeling_validation_results',
    'modeling_claim_decisions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_project_evidence_revision ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_project_evidence_revision AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_project_revision_from_modeling_evidence()',
      v_table,
      v_table
    );
  END LOOP;
END
$modeling_triggers$;

CREATE OR REPLACE FUNCTION public.bump_linked_projects_from_dataset_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_project_id uuid;
BEGIN
  FOR v_project_id IN
    SELECT link.project_id
    FROM public.data_dataset_project_links link
    WHERE link.dataset_id = OLD.id
  LOOP
    PERFORM public.touch_project_evidence_revision(v_project_id);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_linked_projects_from_dataset_revision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_data_datasets_project_evidence_revision ON public.data_datasets;
CREATE TRIGGER trg_data_datasets_project_evidence_revision
BEFORE UPDATE OR DELETE ON public.data_datasets
FOR EACH ROW EXECUTE FUNCTION public.bump_linked_projects_from_dataset_revision();

COMMENT ON FUNCTION public.touch_project_evidence_revision(uuid) IS
  'Advances the project aggregate revision whenever a source frozen into its evidence or decision package changes.';
