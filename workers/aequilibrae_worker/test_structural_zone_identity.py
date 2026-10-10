"""Structural audit must preserve each input zone without rounding or collapse."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import model_structural_input_audit as audit


class ZoneIdentityTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name);self.path=self.root/'input.csv'

    def test_large_zone_ids_remain_distinct(self):
        self.path.write_text('origin_zone,9007199254740992,9007199254740993\n9007199254740992,1,2\n9007199254740993,3,4\n')
        ids,matrix=audit._read_matrix(self.path)
        self.assertEqual(ids,[9007199254740992,9007199254740993])
        self.assertEqual(matrix,[[1,2],[3,4]])
        self.path.write_text('zone_id,name\n9007199254740992,first\n9007199254740993,second\n')
        rows,zones=audit._read_zones(self.path)
        self.assertEqual(list(zones),ids);self.assertEqual(zones[ids[1]]['name'],'second')

    def test_integral_decimal_and_exponent_spellings_preserve_identity(self):
        self.path.write_text('origin_zone,1.0,2e0\n1,0,4\n2.000,3,0\n')
        self.assertEqual(audit._read_matrix(self.path),([1,2],[[0,4],[3,0]]))

    def test_fractional_or_nonfinite_identifiers_are_refused(self):
        for identifier in ('1.9','NaN','Infinity','-Infinity',''):
            with self.subTest(identifier=identifier):
                self.path.write_text(f'origin_zone,{identifier}\n{identifier},1\n')
                with self.assertRaisesRegex(audit.StructuralAuditRefused,'unreadable zone ids'):
                    audit._read_matrix(self.path)
                self.path.write_text(f'zone_id,name\n{identifier},bad\n')
                with self.assertRaisesRegex(audit.StructuralAuditRefused,'finite integers'):
                    audit._read_zones(self.path)

    def test_duplicate_matrix_ids_are_refused(self):
        self.path.write_text('origin_zone,1,1.0\n1,2,3\n1.0,4,5\n')
        with self.assertRaisesRegex(audit.StructuralAuditRefused,'unique zone ids'):audit._read_matrix(self.path)

    def test_empty_matrix_row_has_a_structural_refusal(self):
        self.path.write_text('origin_zone,1\n\n')
        with self.assertRaisesRegex(audit.StructuralAuditRefused,'unreadable zone ids'):audit._read_matrix(self.path)

    def test_duplicate_zone_table_is_refused_before_audit_computation(self):
        self.path.write_text('zone_id,name\n1,first\n1.0,second\n')
        arguments={name+'_path':self.path for name in ('registry','predecessor_registry','observation_package','match_audit','network','boundary','zone_attributes','od_matrix','demand_layers','assignment_profile','network_setup_summary')}
        with patch.object(audit,'_read_matrix',side_effect=AssertionError('Invalid zones reached demand computation')) as matrix:
            with self.assertRaisesRegex(audit.StructuralAuditRefused,'unique zone ids'):
                audit.build_structural_input_audit(repo_root=self.root,audit_id='synthetic',geography={'id':'opaque'},method='aequilibrae',source_vintages={},person_to_vehicle_conversion='unknown',created_at='2026-10-09T00:00:00Z',release={},**arguments)
            matrix.assert_not_called()

    def test_empty_or_missing_zone_column_is_refused(self):
        for content in ('zone_id,name\n','id,name\n1,first\n'):
            self.path.write_text(content)
            with self.assertRaises(audit.StructuralAuditRefused):audit._read_zones(self.path)


if __name__=='__main__':unittest.main()
