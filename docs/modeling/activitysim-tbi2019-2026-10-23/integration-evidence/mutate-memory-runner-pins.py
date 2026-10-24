"""Mutate temporary runner copies while preserving the active recipe bytes."""
import hashlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
E=Path(__file__).resolve().parent;p=E/'activitysim-memory-runner.py';original=p.read_bytes()
spec=importlib.util.spec_from_file_location('runner_tests',Path('scripts/modeling/tests/test_activitysim_memory_runner.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
cases=[('comment',None,None,True),('version-pin',"importlib.metadata.version('activitysim')!='1.5.1'",'False',False),('source-pin','hashlib.sha256(Path(location_choice.__file__).read_bytes()).hexdigest()!=expected','False',False)]
records=[]
for name,old,new,survive in cases:
 source=original.decode()
 if old is not None and source.count(old)!=1:raise RuntimeError('Anchor mismatch')
 with tempfile.NamedTemporaryFile(mode='w',suffix='.py',prefix='.runner-control-',dir=E) as f:
  f.write(source+'\n# Harmless comment.\n' if old is None else source.replace(old,new));f.flush();module.RUNNER=Path(f.name)
  stream=io.StringIO();result=unittest.TextTestRunner(stream=stream,verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(module))
 log=stream.getvalue();(E/('memory-runner-pin-mutation-'+name+'.log')).write_text(log)
 ok=result.wasSuccessful() if survive else len(result.failures)>0 and not result.errors
 records.append({'name':name,'expected_observed':ok,'expected':'survive' if survive else 'assertion failure','active_source_unchanged':p.read_bytes()==original,'active_source_sha256':hashlib.sha256(original).hexdigest()})
 if not ok:break
(E/'memory-runner-pin-mutations.json').write_text(json.dumps(records,indent=2)+'\n')
assert len(records)==len(cases) and all(r['expected_observed'] and r['active_source_unchanged'] for r in records)
