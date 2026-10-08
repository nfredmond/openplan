"""Temporary mutations of actual managed package path selection."""
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
import test_package_execution_path as tests


def main():
    source=(WORKER/'model_attempt_writer.py').read_text()
    assignment=inspect.getsource(tests.aeq.stage_assignment)
    artifacts=inspect.getsource(tests.aeq.stage_artifacts)
    def change(body,old,new):
        if body==source:
            begin=body.index('    def package_directory(');end=body.index('    def retain_input_mapping(',begin)
            part=body[begin:end]
            if part.count(old)!=1:raise AssertionError('Execution path mutation anchor changed')
            return body[:begin]+part.replace(old,new)+body[end:]
        if body.count(old)!=1:raise AssertionError('Execution path mutation anchor changed')
        return body.replace(old,new)
    cases=[('baseline',source,None,None),('harmless',source+'\n# Harmless comment.\n',None,None),
        ('skip-assignment-package-check',source,change(assignment,'pkg_dir = package_work_directory(work_dir, pkg_dir)','pass'),'test_retained_input_cannot_be_used_for_assignment'),
        ('skip-artifact-package-check',source,change(artifacts,'package_work_directory(work_dir, package_meta.get("package_dir") if isinstance(package_meta, dict) else None)','pass'),'test_artifact_stage_refuses_missing_package_before_count_writes'),
        ('ignore-other-attempt',change(source,' or Path(work_dir) != self.files.path or self._working_package is None',' or self._working_package is None'),None,'test_wrong_attempt_directory_refused'),
        ('ignore-directory-replacement',change(source,"if path.resolve(strict=True) != path or self.files._identity(path.stat()) != identity:",'if False:'),None,'test_directory_replacement_refused'),
        ('restored',source,None,None)]
    runner="""
import importlib.util,sys,unittest
from types import FunctionType
spec=importlib.util.spec_from_file_location('model_attempt_writer',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
import test_package_execution_path as tests
if sys.argv[2]:
 namespace=dict(tests.aeq.__dict__)
 text=open(sys.argv[2]).read()
 exec(compile(text,'<package-path-control>','exec'),namespace)
 name='stage_artifacts' if text.startswith('def stage_artifacts(') else 'stage_assignment'
 original=namespace[name]
 replacement=FunctionType(original.__code__,tests.aeq.__dict__,argdefs=original.__defaults__)
 replacement.__kwdefaults__=original.__kwdefaults__
 setattr(tests.aeq,name,replacement)
name='test_package_execution_path'+('.PackagePathTests.'+sys.argv[3] if sys.argv[3] else '')
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
    (ROOT/'package-execution-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
