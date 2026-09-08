-- Operational attribution is additive. Existing contracts, billing rates and unmapped rows keep their meaning.
ALTER TABLE public.invoicing_time_entries ALTER COLUMN engagement_id DROP NOT NULL;
ALTER TABLE public.invoicing_time_entries ADD COLUMN work_program_id uuid REFERENCES public.programs(id);
ALTER TABLE public.project_spend_entries ADD COLUMN work_program_id uuid REFERENCES public.programs(id);
ALTER TABLE public.invoicing_time_entries ADD CONSTRAINT time_requires_context CHECK(engagement_id IS NOT NULL OR work_program_id IS NOT NULL);

CREATE TABLE public.work_program_cost_rates (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id), staff_id uuid NOT NULL REFERENCES public.invoicing_staff(id),
 starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on), hourly_cost numeric(14,2) NOT NULL CHECK(hourly_cost>=0),
 source_reference text NOT NULL CHECK(length(trim(source_reference))>0), approved_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.work_program_actual_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 program_id uuid NOT NULL REFERENCES public.programs(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 revision_id uuid NOT NULL REFERENCES public.program_work_program_revisions(id), source_key text NOT NULL,
 entry_date date NOT NULL, kind text NOT NULL CHECK(kind IN ('labor','expense','opening','commitment','billed','payment')),
 staff_id uuid REFERENCES public.invoicing_staff(id), time_entry_id uuid REFERENCES public.invoicing_time_entries(id), spend_entry_id uuid REFERENCES public.project_spend_entries(id),
 hours numeric(12,2), amount numeric(16,2), valuation_basis text NOT NULL CHECK(valuation_basis IN ('recorded','cost_rate','unvalued')),
 cost_rate_id uuid REFERENCES public.work_program_cost_rates(id), status text NOT NULL CHECK(status IN ('draft','approved','excluded')),
 detail jsonb NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(entry_id,version)
);
CREATE INDEX work_program_actuals_history ON public.work_program_actual_versions(program_id,created_at,id);
CREATE TABLE public.work_program_actual_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actual_version_id uuid NOT NULL REFERENCES public.work_program_actual_versions(id),
 element_id uuid NOT NULL, task_id uuid, deliverable_id uuid REFERENCES public.project_deliverables(id), share integer NOT NULL CHECK(share>0 AND share<=10000),
 amount numeric(16,2), hours numeric(12,2)
);
CREATE TABLE public.work_program_reporting_periods (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES public.programs(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on),
 baseline_id uuid REFERENCES public.program_work_program_revisions(id), source_cutoff timestamptz NOT NULL,
 version integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','review','returned','issued','correcting')),
 progress jsonb NOT NULL DEFAULT '[]', note text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.work_program_period_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid NOT NULL REFERENCES public.work_program_reporting_periods(id),
 program_id uuid NOT NULL REFERENCES public.programs(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 version integer NOT NULL, snapshot jsonb NOT NULL, snapshot_hash text NOT NULL, issued_by uuid NOT NULL REFERENCES auth.users(id), issued_at timestamptz NOT NULL DEFAULT now(),
 corrects_report_id uuid REFERENCES public.work_program_period_reports(id), UNIQUE(period_id,version)
);
CREATE TABLE public.work_program_reporting_commands (
 program_id uuid NOT NULL REFERENCES public.programs(id), request_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id),
 command jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(program_id,request_id)
);

-- Private payroll valuations and the reports containing them are administrator-only, including direct SQL/API reads.
ALTER TABLE public.work_program_cost_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_program_cost_rates FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_cost_rates TO authenticated,service_role;
ALTER TABLE public.work_program_actual_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_program_actual_versions FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_actual_versions TO authenticated,service_role;
ALTER TABLE public.work_program_actual_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_program_actual_allocations FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_actual_allocations TO authenticated,service_role;
ALTER TABLE public.work_program_reporting_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_program_reporting_periods FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_reporting_periods TO authenticated,service_role;
ALTER TABLE public.work_program_period_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_program_period_reports FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_period_reports TO authenticated,service_role;
ALTER TABLE public.work_program_reporting_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_program_reporting_commands FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_reporting_commands TO service_role;
CREATE POLICY private_management_read ON public.work_program_cost_rates FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=work_program_cost_rates.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE POLICY private_management_read ON public.work_program_actual_versions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=work_program_actual_versions.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE POLICY private_management_read ON public.work_program_reporting_periods FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=work_program_reporting_periods.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE POLICY private_management_read ON public.work_program_period_reports FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=work_program_period_reports.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE POLICY private_allocation_read ON public.work_program_actual_allocations FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.work_program_actual_versions v WHERE v.id=actual_version_id));
CREATE POLICY own_staff_read ON public.invoicing_staff FOR SELECT TO authenticated USING(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=invoicing_staff.workspace_id AND m.user_id=auth.uid() AND m.role='member'));
CREATE POLICY own_agency_time_read ON public.invoicing_time_entries FOR SELECT TO authenticated USING(work_program_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.invoicing_staff s JOIN public.workspace_members m ON m.workspace_id=s.workspace_id WHERE s.id=staff_id AND s.user_id=auth.uid() AND m.user_id=auth.uid() AND m.role='member'));

-- All writes use the serialized command below. Ordinary APIs cannot silently edit or delete mapped source records.
CREATE FUNCTION public.guard_work_program_source_actual() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p uuid; w uuid; sid uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.work_program_id IS NOT NULL THEN RAISE EXCEPTION 'Mapped actuals require a recorded correction' USING ERRCODE='42501'; END IF;
  RETURN OLD;
 END IF;
 p:=NEW.work_program_id;
 IF TG_OP='UPDATE' AND OLD.work_program_id IS NOT NULL AND current_user<>'postgres' AND
   (to_jsonb(NEW)-'billed_line_item_id'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'billed_line_item_id'-'updated_at')
 THEN RAISE EXCEPTION 'Mapped actuals require a recorded correction' USING ERRCODE='42501'; END IF;
 IF p IS NULL THEN RETURN NEW; END IF;
 IF (TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.work_program_id IS DISTINCT FROM OLD.work_program_id)) AND current_user<>'postgres' THEN RAISE EXCEPTION 'Use the actuals command to attribute source records' USING ERRCODE='42501'; END IF;
 SELECT workspace_id INTO w FROM public.programs WHERE id=p;
 IF TG_TABLE_NAME='invoicing_time_entries' THEN
  IF NEW.workspace_id IS DISTINCT FROM w OR NOT EXISTS(SELECT 1 FROM public.invoicing_staff s WHERE s.id=NEW.staff_id AND s.workspace_id=w)
  OR (NEW.engagement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.invoicing_engagements e WHERE e.id=NEW.engagement_id AND e.workspace_id=w AND (NEW.deliverable_id IS NULL OR EXISTS(SELECT 1 FROM public.project_deliverables d WHERE d.id=NEW.deliverable_id AND d.project_id=e.project_id))))
  THEN RAISE EXCEPTION 'Foreign time attribution' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.projects x WHERE x.id=NEW.project_id AND x.workspace_id=w) THEN RAISE EXCEPTION 'Foreign spending attribution' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_work_program_time BEFORE INSERT OR UPDATE OR DELETE ON public.invoicing_time_entries FOR EACH ROW EXECUTE FUNCTION public.guard_work_program_source_actual();
CREATE TRIGGER guard_work_program_spend BEFORE INSERT OR UPDATE OR DELETE ON public.project_spend_entries FOR EACH ROW EXECUTE FUNCTION public.guard_work_program_source_actual();

CREATE FUNCTION public.record_work_program_actual(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 IF st='approved' AND k='labor' AND EXISTS(SELECT 1 FROM public.work_program_actual_versions v WHERE v.workspace_id=w AND v.staff_id=s.id AND v.entry_date=dt AND v.entry_id<>eid AND v.kind='labor' AND v.status<>'excluded' AND NOT EXISTS(SELECT 1 FROM public.work_program_actual_versions n WHERE n.entry_id=v.entry_id AND n.version>v.version))
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
