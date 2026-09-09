-- Retain consultant access to their invoice history while disclosing only assignment state.
CREATE OR REPLACE VIEW public.contract_participant_my_work WITH(security_invoker=true,security_barrier=true) AS
 SELECT id,title,returned_invoices,public.contract_open_for_work(id) AS open_for_work
 FROM public.contract_participant_work_rows();

-- Preserve the source-visibility reader and add the caller-authorized state at its cutoff.
CREATE OR REPLACE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; workspace uuid;
BEGIN
 result:=public.read_contract_management_source_receipts(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role' IN ('owner','admin','pm','finance') THEN
  workspace:=(result->'engagement'->>'workspace_id')::uuid;
  INSERT INTO public.contract_source_observations(source_change_id)
   SELECT c.id FROM public.contract_source_changes c
   WHERE c.workspace_id=workspace AND NOT EXISTS(SELECT 1 FROM public.contract_source_observations o WHERE o.source_change_id=c.id)
   ORDER BY c.id
   ON CONFLICT(source_change_id) DO NOTHING;
  result:=result||jsonb_build_object('cutoffConflicts',coalesce((result->>'cutoffConflicts')::boolean,false) OR EXISTS(
   SELECT 1 FROM public.contract_source_changes c LEFT JOIN public.contract_source_observations o ON o.source_change_id=c.id
   WHERE c.workspace_id=workspace AND c.transaction_id<>pg_current_xact_id()
    AND (o.observed_at IS NULL OR o.observed_at>p_cutoff)
  ));
 END IF;
 RETURN result||jsonb_build_object('openForWork',coalesce((SELECT c.state<>'closed' FROM public.contract_closeouts c WHERE c.engagement_id=p_engagement_id AND c.created_at<=p_cutoff ORDER BY c.version DESC LIMIT 1),true));
END $$;
REVOKE ALL ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) TO service_role;
