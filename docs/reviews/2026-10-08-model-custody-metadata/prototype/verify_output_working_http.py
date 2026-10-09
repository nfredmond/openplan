"""Native output working-copy registration with lost-reply recovery."""
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
    begin = source.index('    def prepare_output_working_copy')
    end = source.index('    def project_directory', begin)
    part = source[begin:end]
    if part.count(anchor) != 1:
        raise AssertionError('Project metadata mutation anchor changed')
    results = []
    for name, body in [('baseline', source), ('harmless', source + '\n# Harmless comment.\n'),
                       ('erase-working-role', source[:begin] + part.replace(anchor, "'role': 'retained_input', 'files_mutable': True") + source[end:]), ('restored', source)]:
        candidate = types.ModuleType('model_attempt_writer')
        exec(compile(body, model_attempt_writer.__file__, 'exec'), candidate.__dict__)
        previous = sys.modules.get('model_attempt_writer')
        try:
            sys.modules['model_attempt_writer'] = candidate
            result = verify(root / name, candidate, output_working=True)
        except AssertionError as error:
            if name != 'erase-working-role' or str(error) != 'Native output working copy lost its retained input boundary':
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
              'controls': results, 'limits': 'Actual output working-copy writer after native selected-output consumption, real file mutation with retained input unchanged, and fresh CLI receipt recovery. Synthetic skim bytes; no format validation, engine closure, stage integration, normal managed dispatch or scientific acceptance.'}
    (root / 'output-working-http.json').write_text(json.dumps(report, indent=2) + '\n')
    (Path(__file__).parent / 'output-working-http.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
