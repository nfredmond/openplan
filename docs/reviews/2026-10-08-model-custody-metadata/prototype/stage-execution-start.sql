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
