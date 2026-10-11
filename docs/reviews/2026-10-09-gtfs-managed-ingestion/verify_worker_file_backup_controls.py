"""Check the actual file comparison oracle without changing source or snapshots."""
import ast
import copy
import hashlib
import json
from pathlib import Path

BASE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009')
SOURCE = BASE / 'probe_worker_file_backup.py'
PROOF = BASE / 'worker-backup-tool-20261011/native-01'


def comparison(source):
    tree = ast.parse(source)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'equal')
    namespace = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]), '<actual-comparison>', 'exec'), namespace)
    return namespace['equal']


def exercise(source, expected, actual, reason=None):
    try:
        comparison(source)(expected, actual)
    except ValueError as error:
        assert reason == str(error), 'Comparison refusal reason differs'
    else:
        assert reason is None, 'Changed file observation was accepted'


def main():
    original = SOURCE.read_text()
    before = json.loads((PROOF / 'source-inventory-private.json').read_text())
    changed = copy.deepcopy(before)
    changed[next(iter(changed))]['sha256'] = '0' * 64
    missing = copy.deepcopy(before)
    missing.pop(next(iter(missing)))
    mode = copy.deepcopy(before)
    mode[next(iter(mode))]['mode'] ^= 0o040
    reordered = dict(reversed(list(before.items())))
    cases = [
        ('baseline', before, None), ('harmless ordering', reordered, None),
        ('missing file', missing, 'Restored file census differs'),
        ('changed hash', changed, 'Restored file bytes or mode differ'),
        ('changed mode', mode, 'Restored file bytes or mode differ'),
    ]
    for _, actual, reason in cases:
        exercise(original, before, actual, reason)
        exercise('# Harmless comparison comment\n' + original, before, actual, reason)
    mutations = [
        ('omit census guard', "if set(expected)!=set(actual):raise ValueError('Restored file census differs')", 'missing file'),
        ('omit byte guard', "if expected!=actual:raise ValueError('Restored file bytes or mode differ')", 'changed hash'),
        ('omit mode guard', "if expected!=actual:raise ValueError('Restored file bytes or mode differ')", 'changed mode'),
    ]
    outcomes = []
    for name, guard, case in mutations:
        assert original.count(guard) == 1
        _, actual, reason = next(row for row in cases if row[0] == case)
        try:
            exercise(original.replace(guard, 'pass'), before, actual, reason)
        except AssertionError as error:
            outcomes.append({'mutation': name, 'result': 'intended oracle assertion failure', 'reason': str(error)})
        else:
            raise AssertionError('Omitted comparison guard survived')
    exercise(original, before, before)
    assert SOURCE.read_text() == original
    wrong = (PROOF / 'wrong-password-refusal-private.log').read_text()
    absent = (PROOF / 'missing-pack-refusal-private.log').read_text()
    assert 'wrong password or no key found' in wrong
    assert 'pack ' in absent and ': does not exist' in absent
    report = {
        'producerSha256': hashlib.sha256(original.encode()).hexdigest(),
        'baselineAndHarmlessCases': len(cases) * 2, 'brokenGuards': outcomes,
        'restored': True, 'sourceAndSnapshotWrites': 0,
        'nativeWrongPasswordReasonObserved': True, 'nativeMissingPackReasonObserved': True,
        'limits': 'Actual comparison function with copied native inventory observations. No native recapture, worker replay, database or physical-host acceptance.',
    }
    (PROOF / 'comparison-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
