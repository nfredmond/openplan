CREATE TABLE public.contract_accounting_imports (
 id uuid PRIMARY KEY, engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 filename text NOT NULL, csv_text text NOT NULL, source_hash text NOT NULL, mapping jsonb NOT NULL, rows jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.contract_accounting_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_id uuid NOT NULL REFERENCES public.contract_accounting_imports(id), row_index integer NOT NULL CHECK(row_index>=0),
 engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 version integer NOT NULL CHECK(version>0), actual_version_id uuid REFERENCES public.contract_actual_versions(id),
 state text NOT NULL CHECK(state IN ('reconciled','unresolved')), evidence text NOT NULL CHECK(length(trim(evidence))>0),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(import_id,row_index,version)
);
ALTER TABLE public.contract_accounting_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_accounting_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_accounting_imports,public.contract_accounting_reviews FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_accounting_imports,public.contract_accounting_reviews TO authenticated,service_role;
CREATE POLICY finance_read ON public.contract_accounting_imports FOR SELECT TO authenticated USING(public.contract_can_finance(engagement_id));
CREATE POLICY finance_read ON public.contract_accounting_reviews FOR SELECT TO authenticated USING(public.contract_can_finance(engagement_id));
CREATE TRIGGER immutable_accounting_import BEFORE UPDATE OR DELETE ON public.contract_accounting_imports FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE TRIGGER immutable_accounting_review BEFORE UPDATE OR DELETE ON public.contract_accounting_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();

CREATE FUNCTION public.record_contract_accounting(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; actor_role text; cached public.contract_commands; imp public.contract_accounting_imports; actual public.contract_actual_versions;
 req uuid:=(p_command->>'requestId')::uuid; row_data jsonb; ix integer:=(p_command->>'rowIndex')::integer; v integer; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin','finance') THEN RAISE EXCEPTION 'Accounting reconciliation requires contract finance authority' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 IF req IS NULL OR octet_length(p_command::text)>2000000 THEN RAISE EXCEPTION 'Invalid accounting request' USING ERRCODE='22023'; END IF;
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Accounting retry changed its retained payload' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 IF p_command->>'kind'='accounting_import' THEN
  IF jsonb_typeof(p_command->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'rows') NOT BETWEEN 1 AND 200 OR coalesce(length(p_command->>'csv'),0)=0 OR coalesce(length(trim(p_command->>'filename')),0)=0 OR (SELECT count(*)<>count(DISTINCT r->>'externalId') FROM jsonb_array_elements(p_command->'rows') r) THEN RAISE EXCEPTION 'Retain 1 to 200 accounting rows with unique external identifiers' USING ERRCODE='22023'; END IF;
  FOR row_data IN SELECT value FROM jsonb_array_elements(p_command->'rows') LOOP
   IF coalesce(length(trim(row_data->>'externalId')),0)=0 OR coalesce(length(trim(row_data->>'sourceKey')),0)=0 OR row_data->>'amount' IS NULL OR row_data->>'amount' !~ '^\d{1,12}(\.\d{1,2})?$' OR (row_data->>'hours' IS NOT NULL AND row_data->>'hours' !~ '^\d{1,12}(\.\d{1,2})?$') OR row_data->>'currency' IS NULL OR row_data->>'currency' !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Accounting rows require source identity, currency and exact amounts' USING ERRCODE='22023'; END IF;
  END LOOP;
  INSERT INTO public.contract_accounting_imports(id,engagement_id,workspace_id,filename,csv_text,source_hash,mapping,rows,created_by)
  VALUES(req,e.id,e.workspace_id,p_command->>'filename',p_command->>'csv',encode(extensions.digest(p_command->>'csv','sha256'),'hex'),p_command->'mapping',p_command->'rows',p_actor_id);
  result:=jsonb_build_object('importId',req,'count',jsonb_array_length(p_command->'rows'));
 ELSIF p_command->>'kind'='accounting_review' THEN
  SELECT * INTO imp FROM public.contract_accounting_imports WHERE id=(p_command->>'importId')::uuid AND engagement_id=e.id;
  IF imp.id IS NULL OR ix IS NULL OR ix<0 OR ix>=jsonb_array_length(imp.rows) THEN RAISE EXCEPTION 'Select a retained row in this contract' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(version),0) INTO v FROM public.contract_accounting_reviews WHERE import_id=imp.id AND row_index=ix;
  IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Accounting review changed; reload before recording a decision' USING ERRCODE='PT409'; END IF;
  row_data:=imp.rows->ix;
  SELECT * INTO actual FROM public.contract_actual_versions WHERE engagement_id=e.id AND source_key=row_data->>'sourceKey' ORDER BY version DESC LIMIT 1;
  IF p_command->>'actualVersionId' IS DISTINCT FROM actual.id::text THEN RAISE EXCEPTION 'Source valuation changed; review the current version' USING ERRCODE='PT409'; END IF;
  IF p_command->>'state'='reconciled' AND (actual.id IS NULL OR actual.command->>'status'<>'approved' OR actual.amount IS DISTINCT FROM (row_data->>'amount')::numeric OR actual.hours IS DISTINCT FROM (row_data->>'hours')::numeric OR public.contract_shared_source_stale(actual) OR NOT EXISTS(SELECT 1 FROM public.contract_baselines b WHERE b.engagement_id=e.id AND b.state='approved' AND b.content->>'currency'=row_data->>'currency')) THEN RAISE EXCEPTION 'Accounting discrepancy remains unresolved; correct and review the retained source first' USING ERRCODE='23514'; END IF;
  INSERT INTO public.contract_accounting_reviews(import_id,row_index,engagement_id,workspace_id,version,actual_version_id,state,evidence,created_by)
  VALUES(imp.id,ix,e.id,e.workspace_id,v+1,actual.id,p_command->>'state',p_command->>'evidence',p_actor_id);
  result:=jsonb_build_object('importId',imp.id,'rowIndex',ix,'version',v+1);
 ELSE RAISE EXCEPTION 'Unknown accounting command' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_contract_accounting(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.record_contract_command(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; k text:=p_command->>'kind'; req uuid:=(p_command->>'requestId')::uuid;
 target_id uuid; actor_role text; grant_version integer; cached public.contract_commands; terms public.contract_master_terms; d public.kb_documents; v integer; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Contract access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
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
 RETURN result;
END $$;


CREATE OR REPLACE FUNCTION public.bill_contract_actuals(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE e public.invoicing_engagements; b public.contract_baselines; v public.contract_actual_versions; rate public.contract_rates; invoice_id uuid:=gen_random_uuid(); line_id uuid;
 source jsonb; allocation jsonb; lines jsonb; first_line uuid; amount numeric; total numeric:=0; gross numeric; allocated numeric; retention numeric; percent numeric:=(p_command->>'retentionPercent')::numeric; ix integer; pos integer:=0;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 PERFORM 1 FROM public.invoicing_engagements WHERE id=p_engagement_id FOR UPDATE;
 IF e.id IS NULL OR coalesce(public.contract_actor_role(e.id,p_actor_id) NOT IN ('owner','admin','finance'),true) THEN RAISE EXCEPTION 'Billing requires contract management access' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 IF jsonb_typeof(p_command->'entryIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'entryIds') NOT BETWEEN 1 AND 500 OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_command->'entryIds')) OR percent IS NULL OR percent NOT BETWEEN 0 AND 100 OR round(percent,2)<>percent OR coalesce(length(trim(p_command->>'invoiceNumber')),0)=0 OR (p_command->>'invoiceDate')::date IS NULL THEN RAISE EXCEPTION 'Choose unique actuals, exact retention and invoice identity' USING ERRCODE='22023'; END IF;
 SELECT * INTO b FROM public.contract_baselines WHERE engagement_id=e.id AND state='approved' ORDER BY version DESC LIMIT 1;
 IF b.id IS NULL THEN RAISE EXCEPTION 'Approved contract baseline required for billing' USING ERRCODE='22023'; END IF;
 INSERT INTO public.client_invoices(id,workspace_id,client_id,engagement_id,project_id,invoice_number,status,invoice_date,due_date,currency_code,retention_percent,created_by)
 VALUES(invoice_id,e.workspace_id,e.client_id,e.id,e.project_id,p_command->>'invoiceNumber','draft',(p_command->>'invoiceDate')::date,(p_command->>'dueDate')::date,b.content->>'currency',percent,p_actor_id);
 FOR source IN SELECT value FROM jsonb_array_elements(p_command->'entryIds') LOOP
  SELECT * INTO v FROM public.contract_actual_versions WHERE entry_id=(source#>>'{}')::uuid AND engagement_id=e.id ORDER BY version DESC LIMIT 1;
  IF public.contract_shared_source_stale(v) THEN RAISE EXCEPTION 'Reconcile the current shared OWP source before billing' USING ERRCODE='PT409'; END IF;
  IF v.id IS NULL OR v.command->>'status'<>'approved' OR NOT coalesce((v.command->>'billable')::boolean,false) OR v.command->>'category' NOT IN ('labor','expense') OR v.amount IS NULL OR jsonb_array_length(v.allocations)=0 OR EXISTS(SELECT 1 FROM public.contract_billing_sources x WHERE x.entry_id=v.entry_id) THEN RAISE EXCEPTION 'Only approved, allocated, unbilled labor and expenses may be billed' USING ERRCODE='PT409'; END IF;
  IF v.time_entry_id IS NOT NULL THEN
   PERFORM 1 FROM public.invoicing_time_entries WHERE id=v.time_entry_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.invoicing_time_entries WHERE id=v.time_entry_id AND billed_line_item_id IS NOT NULL) THEN RAISE EXCEPTION 'Time source already billed' USING ERRCODE='PT409'; END IF;
  END IF;
  rate:=NULL; gross:=v.amount;
  IF v.command->>'category'='labor' THEN
   SELECT * INTO rate FROM public.contract_rates WHERE engagement_id=e.id AND staff_id=(v.command->>'staffId')::uuid AND basis='billing' AND (v.command->>'entryDate')::date BETWEEN starts_on AND ends_on;
   IF rate.id IS NULL THEN RAISE EXCEPTION 'Effective billing rate required; internal cost is not a client fee' USING ERRCODE='22023'; END IF;
   gross:=round(v.hours*rate.hourly_rate,2);
  END IF;
  lines:='[]'; ix:=0; allocated:=0; first_line:=NULL;
  FOR allocation IN SELECT value FROM jsonb_array_elements(v.allocations) LOOP
   ix:=ix+1; pos:=pos+1;
   amount:=CASE WHEN ix=jsonb_array_length(v.allocations) THEN gross-allocated ELSE trunc(gross*(allocation->>'share')::numeric/10000,2) END; allocated:=allocated+amount;
   INSERT INTO public.client_invoice_line_items(invoice_id,position,description,quantity,unit_label,unit_amount,amount,deliverable_id)
   VALUES(invoice_id,pos,v.command->>'description',(allocation->>'hours')::numeric,CASE WHEN rate.id IS NOT NULL THEN 'hours' ELSE NULL END,rate.hourly_rate,amount,(allocation->>'deliverableId')::uuid) RETURNING id INTO line_id;
   first_line:=coalesce(first_line,line_id);
   lines:=lines||jsonb_build_array(jsonb_build_object('lineId',line_id,'taskId',allocation->>'taskId','deliverableId',allocation->>'deliverableId','share',allocation->'share','amount',amount::text,'hours',allocation->>'hours'));
  END LOOP;
  INSERT INTO public.contract_billing_sources(engagement_id,workspace_id,entry_id,actual_version_id,invoice_id,billing_rate_id,lines) VALUES(e.id,e.workspace_id,v.entry_id,v.id,invoice_id,rate.id,lines);
  IF v.time_entry_id IS NOT NULL THEN UPDATE public.invoicing_time_entries SET billed_line_item_id=first_line WHERE id=v.time_entry_id; END IF;
  total:=total+gross;
 END LOOP;
 retention:=round(total*percent/100,2);
 UPDATE public.client_invoices SET subtotal_amount=total,retention_amount=retention,total_amount=total-retention WHERE id=invoice_id;
 RETURN jsonb_build_object('invoiceId',invoice_id,'gross',total::text,'retention',retention::text,'net',(total-retention)::text);
END $$;

CREATE OR REPLACE FUNCTION public.record_contract_import(p_engagement_id uuid,p_actor_id uuid,p_import jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; old public.contract_imports; item jsonb; result jsonb:='[]'; source_hash text; import_id uuid:=(p_import->>'requestId')::uuid;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 PERFORM 1 FROM public.invoicing_engagements WHERE id=p_engagement_id FOR UPDATE;
 IF e.id IS NULL OR coalesce(public.contract_actor_role(e.id,p_actor_id) NOT IN ('owner','admin','finance'),true) THEN RAISE EXCEPTION 'Private cost import requires management access' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.enqueue_contract_snapshot(p_report_id uuid,p_format text,p_actor_id uuid)
RETURNS public.kb_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.contract_snapshots; d public.kb_documents; j public.kb_ocr_jobs;
BEGIN
 SELECT * INTO r FROM public.contract_snapshots WHERE id=p_report_id FOR UPDATE;
 IF r.id IS NULL OR coalesce(public.contract_actor_role(r.engagement_id,p_actor_id) NOT IN ('owner','admin','finance'),true) THEN RAISE EXCEPTION 'Private management report access denied' USING ERRCODE='42501'; END IF;
 IF p_format IS NULL OR p_format NOT IN ('pdf','xlsx') THEN RAISE EXCEPTION 'Invalid report format' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.kb_documents WHERE contract_snapshot_id=r.id AND contract_snapshot_format=p_format;
 IF d.id IS NULL THEN
  INSERT INTO public.kb_documents(workspace_id,uploaded_by,title,source_kind,original_filename,content_type,status,extraction_source,contract_snapshot_id,contract_snapshot_format)
  VALUES(r.workspace_id,p_actor_id,'Contract management: '||r.title,CASE p_format WHEN 'pdf' THEN 'uploaded_pdf' ELSE 'uploaded_spreadsheet' END,
  'contract-snapshot-'||r.id||'.'||p_format,CASE p_format WHEN 'pdf' THEN 'application/pdf' ELSE 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' END,'pending','none',r.id,p_format) RETURNING * INTO d;
 END IF;
 SELECT * INTO j FROM public.kb_ocr_jobs WHERE document_id=d.id AND job_kind='work_program_export' ORDER BY created_at DESC LIMIT 1;
 IF j.id IS NOT NULL THEN
  IF j.status='failed' THEN UPDATE public.kb_ocr_jobs SET status='queued',requested_by=p_actor_id,failure_detail=NULL,cancel_requested=false,lease_token=NULL,lease_until=NULL WHERE id=j.id RETURNING * INTO j; END IF;
  RETURN j;
 END IF;
 INSERT INTO public.kb_ocr_jobs(workspace_id,document_id,request_id,requested_by,job_kind) VALUES(r.workspace_id,d.id,gen_random_uuid()::text,p_actor_id,'work_program_export') RETURNING * INTO j;
 RETURN j;
END $$;

ALTER POLICY management_read ON public.contract_snapshots USING(public.contract_can_finance(engagement_id));
ALTER POLICY management_read ON public.contract_billing_sources USING(public.contract_can_manage(engagement_id));
ALTER POLICY private_contract_documents ON public.kb_documents USING(contract_snapshot_id IS NULL OR EXISTS(SELECT 1 FROM public.contract_snapshots s WHERE s.id=contract_snapshot_id AND public.contract_can_finance(s.engagement_id)));

CREATE FUNCTION public.guard_master_relationship() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE parent public.invoicing_engagements;
BEGIN
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.contract_master_terms WHERE engagement_id=OLD.id) AND
  (NEW.workspace_id,NEW.client_id,NEW.parent_engagement_id,NEW.engagement_kind) IS DISTINCT FROM (OLD.workspace_id,OLD.client_id,OLD.parent_engagement_id,OLD.engagement_kind) THEN RAISE EXCEPTION 'Retained master agreement identity cannot change' USING ERRCODE='23514'; END IF;
 IF NEW.parent_engagement_id IS NOT NULL THEN
  SELECT * INTO parent FROM public.invoicing_engagements WHERE id=NEW.parent_engagement_id;
  IF parent.id IS NULL OR parent.id=NEW.id OR parent.workspace_id<>NEW.workspace_id OR parent.client_id<>NEW.client_id OR parent.parent_engagement_id IS NOT NULL OR parent.engagement_kind NOT IN ('contract','on_call') OR NEW.engagement_kind<>'task_order' THEN RAISE EXCEPTION 'Task order must belong to a top-level agreement for the same workspace and client' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retained_master_relationship BEFORE INSERT OR UPDATE ON public.invoicing_engagements FOR EACH ROW EXECUTE FUNCTION public.guard_master_relationship();

CREATE OR REPLACE FUNCTION public.finish_work_program_export(p_job uuid,p_token uuid,p_checksum text,p_bytes bigint,p_storage_ref text,p_engine text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.kb_ocr_jobs; d public.kb_documents;
BEGIN
 SELECT * INTO j FROM public.kb_ocr_jobs WHERE id=p_job AND job_kind='work_program_export' FOR UPDATE;
 IF j.id IS NULL OR p_token IS NULL OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until IS NULL OR j.lease_until<=now() OR j.cancel_requested
 THEN RAISE EXCEPTION 'Export lease no longer current' USING ERRCODE='PT409'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by) THEN RAISE EXCEPTION 'Requester access revoked' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.kb_documents WHERE id=j.document_id FOR UPDATE;
 IF d.workspace_id IS DISTINCT FROM j.workspace_id OR (d.work_program_revision_id IS NULL AND d.work_program_packet_id IS NULL AND d.work_program_report_id IS NULL AND d.contract_snapshot_id IS NULL) OR p_checksum IS NULL OR p_bytes IS NULL OR p_storage_ref IS NULL OR p_checksum !~ '^[a-f0-9]{64}$' OR p_bytes<=0 OR p_storage_ref IS DISTINCT FROM
  'storage://kb-documents/'||d.workspace_id||'/'||d.id||'/'||p_checksum||'.'||coalesce(d.work_program_export_format,d.work_program_packet_format,d.work_program_report_format,d.contract_snapshot_format)
 THEN RAISE EXCEPTION 'Invalid retained export identity' USING ERRCODE='22023'; END IF;
 IF (d.work_program_report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by AND role IN ('owner','admin'))) OR (d.contract_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contract_snapshots s WHERE s.id=d.contract_snapshot_id AND public.contract_actor_role(s.engagement_id,j.requested_by) IN ('owner','admin','finance'))) THEN RAISE EXCEPTION 'Private report requester access revoked' USING ERRCODE='42501'; END IF;
 UPDATE public.kb_documents SET checksum=p_checksum,byte_size=p_bytes,storage_ref=p_storage_ref,status='stored',extraction_error=NULL WHERE id=d.id;
 UPDATE public.kb_ocr_jobs SET status='succeeded',progress=100,message='Review file retained',engine_name=p_engine,lease_until=NULL WHERE id=j.id;
END $$;

CREATE OR REPLACE FUNCTION public.can_read_management_object(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.kb_documents d WHERE d.id::text=split_part(object_name,'/',2) AND
 ((d.work_program_report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=d.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin'))) OR
  (d.contract_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contract_snapshots s WHERE s.id=d.contract_snapshot_id AND public.contract_can_finance(s.engagement_id)))))
$$;
