-- Preserve receipt-backed legacy records while continuation is implemented.
-- This does not authorize replay or convert historical receipts into leases.
CREATE FUNCTION public.model_run_has_retained_commands(p_run uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_legacy_kpi_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_assessment_command_receipts WHERE run_id=p_run);
$$;
REVOKE ALL ON FUNCTION public.model_run_has_retained_commands(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_retained_model_outputs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; following jsonb; run uuid;
BEGIN
 prior:=to_jsonb(OLD);
 IF TG_OP='UPDATE' THEN following:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='model_runs' THEN run:=OLD.id;
 ELSIF TG_TABLE_NAME IN('modeling_claim_decisions','modeling_validation_results') THEN run:=(prior->>'model_run_id')::uuid;
 ELSE run:=(prior->>'run_id')::uuid;
 END IF;
 -- Serialize against the parent lock held by command registration.
 PERFORM id FROM public.model_runs WHERE id=run FOR UPDATE;
 IF public.model_run_has_retained_commands(run) THEN
  IF TG_TABLE_NAME='model_runs' AND TG_OP='UPDATE' THEN
   IF NEW.status='queued' AND OLD.status IS DISTINCT FROM NEW.status
      OR NEW.input_snapshot_json IS DISTINCT FROM OLD.input_snapshot_json
      OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.model_id IS DISTINCT FROM OLD.model_id
      OR NEW.engine_key IS DISTINCT FROM OLD.engine_key THEN
    RAISE EXCEPTION 'Retained model outputs require continuation reconciliation' USING ERRCODE='55000';
   END IF;
  ELSIF TG_TABLE_NAME='model_run_stages' AND TG_OP='UPDATE' THEN
   IF NEW.status='queued' AND OLD.status IS DISTINCT FROM NEW.status
      OR NEW.run_id IS DISTINCT FROM OLD.run_id
      OR NEW.stage_name IS DISTINCT FROM OLD.stage_name
      OR NEW.sort_order IS DISTINCT FROM OLD.sort_order THEN
    RAISE EXCEPTION 'Retained model outputs require continuation reconciliation' USING ERRCODE='55000';
   END IF;
  ELSIF TG_OP='DELETE' OR following IS DISTINCT FROM prior THEN
   RAISE EXCEPTION 'Retained model outputs cannot be replaced or deleted' USING ERRCODE='55000';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_retained_model_outputs() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_retained_model_outputs BEFORE UPDATE OR DELETE ON public.model_runs
 FOR EACH ROW EXECUTE FUNCTION public.guard_retained_model_outputs();
CREATE TRIGGER guard_retained_model_outputs BEFORE UPDATE OR DELETE ON public.model_run_stages
 FOR EACH ROW EXECUTE FUNCTION public.guard_retained_model_outputs();
CREATE TRIGGER guard_retained_model_outputs BEFORE UPDATE OR DELETE ON public.model_run_artifacts
 FOR EACH ROW EXECUTE FUNCTION public.guard_retained_model_outputs();
CREATE TRIGGER guard_retained_model_outputs BEFORE UPDATE OR DELETE ON public.model_run_kpis
 FOR EACH ROW EXECUTE FUNCTION public.guard_retained_model_outputs();
CREATE TRIGGER guard_retained_model_outputs BEFORE UPDATE OR DELETE ON public.modeling_claim_decisions
 FOR EACH ROW EXECUTE FUNCTION public.guard_retained_model_outputs();
CREATE TRIGGER guard_retained_model_outputs BEFORE UPDATE OR DELETE ON public.modeling_validation_results
 FOR EACH ROW EXECUTE FUNCTION public.guard_retained_model_outputs();
