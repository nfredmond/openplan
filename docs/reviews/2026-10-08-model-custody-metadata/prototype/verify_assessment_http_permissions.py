"""Check installed assessment permissions through an owned PostgREST gateway."""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import uuid
import requests
from isolated_postgrest import gateway

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
from test_model_assessment_client import fixture
import model_assessment_values


def check():
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch('openplan_assessment_upgrade_[0-9a-f]{32}', meta['database']):
        raise ValueError('Select the owned assessment upgrade clone')
    def sql(statement):
        r = subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=statement,capture_output=True,text=True,timeout=25)
        if r.returncode:raise RuntimeError('Owned assessment permission query failed')
        return r.stdout.strip()
    parent = str(uuid.UUID(meta['fixture_run']))
    run, stage, artifact, request, outsider = [str(uuid.uuid4()) for _ in range(5)]
    scope = json.loads(sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic assessment HTTP permissions',created_by FROM public.model_runs WHERE id='{parent}' RETURNING json_build_object('workspace',workspace_id,'user',created_by);"))
    workspace = str(uuid.UUID(scope['workspace'])); user = str(uuid.UUID(scope['user']))
    sql(f"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic permissions','queued',1); INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash) VALUES('{artifact}','{run}','{stage}','link_volumes','storage://synthetic/output',2,repeat('a',64)); INSERT INTO auth.users(id,email) VALUES('{outsider}','{outsider}@example.test'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{user}','owner') ON CONFLICT DO NOTHING;")
    payload, _ = fixture()
    payload.update(p_workspace_id=workspace,p_model_run_id=run,p_stage_id=stage,p_model_output_artifact_id=artifact)
    payload['p_validation_input_metadata']={'schema':'openplan.validation-input-bundle.v1','comparison_basis_sha256':'a'*64}
    payload['p_comparison_basis_metadata']={'schema':'openplan.model-comparison-basis.v1'}
    payload['p_assessment_metadata']={'schema':'openplan.model-validation-assessment.v1','comparison_basis_sha256':'a'*64,'rules_version':4,'scientific_outcome':payload['p_scientific_outcome'],'planning_use':payload['p_planning_use'],'partition':payload['p_partition'],'reasons':payload['p_reasons']}
    result = {'run_id':run,'database':meta['database']}
    with gateway('public',database=meta['database'],subjects=(user,outsider)) as connection:
        headers = {'member':{'Authorization':'Bearer '+connection['authenticated_tokens'][user]},'outsider':{'Authorization':'Bearer '+connection['authenticated_tokens'][outsider]},'anon':{'Authorization':'Bearer '+connection['anon_token']},'unsigned':{},'service':{'Authorization':'Bearer '+connection['service_token']}}
        body={'p_request':request,'p_payload':payload}
        def invoke(label):
            return requests.post(connection['url']+'/rpc/record_legacy_model_assessment',headers=headers[label],json=body,timeout=15)
        for label in ('member','outsider'):
            with requests.get(connection['url']+'/model_runs',headers=headers[label],params={'id':'eq.'+run,'select':'id'},timeout=15) as r:
                if r.status_code!=200 or len(r.json())!=(1 if label=='member' else 0):raise AssertionError('Membership fixture did not establish RLS scope')
        for label in ('member','outsider','anon','unsigned'):
            with invoke(label) as r:
                if r.status_code not in (401,403):raise AssertionError('Unprivileged assessment command accepted')
                result[label+'_rpc']=r.status_code
        if sql(f"SELECT count(*) FROM public.modeling_validation_assessments WHERE model_run_id='{run}';")!='0':raise AssertionError('Denied calls created an assessment')
        with invoke('service') as r:
            if r.status_code!=200:raise AssertionError('Service command refused valid fixture')
            receipt=r.json()
            model_assessment_values.check_receipt({'request_id':request,'arguments':{'payload':payload}},receipt)
        with invoke('service') as r:
            if r.status_code!=200 or r.json()!=receipt:raise AssertionError('Installed HTTP retry changed receipt')
        for label in headers:
            with requests.get(connection['url']+'/model_assessment_command_receipts',headers=headers[label],params={'select':'request_id'},timeout=15) as r:
                if r.status_code not in (401,403):raise AssertionError('Private assessment receipts exposed')
                result[label+'_table']=r.status_code
        signature='public.record_legacy_model_assessment(uuid,jsonb)'
        try:
            sql('GRANT EXECUTE ON FUNCTION '+signature+' TO authenticated;')
            with invoke('outsider') as r:
                if r.status_code!=200 or r.json()!=receipt:raise AssertionError('Adverse permission grant did not expose retained synthetic receipt')
            result['adverse_grant_detected']=True
        finally:
            sql('REVOKE EXECUTE ON FUNCTION '+signature+' FROM authenticated;')
        with invoke('outsider') as r:
            if r.status_code!=403:raise AssertionError('Assessment permission not restored')
        result['restored_outsider_rpc']=403
        if sql(f"SELECT count(*) FROM public.model_assessment_command_receipts WHERE run_id='{run}';")!='1':raise AssertionError('HTTP calls duplicated receipt')
    result['scope']='Installed synthetic clone, actual HTTP service retry, member/outsider/anonymous refusal and restored privilege control. No application database, Storage bytes, normal dispatcher or scientific acceptance.'
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']);output.mkdir(mode=0o700,parents=True,exist_ok=True)
    (output/'http-permissions.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    print(json.dumps(check(),indent=2))
