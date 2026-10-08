"""Temporary mutations of actual managed project path selection."""
import hashlib
import inspect
import json
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
sys.path.insert(0,str(WORKER))
import test_project_execution_path as tests


def main():
    source=(WORKER/'model_attempt_writer.py').read_text()
    assignment=inspect.getsource(tests.aeq.stage_assignment)
    def change(body,old,new):
        if body.count(old)!=1:raise AssertionError('Execution path mutation anchor changed')
        return body.replace(old,new)
    cases=[('baseline',source,None,None),('harmless',source+'\n# Harmless comment.\n',None,None),
        ('legacy-assignment-fallback',source,change(assignment,'proj_dir = project_work_directory(work_dir)','proj_dir = os.path.join(work_dir, "aeq_project")'),'test_actual_assignment_uses_confirmed_copy_before_computation'),
        ('ignore-other-attempt',change(source,' or Path(work_dir) != self.files.path or self._working_project is None',' or self._working_project is None'),None,'test_other_attempt_path_refused'),
        ('ignore-directory-replacement',change(source,"if path.resolve(strict=True) != path or self.files._identity(path.stat()) != identity:",'if False:'),None,'test_replaced_working_directory_refused'),
        ('restored',source,None,None)]
    runner="""
import importlib.util,sys,unittest
from types import FunctionType
spec=importlib.util.spec_from_file_location('model_attempt_writer',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
import test_project_execution_path as tests
if sys.argv[2]:
 namespace=dict(tests.aeq.__dict__)
 exec(compile(open(sys.argv[2]).read(),'<project-path-control>','exec'),namespace)
 tests.aeq.stage_assignment=FunctionType(namespace['stage_assignment'].__code__,tests.aeq.__dict__,argdefs=namespace['stage_assignment'].__defaults__)
 tests.aeq.stage_assignment.__kwdefaults__=namespace['stage_assignment'].__kwdefaults__
name='test_project_execution_path'+('.ProjectPathTests.'+sys.argv[3] if sys.argv[3] else '')
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if result.wasSuccessful() else 1)
"""
    records=[]
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'writer.py';adapter=Path(temp)/'adapter.py'
        for name,body,stage,target in cases:
            path.write_text(body);adapter.write_text(stage or '')
            result=subprocess.run([sys.executable,'-B','-c',runner,str(path),str(adapter) if stage else '',target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
            if target:
                if result.returncode!=1 or 'FAIL: '+target not in result.stderr:raise AssertionError(name+' did not fail at target:\n'+result.stderr)
            elif result.returncode:raise AssertionError(name+' failed:\n'+result.stderr)
            records.append({'control':name,'exit_code':result.returncode,'targeted_test':target})
    report={'writer_sha256':hashlib.sha256(source.encode()).hexdigest(),'worker_sha256':hashlib.sha256((WORKER/'main.py').read_bytes()).hexdigest(),'controls':records,
            'limits':'Actual assignment entry and output preparation, stopped before computation; mocked registration. No engine execution, closure enforcement, complete input mapping, normal dispatch or scientific acceptance.'}
    (ROOT/'project-execution-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
