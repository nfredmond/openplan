"""Keep the required PR workflows unfiltered, including intermediate stack bases.

This source guard requires the explicit empty mapping form. GitHub execution,
job contents, branch protections and repository permissions are separate checks.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[4]
WORKFLOWS = ('ci.yml', 'rls-isolation.yml', 'worker-security-regression.yml')


def unfiltered_pr_trigger(source):
    # Strip comments, then inspect the two-space event entry inside the on block.
    lines = [line.split('#', 1)[0].rstrip() for line in source.splitlines()]
    try:
        start = lines.index('on:') + 1
    except ValueError:
        return False
    events = []
    for line in lines[start:]:
        if line and not line.startswith(' '):
            break
        if line:
            events.append(line)
    entries = [index for index, line in enumerate(events) if re.match(r'^  pull_request\s*:', line)]
    if len(entries) != 1:
        return False
    index = entries[0]
    if not re.fullmatch(r'  pull_request:\s*\{\s*\}', events[index]):
        return False
    return index + 1 == len(events) or not events[index + 1].startswith('    ')


class StackedPrChecks(unittest.TestCase):
    def test_required_workflows_and_falsifying_controls(self):
        for name in WORKFLOWS:
            with self.subTest(workflow=name):
                source = (ROOT / '.github/workflows' / name).read_text()
                self.assertTrue(unfiltered_pr_trigger(source), name + ' must check every PR base')
                self.assertTrue(unfiltered_pr_trigger('# Harmless comment\n' + source))
                fault = source.replace('  pull_request: {}', '  pull_request:\n    branches: [main]')
                self.assertNotEqual(fault, source)
                self.assertFalse(unfiltered_pr_trigger(fault), 'main-only fault must fail')
                missing = source.replace('  pull_request: {}', '  workflow_call: {}')
                self.assertFalse(unfiltered_pr_trigger(missing), 'missing trigger must fail')


if __name__ == '__main__':
    unittest.main()
