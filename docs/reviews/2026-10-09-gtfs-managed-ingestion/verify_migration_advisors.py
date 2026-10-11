"""Compare a pinned advisor before and during the rollback-only candidate install."""
from pathlib import Path
import csv,hashlib,io,json,re,subprocess,sys
root=Path(__file__).resolve().parents[3]
config=json.loads(Path(sys.argv[1]).read_text())
assert config['container']=='supabase_db_openplan-restore-target-2026091050'
assert re.fullmatch(r'openplan_attempt_cli_[a-f0-9]{32}',config['database'])
advisor=Path(sys.argv[2]).read_bytes()
expected='d8d558baad3e03832e521c527907fa50a9a172fabd899dd0f5c2504a5a0e9349'
assert hashlib.sha256(advisor).hexdigest()==expected,'Pinned advisor differs'
out=Path(sys.argv[3]).resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
source=(root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql').read_text()
variant=sys.argv[4] if len(sys.argv)>4 else 'baseline'
assert variant in ['baseline','harmless','unprotected-table']
if variant=='harmless':source=source.removesuffix('COMMIT;\n')+'-- Harmless advisor control.\nCOMMIT;\n'
if variant=='unprotected-table':source=source.removesuffix('COMMIT;\n')+'CREATE TABLE public.gtfs_advisor_control(id uuid PRIMARY KEY); GRANT SELECT ON public.gtfs_advisor_control TO anon;\nCOMMIT;\n'
command=['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-q','--csv','-v','ON_ERROR_STOP=1']
rows={}
for name,definition in [('baseline','BEGIN;'),('candidate',source.removesuffix('COMMIT;\n'))]:
    statement=definition+"\nSET LOCAL statement_timeout='30s'; SET LOCAL pgrst.db_schemas='public,graphql_public';\n"+advisor.decode()+';\nROLLBACK;'
    r=subprocess.run(command,input=statement,text=True,capture_output=True,timeout=45)
    (out/f'{name}.csv').write_text(r.stdout);(out/f'{name}.stderr').write_text(r.stderr)
    assert r.returncode==0,(name,r.stderr[:1000])
    rows[name]={row['cache_key']:row for row in csv.DictReader(io.StringIO(r.stdout))}
new=[row for key,row in rows['candidate'].items() if key not in rows['baseline'] or rows['baseline'][key]!=row]
blocking=[row for row in new if row['level'] in ['WARN','ERROR'] or row['name']=='unindexed_foreign_keys']
r=subprocess.run(command+['-t','-A'],input="SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';",text=True,capture_output=True,timeout=10)
assert r.returncode==0 and r.stdout.strip()=='0'
record={'advisor':{'source':'https://raw.githubusercontent.com/supabase/splinter/fccca4b1c4d8b48b8ccd69bd6b30e84adcb92975/splinter.sql','sha256':expected},
        'migrationSha256':hashlib.sha256(source.encode()).hexdigest(),'proofSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'baselineFindings':len(rows['baseline']),'candidateFindings':len(rows['candidate']),
        'newFindings':[{'name':row['name'],'level':row['level'],'metadata':json.loads(row['metadata'])} for row in new],
        'variant':variant,'newBlockingFindings':len(blocking),'schemaAbsentAfterRollback':True,
        'outputHashes':{name:hashlib.sha256((out/f'{name}.csv').read_bytes()).hexdigest() for name in rows}}
(out/'advisors.json').write_text(json.dumps(record,indent=2)+'\n')
assert not blocking,[(row['name'],row['level']) for row in blocking]
print(json.dumps({'baseline':len(rows['baseline']),'candidate':len(rows['candidate']),'new':len(new),'newBlockingFindings':0}))
