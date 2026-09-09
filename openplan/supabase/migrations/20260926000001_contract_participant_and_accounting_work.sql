-- Narrow caller-bound predicates expose no arbitrary-actor role or private source data.
CREATE OR REPLACE FUNCTION public.contract_is_participant(p_engagement_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.contract_actor_role(p_engagement_id,auth.uid())='consultant';
$$;
CREATE OR REPLACE FUNCTION public.contract_accounting_source_stale(p_version_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN public.contract_can_finance(v.engagement_id) THEN public.contract_shared_source_stale(v,now()) ELSE NULL END FROM public.contract_actual_versions v WHERE v.id=p_version_id;
$$;
REVOKE ALL ON FUNCTION public.contract_is_participant(uuid),public.contract_accounting_source_stale(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contract_is_participant(uuid),public.contract_accounting_source_stale(uuid) TO authenticated,service_role;
-- Review eligibility is scoped by the underlying contract policies, not by a new inbox authority.
CREATE OR REPLACE VIEW public.contract_pending_my_work WITH(security_invoker=true) AS
 SELECT b.id,b.workspace_id,b.engagement_id,e.project_id,e.title,'baseline'::text AS review_kind,b.created_at AS reported_on
 FROM public.contract_baselines b JOIN public.invoicing_engagements e ON e.id=b.engagement_id
 WHERE b.state='proposed' AND public.contract_can_finance(b.engagement_id)
 AND NOT EXISTS(SELECT 1 FROM public.contract_baselines newer WHERE newer.engagement_id=b.engagement_id AND newer.version>b.version)
 UNION ALL
 SELECT t.id,t.workspace_id,t.engagement_id,e.project_id,e.title,'master',t.created_at
 FROM public.contract_master_terms t JOIN public.invoicing_engagements e ON e.id=t.engagement_id
 WHERE t.state='proposed' AND public.contract_can_finance(t.engagement_id)
 AND NOT EXISTS(SELECT 1 FROM public.contract_master_terms newer WHERE newer.engagement_id=t.engagement_id AND newer.version>t.version)
 UNION ALL
 SELECT i.id,i.workspace_id,i.engagement_id,e.project_id,i.content->>'number',CASE WHEN i.state='reviewed' THEN 'received_finance' ELSE 'received_review' END,i.created_at
 FROM public.contract_received_invoices i JOIN public.invoicing_engagements e ON e.id=i.engagement_id
 WHERE ((i.state='submitted' AND public.contract_can_manage(i.engagement_id)) OR (i.state='reviewed' AND public.contract_can_finance(i.engagement_id)))
 AND NOT EXISTS(SELECT 1 FROM public.contract_received_invoices newer WHERE newer.invoice_id=i.invoice_id AND newer.version>i.version)
 UNION ALL
 SELECT r.id,r.workspace_id,r.engagement_id,e.project_id,r.content->'sourceRecord'->>'title','response',r.created_at
 FROM public.contract_management_responses r JOIN public.invoicing_engagements e ON e.id=r.engagement_id
 WHERE public.contract_can_manage(r.engagement_id)
 AND NOT EXISTS(SELECT 1 FROM public.contract_response_applications a WHERE a.response_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM public.contract_management_responses newer WHERE newer.engagement_id=r.engagement_id AND (newer.created_at,newer.id)>(r.created_at,r.id))
 UNION ALL
 SELECT i.id,i.workspace_id,i.engagement_id,e.project_id,i.filename,'accounting',i.created_at
 FROM public.contract_accounting_imports i JOIN public.invoicing_engagements e ON e.id=i.engagement_id
 WHERE public.contract_can_finance(i.engagement_id) AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(i.rows) WITH ORDINALITY imported(row,ordinality)
  LEFT JOIN LATERAL (SELECT r.* FROM public.contract_accounting_reviews r WHERE r.import_id=i.id AND r.row_index=ordinality-1 ORDER BY r.version DESC LIMIT 1) reviewed ON true
  LEFT JOIN public.contract_actual_versions actual ON actual.id=reviewed.actual_version_id
  WHERE reviewed.state IS DISTINCT FROM 'reconciled' OR actual.id IS NULL OR actual.command->>'status' IS DISTINCT FROM 'approved'
   OR public.contract_accounting_source_stale(actual.id)
   OR EXISTS(SELECT 1 FROM public.contract_actual_versions newer WHERE newer.entry_id=actual.entry_id AND newer.version>actual.version)
 );
REVOKE ALL ON public.contract_pending_my_work FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contract_pending_my_work TO authenticated,service_role;

-- External participants may have no workspace membership. This deliberately owner-read
-- view exposes only explicitly granted contract identity and the caller's own return count.
-- It grants no project, accounting, staff, rate, or other participant invoice access.
CREATE OR REPLACE VIEW public.contract_participant_my_work WITH(security_barrier=true) AS
 SELECT e.id,e.title,
  (SELECT count(*) FROM public.contract_received_invoices i WHERE i.engagement_id=e.id AND i.submitted_by=auth.uid() AND i.state='returned'
   AND NOT EXISTS(SELECT 1 FROM public.contract_received_invoices newer WHERE newer.invoice_id=i.invoice_id AND newer.version>i.version)) AS returned_invoices
 FROM public.invoicing_engagements e WHERE public.contract_is_participant(e.id);
REVOKE ALL ON public.contract_participant_my_work FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contract_participant_my_work TO authenticated;

-- Closing removes assignments from the active queue without changing their history.
CREATE OR REPLACE FUNCTION public.contract_open_for_work(p_engagement_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN public.contract_actor_role(p_engagement_id,auth.uid()) IS NULL THEN NULL ELSE coalesce((SELECT c.state<>'closed' FROM public.contract_closeouts c WHERE c.engagement_id=p_engagement_id ORDER BY c.version DESC LIMIT 1),true) END;
$$;
REVOKE ALL ON FUNCTION public.contract_open_for_work(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contract_open_for_work(uuid) TO authenticated,service_role;
CREATE OR REPLACE VIEW public.contract_active_tasks_my_work WITH(security_invoker=true) AS
 SELECT a.id,a.engagement_id,a.workspace_id,a.assignee_user_id,t.project_id,t.title,t.deadline
 FROM public.contract_task_assignments a JOIN public.contract_tasks t ON t.id=a.task_id
 WHERE a.active AND public.contract_open_for_work(a.engagement_id);
REVOKE ALL ON public.contract_active_tasks_my_work FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contract_active_tasks_my_work TO authenticated,service_role;
