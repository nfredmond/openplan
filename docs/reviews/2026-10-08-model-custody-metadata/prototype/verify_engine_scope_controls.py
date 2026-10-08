"""Project cleanup controls with temporary module candidates."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'


def main():
    source=(WORKER/'model_engine_scope.py').read_text()
    def change(old,new):
        end=source.index('@contextmanager\ndef matrix_scope')
        part=source[:end]
        if part.count(old)!=1:raise AssertionError('Engine scope mutation anchor changed')
        return part.replace(old,new)+source[end:]
    def matrix_change(old,new):
        begin=source.index('@contextmanager\ndef matrix_scope')
        part=source[begin:]
        if part.count(old)!=1:raise AssertionError('Matrix scope mutation anchor changed')
        return source[:begin]+part.replace(old,new)
    cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
      ('omit-close',change('                project.close()','                pass'),'test_actual_assignment_closes_after_graph_failure'),
      ('ignore-interruption',change('                project.close()',"                if not isinstance(__import__('sys').exception(), KeyboardInterrupt): project.close()"),'test_interrupt_closes_and_preserves_exception'),
      ('ignore-managed-stop',change('            writer.stopped = True','            pass'),'test_partial_open_closes_and_stops_managed_writer'),
      ('swallow-close-error',change('                project.close()', '                try: project.close()\n                except OSError: pass'),'test_cleanup_failure_propagates_with_original_error'),
      ('omit-project-log-close',change('                close_project_log(project, directory)','                pass'),'test_project_log_closes_without_touching_unrelated_handler'),
      ('omit-matrix-cleanup',matrix_change('                    stack.callback(matrix.close)','                    pass'),'test_matrices_close_once_in_reverse_order'),
      ('duplicate-matrix-cleanup',matrix_change('if id(matrix) not in seen:','if True:'),'test_matrices_close_once_in_reverse_order'),
      ('ignore-matrix-failure-stop',matrix_change('            writer.stopped = True','            pass'),'test_matrix_close_failure_does_not_skip_remaining_cleanup'),
      ('restored',source,None)]
    runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_engine_scope',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_model_engine_scope'+('.EngineScopeTests.'+sys.argv[2] if sys.argv[2] else '')
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
                expected='FAIL: '+target
                if r.returncode!=1 or expected not in r.stderr:raise AssertionError(name+' missed target: '+r.stderr)
            elif r.returncode:raise AssertionError(name+' failed: '+r.stderr)
            records.append({'control':name,'exit_code':r.returncode,'targeted_test':target})
    report={'scope_sha256':hashlib.sha256(source.encode()).hexdigest(),'worker_sha256':hashlib.sha256((WORKER/'main.py').read_bytes()).hexdigest(),'controls':records,'limits':'Actual setup and assignment entry points with injected project failures. Verifies close is attempted and errors remain visible, not that native handles all close or that scientific output is valid.'}
    (ROOT/'engine-scope-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
