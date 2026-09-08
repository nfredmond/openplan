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
 AND NOT EXISTS(SELECT 1 FROM public.contract_management_responses newer WHERE newer.engagement_id=r.engagement_id AND (newer.created_at,newer.id)>(r.created_at,r.id));
REVOKE ALL ON public.contract_pending_my_work FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contract_pending_my_work TO authenticated,service_role;
