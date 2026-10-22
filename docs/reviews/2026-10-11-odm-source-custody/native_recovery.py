"""Interrupt a real source copy, capture its stopped root and resume exact bytes.

Only synthetic ordinary files and the disconnected journal/source library run.
No URL, imagery decoding, HTTP worker, callback, engine or live authority runs.
"""
import argparse
from dataclasses import asdict
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO/'workers/odm_worker'))
from admission_journal import FILENAME, Journal
from retained_source import prepare

EXPECTED = {
    'producerExit': -signal.SIGTERM,
    'firstSlotPublishedBeforeInterruption': True,
    'secondSlotUnpublishedAfterInterruption': True,
    'manifestUnpublishedAfterInterruption': True,
    'completePlanBeforeInterruption': True,
    'captureExit': 0,
    'verifyExit': 0,
    'replayExit': 0,
    'originalAdmissionReplayed': True,
    'originalPlanUnchanged': True,
    'completedSlotNeedsNoOriginalSource': True,
    'remainingSlotMatchesOriginalBytes': True,
    'originalContextAndRequestRetained': True,
    'completeReplayNeedsNoOriginalSources': True,
    'completedPackReplayUnchanged': True,
    'relocatedManifestIdentity': True,
    'changedRawSourceExit': 1,
    'changedRawSourceRefusal': True,
    'changedRetainedSlotExit': 1,
    'changedRetainedSlotRefusal': True,
    'changedOriginalActorExit': 1,
    'changedOriginalActorRefusal': True,
    'sourceOrdinaryUnchanged': True,
    'sourceJournalUnchanged': True,
    'packageOrdinaryUnchanged': True,
    'packageJournalUnchanged': True,
    'retainedOrdinaryMatchesSource': True,
    'retainedJournalMatchesSource': True,
    'runtimeOrdinaryMatchesPackageBeforeResume': True,
    'runtimeJournalMatchesPackage': True,
    'sourceBindingsUnchanged': True,
}


def observe(values):
    for key, expected in EXPECTED.items():
        if key not in values or type(values[key]) is not type(expected) or values[key] != expected:
            raise ValueError('source-native-'+key)


def save(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def arguments(root, fixture, source_root=None):
    return {'journal': Journal(root/'journal'), 'request_id': fixture['request']['requestId'],
            'reference': fixture['admission']['job_reference'], 'context': fixture['context'],
            'source_root': root/'input' if source_root is None else source_root,
            'sources': fixture['sourceNames'], 'destination': root/'pack',
            'max_bytes': fixture['maxBytes'], 'timeout': 30}


def child(phase, root):
    fixture = json.loads((root/'fixture.json').read_text())
    if phase == 'produce' or phase == 'attempt':
        print(json.dumps(prepare(**arguments(root, fixture))))
        return
    journal = Journal(root/'journal')
    def forbidden(_payload):
        raise AssertionError('source recovery attempted another admission')
    admission, created = journal.admit(fixture['request'], forbidden, max_queued=0)
    plan_before = (root/'pack/plan.json').read_bytes()
    first = root/'input'/fixture['sourceNames'][0]
    first.rename(root/'input/first-original-retained')
    receipt = prepare(**arguments(root, fixture))
    plan = json.loads(plan_before)
    bound = receipt['manifest']['binding']
    spec = importlib.util.spec_from_file_location('source_child_root', REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    before = helper.inventory(root/'pack')
    missing = root/'missing-original-source-directory'
    repeat = prepare(**arguments(root, fixture, source_root=missing))
    relocated = root/'relocated-pack'
    shutil.copytree(root/'pack', relocated)
    relocated_before = helper.inventory(relocated)
    relocated_args = arguments(root, fixture, source_root=missing)
    relocated_args['destination'] = relocated
    relocated_receipt = prepare(**relocated_args)
    raw_second = root/'input'/fixture['sourceNames'][1]
    actual_second = root/'pack/objects/source-00001.bin'
    print(json.dumps({
        'originalAdmissionReplayed': asdict(admission) == fixture['admission'] and created is False,
        'originalPlanUnchanged': (root/'pack/plan.json').read_bytes() == plan_before,
        'completedSlotNeedsNoOriginalSource': not first.exists() and receipt['manifest']['sources'][0]['sha256'] == plan['sources'][0]['sha256'],
        'remainingSlotMatchesOriginalBytes': helper.inventory(raw_second)['.'] == helper.inventory(actual_second)['.'],
        'originalContextAndRequestRetained': bound['originalContext'] == fixture['context'] and bound['originalRequest'] == fixture['request'],
        'completeReplayNeedsNoOriginalSources': not missing.exists() and repeat == receipt,
        'completedPackReplayUnchanged': helper.inventory(root/'pack') == before,
        'relocatedManifestIdentity': relocated_receipt == receipt and helper.inventory(relocated) == relocated_before,
    }))


def run(out):
    out.mkdir(mode=0o700)
    began = time.monotonic()
    spec = importlib.util.spec_from_file_location('source_native_root', REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    paths = [Path(__file__), REPO/'workers/odm_worker/retained_source.py',
             REPO/'workers/odm_worker/admission_journal.py',
             REPO/'openplan/scripts/ops/worker_root_snapshot.py',
             REPO/'openplan/scripts/ops/worker_journal_snapshot.py',
             REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py']
    hashes = {str(path.relative_to(REPO)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    def command(label, args):
        result = subprocess.run([sys.executable, '-B', *map(str, args)], cwd=REPO,
                                env=environment, capture_output=True, timeout=45)
        (out/(label+'.stdout')).write_bytes(result.stdout)
        (out/(label+'.stderr')).write_bytes(result.stderr)
        return result
    source = out/'source'
    source.mkdir(mode=0o700)
    (source/'input').mkdir(mode=0o700)
    names = ['first.raw', 'second.raw']
    photos = []
    for name, blocks in zip(names, [1, 1024]):
        data = (b'Synthetic byte custody. Not decoded imagery.\n'*2048)[:65536]
        digest = hashlib.sha256()
        with (source/'input'/name).open('xb') as stream:
            for _ in range(blocks):
                stream.write(data)
                digest.update(data)
            stream.flush()
            os.fsync(stream.fileno())
        photos.append({'filename': name, 'url': 'http://127.0.0.1:1/never-fetched-'+name,
                       'sizeBytes': len(data)*blocks, 'checksumSha256': digest.hexdigest()})
    request = {'schemaVersion': 'natford-aerial-processing.v1.1',
               'requestId': 'synthetic-native-source-0001',
               'externalRef': {'workspaceId': 'synthetic-workspace', 'missionId': 'synthetic-mission'},
               'imagery': {'type': 'photo_manifest', 'photos': photos},
               'callbackUrl': 'http://127.0.0.1:1/never-called'}
    context = {'installationId': 'synthetic-installation', 'originalActorId': 'synthetic-original-actor',
               'targetId': 'synthetic-target', 'workspaceId': 'synthetic-workspace',
               'missionId': 'synthetic-mission', 'applicationJobId': 'synthetic-original-app-job'}
    def factory(payload):
        reference = 'synthetic-native-source-job'
        return reference, {'requestId': payload['requestId'], 'jobReference': reference,
                           'status': 'accepted', 'callbackId': 'synthetic-original-callback',
                           'occurredAt': 'synthetic-fixture-time'}
    admission, _ = Journal(source/'journal').admit(request, factory, max_queued=1)
    fixture = {'request': request, 'admission': asdict(admission), 'context': context,
               'sourceNames': names, 'maxBytes': sum(item['sizeBytes'] for item in photos)}
    save(source/'fixture.json', fixture)
    first = source/'pack/objects/source-00000.bin'
    second = source/'pack/objects/source-00001.bin'
    manifest = source/'pack/manifest.json'
    with (out/'producer.stdout').open('xb') as stdout, (out/'producer.stderr').open('xb') as stderr:
        producer = subprocess.Popen([sys.executable, '-B', str(Path(__file__)), '--phase', 'produce', '--root', str(source)],
                                    cwd=REPO, env=environment, stdout=stdout, stderr=stderr)
        try:
            deadline = time.monotonic()+30
            while not first.is_file():
                if producer.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError('No native first-slot interruption window observed')
                time.sleep(0.001)
            producer.terminate()
            producer.wait(timeout=5)
        finally:
            if producer.poll() is None:
                producer.terminate()
                producer.wait(timeout=5)
    values = {'producerExit': producer.returncode,
              'firstSlotPublishedBeforeInterruption': first.is_file(),
              'secondSlotUnpublishedAfterInterruption': not second.exists(),
              'manifestUnpublishedAfterInterruption': not manifest.exists(),
              'completePlanBeforeInterruption': len(json.loads((source/'pack/plan.json').read_text())['sources']) == 2}
    for key in values:
        if type(values[key]) is not type(EXPECTED[key]) or values[key] != EXPECTED[key]:
            save(out/'interruption-failure.json', values)
            raise ValueError('source-native-'+key)
    def ordinary(root):
        return {key: value for key, value in helper.inventory(root).items()
                if key != 'journal/'+FILENAME and not key.startswith('journal/'+FILENAME+'-')}
    source_ordinary = ordinary(source)
    source_sql = helper.sqlite_image(source/'journal'/FILENAME)
    capture = command('capture', [REPO/'openplan/scripts/ops/worker_root_snapshot.py', '--source', source,
                                '--destination', out/'package', '--writers-quiesced', '--timeout', '30'])
    verification = command('verify', [REPO/'openplan/scripts/ops/worker_root_snapshot.py', '--destination', out/'package', '--verify'])
    retained = out/'package/root'
    package_ordinary = ordinary(retained)
    package_sql = helper.sqlite_image(retained/'journal'/FILENAME)
    runtime = out/'runtime'
    shutil.copytree(retained, runtime)
    runtime_ordinary = ordinary(runtime)
    replay = command('replay', [Path(__file__), '--phase', 'replay', '--root', runtime])
    if replay.returncode == 0:
        values.update(json.loads(replay.stdout))
    variants = [
        ('changedRawSource', 'input/second.raw', 'Original planned source bytes differ'),
        ('changedRetainedSlot', 'pack/objects/source-00000.bin', 'Retained source slot differs'),
        ('changedOriginalActor', 'fixture.json', 'Saved source preparation identity differs'),
    ]
    for label, relative, reason in variants:
        changed = out/label
        shutil.copytree(retained, changed)
        path = changed/relative
        original = path.read_bytes()
        try:
            if label == 'changedOriginalActor':
                altered = json.loads(original)
                altered['context']['originalActorId'] = 'synthetic-other-actor'
                path.write_text(json.dumps(altered))
            else:
                with path.open('r+b') as stream:
                    stream.write(b'!')
                    stream.flush()
                    os.fsync(stream.fileno())
            refusal = command(label, [Path(__file__), '--phase', 'attempt', '--root', changed])
            values[label+'Exit'] = refusal.returncode
            values[label+'Refusal'] = ('ValueError: '+reason).encode() in refusal.stderr and not (changed/'pack/manifest.json').exists()
        finally:
            with path.open('wb') as stream:
                stream.write(original)
                stream.flush()
                os.fsync(stream.fileno())
    values.update({
        'captureExit': capture.returncode, 'verifyExit': verification.returncode, 'replayExit': replay.returncode,
        'sourceOrdinaryUnchanged': source_ordinary == ordinary(source),
        'sourceJournalUnchanged': source_sql == helper.sqlite_image(source/'journal'/FILENAME),
        'packageOrdinaryUnchanged': package_ordinary == ordinary(retained),
        'packageJournalUnchanged': package_sql == helper.sqlite_image(retained/'journal'/FILENAME),
        'retainedOrdinaryMatchesSource': source_ordinary == package_ordinary,
        'retainedJournalMatchesSource': source_sql == package_sql,
        'runtimeOrdinaryMatchesPackageBeforeResume': runtime_ordinary == package_ordinary,
        'runtimeJournalMatchesPackage': source_sql == helper.sqlite_image(runtime/'journal'/FILENAME),
        'sourceBindingsUnchanged': all(hashlib.sha256(path.read_bytes()).hexdigest() == hashes[str(path.relative_to(REPO))] for path in paths),
    })
    save(out/'observed.json', values)
    observe(values)
    controls = []
    for label, trial in [('baseline', values), ('harmless-key-order', dict(reversed(list(values.items())))), ('restored', values)]:
        observe(trial)
        controls.append({'control': label, 'outcome': 'survived'})
    for key, expected in EXPECTED.items():
        for kind in ('changed', 'missing', 'wrong_type'):
            trial = dict(values)
            if kind == 'missing':
                trial.pop(key)
            elif kind == 'wrong_type':
                trial[key] = int(expected) if type(expected) is bool else float(expected)
            else:
                trial[key] = not expected if type(expected) is bool else expected+1
            try:
                observe(trial)
            except ValueError as error:
                if str(error) != 'source-native-'+key:
                    raise
                controls.append({'control': key+'-'+kind, 'outcome': 'intended_failure'})
            else:
                raise AssertionError('Native source observation control survived: '+key+'-'+kind)
    save(out/'controls.json', controls)
    save(out/'source-bindings.json', hashes)
    save(out/'result.json', {'outcome': 'interrupted_source_copy_recovery_passed', 'workerRecoveryAccepted': False,
                            'nativeImageryOrEngineExecuted': False, 'sourceBytes': fixture['maxBytes'],
                            'controls': len(controls), 'positive': 3, 'broken': len(EXPECTED)*3,
                            'elapsedSeconds': round(time.monotonic()-began, 3)})
    print((out/'result.json').read_text())


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--phase', choices=['produce', 'replay', 'attempt'])
    parser.add_argument('--root', type=Path)
    args = parser.parse_args()
    if args.phase:
        child(args.phase, args.root)
    else:
        run(args.out.absolute())
