"""Retained structural evidence must match before the worker opens output."""
import copy
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'workers/aequilibrae_worker'))
import model_structural_input_audit as core
from worker_import_for_tests import import_worker_main

main = import_worker_main()


class PreparationFilesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root/'output.csv'
        self.output.write_bytes(b'never open this output during preparation')
        self.source = self.root/'network.bin.gz'
        self.source.write_bytes(gzip.compress(b'synthetic network', mtime=0))
        self.audit_path = self.root/'audit.json'
        self.audit = {'schema': core.AUDIT_SCHEMA, 'method': 'aequilibrae',
            'geography': {'study_geometry': 'opaque/7', 'authorities': ['tribal', 'regional']},
            'frozen_before_model_output': True, 'model_output_bytes_read': False,
            'source_hashes': {'network': core.artifact(self.source, root=self.root)},
            'demand_distribution': {'row_column_difference': 0, 'unreachable_od_trips': 0},
            'network_loading_readiness': {'demand_removed_as_unreachable': 0,
                'facility_coverage': {'local': 1}, 'loadable_roadway_links': 1,
                'structurally_unreachable_roadway_links': 0},
            'external_and_through_travel': {'non_work_through_travel': 'unsupported',
                'through_share_evidence': 'unknown'}}
        self.freeze()

    def freeze(self):
        self.audit_path.write_text(json.dumps(self.audit))
        self.expected = dict(expected_structural_audit_sha256=hashlib.sha256(self.audit_path.read_bytes()).hexdigest(),
            expected_method=self.audit['method'], expected_geography=copy.deepcopy(self.audit['geography']),
            expected_structural_sources=copy.deepcopy(self.audit['source_hashes']))

    def call(self, error=None):
        original = Path.read_bytes
        def read(path):
            if path == self.output:
                raise AssertionError('Preparation opened model output')
            return original(path)
        with patch.object(Path, 'read_bytes', read), patch.object(main.model_validation_core_v5, 'assess_frozen_instrument_files', return_value={'synthetic': True}) as assess:
            def invoke():
                return main.assess_rules_v5_validation_instrument(
                    observation_package_path='not-opened', pre_volume_match_audit_path='not-opened',
                    validation_input_bundle_path='not-opened', comparison_basis_path='not-opened',
                    structural_input_audit_path=str(self.audit_path), link_volumes_csv=str(self.output),
                    assessment_id='synthetic', readiness_root=str(self.root),
                    expected_model_run_id='synthetic-run', expected_input_bundle_sha256='1'*64,
                    expected_comparison_basis_sha256='2'*64, **self.expected)
            if error:
                with self.assertRaisesRegex(core.StructuralAuditRefused, error): invoke()
                assess.assert_not_called()
            else:
                self.assertEqual(invoke(), {'synthetic': True})
                assess.assert_called_once()
                context = assess.call_args.kwargs['prepared_context']
                self.assertEqual(context.model_run_id, 'synthetic-run')
                self.assertEqual(context.method, self.expected['expected_method'])
                self.assertEqual(context.input_bundle_sha256, '1'*64)
                self.assertEqual(context.comparison_basis_sha256, '2'*64)

    def test_valid_compressed_and_plain(self):
        self.call()
        self.source = self.root/'network.bin'
        self.source.write_bytes(b'synthetic plain network')
        self.audit['source_hashes']['network'] = core.artifact(self.source, root=self.root)
        self.freeze()
        self.call()

    def test_audit_hash(self):
        self.expected['expected_structural_audit_sha256'] = '0'*64
        self.call('audit differs')

    def test_method(self):
        self.expected['expected_method'] = 'activitysim'
        self.call('method differs')

    def test_geography(self):
        self.expected['expected_geography']['authorities'].reverse()
        self.call('geography differs')

    def test_sources(self):
        self.expected['expected_structural_sources']['network']['sha256'] = '0'*64
        self.call('sources differ')

    def test_stored_bytes(self):
        self.source.write_bytes(gzip.compress(b'changed source', mtime=0))
        self.call('stored source bytes changed')

    def test_logical_bytes(self):
        self.audit['source_hashes']['network']['sha256'] = '0'*64
        self.freeze()
        self.call('logical source bytes changed')

    def test_logical_path(self):
        self.audit['source_hashes']['network']['path'] = 'other.bin'
        self.freeze()
        self.call('logical source path differs')

    def test_output_alias(self):
        # Hashes are known by fixture construction, never read by preparation.
        record = core.artifact(self.output, root=self.root)
        self.audit['source_hashes']['network'] = record
        self.freeze()
        self.call('aliases model output')

    def test_invalid_size(self):
        self.audit['source_hashes']['network']['bytes'] = True
        self.freeze()
        self.call('malformed')

    def test_audit_contents(self):
        self.audit['model_output_bytes_read'] = True
        self.freeze()
        self.call('opened before')

    def test_record_shape(self):
        self.audit['source_hashes']['network'] = None
        self.freeze()
        self.call('malformed')

    def test_logical_size(self):
        self.audit['source_hashes']['network']['bytes'] += 1
        self.freeze()
        self.call('logical source bytes changed')

    def test_unavailable(self):
        self.source.unlink()
        self.call('unavailable')


if __name__ == '__main__':
    unittest.main()
