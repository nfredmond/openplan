"""Owned progress endpoint lifetime controls around reserved launch."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_engine_process.py').read_text()
def change(old,new):
 if source.count(old)!=1:raise AssertionError('Launch control anchor changed')
 return source.replace(old,new)
cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
 ('leak-parent-endpoint',change('            if self.progress is not None:self.progress.stop()','            pass'),'test_spawn_failure_closes_both_endpoints_and_retains_reservation'),
 ('leak-child-endpoint',change('            if child_channel is not None:child_channel.close()','            pass'),'test_spawn_failure_closes_both_endpoints_and_retains_reservation'),
 ('accept-foreign-descriptor',change('if CHANNEL_FD_ENV in env:','if False:'),'test_foreign_descriptor_setting_refused_before_launch'),
 ('leave-completed-channel-open',change('        if self.progress is not None:self.progress.stop()\n        if code!=0:','        if code!=0:'),'test_reserved_child_uses_parent_writer_then_closes_channel'),
 ('restored',source,None)]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_engine_process',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_engine_launch_channel'+('.LaunchChannelTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real reserved child and inherited socket; command journal with mocked HTTP. No native solver, run/path/count protocol, supervisor restart or descendant containment.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'engine-launch-channel-controls.json').write_text(content);print(content)
