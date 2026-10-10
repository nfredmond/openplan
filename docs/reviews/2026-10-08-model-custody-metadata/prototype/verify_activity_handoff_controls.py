"""Exercise managed ActivitySim handoff refusals against targeted omissions."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
worker=ROOT/'workers/aequilibrae_worker'
paths={'reader':worker/'model_activitysim_handoff.py','selector':worker/'model_predecessor_inputs.py','adapter':ROOT/'workers/activitysim_worker/supabase_poll.py'}
original={name:path.read_text() for name,path in paths.items()}
cases=[('harmless','reader',original['reader']+'\n# Harmless handoff control.\n',None)]
for name,source,before,after,target in (
 ('omit-projection','reader','id,run_id,stage_name,sort_order,status,attempt_managed,active_attempt_id','id,run_id,stage_name,sort_order,status','test_declared_producer_and_exact_projections'),
 ('omit-final-ownership','reader','        writer.read_run(run_id)\n        return selected','        return selected','test_consumer_revoked_after_selection_refuses'),
 ('ignore-producer-attempt','selector',"selected.get('attempt_id') != producer['active_attempt_id']",'False','test_revoked_producer_refuses_without_fallback'),
 ('wrong-producer','selector',"'ActivitySim Bundle & Preflight': 'Artifact Extraction'","'ActivitySim Bundle & Preflight': 'Network Assignment'",'test_wrong_producer_stage_refuses'),
 ('allow-foreign-kind','selector',"if (consumer.get('stage_name') == 'ActivitySim Bundle & Preflight') != (artifact_type in screening):",'if False:','test_foreign_artifact_kind_refuses'),
 ('bypass-adapter','adapter','def sb_get_run_artifacts(run_id: str) -> list[dict]:\n    import model_attempt_writer\n    writer = model_attempt_writer.current()','def sb_get_run_artifacts(run_id: str) -> list[dict]:\n    import model_attempt_writer\n    writer = None','test_declared_producer_and_exact_projections'),
):
 assert original[source].count(before)==1,name
 cases.append((name,source,original[source].replace(before,after),target))
cases.append(('restored','reader',original['reader'],None));results=[]
try:
 for name,source,text,target in cases:
  for key,path in paths.items():path.write_text(original[key])
  paths[source].write_text(text)
  run=subprocess.run([sys.executable,'-B','-m','unittest','test_activitysim_managed_handoff.ActivityHandoffTests'+('.'+target if target else ''),'-v'],cwd=worker,capture_output=True,text=True)
  passed=run.returncode==(1 if target else 0)
  if target:passed=passed and 'FAIL: '+target in run.stderr
  if not passed:raise AssertionError(name+run.stderr)
  results.append({'case':name,'returncode':run.returncode,'expected_behavior_observed':True})
finally:
 for key,path in paths.items():path.write_text(original[key])
print(json.dumps({'cases':results,'sources':{str(paths[key].relative_to(ROOT)):hashlib.sha256(text.encode()).hexdigest() for key,text in original.items()},'limits':['Mocked HTTP and exact query projections; no live database dispatch','Separate ownership and producer reads are snapshots, not a lease']},indent=2))
