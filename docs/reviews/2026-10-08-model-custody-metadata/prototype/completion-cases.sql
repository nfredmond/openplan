
-- Separate run exercises final completion without the reassignment fixture.
INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT 'acdaaa46-865b-4f65-86d6-c246cd16cd12',workspace_id,model_id,engine_key,'queued','Synthetic completion',created_by
 FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
 ('349b2691-22fd-49c6-8877-db69996388b5','acdaaa46-865b-4f65-86d6-c246cd16cd12','Synthetic final stage','queued',1);
-- Force a parent failure to prove stage and receipt writes roll back together.
CREATE FUNCTION public.prototype_reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id='acdaaa46-865b-4f65-86d6-c246cd16cd12' AND NEW.status='succeeded' THEN
  RAISE EXCEPTION 'synthetic parent completion refusal';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER prototype_reject_completion BEFORE UPDATE ON model_runs
 FOR EACH ROW EXECUTE FUNCTION public.prototype_reject_completion();
SET LOCAL ROLE service_role;
DO $test$
DECLARE attempt uuid;
BEGIN
 attempt := (public.claim_model_stage_attempt('7c9b1fba-6868-4489-a621-4c7d8e4d25cb','349b2691-22fd-49c6-8877-db69996388b5','completion-worker')->>'attempt_id')::uuid;
 BEGIN
  PERFORM public.write_model_stage_attempt('127fc1a9-a9ca-43d7-af7c-4a938f61f10e',attempt,'succeeded','done',NULL);
  RAISE EXCEPTION 'parent completion omitted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'synthetic parent completion refusal' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT status FROM model_run_stages WHERE id='349b2691-22fd-49c6-8877-db69996388b5') <> 'running' THEN RAISE EXCEPTION 'stage escaped parent rollback'; END IF;
 IF EXISTS(SELECT 1 FROM model_stage_write_receipts WHERE request_id='127fc1a9-a9ca-43d7-af7c-4a938f61f10e') THEN RAISE EXCEPTION 'receipt escaped parent rollback'; END IF;
 IF EXISTS(SELECT 1 FROM model_run_write_context) OR EXISTS(SELECT 1 FROM model_stage_write_context) THEN RAISE EXCEPTION 'failed completion context leaked'; END IF;
END;
$test$;
DROP TRIGGER prototype_reject_completion ON model_runs;
DROP FUNCTION public.prototype_reject_completion();
SET LOCAL ROLE service_role;
DO $test$
DECLARE attempt uuid; result jsonb;
BEGIN
 attempt := (public.claim_model_stage_attempt('7c9b1fba-6868-4489-a621-4c7d8e4d25cb','349b2691-22fd-49c6-8877-db69996388b5','completion-worker')->>'attempt_id')::uuid;
 result := public.write_model_stage_attempt('127fc1a9-a9ca-43d7-af7c-4a938f61f10e',attempt,'succeeded','done',NULL);
 IF result->>'run_status' <> 'succeeded' OR result->>'run_completed_at' IS NULL THEN RAISE EXCEPTION 'run completion absent'; END IF;
 IF public.write_model_stage_attempt('127fc1a9-a9ca-43d7-af7c-4a938f61f10e',attempt,'succeeded','done',NULL) IS DISTINCT FROM result THEN RAISE EXCEPTION 'run completion retry changed'; END IF;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT status FROM model_runs WHERE id='acdaaa46-865b-4f65-86d6-c246cd16cd12') <> 'succeeded' THEN RAISE EXCEPTION 'persisted run completion absent'; END IF;
 IF EXISTS(SELECT 1 FROM model_run_write_context) THEN RAISE EXCEPTION 'completion context leaked'; END IF;
END;
$test$;
