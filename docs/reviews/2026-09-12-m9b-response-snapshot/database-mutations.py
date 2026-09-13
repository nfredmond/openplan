"""Transactional probes against the named disposable stack. No fixture survives."""
import hashlib
import json
import subprocess
from pathlib import Path

review = Path(__file__).resolve().parent
repo = review.parents[2]
migration = repo / 'openplan/supabase/migrations/20261013000001_engagement_response_snapshot.sql'
original = migration.read_text()
probe = (review / 'database-probe.sql').read_text()
container = 'supabase_db_openplan-restore-target-2026091050'
result_file = review / 'database-mutations.json'
cases = [
    ('harmless-comment', original + '\n-- Harmless test control.\n', None),
    ('missing-campaign-scope', original.replace('campaign_id = p_campaign', 'true'), 'M9B: complete scoped count'),
    ('missing-public-filter', original.replace("NOT p_published_only OR status = 'published'", 'true'), 'M9B: published-only scope'),
    ('bypass-caller-rls', original.replace('SECURITY INVOKER', 'SECURITY DEFINER'), 'M9B: caller RLS'),
    ('missing-projection', original.replace('created_at, updated_at', 'created_at'), 'M9B: exact response projection'),
    ('missing-id-order', original.replace('entry.created_at, entry.id', 'entry.created_at'), 'M9B: stable total order'),
    ('anonymous-execution', original.replace('TO authenticated, service_role', 'TO authenticated, service_role, anon'), 'M9B: anonymous execution refused'),
    ('volatile-snapshot', original.replace('LANGUAGE sql STABLE', 'LANGUAGE sql VOLATILE'), 'M9B: stable snapshot declaration'),
]
results = []
for name, sql, expected in cases:
    assert sql != original, name
    run = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
                         input='BEGIN;\n' + sql + '\n' + probe + '\nROLLBACK;\n', text=True, capture_output=True, timeout=60)
    matched = run.returncode == 0 if expected is None else run.returncode != 0 and expected in run.stderr
    results.append({'name': name, 'outcome': 'survived' if run.returncode == 0 else 'killed', 'matched': matched,
                    'expected': expected, 'stderr': run.stderr[:1600]})
    result_file.write_text(json.dumps({'stack': container, 'scope': 'Transactional SQL; not PostgREST/browser proof',
                                     'migrationSha256': hashlib.sha256(original.encode()).hexdigest(), 'results': results}, indent=2) + '\n')
    print(name, results[-1]['outcome'], 'matched=' + str(matched), flush=True)
    if not matched:
        raise RuntimeError(run.stderr)
assert migration.read_text() == original
check = subprocess.run(['docker', 'exec', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atc',
                        "SELECT to_regprocedure('public.read_engagement_response_snapshot(uuid,boolean)') IS NULL"], text=True, capture_output=True, check=True)
assert check.stdout.strip() == 't', 'Probe function was not rolled back'
print('All transactions rolled back; source unchanged.', flush=True)
