"""Run transaction-contained native controls for the candidate abandonment fence."""
import argparse
import json
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('config', type=Path)
args = parser.parse_args()
config = json.loads(args.config.read_text())
if not re.fullmatch(r'openplan_gtfs_recovery_[0-9a-f]{32}', config['database']):
    raise SystemExit('Expected isolated GTFS recovery database')
root = Path(__file__).resolve().parents[3]
source = Path(__file__).with_name('verify-recovery.sql').read_text()
migration = (root / 'openplan/supabase/migrations/20261016000025_gtfs_abandonment_fence.sql').read_text()
def function(name):
    start = migration.index('CREATE FUNCTION public.' + name + '(')
    end = migration.index('END $$;', start) + len('END $$;')
    return migration[start:end].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
def inject(definition):
    return source.replace('BEGIN;\n', 'BEGIN;\n' + definition + '\n', 1)
version = function('guard_gtfs_abandoned_version').replace('OLD.ingest_abandoned_at IS NOT NULL AND NEW IS DISTINCT FROM OLD', 'false')
derived = function('guard_gtfs_abandoned_derived_write').replace('v_abandoned IS NOT NULL', 'false')
cases = [('baseline', source, None), ('harmless_comment', '-- harmless comment\n' + source, None),
         ('omit_version_fence', inject(version), 'late stage write accepted'),
         ('omit_derived_fence', inject(derived), 'late derived write accepted'), ('restored', source, None)]
results = []
for name, sql, error in cases:
    result = subprocess.run(['docker', 'exec', '-i', config['container'], 'psql', '-U', 'postgres',
                             '-d', config['database'], '-X', '-At'], input=sql, text=True,
                            capture_output=True, timeout=30)
    if (result.returncode == 0) != (error is None) or (error and error not in result.stderr):
        raise SystemExit(f'{name}: {result.stdout}\n{result.stderr}')
    results.append({'case': name, 'expectedFailure': error, 'returnCode': result.returncode,
                    'stdout': result.stdout, 'stderr': result.stderr})
print(json.dumps(results, indent=2))
