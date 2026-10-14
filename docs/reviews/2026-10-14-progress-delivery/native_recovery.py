"""Interrupt a real callback POST, then recover the saved command in a new process.

Both HTTP endpoints are local fixtures. This proves process/file/HTTP recovery,
not hosted RPC authorization or the application's callback implementation.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urlsplit
import uuid


def child(repo, out, mode):
    sys.path.insert(0, str(repo/'workers/odm_worker'))
    from runtime_admission import Runtime
    from runtime_dispatch_custody import Custody
    from application_dispatch_reader import Reader
    from runtime_progress_delivery import Delivery
    from progress_http import Transport
    config = json.loads((out/'fixture-private.json').read_text())
    request = config['request']
    runtime = Runtime(out/'runtime', 'native-synthetic-installation', max_queued=2,
        pipeline=lambda _: None, timeout=10)
    def rpc(arguments, deadline, *, owned):
        assert owned(), 'Native private read keeps ownership'
        req = urllib.request.Request(config['rpcUrl'], data=json.dumps(arguments).encode(),
            headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=max(0.01, deadline-time.monotonic())) as response:
            return response.read(512*1024)
    custody = Custody(runtime, 'native-synthetic-target', timeout=10)
    reader = Reader(custody, rpc, timeout=10)
    http = Transport(request['callbackUrl'], 'synthetic-callback-key', lambda _: 'synthetic-only',
        allowed_networks=('127.0.0.1/32',), allowed_ports=(urlsplit(request['callbackUrl']).port,))
    def post(url, credential, body, deadline, *, owned):
        assert owned() and credential == 'synthetic-callback-key', 'Native transport keeps original ownership and credential reference'
        result = http(url, credential, body, deadline, owned=owned)
        if mode == 'interrupt':
            os._exit(44)
        return result
    delivery = Delivery(reader, post, 'synthetic-callback-key', timeout=10)
    with runtime.owner():
        if mode == 'interrupt':
            runtime.submit(request)
            entry = runtime.journal.get(request['requestId'])
            runtime.journal.start(request['requestId'], entry.job_reference, runtime.context)
            entry = runtime.journal.get(request['requestId'])
            raw, row = reader.capture(entry)
            custody.save(request['requestId'], raw, row)
            body = {'schemaVersion': request['schemaVersion'], 'requestId': request['requestId'],
                'jobReference': entry.job_reference, 'callbackId': 'native-callback-0001',
                'occurredAt': '2026-10-14T00:00:00.123456789Z', 'status': 'running',
                'progress': 37, 'message': 'Native retained étude'}
            delivery.prepare(request['requestId'], 'original-progress',
                (json.dumps(body, ensure_ascii=False, indent=2)+'\n').encode())
        try:
            result = delivery.advance(request['requestId'], 'original-progress')
        except PermissionError:
            if mode != 'revoked':
                raise
            print('Current application access refused')
            return 45
        assert mode != 'revoked', 'Native revoked actor cannot receive an acknowledgement'
        assert result['state'] == 'acknowledged', 'Native receiver acknowledgement survives recovery'
        assert result['publicationPermission'] is False, 'Native delivery grants no publication'
        print(json.dumps({'state': result['state'], 'attempt': result['attempt']}))
    return 0


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    (out/'runtime').mkdir(mode=0o700)
    actor, workspace, mission, job = [str(uuid.uuid4()) for _ in range(4)]
    state = {'authorized': True, 'dispatchReads': 0, 'posts': [], 'ledger': {}}
    config = {}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_POST(self):
            raw = self.rfile.read(int(self.headers['Content-Length']))
            if self.path == '/dispatch':
                args = json.loads(raw)
                assert args == {'p_request': config['request']['requestId'],
                    'p_installation': 'native-synthetic-installation', 'p_target': 'native-synthetic-target'}
                state['dispatchReads'] += 1
                text = config['payloadText']; data = text.encode()
                value = {'format': 'openplan.odm-application-dispatch.v1',
                    'installationId': 'native-synthetic-installation', 'targetId': 'native-synthetic-target',
                    'applicationJob': config['row'], 'payloadText': text,
                    'payloadBytes': len(data), 'payloadSha256': hashlib.sha256(data).hexdigest(),
                    'authorizedNow': state['authorized'], 'authorityObservedAt': '2026-10-14T00:00:00Z',
                    'engineTransportPermission': False}
            else:
                assert self.path == '/callback' and self.headers['Authorization'] == 'Bearer synthetic-only'
                state['posts'].append(raw)
                value = json.loads(raw); key = value['callbackId']
                if key in state['ledger']:
                    assert state['ledger'][key] == raw, 'Native retry carries the exact original body'
                else:
                    state['ledger'][key] = raw
                value = {'ok': True, 'replayed': len(state['posts']) > 1, 'status': 'running'}
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    request = {'schemaVersion': 'natford-aerial-processing.v1', 'requestId': 'native-progress-request',
        'callbackUrl': base+'/callback', 'missionTitle': 'Native original mission',
        'externalRef': {'system': 'openplan', 'workspaceId': workspace, 'missionId': mission},
        'imagery': {'type': 'zip_url', 'url': 'https://example.invalid/original.zip'}}
    config.update(request=request, rpcUrl=base+'/dispatch',
        payloadText=json.dumps(request, ensure_ascii=False, indent=2)+'\n',
        row={'id': job, 'request_id': request['requestId'], 'workspace_id': workspace,
            'mission_id': mission, 'project_id': None, 'created_by': actor,
            'preset_id': 'balanced', 'imagery_type': 'zip_url'})
    (out/'fixture-private.json').write_text(json.dumps(config))
    def execute(mode, expected):
        result = subprocess.run([sys.executable, '-B', str(Path(__file__).resolve()),
            '--repo', str(repo), '--out', str(out), '--child', mode],
            capture_output=True, text=True, timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        (out/(mode+'-private.log')).write_text(result.stdout+result.stderr)
        assert result.returncode == expected, 'Native '+mode+' has the expected process outcome'
    try:
        execute('interrupt', 44)
        assert len(state['posts']) == 1 and len(state['ledger']) == 1, 'Remote fixture receives original callback before interruption'
        pack = next((out/'runtime').glob('progress-delivery-*'))
        command = json.loads((pack/'command.json').read_bytes())
        assert (pack/'attempt-000000.json').exists() and not (pack/'reply-000000.json').exists(), 'Native interruption leaves intent without a response receipt'
        assert command['bodyText'].encode() == state['posts'][0], 'Native saved command is exactly the received body'
        execute('recover', 0)
        assert len(state['posts']) == 2 and len(state['ledger']) == 1, 'Exact replay has one remote fixture effect'
        assert state['posts'][0] == state['posts'][1], 'Replacement process preserves original callback bytes'
        original_files = {p.name: p.read_bytes() for p in pack.iterdir()}
        execute('replay', 0)
        assert len(state['posts']) == 2, 'Native acknowledged replay makes no POST'
        assert {p.name: p.read_bytes() for p in pack.iterdir()} == original_files, 'Native acknowledged replay preserves every original record'
        state['authorized'] = False
        execute('revoked', 45)
        assert len(state['posts']) == 2, 'Native current access refusal prevents another POST'
        report = {'processInterruption': 44, 'replacementProcess': True,
            'httpPosts': len(state['posts']), 'remoteFixtureEffects': len(state['ledger']),
            'dispatchReads': state['dispatchReads'], 'bodySha256': command['bodySha256'],
            'bodyBytes': command['bodyBytes'], 'revokedProcess': 45,
            'limits': ['local synthetic HTTP authorization and receiver fixtures',
                'loopback supervised POST only; not live RLS, hosted callback, public DNS/TLS or default-worker acceptance']}
        group = Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::', 1)[1].strip().lstrip('/')
        (out/'resources.json').write_text(json.dumps({key: (group/key).read_text().strip() for key in ['memory.max', 'memory.peak', 'memory.swap.max', 'memory.swap.peak', 'memory.events']}, indent=2)+'\n')
        (out/'native.json').write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps(report), flush=True)
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--child', choices=['interrupt', 'recover', 'replay', 'revoked'])
    args = parser.parse_args()
    if args.child:
        sys.exit(child(args.repo.resolve(), args.out.resolve(), args.child))
    run(args.repo.resolve(), args.out.resolve())
