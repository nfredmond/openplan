"""Exercise existing ownership predicates against native rollback-only snapshots."""
import ast,copy,hashlib,importlib.util,json,sys
from pathlib import Path
def run(database,sql,out,repo,*,protected_path):
 sys.path.insert(0,str(repo/'workers/aequilibrae_worker'));import model_command_client as client
 spec=importlib.util.spec_from_file_location('ownership_source_guard',out.parent/'source-seed-03/seed_guards.py');guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
 scope=json.loads((protected_path/'managed-stage-source-scope-private.json').read_text());raw=Path(client.__file__).read_bytes();tree=ast.parse(raw);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='inspect_ownership');records=[]
 class Response:
  status_code=200
  def __init__(self,rows):self.rows=rows
  def json(self):return self.rows
  def close(self):pass
 for name,ids in scope['cases'].items():
  claim=ids.get('claimCommand',ids['command']);receipt=ids.get('claimReceipt',ids['server']['receipt']['response_payload'])
  query="SELECT jsonb_build_array(jsonb_build_object('id',s.id,'run_id',s.run_id,'status',s.status,'attempt_managed',s.attempt_managed,'active_attempt_id',s.active_attempt_id,'model_runs',jsonb_build_object('id',r.id,'workspace_id',r.workspace_id,'status',r.status,'attempt_managed',r.attempt_managed))) FROM public.model_run_stages s JOIN public.model_runs r ON r.id=s.run_id WHERE s.id='"+ids['stage']+"' AND r.id='"+ids['run']+"' AND r.workspace_id='"+ids['workspace']+"'"
  for kind,update,predicate in [('cancelled-parent',"UPDATE public.model_runs SET status='cancelled' WHERE id='"+ids['run']+"';", "run['status'] == 'running'"),('inactive-attempt',"UPDATE public.model_run_stages SET active_attempt_id=NULL WHERE id='"+ids['stage']+"';", "active == claim_receipt['attempt_id']")]:
   rows=json.loads(sql(database,'BEGIN;SET LOCAL session_replication_role=replica;'+update+query+';ROLLBACK;'))
   (out/(name+'-'+kind+'-snapshot-private.json')).write_text(json.dumps(rows,indent=2)+'\n')
   def get(url,**kwargs):
    expected={'id':'eq.'+ids['stage'],'run_id':'eq.'+ids['run'],'model_runs.workspace_id':'eq.'+ids['workspace'],'select':'id,run_id,status,attempt_managed,active_attempt_id,model_runs!inner(id,workspace_id,status,attempt_managed)'}
    guard.verify_original_rows(expected,kwargs['params']);return Response(rows)
   kwargs={'workspace_id':ids['workspace'],**scope['logicalScope'],'service_key':'synthetic-projection-only','get':get}
   guard.verify_original_rows(False,client.inspect_ownership(claim,receipt,**kwargs)['owns_stage'])
   harmless=ast.parse('# Harmless source comment\n'+ast.unparse(node)).body[0];space=vars(client).copy();exec(compile(ast.fix_missing_locations(ast.Module(body=[harmless],type_ignores=[])),client.__file__,'exec'),space);guard.verify_original_rows(False,space['inspect_ownership'](claim,receipt,**kwargs)['owns_stage'])
   mutated=copy.deepcopy(node);assignment=next(n for n in ast.walk(mutated) if isinstance(n,ast.Assign) and any(isinstance(v,ast.Name) and v.id=='owns' for v in n.targets));indices=[i for i,n in enumerate(assignment.value.values) if ast.unparse(n)==predicate];assert len(indices)==1;assignment.value.values[indices[0]]=ast.Constant(True);space=vars(client).copy();exec(compile(ast.fix_missing_locations(ast.Module(body=[mutated],type_ignores=[])),client.__file__,'exec'),space)
   try:guard.verify_original_rows(False,space['inspect_ownership'](claim,receipt,**kwargs)['owns_stage'])
   except ValueError as e:assert str(e)=='stagepoint-original-row-images'
   else:raise AssertionError('Broken ownership predicate survived native snapshot oracle')
   guard.verify_original_rows(False,client.inspect_ownership(claim,receipt,**kwargs)['owns_stage']);records.append({'case':name,'nativeRollbackMutation':kind,'baselineHarmlessRestoredRefuseOwnership':True,'brokenPredicateFailsIntendedAssertion':'stagepoint-original-row-images','projectionFiltersAndFieldsEqual':True})
 assert Path(client.__file__).read_bytes()==raw
 return {'sourceSha256':hashlib.sha256(raw).hexdigest(),'cases':records,'scope':'Existing reader consumes native SQL rollback-only snapshots. In-memory predicate mutations only. No live CLI revocation, replacement lease, concurrent writer or continuation authorization.'}
