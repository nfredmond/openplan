"""Native project working-copy registration with lost-reply recovery."""
import hashlib
import json
import os
from pathlib import Path
import sys
import types
from verify_writer_http import verify, managed, REPO
import model_attempt_writer


def main():
    root = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(model_attempt_writer.__file__).read_text()
    anchor = "'role': 'initial_working_inventory', 'files_mutable': True"
    if source.count(anchor) != 1:
        raise AssertionError('Project metadata mutation anchor changed')
    results = []
    for name, body in [('baseline', source), ('harmless', source + '\n# Harmless comment.\n'),
                       ('erase-working-role', source.replace(anchor, "'role': 'retained_input', 'files_mutable': True")), ('restored', source)]:
        candidate = types.ModuleType('model_attempt_writer')
        exec(compile(body, model_attempt_writer.__file__, 'exec'), candidate.__dict__)
        previous = sys.modules.get('model_attempt_writer')
        try:
            sys.modules['model_attempt_writer'] = candidate
            result = verify(root / name, candidate, project_working=True)
        except AssertionError as error:
            if name != 'erase-working-role' or str(error) != 'Native working copy lost its retained input boundary':
                raise
            results.append({'control': name, 'expected_failure': str(error)})
        else:
            if name == 'erase-working-role':
                raise AssertionError('Erased working role passed native proof')
            results.append({'control': name, 'result': result})
        finally:
            if previous is None:
                sys.modules.pop('model_attempt_writer', None)
            else:
                sys.modules['model_attempt_writer'] = previous
    report = {'writer_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'worker_sha256': hashlib.sha256((REPO / 'workers/aequilibrae_worker/main.py').read_bytes()).hexdigest(),
              'controls': results, 'limits': 'Actual working-copy writer after native selected-project consumption, real SQLite mutation with retained input unchanged, and fresh CLI receipt recovery. No native engine in this proof, closure enforcement, cross-database consistency, normal managed dispatch or scientific acceptance.'}
    (root / 'project-working-http.json').write_text(json.dumps(report, indent=2) + '\n')
    (Path(__file__).parent / 'project-working-http.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
