-- Three permission and data-integrity repairs from the October 12, 2026 review
-- (KI-2026-10-12-021 and KI-2026-10-12-022). Additive: no table, column or row
-- changes; existing rows are not read, validated or rewritten.
--
-- 1. Contract role oracle. contract_snapshot_can_read(uuid,uuid) and
--    contract_calculation_job_visible(uuid,uuid,text) were granted to
--    `authenticated` and take the actor id from the caller, so any signed-in
--    user could ask whether another user may read a snapshot or a job, which
--    discloses that user's contract role. A policy expression runs as the
--    querying role, so that role needs EXECUTE on every function the policy
--    calls, even a SECURITY DEFINER one. The policies therefore move to new
--    wrappers that read auth.uid() themselves, and only then does
--    `authenticated` lose EXECUTE on the two-argument forms. SECURITY DEFINER
--    bodies that call the two-argument forms (enqueue, finish, retry, export
--    and storage checks) run as the function owner and are unaffected.
--
-- 2. Map packages. create_project_map_package accepted a funding opportunity
--    from another project in the same workspace, and a retry with a changed
--    client name or practice marking returned the original package as a
--    successful retry. The replacement keeps the signature, owner, grants,
--    SECURITY DEFINER and search_path of 20261017000001.
--
-- 3. Census tract loads. Any signed-in user could drive unlimited county
--    loads into the shared census_tracts table through the service role.
--    reserve_census_tract_ingest checks that the person is an owner, admin or
--    member of the workspace and records each county in usage_events under a
--    per-person allowance of 20 counties per rolling hour, counted and
--    recorded under one advisory lock so concurrent requests cannot overrun it.
BEGIN;

-- 1. Contract role oracle -----------------------------------------------------

CREATE FUNCTION public.contract_snapshot_caller_can_read(p_snapshot_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.contract_snapshot_can_read(p_snapshot_id, auth.uid())
$$;
REVOKE ALL ON FUNCTION public.contract_snapshot_caller_can_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_snapshot_caller_can_read(uuid) TO authenticated, service_role;

CREATE FUNCTION public.contract_calculation_job_caller_visible(p_engagement uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.contract_calculation_job_visible(p_engagement, auth.uid(), p_kind)
$$;
REVOKE ALL ON FUNCTION public.contract_calculation_job_caller_visible(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_calculation_job_caller_visible(uuid, text) TO authenticated, service_role;

ALTER POLICY management_read ON public.contract_snapshots
  USING (public.contract_snapshot_caller_can_read(id));
ALTER POLICY private_contract_documents ON public.kb_documents
  USING (contract_snapshot_id IS NULL OR public.contract_snapshot_caller_can_read(contract_snapshot_id));
ALTER POLICY scoped_job_read ON public.contract_calculation_jobs
  USING (public.contract_calculation_job_caller_visible(engagement_id, kind));

REVOKE ALL ON FUNCTION public.contract_snapshot_can_read(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contract_calculation_job_visible(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_snapshot_can_read(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.contract_calculation_job_visible(uuid, uuid, text) TO service_role;

-- 2. Map packages ---------------------------------------------------------------

-- One request id makes a retried create return the same package, and refuses a
-- retry whose contents differ. A linked grant application must belong to the
-- package's own project.
CREATE OR REPLACE FUNCTION public.create_project_map_package(p_request_id uuid,p_user_id uuid,p_workspace_id uuid,p_project_id uuid,
  p_title text,p_source text,p_deliverable text,p_funding_opportunity_id uuid,p_connection_id uuid,
  p_provider text,p_auth_mode text,p_model_id text,p_effort text,p_brief_canonical text,p_skill_tree_hash text,p_upload_file_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; saved public.project_map_packages; created boolean;
BEGIN
  PERFORM public.assert_map_package_writer(p_user_id,p_workspace_id,p_project_id);
  IF p_funding_opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.funding_opportunities
      WHERE id=p_funding_opportunity_id AND workspace_id=p_workspace_id AND project_id=p_project_id) THEN
    RAISE EXCEPTION 'Map package access denied' USING ERRCODE='42501';
  END IF;
  IF p_source='agent' THEN
    SELECT * INTO connection FROM public.assistant_provider_connections WHERE id=p_connection_id FOR SHARE;
    IF NOT FOUND OR connection.user_id IS DISTINCT FROM p_user_id OR connection.workspace_id IS DISTINCT FROM p_workspace_id
      OR connection.project_id IS DISTINCT FROM p_project_id OR connection.provider IS DISTINCT FROM p_provider
      OR connection.expected_auth_mode IS DISTINCT FROM p_auth_mode
      OR connection.revoked_at IS NOT NULL OR connection.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Map package connection denied' USING ERRCODE='42501';
    END IF;
  END IF;
  INSERT INTO public.project_map_packages(request_id,workspace_id,project_id,requested_by,title,source,deliverable,funding_opportunity_id,
      connection_id,provider,auth_mode,model_id,effort,brief,brief_canonical,brief_hash,skill_tree_hash,upload_file_name,state)
    VALUES(p_request_id,p_workspace_id,p_project_id,p_user_id,trim(p_title),p_source,p_deliverable,p_funding_opportunity_id,
      p_connection_id,p_provider,p_auth_mode,p_model_id,p_effort,p_brief_canonical::jsonb,p_brief_canonical,
      CASE WHEN p_brief_canonical IS NULL THEN NULL ELSE encode(extensions.digest(convert_to(p_brief_canonical,'UTF8'),'sha256'),'hex') END,
      p_skill_tree_hash,p_upload_file_name,CASE WHEN p_source='agent' THEN 'queued' ELSE 'uploading' END)
    ON CONFLICT(workspace_id,request_id) DO NOTHING RETURNING * INTO saved;
  created:=FOUND;
  IF NOT created THEN
    SELECT * INTO saved FROM public.project_map_packages WHERE workspace_id=p_workspace_id AND request_id=p_request_id;
    IF saved.requested_by IS DISTINCT FROM p_user_id OR saved.project_id IS DISTINCT FROM p_project_id OR saved.source IS DISTINCT FROM p_source
      OR saved.title IS DISTINCT FROM trim(p_title) OR saved.deliverable IS DISTINCT FROM p_deliverable
      OR saved.funding_opportunity_id IS DISTINCT FROM p_funding_opportunity_id OR saved.connection_id IS DISTINCT FROM p_connection_id
      OR saved.model_id IS DISTINCT FROM p_model_id OR saved.skill_tree_hash IS DISTINCT FROM p_skill_tree_hash
      OR saved.upload_file_name IS DISTINCT FROM p_upload_file_name
      OR (saved.brief->'project') IS DISTINCT FROM (p_brief_canonical::jsonb->'project')
      OR (saved.brief->>'request') IS DISTINCT FROM (p_brief_canonical::jsonb->>'request')
      OR (saved.brief->'client') IS DISTINCT FROM (p_brief_canonical::jsonb->'client')
      OR (saved.brief->'practice') IS DISTINCT FROM (p_brief_canonical::jsonb->'practice') THEN
      RAISE EXCEPTION 'The saved map package request differs from this retry' USING ERRCODE='PT409';
    END IF;
  END IF;
  RETURN jsonb_build_object('created',created,'package',to_jsonb(saved)-'brief'-'brief_canonical');
END $$;
REVOKE ALL ON FUNCTION public.create_project_map_package(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_map_package(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,text,text) TO service_role;

-- 3. Census tract loads ---------------------------------------------------------

-- Returns {allowed, recent, limit, retryAfterSeconds}. A refusal records
-- nothing. Counties are five-digit state plus county FIPS codes. The count
-- uses usage_events_event_key_idx through the per-person event key.
CREATE FUNCTION public.reserve_census_tract_ingest(p_user_id uuid, p_workspace_id uuid, p_counties text[], p_source_route text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  allowance constant integer := 20;
  window_length constant interval := interval '1 hour';
  member_role text;
  requested integer := coalesce(cardinality(p_counties), 0);
  recent integer;
  oldest timestamptz;
  person_key text;
BEGIN
  IF p_user_id IS NULL OR p_workspace_id IS NULL OR requested NOT BETWEEN 1 AND 8
    OR EXISTS (SELECT 1 FROM unnest(p_counties) AS c(fips) WHERE c.fips IS NULL OR c.fips !~ '^[0-9]{5}$')
    OR p_source_route IS NULL OR length(p_source_route) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Name one to eight five-digit county codes and the requesting route' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO member_role FROM public.workspace_members WHERE user_id = p_user_id AND workspace_id = p_workspace_id;
  IF NOT FOUND OR lower(trim(coalesce(member_role, ''))) NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Census tract load access denied' USING ERRCODE = '42501';
  END IF;
  person_key := 'census_tract_ingest:' || p_user_id::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(person_key, 0));
  SELECT count(*), min(occurred_at) INTO recent, oldest FROM public.usage_events
    WHERE event_key = person_key AND bucket_key = 'census_tract_ingest'
      AND occurred_at > clock_timestamp() - window_length;
  IF recent + requested > allowance THEN
    RETURN jsonb_build_object('allowed', false, 'recent', recent, 'limit', allowance,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch FROM (coalesce(oldest, clock_timestamp()) + window_length - clock_timestamp())))::integer));
  END IF;
  INSERT INTO public.usage_events(workspace_id, event_key, bucket_key, weight, source_route, metadata_json, occurred_at)
    SELECT p_workspace_id, person_key, 'census_tract_ingest', 1, p_source_route,
      jsonb_build_object('userId', p_user_id, 'county', c.fips), clock_timestamp()
    FROM unnest(p_counties) AS c(fips);
  RETURN jsonb_build_object('allowed', true, 'recent', recent + requested, 'limit', allowance, 'retryAfterSeconds', 0);
END $$;
REVOKE ALL ON FUNCTION public.reserve_census_tract_ingest(uuid, uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_census_tract_ingest(uuid, uuid, text[], text) TO service_role;

COMMIT;
