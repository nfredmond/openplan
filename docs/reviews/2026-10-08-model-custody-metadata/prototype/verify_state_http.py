"""Native original-state retention and lost registration reply recovery."""
import hashlib
import json
import os
from pathlib import Path
import types
from verify_writer_http import verify, managed


def main():
    root = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(managed.__file__).read_text()
    anchor = "'content_hash': retained['sha256']"
    if source.count(anchor) != 1:
        raise AssertionError('State hash mutation anchor changed')
    results = []
    for name, body in [('baseline', source), ('harmless', source + '\n# Harmless comment.\n'),
                       ('wrong-state-hash', source.replace(anchor, "'content_hash': '0' * 64")), ('restored', source)]:
        candidate = types.ModuleType('model_attempt_writer')
        exec(compile(body, managed.__file__, 'exec'), candidate.__dict__)
        try:
            result = verify(root / name, candidate, state_output=True)
        except AssertionError as error:
            if name != 'wrong-state-hash' or str(error) != 'Native predecessor state differs from retained bytes':
                raise
            results.append({'control': name, 'expected_failure': str(error)})
        else:
            if name == 'wrong-state-hash':
                raise AssertionError('Incorrect state hash passed native proof')
            results.append({'control': name, 'result': result})
    report = {'writer_sha256': hashlib.sha256(source.encode()).hexdigest(), 'controls': results,
              'limits': 'Installed native artifact registration, actual bound AequilibraE state publication, retained original bytes and fresh CLI recovery. No package snapshot, consumer path relocation, full dispatcher activation or scientific acceptance.'}
    (root / 'state-http.json').write_text(json.dumps(report, indent=2) + '\n')
    (Path(__file__).parent / 'state-http.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
