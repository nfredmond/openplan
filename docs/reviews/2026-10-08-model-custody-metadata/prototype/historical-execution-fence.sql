-- Historical worker runs need reconciliation before new database mutations.
-- Operators still must stop workers before upgrade; SQL cannot stop computation.
CREATE FUNCTION public.guard_historical_model_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; following jsonb; old_run uuid; new_run uuid; parent record; enrollment text;
BEGIN
 IF TG_OP<>'INSERT' THEN prior:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN following:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='model_runs' THEN
  old_run:=(prior->>'id')::uuid; new_run:=(following->>'id')::uuid;
 ELSIF TG_TABLE_NAME IN('modeling_claim_decisions','modeling_validation_results') THEN
  old_run:=(prior->>'model_run_id')::uuid; new_run:=(following->>'model_run_id')::uuid;
 ELSE
  old_run:=(prior->>'run_id')::uuid; new_run:=(following->>'run_id')::uuid;
 END IF;
 FOR parent IN SELECT id,engine_key FROM public.model_runs WHERE id IN(old_run,new_run) ORDER BY id FOR UPDATE LOOP
  IF parent.engine_key IN('aequilibrae','behavioral_demand')
     OR (TG_TABLE_NAME='model_runs' AND following->>'engine_key' IN('aequilibrae','behavioral_demand')) THEN
   SELECT provenance INTO enrollment FROM public.model_execution_custody_enrollment WHERE run_id=parent.id;
   IF enrollment IS DISTINCT FROM 'new_run' THEN
    RAISE EXCEPTION 'Historical model execution requires reconciliation' USING ERRCODE='55000';
   END IF;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_historical_model_execution() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_historical_model_execution BEFORE UPDATE OR DELETE ON public.model_runs
 FOR EACH ROW EXECUTE FUNCTION public.guard_historical_model_execution();
CREATE TRIGGER guard_historical_model_execution BEFORE INSERT OR UPDATE OR DELETE ON public.model_run_stages
 FOR EACH ROW EXECUTE FUNCTION public.guard_historical_model_execution();
CREATE TRIGGER guard_historical_model_execution BEFORE INSERT OR UPDATE OR DELETE ON public.model_run_artifacts
 FOR EACH ROW EXECUTE FUNCTION public.guard_historical_model_execution();
CREATE TRIGGER guard_historical_model_execution BEFORE INSERT OR UPDATE OR DELETE ON public.model_run_kpis
 FOR EACH ROW EXECUTE FUNCTION public.guard_historical_model_execution();
CREATE TRIGGER guard_historical_model_execution BEFORE INSERT OR UPDATE OR DELETE ON public.modeling_claim_decisions
 FOR EACH ROW EXECUTE FUNCTION public.guard_historical_model_execution();
CREATE TRIGGER guard_historical_model_execution BEFORE INSERT OR UPDATE OR DELETE ON public.modeling_validation_results
 FOR EACH ROW EXECUTE FUNCTION public.guard_historical_model_execution();
