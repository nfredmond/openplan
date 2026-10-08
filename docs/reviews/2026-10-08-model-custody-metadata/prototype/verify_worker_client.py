"""Synthetic committed database proof, with a dropped receipt after real HTTP."""
from pathlib import Path
import json, subprocess, sys, uuid, re, os
import requests
repo=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(repo/'workers/aequilibrae_worker'))
sys.path.insert(0,str(repo/'docs/reviews/2026-10-08-model-custody-metadata/prototype'))
import model_command_client as client
import model_command_journal as journal
from isolated_postgrest import gateway
meta=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',meta['database'])
assert meta['container']=='supabase_db_openplan-restore-target-2026091050'
def sql(s):
 r=subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=s,text=True,capture_output=True,timeout=20)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()
root=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
root.mkdir(mode=0o700,parents=True,exist_ok=True)
results=[]
with gateway('public',database=meta['database']) as connection:
 base=connection['url']; key=connection['service_token']
 for terminal in ('succeeded','failed'):
  run,stage=[str(uuid.uuid4()) for _ in range(2)]
  sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic command-client proof',created_by FROM public.model_runs WHERE id='{meta['fixture_run']}'; INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic command proof','queued',1);")
  destination=client.destination(base,meta['database'])
  directory=root/run
  def execute(operation,args):
   command={'request_id':str(uuid.uuid4()),'destination':destination,'operation':operation,'arguments':args}
   seen=[]
   def post(url,**kwargs):
    assert url==base+'/rest/v1/rpc/'+operation
    seen.append(kwargs['json'])
    # The isolated PostgREST has no Supabase gateway prefix. This adapter only
    # removes that prefix; requests still delivers the actual body over HTTP.
    response=requests.post(base+'/rpc/'+operation,**kwargs)
    if len(seen)==1:
     assert response.status_code==200, (operation,response.status_code)
     response.close()
     raise TimeoutError('Synthetic lost acknowledgement after committed HTTP response')
    return response
   try: client.deliver(directory,command,base_url=base,deployment_id=meta['database'],service_key=key,post=post)
   except client.DeliveryUnconfirmed: pass
   else: raise AssertionError('First reply was not lost')
   retained=journal.pending(directory,destination)
   assert len(retained)==1 and retained[0]['command']==command
   result=client.deliver(directory,retained[0]['command'],base_url=base,deployment_id=meta['database'],service_key=key,post=post)
   assert client.deliver(directory,command,base_url=base,deployment_id=meta['database'],service_key=key,post=post)==result
   assert len(seen)==2 and seen[0]==seen[1] and not journal.pending(directory,destination)
   return result
  claim=execute('claim_model_stage_attempt',{'run_id':run,'stage_id':stage,'worker_id':'synthetic-command-client'})
  attempt=claim['attempt_id']
  artifact=execute('write_model_attempt_artifact',{'run_id':run,'stage_id':stage,'attempt_id':attempt,'payload':{'artifact_type':'synthetic','file_url':'local://synthetic','content_hash':'a'*64,'file_size_bytes':7}})
  kpis=[]
  for value in (None,0,1.25):
   kpis.append(execute('write_model_attempt_kpi',{'run_id':run,'stage_id':stage,'attempt_id':attempt,'payload':{'kpi_name':'synthetic_'+str(value),'kpi_label':'Synthetic quantity','value':value}}))
  assert [row['value'] for row in kpis]==[None,0,1.25]
  assert sql(f"SELECT count(*) FROM public.model_run_kpis WHERE run_id='{run}';")=='3'
  write=execute('write_model_stage_attempt',{'run_id':run,'stage_id':stage,'attempt_id':attempt,'status':terminal,'log_tail':'Synthetic command-client proof','error':'Synthetic failure' if terminal=='failed' else None})
  assert write['run_status']==terminal
  for table,where in [('model_stage_attempts',f"run_id='{run}'"),('model_run_artifacts',f"run_id='{run}'"),('model_stage_write_receipts',f"response_payload->>'stage_id'='{stage}'")]:
   assert sql(f'SELECT count(*) FROM public.{table} WHERE {where};')=='1'
  results.append({'run':run,'terminal':terminal,'attempt':attempt,'artifact':artifact['id'],'six_commands_with_lost_ack':True,'kpi_values':[row['value'] for row in kpis],'post_per_command':2,'exact_retry_preserved':True,'single_attempt_artifact_completion':True})
(root/'native.json').write_text(json.dumps({'database':meta['database'],'boundary':'Actual installed migration and authenticated PostgREST; injected transport loses reply after committed HTTP response. Not process crash, TCP disconnect, normal dispatcher, or Storage byte verification. Synthetic rows retained in owned proof database.','cases':results},indent=2)+'\n')
print(json.dumps(results,indent=2))
