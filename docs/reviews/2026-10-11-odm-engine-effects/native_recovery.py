"""Abrupt own-child exit and stopped-root replay of disconnected engine effects."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO/'workers/odm_worker'))
from admission_journal import FILENAME, Journal
from engine_effects import Effects

TASK = '12345678-1234-4234-8234-123456789abc'
EXPECTED = {'childExit': 19, 'captureExit': 0, 'verifyExit': 0,
    'originalSourceMatchesPackage': True, 'runtimeInitiallyMatchesPackage': True,
    'originalPlanIdentityPreserved': True, 'allIssuedFlagsFalse': True,
    'originalReplyBytesPreserved': True, 'unresolvedOriginalUploadPreserved': True,
    'commitRemainsUnissued': True, 'noOriginalSourceAccessRequired': True,
    'runtimeOrdinaryUnchanged': True, 'runtimeJournalUnchanged': True,
    'sourceUnchanged': True, 'packageUnchanged': True,
    'changedEngineRefused': True, 'changedReplyHashRefused': True,
    'changedSourceBytesRefused': True, 'sourceBindingsUnchanged': True}


def observe(values):
    for key, expected in EXPECTED.items():
        if key not in values or type(values[key]) is not type(expected) or values[key] != expected:
            raise ValueError('engine-effects-native-'+key)


def save(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, sort_keys=True);stream.write('\n');stream.flush();os.fsync(stream.fileno())


def arguments(root, input_root):
    context = {key: 'synthetic-'+key for key in ('installationId','originalActorId','targetId','applicationJobId')}
    context.update(workspaceId='synthetic-workspace', missionId='synthetic-mission')
    return {'root': root/'effects', 'source_arguments': {
        'journal': Journal(root/'admissions'), 'request_id': 'synthetic-engine-native-request',
        'reference': 'synthetic-original-job', 'context': context, 'source_root': input_root,
        'sources': ['a.jpg','b.jpg'], 'destination': root/'source', 'max_bytes': 4096, 'timeout': 2},
        'engine': {'instanceId': 'synthetic-original-engine', 'endpoint': 'http://127.0.0.1:1',
            'api': 'nodeodm-2.2.4-draft', 'version': '2.2.4', 'imageId': 'sha256:'+'a'*64,
            'configurationSha256': 'b'*64, 'credentialReference': 'synthetic-no-secret'},
        'task_uuid': TASK, 'name': 'Synthetic native effects', 'options': [], 'filenames': ['slot-a.jpg','slot-b.jpg']}


def child(out):
    source = out/'source';source.mkdir(mode=0o700)
    inputs = out/'input';inputs.mkdir(mode=0o700)
    for name in ('a.jpg', 'b.jpg'):
        path = inputs/name;path.write_bytes(('Synthetic ordinary source '+name).encode());path.chmod(0o600)
    args = arguments(source, inputs)
    request = {'requestId': 'synthetic-engine-native-request', 'externalRef': {
        'workspaceId': 'synthetic-workspace', 'missionId': 'synthetic-mission'},
        'imagery': {'type': 'photo_manifest', 'photos': [{'filename': name,
        'url': 'http://127.0.0.1:1/never-'+name} for name in ('a.jpg', 'b.jpg')]}}
    args['source_arguments']['journal'].admit(request, lambda value: ('synthetic-original-job', {
        'requestId': value['requestId'], 'jobReference': 'synthetic-original-job', 'status': 'accepted'}), max_queued=2)
    effects = Effects(**args)
    for operation in ('init', 'upload:0', 'upload:1'):
        _intent, first = effects.issue(operation)
        if first is not True: raise ValueError('Fresh child did not issue original intent')
        if operation != 'upload:1':
            body = ('{ "uuid": "'+TASK+'" }\n').encode() if operation == 'init' else b'{ "success": true }\n'
            effects.save_reply(operation, 200, body)
    save(out/'child-snapshot.json', effects.snapshot())
    # Transactions and files already returned after fsync. No finally or normal
    # interpreter shutdown runs. This is not interruption inside fsync or HTTP.
    os._exit(19)


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700);began = time.monotonic()
    spec = importlib.util.spec_from_file_location('engine_effects_root', REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    def ordinary(root):
        return {key: value for key, value in helper.inventory(root).items()
                if key not in {'admissions/'+FILENAME+suffix for suffix in ('', '-wal', '-shm')}}
    def logical(root):
        return helper.sqlite_image(root/'admissions'/FILENAME)
    paths = [Path(__file__), REPO/'workers/odm_worker/engine_effects.py', REPO/'workers/odm_worker/retained_source.py',
        REPO/'workers/odm_worker/admission_journal.py', REPO/'openplan/scripts/ops/worker_root_snapshot.py',
        REPO/'openplan/scripts/ops/worker_journal_snapshot.py', REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py']
    bindings = {str(path.relative_to(REPO)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    def command(label, args):
        result = subprocess.run(list(map(str, args)), cwd=REPO, capture_output=True, timeout=30,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        (out/(label+'.stdout')).write_bytes(result.stdout);(out/(label+'.stderr')).write_bytes(result.stderr)
        return result
    result = command('child', [sys.executable,'-B',__file__,'--child','--out',out])
    source = out/'source';package = out/'package';runtime = out/'runtime'
    original = ordinary(source);original_logical = logical(source)
    captured = command('capture', [sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
        '--source',source,'--destination',package,'--writers-quiesced','--timeout','20'])
    verified = command('verify', [sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py','--destination',package,'--verify'])
    package_image = helper.inventory(package);package_logical = logical(package/'root')
    saved_root = package/'root'
    observed = {'childExit': result.returncode, 'captureExit': captured.returncode, 'verifyExit': verified.returncode,
        'originalSourceMatchesPackage': ordinary(saved_root) == original and logical(saved_root) == original_logical}
    shutil.copytree(saved_root, runtime)
    observed['runtimeInitiallyMatchesPackage'] = ordinary(runtime) == original and logical(runtime) == original_logical
    # The source pack is complete; a fresh process must not depend on these files.
    no_input = out/'absent-input'
    observed['noOriginalSourceAccessRequired'] = not no_input.exists()
    before = ordinary(runtime)
    effects = Effects(**arguments(runtime, no_input))
    prior = json.loads((out/'child-snapshot.json').read_bytes())
    observed['originalPlanIdentityPreserved'] = effects.snapshot() == prior
    observed['allIssuedFlagsFalse'] = all(effects.issue(op)[1] is False for op in ('init','upload:0','upload:1'))
    original_replies = {str(path.relative_to(source)): path.read_bytes() for path in (source/'effects').glob('*.reply.json')}
    observed['originalReplyBytesPreserved'] = all((runtime/name).read_bytes() == raw for name, raw in original_replies.items())
    snapshot = effects.snapshot();states = {row['operation']: row['state'] for row in snapshot['commands']}
    observed['unresolvedOriginalUploadPreserved'] = states['upload:1'] == 'unresolved'
    observed['commitRemainsUnissued'] = states['commit'] == 'unissued'
    observed['runtimeOrdinaryUnchanged'] = ordinary(runtime) == before
    args = arguments(runtime, no_input);args['engine']['instanceId'] = 'another-engine'
    try: Effects(**args)
    except ValueError: observed['changedEngineRefused'] = True
    else: observed['changedEngineRefused'] = False
    for label, name in [('changedReplyHashRefused','effects/command-00001.reply.json'),
                        ('changedSourceBytesRefused','source/objects/source-00000.bin')]:
        path = runtime/name;raw = path.read_bytes()
        try:
            if label == 'changedReplyHashRefused':
                value = json.loads(raw);value['bodySha256'] = '0'*64
                path.write_bytes((json.dumps(value, sort_keys=True, separators=(',',':'))+'\n').encode())
            else: path.write_bytes(b'Changed synthetic bytes')
            try: Effects(**arguments(runtime, no_input))
            except ValueError: observed[label] = True
            else: observed[label] = False
        finally:
            path.write_bytes(raw)
            with path.open('rb') as stream: os.fsync(stream.fileno())
    observed['sourceUnchanged'] = ordinary(source) == original and logical(source) == original_logical
    observed['packageUnchanged'] = helper.inventory(package) == package_image and logical(package/'root') == package_logical
    observed['runtimeOrdinaryUnchanged'] = ordinary(runtime) == before
    observed['runtimeJournalUnchanged'] = logical(runtime) == original_logical
    observed['sourceBindingsUnchanged'] = all(hashlib.sha256((REPO/name).read_bytes()).hexdigest() == digest for name, digest in bindings.items())
    save(out/'observed.json', observed);observe(observed)
    controls = []
    for label, value in [('baseline', observed), ('harmless-extra-observation', {**observed,'syntheticNote':'harmless'}), ('restored', dict(observed))]:
        observe(value);controls.append({'control':label,'outcome':'survived'})
    for key, expected in EXPECTED.items():
        for kind in ('changed','missing','wrong-type'):
            value = copy.deepcopy(observed)
            if kind == 'missing': value.pop(key)
            elif kind == 'wrong-type': value[key] = int(expected) if type(expected) is bool else str(expected)
            else: value[key] = not expected if type(expected) is bool else expected+1
            try: observe(value)
            except ValueError as error:
                if str(error) != 'engine-effects-native-'+key: raise
                controls.append({'control':kind+'-'+key,'outcome':'intended_failure'})
            else: raise AssertionError('Native observation control survived')
    save(out/'controls.json', controls);save(out/'source-bindings.json', bindings)
    final = {'outcome':'disconnected_effect_root_replay_passed','seconds':round(time.monotonic()-began,3),
        'observations':len(EXPECTED),'controls':len(controls),'workerRecoveryAccepted':False,
        'engineOrNetworkExecuted':False,'nativeChildExit':result.returncode}
    save(out/'result.json', final);print(json.dumps(final))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--child',action='store_true');args = parser.parse_args()
    child(args.out.absolute()) if args.child else run(args.out.absolute())
