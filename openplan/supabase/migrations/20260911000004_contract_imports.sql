CREATE TABLE public.contract_imports (
 id uuid PRIMARY KEY, engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id),workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 filename text NOT NULL,csv_text text NOT NULL,source_hash text NOT NULL,mapping jsonb NOT NULL,commands jsonb NOT NULL,created_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contract_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_imports FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_imports TO authenticated,service_role;
CREATE POLICY private_management_import ON public.contract_imports FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=contract_imports.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE TRIGGER immutable_contract_import BEFORE UPDATE OR DELETE ON public.contract_imports FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE FUNCTION public.record_contract_import(p_engagement_id uuid,p_actor_id uuid,p_import jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; old public.contract_imports; item jsonb; result jsonb:='[]'; source_hash text; import_id uuid:=(p_import->>'requestId')::uuid;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id FOR UPDATE;
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=e.workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Private cost import requires management access' USING ERRCODE='42501'; END IF;
 source_hash:=encode(extensions.digest(p_import->>'csv','sha256'),'hex');
 SELECT * INTO old FROM public.contract_imports WHERE id=import_id;
 IF old.id IS NOT NULL THEN
  IF old.engagement_id<>e.id OR old.created_by<>p_actor_id OR old.csv_text IS DISTINCT FROM p_import->>'csv' OR old.filename IS DISTINCT FROM p_import->>'filename' OR old.mapping IS DISTINCT FROM p_import->'mapping' OR old.commands IS DISTINCT FROM p_import->'commands' THEN RAISE EXCEPTION 'Import retry changed its retained payload' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('importId',old.id,'count',jsonb_array_length(old.commands));
 END IF;
 IF import_id IS NULL OR octet_length(p_import->>'csv')>2000000 OR jsonb_typeof(p_import->'commands') IS DISTINCT FROM 'array' OR jsonb_array_length(p_import->'commands') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Import 1 to 200 reviewed CSV rows' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_import->'commands') LOOP
  IF item->>'kind'<>'actual' OR item->>'status'<>'draft' OR position('sha256:'||source_hash IN item->>'sourceReference')=0 THEN RAISE EXCEPTION 'Import requires draft actuals tied to the retained file hash' USING ERRCODE='22023'; END IF;
  result:=result||jsonb_build_array(public.record_contract_command(e.id,p_actor_id,item));
 END LOOP;
 INSERT INTO public.contract_imports(id,engagement_id,workspace_id,filename,csv_text,source_hash,mapping,commands,created_by) VALUES(import_id,e.id,e.workspace_id,p_import->>'filename',p_import->>'csv',source_hash,p_import->'mapping',p_import->'commands',p_actor_id);
 RETURN jsonb_build_object('importId',import_id,'count',jsonb_array_length(result));
END $$;
REVOKE ALL ON FUNCTION public.record_contract_import(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_contract_import(uuid,uuid,jsonb) TO service_role;
