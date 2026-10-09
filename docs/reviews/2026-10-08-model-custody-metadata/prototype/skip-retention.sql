-- A decision receipt is immutable even when no stage was skipped.
CREATE FUNCTION public.refuse_model_stage_skip_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Model stage skip receipt is immutable' USING ERRCODE='55000';
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_model_stage_skip_receipt_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER refuse_model_stage_skip_receipt_mutation
 BEFORE UPDATE OR DELETE ON public.model_stage_skip_receipts
 FOR EACH ROW EXECUTE FUNCTION public.refuse_model_stage_skip_receipt_mutation();
CREATE INDEX model_stage_skip_receipts_run_idx ON public.model_stage_skip_receipts(run_id);
CREATE INDEX model_stage_skip_receipts_stage_idx ON public.model_stage_skip_receipts(stage_id);
CREATE INDEX model_stage_skip_receipts_blocker_idx ON public.model_stage_skip_receipts(blocker_id);

-- A successful skip changes the required stage history. A no-op receipt alone
-- is not execution and must not prevent a genuinely unstarted run progressing.
CREATE OR REPLACE FUNCTION public.model_run_has_retained_commands(p_run uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_legacy_kpi_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_assessment_command_receipts WHERE run_id=p_run)
     OR EXISTS(SELECT 1 FROM public.model_stage_skip_receipts WHERE run_id=p_run AND response_payload->>'outcome'='skipped');
$$;
REVOKE ALL ON FUNCTION public.model_run_has_retained_commands(uuid) FROM PUBLIC,anon,authenticated,service_role;
