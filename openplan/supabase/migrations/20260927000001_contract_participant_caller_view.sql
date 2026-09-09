-- Keep the public view under caller privileges; the narrow function owns its read.
-- It accepts no actor or contract argument and returns only the caller's explicit grants.
CREATE OR REPLACE FUNCTION public.contract_participant_work_rows()
RETURNS TABLE(id uuid,title text,returned_invoices bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT e.id,e.title,
  (SELECT count(*) FROM public.contract_received_invoices i WHERE i.engagement_id=e.id AND i.submitted_by=auth.uid() AND i.state='returned'
   AND NOT EXISTS(SELECT 1 FROM public.contract_received_invoices newer WHERE newer.invoice_id=i.invoice_id AND newer.version>i.version))
 FROM public.invoicing_engagements e WHERE public.contract_is_participant(e.id);
$$;
REVOKE ALL ON FUNCTION public.contract_participant_work_rows() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contract_participant_work_rows() TO authenticated;
CREATE OR REPLACE VIEW public.contract_participant_my_work WITH(security_invoker=true,security_barrier=true) AS
 SELECT id,title,returned_invoices FROM public.contract_participant_work_rows();
REVOKE ALL ON public.contract_participant_my_work FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contract_participant_my_work TO authenticated;
