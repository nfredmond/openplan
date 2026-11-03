"""Retain runtime and mutation proof without opening any scientific partition."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
WORKER = ROOT / 'workers/aequilibrae_worker'
HERE = Path(__file__).parent


def prove(output, incompatible_python):
    records = []
    sources = [WORKER / name for name in ('assignment_runtime.py', 'assignment_settings.py',
               'check_local_dependencies.py')] + [ROOT / 'scripts/modeling/screening_runtime.py',
               HERE / 'test_measurement_contract.py', HERE / 'trace_retained_measurement.py',
               HERE / 'test_successor.py']
    originals = {path: path.read_bytes() for path in sources}

    def run(name, test, expected=None, interpreter=sys.executable):
        path, *selector = test
        command = [interpreter, '-B', str(path), '-v', *selector]
        process = subprocess.run(command, text=True, capture_output=True, timeout=60)
        text = process.stdout + process.stderr
        okay = (process.returncode == 0 and '\nOK\n' in text) if expected is None else (
            process.returncode == 1 and 'FAILED (failures=1)' in text
            and expected in text and 'AssertionError' in text and 'ERROR:' not in text)
        records.append({'name': name, 'command': command, 'exit_code': process.returncode,
                        'expected_assertion': expected, 'matched_expectation': okay,
                        'output': text, 'output_sha256': hashlib.sha256(text.encode()).hexdigest()})
        if not okay:
            raise RuntimeError(f'Unexpected control outcome: {name}\n{text}')

    guard_test = WORKER / 'test_assignment_runtime.py'
    native_test = HERE / 'test_measurement_contract.py'
    controls = [
        ('remove_interpreter_admission', WORKER / 'assignment_runtime.py',
         "if platform.python_implementation() != 'CPython' or sys.version_info[:2] != (3, 11):", 'if False:',
         'test_builder_refuses_python314_before_engine_construction', 'Engine factory must not run'),
        ('remove_worker_factory_admission', WORKER / 'assignment_settings.py',
         '    require_assignment_python()\n    settings =', '    settings =',
         'test_builder_refuses_python314_before_engine_construction', 'Engine factory must not run'),
        ('remove_launcher_admission', WORKER / 'check_local_dependencies.py',
         '        require_assignment_python()\n', '',
         'test_preflight_refuses_python314_before_numerical_import', 'Unsupported interpreter must fail preflight'),
        ('remove_county_admission', ROOT / 'scripts/modeling/screening_runtime.py',
         '    require_assignment_python()\n', '',
         'test_county_assignment_refuses_before_writing_demand', 'Demand output must not be created'),
        ('admit_other_interpreters', WORKER / 'assignment_runtime.py',
         "platform.python_implementation() != 'CPython' or ", '',
         'test_unreviewed_interpreters_are_refused', 'ValueError not raised'),
        ('remove_development_scope_refusal', HERE / 'trace_retained_measurement.py',
         "if county not in {'06047', '06069', '06107', '08014', '08101'}:", 'if False:',
         'test_trace_refuses_a_non_development_county_before_reading', 'Unapproved source must not be read'),
        ('restore_frozen_interpreter_in_synthetic_fixture', HERE / 'test_successor.py',
         "        lock[kind]['command'][python_index] = sys.executable\n", '',
         'test_synthetic_lock_uses_test_interpreter', 'Synthetic lock must use the test interpreter'),
    ]
    try:
        run('sealed_runtime_reproduces_wrong_volume', [native_test,
            'MeasurementContractTests.test_small_and_large_results_preserve_pce_flow'],
            'PCE flow must remain 360, not the 0.6 capacity ratio', incompatible_python)
        run('explicit_division_diagnosis_on_sealed_runtime', [native_test,
            'MeasurementContractTests.test_explicit_division_preserves_the_same_flow'],
            interpreter=incompatible_python)
        harmless = WORKER / 'assignment_runtime.py'
        harmless.write_bytes(originals[harmless] + b'\n# Harmless mutation control.\n')
        run('harmless_runtime_comment_survives', [guard_test])
        run('harmless_native_contract_survives', [native_test])
        run('harmless_launcher_fixture_survives', [WORKER / 'test_local_launchers.py'])
        harmless.write_bytes(originals[harmless])
        for name, path, old, new, test, expected in controls:
            source = originals[path].decode()
            if source.count(old) != 1:
                raise RuntimeError(f'Nonunique mutation anchor: {name}')
            path.write_text(source.replace(old, new))
            native = test.startswith(('test_county_', 'test_trace_', 'test_synthetic_'))
            run(name, [native_test if native else guard_test,
                       ('MeasurementContractTests.' if native else 'RuntimeAdmissionTests.') + test], expected)
            path.write_bytes(originals[path])
        source = originals[native_test].decode()
        old = 'fw_total_flow=np.full(2 * link_count, 180.)'
        if source.count(old) != 1:
            raise RuntimeError('Nonunique wrong-flow mutation anchor')
        native_test.write_text(source.replace(old, 'fw_total_flow=np.full(2 * link_count, .3)'))
        # One selected assertion avoids counting the same deliberate fault twice.
        run('wrong_solver_flow_fails_contract', [native_test,
            'MeasurementContractTests.test_explicit_division_preserves_the_same_flow'],
            'Explicit division must preserve flow')
        native_test.write_bytes(originals[native_test])
        run('restored_runtime_suite', [guard_test])
        run('restored_native_suite', [native_test])
        run('restored_launcher_suite', [WORKER / 'test_local_launchers.py'])
    finally:
        for path, contents in originals.items():
            path.write_bytes(contents)
        result = {'controls': records, 'skips': 0,
                  'restored_exactly': all(path.read_bytes() == content for path, content in originals.items()),
                  'restored_source_sha256': {str(path.relative_to(ROOT)): hashlib.sha256(content).hexdigest()
                                            for path, content in originals.items()},
                  'blind_categories': ['native solver correctness', 'county reassignment',
                                       'scientific accuracy', 'production deployment/runtime history']}
        output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'matched_controls': len(records), 'skips': 0, 'restored_exactly': result['restored_exactly']}))


if __name__ == '__main__':
    prove(Path(sys.argv[1]), sys.argv[2])
