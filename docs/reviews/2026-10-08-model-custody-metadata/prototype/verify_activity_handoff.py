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


def check():
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', meta['database']) or meta['container'] != 'supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select the named owned proof database')
    fixture = str(uuid.UUID(meta['fixture_run']))
    root = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    run, stage = str(uuid.uuid4()), str(uuid.uuid4())
    source_root = root / run
    source = source_root / 'runs' / run
    source.mkdir(mode=0o700, parents=True)
    execution = source_root / 'retained'
    execution.mkdir(mode=0o700)
    statement = f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic handoff byte proof',created_by FROM public.model_runs WHERE id='{fixture}'; INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic predecessor','succeeded',1);"
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
    evidence={'run_id':run,'stage_id':stage,'artifact_ids':[r['id'] for r in records],'native_artifacts':3,'retained_copies_verified':3,'same_size_source_drift_refused':True,'restored_copy_verified':True,'unknown_run_inventory_empty':True,'failed_producer_refused_before_copy':True,'restored_producer_accepted':True,'queries':observed_queries,'scope':'Installed candidate, synthetic unmanaged records, actual PostgREST and local bytes. Kong mount omitted. No model, Storage delivery, attempt activation or scientific acceptance.'}
    (root/'native-activity-handoff.json').write_text(json.dumps(evidence,indent=2)+'\n')
    return evidence


if __name__ == '__main__':
    print(json.dumps(check(),indent=2))
