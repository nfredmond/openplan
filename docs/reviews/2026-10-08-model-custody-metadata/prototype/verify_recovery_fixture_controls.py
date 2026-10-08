"""Check test-fixture connection closure without weakening identity corruption."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'


def main():
    source=(WORKER/'test_model_command_recovery.py').read_text()
    def change(old,new):
        if source.count(old)!=1:raise AssertionError('Fixture control anchor changed')
        return source.replace(old,new)
    cases=[('baseline',source),('harmless',source+'\n# Harmless fixture comment.\n'),
        ('omit-close',change("with closing(sqlite3.connect(self.directory / 'model-commands.sqlite3')) as connection, connection:","with sqlite3.connect(self.directory / 'model-commands.sqlite3') as connection:")),
        ('omit-corruption',change("connection.execute('UPDATE commands SET request_json=?', (json.dumps(changed),))",'pass')),
        ('restored',source)]
    runner="""
import importlib.util,sys,unittest,gc
spec=importlib.util.spec_from_file_location('fixture_candidate',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(module.RecoveryTests))
gc.collect()
raise SystemExit(0 if result.wasSuccessful() else 1)
"""
    records=[]
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'candidate.py'
        for name,body in cases:
            # The test's CLI location must remain the actual worker directory.
            path.write_text(body.replace('ROOT = Path(__file__).resolve().parent','ROOT = Path('+repr(str(WORKER))+')'))
            result=subprocess.run([sys.executable,'-B','-W','always::ResourceWarning','-c',runner,str(path)],cwd=WORKER,capture_output=True,text=True,timeout=30)
            warning='ResourceWarning: unclosed database' in result.stderr
            if name=='omit-close':
                if result.returncode or not warning:raise AssertionError('Unclosed control not detected')
            elif name=='omit-corruption':
                if result.returncode!=1 or 'FAIL: test_corrupted_request_identity_cannot_dispatch_another_command' not in result.stderr:raise AssertionError('Corruption control not detected')
            elif result.returncode or warning:raise AssertionError(name+' failed:\n'+result.stderr)
            records.append({'control':name,'exit_code':result.returncode,'unclosed_warning':warning})
    report={'test_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Recovery fixture connection closure and retained corruption assertion. Does not prove every engine connection closes.'}
    (ROOT/'recovery-fixture-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
