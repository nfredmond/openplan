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
source = (root / "claim.sql").read_text() + "\n" + (root / "write.sql").read_text() + "\n" + (root / "reap.sql").read_text()
run_cases = (root / "run-cases.sql").read_text()
cases = (root / "claim-cases.sql").read_text() + run_cases + "\n" + (root / "write-cases.sql").read_text() + "\n" + (root / "reap-cases.sql").read_text() + run_cases + (root / "completion-cases.sql").read_text()
command = ["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
absence_query = "SELECT to_regclass('public.model_stage_attempts') IS NULL AND to_regclass('public.model_stage_claim_receipts') IS NULL AND to_regclass('public.model_stage_write_context') IS NULL AND to_regclass('public.model_stage_write_receipts') IS NULL AND to_regclass('public.model_run_write_context') IS NULL;"

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
    ("allow-legacy-write", source.replace("IF OLD.attempt_managed OR NEW.attempt_managed THEN", "IF false THEN"), "legacy write accepted"),
    ("ignore-terminal-state", source.replace("v_stage.status <> 'running'", "false"), "late write accepted"),
    ("ignore-write-payload", source.replace("IF v_receipt.request_payload IS DISTINCT FROM v_request THEN\n      RAISE EXCEPTION 'Model stage write", "IF false THEN\n      RAISE EXCEPTION 'Model stage write"), "changed write accepted"),
    ("bypass-attempt-identity-both", source.replace("v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id", "false").replace("AND c.attempt_id IS NOT DISTINCT FROM NEW.active_attempt_id", ""), "old attempt overwrote new owner"),
    ("forget-reaped-fence", source.replace("IF OLD.attempt_managed OR NEW.attempt_managed THEN", "IF OLD.active_attempt_id IS NOT NULL OR NEW.active_attempt_id IS NOT NULL THEN"), "legacy write after reaping accepted"),
    ("lose-revocation", source.replace("s.active_attempt_id=a.id", "false"), "revocation not recorded"),
    ("allow-parent-overwrite", source.replace("IF NEW.attempt_managed OR OLD.attempt_managed THEN", "IF false THEN"), "legacy parent overwrite accepted"),
    ("complete-before-required-stages", source.replace("AND status <> 'succeeded'", "AND false"), "unfinished run completed"),
    ("omit-parent-completion", source.replace("IF p_status='succeeded' THEN", "IF false THEN"), "parent completion omitted"),
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
