"""Check synthetic admission, committed command records and bounded native delta."""
def require(value,reason):
 if not value:raise ValueError(reason)
def verify_uncertainty(error,events,path,callback_count,admission,saved):
 require(error=='DeliveryUnconfirmed','stagepoint-delivery-uncertain')
 matching=[row for row in events if row.get('method')=='POST' and row.get('path')==path]
 require(len(matching)==1 and matching[0].get('status')==200 and matching[0].get('dropped') is True,'stagepoint-native-committed-drop')
 require(callback_count==0 and type(callback_count) is int,'stagepoint-uncertain-claim-no-callback')
 require(admission==0 and type(admission) is int,'stagepoint-uncertain-admission-unconsumed')
 require(len(saved)==1 and saved[0].get('resolved') is False and saved[0].get('response') is None,'stagepoint-original-claim-pending')
def verify_progress(error,callback_count,admission,writer_stopped,later_refused,events,pending):
 require(error=='DeliveryUnconfirmed','stagepoint-progress-delivery-uncertain')
 require(callback_count==1 and type(callback_count) is int and admission==1 and type(admission) is int,'stagepoint-progress-admission-consumed-once')
 require(writer_stopped is True and later_refused is True,'stagepoint-progress-writer-stopped')
 matching=[row for row in events if row.get('method')=='POST' and row.get('path')=='/rest/v1/rpc/write_model_stage_attempt']
 require(len(matching)==1 and matching[0].get('status')==200 and matching[0].get('dropped') is True,'stagepoint-progress-committed-drop')
 require(len(pending)==1 and pending[0].get('resolved') is False and pending[0].get('response') is None and pending[0].get('command',{}).get('operation')=='write_model_stage_attempt','stagepoint-original-progress-pending')
def verify_native_delta(before,after):
 expected={'public.model_runs':2,'public.model_run_stages':2,'public.model_execution_custody_enrollment':2,'public.model_stage_attempts':2,'public.model_stage_claim_receipts':2,'public.model_stage_write_receipts':1,'public.models':0,'public.model_stage_execution_starts':2}
 left={r['table']:r for r in before['tables']};right={r['table']:r for r in after['tables']}
 require(set(left)==set(right) and before['sequences']==after['sequences'] and before['schemaSha256']==after['schemaSha256'],'stagepoint-native-structure')
 require({name for name in left if left[name]!=right[name]}==set(expected),'stagepoint-native-changed-tables')
 require(all(right[name]['count']==left[name]['count']+count for name,count in expected.items()),'stagepoint-native-new-row-counts')
def verify_server(command,server,workspace):
 args=command['arguments'];receipt=server.get('receipt');stage=server.get('stage');run=server.get('run');attempt=server.get('attempt')
 require(all(isinstance(row,dict) for row in (receipt,stage,run,attempt)),'stagepoint-native-command-pair-missing')
 require(receipt.get('request_id')==command['request_id'],'stagepoint-native-request-identity')
 expected_request=({'stage_id':args['stage_id'],'worker_id':args['worker_id']} if command['operation']=='claim_model_stage_attempt' else {k:args[k] for k in ('attempt_id','status','log_tail','error')})
 require(receipt.get('request_payload')==expected_request,'stagepoint-native-request-payload')
 response=receipt.get('response_payload');require(isinstance(response,dict),'stagepoint-native-response-payload')
 attempt_id=response.get('attempt_id')
 require(attempt.get('id')==attempt_id and attempt.get('stage_id')==args['stage_id'] and attempt.get('run_id')==args['run_id'] and attempt.get('revoked_at') is None,'stagepoint-native-attempt-identity')
 require(stage.get('id')==args['stage_id'] and stage.get('run_id')==args['run_id'] and stage.get('active_attempt_id')==attempt_id and stage.get('attempt_managed') is True and stage.get('status')=='running','stagepoint-native-stage-owned')
 require(run.get('id')==args['run_id'] and run.get('workspace_id')==workspace and run.get('attempt_managed') is True and run.get('status')=='running','stagepoint-native-parent-owned')
 if command['operation']=='write_model_stage_attempt':require(stage.get('log_tail')==args['log_tail'] and stage.get('error_message')==args['error'] and stage.get('completed_at') is None,'stagepoint-native-progress-effect')

def verify_original_rows(expected,actual):
 require(expected==actual,'stagepoint-original-row-images')
def verify_model_touch(before,after,model_id,timestamp):
 expected=[{**row,'updated_at':timestamp} if row['id']==model_id else row for row in before]
 require(any(row['id']==model_id and row['updated_at']!=timestamp for row in before) and sorted(expected,key=lambda r:r['id'])==sorted(after,key=lambda r:r['id']),'stagepoint-selected-model-timestamp-only')

def verify_source(head,changed,actual_helpers,expected_helpers):
 require(head=='93b052a2ee3a8f8232510fbd478208722014fa7f' and changed is False,'stagepoint-production-source')
 require(actual_helpers==expected_helpers and bool(expected_helpers),'stagepoint-production-helpers')

def verify_starts(rows,expected):
 keys={'stage_id','run_id','boundary','observed_at','after_stage_start'}
 require(type(rows) is list and len(rows)==len(expected) and all(type(r) is dict and set(r)==keys and r['boundary']=='queued_to_running' and type(r['observed_at']) is str and bool(r['observed_at']) and r['after_stage_start'] is True for r in rows) and sorted((r['stage_id'],r['run_id']) for r in rows)==sorted(expected),'stagepoint-native-execution-starts')
