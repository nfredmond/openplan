"""Temporary package/writer mutations with explicit failure reasons."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'


def main():
    source = (WORKER / 'model_package_inputs.py').read_text()
    writer = (WORKER / 'model_attempt_writer.py').read_text()
    def change(body, old, new):
        if body.count(old) != 1:
            raise AssertionError('Package mutation anchor changed')
        return body.replace(old, new)
    cases = [('baseline', source, writer, None), ('harmless', source + '\n# Harmless comment.\n', writer + '\n# Harmless comment.\n', None),
        ('omit-generated-input', change(source, "        manifest = {'schema':", "        inventory.pop('od_auto_matrix_calibrated.csv', None)\n        manifest = {'schema':"), writer, 'PackageTests.test_all_generated_files_and_empty_directories_retained'),
        ('ignore-late-file-change', change(source, 'if identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) != before:', 'if False:'), writer, 'PackageTests.test_changed_earlier_file_refuses_manifest'),
        ('accept-hardlinks', change(source, 'if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:', 'if not stat.S_ISREG(before.st_mode):'), writer, 'PackageTests.test_links_and_special_files_refused'),
        ('wrong-manifest-hash', change(source, "'manifest_sha256': hashlib.sha256(content).hexdigest()", "'manifest_sha256': '0' * 64"), writer, 'BoundPackageTests.test_owned_package_registers_exact_manifest'),
        ('foreign-package', source, change(writer, 'if self.files is None or not Path(directory).resolve(strict=True).is_relative_to(self.files.path):', 'if False:'), 'BoundPackageTests.test_foreign_package_refused_without_registration'),
        ('ignore-consumer-hash', change(source, 'hashlib.sha256(content).hexdigest() != digest', 'False'), writer, 'PackageConsumerTests.test_manifest_hash_is_checked_before_copy'),
        ('ignore-consumer-inventory', change(source, "if actual['entries'] != manifest['entries']:", 'if False:'), writer, 'PackageConsumerTests.test_changed_missing_extra_inputs_are_refused'),
        ('ignore-consumer-race', change(source, "if actual['entries'] != manifest['entries']:", 'if False:'), writer, 'PackageConsumerTests.test_change_at_copy_boundary_is_refused'),
        ('restored', source, writer, None)]
    records = []
    runner = """
import importlib.util,sys,unittest
for name,path in [('model_package_inputs',sys.argv[1]),('model_attempt_writer',sys.argv[2])]:
 spec=importlib.util.spec_from_file_location(name,path)
 module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
name='test_model_package_inputs'+('.'+sys.argv[3] if sys.argv[3] else '')
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if result.wasSuccessful() else 1)
"""
    with tempfile.TemporaryDirectory() as temp:
        package_path, writer_path = Path(temp) / 'package.py', Path(temp) / 'writer.py'
        for name, body, writer_body, target in cases:
            package_path.write_text(body); writer_path.write_text(writer_body)
            result = subprocess.run([sys.executable, '-B', '-c', runner, str(package_path), str(writer_path), target or ''],
                                    cwd=WORKER, capture_output=True, text=True, timeout=30)
            if target:
                if result.returncode != 1 or 'FAIL: ' + target.split('.')[-1] not in result.stderr:
                    raise AssertionError(name + ' did not fail at its target:\n' + result.stderr)
            elif result.returncode:
                raise AssertionError(name + ' failed:\n' + result.stderr)
            records.append({'control': name, 'exit_code': result.returncode, 'targeted_test': target})
    report = {'package_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'writer_sha256': hashlib.sha256(writer.encode()).hexdigest(), 'controls': records,
              'limits': 'Real local trees; mocked command transport. No native manifest recovery, consumer mapping, database consistency, normal dispatch or scientific acceptance.'}
    (ROOT / 'package-retention-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
