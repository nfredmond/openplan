"""Check combined migration inventory in a rollback-only owned database transaction."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
c = json.loads(Path(sys.argv[1]).read_text())
assert c['container'] == 'supabase_db_openplan-restore-target-2026091050'
assert c['database'] == 'openplan_attempt_cli_6f9ac02409884be888c0833872cbb36b'
command = ['docker', 'exec', '-i', c['container'], 'psql', '-U', 'postgres', '-d', c['database'], '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
def run(sql):
    return subprocess.run(command, input=sql, text=True, capture_output=True, timeout=45)
def query(sql):
    r = run(sql)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
assert query("SELECT to_regclass('public.model_run_recovery_receipts') IS NULL;") == 't'
assert query("SELECT to_regclass('public.gtfs_ingest_storage_cleanup') IS NOT NULL;") == 't'
files = [next((root/'openplan/supabase/migrations').glob('202610160000'+str(i)+'_*.sql')) for i in (22,23,24)]
sql = '\n'.join(re.sub(r'^(?:BEGIN|COMMIT);\s*$', '', p.read_text(), flags=re.M) for p in files)
inventory = """SELECT json_build_object(
 'tables', count(*) FILTER(WHERE c.relkind='r'),
 'views', count(*) FILTER(WHERE c.relkind='v'),
 'rlsTables', count(*) FILTER(WHERE c.relkind='r' AND c.relrowsecurity))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','v')
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e');"""
results = []
for name, change, wanted in [('baseline','',True),('harmless','-- harmless comment',True),('missing-rls','ALTER TABLE public.gtfs_ingest_storage_cleanup DISABLE ROW LEVEL SECURITY;',False),('restored','',True)]:
    r = run("BEGIN; SET LOCAL statement_timeout='30s';\n"+sql+'\n'+change+'\n'+inventory+'\nROLLBACK;')
    if r.returncode: raise RuntimeError(r.stderr)
    values = json.loads(next(line for line in r.stdout.splitlines() if line.startswith('{')))
    passed = values == {'tables':307,'views':14,'rlsTables':307}
    assert passed == wanted, (name,values)
    assert query("SELECT to_regclass('public.model_run_recovery_receipts') IS NULL;") == 't'
    assert query("SELECT relrowsecurity FROM pg_class WHERE oid='public.gtfs_ingest_storage_cleanup'::regclass;") == 't'
    results.append({'case':name,'expectedPass':wanted,'inventory':values,'rolledBack':True})
print(json.dumps({'migrationHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files},'cases':results},indent=2))
