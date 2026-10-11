"""Read source, resource headroom and the retained point. Do not launch services."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

import preflight_scope as scope

REPO = Path(__file__).resolve().parents[3]


def command(args):
    return subprocess.check_output(args, cwd=REPO, stderr=subprocess.PIPE, timeout=30)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def main():
    os.umask(0o077)
    started = time.monotonic()
    expected = {path: hashlib.sha256(command(['git', 'show', scope.HEAD + ':' + path])).hexdigest()
                for path in scope.HELPERS}
    # Successful list calls distinguish absent names from a failed Docker daemon.
    names = set(command(['docker', 'ps', '-a', '--format', '{{.Names}}']).decode().splitlines())
    volumes = set(command(['docker', 'volume', 'ls', '--format', '{{.Name}}']).decode().splitlines())
    image = json.loads(command(['docker', 'image', 'inspect', scope.IMAGE]))[0]
    retained = json.loads((scope.POINT / 'source-point-result.json').read_text())
    retained['sourceHead'] = json.loads((scope.POINT / 'point-private/configuration-private/model-worker-source-scope-private.json').read_text())['sourceHead']
    controls = json.loads((scope.OUT / 'preflight-controls.json').read_text())
    observed = {
        'head': command(['git', 'rev-parse', 'HEAD']).decode().strip(),
        'sourceEdits': bool(command(['git', 'status', '--porcelain', '--', 'openplan', 'workers']).strip()),
        'pointPath': str(scope.POINT), 'outputPath': str(scope.OUT),
        'sourceProject': scope.SOURCE_PROJECT, 'targetProject': scope.TARGET_PROJECT,
        'sourceVolume': scope.SOURCE_VOLUME, 'targetVolume': scope.TARGET_VOLUME,
        'existingContainers': sorted(names & {'supabase_db_' + scope.SOURCE_PROJECT,
                                             'supabase_db_' + scope.TARGET_PROJECT}),
        'existingVolumes': sorted(volumes & {scope.SOURCE_VOLUME, scope.TARGET_VOLUME}),
        'toolSha256': digest(scope.BASE / 'worker-backup-tool-20261011/restic'),
        'imageId': image['Id'],
        'retainedPoint': {key: retained[key] for key in
                          ('state', 'snapshotId', 'sourceHead', 'capturedFiles', 'capturedBytes')},
        'helperHashes': {path: digest(REPO / path) for path in scope.HELPERS},
        'controlsScopeSha256': controls['sourceSha256'], 'scopeSha256': digest(Path(scope.__file__)),
        'databaseMemoryBytes': 1024 ** 3, 'databaseSwapBytes': 1024 ** 3,
        'driverMemoryBytes': 1024 ** 3, 'driverSwapBytes': 0,
        'restMemoryBytes': 128 * 1024 ** 2, 'cpuQuotaPercent': 100,
        'freeDiskBytes': shutil.disk_usage(scope.BASE).free,
        'availableMemoryBytes': int(next(line.split()[1] for line in
                                       Path('/proc/meminfo').read_text().splitlines()
                                       if line.startswith('MemAvailable:'))) * 1024,
    }
    scope.verify(observed, expected)
    spec = importlib.util.spec_from_file_location('retained_file_census', scope.BASE / 'probe_worker_file_backup.py')
    files = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(files)
    census = json.loads((scope.POINT / 'coordinated-point-file-inventory-private.json').read_text())
    actual = files.inventory(scope.POINT / 'point-private')
    files.equal(census, actual)
    result = {
        'state': 'passed-read-only-preflight', 'nativeResourcesLaunched': False,
        'sourceHead': scope.HEAD, 'observed': observed,
        'retainedFiles': len(actual), 'retainedBytes': sum(row['bytes'] for row in actual.values()),
        'executionSourceSha256': {path.name: digest(path) for path in Path(__file__).parent.glob('*.py')},
        'fileHelperSha256': digest(scope.BASE / 'probe_worker_file_backup.py'),
        'wallSeconds': round(time.monotonic() - started, 3),
        'limits': 'Read-only metadata and exact retained file census. Planned caps are not native container receipts. No database restore, managed admission/progress capture, current ownership recovery or hosted acceptance occurs.'}
    (scope.OUT / 'read-preflight.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in
                      ('state', 'nativeResourcesLaunched', 'retainedFiles', 'retainedBytes', 'wallSeconds')}))


if __name__ == '__main__':
    main()
