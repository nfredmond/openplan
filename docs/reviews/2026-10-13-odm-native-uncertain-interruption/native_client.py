"""Observe an owned upload reply, exit before journal saving and hold recovery.

The interruption is an actual process exit after a fully received response.
It does not simulate an acknowledgment lost in the network.
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
BASE = ROOT/'docs/reviews/2026-10-13-odm-native-private-authority-composition/native_client.py'
spec = importlib.util.spec_from_file_location('original_native_composition_client', BASE)
base = importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
from engine_effects import parsed_reply

EXIT = 73


def files(folder):
    return {str(path.relative_to(folder)):hashlib.sha256(path.read_bytes()).hexdigest()
        for path in folder.rglob('*') if path.is_file()}


def retained(config, phase, root):
    request = json.loads(config['payloadText']);scope = config['scope']
    request_id = request['requestId']
    runtime = base.Runtime(root, scope['installationId'], max_queued=2, pipeline=lambda job: None)
    runtime.submit(request)
    custody = base.Custody(runtime, scope['targetId'], timeout=5)
    configuration = json.loads(Path(os.environ['OPENPLAN_NATIVE_COMPOSITION_ENGINE']).read_text())
    engine = configuration['engine']
    counters = {'reads':0, 'attestations':0, 'commands':0}
    token = config['serviceToken']
    rpc = base.Transport(config['endpoint'], 'owned-fixture-service',
        lambda reference:{'apiKey':token, 'bearerToken':token}, allow_http=True)
    def read(arguments, deadline, *, owned):
        counters['reads'] += 1
        return rpc(arguments, deadline, owned=owned)
    reader = base.Reader(custody, read)
    observer = base.Attestor(engine, configuration['socketPath'], configuration['daemonUid'])
    def attest(given, deadline, *, owned):
        counters['attestations'] += 1
        return observer(given, deadline, owned=owned)
    sender = base.NativeTransport(engine, lambda reference:None, cancelled=lambda:runtime._owned is not True)
    def refuse(*args, **kwargs):
        raise AssertionError('Interrupted recovery cannot fetch or resupply original inputs')
    def send(given, command, stream, deadline):
        counters['commands'] += 1
        assert phase == 'child-upload-interrupt', 'Held uncertainty cannot send another engine command'
        assert command['path'].startswith('/task/new/upload/'), 'Interruption must follow its original first upload'
        response = sender(given, command, stream, deadline)
        plan = json.loads(next(root.glob('preparation-*/engine/plan.json')).read_text())
        parsed_reply(plan, 'upload:0', *response)
        evidence = {'status':response[0], 'bodySha256':hashlib.sha256(response[1]).hexdigest(),
            'operation':'upload:0', 'taskUuid':plan['taskUuid'], 'checkedReply':True,
            'rpcReads':counters['reads'], 'attestations':counters['attestations'], 'commands':counters['commands']}
        path = root.parent/'checked-external-reply.json'
        with path.open('x') as output:
            json.dump(evidence, output);output.flush();os.fsync(output.fileno())
        descriptor = os.open(path.parent, os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
        # Only this proof's child exits. No receipt is returned to Draft.advance.
        os._exit(EXIT)
    intake = base.Intake(runtime, root.parent/'absent-source', scope['targetId'], refuse, refuse, timeout=5)
    work = base.UrlDraft(intake, base.Authority(reader, engine, attest), send,
        timeout=5, authorize_with_deadline=True)
    with runtime.owner():
        if phase == 'child-upload-interrupt':
            work.advance(request_id)
            raise AssertionError('The owned interrupted upload child returned normally')
        original = (custody.folder(request_id)/'receipt.json').read_bytes()
        pack = next(root.glob('preparation-*/engine'))
        before = files(pack)
        assert (pack/'command-00001.intent.json').is_file(), 'Interrupted upload requires a durable original intent'
        assert not (pack/'command-00001.reply.json').exists(), 'Interrupted upload must have no saved receipt'
        assert not (pack/'command-00002.intent.json').exists(), 'Interrupted upload cannot have the next intent'
        results = [work.advance(request_id) for _ in range(3)]
        assert all(value['draft']['state'] == 'held_uncertain' for value in results), 'Relocated interrupted upload must hold uncertainty'
        assert counters == {'reads':0, 'attestations':0, 'commands':0}, 'Held uncertainty cannot authorize or transport'
        assert all(value['commitPermission'] is False for value in results), 'Interrupted recovery must keep commit held'
        assert before == files(pack), 'Repeated uncertain recovery must preserve exact engine journal bytes'
        assert original == (custody.folder(request_id)/'receipt.json').read_bytes(), 'Interrupted recovery must preserve its original application receipt'
        return {'heldRepeats':len(results), 'unresolvedUpload':True, 'recoveryCommands':counters['commands'],
            'recoveryReads':counters['reads'], 'recoveryAttestations':counters['attestations'], 'originalUnchanged':True}


def run(config, phase, root, config_path):
    if phase not in ('interrupt-upload', 'child-upload-interrupt', 'recover-held'):
        return base.run(config, phase, root)
    if phase != 'interrupt-upload':return retained(config, phase, root)
    capture = base.run(config, 'capture', root)
    process = subprocess.run([sys.executable, '-B', str(Path(__file__)), str(config_path),
        'child-upload-interrupt', str(root), str(root.parent/'unused-child-result.json')],
        cwd=ROOT, capture_output=True, timeout=10,
        env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
    (root.parent/'interrupted-child-private.log').write_bytes(process.stdout+process.stderr)
    (root.parent/'interrupted-child-process.json').write_text(json.dumps({'returncode':process.returncode})+'\n')
    assert process.returncode == EXIT, 'Owned upload child must exit at the intended reply boundary'
    checked = json.loads((root.parent/'checked-external-reply.json').read_text())
    assert checked['checkedReply'] is True and checked['status'] == 200 and checked['operation'] == 'upload:0', 'Interruption requires an actually checked original upload reply'
    assert checked['taskUuid'] == capture['nativeTaskUuid'], 'Interrupted upload must use the original engine task'
    assert checked['commands'] == checked['rpcReads'] == checked['attestations'] == 1, 'Interrupted upload requires actual current authority and engine attestation'
    relocated = root.parent/'relocated-runtime';shutil.copytree(root, relocated)
    result = retained(config, 'recover-held', relocated)
    return {**result, 'childReturnCode':process.returncode, 'checkedExternalReply':True,
        'nativeTaskUuid':capture['nativeTaskUuid']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path);parser.add_argument('phase')
    parser.add_argument('root', type=Path);parser.add_argument('result', type=Path)
    args = parser.parse_args();os.umask(0o077)
    value = run(json.loads(args.config.read_text()), args.phase, args.root, args.config)
    args.result.write_text(json.dumps(value, indent=2)+'\n')
