"""Upgrade the retained 325 restore target, preserving every restored table row.

This is an explicit local target. It does not rebuild or reset either stack.
Full restore evidence predates this additive function upgrade and is distinct
from the final live RLS command, which must run afterward.
"""
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
app = root.parents[2] / 'openplan'
workdir = Path('/home/nathaniel/.local/state/openplan/openplan-restore-drill.enw48S/openplan-restore-target-2731143')
container = 'supabase_db_openplan-restore-target-2731143'
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/restored-conflict-upgrade')
private.mkdir(mode=0o700, exist_ok=True)
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1']
def read(sql):
    return subprocess.run(command, input=sql, text=True, capture_output=True, check=True).stdout
ledger_sql = "SELECT count(*)||'|'||max(version) FROM supabase_migrations.schema_migrations;"
assert read(ledger_sql).strip() == '325|20261014000006'
tables = json.loads(read("SELECT json_agg(json_build_array(schemaname,tablename) ORDER BY schemaname,tablename) FROM pg_tables WHERE schemaname IN ('public','auth','storage');"))
def quoted(value):
    return '"' + value.replace('"', '""') + '"'
queries = []
for schema, table in tables:
    relation = quoted(schema) + '.' + quoted(table)
    label = (schema + '.' + table).replace("'", "''")
    queries.append(f"SELECT '{label}'||':'||count(*)||':'||md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM {relation} t")
snapshot_sql = ';\n'.join(queries) + ';\n'
before = read(snapshot_sql)
(private / 'before.txt').write_text(before)
with (private / 'before.dump').open('wb') as out:
    subprocess.run(['docker','exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc'],stdout=out,stderr=subprocess.PIPE,check=True)
migration = '20261014000007_engagement_conflicts_without_transaction_retry.sql'
shutil.copy2(app/'supabase/migrations'/migration, workdir/'supabase/migrations'/migration)
run = subprocess.run(['npm','exec','--','supabase','migration','up','--workdir',str(workdir),'--local','--yes'],cwd=app,capture_output=True,text=True)
(private/'migration.log').write_text(run.stdout+'\n'+run.stderr)
assert run.returncode == 0, 'Inspect private migration log'
after = read(snapshot_sql)
(private/'after.txt').write_text(after)
assert before == after, 'Restored table data changed during function upgrade'
assert read(ledger_sql).strip() == '326|20261014000007'
report = {'container':container,'database':'postgres','beforeLedger':'325|20261014000006','afterLedger':'326|20261014000007','migrationExit':run.returncode,'tablesCompared':len(tables),'allTableRowHashesUnchanged':True,'snapshotSha256':hashlib.sha256(before.encode()).hexdigest(),'backupSha256':hashlib.sha256((private/'before.dump').read_bytes()).hexdigest(),'limits':'Existing full restore reached data verification at 325; final RLS after this function upgrade is a separate check.'}
(root/'restored-conflict-upgrade.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
