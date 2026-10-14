"""Reproduce ODM admission loss with unchanged HTTP/queue/intake and no engine."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

from oracle import controls, verify


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    started = time.monotonic()
    sys.path.insert(0, str(repo / 'docs/reviews/2026-10-11-ocr-worker-recovery'))
    import native_recovery as helpers
    root = helpers.load('odm_native_independent_root', repo / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    operator = repo / 'openplan/scripts/ops/worker_root_snapshot.py'
    deps = [Path(__file__), Path(__file__).with_name('oracle.py'), Path(helpers.__file__),
            repo / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py', operator,
            operator.with_name('worker_journal_snapshot.py')]
    deps += sorted((repo / 'workers/odm_worker').glob('*.py'))
    binding = {str(path): helpers.digest(path) for path in deps}
    helpers.write(out / 'pre-execution-source-private.json', binding)
    archive = out / 'executed-source-private'
    archive.mkdir(mode=0o700)
    for index, path in enumerate(deps):
        helpers.write(archive / f'{index}-{path.name}', path.read_bytes())
    worker_token, callback_token = 'synthetic-odm-worker-only', 'synthetic-odm-callback-only'
    lock, release = threading.Lock(), threading.Event()
    counters = {'sourceGets': 0, 'sourceBodyBytesSent': 0, 'engineRequests': 0, 'callbacks': []}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass
        def empty(self, code):
            self.send_response(code)
            self.send_header('Content-Length', '0')
            self.end_headers()
        def do_GET(self):
            if self.path == '/held-imagery.zip':
                with lock:
                    counters['sourceGets'] += 1
                release.wait(timeout=45)
                try:
                    self.empty(503)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                with lock:
                    counters['engineRequests'] += 1
                self.empty(418)
        def do_POST(self):
            data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            if self.path == '/callback' and self.headers.get('Authorization') == f'Bearer {callback_token}':
                with lock:
                    counters['callbacks'].append(json.loads(data))
                self.empty(200)
            else:
                with lock:
                    counters['engineRequests'] += 1
                self.empty(418)

    wrapper = out / 'worker-wrapper.py'
    helpers.write(wrapper, ('import json,os,sys\nfrom pathlib import Path\nos.umask(0o077)\n'
                           'sys.path.insert(0,sys.argv[1])\nimport main\noriginal=main.build_server\n'
                           'def local_server(*args,**kwargs):\n'
                           f'    server=original(host={helpers.HOST!r},port=0)\n'
                           '    with Path(sys.argv[2]).open("x") as stream:\n'
                           '        json.dump({"port":server.server_address[1],"pid":os.getpid()},stream)\n'
                           '        stream.flush()\n        os.fsync(stream.fileno())\n'
                           '    return server\nmain.build_server=local_server\nmain.main()\n').encode())
    server = ThreadingHTTPServer((helpers.HOST, 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.05), daemon=True)
    thread.start()
    endpoint = f'http://{helpers.HOST}:{server.server_address[1]}'
    helpers.write(out / 'fixture-listener-private.json', {'host': helpers.HOST, 'port': server.server_address[1], 'pid': os.getpid()})
    env = os.environ.copy()
    for name in list(env):
        if name.startswith(('OPENPLAN_', 'ODM_WORKER_', 'NODEODM_')) or name.lower() in {'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'}:
            del env[name]
    env.update(OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN=worker_token,
               OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN=callback_token,
               NODEODM_URL=endpoint+'/nodeodm-refusal', ODM_WORKER_PUBLIC_URL=endpoint,
               ODM_WORKER_MAX_QUEUED='1', ODM_WORKER_MAX_SOURCE_BYTES='1048576',
               ODM_WORKER_SWEEP_INTERVAL_SECONDS='600', NO_PROXY='*', no_proxy='*',
               PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1')
    children, streams = [], []
    def start(name, work_dir):
        listener = out / f'{name}-listener-private.json'
        log = (out / f'{name}-worker-private.log').open('xb')
        streams.append(log)
        process = subprocess.Popen([sys.executable, '-B', str(wrapper), str(repo / 'workers/odm_worker'), str(listener)],
                                   cwd=out, env=dict(env, ODM_WORKER_WORK_DIR=str(work_dir)),
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        children.append(process)
        helpers.wait_for(listener.exists, process)
        return process, json.loads(listener.read_text())['port']
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def post(port, body):
        request = urllib.request.Request(f'http://{helpers.HOST}:{port}/api/v1/processing-requests', data=body,
                                         headers={'Authorization': f'Bearer {worker_token}', 'Content-Type': 'application/json'})
        with opener.open(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    def request(request_id):
        return {'schemaVersion': 'natford-aerial-processing.v1', 'requestId': request_id,
                'callbackUrl': endpoint+'/callback', 'externalRef': {'system': 'openplan', 'missionId': 'synthetic-mission', 'workspaceId': 'synthetic-workspace'},
                'missionTitle': 'Synthetic admission fixture. No imagery processing.',
                'imagery': {'type': 'zip_url', 'url': endpoint+'/held-imagery.zip'}, 'presetId': 'balanced'}
    source, package, runtime = out/'source-root-private', out/'immutable-package-private', out/'runtime-private'
    try:
        initial, port = start('initial', source)
        first_status, first_receipt = post(port, json.dumps(request('synthetic-held-request-0001')).encode())
        helpers.wait_for(lambda: counters['sourceGets'] == 1, initial)
        original_request = json.dumps(request('synthetic-queued-request-0002')).encode()
        queued_status, queued = post(port, original_request)
        replay_status, replay = post(port, original_request)
        changed = json.loads(original_request)
        changed['missionTitle'] = 'Changed metadata under original request identity'
        changed_status, changed_receipt = post(port, json.dumps(changed).encode())
        with lock:
            before_count = counters['sourceGets']
        helpers.stopped(initial)
        root_before = root.inventory(source)
        result = subprocess.run([sys.executable, '-B', str(operator), '--source', str(source), '--destination', str(package), '--writers-quiesced'],
                                check=True, capture_output=True, timeout=35)
        snapshot_summary = json.loads(result.stdout)
        subprocess.run([sys.executable, '-B', str(operator), '--destination', str(package), '--verify'], check=True, capture_output=True, timeout=35)
        retained = root.inventory(package/'root')
        package_before = root.inventory(package)
        shutil.copytree(package/'root', runtime, copy_function=shutil.copy2)
        replacement, port = start('replacement', runtime)
        restart_status, restarted = post(port, original_request)
        helpers.wait_for(lambda: counters['sourceGets'] == 2, replacement)
        helpers.stopped(replacement)
        with lock:
            final_counters = dict(counters)
        record = {'firstAdmissionStatus': first_status, 'firstReceipt': first_receipt,
                  'queuedAdmissionStatus': queued_status, 'queuedReceipt': queued,
                  'predeathReplayStatus': replay_status, 'predeathReceipt': replay,
                  'changedStatus': changed_status, 'changedReceipt': changed_receipt,
                  'sourceGetsBeforeDeath': before_count, 'restartAdmissionStatus': restart_status,
                  'restartReceipt': restarted, 'initialRequestHex': original_request.hex(), 'restartRequestHex': original_request.hex(),
                  'sourceGetsFinal': final_counters['sourceGets'], 'sourceBodyBytesSent': final_counters['sourceBodyBytesSent'],
                  'engineRequests': final_counters['engineRequests'], 'sqliteCopies': snapshot_summary['sqliteCopies'],
                  'sourceOrdinaryFiles': sum(row['kind']=='file' for row in root_before.values()),
                  'rootBefore': root_before, 'retainedRoot': retained, 'rootAfter': root.inventory(source),
                  'packageBefore': package_before, 'packageAfter': root.inventory(package),
                  'sourceHashesBefore': binding, 'sourceHashesAfter': {str(path): helpers.digest(path) for path in deps}}
        outcome = verify(record)
        outcomes = controls(record)
        helpers.write(out/'observations-private.json', record)
        helpers.write(out/'callbacks-private.json', final_counters['callbacks'])
        helpers.write(out/'controls.json', outcomes)
        result = dict(outcome, controls=len(outcomes), sourceBodyBytesSent=final_counters['sourceBodyBytesSent'],
                      nodeodmRequests=final_counters['engineRequests'], newJobReference=True,
                      originalRootAndPackageUnchanged=True, durationSeconds=round(time.monotonic()-started,3),
                      claimLimits=['admission_counterexample_only','no_imagery_or_engine_processing','no_scientific_accuracy',
                                   'no_artifact_recovery','no_live_openplan_callback_rls','no_browser_public_acceptance'])
        helpers.write(out/'result.json', result)
        print(json.dumps(result,sort_keys=True))
    finally:
        for child in children:
            helpers.stopped(child)
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        for stream in streams:
            stream.close()
        helpers.write(out/'cleanup-private.json', {'ownedChildren':[dict(pid=child.pid,exit=child.returncode) for child in children],
                                                  'listenerClosed':server.socket.fileno()==-1})


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    run(args.repo.resolve(),args.out.absolute())
