"""Assessment hashes must identify the exact preparation bytes evaluated."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_validation_instrument_v2 import core, observation, audit, basis


class InputCustodyTests(unittest.TestCase):
    def test_readiness_hashes_must_match_parsed_bytes(self):
        for changed in ('package', 'audit'):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                paths = {name: root / (name + '.json') for name in ('package', 'audit', 'bundle', 'basis')}
                for path in paths.values():
                    path.write_bytes(b'{}')
                output = root / 'output.csv'
                output.write_bytes(b'not opened')
                records = {key: {'path': paths[name].name, 'sha256': hashlib.sha256(b'{}').hexdigest()}
                           for key, name in (('observation_package', 'package'), ('pre_volume_match_audit', 'audit'))}
                bundle = {'schema': 'openplan.validation-input-bundle.v2',
                          'model_output_bytes_read': False, 'readiness_inputs': records}
                paths['bundle'].write_text(json.dumps(bundle))
                original = Path.read_bytes
                changed_once = []
                output_reads = []

                def replace_after_read(path):
                    payload = original(path)
                    if path == output:
                        output_reads.append(path)
                    if path == paths[changed] and not changed_once:
                        changed_once.append(path)
                        replacement = payload + b' '
                        path.write_bytes(replacement)
                        key = 'observation_package' if changed == 'package' else 'pre_volume_match_audit'
                        records[key]['sha256'] = hashlib.sha256(replacement).hexdigest()
                        paths['bundle'].write_text(json.dumps(bundle))
                    return payload

                reason = 'frozen observation package bytes changed' if changed == 'package' else 'frozen pre-volume match audit bytes changed'
                with patch.object(Path, 'read_bytes', replace_after_read):
                    with self.assertRaisesRegex(core.ContractError, reason):
                        core.assess_frozen_instrument_files(
                            observation_package_path=paths['package'], pre_volume_match_audit_path=paths['audit'],
                            validation_input_bundle_path=paths['bundle'], comparison_basis_path=paths['basis'],
                            model_output_path=output, assessment_id='synthetic', readiness_root=root)
                self.assertEqual(output_reads, [])

    def test_later_changes_do_not_replace_evaluated_input_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            item = observation()
            match = {'observation_id': item['observation_id'], 'status': 'matched',
                     'selected_link_ids': ['a'], 'direction_aggregation': 'one_direction'}
            paths = {name: root / (name + '.json') for name in ('package', 'audit', 'bundle', 'basis')}
            output = root / 'output.csv'
            output.write_bytes(b'link_id,PCE_tot\na,100\n')
            paths['package'].write_text(core.canonical_json({'observations': [item]}))
            digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
            frozen_audit = audit(item, match)
            frozen_audit['observation_package_sha256'] = digest(paths['package'])
            paths['audit'].write_text(core.canonical_json(frozen_audit))
            frozen_basis = basis(item)
            frozen_basis['model_output_artifact']['sha256'] = digest(output)
            paths['basis'].write_text(core.canonical_json(frozen_basis))
            bundle = {'schema': 'openplan.validation-input-bundle.v2', 'model_output_bytes_read': False,
                      'readiness_inputs': {
                          'observation_package': {'path': paths['package'].name, 'sha256': digest(paths['package'])},
                          'pre_volume_match_audit': {'path': paths['audit'].name, 'sha256': digest(paths['audit'])}}}
            paths['bundle'].write_text(json.dumps(bundle))
            expected = {name: digest(paths[name]) for name in ('bundle', 'audit')}
            original = Path.read_bytes
            output_reads = []

            def read_with_later_changes(path):
                payload = original(path)
                if path == output:
                    output_reads.append(path)
                    for name in ('bundle', 'audit'):
                        paths[name].write_text('{"replacement": true}')
                return payload

            with patch.object(Path, 'read_bytes', read_with_later_changes):
                result = core.assess_frozen_instrument_files(
                    observation_package_path=paths['package'], pre_volume_match_audit_path=paths['audit'],
                    validation_input_bundle_path=paths['bundle'], comparison_basis_path=paths['basis'],
                    model_output_path=output, assessment_id='synthetic', readiness_root=root)
            self.assertEqual(len(output_reads), 1)
            self.assertEqual(result['observation_results'][0]['modeled_value'], 100)
            self.assertEqual(result['exact_inputs']['validation_input_bundle_sha256'], expected['bundle'],
                             'Assessment cited replacement bundle bytes')
            self.assertEqual(result['exact_inputs']['match_audit_sha256'], expected['audit'],
                             'Assessment cited replacement audit bytes')
            self.assertNotEqual(digest(paths['bundle']), expected['bundle'])
            self.assertNotEqual(digest(paths['audit']), expected['audit'])


if __name__ == '__main__':
    unittest.main()
