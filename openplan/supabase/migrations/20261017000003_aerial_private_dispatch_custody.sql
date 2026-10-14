-- Candidate original dispatch custody. No default worker or public contract changes.
-- Signed source URLs stay outside member-readable jobs and callback records.
CREATE SCHEMA IF NOT EXISTS openplan_odm_private;
REVOKE ALL ON SCHEMA openplan_odm_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA openplan_odm_private TO service_role;

CREATE TABLE openplan_odm_private.original_dispatches (
  job_id uuid PRIMARY KEY REFERENCES public.aerial_processing_jobs(id) ON DELETE CASCADE,
  request_id text NOT NULL UNIQUE,
  installation_id text NOT NULL CHECK (length(btrim(installation_id)) BETWEEN 1 AND 256),
  target_id text NOT NULL CHECK (length(btrim(target_id)) BETWEEN 1 AND 256),
  application_job jsonb NOT NULL,
  payload_text text NOT NULL CHECK (octet_length(payload_text) BETWEEN 1 AND 33554432),
  -- Supabase uses UTF-8 database text. The immutable text digest overload
  -- hashes those bytes; convert_to is stable and cannot be a generated column.
  payload_sha256 text GENERATED ALWAYS AS
    (encode(extensions.digest(payload_text, 'sha256'), 'hex')) STORED,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE openplan_odm_private.original_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON openplan_odm_private.original_dispatches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON openplan_odm_private.original_dispatches TO service_role;

-- The backend role cannot read or lock auth.users directly. These unexposed,
-- service-only helpers return one actor's existence and keep its deletion lock
-- through admission. Their fixed search path and qualified query are required.
CREATE FUNCTION openplan_odm_private.lock_actor(p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM 1 FROM auth.users WHERE id = p_actor FOR KEY SHARE;
  RETURN FOUND;
END;
$$;
CREATE FUNCTION openplan_odm_private.actor_exists(p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor);
$$;
REVOKE ALL ON FUNCTION openplan_odm_private.lock_actor(uuid), openplan_odm_private.actor_exists(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION openplan_odm_private.lock_actor(uuid), openplan_odm_private.actor_exists(uuid) TO service_role;

-- The trusted backend role needs INSERT for these invoker functions. The private
-- schema is not an exposed Data API schema; do not add it to that configuration.
-- UPDATE and DELETE remain unavailable to that role. Parent deletion can cascade.
CREATE FUNCTION public.record_aerial_original_dispatch(
  p_job uuid, p_actor uuid, p_installation text, p_target text, p_payload_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  original public.aerial_processing_jobs%ROWTYPE;
  current_job public.aerial_processing_jobs%ROWTYPE;
  mission public.aerial_missions%ROWTYPE;
  payload jsonb;
  projection jsonb;
  saved openplan_odm_private.original_dispatches%ROWTYPE;
  member_role text;
BEGIN
  IF p_actor IS NULL OR p_installation IS NULL OR p_target IS NULL
    OR length(btrim(p_installation)) NOT BETWEEN 1 AND 256
    OR length(btrim(p_target)) NOT BETWEEN 1 AND 256
    OR p_payload_text IS NULL OR octet_length(p_payload_text) NOT BETWEEN 1 AND 33554432 THEN
    RAISE EXCEPTION 'Original aerial dispatch identity or byte limit differs' USING ERRCODE = '22023';
  END IF;
  payload := p_payload_text::jsonb;
  SELECT * INTO original FROM public.aerial_processing_jobs WHERE id = p_job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original aerial job is unavailable' USING ERRCODE = 'P0002'; END IF;

  -- Lock parents before their child job. A concurrent parent deletion must not
  -- deadlock against a job-first lock followed by that parent.
  IF NOT openplan_odm_private.lock_actor(p_actor) THEN
    RAISE EXCEPTION 'Original aerial actor is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspaces WHERE id = original.workspace_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original aerial workspace is unavailable' USING ERRCODE = 'P0002'; END IF;
  IF original.project_id IS NOT NULL THEN
    PERFORM 1 FROM public.projects WHERE id = original.project_id AND workspace_id = original.workspace_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Original aerial project scope differs' USING ERRCODE = '42501'; END IF;
  END IF;
  -- Mission and job writes also update their project's evidence revision.
  -- Refuse a held child instead of waiting while holding that project row.
  SELECT * INTO mission FROM public.aerial_missions WHERE id = original.mission_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original aerial mission is unavailable' USING ERRCODE = 'P0002'; END IF;
  -- Owner-floor revocation locks its membership before its workspace. Refuse
  -- an already locked member row instead of deadlocking against that trigger.
  SELECT role INTO member_role FROM public.workspace_members
    WHERE workspace_id = original.workspace_id AND user_id = p_actor FOR SHARE NOWAIT;
  IF NOT FOUND OR member_role IS NULL OR member_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Original aerial actor cannot process this workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO current_job FROM public.aerial_processing_jobs WHERE id = p_job FOR UPDATE NOWAIT;
  IF NOT FOUND OR current_job.workspace_id IS DISTINCT FROM original.workspace_id
    OR current_job.project_id IS DISTINCT FROM original.project_id
    OR current_job.mission_id IS DISTINCT FROM original.mission_id
    OR current_job.request_id IS DISTINCT FROM original.request_id
    OR current_job.created_by IS DISTINCT FROM original.created_by
    OR current_job.preset_id IS DISTINCT FROM original.preset_id
    OR current_job.imagery_type IS DISTINCT FROM original.imagery_type
    OR current_job.created_by IS DISTINCT FROM p_actor
    OR current_job.status <> 'requested'
    OR mission.workspace_id IS DISTINCT FROM original.workspace_id
    OR mission.project_id IS DISTINCT FROM original.project_id THEN
    RAISE EXCEPTION 'Original aerial job or mission scope changed' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
    OR payload->>'requestId' IS DISTINCT FROM current_job.request_id
    OR payload#>>'{externalRef,system}' IS DISTINCT FROM 'openplan'
    OR payload#>>'{externalRef,workspaceId}' IS DISTINCT FROM current_job.workspace_id::text
    OR payload#>>'{externalRef,missionId}' IS DISTINCT FROM current_job.mission_id::text
    OR payload#>>'{externalRef,projectId}' IS DISTINCT FROM current_job.project_id::text
    OR coalesce(payload->>'presetId', 'balanced') IS DISTINCT FROM current_job.preset_id
    OR payload#>>'{imagery,type}' IS DISTINCT FROM current_job.imagery_type
    OR payload->>'schemaVersion' IS DISTINCT FROM
      (CASE current_job.imagery_type WHEN 'zip_url' THEN 'natford-aerial-processing.v1'
        WHEN 'photo_manifest' THEN 'natford-aerial-processing.v1.1' ELSE NULL END) THEN
    RAISE EXCEPTION 'Original aerial payload scope differs' USING ERRCODE = '22023';
  END IF;
  projection := jsonb_build_object('id', current_job.id, 'request_id', current_job.request_id,
    'workspace_id', current_job.workspace_id, 'project_id', current_job.project_id,
    'mission_id', current_job.mission_id, 'created_by', current_job.created_by,
    'preset_id', current_job.preset_id, 'imagery_type', current_job.imagery_type);
  INSERT INTO openplan_odm_private.original_dispatches
    (job_id, request_id, installation_id, target_id, application_job, payload_text)
    VALUES (p_job, current_job.request_id, p_installation, p_target, projection, p_payload_text)
    ON CONFLICT (job_id) DO NOTHING;
  SELECT * INTO saved FROM openplan_odm_private.original_dispatches WHERE job_id = p_job;
  IF NOT FOUND OR saved.request_id IS DISTINCT FROM current_job.request_id
    OR saved.installation_id IS DISTINCT FROM p_installation OR saved.target_id IS DISTINCT FROM p_target
    OR saved.application_job IS DISTINCT FROM projection OR saved.payload_text IS DISTINCT FROM p_payload_text THEN
    RAISE EXCEPTION 'Original aerial dispatch cannot be replaced' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object('format', 'openplan.odm-application-dispatch.v1',
    'installationId', saved.installation_id, 'targetId', saved.target_id,
    'applicationJob', saved.application_job, 'payloadText', saved.payload_text,
    'payloadBytes', octet_length(saved.payload_text), 'payloadSha256', saved.payload_sha256,
    'engineTransportPermission', false);
END;
$$;
REVOKE ALL ON FUNCTION public.record_aerial_original_dispatch(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_aerial_original_dispatch(uuid, uuid, text, text, text) TO service_role;

-- Read original custody separately from current permission. Missing/deleted or
-- changed parents and a revoked actor produce false, without changing the receipt.
-- This observation is not a durable permission grant or engine command receipt.
CREATE FUNCTION public.read_aerial_original_dispatch(p_request text, p_installation text, p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  saved openplan_odm_private.original_dispatches%ROWTYPE;
  allowed boolean;
BEGIN
  SELECT * INTO saved FROM openplan_odm_private.original_dispatches
    WHERE request_id = p_request AND installation_id = p_installation AND target_id = p_target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original aerial dispatch is unavailable' USING ERRCODE = 'P0002'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.aerial_processing_jobs job
    JOIN public.aerial_missions mission ON mission.id = job.mission_id
    JOIN public.workspace_members member ON member.workspace_id = job.workspace_id AND member.user_id = job.created_by
    WHERE job.id = saved.job_id AND job.request_id = saved.request_id
      AND job.id::text = saved.application_job->>'id'
      AND job.request_id = saved.application_job->>'request_id'
      AND job.workspace_id::text = saved.application_job->>'workspace_id'
      AND job.mission_id::text = saved.application_job->>'mission_id'
      AND job.project_id::text IS NOT DISTINCT FROM saved.application_job->>'project_id'
      AND job.created_by::text = saved.application_job->>'created_by'
      AND openplan_odm_private.actor_exists(job.created_by)
      AND job.preset_id = saved.application_job->>'preset_id'
      AND job.imagery_type = saved.application_job->>'imagery_type'
      AND job.status IN ('requested', 'accepted', 'running')
      AND mission.workspace_id = job.workspace_id AND mission.project_id IS NOT DISTINCT FROM job.project_id
      AND member.role IN ('owner', 'admin', 'member')
      AND (job.project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects project
        WHERE project.id = job.project_id AND project.workspace_id = job.workspace_id))
  ) INTO allowed;
  RETURN jsonb_build_object('format', 'openplan.odm-application-dispatch.v1',
    'installationId', saved.installation_id, 'targetId', saved.target_id,
    'applicationJob', saved.application_job, 'payloadText', saved.payload_text,
    'payloadBytes', octet_length(saved.payload_text), 'payloadSha256', saved.payload_sha256,
    'authorizedNow', allowed, 'authorityObservedAt', clock_timestamp(), 'engineTransportPermission', false);
END;
$$;
REVOKE ALL ON FUNCTION public.read_aerial_original_dispatch(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_aerial_original_dispatch(text, text, text) TO service_role;
