"""Run isolated source mutations; never edit the checkout under test."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
FILES = ('model_command_client.py', 'model_command_journal.py', 'test_model_command_client.py', 'test_model_command_journal.py')


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
        for test in FILES[2:]:
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


if __name__ == '__main__':
    unittest.main()
