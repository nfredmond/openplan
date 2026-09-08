-- Received consultant invoices are evidence of a payable, never another incurred cost.
CREATE TABLE public.contract_received_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL,
 engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 version integer NOT NULL CHECK(version>0), state text NOT NULL CHECK(state IN ('submitted','returned','reviewed','approved')),
 content jsonb NOT NULL, matches jsonb NOT NULL DEFAULT '[]', review_note text NOT NULL DEFAULT '',
 submitted_by uuid NOT NULL REFERENCES auth.users(id), created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(invoice_id,version)
);
CREATE TABLE public.contract_received_files (
 id uuid PRIMARY KEY, engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 filename text NOT NULL, content_type text NOT NULL CHECK(content_type IN ('application/pdf','text/csv')),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 1000000), checksum text NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contract_received_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_received_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_received_invoices,public.contract_received_files FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_received_invoices,public.contract_received_files TO authenticated,service_role;
CREATE POLICY management_read ON public.contract_received_invoices FOR SELECT TO authenticated USING(public.contract_can_manage(engagement_id));
CREATE POLICY management_read ON public.contract_received_files FOR SELECT TO authenticated USING(public.contract_can_manage(engagement_id));
CREATE TRIGGER immutable_received_invoice BEFORE UPDATE OR DELETE ON public.contract_received_invoices FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE TRIGGER immutable_received_file BEFORE UPDATE OR DELETE ON public.contract_received_files FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();

CREATE FUNCTION public.record_received_invoice(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
<<received>>
DECLARE e public.invoicing_engagements; actor_role text; cached public.contract_commands; old public.contract_received_invoices; saved public.contract_received_invoices;
 req uuid:=(p_command->>'requestId')::uuid; invoice uuid:=(p_command->>'invoiceId')::uuid; k text:=p_command->>'kind';
 content jsonb; item jsonb; v public.contract_actual_versions; b public.contract_baselines; total numeric:=0; consumed numeric; matches jsonb:='[]';
 file_id uuid; file_bytes bytea; result jsonb; target_state text;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin','finance','pm','consultant') THEN RAISE EXCEPTION 'Received invoice access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 IF req IS NULL OR invoice IS NULL OR k NOT IN ('received_invoice','received_review') OR octet_length(p_command::text)>2000000 THEN RAISE EXCEPTION 'Invalid received invoice command' USING ERRCODE='22023'; END IF;
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Received invoice retry changed' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 SELECT * INTO old FROM public.contract_received_invoices WHERE invoice_id=invoice ORDER BY version DESC LIMIT 1;
 IF old.id IS NOT NULL AND old.engagement_id<>e.id THEN RAISE EXCEPTION 'Foreign received invoice' USING ERRCODE='42501'; END IF;
 IF coalesce(old.version,0) IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Invoice changed; review the current exact version' USING ERRCODE='PT409'; END IF;
 IF k='received_invoice' THEN
  IF old.id IS NOT NULL AND (old.state<>'returned' OR (actor_role='consultant' AND old.submitted_by<>p_actor_id)) THEN RAISE EXCEPTION 'Only a returned invoice can be corrected by its submitter' USING ERRCODE='42501'; END IF;
  content:=p_command->'content';
  IF coalesce(length(trim(content->>'number')),0)=0 OR content->>'date' IS NULL OR content->>'currency' IS NULL OR content->>'currency' !~ '^[A-Z]{3}$' OR jsonb_typeof(content->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(content->'lines') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Complete invoice identity, date, currency and lines required' USING ERRCODE='22023'; END IF;
  IF old.id IS NOT NULL AND (content->>'number',content->>'currency') IS DISTINCT FROM (old.content->>'number',old.content->>'currency') THEN RAISE EXCEPTION 'Correction retains invoice identity and currency' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.contract_received_invoices i WHERE i.engagement_id=e.id AND i.invoice_id<>invoice AND i.content->>'number'=received.content->>'number') THEN RAISE EXCEPTION 'Invoice number already received; correct its retained identity' USING ERRCODE='PT409'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(content->'lines') LOOP
   IF item->>'amount' IS NULL OR item->>'amount' !~ '^\d{1,12}(\.\d{1,2})?$' OR coalesce(length(trim(item->>'description')),0)=0 OR item->>'treatment' IS NULL OR item->>'treatment' NOT IN ('direct','indirect','fixed_fee') OR coalesce(length(trim(item->>'basis')),0)=0 THEN RAISE EXCEPTION 'Invoice lines require exact amounts and distinct documented cost treatment' USING ERRCODE='22023'; END IF;
   total:=total+(item->>'amount')::numeric;
  END LOOP;
  file_bytes:=decode(p_command->'file'->>'base64','base64');file_id:=gen_random_uuid();
  IF file_bytes IS NULL OR p_command->'file'->>'filename' IS NULL THEN RAISE EXCEPTION 'Retain the original received invoice file' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_received_files(id,engagement_id,workspace_id,filename,content_type,bytes,checksum,created_by)
  VALUES(file_id,e.id,e.workspace_id,p_command->'file'->>'filename',p_command->'file'->>'contentType',file_bytes,encode(extensions.digest(file_bytes,'sha256'),'hex'),p_actor_id);
  content:=content||jsonb_build_object('total',total::text,'fileId',file_id);
  INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by)
  VALUES(invoice,e.id,e.workspace_id,coalesce(old.version,0)+1,'submitted',content,coalesce(old.submitted_by,p_actor_id),p_actor_id) RETURNING * INTO saved;
 ELSE
  target_state:=p_command->>'state';
  IF actor_role='consultant' OR target_state IS NULL OR target_state NOT IN ('returned','reviewed','approved') OR old.id IS NULL OR old.state NOT IN ('submitted','reviewed') OR (target_state='approved' AND actor_role NOT IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'PM review and separate finance approval require an unchanged submitted or reviewed invoice' USING ERRCODE='42501'; END IF;
  IF coalesce(length(trim(p_command->>'note')),0)=0 THEN RAISE EXCEPTION 'Record the discrepancy or review and authority evidence' USING ERRCODE='22023'; END IF;
  IF target_state='approved' THEN
   SELECT * INTO b FROM public.contract_baselines WHERE engagement_id=e.id AND state='approved' ORDER BY version DESC LIMIT 1;
   IF b.id IS NULL OR b.content->>'currency' IS DISTINCT FROM old.content->>'currency' THEN RAISE EXCEPTION 'Invoice currency must match the approved agreement' USING ERRCODE='22023'; END IF;
   IF jsonb_typeof(p_command->'matches') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'matches')=0 OR (SELECT count(*)<>count(DISTINCT x->>'entryId') FROM jsonb_array_elements(p_command->'matches') x) THEN RAISE EXCEPTION 'Match unique existing incurred costs or commitments' USING ERRCODE='22023'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(p_command->'matches') LOOP
    SELECT * INTO v FROM public.contract_actual_versions WHERE entry_id=(item->>'entryId')::uuid AND engagement_id=e.id ORDER BY version DESC LIMIT 1;
    IF v.id IS NULL OR v.id::text IS DISTINCT FROM item->>'versionId' OR v.command->>'status'<>'approved' OR v.command->>'category' NOT IN ('expense','labor','commitment') OR v.amount IS NULL OR public.contract_shared_source_stale(v) THEN RAISE EXCEPTION 'Match the current reviewed source valuation in this contract' USING ERRCODE='PT409'; END IF;
    IF item->>'amount' IS NULL OR item->>'amount' !~ '^\d{1,12}(\.\d{1,2})?$' THEN RAISE EXCEPTION 'Exact source match amount required' USING ERRCODE='22023'; END IF;
    SELECT coalesce(sum((m->>'amount')::numeric),0) INTO consumed FROM public.contract_received_invoices i CROSS JOIN LATERAL jsonb_array_elements(i.matches) m WHERE i.engagement_id=e.id AND i.state='approved' AND m->>'entryId'=v.entry_id::text;
    IF consumed+(item->>'amount')::numeric>v.amount THEN RAISE EXCEPTION 'Source amount already matched or invoice exceeds documented source' USING ERRCODE='23514'; END IF;
    total:=total+(item->>'amount')::numeric;
    matches:=matches||jsonb_build_array(item||jsonb_build_object('allocations',v.allocations,'staffId',v.command->'staffId','sourceKey',v.source_key,'category',v.command->>'category'));
   END LOOP;
   IF total IS DISTINCT FROM (old.content->>'total')::numeric THEN RAISE EXCEPTION 'Invoice and matched sources do not reconcile' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,matches,review_note,submitted_by,created_by)
  VALUES(invoice,e.id,e.workspace_id,old.version+1,target_state,old.content,matches,p_command->>'note',old.submitted_by,p_actor_id) RETURNING * INTO saved;
 END IF;
 result:=jsonb_build_object('invoiceId',invoice,'version',saved.version,'state',saved.state);
 INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_received_invoice(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.record_contract_command(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; k text:=p_command->>'kind'; req uuid:=(p_command->>'requestId')::uuid;
 target_id uuid; actor_role text; grant_version integer; cached public.contract_commands; terms public.contract_master_terms; d public.kb_documents; v integer; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Contract access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
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
 result:=public.read_contract_management_v046(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role' IN ('owner','admin','finance','pm') THEN
  result:=result||jsonb_build_object('taskOrders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'project_id',e.project_id) ORDER BY e.title) FROM public.invoicing_engagements e WHERE e.parent_engagement_id=p_engagement_id),'[]'),'masterTerms',coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('ceiling',t.ceiling::text)||CASE WHEN t.approved_at>p_cutoff THEN jsonb_build_object('state','proposed','approved_at',NULL,'approval_evidence','') ELSE '{}'::jsonb END ORDER BY t.version) FROM public.contract_master_terms t WHERE t.engagement_id=p_engagement_id AND t.created_at<=p_cutoff),'[]'),
   'parentMasterTerms',(SELECT to_jsonb(t)||jsonb_build_object('ceiling',t.ceiling::text) FROM public.contract_master_terms t WHERE t.engagement_id=(result->'engagement'->>'parent_engagement_id')::uuid AND t.state='approved' AND t.approved_at<=p_cutoff ORDER BY t.version DESC LIMIT 1));
 END IF;
 IF result->>'role' IN ('owner','admin') THEN
  result:=result||jsonb_build_object('access',coalesce((SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('email',u.email) ORDER BY a.created_at,a.version) FROM public.contract_access_versions a JOIN auth.users u ON u.id=a.user_id WHERE a.engagement_id=p_engagement_id),'[]'));
 END IF;
 result:=result||jsonb_build_object('receivedInvoices',coalesce((SELECT jsonb_agg(CASE WHEN result->>'role'='consultant' THEN jsonb_build_object('id',i.id,'invoice_id',i.invoice_id,'version',i.version,'state',i.state,'content',i.content,'review_note',CASE WHEN i.state='returned' THEN i.review_note ELSE '' END,'created_at',i.created_at) ELSE to_jsonb(i) END ORDER BY i.created_at,i.version) FROM public.contract_received_invoices i WHERE i.engagement_id=p_engagement_id AND i.created_at<=p_cutoff AND (result->>'role' IN ('owner','admin','pm','finance') OR (result->>'role'='consultant' AND i.submitted_by=p_actor_id))),'[]'));
 RETURN result;
END $$;

CREATE FUNCTION public.read_received_invoice_file(p_engagement_id uuid,p_actor_id uuid,p_file_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f public.contract_received_files; actor_role text;
BEGIN
 actor_role:=public.contract_actor_role(p_engagement_id,p_actor_id);
 SELECT * INTO f FROM public.contract_received_files WHERE id=p_file_id AND engagement_id=p_engagement_id;
 IF f.id IS NULL OR actor_role IS NULL OR NOT (actor_role IN ('owner','admin','finance','pm') OR (actor_role='consultant' AND f.created_by=p_actor_id)) THEN RAISE EXCEPTION 'Received invoice file access denied' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('filename',f.filename,'contentType',f.content_type,'base64',encode(f.bytes,'base64'),'checksum',f.checksum);
END $$;
REVOKE ALL ON FUNCTION public.read_received_invoice_file(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_received_invoice_file(uuid,uuid,uuid) TO service_role;
