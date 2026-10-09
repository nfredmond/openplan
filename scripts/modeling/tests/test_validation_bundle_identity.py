"""A bundle cannot relabel exact inputs as a different study or geography."""
import json
import unittest
import test_validation_source_records as fixtures

instrument = fixtures.instrument


class BundleIdentityTests(unittest.TestCase):
    setUp = fixtures.SourceRecordsTests.setUp
    build = fixtures.SourceRecordsTests.build

    def rewrite(self, key, change):
        path = self.arguments[key]
        value = json.loads(path.read_text()); change(value)
        path.write_text(json.dumps(value))
        # Keep the independently tested byte bindings valid so these cases
        # reach the study/geography identity checks.
        if key in ('registry_path', 'observation_package_path'):
            audit_path = self.arguments['match_audit_path']
            audit = json.loads(audit_path.read_text())
            field = 'registry_sha256' if key == 'registry_path' else 'observation_package_sha256'
            audit[field] = instrument.sha256_file(path)
            audit_path.write_text(json.dumps(audit))

    def test_opaque_geography_descriptor_is_preserved(self):
        geography = {'geography_id': 'custom:overlap/alpha', 'authority_ids': ['synthetic-a', 'synthetic-b'],
                     'study_geometry_id': 'synthetic-polygon', 'home_jurisdiction_id': 'synthetic-home'}
        self.arguments['geography_id'] = geography['geography_id']
        self.rewrite('observation_package_path', lambda value: value.update(geography=geography))
        self.rewrite('match_audit_path', lambda value: value.update(geography=geography))
        bundle = self.build([self.record])
        self.assertEqual(bundle['geography_id'], geography['geography_id'])
        self.assertEqual(bundle['study_id'], 'synthetic')

    def test_requested_study_cannot_relabel_package(self):
        self.arguments['study_id'] = 'different'
        with self.assertRaisesRegex(instrument.InstrumentV2Error, 'study identity differs'):
            self.build([self.record])

    def test_registry_study_must_match(self):
        self.rewrite('registry_path', lambda value: value.update(study_id='different'))
        self.rewrite('observation_package_path', lambda value: value.update(
            registry_artifact=instrument.artifact_record(self.arguments['registry_path'], relative_to=self.root)))
        with self.assertRaisesRegex(instrument.InstrumentV2Error, 'study identity differs'):
            self.build([self.record])

    def test_requested_geography_cannot_relabel_package(self):
        self.arguments['geography_id'] = 'different'
        with self.assertRaisesRegex(instrument.InstrumentV2Error, 'geography identity differs'):
            self.build([self.record])

    def test_audit_descriptor_must_match_package(self):
        self.rewrite('match_audit_path', lambda value: value['geography'].update(home_jurisdiction_id='different'))
        with self.assertRaisesRegex(instrument.InstrumentV2Error, 'audit geography differs'):
            self.build([self.record])

    def test_package_registry_hash_must_match(self):
        self.rewrite('observation_package_path', lambda value: value['registry_artifact'].update(sha256='0'*64))
        with self.assertRaisesRegex(instrument.InstrumentV2Error, 'registry binding differs'):
            self.build([self.record])

    def test_empty_identity_is_refused(self):
        for key in ('study_id', 'geography_id'):
            for value in ('', ' ', None, 1):
                with self.subTest(key=key, value=value):
                    self.setUp()
                    self.arguments[key] = value
                    if key == 'study_id':
                        self.rewrite('registry_path', lambda data: data.update(study_id=value))
                        self.rewrite('observation_package_path', lambda data: data.update(study_id=value,
                            registry_artifact=instrument.artifact_record(self.arguments['registry_path'], relative_to=self.root)))
                    else:
                        self.rewrite('observation_package_path', lambda data: data['geography'].update(geography_id=value))
                        self.rewrite('match_audit_path', lambda data: data['geography'].update(geography_id=value))
                    with self.assertRaisesRegex(instrument.InstrumentV2Error, 'nonempty strings'):
                        self.build([self.record])

    def test_package_study_must_match(self):
        self.rewrite('observation_package_path', lambda value: value.update(study_id='different'))
        with self.assertRaisesRegex(instrument.InstrumentV2Error, 'study identity differs'):
            self.build([self.record])


if __name__ == '__main__':
    unittest.main()
