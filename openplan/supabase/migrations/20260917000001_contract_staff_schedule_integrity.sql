-- Working assignments respect current membership; retained staff and financial history stays intact.
CREATE FUNCTION public.contract_staff_available(p_staff uuid,p_workspace uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.invoicing_staff s WHERE s.id=p_staff AND s.workspace_id=p_workspace AND s.active AND (s.user_id IS NULL OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p_workspace AND m.user_id=s.user_id)))
$$;
REVOKE ALL ON FUNCTION public.contract_staff_available(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.record_contract_command_delivery(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; actor_role text; req uuid:=(p_command->>'requestId')::uuid; k text:=p_command->>'kind'; c jsonb:=p_command->'content'; cached public.contract_commands;
 v integer; result jsonb; old public.contract_work_updates; staff_row public.invoicing_staff; node jsonb; person jsonb; record_id uuid; original_command jsonb:=coalesce(p_command->'_request',p_command);
BEGIN
 IF k NOT IN ('capacity','schedule','work_update','work_review','forecast') THEN RETURN public.record_contract_command_agency(p_engagement_id,p_actor_id,p_command); END IF;
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin','pm','finance','member') OR (actor_role='member' AND k<>'work_update') THEN RAISE EXCEPTION 'Contract delivery authority required' USING ERRCODE='42501'; END IF;
 IF req IS NULL OR octet_length(p_command::text)>8000000 THEN RAISE EXCEPTION 'Invalid delivery request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>original_command THEN RAISE EXCEPTION 'Delivery retry changed' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 IF k='schedule' THEN
  SELECT coalesce(max(version),0) INTO v FROM public.contract_schedules WHERE engagement_id=e.id;
  IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Schedule changed' USING ERRCODE='PT409'; END IF;
  IF jsonb_typeof(c->'nodes') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'nodes')>200 OR coalesce(length(trim(c->>'assumptions')),0)=0 THEN RAISE EXCEPTION 'Document schedule assumptions and nodes' USING ERRCODE='22023'; END IF;
  IF c->>'billingTreatment' IS DISTINCT FROM 'unassessed' AND (coalesce(length(trim(c->>'billingEvidence')),0)=0 OR NOT EXISTS(SELECT 1 FROM public.contract_baselines b WHERE b.engagement_id=e.id AND b.state='approved' AND b.content->'sourceDocuments' @> jsonb_build_array(c->>'billingSourceId'))) THEN RAISE EXCEPTION 'Forecast billing terms require a retained approved agreement source' USING ERRCODE='22023'; END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(c->'nodes') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.contract_tasks t WHERE t.id=(node->>'taskId')::uuid AND t.engagement_id=e.id AND t.active) THEN RAISE EXCEPTION 'Schedule task must be active in this assignment' USING ERRCODE='42501'; END IF;
   FOR person IN SELECT value FROM jsonb_array_elements(node->'staff') LOOP
    IF NOT EXISTS(SELECT 1 FROM public.invoicing_staff s WHERE s.id=(person->>'staffId')::uuid AND s.workspace_id=e.workspace_id AND public.contract_staff_available(s.id,e.workspace_id)) THEN RAISE EXCEPTION 'Schedule staff must be active in the same organization' USING ERRCODE='42501'; END IF;
   END LOOP;
  END LOOP;
  INSERT INTO public.contract_schedules(engagement_id,workspace_id,version,content,created_by) VALUES(e.id,e.workspace_id,v+1,c,p_actor_id) RETURNING id INTO record_id;
  UPDATE public.contract_task_assignments SET active=false WHERE engagement_id=e.id;
  FOR node IN SELECT value FROM jsonb_array_elements(c->'nodes') LOOP
   FOR person IN SELECT value FROM jsonb_array_elements(node->'staff') LOOP
    INSERT INTO public.contract_task_assignments(task_id,engagement_id,workspace_id,staff_id,assignee_user_id,active)
    SELECT (node->>'taskId')::uuid,e.id,e.workspace_id,s.id,s.user_id,true FROM public.invoicing_staff s WHERE s.id=(person->>'staffId')::uuid
    ON CONFLICT(task_id,staff_id) DO UPDATE SET active=true,assignee_user_id=excluded.assignee_user_id;
   END LOOP;
  END LOOP;
 ELSIF k='capacity' THEN
  SELECT * INTO staff_row FROM public.invoicing_staff WHERE id=(c->>'staffId')::uuid AND public.contract_staff_available(id,e.workspace_id);
  IF staff_row.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.contract_task_assignments a WHERE a.engagement_id=e.id AND a.staff_id=staff_row.id AND a.active) THEN RAISE EXCEPTION 'Capacity must belong to assigned active staff' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(version),0) INTO v FROM public.contract_capacity_versions WHERE staff_id=staff_row.id;
  IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Shared staff availability changed' USING ERRCODE='PT409'; END IF;
  IF (c->>'startsOn')::date>(c->>'endsOn')::date OR (c->>'hoursPerDay')::numeric NOT BETWEEN 0 AND 24 OR coalesce(length(trim(c->>'evidence')),0)=0 THEN RAISE EXCEPTION 'Document an ordered capacity period with at most 24 daily hours' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_capacity_versions(engagement_id,workspace_id,staff_id,version,content,created_by) VALUES(e.id,e.workspace_id,staff_row.id,v+1,c,p_actor_id) RETURNING id INTO record_id;
 ELSIF k='work_update' THEN
  SELECT * INTO staff_row FROM public.invoicing_staff WHERE id=(c->>'staffId')::uuid AND public.contract_staff_available(id,e.workspace_id);
  IF staff_row.id IS NULL OR (actor_role='member' AND staff_row.user_id IS DISTINCT FROM p_actor_id) OR NOT EXISTS(SELECT 1 FROM public.contract_task_assignments a WHERE a.engagement_id=e.id AND a.task_id=(c->>'taskId')::uuid AND a.staff_id=staff_row.id AND a.active) THEN RAISE EXCEPTION 'Submit remaining work only for an active staff assignment' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(version),0) INTO v FROM public.contract_work_updates WHERE task_id=(c->>'taskId')::uuid AND staff_id=staff_row.id;
  IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Remaining-work update changed' USING ERRCODE='PT409'; END IF;
  IF coalesce(length(trim(c->>'evidence')),0)=0 OR (c->>'hours')::numeric<0 OR (c->>'availableHoursPerDay')::numeric NOT BETWEEN 0 AND 24 OR (c->>'actualFinish')::date<(c->>'actualStart')::date OR (c->>'actualFinish')::date>(c->>'asOf')::date OR (c->>'actualStart')::date>(c->>'asOf')::date OR (c->>'status'='reported_complete' AND ((c->>'hours')::numeric IS DISTINCT FROM 0 OR c->>'actualFinish' IS NULL)) THEN RAISE EXCEPTION 'Complete and consistent remaining-work evidence required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_work_updates(engagement_id,workspace_id,task_id,staff_id,version,state,content,created_by) VALUES(e.id,e.workspace_id,(c->>'taskId')::uuid,staff_row.id,v+1,'submitted',c,p_actor_id) RETURNING id INTO record_id;
 ELSIF k='work_review' THEN
  SELECT * INTO old FROM public.contract_work_updates WHERE id=(p_command->>'updateId')::uuid AND engagement_id=e.id;
  SELECT max(version) INTO v FROM public.contract_work_updates WHERE task_id=old.task_id AND staff_id=old.staff_id;
  IF old.id IS NULL OR old.state<>'submitted' OR old.version IS DISTINCT FROM v OR v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Review the exact current submitted work update' USING ERRCODE='PT409'; END IF;
  IF p_command->>'state'='accepted' AND NOT EXISTS(SELECT 1 FROM public.contract_task_assignments a JOIN public.invoicing_staff s ON s.id=a.staff_id WHERE a.engagement_id=e.id AND a.task_id=old.task_id AND a.staff_id=old.staff_id AND a.active AND public.contract_staff_available(s.id,e.workspace_id)) THEN RAISE EXCEPTION 'Reconcile changed or departed staff before review' USING ERRCODE='42501'; END IF;
  IF p_command->>'state' NOT IN ('accepted','returned') OR coalesce(length(trim(p_command->>'evidence')),0)=0 OR ((p_command->>'remainingCost' IS NOT NULL OR p_command->>'remainingGrossBilling' IS NOT NULL) AND coalesce(length(trim(p_command->>'valuationEvidence')),0)=0) THEN RAISE EXCEPTION 'Document exact-version review and any remaining valuation' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_work_updates(engagement_id,workspace_id,task_id,staff_id,version,state,content,remaining_cost,remaining_gross_billing,valuation_evidence,evidence,reviewed_update_id,created_by)
  VALUES(e.id,e.workspace_id,old.task_id,old.staff_id,v+1,p_command->>'state',old.content,(p_command->>'remainingCost')::numeric,(p_command->>'remainingGrossBilling')::numeric,p_command->>'valuationEvidence',p_command->>'evidence',old.id,p_actor_id) RETURNING id INTO record_id;
 ELSE
  IF p_command->>'_inputHash' IS DISTINCT FROM public.contract_delivery_hash(e.workspace_id) THEN RAISE EXCEPTION 'Forecast inputs changed; reload and review again' USING ERRCODE='PT409'; END IF;
  IF p_command->'_result' IS NULL OR p_command->'_inputs' IS NULL OR coalesce(length(trim(p_command->>'reviewEvidence')),0)=0 THEN RAISE EXCEPTION 'Retain deterministic forecast inputs, results and review evidence' USING ERRCODE='22023'; END IF;
  SELECT coalesce(max(version),0) INTO v FROM public.contract_forecasts WHERE engagement_id=e.id;
  INSERT INTO public.contract_forecasts(engagement_id,workspace_id,version,input_hash,content,created_by) VALUES(e.id,e.workspace_id,v+1,p_command->>'_inputHash',jsonb_build_object('inputs',p_command->'_inputs','result',p_command->'_result','reviewEvidence',p_command->>'reviewEvidence','coverageEvidence',p_command->>'coverageEvidence'),p_actor_id) RETURNING id INTO record_id;
 END IF;
 result:=jsonb_build_object('id',record_id,'version',v+1);
 INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,original_command,result);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.read_contract_management_v046(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; actor_role text; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF e.id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('owner','admin','member','pm','finance','consultant') THEN RAISE EXCEPTION 'Contract access denied' USING ERRCODE='42501'; END IF;
 result:=jsonb_build_object('engagement',to_jsonb(e),'role',actor_role,
 'staff',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'active',s.active,'user_id',s.user_id) ORDER BY s.name) FROM public.invoicing_staff s WHERE s.workspace_id=e.workspace_id AND (actor_role IN ('owner','admin','finance') OR (actor_role='pm' AND (public.contract_staff_available(s.id,e.workspace_id) OR EXISTS(SELECT 1 FROM public.contract_task_assignments a WHERE a.engagement_id=e.id AND a.staff_id=s.id) OR EXISTS(SELECT 1 FROM public.contract_actual_versions a WHERE a.engagement_id=e.id AND a.command->>'staffId'=s.id::text))) OR s.user_id=p_actor_id)),'[]'),
 'deliverables',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title)) FROM public.project_deliverables d WHERE d.project_id=e.project_id),'[]'),
 'documents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'checksum',d.checksum)) FROM public.kb_documents d WHERE d.workspace_id=e.workspace_id AND d.checksum IS NOT NULL AND d.work_program_report_id IS NULL),'[]'),
 'baselines',coalesce((SELECT jsonb_agg(to_jsonb(b)||CASE WHEN b.approved_at>p_cutoff THEN jsonb_build_object('state','proposed','approved_at',NULL,'approval_evidence','') ELSE '{}'::jsonb END ORDER BY b.version) FROM public.contract_baselines b WHERE b.engagement_id=e.id AND b.created_at<=p_cutoff),'[]'),
 'actuals',coalesce((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('amount',v.amount::text,'hours',v.hours::text,'shared_source_stale',public.contract_shared_source_stale(v,p_cutoff)) ORDER BY v.created_at,v.version) FROM public.contract_actual_versions v WHERE v.engagement_id=e.id AND v.created_at<=p_cutoff),'[]'),
 'owpSources',CASE WHEN actor_role IN ('owner','admin','pm','finance') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'category',v.kind,'timeEntryId',v.time_entry_id,'spendEntryId',v.spend_entry_id,'staffId',v.staff_id,'hours',v.hours::text,'amount',v.amount::text,'entryDate',v.entry_date,'status',v.status,'sourceKey',v.source_key,'sourceReference',coalesce(v.detail->>'sourceReference',''),'description',coalesce(v.detail->>'description',''),'billable',coalesce((v.detail->>'billable')::boolean,false)) ORDER BY v.entry_date,v.id) FROM public.work_program_actual_versions v WHERE v.workspace_id=e.workspace_id AND v.created_at<=p_cutoff AND v.kind IN ('labor','expense') AND NOT EXISTS(SELECT 1 FROM public.work_program_actual_versions n WHERE n.entry_id=v.entry_id AND n.version>v.version AND n.created_at<=p_cutoff) AND (EXISTS(SELECT 1 FROM public.invoicing_time_entries t WHERE t.id=v.time_entry_id AND t.engagement_id=e.id) OR EXISTS(SELECT 1 FROM public.project_spend_entries s WHERE s.id=v.spend_entry_id AND s.project_id=e.project_id))),'[]') ELSE '[]'::jsonb END,
 'rates',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('hourly_rate',r.hourly_rate::text)) FROM public.contract_rates r WHERE r.engagement_id=e.id AND r.created_at<=p_cutoff),'[]'),
 'estimates',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM public.contract_estimates x WHERE x.engagement_id=e.id AND x.created_at<=p_cutoff),'[]'),
 'billingSources',coalesce((SELECT jsonb_agg(to_jsonb(bs)) FROM public.contract_billing_sources bs WHERE bs.engagement_id=e.id AND bs.created_at<=p_cutoff),'[]'),
 'invoices',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'status',i.status,'subtotal_amount',i.subtotal_amount::text,'retention_amount',i.retention_amount::text,'currency_code',i.currency_code,'invoice_date',i.invoice_date,'sent_date',i.sent_date,'updated_at',i.updated_at)) FROM public.client_invoices i WHERE i.engagement_id=e.id AND i.created_at<=p_cutoff),'[]'),
 'unmappedTime',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'hours',t.hours::text,'entry_date',t.entry_date,'staff_id',t.staff_id,'notes',t.notes,'billable',t.billable)) FROM public.invoicing_time_entries t WHERE t.engagement_id=e.id AND t.created_at<=p_cutoff AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.time_entry_id=t.id AND v.created_at<=p_cutoff)),'[]'),
 'unmappedSpend',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'amount',s.amount::text,'entry_date',s.entry_date,'description',s.description)) FROM public.project_spend_entries s WHERE s.project_id=e.project_id AND s.created_at<=p_cutoff AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.spend_entry_id=s.id AND v.created_at<=p_cutoff)),'[]'),
 'cutoffConflicts',EXISTS(SELECT 1 FROM public.client_invoices i WHERE i.engagement_id=e.id AND i.created_at<=p_cutoff AND i.updated_at>p_cutoff) OR
 EXISTS(SELECT 1 FROM public.invoicing_time_entries t WHERE t.engagement_id=e.id AND t.created_at<=p_cutoff AND t.updated_at>p_cutoff AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.time_entry_id=t.id AND v.created_at<=p_cutoff)) OR
 EXISTS(SELECT 1 FROM public.project_spend_entries x WHERE x.project_id=e.project_id AND x.created_at<=p_cutoff AND x.updated_at>p_cutoff AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.spend_entry_id=x.id AND v.created_at<=p_cutoff)) OR
 EXISTS(SELECT 1 FROM public.contract_source_deletions d WHERE d.workspace_id=e.workspace_id AND (d.engagement_id=e.id OR d.project_id=e.project_id) AND d.source_created_at<=p_cutoff AND d.deleted_at>p_cutoff),
 'imports',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'filename',i.filename,'source_hash',i.source_hash,'created_at',i.created_at) ORDER BY i.created_at) FROM public.contract_imports i WHERE i.engagement_id=e.id AND i.created_at<=p_cutoff),'[]'),
 'snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'created_at',s.created_at,'snapshot_hash',s.snapshot_hash) ORDER BY s.created_at DESC) FROM public.contract_snapshots s WHERE s.engagement_id=e.id),'[]'));
 IF actor_role IN ('member','consultant') THEN
  -- Members see their original input, never its payroll valuation, invoices or management budgets.
  result:=result||jsonb_build_object('cutoffConflicts',false,'imports','[]'::jsonb,'rates','[]'::jsonb,'estimates','[]'::jsonb,'invoices','[]'::jsonb,'billingSources','[]'::jsonb,'unmappedSpend','[]'::jsonb,'snapshots','[]'::jsonb,'documents','[]'::jsonb,
   'baselines',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'version',b.version,'state',b.state,'content',jsonb_build_object('title',b.content->'title','scope',b.content->'scope','currency',b.content->'currency','tasks',(SELECT jsonb_agg(t-'cost'-'fee'-'hours'-'staff') FROM jsonb_array_elements(b.content->'tasks') t))) ORDER BY b.version) FROM public.contract_baselines b WHERE b.engagement_id=e.id AND b.state='approved' AND b.created_at<=p_cutoff),'[]'),
   'actuals',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'entry_id',v.entry_id,'version',v.version,'created_at',v.created_at,'hours',v.hours::text,'time_entry_id',v.time_entry_id,'spend_entry_id',NULL,'command',(SELECT own.command FROM public.contract_actual_versions own WHERE own.entry_id=v.entry_id AND own.created_by=p_actor_id AND own.version<=v.version ORDER BY own.version DESC LIMIT 1)-'amount'-'rateId'-'valuationBasis'||jsonb_build_object('amount',NULL,'rateId',NULL,'valuationBasis','unvalued','status',v.command->>'status','hours',v.hours::text),'amount',NULL,'allocations','[]'::jsonb) ORDER BY v.version) FROM public.contract_actual_versions v JOIN public.invoicing_staff s ON s.id=(v.command->>'staffId')::uuid WHERE v.engagement_id=e.id AND s.user_id=p_actor_id AND EXISTS(SELECT 1 FROM public.contract_actual_versions own WHERE own.entry_id=v.entry_id AND own.created_by=p_actor_id AND own.version<=v.version) AND v.created_at<=p_cutoff),'[]'),
   'unmappedTime',coalesce((SELECT jsonb_agg(t) FROM jsonb_array_elements(result->'unmappedTime') t WHERE EXISTS(SELECT 1 FROM public.invoicing_staff s WHERE s.id=(t->>'staff_id')::uuid AND s.user_id=p_actor_id)),'[]'));
 END IF;
 IF actor_role='pm' THEN
  result:=result||jsonb_build_object('rates','[]'::jsonb,'imports','[]'::jsonb,'snapshots','[]'::jsonb,'documents',coalesce((SELECT jsonb_agg(d) FROM jsonb_array_elements(result->'documents') d WHERE EXISTS(SELECT 1 FROM public.contract_baselines b CROSS JOIN LATERAL jsonb_array_elements(b.content->'sourceDocuments') src WHERE b.engagement_id=e.id AND src#>>'{}'=d->>'id')),'[]'));
 END IF;
 IF actor_role='consultant' THEN
  result:=result||jsonb_build_object('engagement',jsonb_build_object('id',e.id,'workspace_id',e.workspace_id,'project_id',e.project_id,'title',e.title,'parent_engagement_id',NULL,'engagement_kind',e.engagement_kind),'staff','[]'::jsonb,'actuals','[]'::jsonb,'unmappedTime','[]'::jsonb);
 END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.read_contract_delivery(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; actor_role text; staff_ids uuid[]; manager boolean; schedules jsonb; updates jsonb; capacities jsonb; outside jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);manager:=actor_role IN ('owner','admin','pm','finance');
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin','pm','finance','member') THEN RAISE EXCEPTION 'Contract delivery access denied' USING ERRCODE='42501'; END IF;
 SELECT array_agg(DISTINCT a.staff_id) INTO staff_ids FROM public.contract_task_assignments a JOIN public.invoicing_staff s ON s.id=a.staff_id WHERE a.engagement_id=e.id AND (manager OR s.user_id=p_actor_id);
 IF manager THEN
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.version),'[]') INTO schedules FROM public.contract_schedules s WHERE s.engagement_id=e.id AND s.created_at<=p_cutoff;
 ELSE
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'created_at',s.created_at,'content',jsonb_build_object(
   'updateDueOn',s.content->'updateDueOn','assumptions',s.content->'assumptions','billingTreatment','unassessed','billingSourceId',NULL,'billingEvidence','',
   'nodes',coalesce((SELECT jsonb_agg(n||jsonb_build_object('staff',coalesce((SELECT jsonb_agg(person) FROM jsonb_array_elements(n->'staff') person WHERE (person->>'staffId')::uuid=ANY(staff_ids)),'[]')))
    FROM jsonb_array_elements(s.content->'nodes') n WHERE EXISTS(SELECT 1 FROM public.contract_task_assignments a WHERE a.engagement_id=e.id AND a.task_id=(n->>'taskId')::uuid AND a.staff_id=ANY(staff_ids))),'[]')
  )) ORDER BY s.version),'[]') INTO schedules FROM public.contract_schedules s WHERE s.engagement_id=e.id AND s.created_at<=p_cutoff;
 END IF;
 SELECT coalesce(jsonb_agg(CASE WHEN manager THEN to_jsonb(u)||jsonb_build_object('remaining_cost',u.remaining_cost::text,'remaining_gross_billing',u.remaining_gross_billing::text) ELSE to_jsonb(u)-'remaining_cost'-'remaining_gross_billing'-'valuation_evidence' END ORDER BY u.task_id,u.staff_id,u.version),'[]') INTO updates FROM public.contract_work_updates u WHERE u.engagement_id=e.id AND u.created_at<=p_cutoff AND (manager OR u.staff_id=ANY(staff_ids));
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'version',c.version,'staff_id',c.staff_id,'created_at',c.created_at,'content',CASE WHEN c.engagement_id=e.id THEN c.content ELSE c.content||jsonb_build_object('evidence','Shared staff availability; private assignment details withheld') END) ORDER BY c.staff_id,c.version),'[]') INTO capacities FROM public.contract_capacity_versions c WHERE c.workspace_id=e.workspace_id AND c.created_at<=p_cutoff AND c.staff_id=ANY(staff_ids);
 IF manager THEN
  WITH latest AS (SELECT DISTINCT ON(s.engagement_id) s.content FROM public.contract_schedules s WHERE s.workspace_id=e.workspace_id AND s.created_at<=p_cutoff AND s.engagement_id<>e.id AND EXISTS(SELECT 1 FROM public.invoicing_engagements active_contract WHERE active_contract.id=s.engagement_id AND active_contract.status='active') AND coalesce((SELECT c.state FROM public.contract_closeouts c WHERE c.engagement_id=s.engagement_id AND c.created_at<=p_cutoff ORDER BY c.version DESC LIMIT 1),'reopened')<>'closed' ORDER BY s.engagement_id,s.version DESC),
  reservations AS (SELECT (p->>'staffId')::uuid staff_id,day::date reserved_date,(p->>'hoursPerDay')::numeric hours
   FROM latest CROSS JOIN LATERAL jsonb_array_elements(content->'nodes') n CROSS JOIN LATERAL jsonb_array_elements(n->'staff') p
   CROSS JOIN LATERAL generate_series((n->>'notBefore')::date,least((n->>'reserveThrough')::date,(n->>'notBefore')::date+730),'1 day') day
   WHERE (p->>'staffId')::uuid=ANY(staff_ids)
    AND coalesce((SELECT (x->>'working')::boolean FROM jsonb_array_elements(n->'calendar'->'exceptions') x WHERE x->>'date'=day::date::text LIMIT 1),(n->'calendar'->'weekdays') @> to_jsonb(extract(dow FROM day)::integer)))
  SELECT coalesce(jsonb_agg(jsonb_build_object('staffId',staff_id,'date',reserved_date,'hours',hours::text) ORDER BY staff_id,reserved_date),'[]') INTO outside FROM (SELECT staff_id,reserved_date,sum(hours) hours FROM reservations GROUP BY staff_id,reserved_date) aggregated;
 END IF;
 RETURN jsonb_build_object('assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('taskId',a.task_id,'staffId',a.staff_id)) FROM public.contract_task_assignments a WHERE a.engagement_id=e.id AND a.active AND (manager OR a.staff_id=ANY(staff_ids))),'[]'),'scheduleVersions',schedules,'workUpdates',updates,'capacityVersions',capacities,'outsideReservations',coalesce(outside,'[]'),'inputHash',CASE WHEN manager THEN public.contract_delivery_hash(e.workspace_id) ELSE '' END,'forecasts',CASE WHEN manager THEN coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.version) FROM public.contract_forecasts f WHERE f.engagement_id=e.id AND f.created_at<=p_cutoff),'[]') ELSE '[]'::jsonb END);
END $$;
CREATE OR REPLACE FUNCTION public.contract_delivery_hash(p_workspace_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT encode(extensions.digest(coalesce(string_agg(x,'|' ORDER BY x),''),'sha256'),'hex') FROM (
 SELECT 'method:contract-delivery-v2' x
 UNION ALL SELECT 'assignment:'||to_jsonb(a)::text FROM public.contract_task_assignments a WHERE a.workspace_id=p_workspace_id
 UNION ALL SELECT 'engagement:'||id||':'||status FROM public.invoicing_engagements WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'closeout:'||id||':'||state FROM public.contract_closeouts WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'schedule:'||id::text x FROM public.contract_schedules WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'capacity:'||id FROM public.contract_capacity_versions WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'work:'||id FROM public.contract_work_updates WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'baseline:'||id||':'||state FROM public.contract_baselines WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'actual:'||id FROM public.contract_actual_versions WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'staff:'||id||':'||active||':'||coalesce(user_id::text,'') FROM public.invoicing_staff WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'member:'||user_id||':'||role FROM public.workspace_members WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'time:'||to_jsonb(t)::text FROM public.invoicing_time_entries t WHERE t.workspace_id=p_workspace_id
 UNION ALL SELECT 'spend:'||to_jsonb(s)::text FROM public.project_spend_entries s JOIN public.projects p ON p.id=s.project_id WHERE p.workspace_id=p_workspace_id
 UNION ALL SELECT 'owp:'||id FROM public.work_program_actual_versions WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'rate:'||id FROM public.contract_rates WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'invoice:'||id||':'||updated_at FROM public.client_invoices WHERE workspace_id=p_workspace_id
 ) versions
$$;
