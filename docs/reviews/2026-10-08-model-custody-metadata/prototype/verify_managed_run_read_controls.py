"""Claimed-run read controls with exact query projection assertions."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_attempt_writer.py').read_text()
def change(old,new):
 if source.count(old)!=1:raise AssertionError('Run read anchor changed')
 return source.replace(old,new)
cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
 ('ignore-requested-run',change("if run_id != self.context.run_id:\n                raise ValueError('Managed run read crosses invocation scope')", "if False:\n                raise ValueError('Managed run read crosses invocation scope')"),'test_foreign_requested_run_refused_before_transport'),
 ('omit-configuration-projection',change("run_projection += ',' + ','.join(RUN_CONFIGURATION_FIELDS)",'pass'),'test_actual_worker_uses_owned_projection_without_legacy_read'),
 ('allow-missing-configuration',source.replace('if not set(RUN_CONFIGURATION_FIELDS).issubset(run):','if False:').replace('return {key: run[key] for key in', 'return {key: run.get(key) for key in'),'test_missing_configuration_field_refuses'),
 ('ignore-revoked-attempt',change("stage['active_attempt_id'] != ctx.attempt_id",'False'),'test_revoked_attempt_refuses_actual_worker_without_fallback'),
 ('restored',source,None)]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_attempt_writer',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_managed_run_read'+('.RunReadTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as temp:
 p=Path(temp)/'candidate.py'
 for name,body,target in cases:
  p.write_text(body)
  r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+': '+r.stderr)
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target})
report={'writer_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real invocation journal and actual worker adapter; mocked HTTP with exact projection assertions. Read-time ownership snapshot, not a distributed lease, native RLS proof or child run-read channel.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'managed-run-read-controls.json').write_text(content);print(content)
