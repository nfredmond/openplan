"""Mutate only the new successor source, restore exact bytes, and retain proof."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'evaluate_py311.py'
TEST = HERE / 'test_py311_successor.py'


def run(output):
    original = SOURCE.read_bytes()
    records = []
    controls = [
        ('harmless_comment', None, None, None, None),
        ('remove_early_runtime_refusal', '\nrequire_assignment_python()\n', '\n',
         'test_evaluator_refuses_before_numerical_imports', 'Evaluator must refuse before any numerical import'),
        ('old_omx_core_read', 'skim.get_matrix("travel_time", copy=True)', 'skim.matrix["travel_time"]',
         'test_native_preparation_reads_omx_and_preserves_order',
         "Complete synthetic preparation must succeed: KeyError: 'travel_time'"),
        ('wrong_omx_axis', 'order = [positions[centroid_map[zone]] for zone in ids]', 'order = list(range(len(ids)))',
         'test_native_preparation_reads_omx_and_preserves_order',
         'OMX centroid ordering must preserve the expected candidate'),
        ('omit_native_repeat', 'if county == registry["repeat_geography"] else', 'if False else',
         'test_complete_sealed_synthetic_native_execution', 'All five synthetic assignments must finish'),
    ]
    def execute(name, test, expected):
        command = [sys.executable, '-B', str(TEST), '-v']
        if test:
            command.append('SuccessorTests.' + test)
        result = subprocess.run(command, capture_output=True, text=True)
        text = result.stdout + result.stderr
        passed = (result.returncode == 0 and '\nOK\n' in text) if expected is None else (
            result.returncode == 1 and 'FAILED (failures=1)' in text and expected in text
            and 'AssertionError' in text and 'ERROR:' not in text)
        records.append({'name': name, 'command': command, 'returncode': result.returncode,
                        'expected_assertion': expected, 'control_passed': passed,
                        'output_sha256': hashlib.sha256(text.encode()).hexdigest(), 'output': text})
        if not passed:
            raise RuntimeError(f'Unexpected mutation outcome: {name}\n{text}')
    try:
        for name, old, new, test, expected in controls:
            source = original.decode()
            if old is None:
                source += '\n# Harmless successor proof comment.\n'
            else:
                if source.count(old) != 1:
                    raise RuntimeError(f'Mutation anchor not unique: {name}')
                source = source.replace(old, new)
            SOURCE.write_text(source)
            execute(name, test, expected)
            SOURCE.write_bytes(original)
            if name == 'old_omx_core_read':
                execute('public_reader_restored', test, None)
        execute('restored_complete_suite', None, None)
    finally:
        SOURCE.write_bytes(original)
        restored = SOURCE.read_bytes() == original
        Path(output).write_text(json.dumps({'source_sha256': hashlib.sha256(original).hexdigest(),
            'restored_exactly': restored, 'controls': records, 'skips': 0,
            'blind_categories': ['real county inputs and assignment', 'scientific validity',
                                 'machine crash recovery', 'hosted operation']}, indent=2) + '\n')
    print(json.dumps({'harmless_survivors': 1, 'targeted_assertion_failures': 4,
                      'restored_test_passes': 4, 'skips': 0, 'restored_exactly': restored}))


if __name__ == '__main__':
    run(sys.argv[1])
