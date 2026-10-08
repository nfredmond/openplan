"""Native project-input manifest registration with lost-reply recovery."""
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
    anchor = "'database_checks': retained['database_checks']"
    if source.count(anchor) != 1:
        raise AssertionError('Project metadata mutation anchor changed')
    results = []
    for name, body in [('baseline', source), ('harmless', source + '\n# Harmless comment.\n'),
                       ('erase-database-checks', source.replace(anchor, "'database_checks': {}")), ('restored', source)]:
        candidate = types.ModuleType('model_attempt_writer')
        exec(compile(body, model_attempt_writer.__file__, 'exec'), candidate.__dict__)
        previous = sys.modules.get('model_attempt_writer')
        try:
            sys.modules['model_attempt_writer'] = candidate
            result = verify(root / name, candidate, project_output=True)
        except AssertionError as error:
            if name != 'erase-database-checks' or str(error) != 'Native project database checks or limits differ':
                raise
            results.append({'control': name, 'expected_failure': str(error)})
        else:
            if name == 'erase-database-checks':
                raise AssertionError('Erased database checks passed native proof')
            results.append({'control': name, 'result': result})
        finally:
            if previous is None:
                sys.modules.pop('model_attempt_writer', None)
            else:
                sys.modules['model_attempt_writer'] = previous
    report = {'writer_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'worker_sha256': hashlib.sha256((REPO / 'workers/aequilibrae_worker/main.py').read_bytes()).hexdigest(),
              'controls': results, 'limits': 'Actual owned-project writer, real SQLite files and installed artifact command with fresh CLI recovery. No native engine in this proof, consumer selection, closure enforcement, cross-database consistency, normal managed dispatch or scientific acceptance.'}
    (root / 'project-manifest-http.json').write_text(json.dumps(report, indent=2) + '\n')
    (Path(__file__).parent / 'project-manifest-http.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
