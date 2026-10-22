"""Actual private RPC, native attestation and real draft HTTP with synthetic bytes."""
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
from draft_http import Transport as NativeTransport
from native_engine_attestation import Attestor
from application_draft_authority import Authority
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
    calls, fetches, sends, attestations = [], [], [], []
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
    native_config = json.loads(Path(os.environ['OPENPLAN_NATIVE_COMPOSITION_ENGINE']).read_text())
    projection = {key: config['job'][key] for key in JOB_FIELDS}
    settings = {'applicationJob': projection, 'targetId': scope['targetId'], 'maxBytes': 4096,
        'engine': native_config['engine'],
        'options': [], 'filenames': None,
        'zipLimits': {'max_expanded_bytes': 4096, 'max_entries': 10, 'max_directory_bytes': 4096}}
    def fetch(url, output, remaining, deadline):
        assert url == request['imagery']['url'], 'Native pipeline must use its original source URL'
        saved = custody.load(request_id, deadline=deadline)
        assert saved['payloadText'] == config['payloadText'], 'Native private original must precede source fetching'
        fetches.append(url);output.write(zipped);return len(zipped)
    sender = NativeTransport(settings['engine'], lambda reference: None, cancelled=lambda: runtime._owned is not True)
    observer = Attestor(settings['engine'], native_config['socketPath'], native_config['daemonUid'])
    def send(engine, command, stream, deadline):
        assert not command['path'].startswith('/task/new/commit/'), 'Native private reader cannot send a commit'
        body = stream.read() if stream else None;sends.append(body)
        return sender(engine, command, io.BytesIO(body) if body is not None else None, deadline)
    def refuse(message):
        def fail(*args, **kwargs):raise AssertionError(message)
        return fail
    def attest(engine, deadline, *, owned):
        assert engine == settings['engine'] and owned() is True and time.monotonic() < deadline, 'Native draft attestation requires original owned identity and shared deadline'
        attestations.append(dict(engine));return observer(engine, deadline, owned=owned)
    def pipeline(current_runtime, current_custody, capture, supply, fetch_adapter, source_root):
        intake = Intake(current_runtime, source_root, scope['targetId'], supply, fetch_adapter, timeout=5)
        current = Reader(current_custody, read)
        authority = Authority(current, settings['engine'], attest)
        return Pipeline(UrlDraft(intake, authority, send, timeout=5, authorize_with_deadline=True), current_custody,
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
            assert len(calls) == 2 and len(fetches) == len(sends) == len(attestations) == 1, 'Native first command requires original capture and current access before engine use'
            assert result['draft']['operation'] == 'init' and result['commitPermission'] is False
            assert saved['engineTransportPermission'] is False and saved['authorityVerification'] == 'unassessed'
            return {'rpcReads': len(calls), 'sourceFetches': len(fetches), 'nativeEngineCommands': len(sends),
                'nativeTaskUuid': json.loads(next(root.glob('preparation-*/engine/plan.json')).read_text())['taskUuid'], 'payloadSha256': saved['payloadSha256'], 'engineTransportPermission': False, 'engineAttestations': len(attestations)}
        if phase == 'observe':
            before = (custody.folder(request_id) / 'receipt.json').read_bytes()
            current = reader.observe(request_id)
            assert current['authorizedNow'] is False, 'Native private observation must preserve revoked access'
            assert current['engineTransportPermission'] is False, 'Native observation cannot grant engine permission'
            assert before == (custody.folder(request_id) / 'receipt.json').read_bytes(), 'Native observation must preserve saved original'
            work = pipeline(runtime, custody, refuse('Revoked original was recaptured'),
                refuse('Revoked original settings were resupplied'), refuse('Revoked original was fetched'), root.parent/'revoked-missing-source')
            try:work.advance(request_id)
            except PermissionError as error:assert str(error) == 'Explicit draft permission was not confirmed'
            else:raise AssertionError('Native revoked access must refuse the next original upload')
            assert not sends and not fetches and not attestations, 'Native revoked access cannot reach engine or source work'
            assert not list(root.glob('preparation-*/engine/command-00001.intent.json')), 'Native revoked access cannot record the next intent'
            assert before == (custody.folder(request_id)/'receipt.json').read_bytes()
            return {'rpcReads': len(calls), 'authorizedNow': False, 'engineTransportPermission': False,
                'originalUnchanged': True, 'deniedBeforeNextIntent': True, 'nativeEngineCommands': 0, 'engineAttestations': 0}
        if phase == 'recover':
            work = pipeline(runtime, custody, refuse('Relocated private original was queried again'),
                refuse('Relocated original settings were supplied again'), refuse('Relocated retained bytes were fetched again'), root.parent / 'missing-source')
            results = [work.advance(request_id) for _ in range(3)]
            assert [value['draft']['operation'] for value in results] == ['upload:0', 'upload:1', None], 'Native relocation must preserve original command order'
            assert sends == raw, 'Native relocation must upload exact retained image bytes'
            assert results[-1]['draft']['state'] == 'draft_complete_commit_held', 'Native relocation must keep commit held'
            assert not (root.parent / 'missing-source').exists(), 'Native relocation must not require its download root'
            assert all(value['commitPermission'] is False for value in results)
            return {'rpcReads': len(calls), 'sourceFetches': len(fetches), 'nativeEngineCommands': len(sends), 'nativeTaskUuid': json.loads(next(root.glob('preparation-*/engine/plan.json')).read_text())['taskUuid'], 'commitHeld': True, 'engineAttestations': len(attestations)}
        if phase in ('engine-refused', 'engine-authority-restored'):
            before = (custody.folder(request_id) / 'receipt.json').read_bytes()
            intent = next(root.glob('preparation-*')) / 'engine/command-00001.intent.json'
            assert not intent.exists(), 'Engine refusal proof must begin before its next intent'
            if phase == 'engine-refused':
                work = pipeline(runtime, custody, refuse('Native engine refusal recaptured its original'),
                    refuse('Native engine refusal resupplied settings'), refuse('Native engine refusal fetched source'), root.parent/'missing-refusal-source')
                try:work.advance(request_id)
                except ValueError as error:
                    assert str(error) == 'Native engine observation refused', 'Changed native engine must refuse its original attestation'
                else:raise AssertionError('Changed native engine must refuse before the next intent')
            else:
                from engine_effects import commands
                plan = json.loads(next(root.glob('preparation-*/engine/plan.json')).read_text())
                authority = Authority(reader, settings['engine'], attest)
                assert authority(plan, 'upload:0', commands(plan)['upload:0'], deadline=time.monotonic()+5) is True, 'Restored native original authority must pass'
            assert len(calls) == len(attestations) == 1 and not sends and not fetches, 'Native engine refusal requires current access and actual attestation before transport'
            assert not intent.exists(), 'Native engine refusal cannot record the next intent'
            assert before == (custody.folder(request_id) / 'receipt.json').read_bytes(), 'Native engine refusal must preserve saved original'
            return {'rpcReads':len(calls), 'engineAttestations':len(attestations), 'nativeEngineCommands':0,
                'originalUnchanged':True, 'nextIntentAbsent':True, 'engineRefused':phase=='engine-refused', 'restoredAuthority':phase=='engine-authority-restored'}
        if phase == 'deadline':
            before = (custody.folder(request_id) / 'receipt.json').read_bytes()
            began = time.monotonic()
            plan = json.loads(next(root.glob('preparation-*/engine/plan.json')).read_text())
            from engine_effects import commands
            authority = Authority(reader, settings['engine'], attest)
            try:authority(plan, 'init', commands(plan)['init'], deadline=began + .8)
            except TimeoutError as error:
                assert str(error) == 'Private dispatch deadline exceeded', 'Native stalled read must use its shared client deadline'
            else:raise AssertionError('Native stalled private read exceeded its shared deadline')
            assert time.monotonic() - began < 3, 'Native stalled read must stop and join its child'
            assert not sends and not attestations, 'Stalled native authority cannot reach engine work'
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
        return {'rpcReads': len(calls), 'originalSaved': False, 'sourceFetches': 0, 'nativeEngineCommands': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path);parser.add_argument('phase', choices=['capture', 'observe', 'recover', 'deadline', 'revoked-first', 'wrong-target', 'anonymous', 'engine-refused', 'engine-authority-restored'])
    parser.add_argument('root', type=Path);parser.add_argument('result', type=Path)
    args = parser.parse_args();os.umask(0o077)
    value = run(json.loads(args.config.read_text()), args.phase, args.root)
    args.result.write_text(json.dumps(value, indent=2) + '\n')
