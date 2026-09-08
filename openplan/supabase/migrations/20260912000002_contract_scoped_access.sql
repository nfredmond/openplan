CREATE TABLE public.contract_access_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), user_id uuid NOT NULL REFERENCES auth.users(id),
 version integer NOT NULL CHECK(version>0), role text NOT NULL CHECK(role IN ('pm','finance','consultant')),
 active boolean NOT NULL, evidence text NOT NULL CHECK(length(trim(evidence))>0),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(engagement_id,user_id,version)
);
ALTER TABLE public.contract_access_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_access_versions FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_access_versions TO authenticated,service_role;
CREATE POLICY management_read ON public.contract_access_versions FOR SELECT TO authenticated USING(user_id=auth.uid() OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=contract_access_versions.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE TRIGGER immutable_contract_access BEFORE UPDATE OR DELETE ON public.contract_access_versions FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();

-- External consultants have a contract grant and no agency workspace membership.
-- Internal PM/finance grants cease to apply when workspace membership ends.
CREATE FUNCTION public.contract_actor_role(p_engagement_id uuid,p_actor_id uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_role text; grant_row public.contract_access_versions;
BEGIN
 SELECT m.role INTO member_role FROM public.workspace_members m JOIN public.invoicing_engagements e ON e.workspace_id=m.workspace_id WHERE e.id=p_engagement_id AND m.user_id=p_actor_id;
 IF member_role IN ('owner','admin') THEN RETURN member_role; END IF;
 SELECT * INTO grant_row FROM public.contract_access_versions WHERE engagement_id=p_engagement_id AND user_id=p_actor_id ORDER BY version DESC LIMIT 1;
 IF grant_row.active THEN
  IF grant_row.role='consultant' AND member_role IS NULL THEN RETURN 'consultant'; END IF;
  IF grant_row.role IN ('pm','finance') AND member_role='member' THEN RETURN grant_row.role; END IF;
 END IF;
 RETURN member_role;
END $$;
REVOKE ALL ON FUNCTION public.contract_actor_role(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.contract_can_manage(p_engagement_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT coalesce(public.contract_actor_role(p_engagement_id,auth.uid()) IN ('owner','admin','finance','pm'),false) $$;
CREATE FUNCTION public.contract_can_finance(p_engagement_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT coalesce(public.contract_actor_role(p_engagement_id,auth.uid()) IN ('owner','admin','finance'),false) $$;
REVOKE ALL ON FUNCTION public.contract_can_manage(uuid),public.contract_can_finance(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contract_can_manage(uuid),public.contract_can_finance(uuid) TO authenticated,service_role;

ALTER POLICY management_read ON public.contract_baselines USING(public.contract_can_manage(engagement_id));
ALTER POLICY management_read ON public.contract_actual_versions USING(public.contract_can_manage(engagement_id));
ALTER POLICY management_read ON public.contract_estimates USING(public.contract_can_manage(engagement_id));
ALTER POLICY management_read ON public.contract_tasks USING(public.contract_can_manage(engagement_id));
ALTER POLICY management_read ON public.contract_rates USING(public.contract_can_finance(engagement_id));
ALTER POLICY management_read ON public.contract_master_terms USING(public.contract_can_manage(engagement_id));
-- Raw payroll intake and reports containing private rate records remain finance-only.
ALTER POLICY private_management_import ON public.contract_imports USING(public.contract_can_finance(engagement_id));

CREATE OR REPLACE FUNCTION public.read_contract_management_v046(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; actor_role text; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF e.id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('owner','admin','member','pm','finance','consultant') THEN RAISE EXCEPTION 'Contract access denied' USING ERRCODE='42501'; END IF;
 result:=jsonb_build_object('engagement',to_jsonb(e),'role',actor_role,
 'staff',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'active',s.active,'user_id',s.user_id) ORDER BY s.name) FROM public.invoicing_staff s WHERE s.workspace_id=e.workspace_id AND (actor_role IN ('owner','admin','finance') OR (actor_role='pm' AND (EXISTS(SELECT 1 FROM public.contract_task_assignments a WHERE a.engagement_id=e.id AND a.staff_id=s.id) OR EXISTS(SELECT 1 FROM public.contract_actual_versions a WHERE a.engagement_id=e.id AND a.command->>'staffId'=s.id::text))) OR s.user_id=p_actor_id)),'[]'),
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

CREATE OR REPLACE FUNCTION public.record_contract_command_v046(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
<<contract_command>>
DECLARE e public.invoicing_engagements; actor_role text; cached public.contract_commands; b public.contract_baselines; old public.contract_actual_versions; saved public.contract_actual_versions;
 s public.invoicing_staff; rate public.contract_rates; t public.invoicing_time_entries; spend public.project_spend_entries; ov public.work_program_actual_versions;
 k text:=p_command->>'kind'; req uuid:=(p_command->>'requestId')::uuid; result jsonb; content jsonb; task jsonb; allocation jsonb; person jsonb;
 next_version integer; entry uuid:=(p_command->>'entryId')::uuid; task_id uuid; money numeric; h numeric; total_share integer:=0; ix integer:=0; allocated numeric:=0; allocated_hours numeric:=0;
 part numeric; ph numeric; parts jsonb:='[]'; tid uuid; sid uuid; dt date; category text; st text; basis text; report jsonb; report_id uuid; cutoff timestamptz; asof date;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id FOR UPDATE;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF e.id IS NULL OR e.project_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('owner','admin','member','pm','finance') THEN RAISE EXCEPTION 'Select a project-linked contract in your workspace' USING ERRCODE='42501'; END IF;
 -- Shared with OWP source commands: one physical time/spend identity cannot race across workflows.
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 IF req IS NULL OR octet_length(p_command::text)>2000000 OR k IS NULL OR k NOT IN ('baseline','approve','actual','rate','estimate','snapshot','bill') THEN RAISE EXCEPTION 'Invalid contract command' USING ERRCODE='22023'; END IF;
 IF actor_role='pm' AND (k NOT IN ('baseline','estimate','actual') OR (k='actual' AND (p_command->>'status' IS DISTINCT FROM 'draft' OR p_command->>'valuationBasis'='cost_rate'))) THEN RAISE EXCEPTION 'Finance approval required for financial decisions and private rates' USING ERRCODE='42501'; END IF;
 IF actor_role='member' AND k<>'actual' THEN RAISE EXCEPTION 'Owner or admin required for management commands' USING ERRCODE='42501'; END IF;
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Request identity reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 IF k='baseline' THEN
  SELECT coalesce(max(version),0) INTO next_version FROM public.contract_baselines WHERE engagement_id=e.id;
  IF next_version IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Baseline changed; reload before saving' USING ERRCODE='PT409'; END IF;
  content:=p_command->'content';
  IF jsonb_typeof(content->'tasks') IS DISTINCT FROM 'array' OR jsonb_array_length(content->'tasks') NOT BETWEEN 1 AND 1000 OR coalesce(length(trim(content->>'scope')),0)=0 OR content->>'currency' !~ '^[A-Z]{3}$' OR content->>'feeBasis' NOT IN ('gross_fee','unassessed') OR (content->>'feeBasis'='gross_fee' AND coalesce(length(trim(content->>'feeTerms')),0)=0) THEN RAISE EXCEPTION 'Complete scope, currency and fee terms required' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(content->'sourceDocuments') IS DISTINCT FROM 'array' OR jsonb_array_length(content->'sourceDocuments')=0 THEN RAISE EXCEPTION 'Retain the source agreement in Documents' USING ERRCODE='22023'; END IF;
  FOR person IN SELECT value FROM jsonb_array_elements(content->'sourceDocuments') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.kb_documents d WHERE d.id=(person#>>'{}')::uuid AND d.workspace_id=e.workspace_id AND d.checksum IS NOT NULL) THEN RAISE EXCEPTION 'Agreement source document is unavailable' USING ERRCODE='42501'; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT q->>'id') FROM jsonb_array_elements(content->'tasks') q) THEN RAISE EXCEPTION 'Duplicate task identity' USING ERRCODE='22023'; END IF;
  FOR task IN SELECT value FROM jsonb_array_elements(content->'tasks') LOOP
   task_id:=(task->>'id')::uuid;
   IF task_id IS NULL OR coalesce(length(trim(task->>'title')),0)=0 OR EXISTS(SELECT 1 FROM public.contract_tasks t WHERE t.id=task_id AND t.engagement_id<>e.id) OR (task->>'deliverableId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.project_deliverables d WHERE d.id=(task->>'deliverableId')::uuid AND d.project_id=e.project_id)) THEN RAISE EXCEPTION 'Task and deliverable must belong to this contract project' USING ERRCODE='42501'; END IF;
   IF jsonb_typeof(task->'staff') IS DISTINCT FROM 'array' OR (SELECT count(*)<>count(DISTINCT q->>'staffId') FROM jsonb_array_elements(task->'staff') q) THEN RAISE EXCEPTION 'Unique staff allocations required' USING ERRCODE='22023'; END IF;
   FOR person IN SELECT value FROM jsonb_array_elements(task->'staff') LOOP
    IF NOT EXISTS(SELECT 1 FROM public.invoicing_staff s WHERE s.id=(person->>'staffId')::uuid AND s.workspace_id=e.workspace_id) THEN RAISE EXCEPTION 'Foreign task staff' USING ERRCODE='42501'; END IF;
   END LOOP;
   INSERT INTO public.contract_tasks(id,engagement_id,workspace_id,project_id,title,deliverable_id,deadline) VALUES(task_id,e.id,e.workspace_id,e.project_id,task->>'title',(task->>'deliverableId')::uuid,(task->>'deadline')::date) ON CONFLICT(id) DO NOTHING;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.contract_baselines prior WHERE prior.engagement_id=e.id AND prior.content->>'currency' IS DISTINCT FROM contract_command.content->>'currency') THEN RAISE EXCEPTION 'Retained contract currency cannot change; create a separately reconciled agreement' USING ERRCODE='22023'; END IF;
  -- Validate all explicit budgets as exact nonnegative decimals, including staff allocations.
  FOR person IN SELECT content UNION ALL SELECT value FROM jsonb_array_elements(content->'tasks') UNION ALL SELECT p FROM jsonb_array_elements(content->'tasks') t CROSS JOIN LATERAL jsonb_array_elements(t->'staff') p LOOP
   IF EXISTS(SELECT 1 FROM jsonb_each_text(person) x WHERE x.key IN ('fee','cost','hours') AND x.value IS NOT NULL AND x.value !~ '^\d{1,12}(\.\d{1,2})?$') THEN RAISE EXCEPTION 'Budgets require exact nonnegative amounts' USING ERRCODE='22023'; END IF;
  END LOOP;
  INSERT INTO public.contract_baselines(id,engagement_id,workspace_id,version,state,content,content_hash,created_by) VALUES((p_command->>'baselineId')::uuid,e.id,e.workspace_id,next_version+1,'proposed',content,encode(extensions.digest(content::text,'sha256'),'hex'),p_actor_id) RETURNING * INTO b;
  result:=jsonb_build_object('baselineId',b.id,'version',b.version);
 ELSIF k='approve' THEN
  SELECT * INTO b FROM public.contract_baselines WHERE id=(p_command->>'baselineId')::uuid AND engagement_id=e.id FOR UPDATE;
  IF b.id IS NULL OR b.state<>'proposed' OR b.version IS DISTINCT FROM (p_command->>'expectedVersion')::integer OR b.version<>(SELECT max(version) FROM public.contract_baselines WHERE engagement_id=e.id) THEN RAISE EXCEPTION 'Approve the current unchanged proposal' USING ERRCODE='PT409'; END IF;
  IF coalesce(length(trim(p_command->>'approvalEvidence')),0)=0 THEN RAISE EXCEPTION 'Record actual approval evidence' USING ERRCODE='22023'; END IF;
  PERFORM public.validate_contract_budget(b.content);
  UPDATE public.contract_baselines SET state='approved',approval_evidence=p_command->>'approvalEvidence',approved_at=now() WHERE id=b.id;
  UPDATE public.contract_tasks SET active=false WHERE engagement_id=e.id;
  FOR task IN SELECT value FROM jsonb_array_elements(b.content->'tasks') LOOP
   UPDATE public.contract_tasks SET active=true,title=task->>'title',deliverable_id=(task->>'deliverableId')::uuid,deadline=(task->>'deadline')::date,
    assignee_user_id=(SELECT user_id FROM public.invoicing_staff WHERE id=(task->'staff'->0->>'staffId')::uuid) WHERE id=(task->>'id')::uuid;
  END LOOP;
  result:=jsonb_build_object('baselineId',b.id,'version',b.version);
 ELSIF k='rate' THEN
  SELECT * INTO s FROM public.invoicing_staff WHERE id=(p_command->>'staffId')::uuid AND workspace_id=e.workspace_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Foreign staff rate' USING ERRCODE='42501'; END IF;
  IF p_command->>'hourlyRate' IS NULL OR p_command->>'hourlyRate' !~ '^\d{1,12}(\.\d{1,2})?$' OR coalesce(length(trim(p_command->>'sourceReference')),0)=0 THEN RAISE EXCEPTION 'Exact rate and evidence required' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.contract_rates r WHERE r.engagement_id=e.id AND r.staff_id=s.id AND r.basis=p_command->>'basis' AND daterange(r.starts_on,r.ends_on,'[]') && daterange((p_command->>'startsOn')::date,(p_command->>'endsOn')::date,'[]')) THEN RAISE EXCEPTION 'Rate periods overlap; retain the old rate and choose a nonoverlapping period' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_rates(id,engagement_id,workspace_id,staff_id,basis,starts_on,ends_on,hourly_rate,source_reference,created_by) VALUES((p_command->>'rateId')::uuid,e.id,e.workspace_id,s.id,p_command->>'basis',(p_command->>'startsOn')::date,(p_command->>'endsOn')::date,(p_command->>'hourlyRate')::numeric,p_command->>'sourceReference',p_actor_id);
  result:=jsonb_build_object('rateId',p_command->>'rateId');
 ELSIF k='actual' THEN
  dt:=(p_command->>'entryDate')::date; category:=p_command->>'category'; st:=p_command->>'status'; basis:=p_command->>'valuationBasis';
  IF entry IS NULL OR dt IS NULL OR category IS NULL OR category NOT IN ('labor','expense','opening','commitment','payment','credit') OR st IS NULL OR st NOT IN ('draft','approved','excluded') OR basis IS NULL OR basis NOT IN ('recorded','cost_rate','unvalued') OR coalesce(length(trim(p_command->>'sourceKey')),0)=0 OR coalesce(length(trim(p_command->>'sourceReference')),0)=0 OR coalesce(length(trim(p_command->>'description')),0)=0 THEN RAISE EXCEPTION 'Complete source identity and actual meaning required' USING ERRCODE='22023'; END IF;
  SELECT * INTO old FROM public.contract_actual_versions WHERE entry_id=entry ORDER BY version DESC LIMIT 1;
  IF old.id IS NOT NULL AND old.engagement_id<>e.id THEN RAISE EXCEPTION 'Foreign actual identity' USING ERRCODE='42501'; END IF;
  IF coalesce(old.version,0) IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Actual changed; reload before correcting' USING ERRCODE='PT409'; END IF;
  IF old.id IS NOT NULL AND (coalesce(length(trim(p_command->>'correctionNote')),0)=0 OR (old.command->>'sourceKey',old.command->>'category',old.command->>'staffId') IS DISTINCT FROM (p_command->>'sourceKey',category,p_command->>'staffId')) THEN RAISE EXCEPTION 'Corrections require a reason and unchanged source identity' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.workspace_id=e.workspace_id AND v.source_key=p_command->>'sourceKey' AND v.entry_id<>entry) THEN RAISE EXCEPTION 'Source already recorded; correct the existing entry' USING ERRCODE='PT409'; END IF;
  SELECT * INTO s FROM public.invoicing_staff WHERE id=(p_command->>'staffId')::uuid AND workspace_id=e.workspace_id;
  IF (category='labor' OR p_command->>'staffId' IS NOT NULL) AND s.id IS NULL THEN RAISE EXCEPTION 'Foreign staff attribution' USING ERRCODE='42501'; END IF;
  IF actor_role='member' AND (category<>'labor' OR s.user_id IS DISTINCT FROM p_actor_id OR NOT s.active OR st<>'draft' OR basis<>'unvalued' OR p_command->>'amount' IS NOT NULL OR old.command->>'status' IN ('approved','excluded') OR (old.id IS NOT NULL AND old.created_by<>p_actor_id) OR p_command->>'owpVersionId' IS NOT NULL) THEN RAISE EXCEPTION 'Members may enter and correct only their own draft time' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(p_command) x WHERE x.key IN ('amount','hours') AND x.value IS NOT NULL AND x.value !~ '^\d{1,12}(\.\d{1,2})?$') THEN RAISE EXCEPTION 'Exact nonnegative actual amounts required' USING ERRCODE='22023'; END IF;
  money:=(p_command->>'amount')::numeric; h:=(p_command->>'hours')::numeric;
  IF category='labor' AND (h IS NULL OR h<=0 OR h>24) THEN RAISE EXCEPTION 'Daily labor requires hours greater than zero and at most 24' USING ERRCODE='22023'; END IF;
  IF category='opening' AND (coalesce(length(trim(p_command->>'openingBasis')),0)=0 OR (p_command->>'openingStart')::date IS NULL OR (p_command->>'openingEnd')::date IS NULL OR (p_command->>'openingEnd')::date<(p_command->>'openingStart')::date OR (p_command->>'openingEnd')::date>dt) THEN RAISE EXCEPTION 'Document opening coverage and accounting basis' USING ERRCODE='22023'; END IF;
  IF category IN ('payment','credit') AND (p_command->>'invoiceId' IS NULL OR NOT EXISTS(SELECT 1 FROM public.client_invoices i WHERE i.id=(p_command->>'invoiceId')::uuid AND i.engagement_id=e.id AND i.status IN ('sent','paid'))) THEN RAISE EXCEPTION 'Link documented cash or credit to an issued contract invoice' USING ERRCODE='22023'; END IF;
  IF category IN ('payment','credit') AND EXISTS(SELECT 1 FROM public.client_invoices i WHERE i.id=(p_command->>'invoiceId')::uuid AND (i.invoice_date IS NULL OR i.sent_date IS NULL OR dt<greatest(i.invoice_date,i.sent_date))) THEN RAISE EXCEPTION 'Document invoice issue dates before reconciling cash or credits; an event cannot precede that invoice' USING ERRCODE='22023'; END IF;
  IF basis='cost_rate' THEN
   SELECT * INTO rate FROM public.contract_rates WHERE id=(p_command->>'rateId')::uuid AND engagement_id=e.id AND staff_id=s.id AND basis='cost' AND dt BETWEEN starts_on AND ends_on;
   IF category<>'labor' OR rate.id IS NULL THEN RAISE EXCEPTION 'Approved effective cost rate required' USING ERRCODE='22023'; END IF;
   money:=round(h*rate.hourly_rate,2);
  ELSIF basis='unvalued' THEN money:=NULL; END IF;
  IF st='approved' AND money IS NULL THEN RAISE EXCEPTION 'Review valuation before approval' USING ERRCODE='22023'; END IF;
  IF st='excluded' AND coalesce(length(trim(p_command->>'correctionNote')),0)=0 THEN RAISE EXCEPTION 'Explain the exclusion' USING ERRCODE='22023'; END IF;
  SELECT * INTO b FROM public.contract_baselines WHERE engagement_id=e.id AND state='approved' ORDER BY version DESC LIMIT 1;
  IF jsonb_typeof(p_command->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'allocations')>100 THEN RAISE EXCEPTION 'Allocation list required' USING ERRCODE='22023'; END IF;
  FOR allocation IN SELECT value FROM jsonb_array_elements(p_command->'allocations') LOOP
   SELECT value INTO task FROM jsonb_array_elements(b.content->'tasks') q WHERE q->>'id'=allocation->>'taskId';
   IF task IS NULL OR (allocation->>'deliverableId') IS DISTINCT FROM (task->>'deliverableId') THEN RAISE EXCEPTION 'Allocate to an approved task and its agreed deliverable' USING ERRCODE='42501'; END IF;
   IF (allocation->>'share')::integer IS NULL OR (allocation->>'share')::integer<=0 OR (allocation->>'share')::integer>10000 THEN RAISE EXCEPTION 'Allocation share requires positive basis points' USING ERRCODE='22023'; END IF;
   total_share:=total_share+(allocation->>'share')::integer;
  END LOOP;
  IF total_share NOT IN (0,10000) OR (st='approved' AND total_share<>10000) THEN RAISE EXCEPTION 'Approved allocations must total 100 percent' USING ERRCODE='22023'; END IF;
  tid:=coalesce(old.time_entry_id,(p_command->>'timeEntryId')::uuid); sid:=coalesce(old.spend_entry_id,(p_command->>'spendEntryId')::uuid);
  IF tid IS NOT NULL THEN
   SELECT * INTO t FROM public.invoicing_time_entries WHERE id=tid FOR UPDATE;
   IF t.id IS NULL OR t.engagement_id IS DISTINCT FROM e.id OR t.staff_id IS DISTINCT FROM s.id OR category<>'labor' OR (old.id IS NULL AND (t.hours<>h OR t.entry_date<>dt)) OR (actor_role='member' AND t.billed_line_item_id IS NOT NULL) THEN RAISE EXCEPTION 'Time source does not match this contract actual' USING ERRCODE='42501'; END IF;
  END IF;
  IF sid IS NOT NULL THEN
   SELECT * INTO spend FROM public.project_spend_entries WHERE id=sid FOR UPDATE;
   IF spend.id IS NULL OR spend.project_id<>e.project_id OR category<>'expense' OR (old.id IS NULL AND (spend.amount IS DISTINCT FROM money OR spend.entry_date<>dt)) THEN RAISE EXCEPTION 'Spending source does not match this contract actual' USING ERRCODE='42501'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.entry_id<>entry AND ((tid IS NOT NULL AND v.time_entry_id=tid) OR (sid IS NOT NULL AND v.spend_entry_id=sid))) THEN RAISE EXCEPTION 'Physical source already allocated to a contract actual' USING ERRCODE='PT409'; END IF;
  IF t.work_program_id IS NOT NULL OR spend.work_program_id IS NOT NULL OR p_command->>'owpVersionId' IS NOT NULL THEN
   SELECT * INTO ov FROM public.work_program_actual_versions WHERE id=(p_command->>'owpVersionId')::uuid AND workspace_id=e.workspace_id;
   IF (SELECT r.content_json->>'currency' FROM public.program_work_program_revisions r WHERE r.id=ov.revision_id) IS DISTINCT FROM b.content->>'currency' THEN RAISE EXCEPTION 'Shared OWP and contract valuations require the same documented currency; no conversion is inferred' USING ERRCODE='22023'; END IF;
   IF ov.id IS NULL OR (ov.time_entry_id IS DISTINCT FROM tid OR ov.spend_entry_id IS DISTINCT FROM sid) OR ov.amount IS DISTINCT FROM money OR ov.hours IS DISTINCT FROM h OR ov.entry_date<>dt OR ov.status IS DISTINCT FROM st OR EXISTS(SELECT 1 FROM public.work_program_actual_versions n WHERE n.entry_id=ov.entry_id AND n.version>ov.version) THEN RAISE EXCEPTION 'Use the current matching OWP valuation; correct shared sources in OWP first' USING ERRCODE='22023'; END IF;
  END IF;
  IF st='approved' AND category='labor' AND coalesce(length(trim(p_command->>'reconciliationNote')),0)=0 AND (
   EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.workspace_id=e.workspace_id AND v.entry_id<>entry AND v.command->>'staffId'=s.id::text AND v.command->>'entryDate'=dt::text AND v.command->>'category'='labor' AND v.command->>'status'<>'excluded' AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions n WHERE n.entry_id=v.entry_id AND n.version>v.version)) OR
   EXISTS(SELECT 1 FROM public.work_program_actual_versions v WHERE v.workspace_id=e.workspace_id AND v.staff_id=s.id AND v.entry_date=dt AND v.kind='labor' AND v.status<>'excluded' AND v.time_entry_id IS DISTINCT FROM tid AND NOT EXISTS(SELECT 1 FROM public.work_program_actual_versions n WHERE n.entry_id=v.entry_id AND n.version>v.version)) OR
   EXISTS(SELECT 1 FROM public.invoicing_time_entries x WHERE x.workspace_id=e.workspace_id AND x.staff_id=s.id AND x.entry_date=dt AND x.id IS DISTINCT FROM tid AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.time_entry_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.work_program_actual_versions v WHERE v.time_entry_id=x.id))
  ) THEN RAISE EXCEPTION 'Other time or payroll exists for this staff date; reconcile overlap explicitly before approval' USING ERRCODE='22023'; END IF;
  IF tid IS NULL AND category='labor' THEN
   INSERT INTO public.invoicing_time_entries(workspace_id,staff_id,engagement_id,entry_date,hours,notes,billable,created_by) VALUES(e.workspace_id,s.id,e.id,dt,h,p_command->>'description',(p_command->>'billable')::boolean,p_actor_id) RETURNING id INTO tid;
  END IF;
  IF sid IS NULL AND category='expense' AND money IS NOT NULL THEN
   INSERT INTO public.project_spend_entries(project_id,entry_date,amount,description,created_by) VALUES(e.project_id,dt,money,p_command->>'description',p_actor_id) RETURNING id INTO sid;
  END IF;
  -- Billed and OWP source bytes stay fixed. The contract history carries subsequent valuation corrections.
  IF tid IS NOT NULL AND t.work_program_id IS NULL AND t.billed_line_item_id IS NULL THEN UPDATE public.invoicing_time_entries SET entry_date=dt,hours=h,notes=p_command->>'description',billable=(p_command->>'billable')::boolean WHERE id=tid; END IF;
  IF sid IS NOT NULL AND spend.work_program_id IS NULL THEN UPDATE public.project_spend_entries SET entry_date=dt,amount=money,description=p_command->>'description' WHERE id=sid AND money IS NOT NULL; END IF;
  FOR allocation IN SELECT value FROM jsonb_array_elements(p_command->'allocations') LOOP
   ix:=ix+1; part:=CASE WHEN ix=jsonb_array_length(p_command->'allocations') THEN money-allocated ELSE trunc(money*(allocation->>'share')::numeric/10000,2) END;
   ph:=CASE WHEN ix=jsonb_array_length(p_command->'allocations') THEN h-allocated_hours ELSE trunc(h*(allocation->>'share')::numeric/10000,2) END;
   allocated:=allocated+coalesce(part,0); allocated_hours:=allocated_hours+coalesce(ph,0);
   parts:=parts||jsonb_build_array(allocation||jsonb_build_object('amount',part::text,'hours',ph::text));
  END LOOP;
  INSERT INTO public.contract_actual_versions(entry_id,engagement_id,workspace_id,version,source_key,command,amount,hours,allocations,time_entry_id,spend_entry_id,created_by) VALUES(entry,e.id,e.workspace_id,coalesce(old.version,0)+1,p_command->>'sourceKey',p_command,money,h,parts,tid,sid,p_actor_id) RETURNING * INTO saved;
  result:=jsonb_build_object('entryId',entry,'version',saved.version);
 ELSIF k='estimate' THEN
  task_id:=(p_command->>'taskId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.contract_tasks WHERE id=task_id AND engagement_id=e.id) THEN RAISE EXCEPTION 'Foreign estimate task' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(version),0) INTO next_version FROM public.contract_estimates WHERE contract_estimates.task_id=contract_command.task_id;
  IF next_version IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Estimate changed; reload' USING ERRCODE='PT409'; END IF;
  IF (p_command->>'asOf')::date IS NULL OR coalesce(length(trim(p_command->>'basis')),0)=0 OR (p_command->>'progress')::numeric NOT BETWEEN 0 AND 100 OR EXISTS(SELECT 1 FROM jsonb_each_text(p_command) x WHERE x.key IN ('cost','hours') AND x.value IS NOT NULL AND x.value !~ '^\d{1,12}(\.\d{1,2})?$') THEN RAISE EXCEPTION 'Dated exact estimate and basis required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_estimates(engagement_id,workspace_id,task_id,version,command,created_by) VALUES(e.id,e.workspace_id,task_id,next_version+1,p_command,p_actor_id);
  result:=jsonb_build_object('taskId',task_id,'version',next_version+1);
 ELSIF k='bill' THEN
  result:=public.bill_contract_actuals(e.id,p_actor_id,p_command);
 ELSE
  cutoff:=(p_command->>'sourceCutoff')::timestamptz; asof:=(p_command->>'asOf')::date;
  IF cutoff IS NULL OR cutoff>now() OR asof IS NULL OR coalesce(length(trim(p_command->>'coverageEvidence')),0)=0 THEN RAISE EXCEPTION 'Snapshot requires source cutoff, date and coverage evidence' USING ERRCODE='22023'; END IF;
  SELECT * INTO b FROM public.contract_baselines WHERE engagement_id=e.id AND state='approved' AND approved_at<=cutoff ORDER BY version DESC LIMIT 1;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Approve an evidenced baseline before issuing a management snapshot' USING ERRCODE='22023'; END IF;
  report:=public.read_contract_management(e.id,p_actor_id,cutoff)||jsonb_build_object('baselineId',b.id,'originalBaselineId',(SELECT id FROM public.contract_baselines WHERE engagement_id=e.id AND state='approved' AND approved_at<=cutoff ORDER BY version LIMIT 1),'asOf',asof,'sourceCutoff',cutoff,'coverageComplete',(p_command->>'coverageComplete')::boolean,'coverageEvidence',p_command->>'coverageEvidence');
  IF (report->>'cutoffConflicts')::boolean THEN RAISE EXCEPTION 'Legacy invoice or source changed or was deleted after cutoff; use a current cutoff instead of inferring historical source coverage' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_snapshots(engagement_id,workspace_id,title,snapshot,snapshot_hash,created_by) VALUES(e.id,e.workspace_id,p_command->>'title',report,encode(extensions.digest(report::text,'sha256'),'hex'),p_actor_id) RETURNING id INTO report_id;
  result:=jsonb_build_object('snapshotId',report_id);
 END IF;
 INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.record_contract_command(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; k text:=p_command->>'kind'; req uuid:=(p_command->>'requestId')::uuid;
 target_id uuid; actor_role text; grant_version integer; cached public.contract_commands; terms public.contract_master_terms; d public.kb_documents; v integer; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Contract access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
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
 RETURN result;
END $$;
