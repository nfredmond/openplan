-- New snapshots retain received-file metadata without changing earlier issued packages.
CREATE OR REPLACE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.read_contract_management_closeout(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role' IN ('owner','admin','pm','finance') THEN
  result:=result||jsonb_build_object('schemaVersion',7,'cutoffConflicts',coalesce((result->>'cutoffConflicts')::boolean,false) OR EXISTS(SELECT 1 FROM public.contract_source_changes c WHERE c.workspace_id=(result->'engagement'->>'workspace_id')::uuid AND c.changed_at>p_cutoff));
  result:=jsonb_set(result,'{responses,records}',coalesce((SELECT jsonb_agg(r) FROM jsonb_array_elements(result->'responses'->'records') r WHERE (r->>'updated_at')::timestamptz<=p_cutoff),'[]'::jsonb));
 END IF;
 IF result->>'role'='pm' THEN result:=result||jsonb_build_object('snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'created_at',s.created_at,'snapshot_hash',s.snapshot_hash) ORDER BY s.created_at DESC) FROM public.contract_snapshots s WHERE s.engagement_id=p_engagement_id AND s.created_at<=p_cutoff AND s.audience='management'),'[]')); END IF;
 IF result->>'role' IN ('owner','admin','pm','finance','consultant') THEN
  result:=jsonb_set(result,'{receivedInvoices}',coalesce((SELECT jsonb_agg(i||jsonb_build_object('source_receipt',CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'filename',f.filename,'contentType',f.content_type,'checksum',f.checksum,'bytes',octet_length(f.bytes)) ELSE NULL END) ORDER BY ordinality)
   FROM jsonb_array_elements(result->'receivedInvoices') WITH ORDINALITY selected(i,ordinality)
   LEFT JOIN public.contract_received_files f ON f.id=(i->'content'->>'fileId')::uuid AND f.engagement_id=p_engagement_id AND f.workspace_id=(result->'engagement'->>'workspace_id')::uuid AND f.created_at<=p_cutoff),'[]'));
 END IF;
 RETURN result;
END $$;

-- A reopened assignment must retain or explicitly settle its prior open obligations.
CREATE FUNCTION public.validate_contract_closeout_obligations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior jsonb; obligation jsonb; disposition jsonb;
BEGIN
 IF NEW.state<>'closed' THEN RETURN NEW; END IF;
 IF (SELECT count(DISTINCT o->>'id') FROM jsonb_array_elements(NEW.content->'request'->'obligations') o)<>jsonb_array_length(NEW.content->'request'->'obligations') THEN
  RAISE EXCEPTION 'Continuing obligation identities must be unique' USING ERRCODE='23514';
 END IF;
 SELECT content->'request'->'obligations' INTO prior FROM public.contract_closeouts WHERE engagement_id=NEW.engagement_id AND state='closed' ORDER BY version DESC LIMIT 1;
 FOR obligation IN SELECT o FROM jsonb_array_elements(coalesce(prior,'[]')) o WHERE o->>'status'='open' LOOP
  SELECT o INTO disposition FROM jsonb_array_elements(NEW.content->'request'->'obligations') o WHERE o->>'id'=obligation->>'id';
  IF disposition IS NULL THEN RAISE EXCEPTION 'Carry forward each prior open obligation or document its satisfied disposition' USING ERRCODE='23514'; END IF;
  IF disposition->>'status'='satisfied' AND disposition->>'basis' IS NOT DISTINCT FROM obligation->>'basis' THEN RAISE EXCEPTION 'New satisfaction evidence is required for a prior open obligation' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_contract_closeout_obligations() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER contract_closeout_obligations BEFORE INSERT ON public.contract_closeouts FOR EACH ROW EXECUTE FUNCTION public.validate_contract_closeout_obligations();
