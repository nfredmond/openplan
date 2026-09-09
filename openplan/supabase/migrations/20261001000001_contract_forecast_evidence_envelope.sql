-- The normalized 200-task/100-staff/731-day fixture is 63.6 MB before JSONB spacing.
-- Increase only the server-produced forecast evidence envelope; original requests
-- and all other delivery commands retain their 8 MB ceiling. The web route's
-- 2 MB manual-request limit and caller/source/retry guards are unchanged.
CREATE OR REPLACE FUNCTION public.record_contract_command_delivery(p_engagement_id uuid, p_actor_id uuid, p_command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE e public.invoicing_engagements; actor_role text; req uuid:=(p_command->>'requestId')::uuid; k text:=p_command->>'kind'; c jsonb:=p_command->'content'; cached public.contract_commands;
 v integer; result jsonb; old public.contract_work_updates; staff_row public.invoicing_staff; node jsonb; person jsonb; record_id uuid; original_command jsonb:=coalesce(p_command->'_request',p_command);
BEGIN
 IF k NOT IN ('capacity','schedule','work_update','work_review','forecast') THEN RETURN public.record_contract_command_agency(p_engagement_id,p_actor_id,p_command); END IF;
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin','pm','finance','member') OR (actor_role='member' AND k<>'work_update') THEN RAISE EXCEPTION 'Contract delivery authority required' USING ERRCODE='42501'; END IF;
 IF req IS NULL THEN RAISE EXCEPTION 'Invalid delivery request' USING ERRCODE='22023'; END IF;
 IF octet_length(original_command::text)>8000000 OR octet_length(p_command::text)>(CASE WHEN k='forecast' THEN 96000000 ELSE 8000000 END) THEN
  RAISE EXCEPTION 'Delivery evidence exceeds the retained size limit: 96 MB for calculated forecasts, 8 MB for submitted commands' USING ERRCODE='22023';
 END IF;
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
END $function$;


REVOKE ALL ON FUNCTION public.record_contract_command_delivery(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
