"""Actual immutable worker upload against an isolated native Storage service."""
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit, urlunsplit
import uuid
from unittest.mock import patch
import requests

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT/'workers/aequilibrae_worker'))
from worker_import_for_tests import import_worker_main


def main():
    control = os.environ.get('OPENPLAN_NATIVE_STORAGE_CONTROL', 'normal')
    assert control in ('normal', 'harmless', 'lost-ack', 'restart', 'restart-wrong-identity', 'upsert', 'restored')
    output = Path(os.environ['OPENPLAN_NATIVE_STORAGE_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database']):
        raise ValueError('Owned proof source required')
    def docker(*args):
        result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=45)
        if result.returncode: raise RuntimeError('Docker operation failed: ' + args[0])
        return result.stdout.strip()
    def sql(database, statement):
        result = subprocess.run(['docker', 'exec', '-i', source['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True, timeout=45)
        if result.returncode: raise RuntimeError('Isolated SQL operation failed')
        return result.stdout.strip()
    if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
        raise RuntimeError('Source has active connections')
    joined = os.environ.get('OPENPLAN_NATIVE_STORAGE_JOIN') == '1'
    database = ('openplan_attempt_cli_' if joined else 'openplan_storage_proof_') + uuid.uuid4().hex
    sql('postgres', f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
    (output/'candidate.json').write_text(json.dumps({'database':database,'container':source['container'],'source_database':source['database']},indent=2)+'\n')
    inspected = json.loads(docker('inspect', 'supabase_storage_openplan-restore-target-2026091050'))[0]
    env = dict(item.split('=', 1) for item in inspected['Config']['Env'])
    connection = urlsplit(env['DATABASE_URL'])
    env['DATABASE_URL'] = urlunsplit(connection._replace(path='/' + database))
    env['VECTOR_ENABLED'] = 'false'
    env['VECTOR_STORE_MIGRATIONS_ENABLED'] = 'false'
    env['ENABLE_IMAGE_TRANSFORMATION'] = 'false'
    env['STORAGE_BACKEND'] = 'file'
    env['FILE_STORAGE_BACKEND_PATH'] = '/mnt'
    token = env['SERVICE_KEY']
    env_file = output/'storage.env'
    fd = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write('\n'.join(key+'='+value for key,value in env.items())+'\n')
    objects = output/'objects'; objects.mkdir(mode=0o700)
    name = 'openplan-native-storage-proof-' + uuid.uuid4().hex[:12]
    headers = {'Authorization': 'Bearer '+token, 'apikey': token}
    server = None
    created = False
    try:
        docker('run', '-d', '--name', name, '--memory', '512m', '--memory-swap', '512m', '--pids-limit', '128',
            '--network', next(iter(inspected['NetworkSettings']['Networks'])), '--env-file', str(env_file),
            '--mount', f'type=bind,src={objects},dst=/mnt', '-p', '127.0.0.1::5000', inspected['Config']['Image'])
        created = True
        env_file.unlink()
        port = docker('port', name, '5000/tcp').rsplit(':', 1)[1]
        native = 'http://127.0.0.1:' + port
        for _ in range(60):
            try:
                status = requests.get(native+'/status', timeout=1).status_code
                if status == 200: break
            except requests.RequestException: pass
            time.sleep(0.25)
        else: raise RuntimeError('Isolated Storage did not become ready')
        bucket = requests.get(native+'/bucket/run-artifacts', headers=headers, timeout=10)
        bucket_error = bucket.json() if bucket.status_code != 200 else {}
        if bucket.status_code == 404 or str(bucket_error.get('statusCode')) == '404':
            bucket = requests.post(native+'/bucket', headers=headers, json={'id':'run-artifacts','name':'run-artifacts','public':False}, timeout=10)
            assert bucket.status_code in (200,201), 'Private bucket creation failed'
        else:
            assert bucket.status_code == 200 and bucket.json()['public'] is False, 'Expected private bucket: HTTP '+str(bucket.status_code)+' code '+str(bucket_error.get('code'))+' statusCode '+str(bucket_error.get('statusCode'))
        responses = []
        class PrefixProxy(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                assert self.path.startswith('/storage/v1/object/authenticated/'), 'Unexpected readback'
                response = requests.get(native+self.path.removeprefix('/storage/v1'),
                    headers={key:self.headers[key] for key in ('Authorization','apikey')}, timeout=15)
                self.send_response(response.status_code); self.end_headers(); self.wfile.write(response.content)
            def do_POST(self):
                assert self.path.startswith('/storage/v1/object/'), 'Unexpected worker request'
                payload = self.rfile.read(int(self.headers['Content-Length']))
                response = requests.post(native+self.path.removeprefix('/storage/v1'), data=payload,
                    headers={key:self.headers[key] for key in ('Authorization','apikey','Content-Type','x-upsert')}, timeout=15)
                detail = response.json()
                responses.append({'status':response.status_code, 'code':detail.get('code'), 'error':detail.get('error')})
                self.send_response(response.status_code); self.end_headers(); self.wfile.write(response.content)
        server = HTTPServer(('127.0.0.1',0), PrefixProxy)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        worker = import_worker_main()
        run, assessment = str(uuid.uuid4()), str(uuid.uuid4())
        path = output/'assessment.json'; original = b'{"scientific_outcome":"inconclusive","fixture":true}'
        if control == 'harmless': original += b'\n'
        path.write_bytes(original)
        restart_recovered = False
        if control in ('restart', 'restart-wrong-identity'):
            retained = {'run':run,'assessment':assessment,'path':str(path),
                        'sha256':hashlib.sha256(original).hexdigest()}
            manifest = output/'upload-context.json'
            manifest.write_text(json.dumps(retained))
            child_code = """
import hashlib,json,os,sys
from pathlib import Path
record=json.load(sys.stdin)
sys.path.insert(0,record['worker_root'])
from worker_import_for_tests import import_worker_main
worker=import_worker_main()
worker.SUPABASE_URL=record['base']; worker.SUPABASE_KEY=record['key']
context=json.loads(Path(record['manifest']).read_text())
assert hashlib.sha256(Path(context['path']).read_bytes()).hexdigest()==context['sha256']
if record['exit_after_upload']:
    original=worker.requests.post
    def commit_then_exit(*args,**kwargs):
        response=original(*args,**kwargs)
        assert response.status_code in (200,201)
        os._exit(73)
    worker.requests.post=commit_then_exit
if record['wrong_identity']: context['assessment']='wrong-restart-identity'
uri=worker.upload_immutable_validation_json(context['run'],context['assessment'],context['path'])
print(json.dumps({'uri':uri,'pid':os.getpid()}))
"""
            child_input = {'worker_root':str(ROOT/'workers/aequilibrae_worker'),
                'base':f'http://127.0.0.1:{server.server_port}', 'key':token,
                'manifest':str(manifest),'exit_after_upload':True,'wrong_identity':False}
            first = subprocess.run([sys.executable,'-B','-c',child_code],input=json.dumps(child_input),capture_output=True,text=True,timeout=30)
            assert first.returncode == 73, 'First upload process did not exit at the committed boundary'
            expected_uri = f'storage://run-artifacts/model-runs/{run}/validation-assessments/{assessment}/{path.name}'
            committed = requests.get(native+'/object/authenticated/'+expected_uri.removeprefix('storage://'),headers=headers,timeout=10)
            assert committed.status_code == 200 and committed.content == original, 'Exited upload did not retain exact native bytes'
            child_input.update(exit_after_upload=False,wrong_identity=control=='restart-wrong-identity')
            second = subprocess.run([sys.executable,'-B','-c',child_code],input=json.dumps(child_input),capture_output=True,text=True,timeout=30)
            assert second.returncode == 0, 'Fresh upload process did not recover'
            recovered = json.loads(second.stdout)
            assert recovered['uri'] == expected_uri, 'Fresh upload process changed retained object identity'
            assert recovered['pid'] != os.getpid(), 'Recovery did not run in a fresh process'
            restart_recovered = True
        original_post = requests.post
        lost_ack = []
        def controlled_post(url, **kwargs):
            if control == 'upsert' and '/storage/v1/object/' in url:
                kwargs['headers'] = {**kwargs['headers'], 'x-upsert':'true'}
            response = original_post(url, **kwargs)
            if control == 'lost-ack' and '/storage/v1/object/' in url and not lost_ack:
                assert response.status_code in (200,201), 'No successful upload to interrupt'
                lost_ack.append(True)
                response.close()
                raise requests.Timeout('Synthetic lost upload acknowledgement after native commit')
            return response
        with patch.object(worker,'SUPABASE_URL',f'http://127.0.0.1:{server.server_port}'), patch.object(worker,'SUPABASE_KEY',token), patch.object(requests,'post',controlled_post):
            uri = worker.upload_immutable_validation_json(run, assessment, str(path))
            assert worker.upload_immutable_validation_json(run, assessment, str(path)) == uri, 'Exact retry changed reference'
            if control == 'lost-ack': assert lost_ack == [True], 'Lost acknowledgement was not exercised'
            object_path = uri.removeprefix('storage://run-artifacts/')
            def fetch():
                response = requests.get(native+'/object/authenticated/run-artifacts/'+object_path, headers=headers, timeout=10)
                assert response.status_code == 200, 'Native object read failed'
                return response.content
            assert fetch() == original, 'Native object bytes differ'
            path.write_bytes(b'{"fixture":"changed"}')
            try: worker.upload_immutable_validation_json(run, assessment, str(path))
            except RuntimeError: pass
            else: raise AssertionError('Immutable upload replaced an existing object')
            assert responses[-1] == {'status':400,'code':'KeyAlreadyExists','error':'Duplicate'}, 'Overwrite failed for an unexpected reason: '+str(responses[-1])
            assert fetch() == original, 'Rejected overwrite changed native bytes'
            anonymous = requests.get(native+'/object/authenticated/run-artifacts/'+object_path, timeout=10)
            assert anonymous.status_code in (400,401,403), 'Private object allowed unauthenticated access'
        joined_result = None
        if joined:
            from isolated_postgrest import gateway
            import model_attempt_invocation as invocation
            import model_attempt_writer as managed
            from verify_native_instrument_writer import verify_instrument
            fixture = str(uuid.UUID(source['fixture_run']))
            instrument_run, stage = str(uuid.uuid4()), str(uuid.uuid4())
            workspace = sql(database, f"""
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{instrument_run}',workspace_id,model_id,engine_key,'queued','Synthetic native Storage custody',created_by
 FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
 VALUES ('{stage}','{instrument_run}','Artifact Extraction','queued',1);
SELECT workspace_id FROM public.model_runs WHERE id='{instrument_run}';
""")
            workspace = str(uuid.UUID(workspace))
            with gateway('public', database=database) as connection:
                base, key = connection['url'], connection['service_token']
                def adapt(method, url, **kwargs):
                    assert url.startswith(base+'/rest/v1/'), 'Unexpected custody destination'
                    return requests.request(method, base+url.removeprefix(base+'/rest/v1'), **kwargs)
                def post(url, **kwargs): return adapt('POST',url,**kwargs)
                def get(url, **kwargs): return adapt('GET',url,**kwargs)
                directory = output/'custody-journal'
                expected_objects = {}
                def upload(run_id, method, artifact_path, content):
                    object_path = f'model-runs/{run_id}/native-instrument/{method}/{artifact_path.name}'
                    with patch.object(worker,'SUPABASE_URL',f'http://127.0.0.1:{server.server_port}'), patch.object(worker,'SUPABASE_KEY',token):
                        uri = worker.upload_verified_immutable_bytes(object_path,content,'text/csv' if artifact_path.suffix=='.csv' else 'application/json')
                    if os.environ.get('OPENPLAN_STORAGE_CUSTODY_FAULT') == 'wrong-reference': uri += '-wrong'
                    expected_objects[uri] = content
                    return uri
                results = []
                def handler(context):
                    writer = managed.AttemptWriter(directory,context,base_url=base,deployment_id=database,service_key=key,post=post,get=get)
                    with managed.bind(writer):
                        def publish():
                            return verify_instrument(writer,instrument_run,stage,output,sql,database,upload=upload)
                        if os.environ.get('OPENPLAN_INSTRUMENT_REPLY_LOSS') == '1':
                            from verify_native_instrument_recovery import verify
                            results.append(verify(writer,publish,output=output,sql=sql,database=database,base=base,key=key))
                        else:
                            results.append(publish())
                invocation.invoke_new_attempt(directory,run_id=instrument_run,stage_id=stage,
                    worker_id='native-storage-custody-proof',workspace_id=workspace,base_url=base,
                    deployment_id=database,service_key=key,handler=handler,post=post,get=get)
                assert len(results)==1 and results[0]['native_storage_uploaded'], 'Native custody callback did not complete'
                rows = json.loads(sql(database, f"SELECT jsonb_agg(jsonb_build_object('file_url',file_url,'content_hash',content_hash,'size',file_size_bytes)) FROM public.model_run_artifacts WHERE run_id='{instrument_run}';"))
                assert len(rows)==len(expected_objects)==results[0]['attempt_bound_artifacts'], 'Storage artifact inventory differs'
                for row in rows:
                    content = expected_objects[row['file_url']]
                    response = requests.get(native+'/object/authenticated/'+row['file_url'].removeprefix('storage://'),headers=headers,timeout=10)
                    assert response.status_code==200 and response.content==content, 'Custody object bytes differ'
                    assert row['content_hash']==hashlib.sha256(content).hexdigest() and row['size']==len(content), 'Custody object metadata differs'
                joined_result = {'instrument':results[0],'native_objects_verified':len(rows),
                    'same_database':True,'postgrest_gateway_removed_on_exit':True}
        report = {'joined_custody':joined_result,'control':control,'upload_responses':responses,'database':database,'storage_image':inspected['Config']['Image'],
            'exact_bytes_downloaded':True,'exact_retry_reused':True,'lost_ack_exercised':bool(lost_ack),'fresh_process_recovered':restart_recovered,'changed_upload_refused':True,'original_bytes_preserved':True,
            'unauthenticated_status':anonymous.status_code,'content_sha256':hashlib.sha256(original).hexdigest(),
            'limits':['Native private Storage and actual worker upload with a prefix-only HTTP proxy',
                      'No stage restart, custody RPC, RLS user matrix, full source publication or scientific acceptance']}
        if joined:
            report['limits'] = ['Actual wrapper/evaluator, native private Storage and native attempt custody in one isolated database',
                                'Authored synthetic sources and outputs; no independent preparation, stage restart, full user RLS matrix, full source publication or scientific acceptance']
        (output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    finally:
        if server is not None: server.shutdown(); server.server_close(); thread.join(timeout=5)
        if created: docker('rm','-f',name)
        if env_file.exists(): env_file.unlink()

if __name__ == '__main__': main()
