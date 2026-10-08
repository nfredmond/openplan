-- Preserve retained model execution and outputs across uncertain replies.
-- Stop workers before upgrade. Historical worker runs remain read-only pending
-- reconciliation; this migration does not authorize replay or scientific use.

-- Keep enrollment locking and trigger installation atomic under both CLI reset
-- and migration-up execution paths.
BEGIN;

-- retained-output-protection.sql
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
DECLARE prior jsonb; following jsonb; run uuid; next_run uuid; scoped record; retained boolean:=false;
BEGIN
 prior:=to_jsonb(OLD);
 IF TG_OP='UPDATE' THEN following:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='model_runs' THEN run:=OLD.id; next_run:=(following->>'id')::uuid;
 ELSIF TG_TABLE_NAME IN('modeling_claim_decisions','modeling_validation_results') THEN run:=(prior->>'model_run_id')::uuid; next_run:=(following->>'model_run_id')::uuid;
 ELSE run:=(prior->>'run_id')::uuid; next_run:=(following->>'run_id')::uuid;
 END IF;
 -- Serialize against the parent lock held by command registration.
 FOR scoped IN SELECT id FROM public.model_runs WHERE id IN(run,next_run) ORDER BY id FOR UPDATE LOOP
  IF public.model_run_has_retained_commands(scoped.id) THEN retained:=true; END IF;
 END LOOP;
 IF retained THEN
  IF TG_TABLE_NAME='model_runs' AND TG_OP='UPDATE' THEN
   IF NEW.status='queued'
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


-- stage-execution-start.sql
-- Record a new stage claim before the worker can begin local computation.
-- No historical execution or scientific completion is inferred here.
CREATE TABLE public.model_stage_execution_starts (
 stage_id uuid PRIMARY KEY REFERENCES public.model_run_stages(id) ON DELETE RESTRICT,
 run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 boundary text NOT NULL CHECK(boundary IN('queued_to_running','inserted_running'))
);
CREATE INDEX model_stage_execution_starts_run_idx ON public.model_stage_execution_starts(run_id);
ALTER TABLE public.model_stage_execution_starts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_stage_execution_starts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.refuse_model_stage_start_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Model stage execution start is immutable' USING ERRCODE='55000';
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_model_stage_start_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER refuse_model_stage_start_mutation BEFORE UPDATE OR DELETE ON public.model_stage_execution_starts
 FOR EACH ROW EXECUTE FUNCTION public.refuse_model_stage_start_mutation();

CREATE FUNCTION public.retain_model_stage_execution_start() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'running' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.status='running' THEN RETURN NEW; END IF;
 PERFORM id FROM public.model_runs WHERE id=NEW.run_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE stage_id=NEW.id) THEN
  RAISE EXCEPTION 'Model stage already started; reconcile before execution' USING ERRCODE='55000';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status<>'queued' THEN
  RAISE EXCEPTION 'Model stage start requires queued state' USING ERRCODE='55000';
 END IF;
 INSERT INTO public.model_stage_execution_starts(stage_id,run_id,boundary)
 VALUES(NEW.id,NEW.run_id,CASE WHEN TG_OP='INSERT' THEN 'inserted_running' ELSE 'queued_to_running' END);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.retain_model_stage_execution_start() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retain_model_stage_execution_start AFTER INSERT OR UPDATE ON public.model_run_stages
 FOR EACH ROW EXECUTE FUNCTION public.retain_model_stage_execution_start();

CREATE OR REPLACE FUNCTION public.model_run_has_retained_commands(p_run uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_legacy_kpi_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_assessment_command_receipts WHERE run_id=p_run);
$$;
REVOKE ALL ON FUNCTION public.model_run_has_retained_commands(uuid) FROM PUBLIC,anon,authenticated,service_role;


-- relaunch-custody-inspection.sql
-- Existing runs remain unassessed; an editable timestamp cannot grant replay.
LOCK TABLE public.model_runs IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.model_execution_custody_enrollment (
 run_id uuid PRIMARY KEY REFERENCES public.model_runs(id) ON DELETE RESTRICT,
 provenance text NOT NULL CHECK(provenance IN('historical_unassessed','new_run')),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.model_execution_custody_enrollment(run_id,provenance)
 SELECT id,'historical_unassessed' FROM public.model_runs;
ALTER TABLE public.model_execution_custody_enrollment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_execution_custody_enrollment FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER refuse_model_execution_enrollment_mutation BEFORE UPDATE OR DELETE ON public.model_execution_custody_enrollment
 FOR EACH ROW EXECUTE FUNCTION public.refuse_model_stage_start_mutation();
CREATE FUNCTION public.enroll_new_model_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.model_execution_custody_enrollment(run_id,provenance) VALUES(NEW.id,'new_run');
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enroll_new_model_execution() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enroll_new_model_execution AFTER INSERT ON public.model_runs
 FOR EACH ROW EXECUTE FUNCTION public.enroll_new_model_execution();

CREATE FUNCTION public.inspect_model_relaunch_custody(p_workspace uuid,p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.model_runs%ROWTYPE; provenance text; state text;
BEGIN
 IF p_workspace IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'Model recovery scope required'; END IF;
 SELECT * INTO parent FROM public.model_runs WHERE id=p_run AND workspace_id=p_workspace FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model recovery scope mismatch'; END IF;
 SELECT e.provenance INTO provenance FROM public.model_execution_custody_enrollment e WHERE run_id=p_run;
 IF provenance IS NULL THEN RAISE EXCEPTION 'Model recovery enrollment unavailable'; END IF;
 IF parent.attempt_managed OR public.model_run_has_retained_commands(p_run) THEN state:='retained';
 ELSIF provenance='historical_unassessed' OR EXISTS(
   SELECT 1 FROM public.model_run_stages WHERE run_id=p_run AND (status<>'queued' OR started_at IS NOT NULL)
 ) THEN state:='unassessed';
 ELSE state:='unstarted';
 END IF;
 RETURN jsonb_build_object('workspace_id',p_workspace,'run_id',p_run,'state',state);
END;
$$;
REVOKE ALL ON FUNCTION public.inspect_model_relaunch_custody(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_model_relaunch_custody(uuid,uuid) TO service_role;


-- historical-execution-fence.sql
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

COMMIT;
