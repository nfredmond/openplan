"""Channel working-copy refusal controls using real prepared directories."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_engine_channel.py').read_text()
def change(old,new):
 if source.count(old)!=1:raise AssertionError('Path channel anchor changed')
 return source.replace(old,new)
cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
 ('allow-path-override',change('set(request) != fields','not fields.issubset(request)'),'test_child_path_override_refused'),
 ('skip-project-identity',change('self.writer.project_directory(root)',"str(root/'project_working/files')"),'test_replaced_working_project_closes_channel'),
 ('skip-package-activation',change('self.writer.package_directory(root)',"str(root/'package_working/files')"),'test_unprepared_package_is_not_substituted'),
 ('restored',source,None)]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_engine_channel',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_engine_path_channel'+('.PathChannelTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'channel_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real working-copy fixtures, reserved child and sockets; mocked registration and ownership. Paths are a checked read-time view, not pinned engine file opens or descendant containment.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'engine-path-channel-controls.json').write_text(content);print(content)
