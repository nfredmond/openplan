"""Stream the actual private reader ceilings through owned local processes."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import resource
import shutil
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'workers/odm_worker'))
from application_dispatch_http import Transport, RESPONSE_LIMIT
from application_dispatch_reader import Reader, FORMAT, WIRE_LIMIT
from runtime_admission import Runtime
from runtime_dispatch_custody import Custody, MAX_BYTES

READER = ROOT / 'workers/odm_worker/application_dispatch_reader.py'
HTTP = ROOT / 'workers/odm_worker/application_dispatch_http.py'
CHUNK = 256 * 1024


def client(config, phase, root):
    if phase != 'recover':root.mkdir(mode=0o700)
    runtime = Runtime(root, 'capacity-owned-installation', max_queued=2, pipeline=lambda job: None)
    runtime.submit(config['request'])
    custody = Custody(runtime, 'capacity-owned-target', timeout=10)
    transport = Transport(config['endpoint'], 'capacity-no-secret',
        lambda reference: {'apiKey': 'synthetic-no-secret', 'bearerToken': None},
        allow_http=True, cancelled=lambda: phase == 'cancel' and Path(config['cancelMarker']).exists())
    reader = Reader(custody, transport)
    request_id = config['request']['requestId']
    began = time.monotonic();deadline = began + 10
    with runtime.owner():
        entry = runtime.journal.get(request_id)
        if entry.phase == 'accepted':entry = runtime.journal.start(request_id, entry.job_reference, runtime.context)[0]
        if phase == 'recover':
            reader.transport = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('Maximum original recovery queried the network'))
            saved = custody.load(request_id, deadline=deadline)
            payload = saved['payloadText'].encode()
        elif phase in ('original-overflow', 'declared-overflow', 'actual-overflow', 'cancel'):
            expected = 'Private application dispatch original bytes differ' if phase == 'original-overflow' else 'Private dispatch read cancelled' if phase == 'cancel' else 'Private dispatch RPC read did not complete'
            try:reader.capture(entry, deadline=deadline)
            except (ValueError, InterruptedError) as error:
                assert str(error) == expected, 'Capacity refusal moved past its original boundary: ' + phase
            else:raise AssertionError('Capacity refusal was omitted: ' + phase)
            assert not custody.folder(request_id).exists(), 'Refused capacity read cannot save an original'
            return {'refused': True, 'phase': phase, 'originalSaved': False, 'seconds': round(time.monotonic() - began, 3)}
        else:
            payload, row = reader.capture(entry, deadline=deadline)
            assert len(payload) == MAX_BYTES and hashlib.sha256(payload).hexdigest() == config['payloadSha256'], 'Maximum private original must retain every exact byte'
            saved = custody.save(request_id, payload, row, deadline=deadline)
            assert custody.load(request_id, deadline=deadline) == saved
        assert len(payload) == MAX_BYTES and hashlib.sha256(payload).hexdigest() == config['payloadSha256'], 'Maximum private original must retain every exact byte'
        assert saved['applicationJob'] == config['job'] and saved['authorityVerification'] == 'unassessed'
        assert saved['engineTransportPermission'] is False, 'Maximum original cannot grant engine permission'
    return {'phase': phase, 'originalBytes': len(payload), 'payloadSha256': config['payloadSha256'],
        'engineTransportPermission': False, 'seconds': round(time.monotonic() - began, 3)}


def repeated(stream, pattern, count, digest=None):
    block = pattern * min(count, CHUNK // len(pattern))
    while count:
        take = min(count, len(block) // len(pattern));raw = block[:take * len(pattern)]
        stream.write(raw)
        if digest is not None:digest.update(raw)
        count -= take


def intended_failure(code, diagnostic, reason):
    errors = re.findall(r'^([A-Za-z_][\w.]*Error:.*)$', diagnostic, re.MULTILINE)
    return code == 1 and errors == ['AssertionError: ' + reason]


def failure_controls():
    reason = 'Maximum original changed';diagnostic = 'Traceback (most recent call last):\nAssertionError: ' + reason + '\n'
    rows = []
    for label, text in [('baseline', diagnostic), ('harmless', diagnostic + '# Harmless oracle comment.\n'), ('restored', diagnostic)]:
        assert intended_failure(1, text, reason)
        rows.append({'control': label, 'outcome': 'survived'})
    for label, code, text in [('zero-exit', 0, diagnostic), ('wrong-reason', 1, diagnostic.replace(reason, 'Unexpected reason')),
        ('extra-error', 1, diagnostic + 'ValueError: Unexpected secondary error\n'), ('missing-error', 1, 'Traceback only\n'),
        ('wrong-type', 1, diagnostic.replace('AssertionError:', 'ValueError:'))]:
        assert not intended_failure(code, text, reason), 'Capacity oracle accepted an unrelated failure'
        rows.append({'control': label, 'outcome': 'intended_refusal'})
    return rows


def run(out, unit):
    os.umask(0o077);out.mkdir(mode=0o700)
    (out / 'oracle-controls.json').write_text(json.dumps(failure_controls(), indent=2) + '\n')
    assert shutil.disk_usage(out).free > 5 * 1024**3
    assert RESPONSE_LIMIT == WIRE_LIMIT == 6 * MAX_BYTES + 1024 * 1024
    actor, workspace, mission, job = [str(uuid.uuid4()) for _ in range(4)]
    request = {'schemaVersion': 'natford-aerial-processing.v1', 'requestId': 'capacity-' + uuid.uuid4().hex,
        'callbackUrl': 'http://127.0.0.1:1/unused', 'missionTitle': 'Synthetic maximum étude',
        'externalRef': {'system': 'openplan', 'workspaceId': workspace, 'missionId': mission},
        'imagery': {'type': 'zip_url', 'url': 'http://127.0.0.1:1/unused.zip'}}
    row = {'id': job, 'request_id': request['requestId'], 'workspace_id': workspace, 'project_id': None,
        'mission_id': mission, 'created_by': actor, 'preset_id': 'balanced', 'imagery_type': 'zip_url'}
    base = (json.dumps(request, ensure_ascii=False) + '\n').encode()
    files = {};hashes = {}
    for label, size in [('maximum', MAX_BYTES), ('overflow', MAX_BYTES + 1)]:
        count = size - len(base);digest = hashlib.sha256()
        original = out / (label + '-original-private.json')
        with original.open('wb') as stream:
            repeated(stream, b'\t', count, digest);stream.write(base);digest.update(base);stream.flush();os.fsync(stream.fileno())
        hashes[label] = digest.hexdigest()
        receipt = {'format': FORMAT, 'installationId': 'capacity-owned-installation', 'targetId': 'capacity-owned-target',
            'applicationJob': row, 'payloadBytes': size, 'payloadSha256': digest.hexdigest(), 'authorizedNow': True,
            'authorityObservedAt': '2026-10-12T00:00:00+00:00', 'engineTransportPermission': False}
        path = out / (label + '-receipt-private.json')
        with path.open('wb') as stream:
            stream.write(json.dumps(receipt, separators=(',', ':')).encode()[:-1] + b',"payloadText":"')
            repeated(stream, b'\\t', count);stream.write(json.dumps(base.decode(), ensure_ascii=False).encode()[1:-1] + b'"}')
            stream.flush();os.fsync(stream.fileno())
        files[label] = path
    wire = out / 'maximum-wire-private.json';shutil.copyfile(files['maximum'], wire)
    with wire.open('ab') as stream:repeated(stream, b' ', WIRE_LIMIT - wire.stat().st_size);stream.flush();os.fsync(stream.fileno())
    extra = out / 'overflow-wire-private.json';shutil.copyfile(wire, extra)
    with extra.open('ab') as stream:stream.write(b' ');stream.flush();os.fsync(stream.fileno())
    profile = {};requests = [];closed = threading.Event()
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def log_message(self, *args):pass
        def do_POST(self):
            self.close_connection = True
            selected = dict(profile)
            arguments = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            assert arguments == {'p_request': request['requestId'], 'p_installation': 'capacity-owned-installation', 'p_target': 'capacity-owned-target'}
            requests.append(self.path)
            self.send_response(200);self.send_header('Content-Type', 'application/json');self.send_header('Connection', 'close')
            if selected['declared']:self.send_header('Content-Length', str(selected['path'].stat().st_size))
            self.end_headers()
            try:
                with selected['path'].open('rb') as stream:
                    while raw := stream.read(CHUNK):
                        self.wfile.write(raw);self.wfile.flush()
                        if selected['cancel']:
                            Path(selected['cancel']).touch();self.connection.settimeout(3)
                            if not self.connection.recv(1):closed.set()
                            break
            except (BrokenPipeError, ConnectionResetError):closed.set()
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler);server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
    original_reader = READER.read_bytes();original_http = HTTP.read_bytes();rows = []
    config = {'request': request, 'job': row, 'payloadSha256': hashes['maximum'],
        'endpoint': 'http://127.0.0.1:' + str(server.server_address[1]), 'cancelMarker': ''}
    def case(label, phase, parent, path, *, declared=True, reason=None):
        before = len(requests);closed.clear()
        marker = parent / (label + '-cancel-marker')
        profile.update(path=path, declared=declared, cancel=str(marker) if phase == 'cancel' else None)
        config['cancelMarker'] = str(marker)
        private = parent / (label + '-configuration-private.json');private.write_text(json.dumps(config))
        root = parent / (label + '-runtime');result = parent / (label + '-result.json')
        process = subprocess.run([sys.executable, '-B', __file__, '--client', str(private), phase, str(root), str(result)],
            cwd=ROOT, capture_output=True, text=True, timeout=25, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        diagnostic = process.stdout + process.stderr;(parent / (label + '-private.log')).write_text(diagnostic)
        if reason:
            assert intended_failure(process.returncode, diagnostic, reason), 'Wrong capacity fault: ' + label
            value = {'outcome': 'intended_failure', 'reason': reason}
        else:
            assert process.returncode == 0 and result.exists(), 'Owned capacity case failed: ' + label
            value = {'outcome': 'survived', **json.loads(result.read_text())}
        assert len(requests) == before + 1, 'Capacity read must issue exactly one private request'
        if phase == 'cancel':assert closed.wait(3), 'Capacity cancellation must close its actual connection'
        rows.append({'control': label, 'wireBytes': path.stat().st_size, **value})
        (out / 'partial-controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        print(label + ': ' + value['outcome'], flush=True)
        return root
    try:
        for variant in ('baseline', 'harmless', 'restored'):
            READER.write_bytes(original_reader + (b'\n# Harmless maximum original comment.\n' if variant == 'harmless' else b''))
            parent = out / variant;parent.mkdir(mode=0o700)
            root = case(variant + '-original', 'maximum-original', parent, files['maximum'])
            case(variant + '-wire', 'maximum-wire', parent, wire)
            relocated = parent / 'relocated-runtime';shutil.copytree(root, relocated)
            private = parent / 'recovery-configuration-private.json';private.write_text(json.dumps(config))
            result = parent / 'recovery-result.json'
            before = len(requests)
            recovery = subprocess.run([sys.executable, '-B', __file__, '--client', str(private), 'recover', str(relocated), str(result)],
                cwd=ROOT, capture_output=True, text=True, timeout=25, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
            (parent / 'recovery-private.log').write_text(recovery.stdout + recovery.stderr)
            assert recovery.returncode == 0 and len(requests) == before, 'Maximum saved original must relocate without another query'
            rows.append({'control': variant + '-relocated', 'outcome': 'survived', **json.loads(result.read_text())})
        parent = out / 'refusals';parent.mkdir(mode=0o700)
        for phase, path, declared in [('original-overflow', files['overflow'], True), ('declared-overflow', extra, True), ('actual-overflow', extra, False), ('cancel', wire, True)]:
            case(phase, phase, parent, path, declared=declared)
        anchor = "return receipt['payloadText'].encode('utf-8'), receipt['applicationJob']"
        assert original_reader.decode().count(anchor) == 1, 'Capacity fault requires its unique original capture anchor'
        READER.write_text(original_reader.decode().replace(anchor, "return receipt['payloadText'].strip().encode('utf-8'), receipt['applicationJob']"))
        parent = out / 'broken';parent.mkdir(mode=0o700)
        case('maximum-original-stripped', 'maximum-original', parent, files['maximum'], reason='Maximum private original must retain every exact byte')
        READER.write_bytes(original_reader)
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        bindings = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (READER, HTTP,
            ROOT / 'workers/odm_worker/runtime_dispatch_custody.py', ROOT / 'workers/odm_worker/retained_source.py', Path(__file__))}
        (out / 'source-bindings.json').write_text(json.dumps(bindings, indent=2) + '\n')
        properties = dict(line.split('=', 1) for line in subprocess.check_output(['systemctl', '--user', 'show', unit, '-p', 'ControlGroup', '-p', 'MemoryMax', '-p', 'MemoryPeak', '-p', 'MemorySwapMax'], text=True).splitlines())
        group = Path('/sys/fs/cgroup') / properties.pop('ControlGroup').lstrip('/')
        properties['memoryEvents'] = dict(line.split() for line in (group / 'memory.events').read_text().splitlines())
        (out / 'resources.json').write_text(json.dumps(properties, indent=2) + '\n')
    finally:
        READER.write_bytes(original_reader);HTTP.write_bytes(original_http)
        for path in (READER, HTTP):
            with path.open('rb') as stream:os.fsync(stream.fileno())
        server.shutdown();server.server_close();thread.join(timeout=5)
        assert not thread.is_alive(), 'Owned capacity fixture must stop'


if __name__ == '__main__':
    if len(sys.argv) == 6 and sys.argv[1] == '--client':
        os.umask(0o077);value = client(json.loads(Path(sys.argv[2]).read_text()), sys.argv[3], Path(sys.argv[4]))
        value['clientResidentPeakBytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
        value['childResidentPeakBytes'] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * 1024
        Path(sys.argv[5]).write_text(json.dumps(value, indent=2) + '\n')
    else:
        parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--out', type=Path, required=True);parser.add_argument('--unit', required=True)
        args = parser.parse_args();run(args.out.resolve(), args.unit)
