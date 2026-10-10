"""Exercise the claim prototype only in a named disposable PostgreSQL stack."""
from pathlib import Path
import json
import os
import re
import subprocess

container = os.environ.get("OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER", "")
if not re.fullmatch(r"supabase_db_openplan-restore-target-[1-9][0-9]*", container):
    raise SystemExit("Select a named disposable restore-target container explicitly")
root = Path(__file__).resolve().parent
source = (root / "claim.sql").read_text() + "\n" + (root / "write.sql").read_text() + "\n" + (root / "reap.sql").read_text() + "\n" + (root / "relaunch.sql").read_text() + "\n" + (root / "kpi.sql").read_text() + "\n" + (root / "artifact.sql").read_text() + "\n" + (root / "read-outputs.sql").read_text() + "\n" + (root / "claim-projection-guard.sql").read_text() + "\n" + (root / "instrument-custody.sql").read_text()
migration = os.environ.get("OPENPLAN_MODEL_ATTEMPT_MIGRATION")
if migration:
    source = Path(migration).read_text()
run_cases = (root / "run-cases.sql").read_text()
cases = (root / "claim-cases.sql").read_text() + run_cases + (root / "stage-set-cases.sql").read_text() + "\n" + (root / "write-cases.sql").read_text() + "\n" + (root / "reap-cases.sql").read_text() + run_cases + (root / "completion-cases.sql").read_text() + (root / "failure-cases.sql").read_text() + (root / "deletion-cases.sql").read_text() + (root / "relaunch-cases.sql").read_text() + (root / "kpi-cases.sql").read_text() + (root / "artifact-cases.sql").read_text() + (root / "historical-output-cases.sql").read_text() + (root / "read-output-cases.sql").read_text() + (root / "claim-projection-cases.sql").read_text() + (root / "instrument-cases.sql").read_text() + (root / "legacy-reaper-cases.sql").read_text() + (root / "enrollment-cases.sql").read_text()
command = ["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
absence_query = "SELECT to_regclass('public.model_stage_attempts') IS NULL AND to_regclass('public.model_stage_claim_receipts') IS NULL AND to_regclass('public.model_stage_write_context') IS NULL AND to_regclass('public.model_stage_write_receipts') IS NULL AND to_regclass('public.model_run_write_context') IS NULL AND to_regclass('public.model_run_relaunch_receipts') IS NULL AND to_regclass('public.model_kpi_write_context') IS NULL AND to_regclass('public.model_kpi_write_receipts') IS NULL AND to_regclass('public.model_artifact_write_context') IS NULL AND to_regclass('public.model_artifact_write_receipts') IS NULL AND to_regprocedure('public.read_model_attempt_outputs(uuid,uuid)') IS NULL AND to_regprocedure('public.guard_managed_model_projection()') IS NULL AND to_regclass('public.model_attempt_instrument_custody') IS NULL AND to_regclass('public.model_attempt_instrument_receipts') IS NULL AND to_regprocedure('public.guard_model_attempt_enrollment()') IS NULL;"

def assert_absent():
    result = subprocess.run(command, input=absence_query, text=True, capture_output=True, timeout=15, check=True)
    if result.stdout.strip() != "t":
        raise RuntimeError("Prototype tables already exist or rollback left state behind")

assert_absent()
reaper_query = "SELECT md5(pg_get_functiondef('public.reap_model_run_if_stale(uuid,timestamptz,text)'::regprocedure));"
reaper_before = subprocess.run(command, input=reaper_query, text=True, capture_output=True, timeout=15, check=True).stdout
results = []
for name, sql, expected_failure in [
    ("baseline", source, None),
    ("harmless", source + "\n-- Harmless claim control.\n", None),
    ("ignore-request-payload", source.replace("IF v_receipt.request_payload IS DISTINCT FROM v_request THEN", "IF false THEN"), "changed request accepted"),
    ("skip-prior-status", source.replace("s.status <> 'succeeded'", "false"), "prior stage bypassed"),
    ("allow-legacy-write", source.replace("IF OLD.attempt_managed OR NEW.attempt_managed THEN", "IF false THEN").replace("IF NOT EXISTS (SELECT 1 FROM public.model_stage_write_context c", "IF NEW.active_attempt_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.model_stage_write_context c"), "legacy write accepted"),
    ("ignore-terminal-state", source.replace("v_stage.status <> 'running'", "false"), "late write accepted"),
    ("ignore-write-payload", source.replace("IF v_receipt.request_payload IS DISTINCT FROM v_request THEN\n      RAISE EXCEPTION 'Model stage write", "IF false THEN\n      RAISE EXCEPTION 'Model stage write"), "changed write accepted"),
    ("bypass-attempt-identity-both", source.replace("v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id", "false").replace("AND c.attempt_id IS NOT DISTINCT FROM NEW.active_attempt_id", ""), "old attempt overwrote new owner"),
    ("forget-reaped-fence", source.replace("IF OLD.attempt_managed OR NEW.attempt_managed THEN", "IF OLD.active_attempt_id IS NOT NULL OR NEW.active_attempt_id IS NOT NULL THEN").replace("IF NOT EXISTS (SELECT 1 FROM public.model_stage_write_context c", "IF (SELECT status FROM public.model_runs WHERE id=NEW.run_id) <> 'failed' AND NOT EXISTS (SELECT 1 FROM public.model_stage_write_context c"), "legacy write after reaping accepted"),
    ("lose-revocation", source.replace("s.active_attempt_id=a.id", "false"), "revocation not recorded"),
    ("allow-parent-overwrite", source.replace("IF NEW.attempt_managed OR OLD.attempt_managed THEN", "IF false THEN"), "legacy parent overwrite accepted"),
    ("complete-before-required-stages", source.replace("AND status <> 'succeeded'", "AND false"), "unfinished run completed"),
    ("omit-parent-completion", source.replace("IF p_status='succeeded' THEN", "IF false THEN"), "parent completion omitted"),
    ("allow-stage-insertion", source.replace("IF TG_OP IN ('INSERT','DELETE') THEN", "IF TG_OP='INSERT' THEN RETURN NEW; END IF; IF TG_OP='DELETE' THEN"), "managed stage insertion accepted"),
    ("allow-stage-deletion", source.replace("IF TG_OP IN ('INSERT','DELETE') THEN", "IF TG_OP='DELETE' THEN RETURN OLD; END IF; IF TG_OP='INSERT' THEN"), "required stage deletion accepted"),
    ("allow-unclaimed-stage-update", source.replace("IF NOT EXISTS (SELECT 1 FROM public.model_stage_write_context c", "IF NEW.active_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.model_stage_write_context c"), "unclaimed required stage bypass accepted"),
    ("omit-failure-closure", source.replace("IF p_status='failed' THEN", "IF false THEN"), "parent failure omitted"),
    ("omit-failure-revocation", source.replace("s.run_id=v_run.id AND s.active_attempt_id=a.id", "false"), "failure left authority active"),
    ("allow-managed-run-deletion", source.replace("IF OLD.attempt_managed THEN", "IF false THEN"), "managed run deletion accepted"),
    ("ignore-relaunch-scope", source.replace('v_run.workspace_id IS DISTINCT FROM p_workspace_id', 'false'), 'cross workspace relaunch accepted'),
    ("ignore-relaunch-snapshot", source.replace('v_run.updated_at IS DISTINCT FROM p_expected_updated_at', 'false'), 'stale relaunch accepted'),
    ("ignore-retained-kpi", source.replace('EXISTS(SELECT 1 FROM public.model_run_kpis WHERE run_id=p_run_id)', 'false'), 'output-bearing relaunch accepted'),
    ("omit-relaunch-receipt", source.replace('INSERT INTO public.model_run_relaunch_receipts VALUES(p_request_id,v_request,v_response,v_prior_run,v_prior_stages,clock_timestamp());', 'NULL;'), 'relaunch receipt boundary omitted'),
    ("allow-legacy-kpi", source.replace("IF NEW.attempt_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_run AND attempt_managed) THEN", "IF NEW.attempt_id IS NOT NULL THEN"), 'legacy KPI accepted'),
    ("omit-kpi-value", source.replace("NOT p_payload ? 'value'", 'false'), 'missing KPI value accepted'),
    ("allow-revoked-kpi", source.replace("IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'\n     OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN", "IF false THEN"), 'revoked KPI accepted'),
    ("allow-legacy-artifact", source.replace("IF NEW.attempt_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_run AND attempt_managed) THEN\n  IF TG_OP <> 'INSERT' OR NOT EXISTS(SELECT 1 FROM public.model_artifact_write_context c", "IF NEW.attempt_id IS NOT NULL THEN\n  IF TG_OP <> 'INSERT' OR NOT EXISTS(SELECT 1 FROM public.model_artifact_write_context c"), 'legacy artifact accepted'),
    ("omit-artifact-hash", source.replace("coalesce(p_payload->>'content_hash','') !~ '^[0-9a-f]{64}$'", 'false'), 'missing artifact hash accepted'),
    ("allow-revoked-artifact", source.replace("IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'\n     OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN\n  RAISE EXCEPTION 'Model artifact", "IF false THEN\n  RAISE EXCEPTION 'Model artifact"), 'revoked artifact accepted'),
    ("ignore-artifact-request", source.replace("IF v_receipt.request_payload IS DISTINCT FROM v_request THEN\n   RAISE EXCEPTION 'Model artifact", "IF false THEN\n   RAISE EXCEPTION 'Model artifact"), 'changed artifact accepted'),
    ("allow-artifact-delete", source.replace("IF TG_OP <> 'INSERT' AND (OLD.attempt_id IS NOT NULL OR\n     EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed)) THEN\n  RAISE EXCEPTION 'Attempt artifact", "IF TG_OP = 'UPDATE' AND (OLD.attempt_id IS NOT NULL OR\n     EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed)) THEN\n  RAISE EXCEPTION 'Attempt artifact"), 'retained artifact deleted'),
    ("allow-historical-kpi", source.replace("EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed)) THEN\n  RAISE EXCEPTION 'Attempt KPI", "false) THEN\n  RAISE EXCEPTION 'Attempt KPI"), 'historical KPI delete accepted'),
    ("allow-historical-artifact", source.replace("EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed)) THEN\n  RAISE EXCEPTION 'Attempt artifact", "false) THEN\n  RAISE EXCEPTION 'Attempt artifact"), 'historical artifact delete accepted'),
    ("move-historical-kpi", source.replace("EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed)) THEN\n  RAISE EXCEPTION 'Attempt KPI", "(TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed))) THEN\n  RAISE EXCEPTION 'Attempt KPI"), 'historical KPI move accepted'),
    ("move-historical-artifact", source.replace("EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed)) THEN\n  RAISE EXCEPTION 'Attempt artifact", "(TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.model_runs WHERE id=v_old_run AND attempt_managed))) THEN\n  RAISE EXCEPTION 'Attempt artifact"), 'historical artifact move accepted'),
    ("ignore-output-read-scope", source.replace('id=p_run_id AND workspace_id=p_workspace_id;', 'id=p_run_id;'), 'cross workspace output read accepted'),
    ("invent-legacy-attempt", source.replace("WHEN o.attempt_id IS NULL THEN 'legacy_unknown'", "WHEN false THEN 'legacy_unknown'"), 'legacy provenance fabricated'),
    ("revoked-output-current", source.replace("WHEN a.revoked_at IS NOT NULL OR s.active_attempt_id IS DISTINCT FROM a.id OR s.status NOT IN ('running','succeeded') OR v_run.status NOT IN ('running','succeeded') THEN 'retained_inactive'", "WHEN false THEN 'retained_inactive'"), 'revoked output presented as current'),
    ("ignore-output-stage-binding", source.replace("OR (o.kind='artifact' AND o.stage_id IS DISTINCT FROM a.stage_id)", ''), 'mismatched artifact binding accepted'),
    ("allow-projection-insert", source.replace('IF EXISTS(SELECT 1 FROM public.model_runs WHERE id IN (old_run,new_run) AND attempt_managed) THEN', "IF TG_OP <> 'INSERT' AND EXISTS(SELECT 1 FROM public.model_runs WHERE id IN (old_run,new_run) AND attempt_managed) THEN"), 'legacy projection insert accepted'),
    ("allow-projection-delete", source.replace('IF EXISTS(SELECT 1 FROM public.model_runs WHERE id IN (old_run,new_run) AND attempt_managed) THEN', "IF TG_OP <> 'DELETE' AND EXISTS(SELECT 1 FROM public.model_runs WHERE id IN (old_run,new_run) AND attempt_managed) THEN"), 'legacy projection delete accepted'),
    ("allow-projection-move", source.replace('id IN (old_run,new_run) AND attempt_managed) THEN', "id IN (CASE WHEN TG_OP='DELETE' THEN old_run ELSE NULL END,new_run) AND attempt_managed) THEN"), 'legacy projection move accepted'),
    ("ignore-instrument-method", source.replace("IF v_pair.prefix IN ('model_output','assessment') AND", 'IF false AND'), 'wrong instrument method accepted'),
    ("ignore-instrument-output-hash", source.replace("OR v_artifact.content_hash IS DISTINCT FROM p_payload->>(v_pair.prefix||'_sha256')", "OR (v_pair.prefix <> 'model_output' AND v_artifact.content_hash IS DISTINCT FROM p_payload->>(v_pair.prefix||'_sha256'))"), 'wrong output hash accepted'),
    ("ignore-instrument-request", source.replace("IF v_receipt.request_payload IS DISTINCT FROM v_request THEN RAISE EXCEPTION 'Instrument request", "IF false THEN RAISE EXCEPTION 'Instrument request"), 'changed instrument request accepted'),
    ("promote-diagnostic-instrument", source.replace("CHECK (scientific_outcome = 'inconclusive')", "CHECK (true)").replace("OR p_payload->>'scientific_outcome' IS DISTINCT FROM 'inconclusive'", "OR false"), 'diagnostic instrument promoted'),
    ("allow-revoked-instrument", source.replace("IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'\n    OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN\n  RAISE EXCEPTION 'Instrument", "IF false THEN\n  RAISE EXCEPTION 'Instrument"), 'revoked instrument write accepted'),
    ("omit-reused-instrument-validator", source.replace("CREATE TRIGGER validate_model_attempt_instrument BEFORE INSERT ON public.model_attempt_instrument_custody\n FOR EACH ROW EXECUTE FUNCTION public.validate_modeling_validation_instrument_v2_custody();", ''), 'swapped instrument artifact accepted'),
    ("promote-legacy-reaped-run", source.replace("SET attempt_managed=v_run.attempt_managed,status='failed'", "SET attempt_managed=true,status='failed'"), "legacy reaper changed ownership mode"),
    ("promote-legacy-reaped-stage", source.replace('SET attempt_managed=(attempt_managed OR v_run.attempt_managed),active_attempt_id=NULL', 'SET attempt_managed=true,active_attempt_id=NULL'), "legacy reaper changed ownership mode"),
    ("rewrite-legacy-terminal-stage", source.replace("WHERE run_id=p_run_id AND (v_run.attempt_managed OR status IN ('queued','running'));", 'WHERE run_id=p_run_id;'), "legacy reaper rewrote completed stage"),
    ("allow-run-insert-enrollment", source.replace('IF NEW.attempt_managed THEN', "IF NEW.attempt_managed AND TG_TABLE_NAME <> 'model_runs' THEN"), "run insertion enrolled attempt ownership"),
    ("allow-stage-insert-enrollment", source.replace('IF NEW.attempt_managed THEN', "IF NEW.attempt_managed AND TG_TABLE_NAME <> 'model_run_stages' THEN"), "stage insertion enrolled attempt ownership"),
    ("restored", source, None),
]:
    result = subprocess.run(command, input="BEGIN; SET LOCAL statement_timeout=10000; SET LOCAL lock_timeout=1000;\n" + sql + "\n" + cases + "\nROLLBACK;\n", text=True, capture_output=True, timeout=40)
    if expected_failure is None:
        if result.returncode != 0:
            raise RuntimeError(f"{name}: {result.stderr}")
    elif result.returncode == 0 or expected_failure not in result.stderr:
        raise RuntimeError(f"{name} did not fail for {expected_failure}: {result.stderr}")
    assert_absent()
    if subprocess.run(command, input=reaper_query, text=True, capture_output=True, timeout=15, check=True).stdout != reaper_before:
        raise RuntimeError("Installed reaper definition changed after rollback")
    results.append({"control": name, "exit_code": result.returncode, "expected_failure": expected_failure})
print(json.dumps(results, indent=2))
