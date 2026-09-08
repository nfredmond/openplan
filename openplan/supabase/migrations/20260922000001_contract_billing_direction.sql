-- Explicit agreement perspective is approved with the baseline, never inferred from invoice presence.
CREATE FUNCTION public.validate_contract_billing_direction() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.content ? 'billingDirection' AND (jsonb_typeof(NEW.content->'billingDirection') IS DISTINCT FROM 'string' OR NEW.content->>'billingDirection' NOT IN ('outgoing','received','internal','unassessed')) THEN
  RAISE EXCEPTION 'Unsupported agreement billing direction' USING ERRCODE='22023';
 END IF;
 IF NEW.content->>'billingDirection' IN ('outgoing','received','internal') AND coalesce(length(trim(NEW.content->>'feeTerms')),0)=0 THEN
  RAISE EXCEPTION 'Agreement billing direction requires retained terms evidence' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_contract_billing_direction() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER contract_billing_direction BEFORE INSERT OR UPDATE ON public.contract_baselines FOR EACH ROW EXECUTE FUNCTION public.validate_contract_billing_direction();

CREATE OR REPLACE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.read_contract_management_closeout(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role' IN ('owner','admin','pm','finance') THEN
  result:=result||jsonb_build_object('schemaVersion',6,'cutoffConflicts',coalesce((result->>'cutoffConflicts')::boolean,false) OR EXISTS(SELECT 1 FROM public.contract_source_changes c WHERE c.workspace_id=(result->'engagement'->>'workspace_id')::uuid AND c.changed_at>p_cutoff));
  result:=jsonb_set(result,'{responses,records}',coalesce((SELECT jsonb_agg(r) FROM jsonb_array_elements(result->'responses'->'records') r WHERE (r->>'updated_at')::timestamptz<=p_cutoff),'[]'::jsonb));
 END IF;
 IF result->>'role'='pm' THEN result:=result||jsonb_build_object('snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'created_at',s.created_at,'snapshot_hash',s.snapshot_hash) ORDER BY s.created_at DESC) FROM public.contract_snapshots s WHERE s.engagement_id=p_engagement_id AND s.created_at<=p_cutoff AND s.audience='management'),'[]')); END IF;
 RETURN result;
END $$;
