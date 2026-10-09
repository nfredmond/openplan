"""Temporary workspace/writer mutations for durable input mappings."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'


def main():
    source = (WORKER / 'model_attempt_workspace.py').read_text()
    writer = (WORKER / 'model_attempt_writer.py').read_text()
    def change(body, old, new):
        if body.count(old) != 1:
            raise AssertionError('Package mutation anchor changed')
        return body.replace(old, new)
    cases = [('baseline', source, writer, None), ('harmless', source + '\n# Harmless comment.\n', writer + '\n# Harmless comment.\n', None),
        ('overwrite-existing-mapping', change(source, "name = '.input-mapping-' + uuid.uuid4().hex", "name = '.input-mapping-' + uuid.uuid4().hex\n            if (self.path / 'input_mapping.json').exists():\n                os.unlink('input_mapping.json', dir_fd=descriptor)"), writer, 'PairedInputTests.test_mapping_record_never_overwrites_existing_bytes'),
        ('erase-mapping-inputs', source, change(writer, "'mapped_fields': mapping['mapped_fields'], 'inputs': mapping['inputs']", "'mapped_fields': mapping['mapped_fields'], 'inputs': {}"), 'PairedInputTests.test_real_join_maps_only_package_and_preserves_original'),
        ('restored', source, writer, None)]
    records = []
    runner = """
import importlib.util,sys,unittest
for name,path in [('model_attempt_workspace',sys.argv[1]),('model_attempt_writer',sys.argv[2])]:
 spec=importlib.util.spec_from_file_location(name,path)
 module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
name='test_managed_paired_inputs'+('.'+sys.argv[3] if sys.argv[3] else '')
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
    report = {'workspace_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'writer_sha256': hashlib.sha256(writer.encode()).hexdigest(), 'controls': records,
              'limits': 'Actual paired helper and pinned immutable mapping files; mocked transport. No native mapping lost-reply recovery, project transfer, normal dispatch or scientific acceptance.'}
    (ROOT / 'input-mapping-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
