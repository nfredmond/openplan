"""Exercise the legacy assessment receipt through the owned PostgREST gateway."""
from pathlib import Path
import copy
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
    run, stage, artifact = [str(uuid.uuid4()) for _ in range(3)]
    command = ['docker', 'exec', '-i', meta['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', meta['database'], '-v', 'ON_ERROR_STOP=1']
    def sql(statement):
        result = subprocess.run(command, input=statement, text=True, capture_output=True, timeout=20)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()
    workspace = str(uuid.UUID(sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic assessment receipt proof',created_by FROM public.model_runs WHERE id='{fixture}' RETURNING workspace_id;")))
    sql(f"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic receipt stage','running',1); INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash) VALUES('{artifact}','{run}','{stage}','assigned_link_volumes','storage://run-artifacts/synthetic/{artifact}.csv',2,repeat('a',64));")
    payload = {
        'p_workspace_id': workspace, 'p_model_run_id': run, 'p_stage_id': stage,
        'p_track': 'assignment', 'p_model_output_artifact_id': artifact,
        'p_partition': {'kind': 'synthetic'}, 'p_planning_use': 'Synthetic receipt proof only',
        'p_scientific_outcome': 'inconclusive', 'p_reasons': ['Synthetic evidence is not a scientific result'],
    }
    for kind, schema in [('validation_input', 'openplan.validation-input-bundle.v1'), ('comparison_basis', 'openplan.model-comparison-basis.v1'), ('assessment', 'openplan.model-validation-assessment.v1')]:
        payload.update({f'p_{kind}_file_url': f'storage://run-artifacts/synthetic/{run}/{kind}.json',
                        f'p_{kind}_size': 2, f'p_{kind}_sha256': 'a' * 64,
                        f'p_{kind}_metadata': {'schema': schema, 'comparison_basis_sha256': 'a' * 64}})
    payload['p_assessment_metadata'].update(rules_version=4, scientific_outcome=payload['p_scientific_outcome'], planning_use=payload['p_planning_use'], partition=payload['p_partition'], reasons=payload['p_reasons'])
    sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
    from worker_import_for_tests import import_worker_main
    worker = import_worker_main()
    calls = []
    mode = 'baseline'
    with gateway('public', database=meta['database']) as connection:
        worker.SUPABASE_URL = connection['url']
        worker.HEADERS = {'Authorization': 'Bearer ' + connection['service_token']}
        def send(url, **kwargs):
            expected = connection['url'] + '/rest/v1/rpc/record_modeling_validation_assessment'
            if url != expected:
                raise AssertionError('Unexpected assessment proof destination')
            response = requests.post(connection['url'] + '/rpc/record_modeling_validation_assessment', **kwargs)
            calls.append({'mode': mode, 'status': response.status_code})
            if mode == 'wrong-reply' and response.status_code == 200:
                returned = copy.deepcopy(response.json())
                row = returned[0] if isinstance(returned, list) else returned
                row['model_run_id'] = str(uuid.uuid4())
                response.json = lambda: returned
            if mode == 'lost-reply' and response.status_code == 200:
                response.close()
                raise requests.Timeout('Synthetic reply discarded after committed HTTP response')
            return response
        worker.requests = types.SimpleNamespace(post=send, RequestException=requests.RequestException)
        receipt = worker.sb_record_modeling_validation_assessment(payload)
        rows = json.loads(sql(f"SELECT jsonb_agg(to_jsonb(a)) FROM public.modeling_validation_assessments a WHERE model_run_id='{run}';"))
        if rows != [receipt]:
            raise AssertionError('Native assessment differs from acknowledged receipt')
        for mode in ('wrong-scope', 'wrong-reply', 'lost-reply'):
            candidate = copy.deepcopy(payload)
            if mode == 'wrong-scope':
                candidate['p_workspace_id'] = str(uuid.uuid4())
            before = int(sql(f"SELECT count(*) FROM public.modeling_validation_assessments WHERE model_run_id='{run}';"))
            try:
                worker.sb_record_modeling_validation_assessment(candidate)
            except worker.WorkerStateWriteUnconfirmed:
                pass
            else:
                raise AssertionError('Unconfirmed native assessment reported success: ' + mode)
            after = int(sql(f"SELECT count(*) FROM public.modeling_validation_assessments WHERE model_run_id='{run}';"))
            expected_change = 0 if mode == 'wrong-scope' else 1
            if after != before + expected_change:
                raise AssertionError('Native commit boundary differs: ' + mode)
        if [call['status'] for call in calls] != [200, 400, 200, 200]:
            raise AssertionError('Unexpected native assessment statuses: ' + str(calls))
    evidence = {'run_id': run, 'stage_id': stage, 'acknowledged_assessment_id': receipt['id'], 'calls': calls,
                'scope': 'Actual worker helper, PostgREST and database constraints in the owned proof database. Wrong and lost replies follow actual commits. Response loss is injected after HTTP completion, not a socket interruption. Synthetic artifact references are not Storage uploads or scientific observations. No automatic recovery, idempotent retry, normal dispatcher or scientific acceptance.'}
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    (output / 'assessment-receipt.json').write_text(json.dumps(evidence, indent=2) + '\n')
    return evidence


if __name__ == '__main__':
    print(json.dumps(check(), indent=2))
