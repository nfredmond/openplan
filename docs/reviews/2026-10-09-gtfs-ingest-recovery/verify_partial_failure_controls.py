"""Mutate only the owned proof function and restore it after native HTTP cases."""
import json,re,subprocess,sys
from pathlib import Path
p=Path(__file__).resolve().parent
c=json.loads(Path(sys.argv[1]).read_text())
if c['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch('openplan_attempt_cli_[0-9a-f]{32}',c['database']):raise SystemExit('Expected owned proof database')
s=(p.parents[2]/'openplan/supabase/migrations/20261016000026_gtfs_failure_closure.sql').read_text();a=s.index('CREATE FUNCTION public.close_failed_gtfs_version(');original=s[a:s.index('END $$;',a)+len('END $$;')].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
def apply(definition):
 subprocess.run(['docker','exec','-i',c['container'],'psql','-U','postgres','-d',c['database'],'-X','-q','-v','ON_ERROR_STOP=1'],input=definition,text=True,capture_output=True,check=True,timeout=15)
cases=[('baseline',original,True),('harmless',original+'\n-- harmless\n',True),('omit-route-delete',original.replace('DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=v.id;',''),False),('omit-stop-delete',original.replace('DELETE FROM public.gtfs_stop_service_levels WHERE feed_version_id=v.id;',''),False),('restored',original,True)]
results=[]
try:
 for name,definition,expected in cases:
  apply(definition)
  r=subprocess.run([sys.executable,str(p/'verify_partial_failure_http.py'),sys.argv[1],sys.argv[2]],text=True,capture_output=True,timeout=60)
  if (r.returncode==0)!=expected or (not expected and 'AssertionError' not in r.stdout+r.stderr):raise RuntimeError(name+'\n'+r.stdout+r.stderr)
  results.append({'case':name,'expectedPass':expected,'exitCode':r.returncode,'result':json.loads((p/'partial-failure.json').read_text()) if expected else None})
finally:
 apply(original)
print(json.dumps(results,indent=2))
