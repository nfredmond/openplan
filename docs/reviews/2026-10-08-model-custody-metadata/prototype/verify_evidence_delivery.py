"""Exercise legacy evidence failure containment against the owned proof database."""
from pathlib import Path
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
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    run = str(uuid.uuid4())
    statement = f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic evidence delivery proof',created_by FROM public.model_runs WHERE id='{fixture}' RETURNING workspace_id;"
    result = subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=20)
    if result.returncode:
        raise RuntimeError('Owned fixture creation failed')
    workspace = str(uuid.UUID(result.stdout.strip()))
    validation = {'stations_matched':1,'median_ape':20,'max_ape':20,'validation_rules_version':4,'model_validation_assessment':{'scientific_outcome':'inconclusive'}}
    sys.path.insert(0,str(REPO/'workers/aequilibrae_worker'))
    from worker_import_for_tests import import_worker_main
    worker = import_worker_main()
    calls = []
    with gateway('public', database=meta['database']) as connection:
        headers = {'Authorization':'Bearer '+connection['service_token']}
        worker.SUPABASE_URL = connection['url']
        worker.HEADERS = headers
        drop = False
        def transport(method):
            def send(url, **kwargs):
                prefix = connection['url']+'/rest/v1/'
                if not url.startswith(prefix):
                    raise AssertionError('Unexpected proof destination')
                response = requests.request(method,connection['url']+'/'+url[len(prefix):],**kwargs)
                calls.append({'method':method,'table':url[len(prefix):].split('?')[0],'status':response.status_code})
                if drop and method == 'POST' and 'modeling_claim_decisions' in url:
                    response.close()
                    raise requests.Timeout('Synthetic reply lost after native commit')
                return response
            return send
        worker.requests = types.SimpleNamespace(post=transport('POST'),delete=transport('DELETE'))
        def rows(table):
            response=requests.get(connection['url']+'/'+table,headers=headers,params={'model_run_id':'eq.'+run,'select':'*','order':'id'},timeout=15)
            if response.status_code!=200:
                raise AssertionError('Native evidence read failed')
            return response.json()
        worker.write_model_run_modeling_evidence(run,workspace,validation,track='behavioral_demand')
        original_metrics=rows('modeling_validation_results')
        original_claim=rows('modeling_claim_decisions')
        if len(original_metrics)!=2 or len(original_claim)!=1 or original_claim[0]['claim_status']!='prototype_only':
            raise AssertionError('Native baseline evidence differs')
        baseline_calls=list(calls)
        calls.clear()
        try:
            worker.write_model_run_modeling_evidence(run,str(uuid.uuid4()),validation,track='behavioral_demand')
        except worker.WorkerStateWriteUnconfirmed:
            pass
        else:
            raise AssertionError('Native rejected write reported success')
        if len(calls)!=1 or calls[0]['status'] not in (400,403,409):
            raise AssertionError('Rejected write continued or rejection not observed')
        if rows('modeling_validation_results')!=original_metrics or rows('modeling_claim_decisions')!=original_claim:
            raise AssertionError('Rejected claim changed retained evidence')
        rejection_calls=list(calls)
        calls.clear()
        drop=True
        try:
            worker.write_model_run_modeling_evidence(run,workspace,None,track='behavioral_demand')
        except worker.WorkerStateWriteUnconfirmed:
            pass
        else:
            raise AssertionError('Lost native reply reported success')
        if len(calls)!=1 or calls[0]['status'] not in (200,201):
            raise AssertionError('Commit was not observed or later writes continued')
        changed_claim=rows('modeling_claim_decisions')
        if changed_claim[0]['validation_summary_json']==original_claim[0]['validation_summary_json']:
            raise AssertionError('Dropped-reply claim did not commit')
        if rows('modeling_validation_results')!=original_metrics:
            raise AssertionError('Lost reply continued to delete metrics')
        dropped_calls=list(calls)
    evidence={'run_id':run,'baseline_calls':baseline_calls,'native_rejection_calls':rejection_calls,'drop_after_commit_calls':dropped_calls,'rejection_preserved_claim_and_metrics':True,'lost_reply_stopped_before_metric_delete':True,'claim_committed_before_reply_drop':True,'scope':'Actual worker helper and isolated PostgREST. Transport drops reply after real successful HTTP response. No actual socket interruption, normal dispatcher, automatic recovery, atomic publication, Storage or scientific model executed. Lost reply intentionally leaves changed claim and prior metrics, demonstrating the remaining atomicity gap.'}
    (output/'native-evidence-delivery.json').write_text(json.dumps(evidence,indent=2)+'\n')
    return evidence

if __name__=='__main__':
    print(json.dumps(check(),indent=2))
