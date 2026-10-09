"""Verify ActivitySim refuses unowned configuration reads without fallback."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
writer=ROOT/'workers/aequilibrae_worker/model_attempt_writer.py'
adapter=ROOT/'workers/activitysim_worker/supabase_poll.py'
original={p:p.read_text() for p in (writer,adapter)}
cases=[('harmless',adapter,original[adapter]+'\n# Harmless read control.\n',None)]
for name,path,before,after,target in (
 ('ignore-requested-run',writer,"if run_id != self.context.run_id:\n                raise ValueError('Managed run read crosses invocation scope')","if False:\n                raise ValueError('Managed run read crosses invocation scope')",'test_foreign_requested_run_refused_before_transport'),
 ('omit-projection',writer,"run_projection += ',' + ','.join(RUN_CONFIGURATION_FIELDS)",'pass','test_actual_worker_uses_owned_projection_without_legacy_read'),
 ('ignore-revoked-attempt',writer,"stage['active_attempt_id'] != ctx.attempt_id",'False','test_revoked_attempt_refuses_actual_worker_without_fallback'),
 ('bypass-adapter',adapter,'def sb_get_run(run_id: str) -> dict:\n    import model_attempt_writer\n    writer = model_attempt_writer.current()','def sb_get_run(run_id: str) -> dict:\n    import model_attempt_writer\n    writer = None','test_actual_worker_uses_owned_projection_without_legacy_read'),
 ('swallow-read-refusal',adapter,'raise WorkerStateReadUnconfirmed("Managed run read requires reconciliation; no legacy read fallback") from error','return {}','test_revoked_attempt_refuses_actual_worker_without_fallback'),
):
 assert original[path].count(before)==1
 cases.append((name,path,original[path].replace(before,after),target))
missing=original[writer].replace('if not set(RUN_CONFIGURATION_FIELDS).issubset(run):','if False:').replace('return {key: run[key] for key in','return {key: run.get(key) for key in')
cases.append(('allow-missing-configuration',writer,missing,'test_missing_configuration_field_refuses'))
cases.append(('restored',writer,original[writer],None))
results=[]
try:
 for name,path,body,target in cases:
  for p,text in original.items():p.write_text(text)
  path.write_text(body)
  result=subprocess.run([sys.executable,'-B','-m','unittest','test_managed_run_read.ActivityRunReadTests'+('.'+target if target else ''),'-v'],cwd=writer.parent,text=True,capture_output=True)
  observed=result.returncode==(1 if target else 0)
  if target:observed=observed and 'FAIL: '+target in result.stderr
  if not observed:raise AssertionError(name+result.stderr)
  results.append({'case':name,'returncode':result.returncode,'expected_behavior_observed':observed})
finally:
 for p,text in original.items():p.write_text(text)
print(json.dumps({'cases':results,'sources':{str(p.relative_to(ROOT)):hashlib.sha256(t.encode()).hexdigest() for p,t in original.items()},'limits':['Actual ActivitySim adapter and invocation journal; mocked HTTP with exact query projection','Read-time ownership snapshot, not a lease or live database dispatch acceptance']},indent=2))
