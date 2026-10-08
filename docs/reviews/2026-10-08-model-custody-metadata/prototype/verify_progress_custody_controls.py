"""Check progress failure propagation and actual assignment context configuration."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'assignment_progress.py').read_text()
main_source=(WORKER/'main.py').read_text()
cases=[('baseline',source,main_source,None),
       ('harmless',source+'\n# Harmless comment.\n',main_source,None),
       ('swallow-custody-error',source.replace('except self._fatal_exceptions:', 'except ():'),main_source,'test_fatal_callback_error_propagates'),
       ('omit-level-restoration',source.replace('logger.setLevel(previous_level)','pass'),main_source,'test_fatal_flush_restores_logger_and_detaches'),
       ('omit-worker-fatal-policy',source,main_source.replace('fatal_exceptions=(WorkerStateWriteUnconfirmed,),','fatal_exceptions=(),'),'test_actual_assignment_context_propagates_unconfirmed_write'),
       ('restored',source,main_source,None)]
runner='''
import importlib.util,sys,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('assignment_progress',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
replacement=Path(sys.argv[2]).read_text()
original=Path.read_text
def read(path,*args,**kwargs):
 if path.name=='main.py' and path.parent.name=='aequilibrae_worker':return replacement
 return original(path,*args,**kwargs)
name='test_assignment_progress'+('.CustodyFailures.'+sys.argv[3] if sys.argv[3] else '')
with patch.object(Path,'read_text',read):
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if result.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as temp:
 for name,body,main_body,target in cases:
  p=Path(temp)/'candidate.py';p.write_text(body)
  q=Path(temp)/'worker.py';q.write_text(main_body)
  result=subprocess.run([sys.executable,'-B','-c',runner,str(p),str(q),target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if result.returncode!=1 or 'FAIL: '+target not in result.stderr:raise AssertionError(name+': '+result.stderr)
  elif result.returncode:raise AssertionError(name+': '+result.stderr)
  records.append({'control':name,'exit_code':result.returncode,'targeted_test':target})
report={'progress_sha256':hashlib.sha256(source.encode()).hexdigest(),'worker_sha256':hashlib.sha256(main_source.encode()).hexdigest(),'controls':records,'limits':'Real Python logger callbacks and extracted actual assignment context expression; synthetic write failure, no native solver abort or database transport acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'progress-custody-controls.json').write_text(content);print(content)
