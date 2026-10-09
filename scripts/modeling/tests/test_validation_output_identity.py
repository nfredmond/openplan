"""File assessments must not silently collapse output identities."""
import json
import unittest
from unittest.mock import patch
import test_validation_readiness_records as fixtures

core = fixtures.core


class OutputIdentityTests(unittest.TestCase):
    setUp = fixtures.ReadinessRecordsTests.setUp
    digest = fixtures.ReadinessRecordsTests.digest

    def evaluate(self, payload, error=None):
        self.output.write_bytes(payload)
        basis = json.loads(self.paths['basis'].read_text())
        basis['model_output_artifact']['sha256'] = self.digest(self.output)
        self.paths['basis'].write_text(json.dumps(basis))
        self.paths['bundle'].write_text(json.dumps(self.bundle))
        arguments = dict(observation_package_path=self.paths['package'],
            pre_volume_match_audit_path=self.paths['audit'],
            validation_input_bundle_path=self.paths['bundle'],
            comparison_basis_path=self.paths['basis'], model_output_path=self.output,
            assessment_id='synthetic', readiness_root=self.root)
        with patch.object(core, 'assess_validation', wraps=core.assess_validation) as assess:
            if error:
                with self.assertRaisesRegex(core.ContractError, error):
                    core.assess_frozen_instrument_files(**arguments)
                assess.assert_not_called()
            else:
                result = core.assess_frozen_instrument_files(**arguments)
                assess.assert_called_once()
                self.assertEqual(result['observation_results'][0]['modeled_value'], 100)

    def test_unique_opaque_ids_and_extra_columns(self):
        self.evaluate(b'link_id,PCE_tot,note\na,100,selected\n001,25,other\n1,30,distinct\ntribal:road/7,40,opaque\n')

    def test_duplicate_link_rows_refused(self):
        for second in (100, 200):
            with self.subTest(second=second):
                self.evaluate(f'link_id,PCE_tot\na,100\na,{second}\n'.encode(), 'repeats a link identity')

    def test_duplicate_columns_refused(self):
        for payload in (b'link_id,PCE_tot,PCE_tot\na,100,200\n',
                        b'link_id,link_id,PCE_tot\nx,a,100\n',
                        b'link_id,PCE_tot,note,note\na,100,x,y\n'):
            with self.subTest(payload=payload):
                self.evaluate(payload, 'duplicate column names')

    def test_empty_identity_refused(self):
        for identifier in ('', '   '):
            with self.subTest(identifier=identifier):
                self.evaluate(f'link_id,PCE_tot\na,100\n{identifier},50\n'.encode(), 'empty link identity')


if __name__ == '__main__':
    unittest.main()
