-- Indexed original files remain retained evidence after extraction becomes ready.
-- Keep the same file identity, scope and generated-report exclusions.
CREATE OR REPLACE FUNCTION public.record_contract_command_closeout(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; actor_role text; k text:=p_command->>'kind'; req uuid:=(p_command->>'requestId')::uuid; c jsonb:=p_command->'content';original_command jsonb:=coalesce(p_command->'_request',p_command);
 cached public.contract_commands; old public.contract_settlement_events; previous public.contract_closeouts; delivery public.contract_deliverable_events; d public.kb_documents;
 inv public.client_invoices; received public.contract_received_invoices; actual public.contract_actual_versions; v integer; result jsonb; record_id uuid; receipt jsonb; body jsonb; invoice_version text; currency text;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF actor_role IS NULL THEN RAISE EXCEPTION 'Contract authority required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>original_command THEN RAISE EXCEPTION 'Retained request changed' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 SELECT * INTO previous FROM public.contract_closeouts WHERE engagement_id=e.id ORDER BY version DESC LIMIT 1;
 IF previous.state='closed' AND k NOT IN ('reopen','access','snapshot') THEN RAISE EXCEPTION 'Reopen the retained closeout before changing this assignment' USING ERRCODE='PT409'; END IF;
 IF k NOT IN ('settlement','deliverable_event','closeout','reopen') THEN
  IF k='actual' AND p_command->>'category' IN ('payment','credit') AND EXISTS(SELECT 1 FROM public.contract_settlement_events s WHERE s.engagement_id=e.id AND s.source_key=p_command->>'sourceKey' AND s.content->>'legacyActualId' IS NULL) THEN RAISE EXCEPTION 'This financial source is already in settlement; correct it there without another payment or credit' USING ERRCODE='PT409'; END IF;
  RETURN public.record_contract_command_responses(p_engagement_id,p_actor_id,p_command);
 END IF;
 IF req IS NULL OR octet_length(p_command::text)>16000000 THEN RAISE EXCEPTION 'Invalid closeout request' USING ERRCODE='22023'; END IF;
 IF (k IN ('settlement','closeout','reopen') AND actor_role NOT IN ('owner','admin','finance')) OR (k='deliverable_event' AND actor_role NOT IN ('owner','admin','pm','finance','consultant','member')) THEN RAISE EXCEPTION 'Designated finance authority required' USING ERRCODE='42501'; END IF;
 IF k IN ('settlement','deliverable_event') THEN
  SELECT * INTO d FROM public.kb_documents WHERE id=coalesce((c->>'documentId')::uuid,(p_command->>'documentId')::uuid) AND workspace_id=e.workspace_id AND status IN ('stored','ready') AND checksum IS NOT NULL AND storage_ref IS NOT NULL AND contract_snapshot_id IS NULL AND work_program_report_id IS NULL FOR SHARE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Retain an original source file in this organization before recording the event' USING ERRCODE='22023'; END IF;
  receipt:=jsonb_build_object('id',d.id,'checksum',d.checksum,'storageRef',d.storage_ref,'bytes',d.byte_size,'title',d.title);
 END IF;
 IF k='settlement' THEN
  SELECT * INTO old FROM public.contract_settlement_events WHERE event_id=(c->>'eventId')::uuid ORDER BY version DESC LIMIT 1;
  v:=coalesce(old.version,0);
  IF old.id IS NOT NULL AND (old.engagement_id<>e.id OR old.source_key IS DISTINCT FROM c->>'sourceKey' OR old.content->>'invoiceId' IS DISTINCT FROM c->>'invoiceId' OR old.content->>'direction' IS DISTINCT FROM c->>'direction') THEN RAISE EXCEPTION 'Financial source identity and invoice cannot change' USING ERRCODE='42501'; END IF;
  IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Financial event changed; review its exact version' USING ERRCODE='PT409'; END IF;
  IF (v>0 AND coalesce(length(trim(c->>'correctionEvidence')),0)=0) OR coalesce(length(trim(c->>'sourceReference')),0)=0 OR coalesce(length(trim(c->>'sourceKey')),0)=0 OR (c->>'amount')::numeric<0 OR c->>'state' NOT IN ('recorded','excluded') THEN RAISE EXCEPTION 'Document the financial event amount, original source and correction basis' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.contract_settlement_events s WHERE s.engagement_id=e.id AND s.source_key=c->>'sourceKey' AND s.event_id<>(c->>'eventId')::uuid) THEN RAISE EXCEPTION 'Duplicate financial source; correct its retained event' USING ERRCODE='PT409'; END IF;
  IF c->>'direction'='outgoing' THEN
   SELECT * INTO inv FROM public.client_invoices WHERE id=(c->>'invoiceId')::uuid AND engagement_id=e.id AND workspace_id=e.workspace_id AND status IN ('sent','paid') FOR SHARE;
   invoice_version:=inv.updated_at::text;currency:=inv.currency_code;
   IF inv.id IS NULL OR (c->>'invoiceVersion')::timestamptz IS DISTINCT FROM inv.updated_at THEN RAISE EXCEPTION 'Review the current issued outgoing invoice' USING ERRCODE='PT409'; END IF;
  ELSIF c->>'direction'='received' THEN
   SELECT * INTO received FROM public.contract_received_invoices WHERE invoice_id=(c->>'invoiceId')::uuid AND engagement_id=e.id ORDER BY version DESC LIMIT 1;
   currency:=received.content->>'currency';invoice_version:=received.version::text;
   IF received.id IS NULL OR received.state<>'approved' OR c->>'invoiceVersion' IS DISTINCT FROM invoice_version THEN RAISE EXCEPTION 'Review the current approved received invoice' USING ERRCODE='PT409'; END IF;
  ELSE RAISE EXCEPTION 'Separate received from outgoing invoices' USING ERRCODE='22023'; END IF;
  IF c->>'currency' IS DISTINCT FROM currency THEN RAISE EXCEPTION 'Financial event currency must match its invoice' USING ERRCODE='22023'; END IF;
  IF c->>'kind' NOT IN ('payment','credit','refund','retention_hold','retention_release','dispute_open','dispute_resolve','adjustment_debit','adjustment_credit') THEN RAISE EXCEPTION 'Unknown financial event kind' USING ERRCODE='22023'; END IF;
  IF c->>'legacyActualId' IS NOT NULL THEN
   SELECT * INTO actual FROM public.contract_actual_versions WHERE entry_id=(c->>'legacyActualId')::uuid AND engagement_id=e.id ORDER BY version DESC LIMIT 1;
   IF actual.id IS NULL OR c->>'direction'<>'outgoing' OR actual.command->>'category' NOT IN ('payment','credit') OR actual.command->>'category' IS DISTINCT FROM c->>'kind' OR actual.command->>'status'<>'approved' OR actual.command->>'invoiceId' IS DISTINCT FROM c->>'invoiceId' OR actual.amount IS DISTINCT FROM (c->>'amount')::numeric THEN RAISE EXCEPTION 'Link the exact existing payment or credit without recording another cash event' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM public.contract_settlement_events s WHERE s.engagement_id=e.id AND s.event_id<>(c->>'eventId')::uuid AND s.content->>'legacyActualId'=c->>'legacyActualId') THEN RAISE EXCEPTION 'Legacy cash source already linked' USING ERRCODE='PT409'; END IF;
  ELSIF EXISTS(SELECT 1 FROM public.contract_actual_versions a WHERE a.engagement_id=e.id AND a.command->>'sourceKey'=c->>'sourceKey' AND a.command->>'category' IN ('payment','credit')) THEN RAISE EXCEPTION 'Link the existing payment or credit source instead of duplicating it' USING ERRCODE='PT409'; END IF;
  IF p_command->>'_inputHash' IS DISTINCT FROM public.contract_closeout_hash(e.id) OR p_command->'_position' IS NULL THEN RAISE EXCEPTION 'Financial sources changed during reconciliation' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.contract_settlement_events(event_id,source_key,engagement_id,workspace_id,version,content,source_receipt,created_by) VALUES((c->>'eventId')::uuid,c->>'sourceKey',e.id,e.workspace_id,v+1,c,receipt,p_actor_id) RETURNING id INTO record_id;
 ELSIF k='deliverable_event' THEN
  IF NOT EXISTS(SELECT 1 FROM public.project_deliverables project_delivery WHERE project_delivery.id=(p_command->>'deliverableId')::uuid AND project_delivery.project_id=e.project_id) OR NOT EXISTS(SELECT 1 FROM public.contract_baselines b CROSS JOIN LATERAL jsonb_array_elements(b.content->'tasks') t WHERE b.engagement_id=e.id AND b.state='approved' AND t->>'deliverableId'=p_command->>'deliverableId') THEN RAISE EXCEPTION 'Deliverable must belong to this project and retained approved contract scope' USING ERRCODE='42501'; END IF;
  IF actor_role='member' AND NOT EXISTS(SELECT 1 FROM public.contract_task_assignments a JOIN public.contract_tasks t ON t.id=a.task_id WHERE a.engagement_id=e.id AND a.assignee_user_id=p_actor_id AND a.active AND t.deliverable_id=(p_command->>'deliverableId')::uuid) THEN RAISE EXCEPTION 'Submit only your assigned deliverable' USING ERRCODE='42501'; END IF;
  IF p_command->>'state' IN ('returned','accepted') AND actor_role NOT IN ('owner','admin','pm','finance') THEN RAISE EXCEPTION 'Designated PM acceptance authority required' USING ERRCODE='42501'; END IF;
  SELECT * INTO delivery FROM public.contract_deliverable_events WHERE engagement_id=e.id AND deliverable_id=(p_command->>'deliverableId')::uuid ORDER BY version DESC LIMIT 1;
  v:=coalesce(delivery.version,0);
  IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Deliverable event changed; review its current version' USING ERRCODE='PT409'; END IF;
  IF (v=0 AND p_command->>'state'<>'submitted') OR (v>0 AND NOT ((delivery.state='returned' AND p_command->>'state'='resubmitted') OR (delivery.state IN ('submitted','resubmitted') AND p_command->>'state' IN ('returned','accepted')))) THEN RAISE EXCEPTION 'Record submission, return, resubmission and acceptance in order' USING ERRCODE='22023'; END IF;
  IF delivery.id IS NOT NULL AND (p_command->>'date')::date<delivery.date THEN RAISE EXCEPTION 'Delivery event date precedes its prior event' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_deliverable_events(engagement_id,workspace_id,deliverable_id,version,state,date,authority,evidence,source_receipt,created_by) VALUES(e.id,e.workspace_id,(p_command->>'deliverableId')::uuid,v+1,p_command->>'state',(p_command->>'date')::date,p_command->>'authority',p_command->>'evidence',receipt,p_actor_id) RETURNING id INTO record_id;
 ELSE
  v:=coalesce(previous.version,0);
  IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Closeout revision changed' USING ERRCODE='PT409'; END IF;
  IF k='reopen' THEN
   IF previous.state IS DISTINCT FROM 'closed' OR previous.id IS DISTINCT FROM (p_command->>'closeoutId')::uuid OR coalesce(length(trim(p_command->>'evidence')),0)=0 THEN RAISE EXCEPTION 'Reopen the current closed revision with evidence' USING ERRCODE='PT409'; END IF;
   body:=jsonb_build_object('request',original_command,'evidence',p_command->>'evidence');
  ELSE
   IF p_command->>'_inputHash' IS DISTINCT FROM public.contract_closeout_hash(e.id) OR p_command->'_package' IS NULL OR p_command->'_position' IS NULL THEN RAISE EXCEPTION 'Closeout inputs changed or the reconciled package is missing' USING ERRCODE='PT409'; END IF;
   IF ((p_command->>'workAccepted')::boolean AND p_command->'_position'->>'workAccepted' IS DISTINCT FROM 'true') OR ((p_command->>'financialSettled')::boolean AND p_command->'_position'->>'financialSettled' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Closeout claim exceeds retained acceptance or financial evidence' USING ERRCODE='22023'; END IF;
   body:=jsonb_build_object('request',original_command,'package',p_command->'_package','position',p_command->'_position');
  END IF;
  INSERT INTO public.contract_closeouts(engagement_id,workspace_id,version,state,previous_id,input_hash,content,content_hash,created_by) VALUES(e.id,e.workspace_id,v+1,CASE WHEN k='reopen' THEN 'reopened' ELSE 'closed' END,previous.id,public.contract_closeout_hash(e.id),body,encode(extensions.digest(body::text,'sha256'),'hex'),p_actor_id) RETURNING id INTO record_id;
 END IF;
 result:=jsonb_build_object('id',record_id,'version',v+1);
 INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,original_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_contract_command_closeout(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
