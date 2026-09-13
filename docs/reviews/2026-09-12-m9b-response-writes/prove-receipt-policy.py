"""Receipt policy fault injection in the non-serving restored clone only.

SQL role changes exercise PostgreSQL RLS, not JWT validation or browser routes.
The real PostgREST tenant fixture runs separately in rls-isolation.test.ts.
"""
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
command = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050', 'psql', '-X', '-U', 'postgres', '-d', 'response_broadcast_probe_20260913', '-At', '-v', 'ON_ERROR_STOP=1']

def read(sql):
    return subprocess.run(command, input=sql, text=True, capture_output=True, check=True).stdout.strip()

original = read("SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='engagement_response_write_receipts' AND policyname='response_write_receipts_staff_read';")
assert original
cases = [('baseline', '', None), ('harmless-condition', f'({original}) AND true', None), ('missing-tenant-scope', 'true', 'Foreign workspace receipt was disclosed')]
results = []
for name, condition, expected in cases:
    alter = ('ALTER POLICY response_write_receipts_staff_read ON engagement_response_write_receipts USING (' + condition + ');') if condition else ''
    sql = "BEGIN;" + alter + """
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','4a21e42f-27a7-474d-9a7a-5912c70af359',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM engagement_response_write_receipts WHERE workspace_id='f02e465a-40bd-4304-b4af-d45daff29d3d') THEN RAISE EXCEPTION 'Own workspace receipt was unreadable'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM engagement_response_write_receipts WHERE workspace_id='f02e465a-40bd-4304-b4af-d45daff29d3d') THEN RAISE EXCEPTION 'Foreign workspace receipt was disclosed'; END IF;
END $$;
ROLLBACK;
"""
    run = subprocess.run(command, input=sql, text=True, capture_output=True)
    matched = run.returncode == 0 if expected is None else run.returncode != 0 and expected in run.stderr
    row = {'name': name, 'matched': matched, 'outcome': 'survived' if run.returncode == 0 else 'killed', 'expected': expected}
    results.append(row)
    (root / 'receipt-policy-mutations.json').write_text(json.dumps({'database': 'response_broadcast_probe_20260913', 'results': results}, indent=2)+'\n')
    assert read("SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='engagement_response_write_receipts' AND policyname='response_write_receipts_staff_read';") == original
    print(row, flush=True)
    assert matched, run.stderr
