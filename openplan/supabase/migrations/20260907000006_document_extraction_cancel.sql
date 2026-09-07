-- Record cancellation with an actor/role check in the same transaction as the job change.
CREATE OR REPLACE FUNCTION public.cancel_kb_extraction(p_document_id uuid, p_job_id uuid, p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE scope uuid; changed uuid;
BEGIN
  SELECT workspace_id INTO scope FROM public.kb_documents WHERE id=p_document_id;
  PERFORM 1 FROM public.workspace_members WHERE workspace_id=scope AND user_id=p_actor_id
    AND role IN ('owner','admin','member') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document write access required' USING ERRCODE='42501'; END IF;
  UPDATE public.kb_ocr_jobs SET cancel_requested=true, message='Cancellation requested; the retained original remains available.'
    WHERE id=p_job_id AND document_id=p_document_id AND workspace_id=scope
      AND job_kind='extraction' AND status IN ('queued','running') RETURNING id INTO changed;
  RETURN changed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_kb_extraction(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_kb_extraction(uuid,uuid,uuid) TO service_role;
