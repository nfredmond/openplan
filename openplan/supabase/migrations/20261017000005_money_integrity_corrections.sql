-- Money-integrity corrections for work-program and invoice records.
-- Additive: functions keep their signatures, owners, grants and SECURITY DEFINER
-- settings; no table or column is dropped and no existing row is rewritten.
-- Every rule below applies to new writes only, so rows written before this
-- migration (including any that a rule would now refuse) remain as they are.

-- KI-2026-10-12-002. Approving labor counts unmapped time for the same staff
-- and date as overlap, so the same hours cannot enter the ledger twice
-- without an explicit reconciliation note.
CREATE OR REPLACE FUNCTION public.record_work_program_actual(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE w uuid; actor_role text; cached public.work_program_reporting_commands; old public.work_program_actual_versions; saved public.work_program_actual_versions;
 r public.program_work_program_revisions; rate public.work_program_cost_rates; s public.invoicing_staff; t public.invoicing_time_entries; x public.project_spend_entries;
 eid uuid:=(p_command->>'entryId')::uuid; rid uuid:=(p_command->>'revisionId')::uuid; req uuid:=(p_command->>'requestId')::uuid;
 dt date:=(p_command->>'entryDate')::date; k text:=p_command->>'kind'; st text:=p_command->>'status'; basis text:=p_command->>'basis';
 h numeric:=(p_command->>'hours')::numeric; money numeric:=(p_command->>'amount')::numeric; alloc jsonb; element jsonb; total_share integer:=0; allocated numeric:=0; allocated_hours numeric:=0;
 part numeric; ph numeric; ix integer:=0; tid uuid; xid uuid; result jsonb; project uuid:=(p_command->>'projectId')::uuid;
BEGIN
 SELECT workspace_id INTO w FROM public.programs WHERE id=p_program_id FOR UPDATE;
 SELECT role INTO actor_role FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id;
 IF w IS NULL OR actor_role IS NULL OR actor_role NOT IN ('owner','admin','member') THEN RAISE EXCEPTION 'Actuals access denied' USING ERRCODE='42501'; END IF;
 -- Serialize source identities across programs within the same workspace.
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,451));
 IF req IS NULL OR eid IS NULL OR dt IS NULL OR octet_length(p_command::text)>200000 OR coalesce(length(trim(p_command->>'sourceKey')),0)=0 OR coalesce(length(trim(p_command->>'sourceReference')),0)=0
 OR k IS NULL OR k NOT IN ('labor','expense','opening','commitment','billed','payment') OR st IS NULL OR st NOT IN ('draft','approved','excluded') OR basis IS NULL OR basis NOT IN ('recorded','cost_rate','unvalued')
 THEN RAISE EXCEPTION 'Complete source, date, status and valuation required' USING ERRCODE='22023'; END IF;
 SELECT * INTO cached FROM public.work_program_reporting_commands WHERE program_id=p_program_id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Request identity reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 SELECT * INTO r FROM public.program_work_program_revisions WHERE id=rid AND program_id=p_program_id AND workspace_id=w;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Select a saved work program for attribution' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM public.work_program_actual_versions WHERE entry_id=eid ORDER BY version DESC LIMIT 1;
 IF (old.id IS NOT NULL AND old.program_id<>p_program_id) THEN RAISE EXCEPTION 'Foreign actual' USING ERRCODE='42501'; END IF;
 IF coalesce(old.version,0) IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Actual changed; reload before correcting' USING ERRCODE='PT409'; END IF;
 IF old.id IS NOT NULL AND (old.staff_id IS DISTINCT FROM (p_command->>'staffId')::uuid OR old.detail->>'projectId' IS DISTINCT FROM p_command->>'projectId' OR old.detail->>'contractId' IS DISTINCT FROM p_command->>'contractId') THEN RAISE EXCEPTION 'Corrections must retain staff, project and contract identity; exclude and remap with reviewed source references' USING ERRCODE='22023'; END IF;
 IF st='excluded' AND coalesce(length(trim(p_command->>'correctionNote')),0)=0 THEN RAISE EXCEPTION 'Exclusion requires a documented reason' USING ERRCODE='22023'; END IF;
 IF old.id IS NOT NULL AND (coalesce(length(trim(p_command->>'correctionNote')),0)=0 OR old.source_key<>p_command->>'sourceKey' OR old.kind<>k) THEN RAISE EXCEPTION 'Corrections retain source identity and require a reason' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.work_program_actual_versions v WHERE v.workspace_id=w AND v.source_key=p_command->>'sourceKey' AND v.entry_id<>eid) THEN RAISE EXCEPTION 'Source already recorded; map or correct the existing entry' USING ERRCODE='PT409'; END IF;
 SELECT * INTO s FROM public.invoicing_staff WHERE id=(p_command->>'staffId')::uuid AND workspace_id=w;
 IF (k='labor' OR p_command->>'staffId' IS NOT NULL) AND s.id IS NULL THEN RAISE EXCEPTION 'Select staff in this workspace' USING ERRCODE='42501'; END IF;
 IF actor_role='member' AND (k<>'labor' OR s.user_id IS DISTINCT FROM p_actor_id OR NOT s.active OR st<>'draft' OR basis<>'unvalued' OR money IS NOT NULL OR old.status IN ('approved','excluded') OR (old.id IS NOT NULL AND old.created_by<>p_actor_id)) THEN RAISE EXCEPTION 'Members may correct only their own draft time' USING ERRCODE='42501'; END IF;
 IF project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=project AND workspace_id=w) THEN RAISE EXCEPTION 'Foreign project' USING ERRCODE='42501'; END IF;
 IF p_command->>'contractId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.invoicing_engagements e WHERE e.id=(p_command->>'contractId')::uuid AND e.workspace_id=w AND e.project_id IS NOT DISTINCT FROM project) THEN RAISE EXCEPTION 'Contract must belong to the selected project' USING ERRCODE='42501'; END IF;
 IF h IS NOT NULL AND (h<0 OR h>10000000 OR round(h,2)<>h) OR money IS NOT NULL AND (money<0 OR money>999999999999.99 OR round(money,2)<>money) THEN RAISE EXCEPTION 'Invalid exact hours or currency' USING ERRCODE='22023'; END IF;
 IF k='labor' AND (h IS NULL OR h<=0 OR h>24) THEN RAISE EXCEPTION 'Daily labor requires hours greater than zero and at most 24' USING ERRCODE='22023'; END IF;
 IF k='opening' AND (coalesce(length(trim(p_command->>'openingBasis')),0)=0 OR (p_command->>'openingStart')::date IS NULL OR (p_command->>'openingEnd')::date IS NULL OR (p_command->>'openingEnd')::date<(p_command->>'openingStart')::date OR (p_command->>'openingEnd')::date>dt) THEN RAISE EXCEPTION 'Opening balance requires documented coverage and basis' USING ERRCODE='22023'; END IF;
 IF basis='cost_rate' THEN
  SELECT * INTO rate FROM public.work_program_cost_rates WHERE id=(p_command->>'rateId')::uuid AND workspace_id=w AND staff_id=s.id AND dt BETWEEN starts_on AND ends_on;
  IF k<>'labor' OR rate.id IS NULL THEN RAISE EXCEPTION 'An approved effective cost rate is required' USING ERRCODE='22023'; END IF;
  money:=round(h*rate.hourly_cost,2);
 ELSIF basis='unvalued' THEN money:=NULL;
 END IF;
 IF st='approved' AND money IS NULL THEN RAISE EXCEPTION 'Reconcile valuation before approving' USING ERRCODE='22023'; END IF;
 IF st='approved' AND k='labor' AND (EXISTS(SELECT 1 FROM public.work_program_actual_versions v WHERE v.workspace_id=w AND v.staff_id=s.id AND v.entry_date=dt AND v.entry_id<>eid AND v.kind='labor' AND v.status<>'excluded' AND NOT EXISTS(SELECT 1 FROM public.work_program_actual_versions n WHERE n.entry_id=v.entry_id AND n.version>v.version))
 -- Ordinary time not yet mapped to the work program is the same labor; only the entry this command maps is exempt.
 OR EXISTS(SELECT 1 FROM public.invoicing_time_entries u WHERE u.workspace_id=w AND u.staff_id=s.id AND u.entry_date=dt AND u.work_program_id IS NULL AND u.id IS DISTINCT FROM coalesce(old.time_entry_id,(p_command->>'timeEntryId')::uuid)))
 AND coalesce(length(trim(p_command->>'reconciliationNote')),0)=0 THEN RAISE EXCEPTION 'Other time or payroll exists for this staff date; reconcile overlap explicitly before approval' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_command->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'allocations')>100 THEN RAISE EXCEPTION 'Allocation list required' USING ERRCODE='22023'; END IF;
 FOR alloc IN SELECT value FROM jsonb_array_elements(p_command->'allocations') LOOP
  SELECT value INTO element FROM jsonb_array_elements(r.content_json->'elements') WHERE value->>'id'=alloc->>'elementId';
  IF element IS NULL OR (element->>'projectId')::uuid IS DISTINCT FROM project OR (alloc->>'taskId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(element->'tasks') q WHERE q->>'id'=alloc->>'taskId')) THEN RAISE EXCEPTION 'Allocation must name an element and task of this revision and project' USING ERRCODE='42501'; END IF;
  IF alloc->>'deliverableId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.project_deliverables d WHERE d.id=(alloc->>'deliverableId')::uuid AND d.project_id=project) THEN RAISE EXCEPTION 'Foreign deliverable allocation' USING ERRCODE='42501'; END IF;
  IF (alloc->>'share')::integer IS NULL OR (alloc->>'share')::integer<=0 OR (alloc->>'share')::integer>10000 THEN RAISE EXCEPTION 'Allocation share must be positive basis points' USING ERRCODE='22023'; END IF;
  total_share:=total_share+(alloc->>'share')::integer;
 END LOOP;
 IF total_share NOT IN (0,10000) OR (st='approved' AND total_share<>10000) THEN RAISE EXCEPTION 'Allocations must total 100 percent before approval' USING ERRCODE='22023'; END IF;
 tid:=old.time_entry_id; xid:=old.spend_entry_id;
 IF old.id IS NULL AND p_command->>'timeEntryId' IS NOT NULL THEN
  SELECT * INTO t FROM public.invoicing_time_entries WHERE id=(p_command->>'timeEntryId')::uuid FOR UPDATE;
  IF t.id IS NULL OR t.workspace_id<>w OR t.staff_id<>s.id OR k<>'labor' OR t.entry_date<>dt OR t.hours<>h OR t.engagement_id IS DISTINCT FROM (p_command->>'contractId')::uuid OR t.work_program_id IS NOT NULL THEN RAISE EXCEPTION 'Time source mismatch or already mapped' USING ERRCODE='42501'; END IF;
  tid:=t.id;
 ELSIF old.id IS NULL AND k='labor' THEN
  INSERT INTO public.invoicing_time_entries(workspace_id,staff_id,engagement_id,entry_date,hours,notes,billable,created_by,work_program_id) VALUES(w,s.id,(p_command->>'contractId')::uuid,dt,h,p_command->>'description',coalesce((p_command->>'billable')::boolean,false),p_actor_id,p_program_id) RETURNING id INTO tid;
 END IF;
 IF tid IS NOT NULL THEN
  IF old.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.invoicing_time_entries WHERE id=tid AND billed_line_item_id IS NOT NULL) AND (old.hours<>h OR old.entry_date<>dt OR coalesce((old.detail->>'billable')::boolean,false) IS DISTINCT FROM coalesce((p_command->>'billable')::boolean,false)) THEN RAISE EXCEPTION 'Correct the billed time and invoice relationship before changing hours or date' USING ERRCODE='PT409'; END IF;
  UPDATE public.invoicing_time_entries SET work_program_id=p_program_id,hours=h,entry_date=dt,notes=p_command->>'description',billable=coalesce((p_command->>'billable')::boolean,false) WHERE id=tid;
 END IF;
 IF old.id IS NULL AND p_command->>'spendEntryId' IS NOT NULL THEN
  SELECT * INTO x FROM public.project_spend_entries WHERE id=(p_command->>'spendEntryId')::uuid FOR UPDATE;
  IF x.id IS NULL OR x.project_id IS DISTINCT FROM project OR k<>'expense' OR x.entry_date<>dt OR x.amount IS DISTINCT FROM money OR x.work_program_id IS NOT NULL THEN RAISE EXCEPTION 'Expense source mismatch or already mapped' USING ERRCODE='42501'; END IF;
  xid:=x.id;
 ELSIF xid IS NULL AND k='expense' AND project IS NOT NULL AND money IS NOT NULL THEN
  INSERT INTO public.project_spend_entries(project_id,entry_date,amount,description,created_by,work_program_id) VALUES(project,dt,money,p_command->>'description',p_actor_id,p_program_id) RETURNING id INTO xid;
 END IF;
 IF xid IS NOT NULL THEN UPDATE public.project_spend_entries SET work_program_id=p_program_id,amount=money,entry_date=dt,description=p_command->>'description' WHERE id=xid; END IF;
 INSERT INTO public.work_program_actual_versions(entry_id,version,program_id,workspace_id,revision_id,source_key,entry_date,kind,staff_id,time_entry_id,spend_entry_id,hours,amount,valuation_basis,cost_rate_id,status,detail,created_by)
 VALUES(eid,coalesce(old.version,0)+1,p_program_id,w,rid,p_command->>'sourceKey',dt,k,s.id,tid,xid,h,money,basis,rate.id,st,p_command,p_actor_id) RETURNING * INTO saved;
 FOR alloc IN SELECT value FROM jsonb_array_elements(p_command->'allocations') LOOP
  ix:=ix+1;
  part:=CASE WHEN ix=jsonb_array_length(p_command->'allocations') THEN money-allocated ELSE trunc(money*(alloc->>'share')::numeric/10000,2) END;
  ph:=CASE WHEN ix=jsonb_array_length(p_command->'allocations') THEN h-allocated_hours ELSE trunc(h*(alloc->>'share')::numeric/10000,2) END;
  allocated:=allocated+coalesce(part,0); allocated_hours:=allocated_hours+coalesce(ph,0);
  INSERT INTO public.work_program_actual_allocations(actual_version_id,element_id,task_id,deliverable_id,share,amount,hours) VALUES(saved.id,(alloc->>'elementId')::uuid,(alloc->>'taskId')::uuid,(alloc->>'deliverableId')::uuid,(alloc->>'share')::integer,part,ph);
 END LOOP;
 result:=jsonb_build_object('entryId',eid,'version',saved.version);
 INSERT INTO public.work_program_reporting_commands(program_id,request_id,actor_id,command,result) VALUES(p_program_id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_work_program_actual(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_program_actual(uuid,uuid,jsonb) TO service_role;

-- KI-2026-10-12-003. Issuing a management report rechecks that the baseline
-- adoption frozen at review has not since been withdrawn.
CREATE OR REPLACE FUNCTION public.work_program_management_command(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE w uuid; cached public.work_program_reporting_commands; req uuid:=(p_command->>'requestId')::uuid; k text:=p_command->>'kind'; result jsonb;
 period public.work_program_reporting_periods; baseline public.program_work_program_revisions; snap jsonb; records jsonb; history jsonb; rep public.work_program_period_reports;
 progress_row jsonb; latest_report uuid; rate public.work_program_cost_rates; adoption jsonb; period_id uuid:=(p_command->>'periodId')::uuid;
BEGIN
 SELECT workspace_id INTO w FROM public.programs WHERE id=p_program_id FOR UPDATE;
 IF w IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Owner or administrator required for management reporting' USING ERRCODE='42501'; END IF;
 IF req IS NULL OR k IS NULL OR octet_length(p_command::text)>500000 THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023'; END IF;
 SELECT * INTO cached FROM public.work_program_reporting_commands WHERE program_id=p_program_id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Request identity reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 IF k='rate' THEN
  IF NOT EXISTS(SELECT 1 FROM public.invoicing_staff WHERE id=(p_command->>'staffId')::uuid AND workspace_id=w) THEN RAISE EXCEPTION 'Foreign staff rate' USING ERRCODE='42501'; END IF;
  IF (p_command->>'hourlyCost')::numeric<>round((p_command->>'hourlyCost')::numeric,2) THEN RAISE EXCEPTION 'Cost rate requires whole cents' USING ERRCODE='22023'; END IF;
  INSERT INTO public.work_program_cost_rates(id,workspace_id,staff_id,starts_on,ends_on,hourly_cost,source_reference,approved_by)
  VALUES((p_command->>'rateId')::uuid,w,(p_command->>'staffId')::uuid,(p_command->>'startsOn')::date,(p_command->>'endsOn')::date,(p_command->>'hourlyCost')::numeric,p_command->>'sourceReference',p_actor_id) RETURNING * INTO rate;
  result:=jsonb_build_object('rateId',rate.id);
 ELSE
  SELECT * INTO period FROM public.work_program_reporting_periods WHERE id=period_id;
  IF period.id IS NOT NULL AND period.program_id<>p_program_id THEN RAISE EXCEPTION 'Foreign reporting period' USING ERRCODE='42501'; END IF;
  IF coalesce(period.version,0) IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Reporting period changed; reload before saving' USING ERRCODE='PT409'; END IF;
  IF k='period' THEN
   IF period.state IN ('review','issued') THEN RAISE EXCEPTION 'Return or start a correction before changing this period' USING ERRCODE='PT409'; END IF;
   IF coalesce(length(trim(p_command->>'name')),0)=0 OR (p_command->>'sourceCutoff')::timestamptz IS NULL OR (p_command->>'sourceCutoff')::timestamptz>now() THEN RAISE EXCEPTION 'Name and source cutoff at or before now required' USING ERRCODE='22023'; END IF;
   SELECT * INTO baseline FROM public.program_work_program_revisions WHERE id=(p_command->>'baselineId')::uuid AND program_id=p_program_id;
   IF p_command->>'baselineId' IS NOT NULL AND (baseline.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.program_work_program_events e WHERE e.program_id=p_program_id AND e.revision_id=baseline.id AND e.kind='adoption' AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events n WHERE n.program_id=p_program_id AND n.kind='withdraw_authority' AND n.payload->>'targetEventId'=e.id::text))) THEN RAISE EXCEPTION 'Select a recorded adopted baseline' USING ERRCODE='22023'; END IF;
   IF baseline.id IS NOT NULL AND ((p_command->>'startsOn')::date<(baseline.content_json->>'periodStart')::date OR (p_command->>'endsOn')::date>(baseline.content_json->>'periodEnd')::date) THEN RAISE EXCEPTION 'Period must be within the selected work program' USING ERRCODE='22023'; END IF;
   IF jsonb_typeof(p_command->'progress') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Progress records required' USING ERRCODE='22023'; END IF;
   FOR progress_row IN SELECT value FROM jsonb_array_elements(p_command->'progress') LOOP
    IF baseline.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(baseline.content_json->'elements') e WHERE e->>'id'=progress_row->>'elementId' AND (progress_row->>'taskId' IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(e->'tasks') t WHERE t->>'id'=progress_row->>'taskId'))) THEN RAISE EXCEPTION 'Progress target is outside the selected baseline' USING ERRCODE='42501'; END IF;
    IF (progress_row->>'remainingCost')::numeric<0 OR (progress_row->>'remainingHours')::numeric<0 OR (progress_row->>'asOf')::date IS NULL OR (progress_row->>'remainingCost')::numeric<>round((progress_row->>'remainingCost')::numeric,2) THEN RAISE EXCEPTION 'Dated nonnegative remaining estimates required' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF (SELECT count(*) FROM jsonb_array_elements(p_command->'progress'))<>(SELECT count(DISTINCT (value->>'elementId',value->>'taskId')) FROM jsonb_array_elements(p_command->'progress')) THEN RAISE EXCEPTION 'Duplicate progress targets' USING ERRCODE='22023'; END IF;
   INSERT INTO public.work_program_reporting_periods(id,program_id,workspace_id,name,starts_on,ends_on,baseline_id,source_cutoff,progress,note,created_by)
   VALUES(period_id,p_program_id,w,p_command->>'name',(p_command->>'startsOn')::date,(p_command->>'endsOn')::date,baseline.id,(p_command->>'sourceCutoff')::timestamptz,p_command->'progress',coalesce(p_command->>'note',''),p_actor_id)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,starts_on=excluded.starts_on,ends_on=excluded.ends_on,baseline_id=excluded.baseline_id,source_cutoff=excluded.source_cutoff,progress=excluded.progress,note=excluded.note,version=work_program_reporting_periods.version+1,updated_at=now(),review_snapshot=NULL RETURNING * INTO period;
  ELSE
   IF period.id IS NULL THEN RAISE EXCEPTION 'Reporting period unavailable' USING ERRCODE='42501'; END IF;
   IF coalesce(length(trim(p_command->>'note')),0)=0 THEN RAISE EXCEPTION 'A review or correction note is required' USING ERRCODE='22023'; END IF;
   IF k='review' THEN
    IF period.state NOT IN ('draft','returned','correcting') THEN RAISE EXCEPTION 'Period is not ready for review' USING ERRCODE='PT409'; END IF;
    SELECT * INTO baseline FROM public.program_work_program_revisions WHERE id=period.baseline_id AND program_id=p_program_id;
    SELECT to_jsonb(e) INTO adoption FROM public.program_work_program_events e WHERE e.program_id=p_program_id AND e.revision_id=baseline.id AND e.kind='adoption' AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events n WHERE n.program_id=p_program_id AND n.kind='withdraw_authority' AND n.payload->>'targetEventId'=e.id::text) ORDER BY e.sequence DESC LIMIT 1;
    IF baseline.id IS NULL OR adoption IS NULL THEN RAISE EXCEPTION 'An adopted baseline is required to review a budget report' USING ERRCODE='22023'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('amount',v.amount::text,'hours',v.hours::text,'staffName',s.name,'costRate',(SELECT to_jsonb(c)||jsonb_build_object('hourly_cost',c.hourly_cost::text) FROM public.work_program_cost_rates c WHERE c.id=v.cost_rate_id),'allocations',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text,'hours',a.hours::text) ORDER BY a.id),'[]') FROM public.work_program_actual_allocations a WHERE a.actual_version_id=v.id)) ORDER BY v.entry_date,v.entry_id),'[]') INTO records
    FROM public.work_program_actual_versions v LEFT JOIN public.invoicing_staff s ON s.id=v.staff_id
    WHERE v.program_id=p_program_id AND v.created_at<=period.source_cutoff AND v.entry_date<=period.ends_on AND (v.entry_date>=(baseline.content_json->>'periodStart')::date OR v.kind='opening')
    AND NOT EXISTS(SELECT 1 FROM public.work_program_actual_versions n WHERE n.entry_id=v.entry_id AND n.version>v.version AND n.created_at<=period.source_cutoff);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) v WHERE v->>'status'='draft' OR (v->>'status'='approved' AND (v->>'amount' IS NULL OR jsonb_array_length(v->'allocations')=0))) THEN RAISE EXCEPTION 'Approve or exclude unresolved actuals and allocations before review' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) v CROSS JOIN LATERAL jsonb_array_elements(v->'allocations') a WHERE v->>'status'='approved' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(baseline.content_json->'elements') e WHERE e->>'id'=a->>'element_id' AND (a->>'task_id' IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(e->'tasks') t WHERE t->>'id'=a->>'task_id')))) THEN RAISE EXCEPTION 'Reconcile actual allocations with the selected adopted baseline' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) v WHERE v->>'kind'='opening' AND v->>'status'='approved' AND ((v->'detail'->>'openingStart')::date<(baseline.content_json->>'periodStart')::date OR (v->'detail'->>'openingEnd')::date>=period.starts_on)) THEN RAISE EXCEPTION 'Opening coverage must be within the fiscal year and before the reporting period; reconcile a crossing balance before review' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) o CROSS JOIN jsonb_array_elements(records) v
     WHERE o->>'kind'='opening' AND o->>'status'='approved' AND v->>'status'='approved' AND o->>'entry_id'<>v->>'entry_id'
     AND v->>'kind' IN ('labor','expense','opening') AND (CASE WHEN v->>'kind'='opening' THEN (v->'detail'->>'openingStart')::date<=(o->'detail'->>'openingEnd')::date AND (v->'detail'->>'openingEnd')::date>=(o->'detail'->>'openingStart')::date ELSE (v->>'entry_date')::date BETWEEN (o->'detail'->>'openingStart')::date AND (o->'detail'->>'openingEnd')::date END)
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(o->'allocations') a JOIN jsonb_array_elements(v->'allocations') b ON a->>'element_id'=b->>'element_id'))
    THEN RAISE EXCEPTION 'Opening balance overlaps detailed incurred costs; reconcile coverage before review' USING ERRCODE='22023'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('amount',v.amount::text,'hours',v.hours::text) ORDER BY v.created_at,v.id),'[]') INTO history FROM public.work_program_actual_versions v WHERE v.program_id=p_program_id AND v.created_at<=period.source_cutoff AND v.entry_id IN(SELECT (value->>'entry_id')::uuid FROM jsonb_array_elements(records));
    snap:=jsonb_build_object('schemaVersion',1,'period',to_jsonb(period)-'review_snapshot','baseline',to_jsonb(baseline),'baselineAdoption',adoption,'actuals',records,'valuationHistory',history,'reviewNote',p_command->>'note','reviewedAt',now(),'reviewedBy',p_actor_id);
    UPDATE public.work_program_reporting_periods SET state='review',review_snapshot=snap,version=version+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
   ELSIF k='return' THEN
    IF period.state<>'review' THEN RAISE EXCEPTION 'Only a reviewed period can be returned' USING ERRCODE='PT409'; END IF;
    UPDATE public.work_program_reporting_periods SET state='returned',note=p_command->>'note',review_snapshot=NULL,version=version+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
   ELSIF k='correct' THEN
    IF period.state<>'issued' THEN RAISE EXCEPTION 'Only an issued period starts a corrected version' USING ERRCODE='PT409'; END IF;
    UPDATE public.work_program_reporting_periods SET state='correcting',note=p_command->>'note',review_snapshot=NULL,version=version+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
   ELSIF k='issue' THEN
    IF period.state<>'review' OR period.review_snapshot IS NULL THEN RAISE EXCEPTION 'Review the exact report before issuing' USING ERRCODE='PT409'; END IF;
    -- The adoption frozen at review must still stand when the report is issued.
    IF NOT EXISTS(SELECT 1 FROM public.program_work_program_events e WHERE e.program_id=p_program_id AND e.id::text=period.review_snapshot->'baselineAdoption'->>'id' AND e.revision_id=period.baseline_id AND e.kind='adoption' AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events n WHERE n.program_id=p_program_id AND n.kind='withdraw_authority' AND n.payload->>'targetEventId'=e.id::text)) THEN RAISE EXCEPTION 'The baseline adoption was withdrawn after review; return the period and review it again' USING ERRCODE='PT409'; END IF;
    SELECT id INTO latest_report FROM public.work_program_period_reports WHERE work_program_period_reports.period_id=period.id AND report_kind='management' ORDER BY version DESC LIMIT 1;
    snap:=period.review_snapshot||jsonb_build_object('issueNote',p_command->>'note');
    INSERT INTO public.work_program_period_reports(period_id,program_id,workspace_id,version,snapshot,snapshot_hash,issued_by,corrects_report_id)
    VALUES(period.id,p_program_id,w,coalesce((SELECT max(version) FROM public.work_program_period_reports WHERE work_program_period_reports.period_id=period.id),0)+1,snap,encode(extensions.digest(convert_to(snap::text,'UTF8'),'sha256'),'hex'),p_actor_id,latest_report) RETURNING * INTO rep;
    UPDATE public.work_program_reporting_periods SET state='issued',version=version+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
   ELSE RAISE EXCEPTION 'Unknown management command' USING ERRCODE='22023';
   END IF;
  END IF;
  result:=jsonb_build_object('periodId',period.id,'version',period.version,'reportId',rep.id);
 END IF;
 INSERT INTO public.work_program_reporting_commands(program_id,request_id,actor_id,command,result) VALUES(p_program_id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.work_program_management_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_program_management_command(uuid,uuid,jsonb) TO service_role;

-- KI-2026-10-12-004. Starting an amendment requires the adopted baseline to be
-- the latest revision, so it cannot overwrite an amendment already in progress.
CREATE OR REPLACE FUNCTION public.record_work_program_event(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS public.program_work_program_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 w uuid; actor_role text; r public.program_work_program_revisions; latest public.program_work_program_revisions;
 s public.program_work_program_workflow; e public.program_work_program_events; target public.program_work_program_events;
 k text := p_command->>'kind'; doc_id uuid; reviewer uuid; d public.kb_documents; evidence jsonb := '[]';
BEGIN
 SELECT workspace_id INTO w FROM public.programs WHERE id=p_program_id FOR UPDATE;
 SELECT role INTO actor_role FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id FOR SHARE;
 IF w IS NULL OR actor_role IS NULL OR actor_role NOT IN ('owner','admin','member') THEN RAISE EXCEPTION 'Work program write access denied' USING ERRCODE='42501'; END IF;
 IF p_command IS NULL OR octet_length(p_command::text)>100000 OR k IS NULL OR k NOT IN ('submit','comment','resolve_comment','return','approve','adoption','external_acceptance','spending_authorization','withdraw_authority','start_amendment')
  OR coalesce(length(btrim(p_command->>'note')),0)=0 OR p_command->>'visibility' IS NULL OR p_command->>'visibility' NOT IN ('internal','public') OR p_command->>'requestId' IS NULL
  OR p_command->>'expectedSequence' IS NULL OR p_command->>'expectedRevision' IS NULL OR p_command->>'revisionId' IS NULL OR p_command->>'revisionHash' IS NULL
  OR jsonb_typeof(p_command->'reviewerIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p_command->'documentIds') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Invalid workflow command' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.program_work_program_events WHERE program_id=p_program_id AND request_id=(p_command->>'requestId')::uuid;
 IF FOUND THEN
  IF e.actor_id<>p_actor_id OR e.payload<>p_command THEN RAISE EXCEPTION 'Retry payload or actor changed' USING ERRCODE='PT409'; END IF;
  RETURN e;
 END IF;
 IF k NOT IN ('adoption','external_acceptance','spending_authorization','withdraw_authority') AND (coalesce(p_command->>'authority','')<>'' OR coalesce(p_command->>'scope','')<>'' OR p_command->>'evidenceDate' IS NOT NULL) THEN RAISE EXCEPTION 'Authority fields require an authority record' USING ERRCODE='22023'; END IF;
 INSERT INTO public.program_work_program_workflow(program_id,workspace_id) VALUES(p_program_id,w) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.program_work_program_workflow WHERE program_id=p_program_id;
 SELECT * INTO r FROM public.program_work_program_revisions WHERE id=(p_command->>'revisionId')::uuid AND program_id=p_program_id AND workspace_id=w;
 SELECT * INTO latest FROM public.program_work_program_revisions WHERE program_id=p_program_id ORDER BY revision DESC LIMIT 1;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Revision access denied' USING ERRCODE='42501'; END IF;
 IF s.sequence<>(p_command->>'expectedSequence')::integer OR latest.revision<>(p_command->>'expectedRevision')::integer OR r.content_sha256 IS DISTINCT FROM p_command->>'revisionHash'
 THEN RAISE EXCEPTION 'Workflow or revision changed; reload' USING ERRCODE='PT409'; END IF;
 IF k NOT IN ('comment','resolve_comment','withdraw_authority','start_amendment','external_acceptance','spending_authorization') AND r.id<>latest.id THEN RAISE EXCEPTION 'Old decisions cannot authorize new content' USING ERRCODE='PT409'; END IF;
 IF k IN ('adoption','external_acceptance','spending_authorization','withdraw_authority') AND actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'An owner or administrator must record authority' USING ERRCODE='42501'; END IF;
 FOR doc_id IN SELECT value::uuid FROM jsonb_array_elements_text(p_command->'documentIds') LOOP
  SELECT * INTO d FROM public.kb_documents WHERE id=doc_id AND workspace_id=w AND checksum IS NOT NULL AND storage_ref IS NOT NULL FOR SHARE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Supporting document unavailable or foreign' USING ERRCODE='42501'; END IF;
  evidence := evidence || jsonb_build_array(jsonb_build_object('id',d.id,'title',d.title,'checksum',d.checksum));
 END LOOP;
 IF k IN ('adoption','external_acceptance','spending_authorization','withdraw_authority') THEN
  IF jsonb_array_length(evidence)=0 OR coalesce(length(btrim(p_command->>'authority')),0)=0 OR coalesce(length(btrim(p_command->>'scope')),0)=0 OR p_command->>'evidenceDate' IS NULL
  THEN RAISE EXCEPTION 'Actual dated authority, scope and supporting documents required' USING ERRCODE='22023'; END IF;
  IF (p_command->>'evidenceDate')::date > current_date THEN RAISE EXCEPTION 'A future event is not recorded evidence' USING ERRCODE='22023'; END IF;
 END IF;
 IF k='submit' THEN
  IF s.status IN ('review','approved','adopted') AND s.submission_revision_id=r.id THEN RAISE EXCEPTION 'This revision is already submitted; save a new revision' USING ERRCODE='PT409'; END IF;
  IF jsonb_array_length(p_command->'reviewerIds')=0 THEN RAISE EXCEPTION 'Assign at least one independent reviewer' USING ERRCODE='22023'; END IF;
  IF r.amendment_baseline_id IS DISTINCT FROM s.effective_revision_id THEN RAISE EXCEPTION 'Amendment baseline changed' USING ERRCODE='PT409'; END IF;
  FOR reviewer IN SELECT value::uuid FROM jsonb_array_elements_text(p_command->'reviewerIds') LOOP
   IF reviewer=r.created_by OR reviewer=p_actor_id OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=reviewer AND role IN ('owner','admin','member'))
   THEN RAISE EXCEPTION 'Reviewer must be a separate current workspace writer' USING ERRCODE='42501'; END IF;
  END LOOP;
 ELSIF k IN ('approve','return') THEN
  IF s.status<>'review' OR s.submission_revision_id IS DISTINCT FROM r.id OR NOT EXISTS(SELECT 1 FROM public.program_work_program_reviews WHERE submission_id=s.submission_id AND assignee_user_id=p_actor_id AND status='pending')
  THEN RAISE EXCEPTION 'No current assigned review for this actor and revision' USING ERRCODE='42501'; END IF;
  IF p_actor_id=r.created_by THEN RAISE EXCEPTION 'Author cannot approve own revision' USING ERRCODE='42501'; END IF;
  IF k='approve' AND EXISTS(SELECT 1 FROM public.program_work_program_events c WHERE c.program_id=p_program_id AND c.kind='comment' AND c.revision_id=r.id AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events x WHERE x.kind='resolve_comment' AND x.payload->>'targetEventId'=c.id::text AND x.program_id=p_program_id)) THEN RAISE EXCEPTION 'Resolve open review comments first' USING ERRCODE='PT409'; END IF;
 ELSIF k='resolve_comment' THEN
  SELECT * INTO target FROM public.program_work_program_events WHERE id=(p_command->>'targetEventId')::uuid AND program_id=p_program_id AND revision_id=r.id AND kind='comment';
  IF target.id IS NULL OR (target.actor_id<>p_actor_id AND actor_role NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'Only comment author or administrator can resolve it' USING ERRCODE='42501'; END IF;
 ELSIF k='adoption' THEN
  IF s.status<>'approved' OR s.submission_revision_id IS DISTINCT FROM r.id OR r.amendment_baseline_id IS DISTINCT FROM s.effective_revision_id
   OR EXISTS(SELECT 1 FROM public.program_work_program_events c WHERE c.program_id=p_program_id AND c.kind='comment' AND c.revision_id=r.id AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events x WHERE x.kind='resolve_comment' AND x.payload->>'targetEventId'=c.id::text AND x.program_id=p_program_id))
  THEN RAISE EXCEPTION 'Exact current revision needs completed internal review' USING ERRCODE='PT409'; END IF;
 ELSIF k IN ('external_acceptance','spending_authorization') THEN
  IF s.effective_revision_id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'Authority evidence must name the effective adopted revision' USING ERRCODE='PT409'; END IF;
 ELSIF k='withdraw_authority' THEN
  SELECT * INTO target FROM public.program_work_program_events WHERE id=(p_command->>'targetEventId')::uuid AND program_id=p_program_id AND revision_id=r.id AND kind IN ('adoption','external_acceptance','spending_authorization');
  IF target.id IS NULL THEN RAISE EXCEPTION 'Select an authority record from this revision' USING ERRCODE='22023'; END IF;
 ELSIF k='start_amendment' THEN
  IF s.effective_revision_id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'Select the current adopted baseline' USING ERRCODE='PT409'; END IF;
  -- A newer revision is an amendment already in progress; copying the baseline over it would displace that work.
  IF latest.id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'An amendment is already in progress; continue editing the latest revision' USING ERRCODE='PT409'; END IF;
 END IF;
 INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,request_id,actor_id,payload,evidence)
 VALUES(p_program_id,w,s.sequence+1,r.id,r.content_sha256,k,(p_command->>'requestId')::uuid,p_actor_id,p_command,evidence) RETURNING * INTO e;
 UPDATE public.program_work_program_workflow SET sequence=e.sequence WHERE program_id=p_program_id;
 IF k='submit' THEN
  UPDATE public.program_work_program_reviews SET status='superseded' WHERE program_id=p_program_id AND status IN ('pending','returned');
  INSERT INTO public.program_work_program_reviews(program_id,workspace_id,revision_id,submission_id,assignee_user_id,due_on,status)
  SELECT DISTINCT p_program_id,w,r.id,e.id,value::uuid,(p_command->>'dueOn')::date,'pending' FROM jsonb_array_elements_text(p_command->'reviewerIds');
  UPDATE public.program_work_program_workflow SET submission_id=e.id,submission_revision_id=r.id,status='review' WHERE program_id=p_program_id;
 ELSIF k='return' THEN
  UPDATE public.program_work_program_reviews SET status='superseded' WHERE submission_id=s.submission_id AND status IN ('pending','returned');
  INSERT INTO public.program_work_program_reviews(program_id,workspace_id,revision_id,submission_id,assignee_user_id,due_on,status) VALUES(p_program_id,w,r.id,s.submission_id,r.created_by,NULL,'returned');
  UPDATE public.program_work_program_workflow SET status='returned' WHERE program_id=p_program_id;
 ELSIF k='approve' THEN
  UPDATE public.program_work_program_reviews SET status='approved' WHERE submission_id=s.submission_id AND assignee_user_id=p_actor_id;
  IF NOT EXISTS(SELECT 1 FROM public.program_work_program_reviews WHERE submission_id=s.submission_id AND status='pending') THEN UPDATE public.program_work_program_workflow SET status='approved' WHERE program_id=p_program_id; END IF;
 ELSIF k='adoption' THEN
  UPDATE public.program_work_program_workflow SET status='adopted',effective_revision_id=r.id WHERE program_id=p_program_id;
 ELSIF k='withdraw_authority' AND target.kind='adoption' AND s.effective_revision_id=r.id THEN
  UPDATE public.program_work_program_workflow SET effective_revision_id=NULL,status='draft' WHERE program_id=p_program_id;
 ELSIF k='start_amendment' THEN
  PERFORM public.save_program_work_program_revision(p_program_id,p_actor_id,latest.revision,(p_command->>'requestId')::uuid,r.content_json);
 END IF;
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.record_work_program_event(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_program_event(uuid,uuid,jsonb) TO service_role;

-- KI-2026-10-12-005. A contract source on a voided draft invoice may be billed
-- again. The source row on the voided invoice is kept as history; at most one
-- source per entry may sit on an invoice that is not void.
ALTER TABLE public.contract_billing_sources DROP CONSTRAINT contract_billing_sources_entry_id_key;
CREATE INDEX contract_billing_sources_entry_id_idx ON public.contract_billing_sources(entry_id);

CREATE FUNCTION public.guard_contract_billing_source_reuse() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.contract_billing_sources x JOIN public.client_invoices i ON i.id=x.invoice_id WHERE x.entry_id=NEW.entry_id AND i.status<>'void') THEN
  RAISE EXCEPTION 'This source is already on an invoice that is not void' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_contract_billing_source_reuse() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER single_live_contract_billing_source BEFORE INSERT ON public.contract_billing_sources FOR EACH ROW EXECUTE FUNCTION public.guard_contract_billing_source_reuse();

CREATE OR REPLACE FUNCTION public.bill_contract_actuals(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
  IF v.id IS NULL OR v.command->>'status'<>'approved' OR NOT coalesce((v.command->>'billable')::boolean,false) OR v.command->>'category' NOT IN ('labor','expense') OR v.amount IS NULL OR jsonb_array_length(v.allocations)=0 OR EXISTS(SELECT 1 FROM public.contract_billing_sources x JOIN public.client_invoices i ON i.id=x.invoice_id WHERE x.entry_id=v.entry_id AND i.status<>'void') THEN RAISE EXCEPTION 'Only approved, allocated, unbilled labor and expenses may be billed' USING ERRCODE='PT409'; END IF;
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
REVOKE ALL ON FUNCTION public.bill_contract_actuals(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bill_contract_actuals(uuid,uuid,jsonb) TO service_role;

-- KI-2026-10-12-006. Finance approval of a received consultant invoice
-- requires the project manager review step first.
CREATE OR REPLACE FUNCTION public.record_received_invoice(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
  IF actor_role='consultant' OR target_state IS NULL OR target_state NOT IN ('returned','reviewed','approved') OR old.id IS NULL OR old.state NOT IN ('submitted','reviewed') OR (target_state='approved' AND (actor_role NOT IN ('owner','admin','finance') OR old.state<>'reviewed')) THEN RAISE EXCEPTION 'PM review and separate finance approval require an unchanged submitted or reviewed invoice' USING ERRCODE='42501'; END IF;
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

-- KI-2026-10-12-007. Client invoice status rules lived only in the invoice
-- route; the table policies check membership. These guards hold the route's
-- lifecycle for every writer: draft to sent or void, sent to paid or void,
-- paid to void, and void is final. A draft may change freely. Once sent, only
-- the status and, when a sent invoice is marked paid, the paid date change.
-- Lines change only while the invoice is a draft. References cleared by an
-- ON DELETE SET NULL foreign key, and deletions that cascade from a deleted
-- workspace, client or invoice, are allowed.
CREATE FUNCTION public.guard_client_invoice_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE released text[]:=ARRAY['updated_at'];
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status='draft' OR NOT EXISTS(SELECT 1 FROM public.workspaces x WHERE x.id=OLD.workspace_id) OR NOT EXISTS(SELECT 1 FROM public.invoicing_clients x WHERE x.id=OLD.client_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'A sent, paid or void invoice is retained; void it instead of deleting it' USING ERRCODE='23514';
 END IF;
 IF NOT ((OLD.status='draft' AND NEW.status IN ('draft','sent','void')) OR (OLD.status='sent' AND NEW.status IN ('sent','paid','void')) OR (OLD.status='paid' AND NEW.status IN ('paid','void')) OR (OLD.status='void' AND NEW.status='void')) THEN
  RAISE EXCEPTION 'An invoice cannot move from % to %',OLD.status,NEW.status USING ERRCODE='23514';
 END IF;
 IF OLD.status='draft' THEN RETURN NEW; END IF;
 IF NEW.paid_date IS DISTINCT FROM OLD.paid_date AND NOT (OLD.status='sent' AND NEW.status='paid') THEN
  RAISE EXCEPTION 'The paid date is recorded only when a sent invoice is marked paid' USING ERRCODE='23514';
 END IF;
 IF NEW.engagement_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.invoicing_engagements x WHERE x.id=OLD.engagement_id) THEN released:=released||'engagement_id'::text; END IF;
 IF NEW.project_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.projects x WHERE x.id=OLD.project_id) THEN released:=released||'project_id'::text; END IF;
 IF NEW.created_by IS NULL AND NOT EXISTS(SELECT 1 FROM auth.users x WHERE x.id=OLD.created_by) THEN released:=released||'created_by'::text; END IF;
 IF (to_jsonb(NEW)-'status'-'paid_date'-released) IS DISTINCT FROM (to_jsonb(OLD)-'status'-'paid_date'-released) THEN
  RAISE EXCEPTION 'A sent, paid or void invoice is retained as issued; void it and reissue a corrected invoice' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_client_invoice_lifecycle() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retained_client_invoice_lifecycle BEFORE UPDATE OR DELETE ON public.client_invoices FOR EACH ROW EXECUTE FUNCTION public.guard_client_invoice_lifecycle();

CREATE FUNCTION public.guard_client_invoice_line_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old_status text; new_status text;
BEGIN
 IF TG_OP<>'INSERT' THEN
  SELECT status INTO old_status FROM public.client_invoices WHERE id=OLD.invoice_id;
  IF TG_OP='DELETE' AND old_status IS NULL THEN RETURN OLD; END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN SELECT status INTO new_status FROM public.client_invoices WHERE id=NEW.invoice_id; END IF;
 IF TG_OP='UPDATE' AND NEW.invoice_id=OLD.invoice_id
  AND (to_jsonb(NEW)-'deliverable_id'-'milestone_id'-'updated_at')=(to_jsonb(OLD)-'deliverable_id'-'milestone_id'-'updated_at')
  AND (NEW.deliverable_id IS NOT DISTINCT FROM OLD.deliverable_id OR (NEW.deliverable_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.project_deliverables x WHERE x.id=OLD.deliverable_id)))
  AND (NEW.milestone_id IS NOT DISTINCT FROM OLD.milestone_id OR (NEW.milestone_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.project_milestones x WHERE x.id=OLD.milestone_id)))
 THEN RETURN NEW; END IF;
 IF coalesce(old_status,'draft')<>'draft' OR coalesce(new_status,'draft')<>'draft' THEN
  RAISE EXCEPTION 'Line items are immutable once an invoice has been sent; void it and reissue a corrected invoice' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_client_invoice_line_lifecycle() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retained_client_invoice_line_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.client_invoice_line_items FOR EACH ROW EXECUTE FUNCTION public.guard_client_invoice_line_lifecycle();

-- Replaces a draft invoice's lines, their time-entry links and its totals in
-- one transaction, so a failure part way leaves the previous lines in place.
-- Runs as the caller: table policies still apply, and the caller must be an
-- owner or admin of the invoice's workspace, as the invoice route requires.
CREATE FUNCTION public.replace_client_invoice_lines(p_invoice_id uuid,p_lines jsonb,p_subtotal_amount numeric,p_retention_amount numeric,p_total_amount numeric)
RETURNS SETOF public.client_invoice_line_items LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE inv public.client_invoices; line jsonb; saved public.client_invoice_line_items; ids uuid[]; stamped integer; ix integer:=0;
BEGIN
 SELECT * INTO inv FROM public.client_invoices WHERE id=p_invoice_id FOR UPDATE;
 IF inv.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=inv.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Owner or admin role required for invoice writes' USING ERRCODE='42501';
 END IF;
 IF inv.status<>'draft' THEN
  RAISE EXCEPTION 'Line items are immutable once an invoice has been sent; void it and reissue a corrected invoice' USING ERRCODE='PT409';
 END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) l WHERE jsonb_typeof(l) IS DISTINCT FROM 'object' OR coalesce(length(btrim(l->>'description')),0)=0
   OR (l->>'amount')::numeric IS NULL OR (l->>'amount')::numeric<0 OR round((l->>'amount')::numeric,2)<>(l->>'amount')::numeric
   OR jsonb_typeof(coalesce(l->'source_time_entry_ids','[]'::jsonb))<>'array')
 THEN RAISE EXCEPTION 'Each line needs a description and an exact amount of zero or more' USING ERRCODE='22023'; END IF;
 IF p_subtotal_amount IS DISTINCT FROM (SELECT sum((l->>'amount')::numeric) FROM jsonb_array_elements(p_lines) l)
  OR p_retention_amount IS NULL OR p_retention_amount<0 OR p_retention_amount>p_subtotal_amount OR p_total_amount IS DISTINCT FROM p_subtotal_amount-p_retention_amount
 THEN RAISE EXCEPTION 'Invoice totals must equal the line amounts less retention' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) l WHERE (l->>'deliverable_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.project_deliverables d WHERE d.id=(l->>'deliverable_id')::uuid AND d.project_id=inv.project_id))
  OR (l->>'milestone_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.project_milestones m WHERE m.id=(l->>'milestone_id')::uuid AND m.project_id=inv.project_id)))
 THEN RAISE EXCEPTION 'Line deliverables and milestones must belong to the invoice''s project' USING ERRCODE='22023'; END IF;
 SELECT array_agg(t.value::uuid) INTO ids FROM jsonb_array_elements(p_lines) l CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(l->'source_time_entry_ids','[]'::jsonb)) t;
 IF ids IS NOT NULL THEN
  IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'A time entry may back only one line item' USING ERRCODE='22023'; END IF;
  IF inv.engagement_id IS NULL OR (SELECT count(*) FROM public.invoicing_time_entries e WHERE e.id=ANY(ids) AND e.workspace_id=inv.workspace_id AND e.engagement_id=inv.engagement_id)<>cardinality(ids) THEN
   RAISE EXCEPTION 'Time entries must belong to the invoice''s engagement' USING ERRCODE='22023';
  END IF;
 END IF;
 -- Deleting the current lines releases their time links (ON DELETE SET NULL).
 DELETE FROM public.client_invoice_line_items WHERE invoice_id=inv.id;
 FOR line IN SELECT l.value FROM jsonb_array_elements(p_lines) WITH ORDINALITY l(value,n) ORDER BY l.n LOOP
  INSERT INTO public.client_invoice_line_items(invoice_id,position,description,quantity,unit_label,unit_amount,amount,deliverable_id,milestone_id)
  VALUES(inv.id,ix,line->>'description',(line->>'quantity')::numeric,nullif(btrim(line->>'unit_label'),''),(line->>'unit_amount')::numeric,(line->>'amount')::numeric,(line->>'deliverable_id')::uuid,(line->>'milestone_id')::uuid)
  RETURNING * INTO saved;
  ids:=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(line->'source_time_entry_ids','[]'::jsonb)));
  IF cardinality(ids)>0 THEN
   UPDATE public.invoicing_time_entries SET billed_line_item_id=saved.id WHERE id=ANY(ids) AND billed_line_item_id IS NULL;
   GET DIAGNOSTICS stamped=ROW_COUNT;
   IF stamped<>cardinality(ids) THEN RAISE EXCEPTION 'One or more time entries are already billed on another invoice' USING ERRCODE='PT409'; END IF;
  END IF;
  ix:=ix+1;
  RETURN NEXT saved;
 END LOOP;
 UPDATE public.client_invoices SET subtotal_amount=p_subtotal_amount,retention_amount=p_retention_amount,total_amount=p_total_amount WHERE id=inv.id;
 RETURN;
END $$;
REVOKE ALL ON FUNCTION public.replace_client_invoice_lines(uuid,jsonb,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.replace_client_invoice_lines(uuid,jsonb,numeric,numeric,numeric) TO authenticated;
