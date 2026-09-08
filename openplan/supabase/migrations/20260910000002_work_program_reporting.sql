ALTER TABLE public.work_program_reporting_periods ADD COLUMN review_snapshot jsonb;
CREATE FUNCTION public.work_program_management_command(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
    SELECT id INTO latest_report FROM public.work_program_period_reports WHERE work_program_period_reports.period_id=period.id ORDER BY version DESC LIMIT 1;
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
