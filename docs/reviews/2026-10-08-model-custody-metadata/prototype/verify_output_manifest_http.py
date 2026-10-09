"""Native assignment-output manifest registration with lost-reply recovery."""
import hashlib
import json
import os
from pathlib import Path
import sys
import types
from verify_writer_http import verify, managed, REPO
import model_package_inputs


def main():
    root = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(model_package_inputs.__file__).read_text()
    anchor = "'manifest_sha256': hashlib.sha256(content).hexdigest()"
    if source.count(anchor) != 1:
        raise AssertionError('Package manifest mutation anchor changed')
    results = []
    for name, body in [('baseline', source), ('harmless', source + '\n# Harmless comment.\n'),
                       ('wrong-manifest-hash', source.replace(anchor, "'manifest_sha256': '0' * 64")), ('restored', source)]:
        candidate = types.ModuleType('model_package_inputs')
        exec(compile(body, model_package_inputs.__file__, 'exec'), candidate.__dict__)
        previous = sys.modules.get('model_package_inputs')
        try:
            sys.modules['model_package_inputs'] = candidate
            result = verify(root / name, managed, assignment_outputs=True)
        except AssertionError as error:
            if name != 'wrong-manifest-hash' or str(error) != 'Native package manifest differs from retained bytes':
                raise
            results.append({'control': name, 'expected_failure': str(error)})
        else:
            if name == 'wrong-manifest-hash':
                raise AssertionError('Wrong package manifest hash passed native proof')
            results.append({'control': name, 'result': result})
        finally:
            if previous is None:
                sys.modules.pop('model_package_inputs', None)
            else:
                sys.modules['model_package_inputs'] = previous
    report = {'package_inputs_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'worker_sha256': hashlib.sha256((REPO / 'workers/aequilibrae_worker/main.py').read_bytes()).hexdigest(),
              'controls': results, 'limits': 'Actual owned-assignment-output writer method, native files and installed artifact command with fresh CLI recovery. Synthetic output bytes with unchanged count-source labels. No native skim validation, engine closure, normal managed dispatch or scientific acceptance.'}
    (root / 'output-manifest-http.json').write_text(json.dumps(report, indent=2) + '\n')
    (Path(__file__).parent / 'output-manifest-http.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
