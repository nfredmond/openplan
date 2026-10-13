"""Verify actual opt-in admission replay and held starts after root restoration."""
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
import urllib.error
import hashlib

from oracle import controls, verify


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    started = time.monotonic()
    sys.path.insert(0, str(repo / 'docs/reviews/2026-10-11-ocr-worker-recovery'))
    import native_recovery as helpers
    root = helpers.load('odm_native_independent_root', repo / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    operator = repo / 'openplan/scripts/ops/worker_root_snapshot.py'
    readiness = repo / 'docs/reviews/2026-10-11-odm-native-readiness-race/readiness.py'
    deps = [Path(__file__), Path(__file__).with_name('oracle.py'), Path(helpers.__file__),
            readiness, repo / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py', operator,
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
                           'sys.path.insert(0,sys.argv[3])\nfrom readiness import publish_readiness\n'
                           'def local_server(*args,**kwargs):\n'
                           f'    server=original(host={helpers.HOST!r},port=0)\n'
                           '    publish_readiness(Path(sys.argv[2]), {"port":server.server_address[1],"pid":os.getpid(),"admission":main.ADMISSIONS.status()})\n'
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
               ODM_WORKER_MANAGED_ADMISSION='1', ODM_WORKER_INSTALLATION_ID='synthetic-native-installation',
               ODM_WORKER_SWEEP_INTERVAL_SECONDS='600', NO_PROXY='*', no_proxy='*',
               PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1')
    children, streams = [], []
    def start(name, work_dir):
        listener = out / f'{name}-listener-private.json'
        log = (out / f'{name}-worker-private.log').open('xb')
        streams.append(log)
        process = subprocess.Popen([sys.executable, '-B', str(wrapper), str(repo / 'workers/odm_worker'), str(listener), str(readiness.parent)],
                                   cwd=out, env=dict(env, ODM_WORKER_WORK_DIR=str(out/(name+'-scratch')), ODM_WORKER_MANAGED_STATE_DIR=str(work_dir)),
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        children.append(process)
        helpers.wait_for(listener.exists, process)
        return process, json.loads(listener.read_text())['port']
    def refused_start(label, copied_root, original_name, diagnostic):
        listener=out/(label+'-listener-private.json');log_path=out/(label+'-worker-private.log')
        original=copied_root/original_name;held=out/(label+'-held-original')
        original.rename(held)
        process=None
        try:
            with log_path.open('xb') as log:
                process=subprocess.Popen([sys.executable,'-B',str(wrapper),str(repo/'workers/odm_worker'),str(listener),str(readiness.parent)],
                    cwd=out,env=dict(env,ODM_WORKER_WORK_DIR=str(out/(label+'-scratch')),ODM_WORKER_MANAGED_STATE_DIR=str(copied_root)),stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
                children.append(process)
                helpers.wait_for(lambda:process.poll() is not None or listener.exists(),timeout=10)
                helpers.stopped(process)
            return process.returncode==1 and not listener.exists() and diagnostic in log_path.read_text()
        finally:
            helpers.stopped(process)
            if original.exists():original.rename(out/(label+'-unexpected-recreated'))
            held.rename(original)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def post(port, body):
        request = urllib.request.Request(f'http://{helpers.HOST}:{port}/api/v1/processing-requests', data=body,
                                         headers={'Authorization': f'Bearer {worker_token}', 'Content-Type': 'application/json'})
        try: response=opener.open(request, timeout=10)
        except urllib.error.HTTPError as error: response=error
        with response:
            raw=response.read();return response.status, json.loads(raw), raw
    def request(request_id):
        return {'schemaVersion': 'natford-aerial-processing.v1', 'requestId': request_id,
                'callbackUrl': endpoint+'/callback', 'externalRef': {'system': 'openplan', 'missionId': 'synthetic-mission', 'workspaceId': 'synthetic-workspace'},
                'missionTitle': 'Synthetic admission fixture. No imagery processing.',
                'imagery': {'type': 'zip_url', 'url': endpoint+'/held-imagery.zip'}, 'presetId': 'balanced'}
    source, package, runtime = out/'source-root-private', out/'immutable-package-private', out/'runtime-private'
    try:
        source.mkdir(mode=0o700)
        initial, port = start('initial', source)
        first_status, first_receipt, first_wire = post(port, json.dumps(request('synthetic-held-request-0001')).encode())
        helpers.wait_for(lambda: counters['sourceGets'] == 1, initial)
        original_request = json.dumps(request('synthetic-queued-request-0002')).encode()
        queued_status, queued, queued_wire = post(port, original_request)
        replay_status, replay, replay_wire = post(port, original_request)
        changed = json.loads(original_request)
        changed['missionTitle'] = 'Changed metadata under original request identity'
        changed_status, changed_receipt, changed_wire = post(port, json.dumps(changed).encode())
        with lock:
            before_count = counters['sourceGets']
        helpers.stopped(initial)
        sys.path.insert(0,str(repo/'workers/odm_worker'))
        from admission_journal import FILENAME, Journal
        def ordinary(path):return {key:value for key,value in root.inventory(path).items() if key not in {'admissions/'+FILENAME+suffix for suffix in ('','-wal','-shm')}}
        def logical(path):return root.sqlite_image(path/'admissions'/FILENAME)
        root_before=ordinary(source);journal_before=logical(source)
        original_first=Journal(source/'admissions').get('synthetic-held-request-0001')
        original_queued=Journal(source/'admissions').get('synthetic-queued-request-0002')
        captured=subprocess.run([sys.executable,'-B',str(operator),'--source',str(source),'--destination',str(package),'--writers-quiesced'],capture_output=True,timeout=35)
        (out/'capture.stdout').write_bytes(captured.stdout);(out/'capture.stderr').write_bytes(captured.stderr)
        snapshot_summary=json.loads(captured.stdout)
        checked=subprocess.run([sys.executable,'-B',str(operator),'--destination',str(package),'--verify'],capture_output=True,timeout=35)
        (out/'verify.stdout').write_bytes(checked.stdout);(out/'verify.stderr').write_bytes(checked.stderr)
        retained=ordinary(package/'root');retained_journal=logical(package/'root')
        package_before=root.inventory(package)
        shutil.copytree(package/'root',runtime,copy_function=shutil.copy2)
        replacement_scratch_fresh=not (out/'replacement-scratch').exists()
        replacement,port=start('replacement',runtime)
        restart_status,restarted,restart_wire=post(port,original_request)
        started_status,started_receipt,started_wire=post(port,json.dumps(request('synthetic-held-request-0001')).encode())
        restored=json.loads((out/'replacement-listener-private.json').read_bytes())['admission']
        helpers.stopped(replacement)
        recovered_first=Journal(runtime/'admissions').get('synthetic-held-request-0001')
        recovered_queued=Journal(runtime/'admissions').get('synthetic-queued-request-0002')
        missing_db=out/'missing-db-runtime-private';missing_seal=out/'missing-seal-runtime-private'
        shutil.copytree(package/'root',missing_db);shutil.copytree(package/'root',missing_seal)
        missing_db_refused=refused_start('missing-db',missing_db,'admissions/'+FILENAME,'FileNotFoundError')
        missing_seal_refused=refused_start('missing-seal',missing_seal,'runtime-installation.json','original installation seal')
        missing_fixtures_preserved=ordinary(missing_db)==retained and ordinary(missing_seal)==retained and logical(missing_db)==journal_before and logical(missing_seal)==journal_before
        with lock:
            final_counters = dict(counters)
        record={'originalScratchHasNoAdmissionRegistry':not (out/'initial-scratch/admissions').exists() and (source/'admissions'/FILENAME).is_file(),
            'replacementUsesFreshScratch':replacement_scratch_fresh and (out/'replacement-scratch').is_dir() and not (out/'replacement-scratch/admissions').exists(),
            'missingDatabaseStartupRefused':missing_db_refused,'missingSealStartupRefused':missing_seal_refused,'negativeFixturesRestored':missing_fixtures_preserved,
            'firstAdmissionStatus':first_status,'queuedAdmissionStatus':queued_status,'predeathReplayStatus':replay_status,
            'predeathReceiptExact':replay==queued and replay_wire==queued_wire,'changedStatus':changed_status,
            'restartAdmissionStatus':restart_status,'restartReceiptExact':restarted==queued and restart_wire==queued_wire,
            'originalStartedReceiptExact':started_status==200 and started_receipt==first_receipt and started_wire==first_wire,
            'firstStartPreserved':recovered_first==original_first and original_first.phase=='started',
            'queuedAdmissionPreserved':recovered_queued==original_queued and original_queued.phase=='accepted',
            'restoredHeldStarted':restored['heldStarted'],'restoredAccepted':restored['accepted'],
            'sourceGetsBeforeDeath':before_count,'sourceGetsFinal':final_counters['sourceGets'],
            'sourceBodyBytesSent':final_counters['sourceBodyBytesSent'],'engineRequests':final_counters['engineRequests'],
            'sqliteCopies':snapshot_summary['sqliteCopies'],'captureExit':captured.returncode,'verifyExit':checked.returncode,
            'capturedOrdinaryMatchesSource':retained==root_before,'capturedJournalMatchesSource':retained_journal==journal_before,
            'sourceOrdinaryUnchanged':ordinary(source)==root_before,'sourceJournalUnchanged':logical(source)==journal_before,
            'packageUnchanged':root.inventory(package)==package_before,'runtimeJournalUnchanged':logical(runtime)==journal_before,
            'exactOriginalRequestBytes':original_request==json.dumps(request('synthetic-queued-request-0002')).encode(),
            'sourceBindingsUnchanged':binding=={str(path):helpers.digest(path) for path in deps}}
        verify(record);outcomes=controls(record)
        helpers.write(out/'observed.json',record);helpers.write(out/'controls.json',outcomes)
        helpers.write(out/'source-bindings.json',{str(path.relative_to(repo)):helpers.digest(path) for path in deps})
        helpers.write(out/'callbacks-private.json',final_counters['callbacks'])
        result={'nativeAdmissionRecovery':True,'observations':len(record),'controls':len(outcomes),
            'sourceBodyBytesSent':0,'nodeodmRequests':0,'startedWorkHeld':True,'workerRecoveryAccepted':False,
            'seconds':round(time.monotonic()-started,3),'originalRootAndPackageUnchanged':True,
            'claimLimits':['admission and held-start recovery only','no imagery processing','no engine-stage or artifact recovery','no live application authority','no browser or practitioner acceptance']}
        helpers.write(out/'summary.json',result)
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
