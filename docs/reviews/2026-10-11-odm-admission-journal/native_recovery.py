"""Exercise the disconnected journal through process exit and actual root capture.

No HTTP worker, engine, imagery or callback consumer runs. SQLite copies use
the existing CLI; a separate observer checks schemas and every stored record.
"""
import argparse
from contextlib import closing
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO/'workers/odm_worker'))
from admission_journal import FILENAME, IdentityConflict, Journal

EXPECTED = {
    'producerExit': 19,
    'captureExit': 0,
    'verifyExit': 0,
    'replayExit': 0,
    'originalAcceptedReceipt': True,
    'originalStartedReceipt': True,
    'queueIdentity': True,
    'startedIdentity': True,
    'exactStartGrantsNoPermission': True,
    'changedPayloadRefused': True,
    'changedContextRefused': True,
    'acceptedStartGrantedOnce': True,
    'sourceOrdinaryUnchanged': True,
    'sourceJournalUnchanged': True,
    'packageOrdinaryUnchanged': True,
    'packageJournalUnchanged': True,
    'retainedOrdinaryMatchesSource': True,
    'retainedJournalMatchesSource': True,
    'runtimeOrdinaryMatchesPackage': True,
    'runtimeJournalMatchesPackage': True,
    'corruptPackageVerifyExit': 1,
    'sourceBindingsUnchanged': True,
}


def observe(values):
    for key, expected in EXPECTED.items():
        if key not in values or type(values[key]) is not type(expected) or values[key] != expected:
            raise ValueError('journal-native-' + key)


def write(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def request(number):
    return {'requestId': f'synthetic-native-admission-{number:04d}',
            'externalRef': {'workspaceId': 'synthetic-workspace', 'missionId': f'synthetic-mission-{number}'},
            'imagery': {'url': 'http://127.0.0.1:1/never-fetched'},
            'missionTitle': 'Synthetic journal fixture'}


def factory(payload):
    reference = 'odm-' + uuid.uuid4().hex[:20]
    return reference, {'requestId': payload['requestId'], 'jobReference': reference,
                       'status': 'accepted', 'callbackId': str(uuid.uuid4()),
                       'occurredAt': datetime.now(timezone.utc).isoformat()}


def child(phase, root, receipt):
    journal = Journal(root)
    if phase == 'produce':
        first, _ = journal.admit(request(1), factory, max_queued=2)
        second, _ = journal.admit(request(2), factory, max_queued=2)
        context = {'stage': 'unassessed-engine-intent', 'stableUuid': str(uuid.uuid4())}
        started, permission = journal.start(request(2)['requestId'], second.job_reference, context)
        write(receipt, {'accepted': asdict(first), 'started': asdict(started), 'firstPermission': permission})
        os._exit(19)
    saved = json.loads(receipt.read_text())
    def forbidden(_payload):
        raise AssertionError('replay attempted a new admission factory')
    first, created_first = journal.admit(request(1), forbidden, max_queued=0)
    second, created_second = journal.admit(request(2), forbidden, max_queued=0)
    queue = [asdict(item) for item in journal.accepted()]
    started_list = [asdict(item) for item in journal.started()]
    repeated, permission = journal.start(request(2)['requestId'], second.job_reference, saved['started']['started_context'])
    changed = request(1);changed['externalRef']['workspaceId'] = 'another-workspace'
    payload_refused = context_refused = False
    try:
        journal.admit(changed, forbidden, max_queued=0)
    except IdentityConflict:
        payload_refused = True
    try:
        journal.start(request(2)['requestId'], second.job_reference, {'stage': 'changed'})
    except IdentityConflict:
        context_refused = True
    _, first_permission = journal.start(request(1)['requestId'], first.job_reference, {'stage': 'first-restored-start'})
    _, second_permission = journal.start(request(1)['requestId'], first.job_reference, {'stage': 'first-restored-start'})
    print(json.dumps({
        'originalAcceptedReceipt': asdict(first) == saved['accepted'] and created_first is False,
        'originalStartedReceipt': asdict(second) == saved['started'] and created_second is False,
        'queueIdentity': queue == [saved['accepted']],
        'startedIdentity': started_list == [saved['started']],
        'exactStartGrantsNoPermission': asdict(repeated) == saved['started'] and permission is False,
        'changedPayloadRefused': payload_refused,
        'changedContextRefused': context_refused,
        'acceptedStartGrantedOnce': first_permission is True and second_permission is False,
    }))


def run(out):
    out.mkdir(mode=0o700)
    began = time.monotonic()
    spec = importlib.util.spec_from_file_location('journal_native_root', REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    paths = [Path(__file__), REPO/'workers/odm_worker/admission_journal.py',
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
    source = out/'source';source.mkdir(mode=0o700)
    (source/'empty').mkdir(mode=0o700)
    (source/'sentinel.bin').write_bytes(b'Synthetic ordinary-root sentinel. No imagery.\n')
    receipt = out/'original-receipt.json'
    producer = command('producer', [Path(__file__), '--phase', 'produce', '--root', source, '--receipt', receipt])
    def ordinary(root):
        return {key: value for key, value in helper.inventory(root).items() if key != FILENAME and not key.startswith(FILENAME+'-')}
    source_ordinary = ordinary(source)
    source_sql = helper.sqlite_image(source/FILENAME)
    capture = command('capture', [REPO/'openplan/scripts/ops/worker_root_snapshot.py', '--source', source,
                                '--destination', out/'package', '--writers-quiesced', '--timeout', '30'])
    verification = command('verify', [REPO/'openplan/scripts/ops/worker_root_snapshot.py', '--destination', out/'package', '--verify'])
    retained = out/'package/root'
    package_ordinary = ordinary(retained)
    package_sql = helper.sqlite_image(retained/FILENAME)
    runtime = out/'runtime';shutil.copytree(retained, runtime)
    runtime_ordinary, runtime_sql = ordinary(runtime), helper.sqlite_image(runtime/FILENAME)
    replay = command('replay', [Path(__file__), '--phase', 'replay', '--root', runtime, '--receipt', receipt])
    values = json.loads(replay.stdout) if replay.returncode == 0 else {}
    corrupt = out/'corrupt-package';shutil.copytree(out/'package', corrupt)
    with closing(sqlite3.connect(corrupt/'root'/FILENAME)) as connection, connection:
        connection.execute("UPDATE admissions SET admission_json='{}'")
    corrupted = command('corrupt-verify', [REPO/'openplan/scripts/ops/worker_root_snapshot.py', '--destination', corrupt, '--verify'])
    values.update({
        'producerExit': producer.returncode, 'captureExit': capture.returncode,
        'verifyExit': verification.returncode, 'replayExit': replay.returncode,
        'sourceOrdinaryUnchanged': source_ordinary == ordinary(source),
        'sourceJournalUnchanged': source_sql == helper.sqlite_image(source/FILENAME),
        'packageOrdinaryUnchanged': package_ordinary == ordinary(retained),
        'packageJournalUnchanged': package_sql == helper.sqlite_image(retained/FILENAME),
        'retainedOrdinaryMatchesSource': source_ordinary == package_ordinary,
        'retainedJournalMatchesSource': source_sql == package_sql,
        'runtimeOrdinaryMatchesPackage': runtime_ordinary == package_ordinary,
        'runtimeJournalMatchesPackage': runtime_sql == package_sql,
        'corruptPackageVerifyExit': corrupted.returncode,
        'sourceBindingsUnchanged': all(hashlib.sha256(path.read_bytes()).hexdigest() == hashes[str(path.relative_to(REPO))] for path in paths),
    })
    write(out/'observed.json', values)
    observe(values)
    controls = []
    for label, changed in [('baseline', values), ('harmless-key-order', dict(reversed(list(values.items())))), ('restored', values)]:
        observe(changed);controls.append({'control': label, 'outcome': 'survived'})
    for key, expected in EXPECTED.items():
        for kind in ('changed', 'missing', 'wrong_type'):
            changed = dict(values)
            if kind == 'missing':
                changed.pop(key)
            elif kind == 'wrong_type':
                changed[key] = int(expected) if type(expected) is bool else float(expected)
            else:
                changed[key] = not expected if type(expected) is bool else expected+1
            try:
                observe(changed)
            except ValueError as error:
                if str(error) != 'journal-native-'+key:
                    raise
                controls.append({'control': key+'-'+kind, 'outcome': 'intended_failure'})
            else:
                raise AssertionError('Native observation control survived: '+key+'-'+kind)
    write(out/'controls.json', controls)
    write(out/'source-bindings.json', hashes)
    write(out/'result.json', {'outcome': 'journal_recovery_passed', 'workerRecoveryAccepted': False,
                            'nativeImageryOrEngineExecuted': False, 'journalRows': len(source_sql['tables']['admissions']),
                            'controls': len(controls), 'positive': 3, 'broken': len(EXPECTED)*3,
                            'elapsedSeconds': round(time.monotonic()-began, 3)})
    print((out/'result.json').read_text())


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--phase', choices=['produce', 'replay'])
    parser.add_argument('--root', type=Path)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args()
    if args.phase:
        child(args.phase, args.root, args.receipt)
    else:
        run(args.out.absolute())
