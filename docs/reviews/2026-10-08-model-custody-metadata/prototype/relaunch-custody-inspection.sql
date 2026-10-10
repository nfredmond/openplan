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
