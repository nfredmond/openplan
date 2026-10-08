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
from packet_integrity import build_custody_payload, ARTIFACT_TYPES, _rules
from test_packet_integrity import fixture, encoded, digest
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
  workspace=sql(f"SELECT workspace_id FROM public.model_runs WHERE id='{run}';")
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
  instruments=[]
  for method in ('aequilibrae','activitysim'):
   files=fixture(method)
   basis=json.loads(files['comparison_basis']); basis['model_run_id']=run; files['comparison_basis']=encoded(basis)
   assessment=json.loads(files['assessment']); assessment['exact_inputs']['comparison_basis_sha256']=_rules.sha256_payload(basis); files['assessment']=encoded(assessment)
   diagnosis=json.loads(files['diagnosis']); diagnosis['bindings']['comparison_basis_sha256']=digest(files['comparison_basis']); diagnosis['bindings']['assessment_sha256']=digest(files['assessment']); files['diagnosis']=encoded(diagnosis)
   refs={}; receipts={}
   for role,data in files.items():
    if role=='observation_package': continue
    # Deliberately unuploaded synthetic references. This tests database command
    # custody, never Storage contents, model accuracy or preparation ordering.
    refs[role]=f'storage://run-artifacts/{run}/synthetic-{method}-{role}'
    metadata={'demand_method':method} if role=='model_output' else json.loads(data)
    if role=='assessment': metadata={**metadata,'demand_method':method}
    payload={'artifact_type':ARTIFACT_TYPES.get(role) or ('link_volumes' if method=='aequilibrae' else 'activitysim_link_volumes'),'file_url':refs[role],'file_size_bytes':len(data),'content_hash':digest(data),'metadata_json':metadata}
    receipts[role]=execute('write_model_attempt_artifact',{'run_id':run,'stage_id':stage,'attempt_id':attempt,'payload':payload})
   payload=build_custody_payload(files,receipts,model_run_id=run,stage_id=stage,attempt_id=attempt,demand_method=method,storage_refs=refs)
   instruments.append(execute('record_model_attempt_instrument',{'workspace_id':workspace,'run_id':run,'stage_id':stage,'attempt_id':attempt,'payload':payload}))
  assert [r['demand_method'] for r in instruments]==['aequilibrae','activitysim']
  assert len({r['id'] for r in instruments})==2
  assert sql(f"SELECT count(*) FROM public.model_attempt_instrument_custody WHERE model_run_id='{run}';")=='2'
  write=execute('write_model_stage_attempt',{'run_id':run,'stage_id':stage,'attempt_id':attempt,'status':terminal,'log_tail':'Synthetic command-client proof','error':'Synthetic failure' if terminal=='failed' else None})
  assert write['run_status']==terminal
  for table,where in [('model_stage_attempts',f"run_id='{run}'"),('model_stage_write_receipts',f"response_payload->>'stage_id'='{stage}'")]:
   assert sql(f'SELECT count(*) FROM public.{table} WHERE {where};')=='1'
  assert sql(f"SELECT count(*) FROM public.model_run_artifacts WHERE run_id='{run}';")=='13'
  results.append({'run':run,'terminal':terminal,'attempt':attempt,'artifact':artifact['id'],'twenty_commands_with_lost_ack':True,'instrument_methods':[r['demand_method'] for r in instruments],'artifact_count':13,'kpi_values':[row['value'] for row in kpis],'post_per_command':2,'exact_retry_preserved':True,'single_attempt_and_completion':True})
(root/'native.json').write_text(json.dumps({'database':meta['database'],'boundary':'Actual installed migration and authenticated PostgREST; injected transport loses reply after committed HTTP response. Not process crash, TCP disconnect, normal dispatcher, Storage byte verification, model accuracy or preparation ordering. Instrument references are unuploaded synthetic fixtures. Synthetic rows retained in owned proof database.','cases':results},indent=2)+'\n')
print(json.dumps(results,indent=2))
