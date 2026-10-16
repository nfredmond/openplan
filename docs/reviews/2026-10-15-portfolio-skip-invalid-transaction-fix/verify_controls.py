"""Serial source-test falsification. Never connects to a database or browser."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[3]
APP = REPO / 'openplan'
MIGRATION = APP / 'supabase/migrations/20261017000017_portfolio_skip_invalid_classifications.sql'
ROUTE = APP / 'src/app/api/projects/import/route.ts'
LOCK = Path('/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    cmd = ['npm', 'exec', '--no', '--', 'vitest', 'run',
           'src/test/portfolio-skip-invalid-transaction-migration.test.ts',
           'src/test/project-portfolio-import-route.test.ts', '--maxWorkers=1',
           '--fileParallelism=false', '--no-cache', '--configLoader=runner', '--config', str(args.config)]
    originals = {p: p.read_bytes() for p in (MIGRATION, ROUTE)}
    classification = 'requires valid classifications only for create'
    audit = 'permits raw invalid skipped audit values'
    route = 'preserves the frozen valid EUR row'
    cases = [
        ('harmless-comment', MIGRATION, 'Invalid source classifications', 'Invalid reviewed source classifications', None),
        ('unconditional-classifications', MIGRATION, "IF v_row->>'decision' = 'create' AND (\n      COALESCE", 'IF (\n      COALESCE', classification),
        ('missing-status-guard', MIGRATION, "OR COALESCE(v_row->>'status', '') NOT IN ('draft','active','on_hold','complete')", 'OR false', classification),
        ('missing-phase-guard', MIGRATION, "OR COALESCE(v_row->>'deliveryPhase', '') NOT IN ('scoping','analysis','engagement','programming','delivery','complete')", 'OR false', classification),
        ('unconditional-audit-status', MIGRATION, "decision <> 'create' OR resolved_status", "resolved_status", audit),
        ('unconditional-audit-phase', MIGRATION, "decision <> 'create' OR resolved_delivery_phase", "resolved_delivery_phase", audit),
        ('normalized-skipped-plan', MIGRATION, "ELSE v_row->>'planType' END", "ELSE 'capital_program' END", audit),
        ('discarded-skipped-rpc-row', ROUTE, 'const rpcRows = review.rows.map(', 'const rpcRows = review.rows.filter((row) => row.decision === "create").map(', route),
    ]
    results = []
    env = {**os.environ, 'NODE_OPTIONS': '--max-old-space-size=1024'}
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            for name, target, before, after, failing_test in cases:
                text = originals[target].decode()
                assert text.count(before) == 1, (name, 'mutation target must be unique')
                target.write_text(text.replace(before, after, 1))
                try:
                    run = subprocess.run(cmd, cwd=APP, env=env, capture_output=True, text=True, timeout=60)
                    log = run.stdout + run.stderr
                    (args.output / (name + '.log')).write_text(log)
                    valid = run.returncode == 0 if failing_test is None else (
                        run.returncode != 0 and failing_test in log and 'AssertionError' in log)
                    results.append({'case': name, 'returncode': run.returncode,
                                    'expected': 'survived' if failing_test is None else 'killed by ' + failing_test,
                                    'observedAsExpected': valid})
                    assert valid, (name, log[-4000:])
                finally:
                    target.write_bytes(originals[target])
            baseline = subprocess.run(cmd, cwd=APP, env=env, capture_output=True, text=True, timeout=60)
            (args.output / 'restored-baseline.log').write_text(baseline.stdout + baseline.stderr)
            assert baseline.returncode == 0, 'restored baseline must pass'
        finally:
            for p, data in originals.items():
                p.write_bytes(data)
            restored = all(p.read_bytes() == data for p, data in originals.items())
            report = {'cases': results, 'restoredExactBytes': restored,
                      'sources': {str(p.relative_to(REPO)): hashlib.sha256(data).hexdigest() for p, data in originals.items()},
                      'limits': ['SQL checks read source only; no PL/pgSQL or constraint execution.',
                                 'Route RPC and authorization/database clients are mocked; no native RLS or atomicity proof.']}
            (args.output / 'controls.json').write_text(json.dumps(report, indent=2) + '\n')
            assert restored


if __name__ == '__main__':
    main()
