-- Avoid repeatedly copying full forecast inputs through the management reader layers.
CREATE OR REPLACE FUNCTION public.read_contract_management_delivery(p_engagement_id uuid, p_actor_id uuid, p_cutoff timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result jsonb;
BEGIN
 result:=public.read_contract_management_agency(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role'='pm' THEN result:=result||jsonb_build_object('unmappedSpendCount',jsonb_array_length(result->'unmappedSpend'),'unmappedSpend','[]'::jsonb); END IF;
 result:=result||jsonb_build_object('staff',coalesce((SELECT jsonb_agg(person||jsonb_build_object('active',coalesce((person->>'active')::boolean,false) AND (person->>'user_id' IS NULL OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=(result->'engagement'->>'workspace_id')::uuid AND m.user_id=(person->>'user_id')::uuid)))) FROM jsonb_array_elements(result->'staff') person),'[]'));
 -- Snapshot reports retain already-issued forecasts as separate immutable history. Never recompute an old report.
 IF result->>'role' IN ('owner','admin','pm','finance','member') THEN result:=result||jsonb_build_object('schemaVersion',3); END IF;
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.read_contract_management(p_engagement_id uuid, p_actor_id uuid, p_cutoff timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result jsonb; workspace uuid; delivery_evidence jsonb;
BEGIN
 result:=public.read_contract_management_source_receipts(p_engagement_id,p_actor_id,p_cutoff);
 -- Attach the complete retained delivery evidence once, after the other management layers.
 IF result->>'role' IN ('owner','admin','pm','finance','member') THEN delivery_evidence:=public.read_contract_delivery(p_engagement_id,p_actor_id,p_cutoff); END IF;
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
 RETURN result||jsonb_build_object('openForWork',coalesce((SELECT c.state<>'closed' FROM public.contract_closeouts c WHERE c.engagement_id=p_engagement_id AND c.created_at<=p_cutoff ORDER BY c.version DESC LIMIT 1),true)) || CASE WHEN delivery_evidence IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('delivery',delivery_evidence) END;
END $function$;

REVOKE ALL ON FUNCTION public.read_contract_management_delivery(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) TO service_role;

-- Bracket a calculation input read without transferring retained forecasts twice more.
CREATE FUNCTION public.read_contract_delivery_version(p_engagement_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; actor_role text;
BEGIN
 actor_role:=public.contract_actor_role(p_engagement_id,p_actor_id);
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin','pm','finance') THEN
  RAISE EXCEPTION 'Contract forecast access denied' USING ERRCODE='42501';
 END IF;
 SELECT workspace_id INTO workspace FROM public.invoicing_engagements WHERE id=p_engagement_id;
 RETURN jsonb_build_object('inputHash',public.contract_delivery_hash(workspace));
END $$;
REVOKE ALL ON FUNCTION public.read_contract_delivery_version(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contract_delivery_version(uuid,uuid) TO service_role;
