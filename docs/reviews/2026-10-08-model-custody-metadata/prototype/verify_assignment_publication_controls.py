"""Isolated mutations of parent registration, acknowledgement and stop guards."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];worker=ROOT/'workers/aequilibrae_worker'
names=('model_assignment_input_publication.py','model_assignment_input_snapshot.py','model_engine_channel.py','model_engine_binding.py')
original={name:(worker/name).read_text() for name in names}
checks=[
 ('harmless',None,None,None,None,None),
 ('omit-registration',names[0],'writer.record_artifact(','(lambda *args, **kwargs: None)(','test_bound_execution_registers_before_calling_solver','AssertionError: 0 != 1'),
 ('wrong-stage',names[0],"writer._read_state(expected_stage_name=stages[method])",'pass','test_wrong_native_stage_refuses_before_registration','Exception not raised'),
 ('changed-array',names[0],"if actual!=expected:raise ValueError('Assignment snapshot array bytes differ')",'if False:raise ValueError("unused")','test_changed_array_refuses_parent_registration','ValueError not raised'),
 ('bypass-stop',names[0],'writer.stopped=True','writer.stopped=False','test_lost_registration_reply_stops_before_solver','False is not true'),
 ('duplicate-request',names[2],'if self.initial_inputs_started or self.output_directory is None:','if self.output_directory is None:','test_parent_channel_registers_fixed_path_once','ChannelStopped not raised'),
 ('wrong-ack',names[3],'if confirmed != receipt:','if False:','test_binding_refuses_different_parent_confirmation_before_solver','ValueError not raised'),
 ('restored',None,None,None,None,None),
]
results=[]
for control,name,old,new,test,reason in checks:
 sources=dict(original)
 if name:
  assert sources[name].count(old)==1,control
  sources[name]=sources[name].replace(old,new)
 elif control=='harmless':sources[names[0]]+='\n# Harmless comment.\n'
 with tempfile.TemporaryDirectory(prefix='openplan-publication-control-') as tmp:
  for filename,source in sources.items():(Path(tmp)/filename).write_text(source)
  target='test_assignment_input_publication'+('.PublicationTests.'+test if test else '')
  code=f"import sys,unittest;sys.path[:0]=[{tmp!r},{str(worker)!r}];result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName({target!r}));raise SystemExit(not result.wasSuccessful())"
  result=subprocess.run([sys.executable,'-B','-c',code],capture_output=True,text=True,timeout=30)
  log=result.stdout+result.stderr
  matched=result.returncode==0 if reason is None else result.returncode!=0 and reason in log
  results.append({'control':control,'returncode':result.returncode,'expected_failure':reason,'matched':matched})
  if not matched:raise AssertionError(f'{control}: {log}')
report={'source_sha256':{name:hashlib.sha256(source.encode()).hexdigest() for name,source in original.items()},'controls':results,'limits':'Real files, journals and socket framing with injected database responses. No native database transaction or scientific acceptance.'}
(Path(__file__).parent/'assignment-publication-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
