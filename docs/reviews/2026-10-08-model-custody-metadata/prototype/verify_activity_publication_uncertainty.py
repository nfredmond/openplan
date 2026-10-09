"""Observe committed output with a lost HTTP reply, then recover in a new process."""
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

import requests
import model_command_journal as journal


def verify_lost_reply(worker, writer, handler, run, stage, corridor, base, key, output, sql, database, control):
    boundary=os.environ.get('OPENPLAN_PUBLICATION_LOSS_BOUNDARY','artifact')
    assert boundary in ('artifact','progress','kpi','terminal')
    operation={'artifact':'write_model_attempt_artifact','kpi':'write_model_attempt_kpi',
               'progress':'write_model_stage_attempt','terminal':'write_model_stage_attempt'}[boundary]
    responses=[]
    native_post=writer.post or requests.post
    def lose_output_reply(url, **kwargs):
        response=native_post(url,**kwargs)
        selected=url.endswith('/'+operation)
        if boundary in ('progress','terminal'):
            selected=selected and kwargs['json'].get('p_status')==('running' if boundary=='progress' else 'succeeded')
        if selected and not responses:
            assert response.status_code==200, 'Expected committed native command'
            responses.append(response.json())
            response.close()
            raise TimeoutError('Synthetic reply loss after native commit')
        return response
    writer.post=lose_output_reply
    try:
        result=handler(run,{'id':run,'corridor_geojson':corridor},stage)
        if boundary=='terminal':
            worker.sb_patch_stage(stage,{'status':'succeeded','log_tail':result['log']})
    except worker.WorkerStateWriteUnconfirmed:
        pass
    else:
        raise AssertionError('Stage did not stop after lost command reply')
    assert writer.stopped and len(responses)==1, 'Uncertain stage writer did not stop'
    pending=journal.pending(writer.directory,writer.context.destination)
    assert len(pending)==1 and pending[0]['command']['operation']==operation
    command=pending[0]['command']
    assert command['arguments']['attempt_id']==writer.context.attempt_id
    artifact_count=0 if boundary=='progress' else 1
    kpi_count={'progress':0,'artifact':0,'kpi':1,'terminal':4}[boundary]
    assert sql(database,f"SELECT count(*) FROM public.model_run_artifacts WHERE stage_id='{stage}';")==str(artifact_count)
    assert sql(database,f"SELECT count(*) FROM public.model_run_kpis WHERE run_id='{run}';")==str(kpi_count), 'Stage wrote later KPIs after uncertainty'
    if control=='lost-reply-bypass-stop':
        writer.require_open=lambda:None
    refused=False
    try:
        worker.sb_patch_stage(stage,{'status':'succeeded','log_tail':'Must not publish completion after uncertainty'})
    except worker.WorkerStateWriteUnconfirmed:
        refused=True
    assert refused, 'Stopped writer accepted later terminal write'
    expected_state='succeeded' if boundary=='terminal' else 'running'
    assert sql(database,f"SELECT status FROM public.model_run_stages WHERE id='{stage}';")==expected_state
    assert sql(database,f"SELECT status FROM public.model_runs WHERE id='{run}';")==expected_state
    tables=('model_runs','model_run_stages','model_stage_attempts','model_run_artifacts','model_run_kpis','model_artifact_write_receipts','model_stage_write_receipts','model_kpi_write_receipts')
    def snapshot():
        return {table:sql(database,f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{table} t;") for table in tables}
    before=snapshot()
    recovery=Path(worker.__file__).parents[1]/'aequilibrae_worker/model_command_recovery.py'
    result=subprocess.run([sys.executable,'-B',str(recovery),'--journal',str(writer.directory),'--base-url',base,
        '--deployment-id',database,'--request-id',str(uuid.uuid4()) if control=='lost-reply-wrong-request' else command['request_id']],
        env={**os.environ,'SUPABASE_SERVICE_ROLE_KEY':key},text=True,capture_output=True,timeout=30)
    (output/'recovery.log').write_text(result.stdout+result.stderr)
    assert result.returncode==0, 'Fresh recovery process failed'
    recovered=json.loads(result.stdout)
    assert recovered['outcome']=='command_receipt_retained' and recovered['model_resumed'] is False
    assert snapshot()==before, 'Receipt recovery changed native records'
    assert journal.pending(writer.directory,writer.context.destination)==[]
    retained=journal.read_existing(writer.directory,writer.context.destination,command['request_id'])[0]
    assert retained['resolved'] and retained['response']==responses[0], 'Recovered receipt differs from committed response'
    assert writer.stopped, 'Receipt recovery reopened execution'
    return {'control':'lost-'+boundary+'-reply','artifact_count':artifact_count,'kpi_count':kpi_count,'terminal_write_refused':True,
        'fresh_process_receipt_recovered':True,'native_tables_unchanged_by_recovery':len(tables),
        'stage_status':expected_state,'execution_resumed':False,'storage_backend':'synthetic HTTP byte service'}
