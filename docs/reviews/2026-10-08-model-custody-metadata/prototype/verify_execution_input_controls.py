"""Temporary controls for the actual combined input preparation helper."""
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
import test_managed_execution_inputs as tests


def main():
    source=inspect.getsource(tests.aeq.retain_managed_state_and_package)
    def change(old,new):
        if source.count(old)!=1:raise AssertionError('Combined input control anchor changed')
        return source.replace(old,new)
    cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
        ('ignore-project-attempt',change('if any(project_input["producer"].get(key)', 'if False and any(project_input["producer"].get(key)'), 'test_different_project_attempt_refuses_before_working_copy'),
        ('map-retained-project-as-working',change('working_project["project_directory"]}', 'project_input["package_directory"]}'), 'test_three_inputs_and_working_path_are_retained_without_rewriting_state'),
        ('erase-initial-manifest-hash',change('"initial_manifest_sha256": working_project["initial_manifest_sha256"]', '"initial_manifest_sha256": "0" * 64'), 'test_three_inputs_and_working_path_are_retained_without_rewriting_state'),
        ('restored',source,None)]
    runner="""
import sys,unittest
from types import FunctionType
import test_managed_execution_inputs as tests
namespace=dict(tests.aeq.__dict__)
exec(compile(open(sys.argv[1]).read(),'<execution-input-control>','exec'),namespace)
f=namespace['retain_managed_state_and_package']
replacement=FunctionType(f.__code__,tests.aeq.__dict__,argdefs=f.__defaults__)
replacement.__kwdefaults__=f.__kwdefaults__
tests.aeq.retain_managed_state_and_package=replacement
name='test_managed_execution_inputs'+('.ExecutionInputsTests.'+sys.argv[2] if sys.argv[2] else '')
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if result.wasSuccessful() else 1)
"""
    records=[]
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'adapter.py'
        for name,body,target in cases:
            path.write_text(body)
            result=subprocess.run([sys.executable,'-B','-c',runner,str(path),target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
            if target:
                if result.returncode!=1 or 'FAIL: '+target not in result.stderr:raise AssertionError(name+' did not fail at target:\n'+result.stderr)
            elif result.returncode:raise AssertionError(name+' failed:\n'+result.stderr)
            records.append({'control':name,'exit_code':result.returncode,'targeted_test':target})
    report={'worker_sha256':hashlib.sha256((WORKER/'main.py').read_bytes()).hexdigest(),'controls':records,
            'limits':'Actual combined input helper with real files and mocked HTTP. No native combined receipt recovery, full output/count mapping, engine lifecycle or scientific acceptance.'}
    (ROOT/'execution-input-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
