-- Received invoice versions and the calculation revision invalidate prior forecast inputs.
CREATE OR REPLACE FUNCTION public.contract_delivery_hash(p_workspace_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT encode(extensions.digest(coalesce(string_agg(x,'|' ORDER BY x),''),'sha256'),'hex') FROM (
 SELECT 'method:contract-delivery-v3-billing-direction' x
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
