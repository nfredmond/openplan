"""Fresh-process recovery of the committed initial-input artifact command."""
from contextlib import closing
import hashlib,json,os,subprocess,sys,uuid
from pathlib import Path
import model_command_journal as journal
from model_attempt_invocation import ReconciliationRequired


def verify(writer,pending,output,sql,database,base,key,dropped,control):
    command=pending['command'];request=command['request_id']
    assert len(dropped)==1 and dropped[0]['request']['p_request_id']==request
    tables=('model_runs','model_run_stages','model_stage_attempts','model_stage_execution_starts',
            'model_run_artifacts','model_artifact_write_receipts','model_stage_write_receipts')
    def snapshot():
        native={table:sql(database,f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{table} t;") for table in tables}
        with closing(journal.connect(writer.directory)) as connection:
            admissions=connection.execute('SELECT request_id,workspace_id,entered FROM execution_admissions ORDER BY request_id').fetchall()
        files={str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in writer.files.path.rglob('*') if path.is_file()}
        return native,admissions,files
    before=snapshot()
    worker=Path(__file__).resolve().parents[4]/'workers/aequilibrae_worker'
    selected=str(uuid.uuid4()) if control=='wrong-initial-request' else request
    result=subprocess.run([sys.executable,'-B',str(worker/'model_command_recovery.py'),'--journal',str(writer.directory),
        '--base-url',base,'--deployment-id',database,'--request-id',selected],env=dict(os.environ,SUPABASE_SERVICE_ROLE_KEY=key),capture_output=True,text=True,timeout=30)
    (output/'initial-receipt-recovery.log').write_text(result.stdout+result.stderr)
    assert result.returncode==0,'Initial input receipt recovery failed'
    assert json.loads(result.stdout)=={'request_id':request,'outcome':'command_receipt_retained','model_resumed':False}
    assert snapshot()==before,'Initial receipt recovery changed native state, admissions or files'
    saved=journal.read_existing(writer.directory,writer.context.destination,request)[0]
    assert saved['resolved'] and saved['response']==dropped[0]['receipt']
    assert journal.pending(writer.directory,writer.context.destination)==[] and writer.stopped
    try:writer.patch_stage(writer.context.stage_id,{'status':'succeeded'})
    except ReconciliationRequired:pass
    else:raise AssertionError('Recovered initial-input writer resumed')
    assert snapshot()==before
    return {'original_receipt_recovered':True,'fresh_process':True,'native_tables_unchanged':len(tables),
            'execution_admissions_unchanged':True,'files_unchanged':True,'writer_stopped':True,'model_resumed':False}
