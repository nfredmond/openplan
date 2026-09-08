-- Reconcile missing legacy period metadata without rewriting a v0.46 approved baseline.
CREATE TABLE public.contract_order_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), baseline_id uuid NOT NULL REFERENCES public.contract_baselines(id),
 engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 version integer NOT NULL CHECK(version>0), period_metadata jsonb NOT NULL, evidence text NOT NULL CHECK(length(trim(evidence))>0),
 source_document_id uuid NOT NULL REFERENCES public.kb_documents(id), created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(baseline_id,version)
);
ALTER TABLE public.contract_order_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_order_periods FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_order_periods TO authenticated,service_role;
CREATE POLICY management_read ON public.contract_order_periods FOR SELECT TO authenticated USING(public.contract_can_manage(engagement_id));
CREATE TRIGGER immutable_order_period BEFORE UPDATE OR DELETE ON public.contract_order_periods FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE FUNCTION public.record_contract_order_period(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; b public.contract_baselines; actor_role text; cached public.contract_commands; period jsonb:=p_command->'authorization';
 terms public.contract_master_terms; req uuid:=(p_command->>'requestId')::uuid; v integer; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin','finance') THEN RAISE EXCEPTION 'Finance authority required to reconcile legacy authorization' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Legacy period retry changed' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 SELECT * INTO b FROM public.contract_baselines WHERE id=(p_command->>'baselineId')::uuid AND engagement_id=e.id AND state='approved';
 IF b.id IS NULL OR b.content->'authorization' IS NOT NULL OR e.parent_engagement_id IS NULL THEN RAISE EXCEPTION 'Select a retained approved task-order baseline with missing authorization metadata' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(version),0) INTO v FROM public.contract_order_periods WHERE baseline_id=b.id;
 IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Legacy authorization review changed' USING ERRCODE='PT409'; END IF;
 IF period->>'startsOn' IS NULL OR period->>'endsOn' IS NULL OR (period->>'startsOn')::date>(period->>'endsOn')::date OR coalesce(length(trim(period->>'beneficiary')),0)=0 OR coalesce(length(trim(period->>'costBasis')),0)=0 OR NOT (b.content->'sourceDocuments' @> jsonb_build_array(p_command->>'sourceDocumentId')) THEN RAISE EXCEPTION 'Reconcile period, beneficiary and basis against a retained baseline source document' USING ERRCODE='22023'; END IF;
 INSERT INTO public.contract_order_periods(baseline_id,engagement_id,workspace_id,version,period_metadata,evidence,source_document_id,created_by)
 VALUES(b.id,e.id,e.workspace_id,v+1,period,p_command->>'evidence',(p_command->>'sourceDocumentId')::uuid,p_actor_id);
 SELECT * INTO terms FROM public.contract_master_terms WHERE engagement_id=e.parent_engagement_id AND state='approved' ORDER BY version DESC LIMIT 1;
 IF terms.id IS NOT NULL THEN PERFORM public.validate_contract_master_authorization(e.parent_engagement_id,terms); END IF;
 result:=jsonb_build_object('baselineId',b.id,'version',v+1);
 INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_contract_order_period(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.validate_contract_master_authorization(p_master_id uuid,p_terms public.contract_master_terms,p_baseline public.contract_baselines DEFAULT NULL) RETURNS void
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
  period:=coalesce(child.content->'authorization',(SELECT p.period_metadata FROM public.contract_order_periods p WHERE p.baseline_id=child.id ORDER BY p.version DESC LIMIT 1));
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
CREATE OR REPLACE FUNCTION public.record_contract_command(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; k text:=p_command->>'kind'; req uuid:=(p_command->>'requestId')::uuid;
 target_id uuid; actor_role text; grant_version integer; cached public.contract_commands; terms public.contract_master_terms; d public.kb_documents; v integer; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Contract access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 IF k='order_period' THEN RETURN public.record_contract_order_period(e.id,p_actor_id,p_command); END IF;
 IF k IN ('accounting_import','accounting_review') THEN RETURN public.record_contract_accounting(e.id,p_actor_id,p_command); END IF;
 IF k IN ('received_invoice','received_review') THEN RETURN public.record_received_invoice(e.id,p_actor_id,p_command); END IF;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF k NOT IN ('master_terms','approve_master_terms','task_order','access') THEN RETURN public.record_contract_command_v046(p_engagement_id,p_actor_id,p_command); END IF;
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin','finance') THEN RAISE EXCEPTION 'Finance authority required for master terms' USING ERRCODE='42501'; END IF;
 IF req IS NULL OR (k<>'access' AND (e.parent_engagement_id IS NOT NULL OR e.engagement_kind NOT IN ('contract','on_call'))) OR octet_length(p_command::text)>2000000 THEN RAISE EXCEPTION 'Select a master agreement and a valid request' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id FOR UPDATE;
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Request identity reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 IF k='access' THEN
  IF actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Workspace owner or administrator must designate contract roles' USING ERRCODE='42501'; END IF;
  SELECT id INTO target_id FROM auth.users WHERE lower(email)=lower(trim(p_command->>'email'));
  IF target_id IS NULL OR p_command->>'role' IS NULL OR p_command->>'role' NOT IN ('pm','finance','consultant') OR
   (p_command->>'role'='consultant' AND EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=e.workspace_id AND user_id=target_id)) OR
   (p_command->>'role' IN ('pm','finance') AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=e.workspace_id AND user_id=target_id AND role='member')) THEN
   RAISE EXCEPTION 'Internal roles require a workspace member; consultants require an existing account without agency membership' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(version),0) INTO grant_version FROM public.contract_access_versions WHERE engagement_id=e.id AND user_id=target_id;
  IF grant_version IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Contract access changed; reload before saving' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,version,role,active,evidence,created_by)
  VALUES(e.id,e.workspace_id,target_id,grant_version+1,p_command->>'role',(p_command->>'active')::boolean,p_command->>'evidence',p_actor_id);
  result:=jsonb_build_object('userId',target_id,'version',grant_version+1);
  INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,p_command,result);
  RETURN result;
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
CREATE OR REPLACE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.read_contract_management_v046(p_engagement_id,p_actor_id,p_cutoff)||jsonb_build_object('schemaVersion',2);
 IF result->>'role' IN ('owner','admin','finance','pm') THEN
  result:=result||jsonb_build_object('taskOrders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'project_id',e.project_id) ORDER BY e.title) FROM public.invoicing_engagements e WHERE e.parent_engagement_id=p_engagement_id),'[]'),'masterTerms',coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('ceiling',t.ceiling::text)||CASE WHEN t.approved_at>p_cutoff THEN jsonb_build_object('state','proposed','approved_at',NULL,'approval_evidence','') ELSE '{}'::jsonb END ORDER BY t.version) FROM public.contract_master_terms t WHERE t.engagement_id=p_engagement_id AND t.created_at<=p_cutoff),'[]'),
   'parentMasterTerms',(SELECT to_jsonb(t)||jsonb_build_object('ceiling',t.ceiling::text) FROM public.contract_master_terms t WHERE t.engagement_id=(result->'engagement'->>'parent_engagement_id')::uuid AND t.state='approved' AND t.approved_at<=p_cutoff ORDER BY t.version DESC LIMIT 1));
 END IF;
 IF result->>'role' IN ('owner','admin') THEN
  result:=result||jsonb_build_object('access',coalesce((SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('email',u.email) ORDER BY a.created_at,a.version) FROM public.contract_access_versions a JOIN auth.users u ON u.id=a.user_id WHERE a.engagement_id=p_engagement_id),'[]'));
 END IF;
 result:=result||jsonb_build_object('receivedInvoices',coalesce((SELECT jsonb_agg(CASE WHEN result->>'role'='consultant' THEN jsonb_build_object('id',i.id,'invoice_id',i.invoice_id,'version',i.version,'state',i.state,'content',i.content,'review_note',CASE WHEN i.state='returned' THEN i.review_note ELSE '' END,'created_at',i.created_at) ELSE to_jsonb(i) END ORDER BY i.created_at,i.version) FROM public.contract_received_invoices i WHERE i.engagement_id=p_engagement_id AND i.created_at<=p_cutoff AND (result->>'role' IN ('owner','admin','pm','finance') OR (result->>'role'='consultant' AND i.submitted_by=p_actor_id))),'[]'));
 IF result->>'role' IN ('owner','admin','finance') THEN
  result:=result||jsonb_build_object('accountingImports',coalesce((SELECT jsonb_agg(to_jsonb(i)-'csv_text' ORDER BY i.created_at) FROM public.contract_accounting_imports i WHERE i.engagement_id=p_engagement_id AND i.created_at<=p_cutoff),'[]'),'accountingReviews',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at,r.version) FROM public.contract_accounting_reviews r WHERE r.engagement_id=p_engagement_id AND r.created_at<=p_cutoff),'[]'));
 END IF;
 IF result->>'role' IN ('owner','admin','finance','pm') THEN
 result:=result||jsonb_build_object('orderPeriods',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('authorization',p.period_metadata) ORDER BY p.created_at,p.version) FROM public.contract_order_periods p WHERE p.engagement_id=p_engagement_id AND p.created_at<=p_cutoff),'[]'));
 END IF;
 RETURN result;
END $$;