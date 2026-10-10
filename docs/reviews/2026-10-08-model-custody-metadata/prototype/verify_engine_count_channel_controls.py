"""Parent count preparation controls over the inherited channel."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_engine_channel.py').read_text()
def change(old,new):
 if source.count(old)!=1:raise AssertionError('Output channel anchor changed')
 return source.replace(old,new)
cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
 ('allow-child-source',change('set(request) != fields','not fields.issubset(request)'),'test_child_source_override_refused'),
 ('allow-repeat',change('if self.count_preparation_started:', 'if False:'),'test_repeated_preparation_refused_before_callback'),
 ('ignore-output-identity',change('if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != self.output_identity:', 'if False:'),'test_replaced_output_refused_before_callback'),
 ('omit-writer-binding',change('with managed.bind(self.writer) if owner is None else nullcontext():','with nullcontext():'),'test_reserved_child_receives_registered_counts'),
 ('restored',source,None)]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_engine_channel',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_engine_count_channel'+('.CountChannelTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'channel_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real child and retained count bytes, actual assignment helper, mocked HTTP. Callback is trusted parent code. No native database, live acquisition, concurrent filesystem attack containment, full stage integration or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'engine-count-channel-controls.json').write_text(content);print(content)
