"""Synthetic packet references only; no model or frozen study is opened."""
import copy
import hashlib
import json
import unittest
from packet_integrity import validate_packet, build_custody_payload, ARTIFACT_TYPES, SCHEMAS, _rules


def encoded(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def fixture(method='aequilibrae'):
    h = 'a' * 64
    files = {'model_output': b'link_id,PCE_tot\n1,0\n', 'observation_package': encoded({'synthetic': True})}
    audit = {'schema': SCHEMAS['match_audit'], 'network_sha256': h, 'observation_package_sha256': digest(files['observation_package'])}
    files['match_audit'] = encoded(audit)
    files['input_bundle'] = encoded({'schema': SCHEMAS['input_bundle'], 'readiness_inputs': {'observation_package': {'sha256': digest(files['observation_package'])}, 'pre_volume_match_audit': {'sha256': digest(files['match_audit'])}}})
    basis = {'schema': SCHEMAS['comparison_basis'], 'basis_id': 'synthetic', 'model_run_id': 'synthetic-run', 'method': method, 'model_output_artifact': {'sha256': digest(files['model_output'])}, 'model_base_year': 'unknown', 'modeled_quantity': {'name': 'synthetic_expanded_daily_traffic', 'expansion_chain': {'peak_hour_factor': 0.10, 'run_summary_sha256': h, 'conservation_sha256': h}}, 'assignment_period': {}, 'vehicle_basis': {'vehicle_pce_equivalence': {'class_pce': 1, 'assignment_profile_sha256': h}}, 'observation_facts': {}, 'assignment_settings': {}, 'coefficient_package': {}, 'network_state_hashes': {'network': h}, 'acceptance_rule': 'unknown', 'frozen_at': 'synthetic'}
    files['comparison_basis'] = encoded(basis)
    files['assessment'] = encoded({'schema': SCHEMAS['assessment'], 'method': method, 'rules_version': 5, 'scientific_outcome': 'inconclusive', 'exact_inputs': {'validation_input_bundle_sha256': digest(files['input_bundle']), 'observation_package_sha256': digest(files['observation_package']), 'match_audit_sha256': digest(files['match_audit']), 'comparison_basis_sha256': _rules.sha256_payload(basis), 'model_output_sha256': digest(files['model_output']), 'network_sha256': h}})
    files['diagnosis'] = encoded({'schema': SCHEMAS['diagnosis'], 'method': method, 'scientific_outcome': 'inconclusive', 'bindings': {name + '_sha256': digest(data) for name, data in files.items()}})
    return files


class PacketIntegrity(unittest.TestCase):
    def check(self, files, method='aequilibrae'):
        return validate_packet(files, model_run_id='synthetic-run', demand_method=method)

    def test_both_methods_preserve_file_identity(self):
        for method in ('aequilibrae', 'activitysim'):
            files = fixture(method)
            result = self.check(files, method)
            self.assertEqual(result['model_output'], {'sha256': digest(files['model_output']), 'bytes': len(files['model_output'])})

    def test_formatting_has_distinct_file_and_canonical_hashes(self):
        files = fixture()
        files['comparison_basis'] = json.dumps(json.loads(files['comparison_basis']), separators=(',', ':')).encode()
        with self.assertRaisesRegex(ValueError, 'diagnosis file binding mismatch'):
            self.check(files)
        diagnosis = json.loads(files['diagnosis'])
        diagnosis['bindings']['comparison_basis_sha256'] = digest(files['comparison_basis'])
        files['diagnosis'] = encoded(diagnosis)
        self.check(files)

    def test_changed_output_is_refused(self):
        files = fixture(); files['model_output'] += b'2,20\n'
        with self.assertRaisesRegex(ValueError, 'basis output hash mismatch'):
            self.check(files)

    def test_changed_assessment_input_is_refused(self):
        files = fixture(); files['input_bundle'] += b'\n'
        diagnosis = json.loads(files['diagnosis']); diagnosis['bindings']['input_bundle_sha256'] = digest(files['input_bundle']); files['diagnosis'] = encoded(diagnosis)
        with self.assertRaisesRegex(ValueError, 'assessment input binding mismatch'):
            self.check(files)

    def test_wrong_method_and_run_are_refused(self):
        files = fixture()
        with self.assertRaisesRegex(ValueError, 'packet method mismatch'):
            self.check(files, 'activitysim')
        with self.assertRaisesRegex(ValueError, 'packet run mismatch'):
            validate_packet(files, model_run_id='other-run', demand_method='aequilibrae')

    def test_claim_promotion_is_refused(self):
        files = fixture(); assessment = json.loads(files['assessment']); assessment['scientific_outcome'] = 'pass'; files['assessment'] = encoded(assessment)
        with self.assertRaisesRegex(ValueError, 'packet outcome or rules mismatch'):
            self.check(files)


def receipts_for(files, method):
    receipts = {}
    for role in {*SCHEMAS, 'model_output'}:
        metadata = {'demand_method': method} if role == 'model_output' else json.loads(files[role])
        if role == 'assessment':
            metadata = {**metadata, 'demand_method': method}
        receipts[role] = {'id': 'synthetic-' + role, 'file_url': 'storage://run-artifacts/synthetic/' + role, 'run_id': 'synthetic-run', 'stage_id': 'stage', 'attempt_id': 'attempt', 'artifact_type': ARTIFACT_TYPES.get(role) or ('link_volumes' if method == 'aequilibrae' else 'activitysim_link_volumes'), 'content_hash': digest(files[role]), 'file_size_bytes': len(files[role]), 'metadata_json': metadata}
    return receipts


class ReceiptBinding(unittest.TestCase):
    def build(self, files, receipts, method='aequilibrae'):
        return build_custody_payload(files, receipts, model_run_id='synthetic-run', stage_id='stage', attempt_id='attempt', demand_method=method, storage_refs={role: 'storage://run-artifacts/synthetic/' + role for role in {*SCHEMAS, 'model_output'}})

    def test_both_methods_bind_exact_receipts(self):
        for method in ('aequilibrae', 'activitysim'):
            files = fixture(method); receipts = receipts_for(files, method)
            result = self.build(files, receipts, method)
            self.assertEqual(result['demand_method'], method)
            self.assertEqual(result['scientific_outcome'], 'inconclusive')
            for role, receipt in receipts.items():
                self.assertEqual(result[role + '_artifact_id'], receipt['id'])
                self.assertEqual(result[role + '_sha256'], digest(files[role]))

    def test_mismatched_receipts_are_refused(self):
        files = fixture(); receipts = receipts_for(files, 'aequilibrae')
        for field, value, message in (
            ('run_id', 'other', 'ownership mismatch'),
            ('stage_id', 'other', 'ownership mismatch'),
            ('attempt_id', 'old', 'ownership mismatch'),
            ('content_hash', 'b' * 64, 'byte identity mismatch'),
            ('file_size_bytes', True, 'byte identity mismatch'),
            ('file_size_bytes', 0, 'byte identity mismatch'),
            ('artifact_type', 'wrong', 'type mismatch'),
            ('file_url', 'storage://run-artifacts/other', 'storage reference mismatch'),
            ('metadata_json', {}, 'metadata differs from packet'),
        ):
            with self.subTest(field=field, value=value):
                changed = copy.deepcopy(receipts); changed['assessment'][field] = value
                with self.assertRaisesRegex(ValueError, message):
                    self.build(files, changed)

    def test_missing_and_duplicate_receipts_are_refused(self):
        files = fixture(); receipts = receipts_for(files, 'aequilibrae')
        with self.assertRaisesRegex(ValueError, 'incomplete or unexpected'):
            self.build(files, {k: v for k, v in receipts.items() if k != 'assessment'})
        receipts['assessment']['id'] = receipts['model_output']['id']
        with self.assertRaisesRegex(ValueError, 'identity missing or reused'):
            self.build(files, receipts)


if __name__ == '__main__':
    unittest.main()
