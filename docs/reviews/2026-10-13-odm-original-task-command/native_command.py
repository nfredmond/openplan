"""Run the actual original-fetch command against a pinned isolated failed task.

The inherited fixture uses invalid ordinary input bytes. It does not prove
imagery quality, processing success, application authority or complete recovery.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'workers/odm_worker'))
sys.path.insert(0, str(ROOT / 'openplan/scripts/ops'))
from task_observation_cli import CREDENTIAL_FORMAT, SUMMARY_FIELDS
from retained_source import json_bytes
from retained_task_observation import Observations
from native_engine_attestation import Attestor, inspect_projection
from worker_root_snapshot import capture, verify, inventory


def run(out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    producer = out / 'native-producer'
    records = out / 'private-observations'
    records.mkdir(mode=0o700)
    path = ROOT / 'docs/reviews/2026-10-13-odm-task-observation/native_observation.py'
    spec = importlib.util.spec_from_file_location('original_task_native_producer', path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    original_effects, original_observe = helper.Effects, helper.observe
    retained = []
    def effects(**arguments):
        engine = arguments['engine']
        info = json.loads(subprocess.check_output(['docker', 'inspect', engine['instanceId']], timeout=10))[0]
        assert info['Config']['Labels'].get('openplan.proof') == str(producer), 'Actual engine must belong to this producer'
        configuration, port = inspect_projection(info, (producer / 'configuration.json').read_bytes())
        assert port == 34100, 'Pinned native task port must remain exact'
        arguments['engine'] = {**engine, 'configurationSha256': configuration}
        return original_effects(**arguments)
    def observed(plan, status, body):
        original = original_observe(plan, status, body)
        assert list(records.iterdir()) == [], 'Actual original fetch must create a fresh metadata ledger'
        credential = out / 'credential.json'
        credential.write_bytes(json_bytes({'format': CREDENTIAL_FORMAT,
            'credentialReference': plan['engine']['credentialReference'], 'token': None}))
        arguments = [sys.executable, '-B', str(ROOT / 'workers/odm_worker/task_observation_cli.py'),
            '--engine-root', str(producer / 'effects'), '--records-root', str(records),
            '--fetch-original', '--daemon-socket', '/var/run/docker.sock', '--daemon-uid', '0',
            '--credential-file', str(credential), '--timeout', '10']
        command = subprocess.run(arguments, cwd=ROOT, capture_output=True, timeout=15)
        (out / 'actual-fetch-private.log').write_bytes(command.stdout + command.stderr)
        assert command.returncode == 0, 'Actual original fetch command must exit successfully'
        summary = json.loads(command.stdout)
        assert summary == {field: original[field] for field in SUMMARY_FIELDS}, 'Actual command summary must match the original actual reply'
        stored = Observations(producer / 'effects', plan, records_root=records).load(original['bodySha256'])
        assert stored == original, 'Actual command must create exact original reply bytes'
        retained.append((plan, stored))
        return original
    helper.Effects, helper.observe = effects, observed
    helper.run(producer)
    assert len(retained) == 1, 'One actual original fetch command must create one retained reply'
    plan, result = retained[0]
    owner = json.loads((producer / 'producer-owned.json').read_bytes())
    stopped = json.loads(subprocess.check_output(['docker', 'inspect', owner['id']], timeout=10))[0]
    assert stopped['Id'] == owner['id'] and stopped['State']['Running'] is False, 'Owned engine must stop before capture'
    source = out / 'selected-custody'
    source.mkdir(mode=0o700)
    shutil.copytree(producer / 'effects', source / 'engine')
    shutil.copytree(records, source / 'observations')
    before = inventory(source, time.monotonic() + 10)
    point = out / 'selected-root-point'
    captured = capture(source, point, writers_quiesced=True, timeout=10)
    assert verify(point, timeout=10) == captured, 'Actual task record root must verify'
    point_before = inventory(point, time.monotonic() + 10)
    relocated = out / 'relocated-custody'
    shutil.copytree(point / 'root', relocated)
    restored = Observations(relocated / 'engine', plan, records_root=relocated / 'observations').load(result['bodySha256'])
    assert restored == result and base64.b64decode(restored['bodyBase64']) == (producer / 'failed-body.bin').read_bytes(), 'Relocated read must recover exact actual reply bytes'
    command = subprocess.run([sys.executable, '-B', str(ROOT / 'workers/odm_worker/task_observation_cli.py'),
        '--engine-root', str(relocated / 'engine'), '--records-root', str(relocated / 'observations'),
        '--read-digest', result['bodySha256']], cwd=ROOT, capture_output=True, timeout=5)
    (out / 'actual-relocated-read-private.log').write_bytes(command.stdout + command.stderr)
    assert command.returncode == 0 and json.loads(command.stdout) == {field: result[field] for field in SUMMARY_FIELDS}, 'Actual relocated read command must retain the original summary'
    assert inventory(source, time.monotonic() + 10) == before, 'Original selected root must remain unchanged'
    assert inventory(point, time.monotonic() + 10) == point_before, 'Retained snapshot must remain unchanged'
    summary = {'actualOriginalFetchCommand': True, 'freshLedgerCreated': True,
        'bodySha256': result['bodySha256'], 'reportedState': result['reportedState'],
        'reportedImageCount': result['reportedImageCount'], 'selectedRootVerified': True,
        'relocatedReplyExact': True, 'ownedEngineStopped': True,
        'applicationAuthorityAccepted': False, 'workerRecoveryAccepted': False,
        'processingQualityAccepted': False, 'longComputationAccepted': False, 'defaultActivated': False}
    (out / 'results.json').write_bytes(json_bytes(summary))
    bindings = [Path(__file__), path, ROOT / 'workers/odm_worker/original_task_http.py', ROOT / 'workers/odm_worker/task_observation_cli.py',
        ROOT / 'workers/odm_worker/retained_task_observation.py', ROOT / 'workers/odm_worker/native_engine_attestation.py']
    (out / 'source-bindings.json').write_bytes(json_bytes({str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in bindings}))
    print(json.dumps(summary))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.out.resolve())
