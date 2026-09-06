-- Preparation extends Programs and references the existing document library.
-- Originals and proposal revisions are append-only. No spending/adoption state.
CREATE TABLE public.program_work_program_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  document_id uuid NOT NULL REFERENCES public.kb_documents(id),
  document_checksum text NOT NULL CHECK (document_checksum ~ '^[a-f0-9]{64}$'),
  source_role text NOT NULL CHECK (source_role IN ('predecessor','amendment','comparison','authority','supplement')),
  source_url text,
  page_count integer NOT NULL CHECK (page_count > 0),
  extraction_json jsonb NOT NULL CHECK (jsonb_typeof(extraction_json) = 'object'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, document_id, document_checksum, source_role)
);

CREATE TABLE public.program_work_program_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  revision integer NOT NULL CHECK (revision > 0),
  previous_revision_id uuid REFERENCES public.program_work_program_revisions(id),
  request_id uuid NOT NULL,
  content_json jsonb NOT NULL CHECK (
    jsonb_typeof(content_json) = 'object' AND content_json->>'schemaVersion' = '1'
    AND jsonb_typeof(content_json->'elements') = 'array'
  ),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, revision),
  UNIQUE (program_id, request_id)
);

CREATE INDEX program_work_program_sources_program ON public.program_work_program_sources(program_id, created_at);
CREATE INDEX program_work_program_revisions_latest ON public.program_work_program_revisions(program_id, revision DESC);
ALTER TABLE public.program_work_program_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_work_program_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY program_work_program_sources_read ON public.program_work_program_sources FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.programs p JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
    WHERE p.id = program_id AND p.workspace_id = program_work_program_sources.workspace_id AND wm.user_id = auth.uid())
);
CREATE POLICY program_work_program_revisions_read ON public.program_work_program_revisions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.programs p JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
    WHERE p.id = program_id AND p.workspace_id = program_work_program_revisions.workspace_id AND wm.user_id = auth.uid())
);
REVOKE ALL ON public.program_work_program_sources, public.program_work_program_revisions FROM anon, authenticated, service_role;
GRANT SELECT ON public.program_work_program_sources, public.program_work_program_revisions TO authenticated, service_role;

-- The route passes its authenticated actor. Only the service role may execute.
-- Membership is rechecked while holding the program lock, including on retries.
CREATE FUNCTION public.save_program_work_program_revision(
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
  INSERT INTO public.program_work_program_revisions(program_id, workspace_id, revision, previous_revision_id, request_id, content_json, content_sha256, created_by)
  VALUES (p_program_id, v_workspace, p_expected_revision + 1, v_latest.id, p_request_id, p_content,
    encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex'), p_actor_id)
  RETURNING * INTO v_saved;
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION public.save_program_work_program_revision(uuid,uuid,integer,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_program_work_program_revision(uuid,uuid,integer,uuid,jsonb) TO service_role;

CREATE FUNCTION public.attach_program_work_program_source(
  p_program_id uuid, p_actor_id uuid, p_document_id uuid, p_checksum text,
  p_role text, p_source_url text, p_page_count integer, p_extraction jsonb
) RETURNS public.program_work_program_sources
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_workspace uuid; v_saved public.program_work_program_sources;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.programs WHERE id = p_program_id FOR UPDATE;
  IF v_workspace IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = v_workspace AND user_id = p_actor_id AND role IN ('owner','admin','member')
  ) THEN RAISE EXCEPTION 'Work program access denied' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kb_documents WHERE id = p_document_id AND workspace_id = v_workspace AND checksum = p_checksum AND page_count = p_page_count AND source_kind = 'uploaded_pdf')
  THEN RAISE EXCEPTION 'Source document changed or is not permitted' USING ERRCODE = '42501'; END IF;
  IF octet_length(p_extraction::text) > 4000000 THEN RAISE EXCEPTION 'Source extraction is too large' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.program_work_program_sources(program_id, workspace_id, document_id, document_checksum, source_role, source_url, page_count, extraction_json, created_by)
    VALUES (p_program_id, v_workspace, p_document_id, p_checksum, p_role, p_source_url, p_page_count, p_extraction, p_actor_id)
    ON CONFLICT (program_id, document_id, document_checksum, source_role) DO NOTHING RETURNING * INTO v_saved;
  IF v_saved.id IS NULL THEN
    SELECT * INTO v_saved FROM public.program_work_program_sources WHERE program_id = p_program_id AND document_id = p_document_id AND document_checksum = p_checksum AND source_role = p_role;
    IF v_saved.source_url IS DISTINCT FROM p_source_url THEN RAISE EXCEPTION 'Source URL changed on retry' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_program_work_program_source(uuid,uuid,uuid,text,text,text,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_program_work_program_source(uuid,uuid,uuid,text,text,text,integer,jsonb) TO service_role;
