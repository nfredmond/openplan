"""Check temporary artifact command permissions through an owned PostgREST gateway."""
from pathlib import Path
import json
import os
import re
import subprocess
import uuid
import requests
from isolated_postgrest import gateway



def check(harmless=False):
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch('openplan_attempt_cli_[0-9a-f]{32}', meta['database']):
        raise ValueError('Select the named owned artifact proof database')
    def sql(statement):
        r = subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=statement,capture_output=True,text=True,timeout=25)
        if r.returncode:raise RuntimeError('Owned artifact permission query failed')
        return r.stdout.strip()
    if sql("SELECT to_regclass('public.model_legacy_artifact_receipts') IS NULL AND to_regprocedure('public.record_legacy_model_artifact(uuid,jsonb)') IS NULL;")!='t':
        raise RuntimeError('Candidate objects already exist; preserve them')
    source=(Path(__file__).resolve().parent/'legacy-artifact-command.sql').read_text()
    if harmless:
        source+='\n-- Harmless HTTP permission control.\n'
    sql('BEGIN;'+source+'COMMIT;')
    try:
        parent = str(uuid.UUID(meta['fixture_run']))
        run, stage, artifact, outsider = [str(uuid.uuid4()) for _ in range(4)]
        scope = json.loads(sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic artifact HTTP permissions',created_by FROM public.model_runs WHERE id='{parent}' RETURNING json_build_object('workspace',workspace_id,'user',created_by);"))
        workspace = str(uuid.UUID(scope['workspace'])); user = str(uuid.UUID(scope['user']))
        sql(f"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic permissions','queued',1); INSERT INTO auth.users(id,email) VALUES('{outsider}','{outsider}@example.test'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{user}','owner') ON CONFLICT DO NOTHING;")
        payload=dict(id=artifact,run_id=run,stage_id=stage,artifact_type='link_volumes',file_url='local://synthetic',file_size_bytes=2,content_hash='a'*64,metadata_json={})
        result = {'run_id':run,'database':meta['database'],'harmless_source_comment':harmless}
        with gateway('public',database=meta['database'],subjects=(user,outsider)) as connection:
            headers = {'member':{'Authorization':'Bearer '+connection['authenticated_tokens'][user]},'outsider':{'Authorization':'Bearer '+connection['authenticated_tokens'][outsider]},'anon':{'Authorization':'Bearer '+connection['anon_token']},'unsigned':{},'service':{'Authorization':'Bearer '+connection['service_token']}}
            body={'p_workspace':workspace,'p_payload':payload}
            def invoke(label):
                return requests.post(connection['url']+'/rpc/record_legacy_model_artifact',headers=headers[label],json=body,timeout=15)
            for label in ('member','outsider'):
                with requests.get(connection['url']+'/model_runs',headers=headers[label],params={'id':'eq.'+run,'select':'id'},timeout=15) as r:
                    if r.status_code!=200 or len(r.json())!=(1 if label=='member' else 0):raise AssertionError('Membership fixture did not establish RLS scope')
            for label in ('member','outsider','anon','unsigned'):
                with invoke(label) as r:
                    if r.status_code not in (401,403):raise AssertionError('Unprivileged artifact command accepted')
                    result[label+'_rpc']=r.status_code
            if sql(f"SELECT count(*) FROM public.model_run_artifacts WHERE run_id='{run}';")!='0':raise AssertionError('Denied calls created an artifact')
            with invoke('service') as r:
                if r.status_code!=200:raise AssertionError('Service command refused valid fixture')
                receipt=r.json()
                if any(receipt.get(key)!=value for key,value in payload.items()):raise AssertionError('Artifact response differs from submitted fields')
            with invoke('service') as r:
                if r.status_code!=200 or r.json()!=receipt:raise AssertionError('HTTP retry changed receipt')
            for label in headers:
                with requests.get(connection['url']+'/model_legacy_artifact_receipts',headers=headers[label],params={'select':'artifact_id'},timeout=15) as r:
                    if r.status_code not in (401,403):raise AssertionError('Private artifact receipts exposed')
                    result[label+'_table']=r.status_code
            signature='public.record_legacy_model_artifact(uuid,jsonb)'
            try:
                sql('GRANT EXECUTE ON FUNCTION '+signature+' TO authenticated;')
                with invoke('outsider') as r:
                    if r.status_code!=200 or r.json()!=receipt:raise AssertionError('Adverse permission grant did not expose retained synthetic receipt')
                result['adverse_grant_detected']=True
            finally:
                sql('REVOKE EXECUTE ON FUNCTION '+signature+' FROM authenticated;')
            with invoke('outsider') as r:
                if r.status_code!=403:raise AssertionError('Artifact permission not restored')
            result['restored_outsider_rpc']=403
            if sql(f"SELECT count(*) FROM public.model_legacy_artifact_receipts WHERE run_id='{run}';")!='1':raise AssertionError('HTTP calls duplicated receipt')
    finally:
        sql('BEGIN; DROP FUNCTION public.record_legacy_model_artifact(uuid,jsonb); DROP TABLE public.model_legacy_artifact_receipts; COMMIT;')
    if sql("SELECT to_regclass('public.model_legacy_artifact_receipts') IS NULL AND to_regprocedure('public.record_legacy_model_artifact(uuid,jsonb)') IS NULL;")!='t':
        raise AssertionError('Candidate cleanup failed')
    result['cleanup_confirmed']=True
    result['scope']='Temporary candidate in isolated synthetic database, actual HTTP service retry, member/outsider/anonymous refusal and restored privilege control. No application database, Storage bytes, normal dispatcher or scientific acceptance.'
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']);output.mkdir(mode=0o700,parents=True,exist_ok=True)
    (output/'http-permissions.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harmless',action='store_true')
    print(json.dumps(check(parser.parse_args().harmless),indent=2))
