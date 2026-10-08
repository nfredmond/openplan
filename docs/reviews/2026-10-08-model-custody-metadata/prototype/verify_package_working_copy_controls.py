"""Run owned package-capture checks against temporary source mutations."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'


def main():
    source = (WORKER / 'model_attempt_writer.py').read_text()
    def change(old, new):
        begin=source.index('    def prepare_package_working_copy')
        end=source.index('    def project_directory',begin)
        part=source[begin:end]
        if part.count(old)!=1:raise AssertionError('Package working mutation anchor changed')
        return source[:begin]+part.replace(old,new)+source[end:]
    cases = [('baseline', source, None), ('harmless', source + '\n# Harmless comment.\n', None),
        ('alias-retained-input', change("'package_directory': retained['package_directory']", "'package_directory': record['package_directory']"), 'test_mutating_working_file_preserves_retained_input'),
        ('erase-producer-reference', change("'producer': record['producer'],\n                                  'execution_ready'", "'producer': {},\n                                  'execution_ready'"), 'test_mutating_working_file_preserves_retained_input'),
        ('ignore-foreign-path', change("if record.get('manifest_path') != str(expected) or expected.resolve(strict=True) != expected:", 'if False:'), 'test_foreign_manifest_stops_before_copy'),
        ('restored', source, None)]
    runner = """
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_attempt_writer',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
name='test_package_working_copy'+('.PackageWorkingCopyTests.'+sys.argv[2] if sys.argv[2] else '')
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
            'limits':'Owned mutable working copy with real package file writes and mocked transport. Native receipt recovery, closure enforcement, cross-database consistency, normal dispatch and scientific acceptance remain unproved.'}
    (ROOT/'package-working-copy-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
