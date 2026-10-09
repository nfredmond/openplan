"""Malformed readiness evidence must fail before model-output access."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from test_validation_instrument_v2 import core, observation, audit, basis


class ReadinessRecordsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.paths = {name: self.root/(name+'.json') for name in ('package', 'audit', 'bundle', 'basis')}
        self.output = self.root/'output.csv'
        self.output.write_bytes(b'link_id,PCE_tot\na,100\n')
        item = observation()
        self.paths['package'].write_text(core.canonical_json({'observations': [item]}))
        match = {'observation_id': item['observation_id'], 'status': 'matched',
                 'selected_link_ids': ['a'], 'direction_aggregation': 'one_direction'}
        matched = audit(item, match)
        matched['observation_package_sha256'] = self.digest(self.paths['package'])
        self.paths['audit'].write_text(core.canonical_json(matched))
        comparison = basis(item)
        comparison['model_output_artifact']['sha256'] = self.digest(self.output)
        self.paths['basis'].write_text(core.canonical_json(comparison))
        self.source = self.root/'source.dat'; self.source.write_bytes(b'synthetic source')
        self.record = {'path': self.source.name, 'sha256': self.digest(self.source), 'bytes': self.source.stat().st_size}
        self.bundle = {'schema': 'openplan.validation-input-bundle.v2', 'model_output_bytes_read': False,
            'readiness_inputs': {key: {'path': self.paths[name].name, 'sha256': self.digest(self.paths[name])}
                for key, name in (('observation_package', 'package'), ('pre_volume_match_audit', 'audit'))}}

    def digest(self, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def assess(self, sources, expected_error=None):
        self.bundle['readiness_inputs']['sources'] = sources
        self.paths['bundle'].write_text(json.dumps(self.bundle))
        original = Path.read_bytes
        reads = []
        def tracked(path):
            if path == self.output: reads.append(path)
            return original(path)
        arguments = dict(observation_package_path=self.paths['package'], pre_volume_match_audit_path=self.paths['audit'],
            validation_input_bundle_path=self.paths['bundle'], comparison_basis_path=self.paths['basis'],
            model_output_path=self.output, assessment_id='synthetic', readiness_root=self.root)
        with patch.object(Path, 'read_bytes', tracked):
            if expected_error:
                with self.assertRaisesRegex(core.ContractError, expected_error):
                    core.assess_frozen_instrument_files(**arguments)
            else:
                result = core.assess_frozen_instrument_files(**arguments)
                self.assertEqual(result['observation_results'][0]['modeled_value'], 100)
        self.assertEqual(len(reads), 0 if expected_error else 1, 'Readiness refusal must precede output access')

    def test_valid_nested_empty_and_legacy_records(self):
        for sources in ([], [self.record], {'nested': [self.record]}, [{k:v for k,v in self.record.items() if k!='bytes'}]):
            with self.subTest(sources=sources): self.assess(sources)

    def test_partial_records_are_not_silently_dropped(self):
        for record in ({'path': self.source.name}, {'sha256': self.record['sha256']}, {'bytes': 0}):
            with self.subTest(record=record): self.assess([record], 'omitted its exact path or hash')

    def test_empty_record_is_not_silently_dropped(self):
        self.assess([{}], 'empty record')

    def test_scalar_record_is_not_silently_dropped(self):
        for record in (None, 'missing', 0, False):
            with self.subTest(record=record): self.assess([record], 'must contain artifact records')

    def test_declared_size_is_checked(self):
        self.assess([{**self.record, 'bytes': self.record['bytes']+1}], 'size changed')

    def test_size_type_is_checked(self):
        self.source.write_bytes(b'x')
        self.record.update(sha256=self.digest(self.source), bytes=1)
        for value in (True, None, -1, str(self.record['bytes'])):
            with self.subTest(value=value): self.assess([{**self.record, 'bytes': value}], 'invalid byte size')


if __name__ == '__main__':
    unittest.main()
