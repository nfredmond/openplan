-- Bind proposals to the retained original bytes, before approval is possible.
ALTER TABLE public.contract_baselines ADD COLUMN source_receipts jsonb NOT NULL DEFAULT '[]';
CREATE FUNCTION public.retain_contract_agreements() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source jsonb; d public.kb_documents; receipts jsonb:='[]';
BEGIN
 FOR source IN SELECT value FROM jsonb_array_elements(NEW.content->'sourceDocuments') LOOP
  SELECT * INTO d FROM public.kb_documents WHERE id=(source#>>'{}')::uuid FOR SHARE;
  IF d.id IS NULL OR d.workspace_id<>NEW.workspace_id OR d.checksum !~ '^[a-f0-9]{64}$' OR d.checksum IS NULL OR d.storage_ref IS NULL OR d.status NOT IN ('ready','stored') THEN RAISE EXCEPTION 'Agreement requires a retained original file in this workspace' USING ERRCODE='22023'; END IF;
  receipts:=receipts||jsonb_build_array(jsonb_build_object('id',d.id,'title',d.title,'checksum',d.checksum,'storageRef',d.storage_ref,'bytes',d.byte_size));
 END LOOP;
 IF jsonb_array_length(receipts)=0 THEN RAISE EXCEPTION 'Retained agreement required' USING ERRCODE='22023'; END IF;
 NEW.source_receipts:=receipts;
 NEW.content_hash:=encode(extensions.digest(jsonb_build_object('content',NEW.content,'sources',receipts)::text,'sha256'),'hex');
 RETURN NEW;
END $$;
CREATE TRIGGER retain_contract_agreements BEFORE INSERT ON public.contract_baselines FOR EACH ROW EXECUTE FUNCTION public.retain_contract_agreements();
CREATE FUNCTION public.guard_contract_agreement_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.contract_baselines b CROSS JOIN LATERAL jsonb_array_elements(b.source_receipts) r WHERE r->>'id'=OLD.id::text) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'This original file supports a retained contract baseline and cannot be deleted' USING ERRCODE='23503'; END IF;
  IF (NEW.workspace_id,NEW.storage_ref,NEW.checksum,NEW.byte_size,NEW.content_type,NEW.source_kind) IS DISTINCT FROM (OLD.workspace_id,OLD.storage_ref,OLD.checksum,OLD.byte_size,OLD.content_type,OLD.source_kind) THEN RAISE EXCEPTION 'Retained agreement file identity cannot change' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER retain_contract_agreement_document BEFORE UPDATE OR DELETE ON public.kb_documents FOR EACH ROW EXECUTE FUNCTION public.guard_contract_agreement_document();
CREATE FUNCTION public.guard_contract_agreement_storage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.contract_baselines b CROSS JOIN LATERAL jsonb_array_elements(b.source_receipts) r WHERE
  (TG_OP<>'INSERT' AND r->>'storageRef'='storage://'||OLD.bucket_id||'/'||OLD.name) OR
  (TG_OP<>'DELETE' AND r->>'storageRef'='storage://'||NEW.bucket_id||'/'||NEW.name)) THEN RAISE EXCEPTION 'Retained contract agreement bytes cannot be replaced or deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER retain_contract_agreement_storage BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.guard_contract_agreement_storage();
-- Historical JSON allocations remain references after the current task is amended.
CREATE FUNCTION public.guard_contract_historical_parent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE retained boolean;
BEGIN
 IF TG_TABLE_NAME='project_deliverables' THEN
  SELECT EXISTS(SELECT 1 FROM public.contract_baselines b CROSS JOIN LATERAL jsonb_array_elements(b.content->'tasks') t WHERE t->>'deliverableId'=OLD.id::text) INTO retained;
  IF retained AND (TG_OP='DELETE' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN RAISE EXCEPTION 'Retained contract deliverable cannot be deleted or moved' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT EXISTS(SELECT 1 FROM public.contract_baselines b CROSS JOIN LATERAL jsonb_array_elements(b.content->'tasks') t CROSS JOIN LATERAL jsonb_array_elements(t->'staff') s WHERE s->>'staffId'=OLD.id::text) OR EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.command->>'staffId'=OLD.id::text) OR EXISTS(SELECT 1 FROM public.contract_rates r WHERE r.staff_id=OLD.id) INTO retained;
  IF retained AND (TG_OP='DELETE' OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN RAISE EXCEPTION 'Retained contract staff identity cannot be deleted or reassigned; mark departed staff inactive' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER retain_contract_historical_deliverable BEFORE UPDATE OR DELETE ON public.project_deliverables FOR EACH ROW EXECUTE FUNCTION public.guard_contract_historical_parent();
CREATE TRIGGER retain_contract_historical_staff BEFORE UPDATE OR DELETE ON public.invoicing_staff FOR EACH ROW EXECUTE FUNCTION public.guard_contract_historical_parent();
