-- Separate current access for original artifact downloads and terminal replay.
-- The processing reader remains limited to active jobs. This function issues
-- no engine command and does not write or approve a callback or product.
CREATE FUNCTION public.read_aerial_delivery_authority(
  p_request text, p_installation text, p_target text, p_reference text, p_operation text,
  p_callback jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  saved openplan_odm_private.original_dispatches%ROWTYPE;
  allowed boolean;
BEGIN
  IF p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'Original aerial delivery reference differs' USING ERRCODE = '22023';
  END IF;
  IF p_operation IS NULL OR p_operation NOT IN
    ('original_application_artifact_download', 'original_application_terminal_delivery') THEN
    RAISE EXCEPTION 'Original aerial delivery operation differs' USING ERRCODE = '22023';
  END IF;
  IF (p_operation = 'original_application_artifact_download' AND p_callback IS NOT NULL)
    OR (p_operation = 'original_application_terminal_delivery' AND
      (p_callback IS NULL OR jsonb_typeof(p_callback) IS DISTINCT FROM 'object')) THEN
    RAISE EXCEPTION 'Original aerial delivery callback scope differs' USING ERRCODE = '22023';
  END IF;
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
      AND (job.job_reference = p_reference OR (job.job_reference IS NULL AND job.status = 'requested'))
      AND mission.workspace_id = job.workspace_id AND mission.project_id IS NOT DISTINCT FROM job.project_id
      AND member.role IN ('owner', 'admin', 'member')
      AND (job.project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects project
        WHERE project.id = job.project_id AND project.workspace_id = job.workspace_id))
      AND (
        (p_operation = 'original_application_artifact_download'
          AND job.status IN ('requested', 'accepted', 'running', 'succeeded'))
        OR (p_operation = 'original_application_terminal_delivery'
          AND p_callback->>'requestId' = saved.request_id
          AND p_callback->>'schemaVersion' = saved.payload_text::jsonb->>'schemaVersion'
          AND p_callback->>'status' IN ('succeeded', 'failed', 'canceled')
          AND jsonb_typeof(p_callback->'callbackId') = 'string' AND p_callback->>'callbackId' <> ''
          AND p_callback->>'jobReference' = p_reference
          AND (job.job_reference IS NULL OR p_callback->>'jobReference' = job.job_reference)
          AND (job.status IN ('requested', 'accepted', 'running')
            OR (job.status = p_callback->>'status' AND EXISTS (
              SELECT 1 FROM public.aerial_processing_callbacks callback
              WHERE callback.processing_job_id = job.id AND callback.workspace_id = job.workspace_id
                AND callback.callback_id = job.last_callback_id
                AND callback.occurred_at = job.last_callback_at
                AND callback.callback_id = p_callback->>'callbackId'
                AND callback.status = job.status AND callback.payload = p_callback))))
      )
  ) INTO allowed;
  RETURN jsonb_build_object('format', 'openplan.odm-delivery-authority.v1',
    'installationId', saved.installation_id, 'targetId', saved.target_id,
    'operation', p_operation, 'applicationJob', saved.application_job,
    'payloadSha256', saved.payload_sha256, 'authorizedNow', allowed,
    'authorityObservedAt', clock_timestamp(), 'engineTransportPermission', false);
END;
$$;
REVOKE ALL ON FUNCTION public.read_aerial_delivery_authority(text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_aerial_delivery_authority(text, text, text, text, text, jsonb) TO service_role;
