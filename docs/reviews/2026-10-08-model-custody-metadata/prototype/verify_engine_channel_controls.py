"""Progress-channel boundary mutations; no native database or solver claims."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_engine_channel.py').read_text()
def change(old,new):
 if source.count(old)!=1:raise AssertionError('Channel control anchor changed: '+old)
 return source.replace(old,new)
cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
 ('ignore-sequence',change("or request['sequence'] != self.sequence","or False"),'test_duplicate_sequence_stops_without_second_write'),
 ('ignore-operation',source.replace("operation = request.get('operation')","operation = 'progress'"),'test_child_identity_and_terminal_requests_refused'),
 ('ignore-log-bound',change("or len(request['log_tail']) > 20000","or False"),'test_log_bound_refuses_before_write'),
 ('ignore-ack-sequence',change("or response['sequence'] != sequence","or False"),'test_client_refuses_wrong_acknowledgement'),
 ('ignore-response-loss-stop',change('self.writer.stopped = True','pass'),'test_lost_response_stops_after_one_confirmed_write'),
 ('restored',source,None)]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_engine_channel',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_model_engine_channel'+('.EngineChannelTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real sockets and child progress client; real command journal with mocked HTTP. No normal dispatcher, engine launch admission, native database, solver channel integration or containment.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'engine-channel-controls.json').write_text(content);print(content)
