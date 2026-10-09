"""Source records must match retained files before bundle construction."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import validation_instrument_v2 as instrument


class SourceRecordsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root/'source.dat'
        self.source.write_bytes(b'synthetic source')
        self.record = instrument.artifact_record(self.source, relative_to=self.root)
        paths = {name: self.root/(name+'.json') for name in ('registry', 'network', 'profile', 'package', 'audit')}
        for path in paths.values(): path.write_text('{}')
        paths['registry'].write_text(json.dumps({'study_id': 'synthetic'}))
        geography = {'geography_id': 'synthetic', 'name': 'Synthetic study geometry'}
        paths['package'].write_text(json.dumps({'schema': instrument.PACKAGE_SCHEMA,
            'study_id': 'synthetic', 'geography': geography,
            'registry_artifact': instrument.artifact_record(paths['registry'], relative_to=self.root),
            'observations': [], 'series_count': 0, 'measurement_count': 0}))
        paths['audit'].write_text(json.dumps({'schema': instrument.MATCH_AUDIT_SCHEMA,
            'frozen_before_model_volume': True, 'model_output_bytes_read': False, 'matches': [], 'geography': geography,
            'network_sha256': instrument.sha256_file(paths['network']),
            'observation_package_sha256': instrument.sha256_file(paths['package']),
            'registry_sha256': instrument.sha256_file(paths['registry'])}))
        self.arguments = dict(study_id='synthetic', geography_id='synthetic', registry_path=paths['registry'],
            network_path=paths['network'], observation_package_path=paths['package'], match_audit_path=paths['audit'],
            assignment_profile_path=paths['profile'], relative_to=self.root)

    def build(self, records):
        return instrument.build_input_bundle(**self.arguments, source_artifacts=records)

    def test_exact_source_and_empty_list_preserve_declared_content(self):
        record = {**self.record, 'fixture_note': 'harmless metadata'}
        bundle = self.build([record])
        self.assertEqual(bundle['readiness_inputs']['sources'], [record])
        record['path'] = 'later change'
        self.assertEqual(bundle['readiness_inputs']['sources'][0]['path'], self.record['path'])
        self.assertEqual(self.build([])['readiness_inputs']['sources'], [])
        absolute = {**self.record, 'path': str(self.source)}
        self.assertEqual(self.build([absolute])['readiness_inputs']['sources'], [absolute])

    def test_changed_source_bytes_are_refused(self):
        self.source.write_bytes(b'Synthetic source')
        with self.assertRaisesRegex(instrument.InstrumentV2Error, 'bytes differ'):
            self.build([self.record])

    def test_wrong_size_is_refused(self):
        with self.assertRaisesRegex(instrument.InstrumentV2Error, 'bytes differ'):
            self.build([{**self.record, 'bytes': self.record['bytes']+1}])

    def test_missing_file_and_directory_are_refused(self):
        for label in ('absent', '.'):
            with self.subTest(label=label), self.assertRaisesRegex(instrument.InstrumentV2Error, 'unavailable'):
                self.build([{**self.record, 'path': label}])

    def test_malformed_collection_is_refused(self):
        for records in (None, {}, '', b''):
            with self.subTest(records=records), self.assertRaisesRegex(instrument.InstrumentV2Error, 'sequence of records'):
                self.build(records)

    def test_malformed_records_are_refused(self):
        records = [None, 'source']
        for key, value in (('path', ''), ('path', None), ('sha256', 'x'*64), ('sha256', None),
                           ('bytes', True), ('bytes', -1), ('bytes', None)):
            records.append({**self.record, key: value})
        for key in ('path', 'sha256', 'bytes'):
            value = copy.copy(self.record); value.pop(key); records.append(value)
        for record in records:
            with self.subTest(record=record), self.assertRaises(instrument.InstrumentV2Error):
                self.build([record])


if __name__ == '__main__':
    unittest.main()
