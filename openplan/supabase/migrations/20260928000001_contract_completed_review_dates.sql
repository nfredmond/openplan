-- Actual outside-review dates remain evidenced facts, separate from acceptance decisions.
CREATE OR REPLACE FUNCTION public.guard_contract_completed_reviews() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE node jsonb; actual jsonb;
BEGIN
 FOR node IN SELECT value FROM jsonb_array_elements(NEW.content->'nodes') LOOP
  actual:=node->'completedReview';
  IF actual IS NULL OR actual='null'::jsonb THEN CONTINUE;END IF;
  IF jsonb_typeof(actual) IS DISTINCT FROM 'object' OR node->>'kind' NOT IN ('client_review','agency_review','public_review')
   OR node->>'kind' IS NULL OR coalesce(length(trim(actual->>'evidence')),0)=0
   OR coalesce(actual->>'startedOn','')!~'^\d{4}-\d{2}-\d{2}$' OR coalesce(actual->>'finishedOn','')!~'^\d{4}-\d{2}-\d{2}$'
  THEN RAISE EXCEPTION 'Completed outside review requires actual dates and evidence' USING ERRCODE='22023';END IF;
  IF (actual->>'startedOn')::date>(actual->>'finishedOn')::date OR (actual->>'finishedOn')::date>NEW.created_at::date
  THEN RAISE EXCEPTION 'Completed review dates are reversed or in the future' USING ERRCODE='22023';END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER completed_review_dates BEFORE INSERT ON public.contract_schedules FOR EACH ROW EXECUTE FUNCTION public.guard_contract_completed_reviews();
REVOKE ALL ON FUNCTION public.guard_contract_completed_reviews() FROM PUBLIC,anon,authenticated,service_role;
-- New calculations recognize separately evidenced completed reviews. Prior issued results remain immutable.
CREATE OR REPLACE FUNCTION public.contract_delivery_hash(p_workspace_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT encode(extensions.digest(coalesce(string_agg(x,'|' ORDER BY x),''),'sha256'),'hex') FROM (
 SELECT 'method:contract-delivery-v4-completed-reviews' x
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
 UNION ALL SELECT 'received:'||id FROM public.contract_received_invoices WHERE workspace_id=p_workspace_id
 UNION ALL SELECT 'invoice:'||id||':'||updated_at FROM public.client_invoices WHERE workspace_id=p_workspace_id
 ) versions
$$;
