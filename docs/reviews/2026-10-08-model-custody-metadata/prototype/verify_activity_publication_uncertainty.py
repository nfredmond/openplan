"""Observe committed output with a lost HTTP reply, then recover in a new process."""
import json
import os
from pathlib import Path
import subprocess
import sys

import requests
import model_command_journal as journal


def verify_lost_reply(worker, writer, handler, run, stage, corridor, base, key, output, sql, database, control):
    responses=[]
    native_post=writer.post or requests.post
    def lose_output_reply(url, **kwargs):
        response=native_post(url,**kwargs)
        if url.endswith('/write_model_attempt_artifact') and not responses:
            assert response.status_code==200, 'Expected committed native artifact'
            responses.append(response.json())
            response.close()
            raise TimeoutError('Synthetic reply loss after native commit')
        return response
    writer.post=lose_output_reply
    try:
        handler(run,{'id':run,'corridor_geojson':corridor},stage)
    except worker.WorkerStateWriteUnconfirmed:
        pass
    else:
        raise AssertionError('Stage did not stop after lost artifact reply')
    assert writer.stopped and len(responses)==1, 'Uncertain stage writer did not stop'
    pending=journal.pending(writer.directory,writer.context.destination)
    assert len(pending)==1 and pending[0]['command']['operation']=='write_model_attempt_artifact'
    command=pending[0]['command']
    assert command['arguments']['attempt_id']==writer.context.attempt_id
    assert sql(database,f"SELECT count(*) FROM public.model_run_artifacts WHERE stage_id='{stage}';")=='1'
    assert sql(database,f"SELECT count(*) FROM public.model_run_kpis WHERE run_id='{run}';")=='0', 'Stage wrote later KPIs after uncertainty'
    if control=='lost-reply-bypass-stop':
        writer.require_open=lambda:None
    refused=False
    try:
        worker.sb_patch_stage(stage,{'status':'succeeded','log_tail':'Must not publish completion after uncertainty'})
    except worker.WorkerStateWriteUnconfirmed:
        refused=True
    assert refused, 'Stopped writer accepted later terminal write'
    assert sql(database,f"SELECT status FROM public.model_run_stages WHERE id='{stage}';")=='running'
    tables=('model_runs','model_run_stages','model_stage_attempts','model_run_artifacts','model_run_kpis','model_artifact_write_receipts','model_stage_write_receipts')
    def snapshot():
        return {table:sql(database,f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{table} t;") for table in tables}
    before=snapshot()
    recovery=Path(worker.__file__).parents[1]/'aequilibrae_worker/model_command_recovery.py'
    result=subprocess.run([sys.executable,'-B',str(recovery),'--journal',str(writer.directory),'--base-url',base,
        '--deployment-id',database,'--request-id',command['request_id']],
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
    return {'control':'lost-artifact-reply','artifact_committed':True,'later_kpis':0,'terminal_write_refused':True,
        'fresh_process_receipt_recovered':True,'native_tables_unchanged_by_recovery':len(tables),
        'stage_remains_running':True,'execution_resumed':False,'storage_backend':'synthetic HTTP byte service'}
