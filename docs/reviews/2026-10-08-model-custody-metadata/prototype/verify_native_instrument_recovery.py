"""Recover an exact instrument receipt without reopening a stopped attempt."""
import json,os,subprocess,sys,uuid
from pathlib import Path
import model_command_client as client
import model_command_journal as journal
from model_attempt_invocation import ReconciliationRequired


def verify(writer, publish, *, output, sql, database, base, key):
    control=os.environ.get('OPENPLAN_INSTRUMENT_RECOVERY_CONTROL','normal')
    assert control in ('normal','harmless','bypass-stop','wrong-request','restored')
    method=os.environ.get('OPENPLAN_INSTRUMENT_LOSS_METHOD','aequilibrae')
    assert method in ('aequilibrae','activitysim')
    count=6 if method=='aequilibrae' else 12
    method_count=count//6
    committed=[]
    original=writer.post
    def lose(url,**kwargs):
        response=original(url,**kwargs)
        if url.endswith('/record_model_attempt_instrument') and kwargs['json']['p_payload']['demand_method']==method and not committed:
            assert response.status_code==200, 'Instrument command did not commit'
            committed.append(response.json());response.close()
            raise TimeoutError('Synthetic lost instrument reply after native commit')
        return response
    writer.post=lose
    try: publish()
    except client.DeliveryUnconfirmed: pass
    else: raise AssertionError('Instrument publication did not stop after lost reply')
    assert writer.stopped and len(committed)==1, 'Lost instrument reply did not stop writer'
    pending=journal.pending(writer.directory,writer.context.destination)
    assert len(pending)==1 and pending[0]['command']['operation']=='record_model_attempt_instrument'
    command=pending[0]['command']
    assert command['arguments']['attempt_id']==writer.context.attempt_id
    assert sql(database,f"SELECT count(*) FROM public.model_run_artifacts WHERE stage_id='{writer.context.stage_id}';")==str(count)
    assert sql(database,f"SELECT count(*) FROM public.model_attempt_instrument_custody WHERE model_run_id='{writer.context.run_id}';")==str(method_count)
    if control=='bypass-stop': writer.require_open=lambda:None
    try: writer.patch_stage(writer.context.stage_id,{'status':'succeeded'})
    except ReconciliationRequired: pass
    else: raise AssertionError('Stopped writer accepted later stage completion')
    assert sql(database,f"SELECT status FROM public.model_run_stages WHERE id='{writer.context.stage_id}';")=='running'
    tables=('public.model_runs','public.model_run_stages','public.model_stage_attempts',
            'public.model_run_artifacts','public.model_attempt_instrument_custody',
            'public.model_attempt_instrument_receipts','public.model_artifact_write_receipts',
            'public.model_stage_write_receipts','storage.objects')
    def snapshot():
        return {table:sql(database,f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM {table} t;") for table in tables}
    before=snapshot()
    worker=Path(__file__).resolve().parents[4]/'workers/aequilibrae_worker'
    code='''
import json,os,sys
config=json.load(sys.stdin)
sys.path.insert(0,config['worker'])
import requests
original=requests.post
base=config['base']
def post(url,**kwargs):
    assert url.startswith(base+'/rest/v1/')
    return original(base+url.removeprefix(base+'/rest/v1'),**kwargs)
requests.post=post
os.environ['SUPABASE_SERVICE_ROLE_KEY']=config['key']
import model_command_recovery
raise SystemExit(model_command_recovery.main(['--journal',config['journal'],'--base-url',base,
    '--deployment-id',config['database'],'--request-id',config['request']]))
'''
    config={'worker':str(worker),'base':base,'key':key,'journal':str(writer.directory),'database':database,
            'request':str(uuid.uuid4()) if control=='wrong-request' else command['request_id']}
    result=subprocess.run([sys.executable,'-B','-c',code],input=json.dumps(config),capture_output=True,text=True,timeout=30)
    (output/'instrument-recovery.log').write_text(result.stdout+result.stderr)
    assert result.returncode==0, 'Fresh instrument recovery failed'
    recovered=json.loads(result.stdout)
    assert recovered['outcome']=='command_receipt_retained' and recovered['model_resumed'] is False
    assert snapshot()==before, 'Instrument recovery changed native records or object metadata'
    assert journal.pending(writer.directory,writer.context.destination)==[]
    retained=journal.read_existing(writer.directory,writer.context.destination,command['request_id'])[0]
    assert retained['resolved'] and retained['response']==committed[0], 'Recovered instrument receipt differs'
    assert writer.stopped, 'Instrument recovery reopened the attempt'
    return {'control':'native-instrument-recovery','native_storage_uploaded':True,
            'loss_method':method,'separate_methods':method_count,'attempt_bound_artifacts':count,'exact_receipts_reused':True,
            'fresh_process_receipt_recovered':True,'native_tables_unchanged':len(tables),
            'later_completion_refused':True,'execution_resumed':False,
            'limits':'Recovery of one exact method receipt; no stage continuation or scientific acceptance'}
