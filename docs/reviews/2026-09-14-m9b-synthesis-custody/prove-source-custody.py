"""Exercise candidate migration and faults only inside rolled-back synthetic transactions."""
from pathlib import Path
import hashlib
import json
import subprocess

review = Path(__file__).resolve().parent
root = review.parents[2]
container = 'supabase_db_openplan-restore-target-2026091050'
migration = root / 'openplan/supabase/migrations/20261014000025_engagement_synthesis_sources.sql'
fixture = root / 'openplan/src/test/fixtures/engagement/synthesis-source-custody.sql'
source = migration.read_text()
test = fixture.read_text()
command = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']

def sql(statement):
    return subprocess.run(command, input=statement, capture_output=True, text=True, timeout=45)

before = sql("SELECT count(*) FROM supabase_migrations.schema_migrations; SELECT coalesce(to_regclass('public.engagement_synthesis_sources')::text,'absent');")
if before.returncode or before.stdout.strip() != '343\nabsent':
    raise SystemExit('Refusing candidate proof unless named disposable target is at the unchanged 343-migration baseline without this table')

def changed(old, new):
    if source.count(old) != 1:
        raise RuntimeError(f'Missing or ambiguous mutation seam: {old}')
    return source.replace(old, new)

cases = [
    ('baseline', source, '', None),
    ('harmless-comment', '-- Harmless source custody comment.\n' + source, '', None),
    ('lost-tail', changed('AND (before_date IS NULL OR i.created_at<before_date)\n ),', 'AND (before_date IS NULL OR i.created_at<before_date) LIMIT 300\n ),'), '', 'Complete source capture lost the 301st concern'),
    ('truncated-source-text', changed('to_jsonb(i)-ARRAY', "(to_jsonb(i)||jsonb_build_object('body',left(i.body,600)))-ARRAY"), '', 'Source text was truncated'),
    ('current-definition-only', changed('OR v.id IN(SELECT configuration_version_id FROM selected_items UNION SELECT configuration_version_id FROM included_sessions)', 'OR false'), '', 'Historical definition set or exact bytes differ'),
    ('lost-survey-answers', changed('WHERE a.campaign_id=p_campaign AND (cats IS NULL OR EXISTS(', 'WHERE false AND a.campaign_id=p_campaign AND (cats IS NULL OR EXISTS('), '', '300-source control was not retained'),
    ('viewer-read', changed("m.role IN ('owner','admin','member')\n  WHERE s.id=p_request", "m.role IN ('owner','admin','member','viewer')\n  WHERE s.id=p_request"), '', 'Viewer read private source text'),
    ('raw-table-read', source, 'GRANT SELECT ON engagement_synthesis_sources TO authenticated; CREATE POLICY synthetic_allow ON engagement_synthesis_sources FOR SELECT TO authenticated USING (true);', 'Direct private source table read was allowed'),
    ('anonymous-rpc', source, 'GRANT EXECUTE ON FUNCTION read_engagement_synthesis_sources(uuid,uuid) TO anon;', 'Anonymous source read was allowed'),
    ('mutable-source', source, 'ALTER TABLE engagement_synthesis_sources DISABLE TRIGGER engagement_synthesis_sources_immutable;', 'Retained source mutation was allowed'),
    ('deleted-source', changed('BEFORE UPDATE OR DELETE ON public.engagement_synthesis_sources', 'BEFORE UPDATE ON public.engagement_synthesis_sources'), '', 'Retained source deletion was allowed'),
    ('wrong-requested-campaign', changed('AND s.campaign_id=p_campaign;', ';'), '', 'Saved source read ignored requested campaign'),
    ('request-actor', changed('OR saved.actor_id IS DISTINCT FROM actor', ''), '', 'Another actor reused the source request'),
    ('relative-date', changed("AND e.value !~", "AND false AND e.value !~"), '', 'Relative source date was accepted'),
    ('category-filter', changed('AND (cats IS NULL OR i.category_id=ANY(cats))', ''), '', 'Historical category selection differs'),
    ('swallowed-save-error', changed("RAISE EXCEPTION 'Synthesis source capture is busy; retry the same request' USING ERRCODE='PT503';\nEND $$;", "RAISE EXCEPTION 'Synthesis source capture is busy; retry the same request' USING ERRCODE='PT503';\nWHEN OTHERS THEN RETURN '{}'::jsonb;\nEND $$;"), '', 'Failed persistence returned a source receipt'),
]
results = []
for name, candidate, fault, reason in cases:
    result = sql("BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\n" + candidate + '\n' + fault + '\n' + test + '\nROLLBACK;')
    ok = result.returncode == 0 and result.stdout.strip().endswith('synthesis-source-custody-verified') if reason is None else result.returncode != 0 and reason in result.stderr
    record = {'case': name, 'exitCode': result.returncode, 'expectedFailure': reason, 'expectedOutcome': ok}
    results.append(record)
    print(json.dumps(record), flush=True)
    if not ok:
        print(result.stderr)
        raise SystemExit('Unexpected native proof outcome')
after = sql("SELECT count(*) FROM supabase_migrations.schema_migrations; SELECT coalesce(to_regclass('public.engagement_synthesis_sources')::text,'absent');")
if after.returncode or after.stdout != before.stdout:
    raise SystemExit('Disposable target baseline was not restored')
(review/'source-custody-native-results.json').write_text(json.dumps({
    'container': container, 'baselineMigrations': 343, 'transactionRollbackVerified': True,
    'migrationSha256': hashlib.sha256(migration.read_bytes()).hexdigest(),
    'fixtureSha256': hashlib.sha256(fixture.read_bytes()).hexdigest(), 'cases': results,
    'limits': 'Real PostgreSQL roles, functions, triggers, capture and retry semantics. Candidate migration exists only within each rolled-back transaction; no application activation. No concurrent sessions, browser, worker generation, reviewed themes, public exports or provider invocation are proved here.'
}, indent=2)+'\n')
