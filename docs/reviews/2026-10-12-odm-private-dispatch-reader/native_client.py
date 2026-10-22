"""Actual private RPC into custody, with explicitly supplied source/engine adapters."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import time
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'workers/odm_worker'))
from application_dispatch_http import Transport
from application_dispatch_reader import Reader
from runtime_admission import Runtime
from runtime_dispatch_custody import Custody, Pipeline
from runtime_preparation import JOB_FIELDS
from runtime_url_draft import Pipeline as UrlDraft
from runtime_url_intake import Intake


def run(config, phase, root):
    request = json.loads(config['payloadText'])
    request_id = request['requestId']
    scope = config['scope']
    if phase in ('capture', 'revoked-first', 'wrong-target', 'anonymous'):
        root.mkdir(mode=0o700)
    runtime = Runtime(root, scope['installationId'], max_queued=2, pipeline=lambda job: None)
    runtime.submit(request)
    custody = Custody(runtime, scope['targetId'], timeout=5)
    calls, fetches, sends = [], [], []
    token = config['anonToken'] if phase == 'anonymous' else config['serviceToken']
    transport = Transport(config['endpoint'], 'owned-fixture-service',
        lambda reference: {'apiKey': token, 'bearerToken': token}, allow_http=True)
    def read(arguments, deadline, *, owned):
        calls.append(dict(arguments));return transport(arguments, deadline, owned=owned)
    reader = Reader(custody, read)
    raw = [b'Synthetic retained image A', b'Synthetic retained image B']
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for index, payload in enumerate(raw):
            archive.writestr(('a.jpg', 'b.jpg')[index], payload)
    zipped = buffer.getvalue()
    projection = {key: config['job'][key] for key in JOB_FIELDS}
    settings = {'applicationJob': projection, 'targetId': scope['targetId'], 'maxBytes': 4096,
        'engine': {'instanceId': 'supplied-fixture-engine', 'endpoint': 'http://127.0.0.1:1',
            'api': 'nodeodm-2.2.4-draft', 'version': '2.2.4', 'imageId': 'sha256:' + 'a' * 64,
            'configurationSha256': 'b' * 64, 'credentialReference': 'supplied-fixture-no-secret'},
        'options': [{'name': 'synthetic-flag', 'value': True}], 'filenames': None,
        'zipLimits': {'max_expanded_bytes': 4096, 'max_entries': 10, 'max_directory_bytes': 4096}}
    def fetch(url, output, remaining, deadline):
        assert url == request['imagery']['url'], 'Native pipeline must use its original source URL'
        saved = custody.load(request_id, deadline=deadline)
        assert saved['payloadText'] == config['payloadText'], 'Native private original must precede source fetching'
        fetches.append(url);output.write(zipped);return len(zipped)
    def send(engine, command, stream, deadline):
        assert not command['path'].startswith('/task/new/commit/'), 'Native private reader cannot send a commit'
        sends.append(stream.read() if stream else None)
        return 200, json.dumps({'uuid': command['headers']['set-uuid']}).encode() if stream is None else b'{"success":true}'
    def refuse(message):
        def fail(*args, **kwargs):raise AssertionError(message)
        return fail
    def pipeline(current_runtime, current_custody, capture, supply, fetch_adapter, source_root):
        intake = Intake(current_runtime, source_root, scope['targetId'], supply, fetch_adapter, timeout=5)
        return Pipeline(UrlDraft(intake, lambda *args: True, send, timeout=5), current_custody,
            capture, capture_with_deadline=True)
    with runtime.owner():
        entry = runtime.journal.get(request_id)
        if entry.phase == 'accepted':
            entry = runtime.journal.start(request_id, entry.job_reference, runtime.context)[0]
        if phase == 'capture':
            work = pipeline(runtime, custody, reader.capture, lambda entry: settings, fetch, root.parent / 'sources')
            result = work.advance(request_id)
            saved = custody.load(request_id)
            assert saved['payloadText'].encode() == config['payloadText'].encode(), 'Native private reader must preserve exact original bytes'
            assert saved['applicationJob'] == config['job'], 'Native private reader must preserve all eight original job fields'
            assert len(calls) == len(fetches) == len(sends) == 1, 'Native first advance must read, fetch and initialize once'
            assert result['draft']['operation'] == 'init' and result['commitPermission'] is False
            assert saved['engineTransportPermission'] is False and saved['authorityVerification'] == 'unassessed'
            return {'rpcReads': len(calls), 'sourceFetches': len(fetches), 'suppliedEngineCommands': len(sends),
                'payloadSha256': saved['payloadSha256'], 'engineTransportPermission': False}
        if phase == 'observe':
            before = (custody.folder(request_id) / 'receipt.json').read_bytes()
            current = reader.observe(request_id)
            assert current['authorizedNow'] is False, 'Native private observation must preserve revoked access'
            assert current['engineTransportPermission'] is False, 'Native observation cannot grant engine permission'
            assert before == (custody.folder(request_id) / 'receipt.json').read_bytes(), 'Native observation must preserve saved original'
            return {'rpcReads': len(calls), 'authorizedNow': False, 'engineTransportPermission': False, 'originalUnchanged': True}
        if phase == 'recover':
            work = pipeline(runtime, custody, refuse('Relocated private original was queried again'),
                refuse('Relocated original settings were supplied again'), refuse('Relocated retained bytes were fetched again'), root.parent / 'missing-source')
            results = [work.advance(request_id) for _ in range(3)]
            assert [value['draft']['operation'] for value in results] == ['upload:0', 'upload:1', None], 'Native relocation must preserve original command order'
            assert sends == raw, 'Native relocation must upload exact retained image bytes'
            assert results[-1]['draft']['state'] == 'draft_complete_commit_held', 'Native relocation must keep commit held'
            assert not (root.parent / 'missing-source').exists(), 'Native relocation must not require its download root'
            assert all(value['commitPermission'] is False for value in results)
            return {'rpcReads': len(calls), 'sourceFetches': len(fetches), 'suppliedEngineCommands': len(sends), 'commitHeld': True}
        if phase == 'deadline':
            before = (custody.folder(request_id) / 'receipt.json').read_bytes()
            began = time.monotonic()
            try:reader.capture(entry, deadline=began + .8)
            except TimeoutError as error:
                assert str(error) == 'Private dispatch deadline exceeded', 'Native stalled read must use its shared client deadline'
            else:raise AssertionError('Native stalled private read exceeded its shared deadline')
            assert time.monotonic() - began < 3, 'Native stalled read must stop and join its child'
            assert before == (custody.folder(request_id) / 'receipt.json').read_bytes()
            return {'rpcReads': len(calls), 'deadlineSeconds': .8, 'originalUnchanged': True}
        if phase == 'wrong-target':
            custody.target = 'different-fixture-target'
        try:reader.capture(entry)
        except PermissionError as error:
            assert phase == 'revoked-first' and str(error) == 'Private application dispatch actor is no longer authorized'
        except ValueError as error:
            assert phase in ('wrong-target', 'anonymous') and str(error) == 'Private dispatch RPC read did not complete'
        else:raise AssertionError('Native private refusal must precede original source work')
        assert not custody.folder(request_id).exists() and not fetches and not sends
        return {'rpcReads': len(calls), 'originalSaved': False, 'sourceFetches': 0, 'suppliedEngineCommands': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path);parser.add_argument('phase', choices=['capture', 'observe', 'recover', 'deadline', 'revoked-first', 'wrong-target', 'anonymous'])
    parser.add_argument('root', type=Path);parser.add_argument('result', type=Path)
    args = parser.parse_args();os.umask(0o077)
    value = run(json.loads(args.config.read_text()), args.phase, args.root)
    args.result.write_text(json.dumps(value, indent=2) + '\n')
