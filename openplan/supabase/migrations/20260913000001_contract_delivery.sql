-- Reviewed work, explicit capacity and deterministic forecast custody; existing baselines remain unchanged.
CREATE TABLE public.contract_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 version integer NOT NULL CHECK(version>0), content jsonb NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(engagement_id,version)
);
CREATE TABLE public.contract_capacity_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), staff_id uuid NOT NULL REFERENCES public.invoicing_staff(id),
 version integer NOT NULL CHECK(version>0), content jsonb NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(staff_id,version)
);
CREATE TABLE public.contract_work_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), task_id uuid NOT NULL REFERENCES public.contract_tasks(id), staff_id uuid NOT NULL REFERENCES public.invoicing_staff(id),
 version integer NOT NULL CHECK(version>0), state text NOT NULL CHECK(state IN ('submitted','accepted','returned')), content jsonb NOT NULL,
 remaining_cost numeric(18,2) CHECK(remaining_cost>=0), remaining_gross_billing numeric(18,2) CHECK(remaining_gross_billing>=0), valuation_evidence text NOT NULL DEFAULT '', evidence text NOT NULL DEFAULT '',
 reviewed_update_id uuid REFERENCES public.contract_work_updates(id), created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(task_id,staff_id,version)
);
CREATE TABLE public.contract_forecasts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 version integer NOT NULL CHECK(version>0), input_hash text NOT NULL, content jsonb NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(engagement_id,version)
);
ALTER TABLE public.contract_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_capacity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_work_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_forecasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_schedules,public.contract_capacity_versions,public.contract_work_updates,public.contract_forecasts FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_schedules,public.contract_capacity_versions,public.contract_forecasts TO authenticated,service_role;
GRANT SELECT ON public.contract_work_updates TO service_role;
GRANT SELECT(id,engagement_id,workspace_id,task_id,staff_id,version,state,content,evidence,reviewed_update_id,created_by,created_at) ON public.contract_work_updates TO authenticated;
CREATE POLICY management_read ON public.contract_schedules FOR SELECT TO authenticated USING(public.contract_can_manage(engagement_id));
CREATE POLICY management_read ON public.contract_capacity_versions FOR SELECT TO authenticated USING(public.contract_can_manage(engagement_id) OR EXISTS(SELECT 1 FROM public.invoicing_staff s WHERE s.id=staff_id AND s.user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=contract_capacity_versions.workspace_id AND m.user_id=auth.uid())));
CREATE POLICY management_read ON public.contract_work_updates FOR SELECT TO authenticated USING(public.contract_can_manage(engagement_id) OR EXISTS(SELECT 1 FROM public.invoicing_staff s WHERE s.id=staff_id AND s.user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=contract_work_updates.workspace_id AND m.user_id=auth.uid())));
CREATE POLICY management_read ON public.contract_forecasts FOR SELECT TO authenticated USING(public.contract_can_manage(engagement_id));
CREATE TRIGGER immutable_schedule BEFORE UPDATE OR DELETE ON public.contract_schedules FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE TRIGGER immutable_capacity BEFORE UPDATE OR DELETE ON public.contract_capacity_versions FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE TRIGGER immutable_work_update BEFORE UPDATE OR DELETE ON public.contract_work_updates FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE TRIGGER immutable_forecast BEFORE UPDATE OR DELETE ON public.contract_forecasts FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();

CREATE FUNCTION public.contract_delivery_hash(p_workspace_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT encode(extensions.digest(coalesce(string_agg(x,'|' ORDER BY x),''),'sha256'),'hex') FROM (
 SELECT 'schedule:'||id::text x FROM public.contract_schedules WHERE workspace_id=p_workspace_id
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
REVOKE ALL ON FUNCTION public.contract_delivery_hash(uuid) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.record_contract_command(uuid,uuid,jsonb) RENAME TO record_contract_command_agency;
REVOKE ALL ON FUNCTION public.record_contract_command_agency(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_contract_command(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
    IF NOT EXISTS(SELECT 1 FROM public.invoicing_staff s WHERE s.id=(person->>'staffId')::uuid AND s.workspace_id=e.workspace_id AND s.active) THEN RAISE EXCEPTION 'Schedule staff must be active in the same organization' USING ERRCODE='42501'; END IF;
   END LOOP;
  END LOOP;
  INSERT INTO public.contract_schedules(engagement_id,workspace_id,version,content,created_by) VALUES(e.id,e.workspace_id,v+1,c,p_actor_id) RETURNING id INTO record_id;
  UPDATE public.contract_task_assignments SET active=false WHERE engagement_id=e.id AND task_id IN (SELECT (n->>'taskId')::uuid FROM jsonb_array_elements(c->'nodes') n WHERE n->>'kind'='work');
  FOR node IN SELECT value FROM jsonb_array_elements(c->'nodes') LOOP
   FOR person IN SELECT value FROM jsonb_array_elements(node->'staff') LOOP
    INSERT INTO public.contract_task_assignments(task_id,engagement_id,workspace_id,staff_id,assignee_user_id,active)
    SELECT (node->>'taskId')::uuid,e.id,e.workspace_id,s.id,s.user_id,true FROM public.invoicing_staff s WHERE s.id=(person->>'staffId')::uuid
    ON CONFLICT(task_id,staff_id) DO UPDATE SET active=true,assignee_user_id=excluded.assignee_user_id;
   END LOOP;
  END LOOP;
 ELSIF k='capacity' THEN
  SELECT * INTO staff_row FROM public.invoicing_staff WHERE id=(c->>'staffId')::uuid AND workspace_id=e.workspace_id AND active;
  IF staff_row.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.contract_task_assignments a WHERE a.engagement_id=e.id AND a.staff_id=staff_row.id AND a.active) THEN RAISE EXCEPTION 'Capacity must belong to assigned active staff' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(version),0) INTO v FROM public.contract_capacity_versions WHERE staff_id=staff_row.id;
  IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Shared staff availability changed' USING ERRCODE='PT409'; END IF;
  IF (c->>'startsOn')::date>(c->>'endsOn')::date OR (c->>'hoursPerDay')::numeric NOT BETWEEN 0 AND 24 OR coalesce(length(trim(c->>'evidence')),0)=0 THEN RAISE EXCEPTION 'Document an ordered capacity period with at most 24 daily hours' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_capacity_versions(engagement_id,workspace_id,staff_id,version,content,created_by) VALUES(e.id,e.workspace_id,staff_row.id,v+1,c,p_actor_id) RETURNING id INTO record_id;
 ELSIF k='work_update' THEN
  SELECT * INTO staff_row FROM public.invoicing_staff WHERE id=(c->>'staffId')::uuid AND workspace_id=e.workspace_id AND active;
  IF staff_row.id IS NULL OR (actor_role='member' AND staff_row.user_id IS DISTINCT FROM p_actor_id) OR NOT EXISTS(SELECT 1 FROM public.contract_task_assignments a WHERE a.engagement_id=e.id AND a.task_id=(c->>'taskId')::uuid AND a.staff_id=staff_row.id AND a.active) THEN RAISE EXCEPTION 'Submit remaining work only for an active staff assignment' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(version),0) INTO v FROM public.contract_work_updates WHERE task_id=(c->>'taskId')::uuid AND staff_id=staff_row.id;
  IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Remaining-work update changed' USING ERRCODE='PT409'; END IF;
  IF coalesce(length(trim(c->>'evidence')),0)=0 OR (c->>'hours')::numeric<0 OR (c->>'availableHoursPerDay')::numeric NOT BETWEEN 0 AND 24 OR (c->>'actualFinish')::date<(c->>'actualStart')::date OR (c->>'actualFinish')::date>(c->>'asOf')::date OR (c->>'actualStart')::date>(c->>'asOf')::date OR (c->>'status'='reported_complete' AND ((c->>'hours')::numeric IS DISTINCT FROM 0 OR c->>'actualFinish' IS NULL)) THEN RAISE EXCEPTION 'Complete and consistent remaining-work evidence required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_work_updates(engagement_id,workspace_id,task_id,staff_id,version,state,content,created_by) VALUES(e.id,e.workspace_id,(c->>'taskId')::uuid,staff_row.id,v+1,'submitted',c,p_actor_id) RETURNING id INTO record_id;
 ELSIF k='work_review' THEN
  SELECT * INTO old FROM public.contract_work_updates WHERE id=(p_command->>'updateId')::uuid AND engagement_id=e.id;
  SELECT max(version) INTO v FROM public.contract_work_updates WHERE task_id=old.task_id AND staff_id=old.staff_id;
  IF old.id IS NULL OR old.state<>'submitted' OR old.version IS DISTINCT FROM v OR v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Review the exact current submitted work update' USING ERRCODE='PT409'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.contract_task_assignments a JOIN public.invoicing_staff s ON s.id=a.staff_id WHERE a.engagement_id=e.id AND a.task_id=old.task_id AND a.staff_id=old.staff_id AND a.active AND s.active) THEN RAISE EXCEPTION 'Reconcile changed or departed staff before review' USING ERRCODE='42501'; END IF;
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
REVOKE ALL ON FUNCTION public.record_contract_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_contract_command(uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.read_contract_delivery(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
  WITH latest AS (SELECT DISTINCT ON(s.engagement_id) s.content FROM public.contract_schedules s WHERE s.workspace_id=e.workspace_id AND s.created_at<=p_cutoff AND s.engagement_id<>e.id ORDER BY s.engagement_id,s.version DESC),
  reservations AS (SELECT (p->>'staffId')::uuid staff_id,day::date reserved_date,(p->>'hoursPerDay')::numeric hours
   FROM latest CROSS JOIN LATERAL jsonb_array_elements(content->'nodes') n CROSS JOIN LATERAL jsonb_array_elements(n->'staff') p
   CROSS JOIN LATERAL generate_series((n->>'notBefore')::date,least((n->>'reserveThrough')::date,(n->>'notBefore')::date+730),'1 day') day
   WHERE (p->>'staffId')::uuid=ANY(staff_ids)
    AND coalesce((SELECT (x->>'working')::boolean FROM jsonb_array_elements(n->'calendar'->'exceptions') x WHERE x->>'date'=day::date::text LIMIT 1),(n->'calendar'->'weekdays') @> to_jsonb(extract(dow FROM day)::integer)))
  SELECT coalesce(jsonb_agg(jsonb_build_object('staffId',staff_id,'date',reserved_date,'hours',hours::text) ORDER BY staff_id,reserved_date),'[]') INTO outside FROM (SELECT staff_id,reserved_date,sum(hours) hours FROM reservations GROUP BY staff_id,reserved_date) aggregated;
 END IF;
 RETURN jsonb_build_object('scheduleVersions',schedules,'workUpdates',updates,'capacityVersions',capacities,'outsideReservations',coalesce(outside,'[]'),'inputHash',CASE WHEN manager THEN public.contract_delivery_hash(e.workspace_id) ELSE '' END,'forecasts',CASE WHEN manager THEN coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.version) FROM public.contract_forecasts f WHERE f.engagement_id=e.id AND f.created_at<=p_cutoff),'[]') ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.read_contract_delivery(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contract_delivery(uuid,uuid,timestamptz) TO service_role;

ALTER FUNCTION public.read_contract_management(uuid,uuid,timestamptz) RENAME TO read_contract_management_agency;
REVOKE ALL ON FUNCTION public.read_contract_management_agency(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.read_contract_management_agency(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role'='pm' THEN result:=result||jsonb_build_object('unmappedSpendCount',jsonb_array_length(result->'unmappedSpend'),'unmappedSpend','[]'::jsonb); END IF;
 result:=result||jsonb_build_object('staff',coalesce((SELECT jsonb_agg(person||jsonb_build_object('active',coalesce((person->>'active')::boolean,false) AND (person->>'user_id' IS NULL OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=(result->'engagement'->>'workspace_id')::uuid AND m.user_id=(person->>'user_id')::uuid)))) FROM jsonb_array_elements(result->'staff') person),'[]'));
 -- Snapshot reports retain already-issued forecasts as separate immutable history. Never recompute an old report.
 IF result->>'role' IN ('owner','admin','pm','finance','member') THEN result:=result||jsonb_build_object('schemaVersion',3,'delivery',public.read_contract_delivery(p_engagement_id,p_actor_id,p_cutoff)); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) TO service_role;

CREATE VIEW public.contract_delivery_my_work WITH(security_invoker=true) AS
 SELECT u.id,u.workspace_id,u.engagement_id,u.task_id,t.project_id,t.title,auth.uid() AS assignee_user_id,u.content->>'asOf' AS reported_on
 FROM public.contract_work_updates u JOIN public.contract_tasks t ON t.id=u.task_id
 WHERE u.state='submitted' AND public.contract_can_manage(u.engagement_id)
 AND NOT EXISTS(SELECT 1 FROM public.contract_work_updates newer WHERE newer.task_id=u.task_id AND newer.staff_id=u.staff_id AND newer.version>u.version);
REVOKE ALL ON public.contract_delivery_my_work FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_delivery_my_work TO authenticated,service_role;
