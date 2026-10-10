"""Temporarily mutate functions only in the isolated proof database, then restore."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('config', type=Path)
args = parser.parse_args()
v = json.loads(args.config.read_text())
if not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', v['database']):
    raise SystemExit('Expected isolated proof database')
if v['container'] != 'supabase_db_openplan-restore-target-2026091050':
    raise SystemExit('Expected named owned restore target')
here = Path(__file__).resolve().parent
root = here.parents[2]
source = (root/'openplan/supabase/migrations/20261016000026_gtfs_failure_closure.sql').read_text()
names = ['close_failed_gtfs_version', 'guard_gtfs_closed_version', 'guard_gtfs_closed_derived']
def definition(name):
    start = source.index('CREATE FUNCTION public.'+name+'(')
    return source[start:source.index('END $$;', start)+len('END $$;')].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
original = {name: definition(name) for name in names}
def apply(sql):
    subprocess.run(['docker','exec','-i',v['container'],'psql','-U','postgres','-d',v['database'],'-X','-q','-v','ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True, check=True, timeout=15)
cases = [('baseline',None,None), ('harmless_comment','close_failed_gtfs_version',original['close_failed_gtfs_version']+'\n-- harmless\n'),
         ('omit_cleanup_lock','close_failed_gtfs_version',original['close_failed_gtfs_version'].replace('FOR UPDATE;', ';')),
         ('omit_version_fence','guard_gtfs_closed_version',original['guard_gtfs_closed_version'].replace('OLD.ingest_closed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD','false')),
         ('omit_derived_fence','guard_gtfs_closed_derived',original['guard_gtfs_closed_derived'].replace('closed_at IS NOT NULL THEN', 'false THEN')),
         ('restored',None,None)]
results=[]
try:
    for name,function,changed in cases:
        apply('\n'.join(original.values()))
        if changed:
            assert changed != original[function]
            apply(changed)
        r=subprocess.run([sys.executable,str(here/'verify_failure_concurrency.py'),str(args.config)],text=True,capture_output=True,timeout=90)
        expected=name in ('baseline','harmless_comment','restored')
        if (r.returncode == 0)!=expected or (not expected and 'AssertionError' not in r.stderr):
            raise SystemExit(f'{name}: {r.stdout}\n{r.stderr}')
        results.append({'case':name,'expectedPass':expected,'returnCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
finally:
    apply('\n'.join(original.values()))
print(json.dumps(results,indent=2))
