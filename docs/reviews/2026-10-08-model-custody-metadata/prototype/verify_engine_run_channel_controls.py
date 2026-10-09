"""Exact operation shape and parent-derived run identity controls."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_engine_channel.py').read_text()
def change(old,new):
 if source.count(old)!=1:raise AssertionError('Run channel anchor changed')
 return source.replace(old,new)
cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
 ('allow-extra-identity',change('set(request) != fields','not fields.issubset(request)'),'test_extra_run_identity_refused_before_read'),
 ('replace-parent-identity',change('self.writer.read_run(self.writer.context.run_id)',"self.writer.read_run('foreign')"),'test_parent_supplies_run_identity_to_writer'),
 ('skip-owned-read',change('self.writer.read_run(self.writer.context.run_id)','{}'),'test_revoked_run_read_closes_channel_without_response'),
 ('restored',source,None)]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_engine_channel',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_engine_run_channel'+('.RunChannelTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'channel_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Reserved real child and socket, real journal, mocked HTTP and ownership. No native database, full solver entrypoint, bulk configuration transfer or supervisor recovery.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'engine-run-channel-controls.json').write_text(content);print(content)
