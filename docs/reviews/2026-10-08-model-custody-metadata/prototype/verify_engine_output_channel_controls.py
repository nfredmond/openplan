"""Parent-selected output reservation controls over the inherited channel."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_engine_channel.py').read_text()
def change(old,new):
 if source.count(old)!=1:raise AssertionError('Output channel anchor changed')
 return source.replace(old,new)
cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
 ('allow-child-name',change('set(request) != fields','not fields.issubset(request)'),'test_child_cannot_select_an_output_name'),
 ('ignore-unconfigured-destination',change('if self.output_name is None or self.writer.files is None:', 'if self.writer.files is None:'),'test_unconfigured_destination_refused'),
 ('adopt-existing-output',change('self.writer.create_assignment_outputs(\n                    self.writer.files.path, self.output_name)',"(os.makedirs(self.writer.files.path/self.output_name,exist_ok=True) or str(self.writer.files.path/self.output_name))"),'test_repeated_creation_preserves_existing_bytes_and_stops'),
 ('restored',source,None)]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_engine_channel',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_engine_output_channel'+('.OutputChannelTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'channel_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Reserved real child, sockets and private output directories; mocked claim/HTTP. Parent chooses a supported directory name; no stage-name policy, completed-output publication, solver or containment evidence.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'engine-output-channel-controls.json').write_text(content);print(content)
