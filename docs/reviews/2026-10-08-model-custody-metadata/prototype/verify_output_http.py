"""Recover native output receipts through both bound workers without replay."""
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
    artifact = "                name = logical_name if logical_name is not None else payload.get('id')"
    kpi = "                name = journal.canonical({'category': payload['kpi_category'], 'name': payload.get('kpi_name')})"
    if source.count(artifact) != 1 or source.count(kpi) != 1:
        raise AssertionError('Output mutation anchor changed')
    cases = [('baseline', source, None), ('harmless', source + '\n# Harmless comment.\n', None),
             ('discard-prepared-id', source.replace(artifact, "                payload.pop('id', None)\n" + artifact),
              'Native artifact lost prepared identity or evidence'),
             ('replace-null-with-zero', source.replace(kpi, "                payload['value'] = 0\n" + kpi),
              'Native KPI lost unassessed null value'), ('restored', source, None)]
    results = []
    for name, body, expected in cases:
        candidate = types.ModuleType('model_attempt_writer')
        exec(compile(body, managed.__file__, 'exec'), candidate.__dict__)
        try:
            result = verify(root / name, candidate, outputs=True)
        except AssertionError as error:
            if expected is None or str(error) != expected:
                raise
            results.append({'control': name, 'expected_failure': str(error)})
        else:
            if expected is not None:
                raise AssertionError('Broken output behavior passed: ' + name)
            results.append({'control': name, 'result': result})
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'controls': results,
              'limits': 'Installed migration21 and actual bound artifact/KPI adapters with native HTTP and fresh CLI recovery. Synthetic references, hashes and handler; no byte/file provenance, normal poll/push activation, model execution or scientific acceptance.'}
    (root / 'output-http.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
