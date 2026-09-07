-- Source attachment remains immutable; reviewed parsing gets independent versions.
CREATE OR REPLACE FUNCTION public.attach_program_work_program_source(
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
  IF NOT EXISTS (SELECT 1 FROM public.kb_documents WHERE id = p_document_id AND workspace_id = v_workspace AND checksum = p_checksum AND (page_count = p_page_count OR (page_count IS NULL AND p_extraction->>'parser' = 'manual-page-review')) AND source_kind = 'uploaded_pdf')
  THEN RAISE EXCEPTION 'Source document changed or is not permitted' USING ERRCODE = '42501'; END IF;
  IF octet_length(p_extraction::text) > 4000000 THEN RAISE EXCEPTION 'Source extraction is too large' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.program_work_program_sources(program_id, workspace_id, document_id, document_checksum, source_role, source_url, page_count, extraction_json, created_by)
    VALUES (p_program_id, v_workspace, p_document_id, p_checksum, p_role, p_source_url, p_page_count, p_extraction, p_actor_id)
    ON CONFLICT (program_id, document_id, document_checksum, source_role) DO NOTHING RETURNING * INTO v_saved;
  IF v_saved.id IS NULL THEN
    SELECT * INTO v_saved FROM public.program_work_program_sources WHERE program_id = p_program_id AND document_id = p_document_id AND document_checksum = p_checksum AND source_role = p_role;
    IF v_saved.source_url IS DISTINCT FROM p_source_url THEN RAISE EXCEPTION 'Source URL changed on retry' USING ERRCODE = 'PT409'; END IF;
  END IF;
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_program_work_program_source(uuid,uuid,uuid,text,text,text,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_program_work_program_source(uuid,uuid,uuid,text,text,text,integer,jsonb) TO service_role;

CREATE TABLE public.program_work_program_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.program_work_program_sources(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  document_extraction_id uuid REFERENCES public.kb_document_extractions(id),
  request_id uuid NOT NULL,
  extraction_json jsonb NOT NULL,
  content_sha256 text NOT NULL,
  page_count integer NOT NULL CHECK (page_count > 0),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, request_id)
);
ALTER TABLE public.program_work_program_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY program_work_program_extractions_read ON public.program_work_program_extractions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.program_work_program_sources s JOIN public.workspace_members m ON m.workspace_id=s.workspace_id
    WHERE s.id=source_id AND s.workspace_id=program_work_program_extractions.workspace_id AND m.user_id=auth.uid())
);
REVOKE ALL ON public.program_work_program_extractions FROM anon, authenticated, service_role;
GRANT SELECT ON public.program_work_program_extractions TO authenticated, service_role;
CREATE FUNCTION public.version_work_program_extraction(p_source_id uuid,p_actor_id uuid,p_document_extraction_id uuid,p_request_id uuid,p_extraction jsonb)
RETURNS public.program_work_program_extractions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.program_work_program_sources; e public.program_work_program_extractions; d public.kb_document_extractions; v_pages integer;
BEGIN
  SELECT * INTO s FROM public.program_work_program_sources WHERE id=p_source_id FOR UPDATE;
  IF s.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=s.workspace_id AND user_id=p_actor_id AND role IN ('owner','admin','member'))
    THEN RAISE EXCEPTION 'Source access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.kb_document_extractions WHERE id=p_document_extraction_id;
  IF d.id IS NULL OR d.document_id<>s.document_id OR d.workspace_id<>s.workspace_id OR d.document_checksum<>s.document_checksum
    THEN RAISE EXCEPTION 'Extraction does not belong to this original' USING ERRCODE='42501'; END IF;
  v_pages := (p_extraction->>'pageCount')::integer;
  IF v_pages IS DISTINCT FROM d.page_count OR octet_length(p_extraction::text)>4000000 OR jsonb_typeof(p_extraction->'elements') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'Invalid extraction version' USING ERRCODE='22023'; END IF;
  SELECT * INTO e FROM public.program_work_program_extractions WHERE source_id=s.id AND request_id=p_request_id;
  IF FOUND THEN
    IF e.extraction_json<>p_extraction OR e.document_extraction_id<>d.id THEN RAISE EXCEPTION 'Version retry changed' USING ERRCODE='PT409'; END IF;
    RETURN e;
  END IF;
  INSERT INTO public.program_work_program_extractions(source_id,workspace_id,document_extraction_id,request_id,extraction_json,content_sha256,page_count,created_by)
    VALUES(s.id,s.workspace_id,d.id,p_request_id,p_extraction,encode(extensions.digest(convert_to(p_extraction::text,'UTF8'),'sha256'),'hex'),v_pages,p_actor_id) RETURNING * INTO e;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.version_work_program_extraction(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.version_work_program_extraction(uuid,uuid,uuid,uuid,jsonb) TO service_role;
