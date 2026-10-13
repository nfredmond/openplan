"""Retain a real failed-task reply with the existing selected-root command.

The cached isolated API fixture uses invalid ordinary bytes, not accepted
imagery. No new application authority, engine adoption or worker recovery.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'workers/odm_worker'))
sys.path.insert(0, str(ROOT / 'openplan/scripts/ops'))
from retained_source import json_bytes
from retained_task_observation import Observations
from worker_root_snapshot import capture, verify, inventory
import time


def run(out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    path = ROOT / 'docs/reviews/2026-10-13-odm-task-observation/native_observation.py'
    spec = importlib.util.spec_from_file_location('owned_original_task_api_probe', path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    original_observe = helper.observe
    retained = []
    api_root = out / 'native-api'
    records_root = out / 'private-records'
    records_root.mkdir(mode=0o700)
    def supplied(plan, status, body):
        result = original_observe(plan, status, body)
        saved = Observations(api_root / 'effects', plan, records_root=records_root).record(status, body)
        assert saved == result, 'Native private record must equal its checked actual reply'
        retained.append((plan, saved))
        return result
    helper.observe = supplied
    helper.run(api_root)
    assert len(retained) == 1, 'Native fixture must retain exactly one committed failed reply'
    plan, observed = retained[0]
    owner = json.loads((api_root / 'producer-owned.json').read_bytes())
    actual = json.loads(subprocess.check_output(['docker', 'inspect', owner['id']], timeout=10))[0]
    assert actual['Id'] == owner['id'] and actual['Config']['Labels'].get('openplan.proof') == str(api_root), 'Native producer ownership must remain exact'
    assert actual['State']['Running'] is False, 'Native producer must stop before the selected-root point'
    original_engine_before = inventory(api_root / 'effects', time.monotonic() + 10)
    source = out / 'known-custody-root'
    source.mkdir(mode=0o700)
    shutil.copytree(api_root / 'effects', source / 'engine')
    shutil.copytree(records_root, source / 'observations')
    before = inventory(source, time.monotonic() + 10)
    package = out / 'selected-root-point'
    captured = capture(source, package, writers_quiesced=True, timeout=10)
    assert verify(package, timeout=10) == captured, 'Native selected-root package must verify exactly'
    package_before = inventory(package, time.monotonic() + 10)
    runtime = out / 'relocated-private-root'
    shutil.copytree(package / 'root', runtime)
    restored = Observations(runtime / 'engine', plan, records_root=runtime / 'observations').load(observed['bodySha256'])
    assert restored == observed, 'Native selected-root consumer must recover the original exact reply'
    body = (api_root / 'failed-body.bin').read_bytes()
    assert restored['bodySha256'] == hashlib.sha256(body).hexdigest(), 'Native retained response hash must bind actual reply bytes'
    assert restored['reportedState'] == 'failed' and restored['reportedImageCount'] == 3, 'Native reported failure must remain separate from success'
    for field in ('engineIdentityVerification', 'originalActorAuthorization', 'sourceCustodyVerification',
                  'effectiveExecutionSettingsVerification', 'processingQualityVerification', 'freshnessVerification'):
        assert restored[field] == 'unassessed', 'Native retained metadata cannot promote ' + field
    assert restored['transportPermission'] is False and restored['publicationPermission'] is False, 'Native retained metadata cannot grant writes'
    assert inventory(source, time.monotonic() + 10) == before, 'Native recovery must preserve the original root'
    assert inventory(api_root / 'effects', time.monotonic() + 10) == original_engine_before, 'Native metadata must leave original engine commands intact'
    assert inventory(package, time.monotonic() + 10) == package_before, 'Native recovery must preserve the immutable package'
    result = {'actualReplyRetained': True, 'selectedRootPackageVerified': True,
        'originalPlanSha256': observed['originalPlanSha256'], 'bodySha256': observed['bodySha256'],
        'reportedState': restored['reportedState'], 'reportedImageCount': restored['reportedImageCount'],
        'engineStoppedBeforeCapture': True, 'originalRootUnchanged': True, 'packageUnchanged': True,
        'workerRecoveryAccepted': False, 'engineAdoptionAccepted': False, 'processingQualityAccepted': False,
        'applicationAuthorityAccepted': False, 'longComputationAccepted': False, 'defaultActivated': False}
    (out / 'results.json').write_bytes(json_bytes(result))
    bindings = [Path(__file__), path, ROOT / 'workers/odm_worker/retained_task_observation.py',
                ROOT / 'workers/odm_worker/task_observation.py', ROOT / 'workers/odm_worker/retained_source.py',
                ROOT / 'openplan/scripts/ops/worker_root_snapshot.py']
    (out / 'source-bindings.json').write_bytes(json_bytes({str(p.relative_to(ROOT)):
        hashlib.sha256(p.read_bytes()).hexdigest() for p in bindings}))
    print(json.dumps(result))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.out.resolve())
