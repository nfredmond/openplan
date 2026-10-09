"""Characterize the old stale-sweep defect in an explicitly isolated database."""
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
    raise SystemExit('Refusing a database outside this isolated proof namespace')
source = Path(__file__).with_name('reproduce-stale-sweep.sql').read_text()
omitted = 'DELETE FROM gtfs_route_service_levels WHERE feed_version_id IN(SELECT id FROM scanned);'
assert source.count(omitted) == 1
cases = [('baseline', source, True), ('harmless_comment', '-- harmless control\n' + source, True),
         ('omit_route_deletion', source.replace(omitted, '-- deletion omitted'), False),
         ('restored', source, True)]
results = []
for name, sql, expected in cases:
    result = subprocess.run(['docker', 'exec', '-i', config['container'], 'psql', '-U', 'postgres',
                             '-d', config['database'], '-X', '-At'], input=sql, text=True,
                            capture_output=True, timeout=30)
    actual = result.returncode == 0
    if actual != expected or (not expected and 'stale sweep counterexample did not reproduce' not in result.stderr):
        raise SystemExit(f'{name} unexpected outcome: {result.stdout}\n{result.stderr}')
    results.append({'case': name, 'expectedPass': expected, 'returnCode': result.returncode,
                    'stdout': result.stdout, 'stderr': result.stderr})
print(json.dumps(results, indent=2))
