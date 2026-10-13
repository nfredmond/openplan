"""Pin this executed recipe without rewriting its preceding frozen binding."""
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def run():
    old = ROOT / 'docs/reviews/2026-10-13-odm-ci-job-budget/verify_controls.py'
    spec = importlib.util.spec_from_file_location('preceding_reviewed_wrapper_comparator', old)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    evidence = Path(__file__).with_name('evidence')
    binding = json.loads((evidence / 'execution-binding.json').read_text())
    workflow = ROOT / '.github/workflows/odm-worker-regression.yml'
    original = workflow.read_text()
    rows = []
    source_command = 'python3 -B docs/reviews/2026-10-13-odm-task-observation/verify_controls.py'
    retained_command = 'python3 -B docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py'
    for name, text, reason in [
        ('baseline', original, None),
        ('harmless-comment', original + '# Harmless current recipe note.\n', None),
        ('source-metadata-command-removed', original.replace(source_command, 'true # removed'),
         'Reviewed aerial execution commands or configuration differ'),
        ('retained-metadata-command-removed', original.replace(retained_command, 'true # removed'),
         'Reviewed aerial execution commands or configuration differ'),
        ('per-suite-deadline-added', original.replace('python3 -B "$suite"', 'timeout 1s python3 -B "$suite"'),
         'Reviewed aerial execution commands or configuration differ'),
        ('preceding-ten-minute-wrapper', original.replace('timeout-minutes: 20', 'timeout-minutes: 10'),
         'Aerial CI wrapper must retain its reviewed twenty-minute bound'),
        ('unbounded-wrapper', original.replace('timeout-minutes: 20', 'timeout-minutes: 999'),
         'Aerial CI wrapper must retain its reviewed twenty-minute bound'),
        ('restored', workflow.read_text(), None),
    ]:
        try:
            helper.verify(text, binding['executionSha256'])
        except ValueError as error:
            if reason is None or str(error) != reason:
                raise AssertionError('Current recipe failure differs: ' + name) from error
            outcome = 'intended_failure'
        else:
            if reason is not None:
                raise AssertionError('Broken current recipe survived: ' + name)
            outcome = 'survived'
        rows.append({'control':name, 'outcome':outcome, 'reason':reason})
    if workflow.read_text() != original:
        raise AssertionError('Current recipe changed during comparator controls')
    (evidence / 'recipe-controls.json').write_text(json.dumps(rows, indent=2) + '\n')
    (evidence / 'recipe-controller-binding.json').write_text(json.dumps({str(p.relative_to(ROOT)):
        hashlib.sha256(p.read_bytes()).hexdigest() for p in (Path(__file__), old)}, indent=2) + '\n')
    print(json.dumps({'controls':len(rows), 'survivors':3, 'faults':5,
                      'scope':'Executed33-stage recipe comparator, not GitHub execution or general YAML interpretation'}))


if __name__ == '__main__':
    run()
