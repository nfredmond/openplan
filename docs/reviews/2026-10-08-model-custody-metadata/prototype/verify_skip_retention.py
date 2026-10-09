"""Check skip retention semantics with rollback-only native mutations."""
from pathlib import Path
import json
import os
from verify_skip_blocked_stage import verify

ROOT = Path(__file__).resolve().parent


def main():
    base = (ROOT / 'skip-blocked-stage.sql').read_text()
    retention = (ROOT / 'skip-retention.sql').read_text()
    cases = (ROOT / 'skip-retention-cases.sql').read_text()
    variants = [('baseline', retention, None), ('harmless', retention + '\n-- Harmless comment.\n', None)]
    for name, old, new, failure in [
        ('omit-successful-skips', "AND response_payload->>'outcome'='skipped'", 'AND false', 'Skip retention state differs'),
        ('freeze-noops', "AND response_payload->>'outcome'='skipped'", '', 'Skip retention state differs'),
        ('allow-rewrite', 'BEFORE UPDATE OR DELETE', 'BEFORE DELETE', 'Skip receipt rewrite accepted'),
        ('allow-delete', 'BEFORE UPDATE OR DELETE', 'BEFORE UPDATE', 'Skip receipt deletion accepted'),
    ]:
        if retention.count(old) != 1:
            raise AssertionError('Mutation anchor changed: ' + name)
        variants.append((name, retention.replace(old, new), failure))
    variants.append(('restored', retention, None))
    results = []
    for name, tail, expected in variants:
        try:
            result = verify(base + '\n' + tail, cases)
        except AssertionError as error:
            if expected is None or expected not in str(error):
                raise
            results.append({'control': name, 'expected_failure': expected})
        else:
            if expected:
                raise AssertionError('Broken retention passed: ' + name)
            results.append({'control': name, 'result': result, 'retention_cases': True})
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    (output / 'skip-retention-controls.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
