"""Check exact restored receipts, admission records and point-in-time ownership."""
def require(value,reason):
 if not value:raise ValueError(reason)
def verify_cli(code,response,request):
 require(code==0 and response=={'request_id':request,'outcome':'command_receipt_retained','model_resumed':False},'stage-recovery-cli-receipt')
def verify_wrong(code,response,events):
 require(code==3 and response=={'outcome':'request_refused','model_resumed':False} and events==[],'stage-recovery-wrong-installation')
def verify_exchange(source,events):
 require(len(events)==1 and events[0].get('method')=='POST' and events[0].get('status')==200 and events[0].get('dropped') is False and all(events[0].get(k)==source.get(k) for k in ('path','requestSha256','responseSha256')),'stage-recovery-original-exchange')
def verify_cached(before,after):
 require(type(before) is int and before==after,'stage-recovery-cached-no-http')
def verify_admission(rows,request,workspace,entered):
 require(rows==[[request,workspace,entered]] and type(rows[0][2]) is int,'stage-recovery-admission-retained')
def verify_no_reentry(refused,callbacks):
 require(refused is True and callbacks==[],'stage-recovery-no-reentry')
def verify_ownership(code,response,request,workspace,run,stage,attempt):
 require(code==0 and response=={'request_id':request,'workspace_id':workspace,'run_id':run,'stage_id':stage,'ownership':{'owns_stage':True,'active_attempt_id':attempt,'stage_status':'running','run_status':'running','stage_managed':True,'run_managed':True},'point_in_time_only':True,'continuation_authorized':False,'model_resumed':False},'stage-recovery-ownership-read-only')
def verify_changed_files(before,after,allowed):
 require(set(before)==set(after) and {k for k in before if before[k]!=after[k]}==set(allowed),'stage-recovery-local-file-delta')
