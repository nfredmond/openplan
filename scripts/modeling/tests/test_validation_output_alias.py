"""Preparation inputs must not open model output through another name."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'workers' / 'aequilibrae_worker'))
import model_validation_core_v5 as core


class OutputAliasTests(unittest.TestCase):
    def test_preparation_refuses_output_identity_before_read(self):
        for kind in ('direct', 'symlink', 'hardlink'):
            for slot in ('observation_package_path', 'pre_volume_match_audit_path',
                         'validation_input_bundle_path', 'comparison_basis_path', 'readiness'):
                with self.subTest(kind=kind, slot=slot), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    output = root / 'output.csv'
                    output.write_bytes(b'link_id,PCE_tot\na,100\n')
                    alias = output
                    if kind != 'direct':
                        alias = root / 'input-alias'
                        if kind == 'symlink':
                            alias.symlink_to(output)
                        else:
                            alias.hardlink_to(output)
                    inputs = {}
                    for name in ('observation_package_path', 'pre_volume_match_audit_path',
                                 'validation_input_bundle_path', 'comparison_basis_path'):
                        inputs[name] = root / (name + '.json')
                        inputs[name].write_text('{}')
                    bundle = {'schema': 'openplan.validation-input-bundle.v2',
                              'model_output_bytes_read': False,
                              'readiness_inputs': {'first': {'path': alias.name,
                                  'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}}}
                    inputs['validation_input_bundle_path'].write_text(json.dumps(bundle))
                    if slot != 'readiness':
                        inputs[slot] = alias
                    opened = []
                    original_open = Path.open

                    def tracked_open(path, *args, **kwargs):
                        if path.exists() and path.samefile(output):
                            opened.append(str(path))
                        return original_open(path, *args, **kwargs)

                    with patch.object(Path, 'open', tracked_open):
                        with self.assertRaisesRegex(core.ContractError, 'readiness input aliases model output'):
                            core.assess_frozen_instrument_files(**inputs, model_output_path=output,
                                assessment_id='synthetic', readiness_root=root)
                    self.assertEqual(opened, [], 'Output bytes opened during readiness checks')


if __name__ == '__main__':
    unittest.main()
