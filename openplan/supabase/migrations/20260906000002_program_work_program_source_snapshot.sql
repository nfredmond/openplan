-- Capture the source register under the same program lock as the revision.
-- Transaction start timestamps cannot safely reconstruct this list after a
-- concurrent source attachment. Earlier development revisions remain readable;
-- their source inventory is explicitly unknown rather than backfilled by guess.
ALTER TABLE public.program_work_program_revisions ADD COLUMN source_ids uuid[];

CREATE OR REPLACE FUNCTION public.save_program_work_program_revision(
  p_program_id uuid, p_actor_id uuid, p_expected_revision integer,
  p_request_id uuid, p_content jsonb
) RETURNS public.program_work_program_revisions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_workspace uuid;
  v_latest public.program_work_program_revisions;
  v_existing public.program_work_program_revisions;
  v_saved public.program_work_program_revisions;
  v_element jsonb;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.programs WHERE id = p_program_id FOR UPDATE;
  IF v_workspace IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = v_workspace AND user_id = p_actor_id
      AND role IN ('owner','admin','member')
  ) THEN RAISE EXCEPTION 'Work program access denied' USING ERRCODE = '42501'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 OR p_request_id IS NULL OR p_content IS NULL OR octet_length(p_content::text) > 2000000
    OR p_content->>'schemaVersion' IS DISTINCT FROM '1' OR jsonb_typeof(p_content->'elements') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid work program content' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_existing FROM public.program_work_program_revisions WHERE program_id = p_program_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.content_json <> p_content THEN RAISE EXCEPTION 'Retry payload changed' USING ERRCODE = '40001'; END IF;
    RETURN v_existing;
  END IF;
  SELECT * INTO v_latest FROM public.program_work_program_revisions WHERE program_id = p_program_id ORDER BY revision DESC LIMIT 1;
  IF coalesce(v_latest.revision, 0) <> p_expected_revision THEN RAISE EXCEPTION 'Work program changed; reload before saving' USING ERRCODE = '40001'; END IF;
  FOR v_element IN SELECT value FROM jsonb_array_elements(p_content->'elements') LOOP
    IF v_element->'source' IS NOT NULL AND v_element->'source' <> 'null'::jsonb AND NOT EXISTS (
      SELECT 1 FROM public.program_work_program_sources s
      WHERE s.id = (v_element->'source'->>'sourceId')::uuid AND s.program_id = p_program_id AND s.workspace_id = v_workspace
    ) THEN RAISE EXCEPTION 'Source does not belong to this program' USING ERRCODE = '42501'; END IF;
    IF v_element->>'projectId' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.projects WHERE id = (v_element->>'projectId')::uuid AND workspace_id = v_workspace
    ) THEN RAISE EXCEPTION 'Project does not belong to this workspace' USING ERRCODE = '42501'; END IF;
  END LOOP;
  INSERT INTO public.program_work_program_revisions(program_id, workspace_id, revision, previous_revision_id, request_id, content_json, content_sha256, created_by, source_ids)
  VALUES (p_program_id, v_workspace, p_expected_revision + 1, v_latest.id, p_request_id, p_content,
    encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex'), p_actor_id,
    ARRAY(SELECT s.id FROM public.program_work_program_sources s WHERE s.program_id = p_program_id ORDER BY s.id))
  RETURNING * INTO v_saved;
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION public.save_program_work_program_revision(uuid,uuid,integer,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_program_work_program_revision(uuid,uuid,integer,uuid,jsonb) TO service_role;
