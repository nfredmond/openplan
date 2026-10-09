"""Verify schema accounting changes retain their forbidden-data boundaries."""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[3];app=root/'openplan'
probe=app/'src/lib/gtfs/schema-guard-probe.ts'
migration=app/'supabase/migrations/20261016000025_gtfs_abandonment_fence.sql'
original=migration.read_text()
if probe.exists():raise SystemExit('Probe path already exists')
files=['src/test/a-column-nothing-reads-is-a-question.test.ts','src/test/the-timetable-is-not-persisted.test.ts','src/test/migrations/inventory.test.ts']
cases=[('baseline',None,original,files,True),('harmless','// Harmless schema guard control.\n',original,files,True),('raw-timetable-write','export function probe(client) { return client.from("stop_times").insert({trip_id:"synthetic"}); }\n',original,[files[1]],False),('unaccounted-column',None,original+'\nALTER TABLE public.gtfs_feed_versions ADD COLUMN guard_probe_unread text;\n',[files[0]],False),('queue-holds-timetable',None,original+'\nALTER TABLE public.gtfs_ingest_storage_cleanup ADD COLUMN stop_times jsonb;\n',[files[2]],False),('queue-without-rls',None,original.replace('ALTER TABLE public.gtfs_ingest_storage_cleanup ENABLE ROW LEVEL SECURITY;',''),[files[2]],False),('restored',None,original,files,True)]
results=[]
try:
 for name,source,sql,tests,expected in cases:
  if probe.exists():probe.unlink()
  if source is not None:probe.write_text(source)
  migration.write_text(sql)
  r=subprocess.run([str(app/'node_modules/.bin/vitest'),'run',*tests,'--maxWorkers=1'],cwd=app,text=True,capture_output=True,timeout=90,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=768'})
  if (r.returncode==0)!=expected or (not expected and 'AssertionError' not in r.stdout+r.stderr):raise RuntimeError(name+'\n'+r.stdout+r.stderr)
  results.append({'case':name,'expectedPass':expected,'exitCode':r.returncode,'tests':tests})
finally:
 migration.write_text(original)
 if probe.exists():probe.unlink()
print(json.dumps(results,indent=2))
