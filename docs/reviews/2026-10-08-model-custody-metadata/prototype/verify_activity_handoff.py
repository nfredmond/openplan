"""Verify native artifact inventory and retained local bytes in the owned proof DB."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys
import types
import uuid
import requests
from isolated_postgrest import gateway

REPO = Path(__file__).resolve().parents[4]


def check(*, managed=False):
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', meta['database']) or meta['container'] != 'supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select the named owned proof database')
    fixture = str(uuid.UUID(meta['fixture_run']))
    root = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    run, stage, following_stage = [str(uuid.uuid4()) for _ in range(3)]
    initial_status = 'queued' if managed else 'succeeded'
    source_root = root / run
    source = source_root / 'runs' / run
    source.mkdir(mode=0o700, parents=True)
    execution = source_root / 'retained'
    execution.mkdir(mode=0o700)
    statement = f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic handoff byte proof',created_by FROM public.model_runs WHERE id='{fixture}'; INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic predecessor','{initial_status}',1);"
    if managed:
        statement += f" INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{following_stage}','{run}','Synthetic pending consumer','queued',2);"
    result = subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=20)
    if result.returncode:
        raise RuntimeError('Owned fixture creation failed')
    records = []
    payloads = {'skim_matrix': b'synthetic skim bytes', 'zone_attributes': b'zone,value\n1,2\n', 'network_setup_summary': b'{"synthetic":true}'}
    for kind, data in payloads.items():
        path = source / kind
        path.write_bytes(data)
        records.append({'id':str(uuid.uuid4()),'run_id':run,'stage_id':stage,'artifact_type':kind,'file_url':'local://'+str(path),'file_size_bytes':len(data),'content_hash':hashlib.sha256(data).hexdigest(),'metadata_json':{'synthetic':True}})
    observed_queries = []
    with gateway('public', database=meta['database']) as connection:
        headers = {'Authorization':'Bearer '+connection['service_token'],'Prefer':'return=representation'}
        attempt = None
        if managed:
            sys.path.insert(0, str(REPO/'workers/aequilibrae_worker'))
            import model_command_client as client
            def execute(operation, arguments):
                command = {'request_id':str(uuid.uuid4()), 'destination':client.destination(connection['url'],meta['database']), 'operation':operation, 'arguments':arguments}
                def post(url, **kwargs):
                    expected = connection['url']+'/rest/v1/rpc/'+operation
                    if url != expected:
                        raise AssertionError('Unexpected command destination')
                    return requests.post(connection['url']+'/rpc/'+operation, **kwargs)
                return client.deliver(source_root/'commands', command, base_url=connection['url'], deployment_id=meta['database'], service_key=connection['service_token'], post=post)
            claim = execute('claim_model_stage_attempt', {'run_id':run,'stage_id':stage,'worker_id':'synthetic-managed-handoff'})
            if claim['outcome'] != 'claimed':
                raise AssertionError('Managed producer not claimed')
            attempt = claim['attempt_id']
            retained = []
            for record in records:
                payload = {key:record[key] for key in ('artifact_type','file_url','file_size_bytes','content_hash','metadata_json')}
                retained.append(execute('write_model_attempt_artifact',{'run_id':run,'stage_id':stage,'attempt_id':attempt,'payload':payload}))
            records = retained
            execute('write_model_stage_attempt',{'run_id':run,'stage_id':stage,'attempt_id':attempt,'status':'succeeded','log_tail':'Synthetic producer finished','error':None})
        else:
            with requests.post(connection['url']+'/model_run_artifacts',headers=headers,json=records,timeout=15) as response:
                if response.status_code != 201 or len(response.json()) != 3:
                    raise RuntimeError('Native artifact registration failed')
        os.environ['SUPABASE_URL'] = connection['url']
        os.environ['SUPABASE_SERVICE_ROLE_KEY'] = connection['service_token']
        os.environ['AEQ_WORK_DIR'] = str(source_root)
        sys.path.insert(0,str(REPO/'workers/activitysim_worker'))
        import supabase_poll as worker
        worker.SUPABASE_URL = connection['url']
        worker.HEADERS = headers
        def get(url, **kwargs):
            # This isolated PostgREST bypasses Kong's /rest/v1 mount only.
            prefix = connection['url']+'/rest/v1/'
            if not url.startswith(prefix):
                raise AssertionError('Unexpected native proof destination')
            observed_queries.append(url[len(prefix):])
            return requests.get(connection['url']+'/'+url[len(prefix):],**kwargs)
        worker.requests = types.SimpleNamespace(get=get)
        rows = worker.sb_get_run_artifacts(run)
        if len(rows) != 3 or any(row['run_id'] != run or row['stage_id'] != stage for row in rows):
            raise AssertionError('Native inventory lost run identity')
        for kind,data in payloads.items():
            path = worker._retain_handoff_file(rows,kind,run,str(execution))
            if Path(path).read_bytes() != data:
                raise AssertionError('Retained bytes differ')
        # Native inventory still carries original hashes. Equal-length source drift must fail.
        original = payloads['skim_matrix']
        (source/'skim_matrix').write_bytes(b'X'*len(original))
        failed = source_root/'changed'; failed.mkdir()
        try:
            worker._retain_handoff_file(worker.sb_get_run_artifacts(run),'skim_matrix',run,str(failed))
        except RuntimeError as error:
            if 'bytes differ' not in str(error):
                raise
        else:
            raise AssertionError('Native registered hash did not reject changed input')
        (source/'skim_matrix').write_bytes(original)
        restored = source_root/'restored'; restored.mkdir()
        retained = worker._retain_handoff_file(worker.sb_get_run_artifacts(run),'skim_matrix',run,str(restored))
        if Path(retained).read_bytes() != original:
            raise AssertionError('Restored bytes did not recover')
        def producer_status(status):
            if status not in ('failed', 'succeeded'):
                raise ValueError('Unsupported proof state')
            changed = subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=f"UPDATE public.model_run_stages SET status='{status}' WHERE id='{stage}' AND run_id='{run}';",text=True,capture_output=True,timeout=20)
            if changed.returncode:
                raise RuntimeError('Owned producer-state mutation failed')
        if managed:
            with requests.post(connection['url']+'/rpc/reap_model_run_if_stale',headers=headers,json={'p_run_id':run,'p_stale_before':'2099-01-01T00:00:00Z','p_message':'Synthetic owned-run revocation'},timeout=15) as response:
                if response.status_code != 200 or response.json() is not True:
                    raise AssertionError('Managed fixture was not revoked')
            revoked = worker.sb_get_run_artifacts(run)
            if any(row['model_run_stages']['status'] != 'succeeded' or row['model_run_stages']['active_attempt_id'] is not None for row in revoked):
                raise AssertionError('Revocation did not retain success and clear ownership')
            inactive = source_root/'revoked'; inactive.mkdir()
            try:
                worker._retain_handoff_file(revoked,'skim_matrix',run,str(inactive))
            except RuntimeError as error:
                if 'inactive attempt' not in str(error):
                    raise
            else:
                raise AssertionError('Revoked managed predecessor accepted')
            if list(inactive.iterdir()):
                raise AssertionError('Revoked producer copied bytes')
        else:
            producer_status('failed')
            inactive = source_root/'inactive'; inactive.mkdir()
            try:
                try:
                    worker._retain_handoff_file(worker.sb_get_run_artifacts(run),'skim_matrix',run,str(inactive))
                except RuntimeError as error:
                    if 'completed producing stage' not in str(error):
                        raise
                else:
                    raise AssertionError('Native failed predecessor was accepted')
                if list(inactive.iterdir()):
                    raise AssertionError('Failed predecessor copied bytes')
            finally:
                producer_status('succeeded')
            recovered = source_root/'producer-restored'; recovered.mkdir()
            worker._retain_handoff_file(worker.sb_get_run_artifacts(run),'skim_matrix',run,str(recovered))
        if worker.sb_get_run_artifacts(str(uuid.uuid4())) != []:
            raise AssertionError('Run filter returned unrelated artifacts')
    evidence={'run_id':run,'stage_id':stage,'artifact_ids':[r['id'] for r in records],'native_artifacts':3,'retained_copies_verified':3,'same_size_source_drift_refused':True,'restored_copy_verified':True,'unknown_run_inventory_empty':True,'managed':managed,'attempt_id':attempt,'failed_producer_refused_before_copy':True if not managed else None,'restored_producer_accepted':True if not managed else None,'revoked_managed_producer_refused_before_copy':True if managed else None,'queries':observed_queries,'scope':'Installed candidate, synthetic records, actual PostgREST and local bytes. Managed mode uses real claim, artifact, completion and reaper commands. Kong mount omitted. No model, Storage delivery, normal dispatcher activation or scientific acceptance.'}
    (root/'native-activity-handoff.json').write_text(json.dumps(evidence,indent=2)+'\n')
    return evidence


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--managed', action='store_true')
    print(json.dumps(check(managed=parser.parse_args().managed),indent=2))
