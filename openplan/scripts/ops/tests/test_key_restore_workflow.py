"""Check key-only restore triggers and executable proof commands in the YAML."""
import json
from pathlib import Path
import re
import shlex
import unittest

REPO = Path(__file__).resolve().parents[4]
WORKFLOW = REPO / '.github/workflows/restore-drill.yml'


class KeyRestoreWorkflowTests(unittest.TestCase):
    def test_key_only_changes_trigger_restore(self):
        text = WORKFLOW.read_text()
        block = re.search(r'^  pull_request:\n    paths:\n((?:      - .+\n)+)', text, re.M)
        self.assertIsNotNone(block, 'Restore paths must belong to pull_request')
        patterns = [json.loads(line.strip()[2:]) for line in block[1].splitlines()]
        for path in ['openplan/scripts/ops/database_key_custody.py',
                     'openplan/scripts/ops/tests/test_database_key_custody.py',
                     'openplan/scripts/ops/tests/prove_key_custody_mutations.py']:
            with self.subTest(path=path):
                self.assertIn(path, patterns, 'Key-only change needs an explicit restore path: ' + path)

    def test_key_controls_run_and_retain_evidence(self):
        text = WORKFLOW.read_text()
        block = re.search(r'^      - name: Prove restoration guards\n        run: \|\n((?:          .+\n)+)', text, re.M)
        self.assertIsNotNone(block, 'Proof commands must belong to the run step')
        commands = [shlex.split(line.strip()) for line in block[1].splitlines()
                    if not line.lstrip().startswith('#')]
        self.assertIn(['python3', '-B', 'scripts/ops/tests/prove_key_custody_mutations.py',
                       '$RUNNER_TEMP/openplan-restore-evidence/key-custody-mutations.json'], commands)

    def test_native_command_uses_full_archive(self):
        commands = [shlex.split(line.split('run:', 1)[1].strip())
                    for line in WORKFLOW.read_text().splitlines()
                    if line.startswith('      - run:')]
        self.assertIn(['npm', 'run', 'ops:restore-drill', '--', '--full-archive'], commands)


if __name__ == '__main__':
    unittest.main()
