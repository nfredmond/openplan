"""Recover two original managed commands, preserving admissions and owned files."""
from contextlib import closing
import hashlib,importlib.util,json,os,shutil,sqlite3,subprocess,sys,time
from pathlib import Path
from urllib.parse import urlsplit
import recovery_guards as check
OUT=Path(__file__).parent;POINT=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/managed-stage-point-20261011-01');BASE=POINT.parent
REPO=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009')
SOURCE=POINT/'source-seed-03';ROLE=POINT/'target-cluster';API=POINT/'target-api'
sys.path.insert(0,str(REPO/'workers/aequilibrae_worker'))
import model_command_client as client,model_command_journal as journal,model_attempt_invocation as invocation
record={'state':'prepared','http':[],'commands':[]};callbacks=[]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
files=load('stage_recovery_files',BASE/'probe_worker_file_backup.py')
root=load('stage_recovery_root',REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
transport=load('stage_recovery_transport',SOURCE/'transport.py')
sourceguard=load('stage_recovery_source_guard',SOURCE/'seed_guards.py')
sys.path.append(str(BASE/'transit-coordinated-restore-20261011-03'))
image=load('stage_recovery_image',BASE/'transit-coordinated-restore-20261011-03/run.py');image.OUT=OUT
def save():(OUT/'progress-private.json').write_text(json.dumps(record,indent=2)+'\n')
def command(args,label):
 r=subprocess.run(args,capture_output=True,timeout=90);(OUT/(label+'-private.log')).write_bytes(r.stdout+r.stderr);record['commands'].append({'name':label,'exitCode':r.returncode});save();r.check_returncode();return r.stdout

def main():
 os.umask(0o077);started=time.monotonic();sys.path.insert(0,str(API));import services,network_scope
 guard=load('stage_recovery_cluster_guard',ROLE/'guards.py');archive=load('stage_recovery_archive',REPO/'openplan/scripts/ops/full_restore.py')
 receipt=json.loads((ROLE/'container-receipt.json').read_text());connection=json.loads((API/'source-rest-connection-private.json').read_text());rest=json.loads((API/'source-rest-receipt-private.json').read_text());database=connection['database'];image.CONTAINER=receipt['id']
 def verify_database():network_scope.verify_database_attachment(services.inspect(receipt['id']),receipt,'openplan_stagepoint_target_20261011_01',ROLE/'mounted-root-private.key',guard.verify_container,True)
 verify_database();services.verify_new('rest',services.inspect(rest['id']),rest,database,Path('/unused'),Path('/unused'))
 record.update(targetDatabaseId=receipt['id'],targetDatabase=database,targetRestId=rest['id'],executionSourceSha256={p.name:files.digest(p) for p in OUT.glob('*.py')});save()
 bundle=BASE/'worker-root-snapshot-20261011/native-packages-03/runtime-point-private';protected=bundle/'configuration-private';worker=bundle/'managed-stage-worker-private'
 scoped=json.loads((protected/'managed-stage-source-scope-private.json').read_text());scope=scoped['logicalScope'];cases=scoped['cases'];identity=client.destination(**scope)
 source_record=json.loads((SOURCE/'source-point-result.json').read_text());original_census=json.loads((SOURCE/'point-file-inventory-private.json').read_text());census=json.loads((BASE/'worker-root-snapshot-20261011/native-packages-03/runtime-before-private.json').read_text());files.equal(census,files.inventory(bundle));files.equal(original_census,files.inventory(SOURCE/'point-private'))
 expected_root=root.inventory(BASE/'worker-root-snapshot-20261011/native-packages-03/packages-private/managed-stage-worker-private/root');root.equal_root(expected_root,root.inventory(worker));logical=json.loads((protected/'managed-stage-logical-journals-private.json').read_text())
 for name in cases:root.equal_journal(logical[name],root.sqlite_image(worker/name/'model-commands.sqlite3'))
 baseline=json.loads((SOURCE/'captured-native-image-private.json').read_text());image.equal_image(baseline,image.inventory(database,'target-before-managed-recovery'))
 def server_pair(name,prefix=''):
  ids=cases[name];c=ids['command'];table='model_stage_claim_receipts' if name=='claim' else 'model_stage_write_receipts'
  query="SELECT jsonb_build_object('receipt',(SELECT to_jsonb(t) FROM public."+table+" t WHERE request_id='"+c['request_id']+"'),'stage',(SELECT to_jsonb(t) FROM public.model_run_stages t WHERE id='"+ids['stage']+"'),'run',(SELECT to_jsonb(t) FROM public.model_runs t WHERE id='"+ids['run']+"'),'attempt',(SELECT to_jsonb(t) FROM public.model_stage_attempts t WHERE stage_id='"+ids['stage']+"'))"
  return json.loads(image.sql(database,prefix+query+(';ROLLBACK;' if prefix else '')))
 native={}
 for name,ids in cases.items():
  native[name]=server_pair(name);sourceguard.verify_server(ids['command'],native[name],ids['workspace']);sourceguard.verify_original_rows(ids['server'],native[name]);client.checked_receipt(ids['command'],native[name]['receipt']['response_payload'])
  table='model_stage_claim_receipts' if name=='claim' else 'model_stage_write_receipts';prefix="BEGIN;SET LOCAL session_replication_role=replica;DELETE FROM public."+table+" WHERE request_id='"+ids['command']['request_id']+"';"
  try:sourceguard.verify_server(ids['command'],server_pair(name,prefix),ids['workspace'])
  except ValueError as error:sourceguard.verify_original_rows('stagepoint-native-command-pair-missing',str(error))
  else:raise AssertionError('Missing native receipt survived')
  sourceguard.verify_original_rows(native[name],server_pair(name))
 # Feed rollback-only native snapshots through the existing ownership reader.
 # This tests its exact projection and status interpretation, not a live lease.
 ownership_controls=[]
 class NativeSnapshot:
  status_code=200
  def __init__(self,rows):self.rows=rows
  def json(self):return self.rows
  def close(self):pass
 for name,ids in cases.items():
  claim=ids.get('claimCommand',ids['command']);claim_receipt=ids.get('claimReceipt',native[name]['receipt']['response_payload'])
  query="SELECT jsonb_build_array(jsonb_build_object('id',s.id,'run_id',s.run_id,'status',s.status,'attempt_managed',s.attempt_managed,'active_attempt_id',s.active_attempt_id,'model_runs',jsonb_build_object('id',r.id,'workspace_id',r.workspace_id,'status',r.status,'attempt_managed',r.attempt_managed))) FROM public.model_run_stages s JOIN public.model_runs r ON r.id=s.run_id WHERE s.id='"+ids['stage']+"' AND r.id='"+ids['run']+"' AND r.workspace_id='"+ids['workspace']+"'"
  def projected(prefix=''):
   rows=json.loads(image.sql(database,prefix+query+(';ROLLBACK;' if prefix else '')))
   def get(url,**kwargs):
    expected={'id':'eq.'+ids['stage'],'run_id':'eq.'+ids['run'],'model_runs.workspace_id':'eq.'+ids['workspace'],'select':transport.PROJECTIONS[0]}
    sourceguard.verify_original_rows(expected,kwargs['params']);return NativeSnapshot(rows)
   return client.inspect_ownership(claim,claim_receipt,workspace_id=ids['workspace'],**scope,service_key=connection['service_token'],get=get)
  sourceguard.verify_original_rows(True,projected()['owns_stage'])
  for kind,update in [('cancelled-parent',"UPDATE public.model_runs SET status='cancelled' WHERE id='"+ids['run']+"';"),('inactive-attempt',"UPDATE public.model_run_stages SET active_attempt_id=NULL WHERE id='"+ids['stage']+"';")]:
   sourceguard.verify_original_rows(False,projected('BEGIN;SET LOCAL session_replication_role=replica;'+update)['owns_stage']);sourceguard.verify_original_rows(True,projected()['owns_stage']);ownership_controls.append({'case':name,'mutation':kind,'rollbackOnly':True,'ownsStageFalse':True,'restoredOwnsStageTrue':True})
 (OUT/'native-ownership-projection-controls.json').write_text(json.dumps({'cases':ownership_controls,'scope':'Existing reader consumes native rollback-only projected snapshots with exact field/filter assertion. No live lease replacement, concurrent revocation or authorization to continue.'},indent=2)+'\n')
 (OUT/'native-missing-receipt-controls.json').write_text(json.dumps({'claimAndProgressRollbackRefused':True,'restoredExactServerPairs':True,'scope':'Native rollback-only missing receipt, not external-service loss or revocation.'},indent=2)+'\n')
 def admissions(name):
  c=cases[name].get('claimCommand',cases[name]['command'])
  with closing(sqlite3.connect((worker/name/'model-commands.sqlite3').resolve().as_uri()+'?mode=ro',uri=True)) as db:rows=[list(r) for r in db.execute('SELECT request_id,workspace_id,entered FROM execution_admissions ORDER BY request_id')]
  check.verify_admission(rows,c['request_id'],cases[name]['workspace'],cases[name]['admission']);return rows
 before_admissions={name:admissions(name) for name in cases}
 def checkpoint(name):
  with closing(sqlite3.connect(worker/name/'model-commands.sqlite3')) as db:record.setdefault('journalCheckpoints',[]).append({'journal':name,'nativeResult':list(db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone())})
 def cli(name,label,action,wrong=False):
  ids=cases[name];args=[sys.executable,'-B',str(REPO/'workers/aequilibrae_worker/model_command_recovery.py'),'--journal',str(worker/name),'--base-url',scope['base_url'],'--deployment-id',scope['deployment_id']+('-other' if wrong else ''),*action]
  r=subprocess.run(args,env={**os.environ,'SUPABASE_SERVICE_ROLE_KEY':connection['service_token']},capture_output=True,timeout=45);(OUT/(name+'-'+label+'-private.log')).write_bytes(r.stdout+r.stderr);return r.returncode,json.loads(r.stdout)
 bindings={ids['stage']:{'run':ids['run'],'workspace':ids['workspace']} for ids in cases.values()}
 with transport.bridge(connection,bindings,set(),record['http'],port=urlsplit(scope['base_url']).port) as origin:
  sourceguard.verify_original_rows(origin,scope['base_url'])
  for name,ids in cases.items():
   request=ids['command']['request_id'];previous=len(record['http']);code,response=cli(name,'wrong-installation',['--request-id',request],True);check.verify_wrong(code,response,record['http'][previous:]);root.equal_journal(logical[name],root.sqlite_image(worker/name/'model-commands.sqlite3'))
   previous=len(record['http']);code,response=cli(name,'original-cli',['--request-id',request]);check.verify_cli(code,response,request)
   source_event=next(e for e in source_record['events'] if e.get('dropped') and e.get('path')=='/rest/v1/rpc/'+ids['command']['operation']);check.verify_exchange(source_event,record['http'][previous:])
   saved=journal.read_existing(worker/name,identity,request);root.equal_journal(saved,[{'command':ids['command'],'response':native[name]['receipt']['response_payload'],'resolved':True}])
   previous=len(record['http']);code,response=cli(name,'cached-cli',['--request-id',request]);check.verify_cli(code,response,request);check.verify_cached(previous,len(record['http']))
   claim=ids.get('claimCommand',ids['command']);refused=False;previous=len(record['http'])
   try:invocation._invoke_fresh_claim(worker/name,claim,workspace_id=ids['workspace'],**scope,service_key=connection['service_token'],handler=lambda ctx:callbacks.append(name))
   except invocation.ReconciliationRequired:refused=True
   check.verify_no_reentry(refused,callbacks);check.verify_cached(previous,len(record['http']));admissions(name)
   code,response=cli(name,'ownership-cli',['--inspect-ownership',claim['request_id'],'--workspace-id',ids['workspace']]);check.verify_ownership(code,response,claim['request_id'],ids['workspace'],ids['run'],ids['stage'],native[name]['attempt']['id'])
 services.verify_new('rest',services.inspect(rest['id']),rest,database,Path('/unused'),Path('/unused'));command(['docker','stop','--time','5',rest['id']],'stop-exact-target-rest');image.no_sessions(database)
 image.equal_image(baseline,image.inventory(database,'target-after-managed-recovery'))
 for name,ids in cases.items():
  sourceguard.verify_original_rows(native[name],server_pair(name));sourceguard.verify_original_rows(before_admissions[name],admissions(name))
  expected=json.loads(json.dumps(logical[name]))
  for row in expected['tables']['commands']:
   if row[0]==ids['command']['request_id']:row[3]=journal.canonical(native[name]['receipt']['response_payload'])
  root.equal_journal(expected,root.sqlite_image(worker/name/'model-commands.sqlite3'));checkpoint(name)
 check.verify_changed_files(expected_root,root.inventory(worker),[name+'/model-commands.sqlite3' for name in cases]);check.verify_changed_files(census,files.inventory(bundle),['managed-stage-worker-private/'+name+'/model-commands.sqlite3' for name in cases]);files.equal(original_census,files.inventory(SOURCE/'point-private'))
 roles=(protected/'roles-private.sql').read_text();guard.verify_roles(json.loads((protected/'roles-inventory-private.json').read_text()),json.loads(archive.role_inventory(receipt['id'])),roles,command(['docker','exec',receipt['id'],'pg_dumpall','-U','supabase_admin','--roles-only'],'target-final-role-dump').decode());guard.verify_properties(json.loads((protected/'database-properties-private.json').read_text()),archive.database_properties(receipt['id'],database));archive._keys.require_mounted_bytes(receipt,archive._keys.read_key(protected/'pgsodium-root-private.key',private=True))
 verify_database();command(['docker','stop','--time','10',receipt['id']],'stop-exact-target-database')
 record.update(state='passed-native-managed-stage-recovery',wallSeconds=round(time.monotonic()-started,3),native374TablesSixSequencesUnchanged=True,originalClaimAndProgressExchangeByteEqual=True,admissionsUnchanged={'claim':0,'progress':1},computationCallbacks=0,reentryRefused=True,ownershipPointInTimeOnly=True,attemptOwnerInputsOutputsEmptyDirectoriesModesPreserved=True,onlyTwoOriginalReceiptsRetainedLocally=True,sourcePointUnchanged=True,targetApiAndDatabaseStopped=True,limits='Synthetic admitted-stage custody on separate local clusters/volumes, same host/disk. No scientific engine, writer reconstruction, normal poller integration, distributed lease, physical-host, browser or hosted acceptance.');save();(OUT/'result.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({k:record[k] for k in ('state','wallSeconds','computationCallbacks','reentryRefused')}))
if __name__=='__main__':
 try:main()
 except BaseException as error:record.update(state='failed',errorType=type(error).__name__);save();raise
