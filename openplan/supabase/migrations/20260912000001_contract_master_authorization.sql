-- New authorization is explicit. Existing baselines and amounts are not backfilled.
CREATE TABLE public.contract_master_terms (
 id uuid PRIMARY KEY, engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('proposed','approved')), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 ceiling numeric(16,2) NOT NULL CHECK(ceiling>=0), starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on),
 terms text NOT NULL CHECK(length(trim(terms))>0), source_document_id uuid NOT NULL REFERENCES public.kb_documents(id),
 source_receipt jsonb NOT NULL, approval_evidence text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
 UNIQUE(engagement_id,version), CHECK((state='approved')=(approved_at IS NOT NULL)),
 CHECK(state<>'approved' OR length(trim(approval_evidence))>0)
);
ALTER TABLE public.contract_master_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_master_terms FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_master_terms TO authenticated,service_role;
CREATE POLICY management_read ON public.contract_master_terms FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=contract_master_terms.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));

CREATE FUNCTION public.guard_contract_master_terms() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retained master terms cannot be deleted' USING ERRCODE='23514'; END IF;
 IF OLD.state<>'proposed' OR NEW.state<>'approved' OR
  (to_jsonb(NEW)-'state'-'approved_at'-'approval_evidence') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'approved_at'-'approval_evidence') THEN
  RAISE EXCEPTION 'Retained master terms cannot be rewritten' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_master_terms BEFORE UPDATE OR DELETE ON public.contract_master_terms FOR EACH ROW EXECUTE FUNCTION public.guard_contract_master_terms();

-- The same workspace lock precedes every command's row locks. Concurrent task orders
-- cannot each reserve the same remaining authorization or deadlock in opposite order.
CREATE FUNCTION public.validate_contract_master_authorization(p_master_id uuid,p_terms public.contract_master_terms,p_baseline public.contract_baselines DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE child record; total numeric:=0; period jsonb;
BEGIN
 IF p_terms.id IS NULL THEN RAISE EXCEPTION 'Approve documented master ceiling and terms before authorizing a task order' USING ERRCODE='22023'; END IF;
 FOR child IN
  SELECT DISTINCT ON (b.engagement_id) b.* FROM public.contract_baselines b
  JOIN public.invoicing_engagements e ON e.id=b.engagement_id
  WHERE e.parent_engagement_id=p_master_id AND b.state='approved'
    AND (p_baseline.id IS NULL OR b.engagement_id<>p_baseline.engagement_id)
  ORDER BY b.engagement_id,b.version DESC
 LOOP
  period:=child.content->'authorization';
  IF child.content->>'fee' IS NULL OR child.content->>'currency' IS DISTINCT FROM p_terms.currency OR
   period->>'startsOn' IS NULL OR period->>'endsOn' IS NULL OR
   (period->>'startsOn')::date<p_terms.starts_on OR (period->>'endsOn')::date>p_terms.ends_on THEN
   RAISE EXCEPTION 'Approved task order has unknown or incompatible fee, currency or authorized period' USING ERRCODE='22023';
  END IF;
  total:=total+(child.content->>'fee')::numeric;
 END LOOP;
 IF p_baseline.id IS NOT NULL THEN
  period:=p_baseline.content->'authorization';
  IF p_baseline.content->>'fee' IS NULL OR p_baseline.content->>'currency' IS DISTINCT FROM p_terms.currency OR
   period->>'startsOn' IS NULL OR period->>'endsOn' IS NULL OR
   (period->>'startsOn')::date<p_terms.starts_on OR (period->>'endsOn')::date>p_terms.ends_on OR
   (period->>'endsOn')::date<(period->>'startsOn')::date OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(p_baseline.content->'tasks') t WHERE (t->>'deadline')::date>(period->>'endsOn')::date) THEN
   RAISE EXCEPTION 'Task order requires a known fee, matching currency and dates within approved master terms' USING ERRCODE='22023';
  END IF;
  total:=total+(p_baseline.content->>'fee')::numeric;
 END IF;
 IF total>p_terms.ceiling THEN RAISE EXCEPTION 'Task orders exceed the shared approved master ceiling' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.validate_contract_master_authorization(uuid,public.contract_master_terms,public.contract_baselines) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.check_contract_master_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE parent uuid; terms public.contract_master_terms;
BEGIN
 IF NEW.state<>'approved' OR OLD.state='approved' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text,451));
 SELECT parent_engagement_id INTO parent FROM public.invoicing_engagements WHERE id=NEW.engagement_id;
 IF parent IS NOT NULL THEN
  SELECT * INTO terms FROM public.contract_master_terms WHERE engagement_id=parent AND state='approved' ORDER BY version DESC LIMIT 1;
  PERFORM public.validate_contract_master_authorization(parent,terms,NEW);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_master_before_task_order_approval BEFORE UPDATE ON public.contract_baselines FOR EACH ROW EXECUTE FUNCTION public.check_contract_master_approval();

ALTER FUNCTION public.record_contract_command(uuid,uuid,jsonb) RENAME TO record_contract_command_v046;
REVOKE ALL ON FUNCTION public.record_contract_command_v046(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_contract_command(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; k text:=p_command->>'kind'; req uuid:=(p_command->>'requestId')::uuid;
 cached public.contract_commands; terms public.contract_master_terms; d public.kb_documents; v integer; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Contract access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 IF k NOT IN ('master_terms','approve_master_terms','task_order') THEN RETURN public.record_contract_command_v046(p_engagement_id,p_actor_id,p_command); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=e.workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Finance authority required for master terms' USING ERRCODE='42501'; END IF;
 IF req IS NULL OR e.parent_engagement_id IS NOT NULL OR e.engagement_kind NOT IN ('contract','on_call') OR octet_length(p_command::text)>2000000 THEN RAISE EXCEPTION 'Select a master agreement and a valid request' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id FOR UPDATE;
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Request identity reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 IF k='task_order' THEN
  IF coalesce(length(trim(p_command->>'title')),0)=0 OR NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(p_command->>'projectId')::uuid AND workspace_id=e.workspace_id) THEN RAISE EXCEPTION 'Task order requires a title and a project in this workspace' USING ERRCODE='42501'; END IF;
  INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,parent_engagement_id,title,engagement_kind,created_by)
  VALUES((p_command->>'engagementId')::uuid,e.workspace_id,e.client_id,(p_command->>'projectId')::uuid,e.id,p_command->>'title','task_order',p_actor_id);
  result:=jsonb_build_object('engagementId',p_command->>'engagementId');
  INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,p_command,result);
  RETURN result;
 END IF;
 SELECT coalesce(max(version),0) INTO v FROM public.contract_master_terms WHERE engagement_id=e.id;
 IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Master terms changed; reload before saving' USING ERRCODE='PT409'; END IF;
 IF k='master_terms' THEN
  IF p_command->>'ceiling' IS NULL OR p_command->>'ceiling' !~ '^\d{1,12}(\.\d{1,2})?$' THEN RAISE EXCEPTION 'Exact nonnegative master ceiling required' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM public.kb_documents WHERE id=(p_command->>'sourceDocumentId')::uuid AND workspace_id=e.workspace_id FOR SHARE;
  IF d.id IS NULL OR d.checksum IS NULL OR d.storage_ref IS NULL OR d.status NOT IN ('stored','ready') THEN RAISE EXCEPTION 'Retain the master agreement document' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_master_terms(id,engagement_id,workspace_id,version,state,currency,ceiling,starts_on,ends_on,terms,source_document_id,source_receipt,created_by)
  VALUES((p_command->>'termsId')::uuid,e.id,e.workspace_id,v+1,'proposed',p_command->>'currency',(p_command->>'ceiling')::numeric,(p_command->>'startsOn')::date,(p_command->>'endsOn')::date,p_command->>'terms',d.id,
   jsonb_build_object('id',d.id,'checksum',d.checksum,'storageRef',d.storage_ref,'bytes',d.byte_size),p_actor_id) RETURNING * INTO terms;
 ELSE
  SELECT * INTO terms FROM public.contract_master_terms WHERE id=(p_command->>'termsId')::uuid AND engagement_id=e.id AND version=v AND state='proposed' FOR UPDATE;
  IF terms.id IS NULL THEN RAISE EXCEPTION 'Approve the current unchanged master proposal' USING ERRCODE='PT409'; END IF;
  PERFORM public.validate_contract_master_authorization(e.id,terms);
  UPDATE public.contract_master_terms SET state='approved',approval_evidence=p_command->>'approvalEvidence',approved_at=now() WHERE id=terms.id;
 END IF;
 result:=jsonb_build_object('termsId',terms.id,'version',terms.version);
 INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_contract_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_contract_command(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_contract_agreement_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM (SELECT b.source_receipts FROM public.contract_baselines b UNION ALL SELECT jsonb_build_array(m.source_receipt) FROM public.contract_master_terms m) retained CROSS JOIN LATERAL jsonb_array_elements(retained.source_receipts) r WHERE r->>'id'=OLD.id::text) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'This original file supports a retained contract baseline and cannot be deleted' USING ERRCODE='23503'; END IF;
  IF (NEW.workspace_id,NEW.storage_ref,NEW.checksum,NEW.byte_size,NEW.content_type,NEW.source_kind) IS DISTINCT FROM (OLD.workspace_id,OLD.storage_ref,OLD.checksum,OLD.byte_size,OLD.content_type,OLD.source_kind) THEN RAISE EXCEPTION 'Retained agreement file identity cannot change' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_contract_agreement_storage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM (SELECT b.source_receipts FROM public.contract_baselines b UNION ALL SELECT jsonb_build_array(m.source_receipt) FROM public.contract_master_terms m) retained CROSS JOIN LATERAL jsonb_array_elements(retained.source_receipts) r WHERE
  (TG_OP<>'INSERT' AND r->>'storageRef'='storage://'||OLD.bucket_id||'/'||OLD.name) OR
  (TG_OP<>'DELETE' AND r->>'storageRef'='storage://'||NEW.bucket_id||'/'||NEW.name)) THEN RAISE EXCEPTION 'Retained contract agreement bytes cannot be replaced or deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

ALTER FUNCTION public.read_contract_management(uuid,uuid,timestamptz) RENAME TO read_contract_management_v046;
REVOKE ALL ON FUNCTION public.read_contract_management_v046(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.read_contract_management_v046(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role' IN ('owner','admin') THEN
  result:=result||jsonb_build_object('taskOrders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'project_id',e.project_id) ORDER BY e.title) FROM public.invoicing_engagements e WHERE e.parent_engagement_id=p_engagement_id),'[]'),'masterTerms',coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('ceiling',t.ceiling::text)||CASE WHEN t.approved_at>p_cutoff THEN jsonb_build_object('state','proposed','approved_at',NULL,'approval_evidence','') ELSE '{}'::jsonb END ORDER BY t.version) FROM public.contract_master_terms t WHERE t.engagement_id=p_engagement_id AND t.created_at<=p_cutoff),'[]'),
   'parentMasterTerms',(SELECT to_jsonb(t)||jsonb_build_object('ceiling',t.ceiling::text) FROM public.contract_master_terms t WHERE t.engagement_id=(result->'engagement'->>'parent_engagement_id')::uuid AND t.state='approved' AND t.approved_at<=p_cutoff ORDER BY t.version DESC LIMIT 1));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) TO service_role;
