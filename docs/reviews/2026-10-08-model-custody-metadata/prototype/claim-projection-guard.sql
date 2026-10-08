-- Refuse legacy projections until an attempt-bound scientific ingestion command
-- exists. This is not an implementation of that command or a claim promotion.
CREATE FUNCTION public.guard_managed_model_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_run uuid; new_run uuid;
BEGIN
 IF TG_OP <> 'INSERT' THEN old_run := OLD.model_run_id; END IF;
 IF TG_OP <> 'DELETE' THEN new_run := NEW.model_run_id; END IF;
 PERFORM id FROM public.model_runs WHERE id IN (old_run,new_run) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.model_runs WHERE id IN (old_run,new_run) AND attempt_managed) THEN
  RAISE EXCEPTION 'Managed model scientific projection requires attempt-bound ingestion';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_managed_model_projection() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_managed_model_projection BEFORE INSERT OR UPDATE OR DELETE ON public.modeling_claim_decisions
 FOR EACH ROW EXECUTE FUNCTION public.guard_managed_model_projection();
CREATE TRIGGER guard_managed_model_projection BEFORE INSERT OR UPDATE OR DELETE ON public.modeling_validation_results
 FOR EACH ROW EXECUTE FUNCTION public.guard_managed_model_projection();
