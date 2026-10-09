"""Coverage claims for the actual assignment branch and retained numerical path."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_engine_binding.py').read_text()
cases=[('baseline',source,''),('harmless',source+'\n# Harmless comment.\n',''),
 ('allow-foreign-run',source.replace('if run_id != self.run_id:', 'if False:'),'test_foreign_scope_and_terminal_write_refused'),
 ('allow-terminal-write',source.replace(" or set(payload) != {'log_tail'}", '').replace("payload['log_tail']", "payload.get('log_tail', '')"),'test_foreign_scope_and_terminal_write_refused'),
 ('accept-foreign-reply',source.replace("if result.get('id') != self.run_id:", 'if False:'),'test_foreign_parent_reply_and_package_refused'),
 ('skip-output-request',source.replace("self.output_directory = self.client.create_outputs()['output_directory']", "self.output_directory = str(Path(self.work_directory)/self.output_name)"),'test_actual_adapters_route_to_parent'),
 ('restored',source,'')]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_engine_binding',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_assignment_engine_binding'+('.AssignmentEngineBindingTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as directory:
 p=Path(directory)/'candidate.py'
 for name,body,target in cases:
  p.write_text(body)
  r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+': '+r.stderr)
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target or None})
report={'module_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Actual worker adapters with a fake parent client. No real child native assignment, count/transit integration, process containment or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'assignment-engine-binding-controls.json').write_text(content);print(content)
