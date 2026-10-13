"""Pin the reviewed aerial execution recipe while changing its CI wrapper only.

This dated comparator is not a YAML parser or proof that GitHub executes a job.
Its body hash preserves the actual reviewed job and every test command.
"""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT/'.github/workflows/odm-worker-regression.yml'


def verify(text, execution_hash):
    limits = re.findall(r'^    timeout-minutes: (\d+)$', text, flags=re.MULTILINE)
    if limits != ['20']:
        raise ValueError('Aerial CI wrapper must retain its reviewed twenty-minute bound')
    body = '\n'.join(line for line in text.splitlines()
        if not line.startswith('#') and not line.startswith('    timeout-minutes:'))+'\n'
    if hashlib.sha256(body.encode()).hexdigest() != execution_hash:
        raise ValueError('Reviewed aerial execution commands or configuration differ')


def run():
    evidence = Path(__file__).with_name('evidence')
    binding = json.loads((evidence/'execution-binding.json').read_text())
    original = WORKFLOW.read_text()
    rows = []
    for name, text, reason in [
        ('baseline', original, None),
        ('harmless-comment', original+'# Harmless wrapper review comment.\n', None),
        ('preceding-ten-minute-wrapper', original.replace('timeout-minutes: 20', 'timeout-minutes: 10'),
            'Aerial CI wrapper must retain its reviewed twenty-minute bound'),
        ('unbounded-wrapper', original.replace('timeout-minutes: 20', 'timeout-minutes: 999'),
            'Aerial CI wrapper must retain its reviewed twenty-minute bound'),
        ('final-journal-controls-removed', original[:original.index('      - name: Retired SQLite companion controls')],
            'Reviewed aerial execution commands or configuration differ'),
        ('execution-deadline-added', original.replace('python3 -B "$suite"', 'timeout 1s python3 -B "$suite"'),
            'Reviewed aerial execution commands or configuration differ'),
        ('restored', WORKFLOW.read_text(), None),
    ]:
        try:verify(text, binding['executionSha256'])
        except ValueError as error:
            assert reason is not None and str(error) == reason, 'Wrong CI wrapper control failure'
            outcome = 'intended_failure'
        else:
            assert reason is None, 'Broken CI wrapper control survived'
            outcome = 'survived'
        rows.append({'control':name, 'outcome':outcome, 'reason':reason})
    assert WORKFLOW.read_text() == original, 'Workflow changed during wrapper controls'
    (evidence/'controls.json').write_text(json.dumps(rows, indent=2)+'\n')
    print(json.dumps({'controls':len(rows), 'survivors':3, 'faults':4, 'executionUnchanged':True}))


if __name__ == '__main__':run()
