"""Invoke the local command on real retained failed-task metadata and a copy."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'openplan/scripts/ops'))
from worker_root_snapshot import capture, inventory, verify


def run(out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    native = ROOT / 'docs/reviews/2026-10-13-odm-task-observation-retention/native_retention.py'
    spec = importlib.util.spec_from_file_location('owned_native_metadata_root_point', native)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    point = out / 'native-point'
    helper.run(point)
    result = json.loads((point / 'results.json').read_bytes())
    engine = point / 'native-api/effects'
    original_records = point / 'private-records'
    package = point / 'selected-root-point'
    before = {name: inventory(root, time.monotonic() + 10)
              for name, root in [('engine', engine), ('records', original_records), ('package', package)]}
    command = ROOT / 'workers/odm_worker/task_observation_cli.py'
    def invoke(label, engine_root, records_root, args):
        reply = subprocess.run([sys.executable, '-B', str(command), '--engine-root', str(engine_root),
            '--records-root', str(records_root), *args], cwd=out, capture_output=True, timeout=10,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
        (out / (label + '-private.log')).write_bytes(reply.stdout + reply.stderr)
        assert reply.returncode == 0 and not reply.stderr, 'Native operator command must complete without a private diagnostic'
        return json.loads(reply.stdout)
    records = out / 'cli-created-records'
    records.mkdir(mode=0o700)
    assert not any(records.iterdir()), 'Native command must start with an empty metadata root'
    recorded = invoke('record', engine, records, ['--record-file', str(point / 'native-api/failed-body.bin'), '--response-status', '200'])
    assert recorded['bodySha256'] == result['bodySha256'], 'Native command must bind its actual retained reply digest'
    assert recorded['reportedState'] == 'failed' and recorded['reportedImageCount'] == 3, 'Native command must preserve reported failed-task facts'
    assert (records / (recorded['bodySha256'] + '.json')).is_file(), 'Native command must create its own retained record'
    fresh_before = inventory(records, time.monotonic() + 10)
    chosen = out / 'command-custody-root'
    chosen.mkdir(mode=0o700)
    shutil.copytree(engine, chosen / 'engine')
    shutil.copytree(records, chosen / 'observations')
    command_package = out / 'command-selected-root-point'
    capture(chosen, command_package, writers_quiesced=True, timeout=30)
    verify(command_package, timeout=30)
    assert inventory(command_package / 'root' / 'observations', time.monotonic() + 10) == fresh_before, 'Native capture must contain the record created by the command'
    restored = out / 'command-relocated-private-root'
    shutil.copytree(command_package / 'root', restored)
    loaded = invoke('read-relocated', restored / 'engine', restored / 'observations', ['--read-digest', recorded['bodySha256']])
    assert loaded == recorded, 'Native relocated command must return the exact original summary'
    for field in ('bodyBase64', 'reportedErrorDetail', 'engine', 'requestedOptions', 'reportedOptions'):
        assert field not in loaded, 'Native command must exclude private detail field ' + field
    for field in ('engineIdentityVerification', 'originalActorAuthorization', 'sourceCustodyVerification',
                  'effectiveExecutionSettingsVerification', 'processingQualityVerification', 'freshnessVerification'):
        assert loaded[field] == 'unassessed', 'Native command cannot promote ' + field
    assert loaded['transportPermission'] is False and loaded['publicationPermission'] is False, 'Native command cannot grant writes'
    assert inventory(records, time.monotonic() + 10) == fresh_before, 'Native fresh command record must remain unchanged after recovery'
    verify(command_package, timeout=30)
    for name, root in [('engine', engine), ('records', original_records), ('package', package)]:
        assert inventory(root, time.monotonic() + 10) == before[name], 'Native command must preserve original ' + name
    report = {'actualRecordCommandPassed': True, 'relocatedReadCommandPassed': True,
              'freshRecordCommandPassed': True, 'freshRecordCaptureVerified': True,
              'bodySha256': loaded['bodySha256'], 'reportedState': 'failed', 'reportedImageCount': 3,
              'originalEngineRecordsPackageUnchanged': True, 'networkingAccepted': False,
              'freshnessAccepted': False, 'applicationAuthorityAccepted': False,
              'processingQualityAccepted': False, 'workerRecoveryAccepted': False, 'defaultActivated': False}
    (out / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(ROOT)):
        hashlib.sha256(p.read_bytes()).hexdigest() for p in (Path(__file__), native, command)}, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.out.resolve())
