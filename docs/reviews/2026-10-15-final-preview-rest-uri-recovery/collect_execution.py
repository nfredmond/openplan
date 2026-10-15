"""Retain systemd trial logs privately and publish resource/result summaries."""
import json
import os
from pathlib import Path
import subprocess

PUBLIC = Path(__file__).resolve().parent
PRIVATE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/rest-uri-recovery-01')
UNITS = ['inventory-before-01', 'prepare-01', 'native-01', 'native-02', 'images-01',
         'controls-01', 'controls-02', 'controls-03', 'final-observations-01', 'final-observations-02',
         'refresh-01', 'controls-04', 'controls-05', 'inventory-after-01',
         'final-check-01', 'final-check-02', 'final-check-03']
FAILURES = {'native-01': 'PGDATABASE adapter fails peer authentication before any target query.',
            'controls-01': 'Aliased fixture changes both created and active receipt IDs.',
            'controls-02': 'Overwrite-intent fault reaches retained-rest:Name before the expected later assertion.',
            'final-observations-01': 'Whole State comparison includes changing gateway Health logs.',
            'final-check-01': 'Old report boolean is mistaken for the historical control row array.',
            'final-check-02': 'Known-value scanner includes a short common platform identifier.'}


def main():
    os.umask(0o077)
    rows = []
    for suffix in UNITS:
        unit = 'openplan-rest-recovery-' + suffix
        result = subprocess.run(['journalctl', '--user', '--no-pager', '-u', unit, '-o', 'cat'],
                                capture_output=True, timeout=15)
        assert result.returncode == 0
        with (PRIVATE / ('unit-' + suffix + '-private.log')).open('xb') as stream:
            stream.write(result.stdout + result.stderr)
        lines = result.stdout.decode(errors='replace').splitlines()
        rows.append({'unit': unit, 'outcome': 'retained-failed-trial' if suffix in FAILURES else 'success',
                     'reason': FAILURES.get(suffix),
                     'resourceLines': [line for line in lines if any(word in line for word in ['Memory peak:', 'CPU time consumed:', 'Consumed ', 'memory peak'])]})
    report = {'resourceEnvelope': {'memoryMax': 536870912, 'memorySwapMax': 0, 'cpuQuota': '50%',
                                   'python': '-B; PYTHONDONTWRITEBYTECODE=1', 'serial': True},
              'units': rows, 'originalDirectionCheck': {'nestedPackage': 'openplan/', 'exitCode': 0,
                  'resourceUnit': None, 'note': 'Initial short npm direction check runs directly, before proof units.'},
              'finalControlResult': 'controls-05.json',
              'priorControlSnapshots': ['controls-03.json', 'controls-04.json'],
              'originalFileCount': 16870, 'preexistingFileChanges': 0, 'preexistingFileRemovals': 0,
              'realTransitionExecuted': False, 'actualRestHead': 503,
              'independentReview': 'Pending parent-owned review of this final packet.'}
    with (PUBLIC / 'evidence/execution.json').open('x') as stream: json.dump(report, stream, indent=2)
    print(json.dumps({'retainedUnits': len(rows), 'failedTrials': len(FAILURES), 'realTransitionExecuted': False}))


if __name__ == '__main__': main()
