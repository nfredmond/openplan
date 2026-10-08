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
source = (root / "claim.sql").read_text() + "\n" + (root / "write.sql").read_text() + "\n" + (root / "reap.sql").read_text() + "\n" + (root / "relaunch.sql").read_text()
run_cases = (root / "run-cases.sql").read_text()
cases = (root / "claim-cases.sql").read_text() + run_cases + (root / "stage-set-cases.sql").read_text() + "\n" + (root / "write-cases.sql").read_text() + "\n" + (root / "reap-cases.sql").read_text() + run_cases + (root / "completion-cases.sql").read_text() + (root / "failure-cases.sql").read_text() + (root / "deletion-cases.sql").read_text() + (root / "relaunch-cases.sql").read_text()
command = ["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
absence_query = "SELECT to_regclass('public.model_stage_attempts') IS NULL AND to_regclass('public.model_stage_claim_receipts') IS NULL AND to_regclass('public.model_stage_write_context') IS NULL AND to_regclass('public.model_stage_write_receipts') IS NULL AND to_regclass('public.model_run_write_context') IS NULL AND to_regclass('public.model_run_relaunch_receipts') IS NULL;"

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
