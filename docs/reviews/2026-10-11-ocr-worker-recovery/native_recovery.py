"""Run one owned native OCR text-layer job and recover its stopped root.

The consumer is a loopback fixture, not OpenPlan. Execute in a bounded service
with a fresh private output directory. Retain failures; stop only child handles
and listeners created here. No deployed configuration or worker source changes.
"""
import argparse
from contextlib import closing
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error

from recovery_oracle import verify
from verify_controls import run as controls

HOST = '127.74.9.10'
WORKER_TOKEN = 'synthetic-ocr-proof-worker-only'
CALLBACK_TOKEN = 'synthetic-ocr-proof-consumer-only'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def wait_for(callback, process=None, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = callback()
        if result:
            return result
        if process is not None and process.poll() is not None:
            raise RuntimeError('Owned worker exited before the observation')
        time.sleep(0.05)
    raise TimeoutError('Native observation deadline exceeded')


def stopped(process):
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def job(root):
    database = root / 'jobs.sqlite3'
    if not database.exists():
        return None
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=1)) as connection:
        rows = connection.execute('SELECT request_id,payload FROM jobs ORDER BY request_id').fetchall()
    if len(rows) != 1:
        raise ValueError('Synthetic root must contain exactly one job')
    return json.loads(rows[0][1])


def run(repo, out, fixture):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    started = time.monotonic()
    sys.path.insert(0, str(repo / 'openplan/scripts/ops'))
    root = load('ocr_independent_root', repo / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    operator = repo / 'openplan/scripts/ops/worker_root_snapshot.py'
    deps = [Path(__file__), Path(__file__).with_name('recovery_oracle.py'),
            Path(__file__).with_name('verify_controls.py'),
            Path(__file__).with_name('create_fixture.py'),
            repo / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py',
            operator, operator.with_name('worker_journal_snapshot.py')]
    deps += sorted((repo / 'workers/ocr_worker').glob('*.py'))
    binding = {str(path): digest(path) for path in deps}
    write(out / 'pre-execution-source-private.json', binding)
    archive = out / 'executed-source-private'
    archive.mkdir(mode=0o700)
    for index, path in enumerate(deps):
        write(archive / f'{index}-{path.name}', path.read_bytes())
    pdf = fixture.read_bytes()
    write(out / 'input.pdf', pdf)
    tools = {}
    for executable in ('pdfinfo', 'pdftotext', 'tesseract'):
        command = ['-v'] if executable != 'tesseract' else ['--version']
        result = subprocess.run([executable, *command], capture_output=True, timeout=10, check=True)
        tools[executable] = {'path': shutil.which(executable),
                             'version': (result.stderr or result.stdout).decode().splitlines()[0]}
    write(out / 'native-tools-private.json', dict(tools, python=sys.version, ocrmypdf=shutil.which('ocrmypdf')))
    ordinary_names = lambda records: {name: value for name, value in records.items()
                                     if name not in {'jobs.sqlite3', 'jobs.sqlite3-wal', 'jobs.sqlite3-shm'}}

    def image(path):
        return {'ordinary': ordinary_names(root.inventory(path)),
                'sqlite': root.sqlite_image(path / 'jobs.sqlite3')}

    lock = threading.Lock()
    release_first = threading.Event()
    observed_first = threading.Event()
    state = {'phase': 'first', 'sourceEnabled': True, 'sourceGets': 0,
             'deniedSourceGets': 0, 'deliveries': [], 'logical': {}, 'errors': []}
    callback_dir = out / 'callbacks-private'
    callback_dir.mkdir(mode=0o700)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def respond(self, status):
            self.send_response(status)
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_GET(self):
            if self.path != '/source.pdf':
                self.respond(404)
                return
            with lock:
                enabled = state['sourceEnabled']
                state['sourceGets' if enabled else 'deniedSourceGets'] += 1
            if not enabled:
                self.respond(410)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Length', str(len(pdf)))
            self.end_headers()
            self.wfile.write(pdf)

        def do_POST(self):
            if self.path != '/callback' or self.headers.get('Authorization') != f'Bearer {CALLBACK_TOKEN}':
                with lock:
                    state['errors'].append('callback-auth-or-path')
                self.respond(403)
                return
            data = self.rfile.read(int(self.headers['Content-Length']))
            payload = json.loads(data)
            terminal = payload['status'] in {'succeeded', 'failed', 'canceled'}
            with lock:
                phase = state['phase']
                index = len(list(callback_dir.iterdir()))
                write(callback_dir / f'{index:03d}-{phase}.json', data)
                if terminal:
                    callback_id = payload['callbackId']
                    body_hash = hashlib.sha256(data).hexdigest()
                    prior = state['logical'].get(callback_id)
                    if prior is not None and prior != body_hash:
                        state['errors'].append('changed-payload-for-callback-id')
                        self.respond(409)
                        return
                    state['logical'][callback_id] = body_hash
                    state['deliveries'].append({'phase': phase, 'hex': data.hex()})
                    write(callback_dir / f'{index:03d}-{phase}-consumer-receipt.json',
                          {'callbackId': callback_id, 'bodySha256': body_hash,
                           'logicalResults': len(state['logical']), 'phase': phase})
            if terminal and phase == 'first':
                observed_first.set()
                release_first.wait(timeout=60)
            try:
                self.respond(200)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer((HOST, 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.05), daemon=True)
    thread.start()
    endpoint = f'http://{HOST}:{server.server_address[1]}'
    write(out / 'consumer-listener-private.json', {'host': HOST, 'port': server.server_address[1], 'pid': os.getpid()})
    wrapper = out / 'worker-wrapper.py'
    write(wrapper, (
        'import json,os,sys\nfrom pathlib import Path\nos.umask(0o077)\n'
        'sys.path.insert(0,sys.argv[1])\nimport main\noriginal=main.build_server\n'
        'def local_server(*args,**kwargs):\n'
        f'    server=original(host={HOST!r},port=0)\n'
        '    path=Path(sys.argv[2])\n'
        '    with path.open("x") as stream:\n'
        '        json.dump({"port":server.server_address[1],"pid":os.getpid()},stream)\n'
        '        stream.flush()\n        os.fsync(stream.fileno())\n'
        '    return server\nmain.build_server=local_server\nmain.main()\n').encode())
    probes = out / 'refusal-bin'
    probes.mkdir(mode=0o700)
    marker = out / 'extraction-refusal-private.jsonl'
    for name in ('pdfinfo', 'pdftotext'):
        probe = probes / name
        write(probe, (f'#!{sys.executable}\nimport json,os,sys\n'
                      f'with open({str(marker)!r},"a") as stream:\n'
                      '    stream.write(json.dumps({"command":os.path.basename(sys.argv[0]),"args":sys.argv[1:]})+"\\n")\n'
                      '    stream.flush()\n    os.fsync(stream.fileno())\nsys.exit(87)\n').encode())
        probe.chmod(0o700)
    environment = os.environ.copy()
    for name in list(environment):
        if name.startswith(('OPENPLAN_', 'OCR_WORKER_')) or name.lower() in {'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'}:
            del environment[name]
    environment.update(OPENPLAN_KB_OCR_WORKER_TOKEN=WORKER_TOKEN,
                       OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN=CALLBACK_TOKEN,
                       OPENPLAN_KB_EXTRACTION_DISPATCH_URL='', NO_PROXY='*', no_proxy='*',
                       OCR_WORKER_MAX_QUEUED='1', OCR_WORKER_MAX_SOURCE_BYTES='1048576',
                       OCR_WORKER_MAX_PAGES='3', OCR_WORKER_TIMEOUT_SECONDS='30',
                       OCR_WORKER_JOBS='1', PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1')
    processes, streams = [], []

    def start_worker(name, working_root, refusal):
        listener = out / f'{name}-listener-private.json'
        log = (out / f'{name}-worker-private.log').open('xb')
        streams.append(log)
        env = dict(environment, OCR_WORKER_WORK_DIR=str(working_root))
        if refusal:
            env['PATH'] = str(probes) + os.pathsep + env['PATH']
        process = subprocess.Popen([sys.executable, '-B', str(wrapper), str(repo / 'workers/ocr_worker'), str(listener)],
                                   cwd=out, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        processes.append(process)
        wait_for(listener.exists, process)
        return process, json.loads(listener.read_text())['port']

    source_root = out / 'source-root-private'
    package = out / 'immutable-package-private'
    runtime = out / 'runtime-root-private'
    try:
        first_process, port = start_worker('first', source_root, False)
        request = {'schemaVersion': 'openplan-ocr-extraction.v1',
                   'requestId': '11111111-1111-4111-8111-111111111111',
                   'callbackUrl': endpoint + '/callback',
                   'externalRef': {'system': 'openplan', 'documentId': '22222222-2222-4222-8222-222222222222',
                                   'workspaceId': '33333333-3333-4333-8333-333333333333'},
                   'documentTitle': 'Synthetic recovery fixture',
                   'source': {'url': endpoint + '/source.pdf', 'filename': 'synthetic.pdf',
                              'sizeBytes': len(pdf), 'checksumSha256': hashlib.sha256(pdf).hexdigest()},
                   'languages': ['eng'], 'mode': 'text', 'maxPages': 3, 'maxCallbackBytes': 65536}
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        submission = urllib.request.Request(f'http://{HOST}:{port}/api/v1/ocr-requests',
                                             data=json.dumps(request).encode(),
                                             headers={'Authorization': f'Bearer {WORKER_TOKEN}', 'Content-Type': 'application/json'})
        with opener.open(submission, timeout=10) as response:
            admission_status, accepted = response.status, json.loads(response.read())
        wait_for(observed_first.is_set, first_process)
        before_job = job(source_root)
        stopped(first_process)
        release_first.set()
        source_before = image(source_root)
        subprocess.run([sys.executable, '-B', str(operator), '--source', str(source_root),
                        '--destination', str(package), '--writers-quiesced', '--timeout', '30'],
                       check=True, capture_output=True, timeout=35)
        subprocess.run([sys.executable, '-B', str(operator), '--destination', str(package), '--verify'],
                       check=True, capture_output=True, timeout=35)
        retained = image(package / 'root')
        package_before = root.inventory(package)
        shutil.copytree(package / 'root', runtime, copy_function=shutil.copy2)
        ordinary_before = ordinary_names(root.inventory(runtime))
        with lock:
            state.update(phase='recovery', sourceEnabled=False)
        replacement, replacement_port = start_worker('replacement', runtime, True)
        wait_for(lambda: (value if (value := job(runtime))['state'] == 'succeeded' else None), replacement)
        replay_request = urllib.request.Request(f'http://{HOST}:{replacement_port}/api/v1/ocr-requests',
                                               data=json.dumps(request).encode(),
                                               headers={'Authorization': f'Bearer {WORKER_TOKEN}', 'Content-Type': 'application/json'})
        with opener.open(replay_request, timeout=10) as response:
            replay_status, replay_accepted = response.status, json.loads(response.read())
        changed_request = urllib.request.Request(replay_request.full_url,
                                                data=json.dumps(dict(request, documentTitle='changed')).encode(),
                                                headers={'Authorization': f'Bearer {WORKER_TOKEN}', 'Content-Type': 'application/json'})
        try:
            with opener.open(changed_request, timeout=10) as response:
                changed_status = response.status
        except urllib.error.HTTPError as error:
            changed_status = error.code
            error.close()
        stopped(replacement)
        after_job = job(runtime)
        with lock:
            deliveries = list(state['deliveries'])
            consumer_counts = {key: state[key] for key in ('sourceGets', 'deniedSourceGets')}
            logical_count = len(state['logical'])
            consumer_errors = list(state['errors'])
        record = dict(request=request, admissionStatus=admission_status, accepted=accepted,
                      replayStatus=replay_status, replayAccepted=replay_accepted,
                      changedRequestStatus=changed_status, consumerErrors=consumer_errors,
                      beforeJob=before_job, afterJob=after_job,
                      firstCallbackHex=deliveries[0]['hex'], secondCallbackHex=deliveries[1]['hex'],
                      terminalDeliveries=len(deliveries), logicalResults=logical_count, **consumer_counts,
                      extractionProbes=marker.read_text().splitlines() if marker.exists() else [],
                      sourceRootBefore=source_before, retainedRoot=retained,
                      sourceRootAfter=image(source_root), packageBefore=package_before,
                      packageAfter=root.inventory(package), runtimeOrdinaryBefore=ordinary_before,
                      runtimeOrdinaryAfter=ordinary_names(root.inventory(runtime)),
                      sourceHashesBefore=binding, sourceHashesAfter={str(path): digest(path) for path in deps})
        verify(record)
        write(out / 'observations-private.json', record)
        observation_controls = controls(record)
        write(out / 'observation-controls.json', observation_controls)

        # Remove only the saved result in a disposable runtime. The real worker
        # must attempt recognition, hit pdfinfo's refusal and report failure.
        broken = out / 'broken-runtime-private'
        shutil.copytree(package / 'root', broken, copy_function=shutil.copy2)
        original_database = (broken / 'jobs.sqlite3').read_bytes()
        try:
            with closing(sqlite3.connect(broken / 'jobs.sqlite3')) as connection, connection:
                bad_job = job(broken)
                bad_job.pop('result')
                connection.execute('UPDATE jobs SET payload=? WHERE request_id=?',
                                   (json.dumps(bad_job), request['requestId']))
            with lock:
                state['phase'] = 'broken'
            bad_process, _port = start_worker('broken', broken, True)
            wait_for(lambda: (value if (value := job(broken))['state'] == 'failed' else None), bad_process)
            stopped(bad_process)
            bad_observation = dict(record, afterJob=job(broken))
            try:
                verify(bad_observation)
            except ValueError as error:
                if str(error) != 'recovered-terminal-state':
                    raise
            else:
                raise AssertionError('Missing saved result passed native recovery oracle')
            if not marker.exists() or 'pdfinfo' not in marker.read_text():
                raise AssertionError('Extraction refusal did not observe native reentry')
            write(out / 'native-broken-result-private.json',
                  {'outcome': 'intended_refusal', 'oracle': 'recovered-terminal-state',
                   'job': job(broken), 'probes': marker.read_text().splitlines()})
        finally:
            for process in processes:
                stopped(process)
            # Restore the disposable mutation bytes, keeping failure receipts.
            for suffix in ('-wal', '-shm', '-journal'):
                (broken / ('jobs.sqlite3' + suffix)).unlink(missing_ok=True)
            with (broken / 'jobs.sqlite3').open('wb') as stream:
                stream.write(original_database)
                stream.flush()
                os.fsync(stream.fileno())
        verify(record)
        root.equal_root(package_before, root.inventory(package))
        root.equal_journal(source_before['sqlite'], root.sqlite_image(source_root / 'jobs.sqlite3'))
        write(out / 'result.json', {'verified': True, 'nativeMode': 'text', 'pages': 3,
                                  'blankMiddlePage': True, 'terminalDeliveries': len(deliveries),
                                  'logicalResults': logical_count, 'sourceDownloads': consumer_counts['sourceGets'],
                                  'recoveryExtractionReentry': False, 'controls': len(observation_controls),
                                  'nativeBrokenSavedResult': 'intended_refusal',
                                  'completedAdmissionReplay': replay_status,
                                  'changedRequestRefusal': changed_status,
                                  'durationSeconds': round(time.monotonic() - started, 3),
                                  'claimLimits': ['synthetic_loopback_consumer', 'no_scanned_ocr_accuracy',
                                                  'no_openplan_callback_or_rls', 'no_installation_wide_cut',
                                                  'no_long_job', 'no_hardware_loss', 'no_browser', 'no_public_readiness']})
        print(json.dumps(json.loads((out / 'result.json').read_text()), sort_keys=True))
    finally:
        for process in processes:
            stopped(process)
        release_first.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        for stream in streams:
            stream.close()
        write(out / 'cleanup-private.json', {'ownedChildren': [dict(pid=process.pid, exit=process.returncode)
                                                             for process in processes],
                                            'listenerClosed': server.socket.fileno() == -1})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--fixture', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.absolute(), args.fixture.resolve())
