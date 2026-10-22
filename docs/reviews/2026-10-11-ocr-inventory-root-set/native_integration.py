"""Continue a retained OCR result through explicit configuration/root-set custody."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


def eligible_endpoint(url, host):
    endpoint = urllib.parse.urlsplit(url)
    try:
        port = endpoint.port
    except ValueError:
        port = None
    if endpoint.hostname != host or endpoint.scheme != 'http' or endpoint.path != '/callback' or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError('Only the retained owned loopback fixture is eligible')
    return endpoint


def exact_configuration(config, profile, packet):
    if config.read_bytes() != (packet / 'configuration/ocr-fixture-env').read_bytes() or profile.read_bytes() != (packet / 'profile.json').read_bytes():
        raise ValueError('Retained fixture configuration or profile differs')


def run(repo, prior, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    started = time.monotonic()
    sys.path.insert(0, str(repo / 'docs/reviews/2026-10-11-ocr-worker-recovery'))
    sys.path.insert(0, str(repo / 'openplan/scripts/ops'))
    import native_recovery as native
    import installation_worker_inventory as installed
    from recovery_oracle import verify
    from verify_controls import run as observation_controls
    root = native.load('ocr_set_independent_root', repo / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    original = prior / 'source-root-private'
    original_package = prior / 'immutable-package-private'
    source_job = native.job(original)
    previous = json.loads((prior / 'observations-private.json').read_text())
    verify(previous)
    endpoint = eligible_endpoint(source_job['request']['callbackUrl'], native.HOST)
    policy_controls = []
    for name, url in [('baseline', source_job['request']['callbackUrl']),
                      ('harmless-fragment', source_job['request']['callbackUrl'] + '#synthetic')]:
        eligible_endpoint(url, native.HOST)
        policy_controls.append({'control': name, 'outcome': 'survived'})
    for name, url in [('foreign-host', 'http://example.com:123/callback'),
                      ('wrong-scheme', f'https://{native.HOST}:123/callback'),
                      ('wrong-path', f'http://{native.HOST}:123/other'),
                      ('missing-port', f'http://{native.HOST}/callback'),
                      ('zero-port', f'http://{native.HOST}:0/callback'),
                      ('oversized-port', f'http://{native.HOST}:65536/callback')]:
        try:
            eligible_endpoint(url, native.HOST)
        except ValueError as error:
            if str(error) != 'Only the retained owned loopback fixture is eligible':
                raise
            policy_controls.append({'control': name, 'outcome': 'intended_refusal'})
        else:
            raise AssertionError('Unsafe callback fixture survived')
    original_body = bytes.fromhex(previous['firstCallbackHex'])
    operator = repo / 'openplan/scripts/ops'
    deps = [Path(__file__), Path(native.__file__), Path(native.__file__).with_name('recovery_oracle.py'),
            Path(native.__file__).with_name('verify_controls.py'),
            repo / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py',
            *[operator / name for name in ('installation_worker_inventory.py', 'worker_root_set_snapshot.py',
                                           'worker_root_snapshot.py', 'worker_journal_snapshot.py')],
            repo / 'openplan/package.json', prior / 'worker-wrapper.py']
    deps += [repo / relative for relative, _ in installed.FAMILIES.values()]
    deps += [repo / relative for relative in installed.LAUNCHERS.values()]
    deps += sorted((repo / 'workers/ocr_worker').glob('*.py'))
    deps = list(dict.fromkeys(deps))
    source_hashes = {str(path): native.digest(path) for path in deps}
    native.write(out / 'pre-execution-source-private.json', source_hashes)
    archive = out / 'executed-source-private'
    archive.mkdir(mode=0o700)
    for index, path in enumerate(deps):
        native.write(archive / f'{index}-{path.name}', path.read_bytes())

    def command(script, arguments, expected=0, diagnostic=None):
        result = subprocess.run([sys.executable, '-B', str(operator / script), *arguments],
                                capture_output=True, timeout=40)
        if result.returncode != expected or (diagnostic and diagnostic.encode() not in result.stderr + result.stdout):
            raise RuntimeError(f'Unexpected operator outcome: {script} ({result.returncode})')
        return {'script': script, 'exit': result.returncode,
                'stdout': result.stdout.decode(), 'stderr': result.stderr.decode()}

    ordinary = lambda rows: {key: value for key, value in rows.items()
                            if key not in {'jobs.sqlite3', 'jobs.sqlite3-wal', 'jobs.sqlite3-shm'}}
    def image(path):
        return {'ordinary': ordinary(root.inventory(path)), 'sqlite': root.sqlite_image(path / 'jobs.sqlite3')}

    before = image(original)
    original_package_before = root.inventory(original_package)
    config = out / 'synthetic-original-worker.env'
    native.write(config, ('OPENPLAN_KB_OCR_WORKER_TOKEN=' + native.WORKER_TOKEN + '\n'
                         'OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN=' + native.CALLBACK_TOKEN + '\n'
                         'OPENPLAN_KB_EXTRACTION_DISPATCH_URL=\n'
                         'OCR_WORKER_WORK_DIR=' + str(original) + '\n'
                         'OCR_WORKER_MAX_QUEUED=1\nOCR_WORKER_MAX_SOURCE_BYTES=1048576\n'
                         'OCR_WORKER_MAX_PAGES=3\nOCR_WORKER_TIMEOUT_SECONDS=30\nOCR_WORKER_JOBS=1\n').encode())
    profile = {'format': installed.PROFILE_FORMAT, 'installationId': 'synthetic-ocr-fixture-only',
               'roots': [{'id': 'ocr-fixture', 'path': str(original)}],
               'configuration': [{'id': 'ocr-fixture-env', 'path': str(config)}],
               'workers': {name: {'state': 'unassessed', 'custody': 'unassessed', 'rootIds': [],
                                 'configurationIds': [], 'notes': 'No installation assessment. Synthetic fixture profile only.'}
                           for name in installed.FAMILIES}}
    profile['workers']['ocr'].update(state='configured', custody='local_roots',
                                     rootIds=['ocr-fixture'], configurationIds=['ocr-fixture-env'],
                                     notes='Retained native text-layer fixture, not hosted or installed OCR coverage.')
    profile_path = out / 'synthetic-profile-private.json'
    native.write(profile_path, profile)
    inventory_package, root_set = out / 'inventory-private', out / 'root-set-private'
    operators = [command('installation_worker_inventory.py', ['--profile', str(profile_path), '--destination', str(inventory_package), '--writers-quiesced']),
                 command('installation_worker_inventory.py', ['--verify', str(inventory_package)]),
                 command('worker_root_set_snapshot.py', ['--inventory', str(inventory_package / 'inventory.json'), '--destination', str(root_set), '--writers-quiesced']),
                 command('worker_root_set_snapshot.py', ['--destination', str(root_set), '--verify'])]
    exact_configuration(config, profile_path, inventory_package)
    inventory_before, set_before = root.inventory(inventory_package), root.inventory(root_set)
    retained = root_set / 'roots/ocr-fixture/root'
    root.equal_journal(before['sqlite'], root.sqlite_image(retained / 'jobs.sqlite3'))
    runtime = out / 'runtime-private'
    shutil.copytree(retained, runtime, copy_function=shutil.copy2)
    runtime_before = ordinary(root.inventory(runtime))

    # Controls use one disposable package. Restore every changed byte or entry
    # before the next case, and leave both original packages unchanged.
    disposable = out / 'controls-set-private'
    shutil.copytree(root_set, disposable, copy_function=shutil.copy2)
    disposable_inventory = out / 'controls-inventory-private'
    shutil.copytree(inventory_package, disposable_inventory, copy_function=shutil.copy2)
    exact_configuration(config, profile_path, disposable_inventory)
    controls = [dict(control='baseline-set', **command('worker_root_set_snapshot.py', ['--destination', str(disposable), '--verify'])),
                dict(control='harmless-inventory-copy', **command('installation_worker_inventory.py', ['--verify', str(disposable_inventory)]))]
    for name, path in [('changed-configuration', disposable_inventory / 'configuration/ocr-fixture-env'),
                       ('changed-profile', disposable_inventory / 'profile.json')]:
        payload = path.read_bytes()
        try:
            path.write_bytes(payload + b' ')
            try:
                exact_configuration(config, profile_path, disposable_inventory)
            except ValueError as error:
                if str(error) != 'Retained fixture configuration or profile differs':
                    raise
            else:
                raise AssertionError('Changed fixture configuration passed byte comparison')
            controls.append(dict(control=name, exactByteComparison='intended_refusal',
                                 **command('installation_worker_inventory.py', ['--verify', str(disposable_inventory)], 1, 'Worker inventory unavailable: ValueError')))
        finally:
            path.write_bytes(payload)
    exact_configuration(config, profile_path, disposable_inventory)
    controls.append(dict(control='restored-inventory', **command('installation_worker_inventory.py', ['--verify', str(disposable_inventory)])))
    manifest = disposable / 'snapshot.json'
    manifest_bytes = manifest.read_bytes()
    try:
        manifest.write_text(json.dumps(dict(reversed(list(json.loads(manifest_bytes).items())))))
        controls.append(dict(control='harmless-manifest-key-order', **command('worker_root_set_snapshot.py', ['--destination', str(disposable), '--verify'])))
    finally:
        manifest.write_bytes(manifest_bytes)
    selection = disposable / 'inventory.json'
    selection_bytes = selection.read_bytes()
    try:
        selection.unlink()
        controls.append(dict(control='missing-selection', **command('worker_root_set_snapshot.py', ['--destination', str(disposable), '--verify'], 1, 'Worker-root set refused')))
    finally:
        native.write(selection, selection_bytes)
    pdf = disposable / 'roots/ocr-fixture/root' / source_job['job_reference'] / 'source.pdf'
    pdf_bytes = pdf.read_bytes()
    try:
        pdf.write_bytes(bytes([pdf_bytes[0] ^ 1]) + pdf_bytes[1:])
        controls.append(dict(control='corrupt-retained-pdf', **command('worker_root_set_snapshot.py', ['--destination', str(disposable), '--verify'], 1, 'Worker-root set refused')))
    finally:
        pdf.write_bytes(pdf_bytes)
    controls.append(dict(control='restored-set', **command('worker_root_set_snapshot.py', ['--destination', str(disposable), '--verify'])))

    lock = threading.Lock()
    state = {'phase': 'control', 'nativeBodies': [], 'deniedSourceGets': 0, 'consumerErrors': [],
             'logical': {source_job['result']['callbackId']: hashlib.sha256(original_body).hexdigest()}}
    native.write(out / 'seeded-consumer-private.json', {'callbackId': source_job['result']['callbackId'],
                                                     'bodySha256': hashlib.sha256(original_body).hexdigest(),
                                                     'origin': 'prior-native-original-successful-callback'})
    ledger = out / 'consumer-ledger-private.json'
    native.write(ledger, state['logical'])
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass
        def respond(self, status):
            self.send_response(status)
            self.send_header('Content-Length', '0')
            self.end_headers()
        def do_GET(self):
            with lock:
                state['deniedSourceGets'] += 1
            self.respond(410)
        def do_POST(self):
            data = self.rfile.read(int(self.headers['Content-Length']))
            correct_auth = self.headers.get('Authorization') == f'Bearer {native.CALLBACK_TOKEN}'
            status = 403 if not correct_auth else 409 if data != original_body or self.path != '/callback' else 200
            with lock:
                if state['phase'] == 'native':
                    if status != 200:
                        state['consumerErrors'].append('callback-auth-or-exact-body')
                    else:
                        callback_id = json.loads(data)['callbackId']
                        state['logical'].setdefault(callback_id, hashlib.sha256(data).hexdigest())
                        # Publish the actual fixture ledger before acknowledgment.
                        partial = out / 'consumer-ledger-partial-private.json'
                        native.write(partial, state['logical'])
                        os.replace(partial, ledger)
                        descriptor = os.open(out, os.O_RDONLY | os.O_DIRECTORY)
                        try:
                            os.fsync(descriptor)
                        finally:
                            os.close(descriptor)
                        native.write(out / f'callback-{len(state["nativeBodies"])}-private.json', data)
                        state['nativeBodies'].append(data.hex())
            self.respond(status)

    # Bind the original owned address only. If another process now occupies it,
    # the constructor fails without a fallback, process kill or saved-URL edit.
    server = ThreadingHTTPServer((native.HOST, endpoint.port), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.05), daemon=True)
    thread.start()
    process, log = None, None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def post(url, data, token):
        request = urllib.request.Request(url, data=data, headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
        try:
            with opener.open(request, timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            try:
                return error.code, error.read()
            finally:
                error.close()
    try:
        consumer_controls = [('harmless-exact-replay', original_body, native.CALLBACK_TOKEN, 200),
                             ('changed-same-id-bytes', original_body + b' ', native.CALLBACK_TOKEN, 409),
                             ('wrong-bearer', original_body, 'synthetic-wrong', 403)]
        for name, data, token, expected in consumer_controls:
            status, _body = post(source_job['request']['callbackUrl'], data, token)
            if status != expected:
                raise ValueError('Fixture consumer control did not reach its intended outcome')
            controls.append({'control': name, 'status': status})
        probes = out / 'refusal-bin'
        probes.mkdir(mode=0o700)
        marker = out / 'extraction-refusal-private.jsonl'
        for name in ('pdfinfo', 'pdftotext'):
            probe = probes / name
            native.write(probe, (f'#!{sys.executable}\nimport json,os,sys\n'
                                 f'with open({str(marker)!r},"a") as stream:\n'
                                 '    stream.write(json.dumps({"command":os.path.basename(sys.argv[0])})+"\\n")\n'
                                 '    stream.flush()\n    os.fsync(stream.fileno())\nsys.exit(87)\n').encode())
            probe.chmod(0o700)
        env = os.environ.copy()
        for name in list(env):
            if name.startswith(('OPENPLAN_', 'OCR_WORKER_')) or name.lower() in {'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'}:
                del env[name]
        env.update(OPENPLAN_KB_OCR_WORKER_TOKEN=native.WORKER_TOKEN,
                   OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN=native.CALLBACK_TOKEN,
                   OPENPLAN_KB_EXTRACTION_DISPATCH_URL='', OCR_WORKER_WORK_DIR=str(runtime),
                   OCR_WORKER_MAX_QUEUED='1', OCR_WORKER_MAX_SOURCE_BYTES='1048576', OCR_WORKER_MAX_PAGES='3',
                   OCR_WORKER_TIMEOUT_SECONDS='30', OCR_WORKER_JOBS='1', NO_PROXY='*', no_proxy='*',
                   PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1', PATH=str(probes)+os.pathsep+env['PATH'])
        with lock:
            state['phase'] = 'native'
        listener = out / 'worker-listener-private.json'
        log = (out / 'worker-private.log').open('xb')
        process = subprocess.Popen([sys.executable, '-B', str(prior / 'worker-wrapper.py'), str(repo / 'workers/ocr_worker'), str(listener)],
                                   cwd=out, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        native.wait_for(listener.exists, process)
        native.wait_for(lambda: (value if (value := native.job(runtime))['state'] == 'succeeded' else None), process)
        worker_url = f'http://{native.HOST}:{json.loads(listener.read_text())["port"]}/api/v1/ocr-requests'
        replay_status, replay_body = post(worker_url, json.dumps(source_job['request']).encode(), native.WORKER_TOKEN)
        changed_status, _body = post(worker_url, json.dumps(dict(source_job['request'], documentTitle='changed')).encode(), native.WORKER_TOKEN)
        native.stopped(process)
        with lock:
            deliveries = list(state['nativeBodies'])
            denied = state['deniedSourceGets']
            consumer_errors = list(state['consumerErrors'])
        logical_count = len(json.loads(ledger.read_text()))
        record = dict(previous, beforeJob=source_job, afterJob=native.job(runtime),
                      replayStatus=replay_status, replayAccepted=json.loads(replay_body), changedRequestStatus=changed_status,
                      consumerErrors=consumer_errors, secondCallbackHex=deliveries[0], terminalDeliveries=1+len(deliveries),
                      sourceGets=previous['sourceGets'], deniedSourceGets=denied, logicalResults=logical_count,
                      extractionProbes=marker.read_text().splitlines() if marker.exists() else [],
                      sourceRootBefore=before, retainedRoot=image(retained), sourceRootAfter=image(original),
                      packageBefore=set_before, packageAfter=root.inventory(root_set),
                      runtimeOrdinaryBefore=runtime_before, runtimeOrdinaryAfter=ordinary(root.inventory(runtime)),
                      sourceHashesBefore=source_hashes, sourceHashesAfter={str(path): native.digest(path) for path in deps})
        verify(record)
        comparisons = observation_controls(record)
        root.equal_root(inventory_before, root.inventory(inventory_package))
        root.equal_root(original_package_before, root.inventory(original_package))
        native.write(out / 'observations-private.json', record)
        native.write(out / 'operators-private.json', operators)
        native.write(out / 'observation-controls.json', comparisons)
        native.write(out / 'integration-controls.json', controls)
        native.write(out / 'callback-policy-controls.json', policy_controls)
        result = {'verified': True, 'profileScope': 'synthetic_ocr_fixture_only', 'familiesConfigured': 1,
                  'familiesUnassessed': 14, 'installationCoverage': 'unassessed', 'selectedRoots': 1,
                  'originalCallbackBytes': True, 'newNativeDeliveries': len(deliveries), 'newSourceDownloads': denied,
                  'logicalResults': logical_count,
                  'extractionReentry': False, 'observationControls': len(comparisons), 'integrationControls': len(controls),
                  'callbackPolicyControls': len(policy_controls),
                  'completedAdmissionReplay': replay_status, 'changedRequestRefusal': changed_status,
                  'originalSourceAndPackagesUnchanged': True, 'durationSeconds': round(time.monotonic()-started, 3),
                  'claimLimits': ['selected_synthetic_configuration', 'seeded_loopback_consumer', 'prior_native_extraction',
                                  'no_scanned_ocr_accuracy', 'no_live_database_storage_cut', 'no_other_worker_execution',
                                  'no_long_work', 'no_hardware_loss', 'no_openplan_callback_rls', 'no_browser_public_readiness']}
        native.write(out / 'result.json', result)
        print(json.dumps(result, sort_keys=True))
    finally:
        native.stopped(process)
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        if log is not None:
            log.close()
        native.write(out / 'cleanup-private.json', {'ownedChild': {'pid': process.pid, 'exit': process.returncode} if process else None,
                                                  'listenerClosed': server.socket.fileno() == -1})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--prior', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.prior.resolve(), args.out.absolute())
