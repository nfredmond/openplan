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
source = (root / "claim.sql").read_text()
cases = (root / "claim-cases.sql").read_text()
command = ["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
absence_query = "SELECT to_regclass('public.model_stage_attempts') IS NULL AND to_regclass('public.model_stage_claim_receipts') IS NULL;"

def assert_absent():
    result = subprocess.run(command, input=absence_query, text=True, capture_output=True, timeout=15, check=True)
    if result.stdout.strip() != "t":
        raise RuntimeError("Prototype tables already exist or rollback left state behind")

assert_absent()
results = []
for name, sql, expected_failure in [
    ("baseline", source, None),
    ("harmless", source + "\n-- Harmless claim control.\n", None),
    ("ignore-request-payload", source.replace("IF v_receipt.request_payload IS DISTINCT FROM v_request THEN", "IF false THEN"), "changed request accepted"),
    ("skip-prior-status", source.replace("s.status <> 'succeeded'", "false"), "prior stage bypassed"),
    ("restored", source, None),
]:
    result = subprocess.run(command, input="BEGIN; SET LOCAL statement_timeout=10000; SET LOCAL lock_timeout=1000;\n" + sql + "\n" + cases + "\nROLLBACK;\n", text=True, capture_output=True, timeout=40)
    if expected_failure is None:
        if result.returncode != 0:
            raise RuntimeError(f"{name}: {result.stderr}")
    elif result.returncode == 0 or expected_failure not in result.stderr:
        raise RuntimeError(f"{name} did not fail for {expected_failure}: {result.stderr}")
    assert_absent()
    results.append({"control": name, "exit_code": result.returncode, "expected_failure": expected_failure})
print(json.dumps(results, indent=2))
