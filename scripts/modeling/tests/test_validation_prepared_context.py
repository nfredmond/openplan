"""Retained run identities bind the exact files evaluated before output access."""
from dataclasses import replace
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import test_validation_readiness_records as fixtures

core = fixtures.core


class PreparedContextTests(unittest.TestCase):
    setUp = fixtures.ReadinessRecordsTests.setUp
    digest = fixtures.ReadinessRecordsTests.digest

    def evaluate(self, change=None, error=None):
        self.paths['bundle'].write_text(json.dumps(self.bundle))
        context = core.PreparedValidationContext('run', 'aequilibrae',
            self.digest(self.paths['bundle']), self.digest(self.paths['basis']))
        if change: context = replace(context, **change)
        reads = []
        original = Path.read_bytes
        def read(path):
            if path == self.output: reads.append(path)
            return original(path)
        with patch.object(Path, 'read_bytes', read):
            def invoke():
                return core.assess_frozen_instrument_files(
                    observation_package_path=self.paths['package'], pre_volume_match_audit_path=self.paths['audit'],
                    validation_input_bundle_path=self.paths['bundle'], comparison_basis_path=self.paths['basis'],
                    model_output_path=self.output, assessment_id='synthetic', readiness_root=self.root,
                    prepared_context=context)
            if error:
                with self.assertRaisesRegex(core.ContractError, error): invoke()
            else:
                self.assertEqual(invoke()['observation_results'][0]['modeled_value'], 100)
        self.assertEqual(len(reads), 0 if error else 1)

    def test_valid_context(self):
        self.evaluate()

    def test_bundle_hash(self):
        self.evaluate({'input_bundle_sha256': '0'*64}, 'bundle differs')

    def test_basis_hash(self):
        self.evaluate({'comparison_basis_sha256': '0'*64}, 'basis differs')

    def test_cross_run_or_method(self):
        for change in ({'model_run_id': 'another-run'}, {'method': 'activitysim'}):
            with self.subTest(change=change): self.evaluate(change, 'run or method differs')

    def test_invalid_context(self):
        # A matching invalid basis cannot make an invalid expectation acceptable.
        for field, value in (('model_run_id', ''), ('method', 'combined')):
            basis = json.loads(self.paths['basis'].read_text())
            basis[field] = value
            self.paths['basis'].write_text(json.dumps(basis))
            with self.subTest(field=field): self.evaluate({field:value}, 'invalid run or method')
            basis['model_run_id']='run'; basis['method']='aequilibrae'
            self.paths['basis'].write_text(json.dumps(basis))


if __name__ == '__main__':
    unittest.main()
