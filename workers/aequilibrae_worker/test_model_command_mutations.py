"""Run isolated source mutations; never edit the checkout under test."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
FILES = ('model_legacy_artifact_command.py', 'test_model_legacy_artifact_client.py', 'model_assessment_values.py', 'model_validation_receipts.py', 'model_receipt_values.py', 'model_publication_values.py', 'test_model_publication_client.py', 'model_command_client.py', 'model_command_journal.py', 'test_model_command_client.py', 'test_model_command_journal.py', 'test_model_command_kpi.py', 'test_model_command_instrument.py', 'test_model_command_ownership.py', 'model_command_recovery.py', 'test_model_command_recovery.py')


class MutationTests(unittest.TestCase):
    def run_case(self, filename=None, old=None, new=None, test='test_model_command_client.py', harmless=False):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            for name in FILES:
                source = (ROOT / name).read_text()
                if name == filename:
                    self.assertEqual(source.count(old), 1, 'mutation anchor must be unique')
                    source = source.replace(old, new)
                if harmless:
                    source += '\n# Harmless control: source formatting does not change semantics.\n'
                (target / name).write_text(source)
            result = subprocess.run([sys.executable, '-B', test], cwd=target, capture_output=True, text=True, timeout=30)
            return result

    def test_harmless_changes_preserve_both_suites(self):
        for test in (name for name in FILES if name.startswith('test_')):
            result = self.run_case(test=test, harmless=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_targeted_breaks_fail_at_stated_boundary(self):
        cases = [
            ('model_command_client.py', "retained = journal.prepare(directory, command)", "retained = {'resolved': False}", 'prepare_before_post'),
            ('model_command_client.py', "if command['destination'] != destination(base_url, deployment_id):", 'if False:', 'invalid_command'),
            ('model_command_client.py', "if receipt.get('run_id') != args['run_id']:", 'if False:', 'invalid_claim_receipts'),
            ('model_command_client.py', "if receipt.get('attempt_id') != args['attempt_id'] or receipt.get('status') != args['status']:", 'if False:', 'invalid_stage_receipts'),
            ('model_command_client.py', "if receipt.get('run_status') not in allowed_parent:", 'if False:', 'invalid_stage_receipts'),
            ('model_command_client.py', "receipt = checked_receipt(command, receipt)", 'receipt = receipt', 'invalid_claim_receipts'),
            ('model_command_client.py', "return journal.resolve(directory, command, receipt)['response']", 'return receipt', 'prepare_before_post'),
            ('model_command_journal.py', "if row[0] != request:", 'if False:', 'changed_request'),
            ('model_command_journal.py', "if row[1] is not None and row[1] != receipt:", 'if False:', 'receipt_is_immutable'),
            ('model_command_journal.py', "if row is None or row[0] != request:", 'if row is None:', 'receipt_is_immutable'),
        ]
        for filename, old, new, boundary in cases:
            with self.subTest(boundary=boundary, old=old):
                test = 'test_model_command_journal.py' if filename.endswith('journal.py') else 'test_model_command_client.py'
                result = self.run_case(filename, old, new, test=test)
                self.assertNotEqual(result.returncode, 0, 'broken behavior escaped checks')
                self.assertIn(boundary, result.stderr)
                self.assertNotIn('SyntaxError', result.stderr)
                self.assertNotIn('ModuleNotFoundError', result.stderr)

    def test_kpi_faults_fail_at_the_quantity_or_custody_boundary(self):
        cases = [
            ("if type(value) not in (int, float):", "if not isinstance(value, (int, float)):", 'missing_or_invalid_value'),
            ("if not math.isfinite(number) or number != value:", "if not math.isfinite(number):", 'missing_or_invalid_value'),
            ("if 'value' not in receipt or _kpi_number(receipt['value']) != _kpi_number(payload['value']):", "if False:", 'changed_value_or_binding'),
            ("raise ValueError('KPI receipt identity or metadata differs')", 'pass', 'changed_value_or_binding'),
            ("_kpi_number(payload['value'])\n\n\ndef _kpi_receipt", "pass\n\n\ndef _kpi_receipt", 'missing_or_invalid_value'),
            ("'breakdown_json': payload.get('breakdown_json', {})", "'breakdown_json': payload.get('breakdown_json') or {}", 'explicit_null_defaults'),
        ]
        for old, new, boundary in cases:
            with self.subTest(boundary=boundary, old=old):
                result = self.run_case('model_command_client.py', old, new, test='test_model_command_kpi.py')
                self.assertNotEqual(result.returncode, 0, 'KPI fault escaped checks')
                self.assertIn(boundary, result.stderr)
                self.assertNotIn('SyntaxError', result.stderr)
                self.assertNotIn('ModuleNotFoundError', result.stderr)

    def test_instrument_faults_fail_at_identity_or_outcome_boundary(self):
        cases = [
            ("if payload['demand_method'] not in ('aequilibrae', 'activitysim') or payload['scientific_outcome'] != 'inconclusive':", 'if False:', 'incomplete_reused_or_promoted'),
            ("if len(set(identities)) != len(identities):", 'if False:', 'incomplete_reused_or_promoted'),
            ("raise ValueError('Instrument artifact hash missing or invalid')", 'pass', 'incomplete_reused_or_promoted'),
            ("raise ValueError('Instrument receipt custody differs')", 'pass', 'each_receipt_binding'),
        ]
        for old, new, boundary in cases:
            with self.subTest(boundary=boundary, old=old):
                result = self.run_case('model_command_client.py', old, new, test='test_model_command_instrument.py')
                self.assertNotEqual(result.returncode, 0, 'Instrument fault escaped checks')
                self.assertIn(boundary, result.stderr)
                self.assertNotIn('SyntaxError', result.stderr)
                self.assertNotIn('ModuleNotFoundError', result.stderr)

    def test_ownership_faults_cannot_reuse_historical_claims(self):
        cases = [
            ("and active == claim_receipt['attempt_id'])", 'and True)', 'retained_receipt_does_not_authorize'),
            ("owns = (stage['attempt_managed'] and run['attempt_managed']", "owns = (stage['attempt_managed']", 'retained_receipt_does_not_authorize'),
            ("and stage['status'] == 'running' and run['status'] == 'running'", "and stage['status'] == 'running'", 'retained_receipt_does_not_authorize'),
            (" or run.get('workspace_id') != workspace_id", '', 'missing_or_mismatched_snapshot'),
            ("'select': 'id,run_id,status,attempt_managed,active_attempt_id,model_runs!inner(id,workspace_id,status,attempt_managed)'", "'select': 'id'", 'required_projection'),
            ("            rows = response.json()", "            rows = response.json()\n            if rows == []: return {'owns_stage': False}", 'missing_or_mismatched_snapshot'),
        ]
        for old, new, boundary in cases:
            with self.subTest(boundary=boundary, old=old):
                result = self.run_case('model_command_client.py', old, new, test='test_model_command_ownership.py')
                self.assertNotEqual(result.returncode, 0, 'Ownership fault escaped checks')
                self.assertIn(boundary, result.stderr)
                self.assertNotIn('SyntaxError', result.stderr)
                self.assertNotIn('ModuleNotFoundError', result.stderr)

    def test_recovery_selects_existing_exact_requests(self):
        cases = [
            ('model_command_recovery.py', "if command['destination'] != bound or (request_id is not None and command['request_id'] != request_id):", 'if False:', 'corrupted_request_identity'),
            ('model_command_recovery.py', "command = records[0]['command']", "command = {**records[0]['command'], 'request_id': '00000099-1111-4111-8111-111111111111'}", 'saved_request_recovers'),
            ('model_command_journal.py', "path.as_uri() + '?mode=ro'", "path.as_uri() + '?mode=rwc'", 'read created a journal'),
        ]
        for filename, old, new, boundary in cases:
            with self.subTest(boundary=boundary):
                result = self.run_case(filename, old, new, test='test_model_command_recovery.py')
                self.assertNotEqual(result.returncode, 0, 'Recovery fault escaped checks')
                self.assertIn(boundary, result.stderr)
                self.assertNotIn('SyntaxError', result.stderr)
                self.assertNotIn('ModuleNotFoundError', result.stderr)


    def test_publication_faults_fail_at_command_or_receipt_boundary(self):
        cases = [
            ('or any(receipt.get(key) != value', 'or any(False and receipt.get(key) != value', 'mismatched_receipts_stay_pending'),
            ('not same_json_value(row[key], value)', 'False', 'mismatched_receipts_stay_pending'),
            ('not same_json_value(row[key], value)', 'row[key] != value', 'mismatched_receipts_stay_pending'),
            ("if len(evidence['metrics']) != len(expected_metrics):", 'if False:', 'mismatched_receipts_stay_pending'),
            ("if row['id'] in identities or row['metric_key'] in keys:", "if row['metric_key'] in keys:", 'mismatched_receipts_stay_pending'),
            ("if prior_claims and claim['id'] != prior_claims[0]['id']:", 'if False:', 'prior_claim_identity_cannot_change'),
            ('if any(row.get(key) != value', 'if any(False and row.get(key) != value', 'invalid_commands_never_contact_transport'),
            ("claim['claim_status'] != 'prototype_only' or ", '', 'invalid_commands_never_contact_transport'),
            ("or type(row['blocks_claim_grade']) is not bool ", '', 'invalid_commands_never_contact_transport'),
            ("if row['metric_key'] in keys:", 'if False:', 'invalid_commands_never_contact_transport'),
        ]
        for old, new, boundary in cases:
            with self.subTest(boundary=boundary, old=old):
                result = self.run_case('model_publication_values.py', old, new, test='test_model_publication_client.py')
                self.assertNotEqual(result.returncode, 0, 'Publication fault escaped checks')
                self.assertIn(boundary, result.stderr)
                self.assertNotIn('SyntaxError', result.stderr)
                self.assertNotIn('ModuleNotFoundError', result.stderr)


    def test_legacy_artifact_faults_fail_at_saved_identity_or_receipt(self):
        cases = [
            ("if any(args[key] != payload[key] for key in ('run_id', 'stage_id')):", 'if False:', 'invalid_commands_never_send'),
            ("if journal.canonical({key: receipt[key] for key in expected}) != journal.canonical(expected):", 'if False:', 'mismatched_receipts_stay_pending'),
            ("'artifact_id': payload['id']", "'artifact_id': payload", 'stable_identity_and_conflicting_request'),
            ("if type(size) is not int or not 0 <= size <= 9223372036854775807:", 'if False:', 'invalid_commands_never_send'),
        ]
        for old, new, boundary in cases:
            with self.subTest(boundary=boundary):
                result = self.run_case('model_legacy_artifact_command.py', old, new, test='test_model_legacy_artifact_client.py')
                self.assertNotEqual(result.returncode, 0, 'Artifact fault escaped checks')
                self.assertIn(boundary, result.stderr)
                self.assertIn('FAIL:', result.stderr)
                self.assertNotIn('SyntaxError', result.stderr)
                self.assertNotIn('ModuleNotFoundError', result.stderr)


if __name__ == '__main__':
    unittest.main()
