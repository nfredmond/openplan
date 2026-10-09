"""Run project-copy checks against temporary source mutations."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'


def main():
    source = (WORKER / 'model_project_inputs.py').read_text()
    def change(old, new):
        if source.count(old) != 1:
            raise AssertionError('Project mutation anchor changed')
        return source.replace(old, new)
    cases = [('baseline', source, None), ('harmless', source + '\n# Harmless comment.\n', None),
        ('ignore-sidecars', change("if name.endswith(('-wal', '-shm', '-journal')) or '-mj ' in name:", 'if False:'), 'test_committed_wal_not_silently_omitted'),
        ('ignore-integrity', change("if connection.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:", 'if False:'), 'test_integrity_failure_refused'),
        ('ignore-consumer-inventory', change('return validate(package.consume(record, destination))', "return validate(package.retain(record['package_directory'], destination))"), 'test_registered_database_tamper_refused'),
        ('ignore-secondary-database', change("if entry['kind'] != 'file':", "if entry['kind'] != 'file' or name != 'project_database.sqlite':"), 'test_secondary_database_checked'),
        ('restored', source, None)]
    runner = """
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_project_inputs',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
name='test_model_project_inputs'+('.ProjectInputsTests.'+sys.argv[2] if sys.argv[2] else '')
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if result.wasSuccessful() else 1)
"""
    records=[]
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'candidate.py'
        for name,body,target in cases:
            path.write_text(body)
            result=subprocess.run([sys.executable,'-B','-c',runner,str(path),target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
            if target:
                if result.returncode!=1 or 'FAIL: '+target not in result.stderr:
                    raise AssertionError(name+' did not fail at target:\n'+result.stderr)
            elif result.returncode:
                raise AssertionError(name+' failed:\n'+result.stderr)
            records.append({'control':name,'exit_code':result.returncode,'targeted_test':target})
    report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,
            'limits':'Real SQLite copy tests and injected integrity failure. No native engine, multi-database transaction, producer authority, dispatcher or scientific acceptance.'}
    (ROOT/'project-input-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
