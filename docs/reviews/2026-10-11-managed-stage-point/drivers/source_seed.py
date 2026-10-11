"""Seed native managed admission/progress and capture the owned stopped-writer point."""
from contextlib import closing
import hashlib,importlib.util,json,os,shutil,sqlite3,subprocess,sys,time,uuid
from pathlib import Path
import transport,seed_guards as guard
OUT=Path(__file__).parent;POINT=OUT.parent;BASE=POINT.parent
REPO=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009');ROLE=POINT/'source-cluster';API=POINT/'source-api-02'
sys.path.insert(0,str(REPO/'workers/aequilibrae_worker'))
import model_attempt_invocation as invocation,model_attempt_writer as managed
import model_command_client as client,model_command_journal as journal
record={'state':'prepared','events':[],'commands':[],'scientificAcceptance':'unassessed'};keepers=[];callbacks={'claim':0,'progress':0};writers=[]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
sys.path.append(str(BASE/'transit-coordinated-restore-20261011-03'))
saved_transport=sys.modules['transport']
try:
 sys.modules['transport']=load('stagepoint_image_transport',BASE/'transit-coordinated-restore-20261011-03/transport.py')
 image=load('stagepoint_full_image',BASE/'transit-coordinated-restore-20261011-03/run.py');image.OUT=OUT
finally:sys.modules['transport']=saved_transport
files=load('stagepoint_files',BASE/'probe_worker_file_backup.py')
root=load('stagepoint_root',REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
def save():(OUT/'progress-private.json').write_text(json.dumps(record,indent=2)+'\n')
def command(args,label,timeout=90,env=None):
 r=subprocess.run(args,capture_output=True,timeout=timeout,env=env);(OUT/(label+'-private.log')).write_bytes(r.stdout+r.stderr);record['commands'].append({'name':label,'exitCode':r.returncode});save();r.check_returncode();return r.stdout

def main():
 os.umask(0o077);started=time.monotonic()
 preflight=json.loads((POINT/'read-preflight.json').read_text());expected=preflight['observed']['helperHashes']
 head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO).decode().strip();changed=bool(subprocess.check_output(['git','status','--porcelain','--','openplan','workers'],cwd=REPO).strip())
 guard.verify_source(head,changed,{name:files.digest(REPO/name) for name in expected},expected)
 sys.path.insert(0,str(API));import services,network_scope
 native_guard=load('stagepoint_database_guard',ROLE/'guards.py');archive=load('stagepoint_archive',REPO/'openplan/scripts/ops/full_restore.py')
 receipt=json.loads((ROLE/'container-receipt.json').read_text());rest=json.loads((API/'source-rest-receipt-private.json').read_text());connection=json.loads((API/'source-rest-connection-private.json').read_text());database=connection['database'];image.CONTAINER=receipt['id']
 def verify_database():network_scope.verify_database_attachment(services.inspect(receipt['id']),receipt,'openplan_stagepoint_source_20261011_01',ROLE/'mounted-root-private.key',native_guard.verify_container,True)
 verify_database();services.verify_new('rest',services.inspect(rest['id']),rest,database,Path('/unused'),Path('/unused'))
 record.update(sourceDatabaseId=receipt['id'],sourceDatabase=database,sourceRestId=rest['id'],sourceHead='93b052a2ee3a8f8232510fbd478208722014fa7f',executionSourceSha256={f.name:files.digest(f) for f in OUT.glob('*.py')},helperSourceSha256=expected);save()
 original_point=BASE/'coordinated-worker-point-20261011-01/cut-source-03';base_bundle=original_point/'point-private';census=json.loads((original_point/'coordinated-point-file-inventory-private.json').read_text());files.equal(census,files.inventory(base_bundle))
 before=image.inventory(database,'source-before-managed-seed');image.equal_image(json.loads((original_point/'captured-native-image-private.json').read_text()),before)
 before_models=json.loads(image.sql(database,"SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.models m"))
 source_scope=json.loads((base_bundle/'configuration-private/model-worker-source-scope-private.json').read_text());template=source_scope['pendingCommand']['arguments']['run_id']
 cases={name:{'run':str(uuid.uuid4()),'stage':str(uuid.uuid4())} for name in ('claim','progress')};record['cases']=cases;save()
 for name,ids in cases.items():
  query="INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '"+ids['run']+"',workspace_id,model_id,engine_key,'queued','Synthetic managed point "+name+"',created_by FROM public.model_runs WHERE id='"+template+"';INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order,log_tail) VALUES('"+ids['stage']+"','"+ids['run']+"','Synthetic managed custody','queued',1,'Synthetic source log');SELECT workspace_id FROM public.model_runs WHERE id='"+ids['run']+"'"
  ids['workspace']=image.sql(database,query).strip();client._uuid(ids['workspace'])
 worker=OUT/'worker-before';worker.mkdir(mode=0o700)
 for name in cases:
  directory=worker/name;directory.mkdir(mode=0o700);keeper=journal.connect(directory);keeper.execute('PRAGMA wal_checkpoint(TRUNCATE)');keeper.execute('PRAGMA wal_autocheckpoint=0');keepers.append(keeper)
 bindings={ids['stage']:{'run':ids['run'],'workspace':ids['workspace']} for ids in cases.values()}
 def admission(name,request):
  with closing(sqlite3.connect((worker/name/'model-commands.sqlite3').resolve().as_uri()+'?mode=ro',uri=True)) as c:return c.execute('SELECT entered FROM execution_admissions WHERE request_id=?',(request,)).fetchone()[0]
 deployment=str(uuid.uuid4());record['deploymentId']=deployment
 with transport.bridge(connection,bindings,{'claim_model_stage_attempt','write_model_stage_attempt'},record['events']) as origin:
  logical_scope={'base_url':origin,'deployment_id':deployment};record['logicalScope']=logical_scope;save()
  def forbidden(ctx):callbacks['claim']+=1;raise RuntimeError('Uncertain claim must not admit callback')
  error=None
  try:invocation.invoke_new_attempt(worker/'claim',**{k+'_id':cases['claim'][k] for k in ('run','stage','workspace')},worker_id='stagepoint-uncertain-claim',**logical_scope,service_key=connection['service_token'],handler=forbidden)
  except client.DeliveryUnconfirmed as e:error=type(e).__name__
  pending=journal.read_existing(worker/'claim',client.destination(**logical_scope));cases['claim']['command']=pending[0]['command'];cases['claim']['admission']=admission('claim',pending[0]['command']['request_id'])
  guard.verify_uncertainty(error,record['events'],'/rest/v1/rpc/claim_model_stage_attempt',callbacks['claim'],cases['claim']['admission'],pending)
  def progress(ctx):
   callbacks['progress']+=1;writer=managed.AttemptWriter(worker/'progress',ctx,**logical_scope,service_key=connection['service_token']);writers.append(writer)
   with managed.bind(writer):
    attempt=writer.workspace(worker/'runs',ctx.run_id);record['attemptWorkspace']=str(attempt.relative_to(worker))
    (attempt/'inputs').mkdir(mode=0o700);(attempt/'outputs').mkdir(mode=0o700);(attempt/'scratch/empty').mkdir(mode=0o700,parents=True)
    (attempt/'inputs/source.bin').write_bytes(bytes(range(256)));(attempt/'outputs/result.json').write_bytes(b'{"synthetic":true,"engine_ran":false}\n')
    writer.patch_stage(ctx.stage_id,{'log_tail':'Synthetic managed progress retained'})
  error=None
  try:invocation.invoke_new_attempt(worker/'progress',**{k+'_id':cases['progress'][k] for k in ('run','stage','workspace')},worker_id='stagepoint-progress',**logical_scope,service_key=connection['service_token'],handler=progress)
  except client.DeliveryUnconfirmed as e:error=type(e).__name__
  saved=journal.read_existing(worker/'progress',client.destination(**logical_scope),include_resolved=True);claim_record=next(r for r in saved if r['command']['operation']=='claim_model_stage_attempt');pending=[r for r in saved if not r['resolved']]
  cases['progress'].update(command=pending[0]['command'],claimCommand=claim_record['command'],claimReceipt=claim_record['response'],admission=admission('progress',claim_record['command']['request_id']))
  later=False
  try:writers[0].require_open()
  except invocation.ReconciliationRequired:later=True
  guard.verify_progress(error,callbacks['progress'],cases['progress']['admission'],writers[0].stopped,later,record['events'],pending)
  record['callbacksBeforeCapture']=callbacks.copy();save()
  for name,ids in cases.items():
   c=ids['command'];table='model_stage_claim_receipts' if name=='claim' else 'model_stage_write_receipts';key=c['request_id']
   query="SELECT jsonb_build_object('receipt',(SELECT to_jsonb(t) FROM public."+table+" t WHERE request_id='"+key+"'),'stage',(SELECT to_jsonb(t) FROM public.model_run_stages t WHERE id='"+ids['stage']+"'),'run',(SELECT to_jsonb(t) FROM public.model_runs t WHERE id='"+ids['run']+"'),'attempt',(SELECT to_jsonb(t) FROM public.model_stage_attempts t WHERE stage_id='"+ids['stage']+"'))"
   server=json.loads(image.sql(database,query));guard.verify_server(c,server,ids['workspace']);client.checked_receipt(c,server['receipt']['response_payload']);ids['server']=server
 services.verify_new('rest',services.inspect(rest['id']),rest,database,Path('/unused'),Path('/unused'));command(['docker','stop','--time','5',rest['id']],'stop-exact-source-rest')
 image.no_sessions(database);after=image.inventory(database,'source-after-managed-seed');guard.verify_native_delta(before,after)
 record.update(state='managed-source-seeded-native-delta-passed',sourceRestStopped=True,sourceWritersStopped=True,callbacksBeforeCapture=callbacks.copy());save()
 # Full capture and original-row checks are supplied by the next local fixture component.
 from capture_source_point import capture
 capture(record,worker,cases,before,after,before_models,logical_scope,original_point,receipt,database,started,image=image,files=files,root=root,archive=archive,command=command,native_guard=native_guard)
 verify_database();command(['docker','stop','--time','10',receipt['id']],'stop-exact-source-database')
 record['sourceDatabaseStopped']=True;save();(OUT/'source-point-result.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({k:record[k] for k in ('state','snapshotId','capturedFiles','capturedBytes','sourceDatabaseStopped')}))
if __name__=='__main__':
 try:main()
 except BaseException as e:record.update(state='failed',errorType=type(e).__name__);save();raise
 finally:
  for keeper in keepers:keeper.close()
