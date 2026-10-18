"""Reobserve existing bindings read-only. Never capture or replace the source anchor."""
import json
import os
import subprocess

import prepare as prep
import verify

l, p = verify.l, verify.p


def run():
    os.umask(0o077)
    prior = prep.read(prep.ROOT, 'final-verification-private.json')
    verify.require({'bindingChecks': True, 'all419MigrationBytesMatch': True}, prior, 'before-preflight')
    verify.audit(verify.packet_files())
    result = subprocess.run(['/usr/bin/python3', '-B', str(prep.ROOT / 'launcher.py'), 'check'],
        capture_output=True, timeout=180, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    with (prep.ROOT / 'readonly-preflight-private.log').open('xb') as stream:
        stream.write(result.stdout + result.stderr)
    (prep.ROOT / 'readonly-preflight-private.log').chmod(0o600)
    if result.returncode:
        prep.write(prep.ROOT, 'readonly-preflight-failure-private.json', {'returncode': result.returncode,
            'message': 'Read-only launcher check refused. Inspect private evidence; behavior unchanged.'})
        raise RuntimeError('read-only-preflight-refused')
    plan = prep.read(prep.ROOT, 'plan-private.json')
    exists = json.loads(l.sql('postgres', 'SELECT to_json(EXISTS(SELECT 1 FROM pg_database WHERE datname=' + l.literal(plan['target']) + '));'))
    p.exact({'exists': False}, {'exists': exists}, 'target-absence')
    containers = [json.loads(line) for line in l.run(['docker', 'ps', '-a', '--format', '{{json .}}']).decode().splitlines()]
    helpers = {kind: sum(row['Names'] == name for row in containers) for kind, name in plan['names'].items()}
    p.exact({kind: 0 for kind in p.IMAGES}, helpers, 'helper-absence')
    p.exact({'inventory': prep.read(prep.ROOT, 'prior-files-before-private.json')},
        {'inventory': prep.inventory(prep.PRIOR_ROOTS)}, 'prior-custody')
    record = dict(readonlyPreflight=True, sourceAnchorNotRecaptured=True,
        sourceAnchor=p.SOURCE_ANCHOR, sourceGlobalsHelpersStorageMatchExistingBindings=True,
        targetDatabaseExists=exists, ownedHelperCounts=helpers, bothBindProbesSucceeded=True,
        priorPacketsByteModeUnchanged=True, noOperationalPhaseExecuted=True,
        boundary='Read-only observations and bind probes at this time; ports are not reserved.')
    prep.write(prep.ROOT, 'readonly-preflight-result-private.json', record)
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    run()
