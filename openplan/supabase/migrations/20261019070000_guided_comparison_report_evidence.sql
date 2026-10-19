-- Source-only candidate. Read exact legacy KPI receipts without replay or table grants.
-- The caller must first authorize the report's project and workspace.
CREATE FUNCTION public.read_guided_comparison_report_kpi_custody(
  p_workspace uuid, p_project uuid, p_snapshot uuid, p_run uuid, p_kpi uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.model_runs%ROWTYPE;
  k public.model_run_kpis%ROWTYPE;
  s public.model_run_stages%ROWTYPE;
  receipt public.model_legacy_kpi_receipts%ROWTYPE;
  method text;
BEGIN
  IF p_workspace IS NULL OR p_project IS NULL OR p_snapshot IS NULL OR p_run IS NULL OR p_kpi IS NULL THEN
    RAISE EXCEPTION 'Guided report KPI custody scope is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT run.* INTO r FROM public.model_runs run
    JOIN public.projects project ON project.id = run.project_id AND project.workspace_id = run.workspace_id
    WHERE run.id = p_run AND run.workspace_id = p_workspace AND run.project_id = p_project;
  IF NOT FOUND OR r.status <> 'succeeded' OR r.attempt_managed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Guided report KPI custody run is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT link.method INTO method FROM public.scenario_comparison_model_run_links link
    JOIN public.scenario_comparison_snapshots snapshot ON snapshot.id = link.comparison_snapshot_id
    JOIN public.scenario_sets scenario_set ON scenario_set.id = snapshot.scenario_set_id
    WHERE link.comparison_snapshot_id = p_snapshot AND link.model_run_id = r.id
      AND link.workspace_id = p_workspace AND scenario_set.workspace_id = p_workspace
      AND scenario_set.project_id = p_project AND scenario_set.id = r.scenario_set_id AND snapshot.status = 'ready'
      AND ((link.scenario_role = 'baseline' AND r.scenario_entry_id = snapshot.baseline_entry_id)
        OR (link.scenario_role = 'build' AND r.scenario_entry_id = snapshot.candidate_entry_id));
  IF NOT FOUND OR (SELECT pg_catalog.count(*) FROM public.scenario_comparison_model_run_links link
      WHERE link.comparison_snapshot_id = p_snapshot AND link.model_run_id = r.id) <> 1
    OR method NOT IN ('aequilibrae','activitysim')
    OR r.engine_key IS DISTINCT FROM CASE method WHEN 'aequilibrae' THEN 'aequilibrae' ELSE 'behavioral_demand' END THEN
    RAISE EXCEPTION 'Guided report KPI custody snapshot is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO k FROM public.model_run_kpis WHERE id = p_kpi AND run_id = r.id;
  IF NOT FOUND OR k.attempt_id IS NOT NULL OR k.geometry_ref IS NOT NULL OR k.value IS NULL
    OR k.value IN ('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision)
    OR NOT ((method = 'aequilibrae' AND ((k.kpi_name = 'total_trips' AND k.unit = 'trips/day')
       OR (k.kpi_name = 'daily_vmt' AND k.unit = 'vehicle-miles/day')))
      OR (method = 'activitysim' AND ((k.kpi_name = 'activitysim_trips' AND k.unit = 'trips')
       OR (k.kpi_name = 'activitysim_daily_vmt' AND k.unit = 'vehicle-miles/day')))) THEN
    RAISE EXCEPTION 'Guided report KPI custody value is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO receipt FROM public.model_legacy_kpi_receipts WHERE kpi_id = k.id AND run_id = r.id;
  IF NOT FOUND OR receipt.response_payload IS DISTINCT FROM pg_catalog.to_jsonb(k) THEN
    RAISE EXCEPTION 'Guided report KPI custody receipt is missing or changed' USING ERRCODE = '23514';
  END IF;
  SELECT stage.* INTO s FROM public.model_run_stages stage
    JOIN public.model_stage_execution_starts execution_start ON execution_start.stage_id = stage.id AND execution_start.run_id = stage.run_id
    WHERE stage.id::text = receipt.request_payload->'payload'->>'stage_id' AND stage.run_id = r.id;
  IF NOT FOUND OR s.status <> 'succeeded' OR s.attempt_managed IS DISTINCT FROM false OR s.active_attempt_id IS NOT NULL
    OR s.stage_name IS DISTINCT FROM CASE
      WHEN method = 'aequilibrae' THEN 'Artifact Extraction'
      WHEN k.kpi_name = 'activitysim_trips' THEN 'ActivitySim Bundle & Preflight'
      ELSE 'ActivitySim Network Assignment' END
    OR NOT EXISTS (SELECT 1 FROM public.model_execution_custody_enrollment enrollment
      WHERE enrollment.run_id = r.id AND enrollment.provenance = 'new_run')
    OR receipt.request_payload IS DISTINCT FROM pg_catalog.jsonb_build_object('workspace_id',p_workspace,'payload',
      pg_catalog.jsonb_build_object('id',k.id,'run_id',k.run_id,'stage_id',s.id,'kpi_name',k.kpi_name,
        'kpi_label',k.kpi_label,'kpi_category',k.kpi_category,'value',k.value,'unit',k.unit,
        'geometry_ref',k.geometry_ref,'breakdown_json',k.breakdown_json)) THEN
    RAISE EXCEPTION 'Guided report KPI custody stage or request is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN pg_catalog.jsonb_build_object('schema','openplan.guided-report-kpi-custody.v1',
    'workspace_id',p_workspace,'project_id',p_project,'snapshot_id',p_snapshot,'run_id',r.id,
    'kpi_id',k.id,'stage_id',s.id,'custody','legacy_stage_snapshot','eligible',true,
    'kpi',pg_catalog.jsonb_build_object('id',k.id,'run_id',k.run_id,'attempt_id',k.attempt_id,
      'kpi_name',k.kpi_name,'kpi_label',k.kpi_label,'kpi_category',k.kpi_category,
      'value',k.value,'unit',k.unit,'geometry_ref',k.geometry_ref,'breakdown_json',k.breakdown_json));
END;
$$;
REVOKE ALL ON FUNCTION public.read_guided_comparison_report_kpi_custody(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_comparison_report_kpi_custody(uuid,uuid,uuid,uuid,uuid) TO service_role;

-- The earlier shared trigger uses now(), which is stable within a transaction.
-- Reports needs a distinct database revision for every successful update. Keep
-- other tables on their existing trigger and ignore caller-supplied timestamps.
CREATE FUNCTION public.set_report_revision_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT pg_catalog.isfinite(OLD.updated_at) THEN
    RAISE EXCEPTION 'Report revision is not finite' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := GREATEST(pg_catalog.clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_report_revision_updated_at() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER trg_reports_updated_at ON public.reports;
CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_report_revision_updated_at();

-- New guided artifacts retain both selection copies, rendered content and file
-- identity. Ordinary generation may record its first writeback receipt. Legacy
-- artifacts keep their existing behavior and cannot acquire a seal by UPDATE.
CREATE FUNCTION public.guard_report_guided_comparison_artifact() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_selection jsonb;
  v_context_selection jsonb;
  v_report public.reports%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(OLD.metadata_json->'guidedComparisonSelectionV1', 'null'::jsonb) <> 'null'::jsonb
      OR coalesce(OLD.metadata_json->'sourceContext'->'guidedComparisonSelectionV1', 'null'::jsonb) <> 'null'::jsonb THEN
      RAISE EXCEPTION 'Retained guided artifacts cannot be deleted or replaced' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  v_selection := coalesce(NEW.metadata_json->'guidedComparisonSelectionV1', 'null'::jsonb);
  v_context_selection := coalesce(NEW.metadata_json->'sourceContext'->'guidedComparisonSelectionV1', 'null'::jsonb);
  IF TG_OP = 'INSERT' THEN
    IF v_selection = 'null'::jsonb AND v_context_selection = 'null'::jsonb THEN RETURN NEW; END IF;
    IF current_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'Guided artifacts require the authorized generation server' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO STRICT v_report FROM public.reports WHERE id = NEW.report_id FOR SHARE;
    IF current_user = 'service_role' THEN
      PERFORM 1 FROM public.workspace_members WHERE workspace_id = v_report.workspace_id
        AND user_id = NEW.generated_by AND role IN ('owner','admin','member') FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Guided artifact writer is unavailable' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF pg_catalog.jsonb_typeof(v_selection) IS DISTINCT FROM 'object'
      OR v_selection IS DISTINCT FROM v_context_selection
      OR v_selection->'version' IS DISTINCT FROM '1'::jsonb
      OR coalesce(v_selection->>'bindingSha256', '') !~ '^[a-f0-9]{64}$'
      OR v_selection->'payload'->>'schema' IS DISTINCT FROM 'openplan.guided-comparison-report.v1'
      OR v_selection->>'snapshotId' IS NULL
      OR v_selection->'payload'->>'snapshotId' IS DISTINCT FROM v_selection->>'snapshotId'
      OR v_selection->'payload'->>'workspaceId' IS DISTINCT FROM v_report.workspace_id::text
      OR v_selection->'payload'->>'projectId' IS DISTINCT FROM v_report.project_id::text
      OR v_report.project_id IS NULL OR v_report.rtp_cycle_id IS NOT NULL OR v_report.engagement_campaign_id IS NOT NULL
      OR v_report.report_type <> 'analysis_summary'
      OR pg_catalog.jsonb_typeof(NEW.metadata_json->'htmlContent') IS DISTINCT FROM 'string'
      OR NEW.storage_path IS DISTINCT FROM v_report.workspace_id::text || '/' || NEW.report_id::text || '/' || NEW.id::text || '.' || NEW.artifact_kind
      OR coalesce(NEW.metadata_json->'generationWriteback', 'null'::jsonb) <> 'null'::jsonb THEN
      RAISE EXCEPTION 'Guided artifact does not match its retained selection and identity' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF coalesce(OLD.metadata_json->'guidedComparisonSelectionV1', 'null'::jsonb) IS DISTINCT FROM v_selection
      OR coalesce(OLD.metadata_json->'sourceContext'->'guidedComparisonSelectionV1', 'null'::jsonb) IS DISTINCT FROM v_context_selection THEN
      RAISE EXCEPTION 'Guided artifact selections are immutable; regenerate a new artifact' USING ERRCODE = '23514';
    END IF;
    IF v_selection = 'null'::jsonb AND v_context_selection = 'null'::jsonb THEN RETURN NEW; END IF;
    IF ROW(NEW.id, NEW.report_id, NEW.created_at, NEW.generated_at, NEW.generated_by, NEW.artifact_kind, NEW.storage_path)
      IS DISTINCT FROM ROW(OLD.id, OLD.report_id, OLD.created_at, OLD.generated_at, OLD.generated_by, OLD.artifact_kind, OLD.storage_path)
      OR NEW.metadata_json->'htmlContent' IS DISTINCT FROM OLD.metadata_json->'htmlContent'
      OR NEW.metadata_json->'generatedAt' IS DISTINCT FROM OLD.metadata_json->'generatedAt'
      OR NEW.metadata_json->'pdfEngine' IS DISTINCT FROM OLD.metadata_json->'pdfEngine' THEN
      RAISE EXCEPTION 'Guided artifact identity and rendered evidence are immutable' USING ERRCODE = '23514';
    END IF;
    IF coalesce(OLD.metadata_json->'generationWriteback', 'null'::jsonb) <> 'null'::jsonb THEN
      IF NEW.metadata_json->'generationWriteback' IS DISTINCT FROM OLD.metadata_json->'generationWriteback' THEN
        RAISE EXCEPTION 'Guided generation receipt is immutable' USING ERRCODE = '23514';
      END IF;
    ELSIF coalesce(NEW.metadata_json->'generationWriteback', 'null'::jsonb) <> 'null'::jsonb THEN
      SELECT * INTO STRICT v_report FROM public.reports WHERE id = NEW.report_id FOR SHARE;
      IF pg_catalog.jsonb_typeof(NEW.metadata_json->'generationWriteback') IS DISTINCT FROM 'object'
        OR NEW.metadata_json->'generationWriteback'->>'schema' IS DISTINCT FROM 'openplan.report-generation-writeback.v1'
        OR (NEW.metadata_json->'generationWriteback'->>'reportUpdatedAt')::timestamptz IS DISTINCT FROM v_report.updated_at THEN
        RAISE EXCEPTION 'Guided generation receipt does not match report writeback' USING ERRCODE = '40001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_report_guided_comparison_artifact() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_report_guided_comparison_artifact BEFORE INSERT OR UPDATE OR DELETE ON public.report_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_guided_comparison_artifact();
