"""Exercise candidate SQL only in the owned proof database, then roll it back."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
config = json.loads(Path(sys.argv[1]).read_text())
out = Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True)
assert config['container'] == 'supabase_db_openplan-restore-target-2026091050'
assert re.fullmatch(r'openplan_attempt_cli_[a-f0-9]{32}', config['database'])
command = ['docker', 'exec', '-i', config['container'], 'psql', '-U', 'postgres',
           '-d', config['database'], '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
source = (root / 'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql').read_text()
checks = (Path(__file__).parent / 'admission-checks.sql').read_text()
checks += '\n' + (Path(__file__).parent / 'batch-checks.sql').read_text()
results = []


def mutation(old, new):
    assert source.count(old) == 1, ('mutation target changed', old)
    return source.replace(old, new)


cases = [
    ('baseline', source, None),
    ('harmless-comment', source + '\n-- Harmless comment.\n', None),
    ('source-field-type', mutation("WHERE field.key<>'uploadBytes' AND jsonb_typeof(field.value) NOT IN ('string','null')", 'WHERE false'), 'nontext source metadata accepted'),
    ('upload-byte-type', mutation("IF jsonb_typeof(p_source->'uploadBytes') IS DISTINCT FROM 'number' THEN", 'IF false THEN'), 'invalid upload byte count accepted'),
    ('upload-byte-integrity', mutation("IF (p_source->>'uploadBytes')::numeric NOT BETWEEN 1 AND 9007199254740991\n      OR trunc((p_source->>'uploadBytes')::numeric)<>(p_source->>'uploadBytes')::numeric THEN", 'IF false THEN'), 'invalid upload byte count accepted'),
    ('archive-byte-type', mutation("IF jsonb_typeof(p_archive->'bytes') IS DISTINCT FROM 'number' THEN", 'IF false THEN'), 'invalid archive byte count accepted'),
    ('archive-byte-integrity', mutation("IF (p_archive->>'bytes')::numeric NOT BETWEEN 1 AND 9007199254740991\n    OR trunc((p_archive->>'bytes')::numeric)<>(p_archive->>'bytes')::numeric THEN", 'IF false THEN'), 'invalid archive byte count accepted'),
    ('changed-admission', mutation('IF saved.payload IS DISTINCT FROM payload THEN', 'IF false THEN'), 'changed request replay accepted'),
    ('viewer-admission', mutation('IF openplan_gtfs.actor_can_write(p_workspace,p_actor) IS NOT TRUE THEN', 'IF false THEN'), 'viewer admitted work'),
    ('token-rebinding', mutation('IF saved.version_id<>p_version THEN', 'IF false THEN'), 'token rebound to another version'),
    ('live-replacement', mutation('OR j.lease_until>clock_timestamp()', ''), 'live owner replaced'),
    ('expired-revival', mutation('OR j.lease_until<=clock_timestamp()', ''), 'expired token revived'),
    ('wrong-attempt-ownership', mutation('OR j.token IS DISTINCT FROM p_token', ''), 'unowned archive confirmation accepted'),
    ('revoked-owner-renewal', mutation('RETURN openplan_gtfs.actor_can_write(s.workspace_id,s.actor_id);', 'RETURN true;'), 'revoked actor renewed'),
    ('version-fence', mutation("RAISE EXCEPTION 'Managed GTFS version requires a lifecycle command' USING ERRCODE='55000';", 'NULL;'), 'direct managed version write accepted'),
    ('batch-fence', mutation("RAISE EXCEPTION 'Managed GTFS rows require an owned batch command' USING ERRCODE='55000';", 'NULL;'), 'direct managed batch accepted'),
    ('pointer-fence', mutation("RAISE EXCEPTION 'Managed GTFS pointer requires an adoption command' USING ERRCODE='55000';", 'NULL;'), 'direct managed pointer accepted'),
    ('archive-replacement', mutation('IF j.archive_identity IS DISTINCT FROM p_archive THEN', 'IF false THEN'), 'prepared archive replaced'),
    ('parse-before-custody', mutation("OR (p_stage='parsing' AND NOT j.archive_available)", ''), 'parsing began without retained archive'),
    ('mutable-refetch', mutation("v.source_kind='upload' OR j.archive_identity IS NOT NULL OR v.status='parsing'", "v.source_kind='upload' OR v.status='parsing'"), 'prepared archive allowed mutable refetch'),
    ('unowned-confirmation', mutation('AND openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE THEN', 'AND false THEN'), 'unowned archive confirmation accepted'),
    ('client-execution', mutation('COMMIT;', 'GRANT EXECUTE ON FUNCTION public.admit_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb) TO anon;\nCOMMIT;'), 'client invoked admission'),
    ('private-schema-exposure', mutation('COMMIT;', 'GRANT USAGE ON SCHEMA openplan_gtfs TO service_role;\nCOMMIT;'), 'private journal exposed'),
    ('truncate-privilege', mutation('COMMIT;', 'GRANT TRUNCATE ON public.gtfs_feed_versions TO service_role;\nCOMMIT;'), 'runtime truncate remains available'),
    ('preparation-stage', mutation("WHERE v.id=p_version AND v.status='parsing' AND j.archive_available)", "WHERE v.id=p_version AND j.archive_available)"), 'preparation accepted before parsing'),
    ('prepared-owner', source.replace("WHERE j.version_id=p_version AND j.prepared_token=p_token AND candidate_version.status='parsing')", "WHERE j.version_id=p_version AND candidate_version.status='parsing')").replace('SELECT plan INTO output_plan FROM openplan_gtfs.prepare_receipts WHERE token=p_token AND version_id=p_version;', "SELECT plan INTO output_plan FROM openplan_gtfs.prepare_receipts WHERE token=p_token AND version_id=p_version;\n output_plan:=coalesce(output_plan,'{\"routeRows\":2,\"routeBatches\":2,\"stopRows\":1,\"stopBatches\":1}'::jsonb);"), 'unprepared owner wrote batch'),
    ('batch-ordinal', mutation("IF p_ordinal IS DISTINCT FROM (SELECT count(*)::integer FROM openplan_gtfs.batch_receipts\n   WHERE version_id=p_version AND token=p_token AND kind=p_kind) THEN", 'IF false THEN'), 'batch ordinal gap accepted'),
    ('batch-replay-payload', mutation('IF saved.payload_hash IS DISTINCT FROM hash THEN', 'IF false THEN'), 'changed batch replay accepted'),
    ('batch-scope', source.replace("row->>'workspace_id' IS DISTINCT FROM v.workspace_id::text", 'false'), 'batch workspace scope change accepted'),
    ('batch-fields', source.replace('WHERE NOT key=ANY(allowed)', 'WHERE false'), 'unexpected batch field accepted'),
    ('prepare-routes', mutation('DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=p_version;', 'DELETE FROM public.gtfs_route_service_levels WHERE false;'), 'preparation omitted prior output'),
    ('prepare-stops', mutation('DELETE FROM public.gtfs_stop_service_levels WHERE feed_version_id=p_version;', 'DELETE FROM public.gtfs_stop_service_levels WHERE false;'), 'preparation omitted prior output'),
    ('prepare-tracts', mutation('DELETE FROM public.gtfs_tract_service WHERE feed_version_id=p_version;', 'DELETE FROM public.gtfs_tract_service WHERE false;'), 'preparation omitted prior output'),
    ('preparation-replay-deletes', source.replace('SELECT * INTO saved FROM openplan_gtfs.prepare_receipts WHERE token=p_token;', 'SELECT * INTO saved FROM openplan_gtfs.prepare_receipts WHERE false;').replace('INSERT INTO openplan_gtfs.prepare_receipts VALUES(p_token,p_version,p_plan,result);', 'INSERT INTO openplan_gtfs.prepare_receipts VALUES(p_token,p_version,p_plan,result) ON CONFLICT(token) DO UPDATE SET response=excluded.response;'), 'preparation replay changed receipt'),
    ('prepare-client-execution', mutation('COMMIT;', 'GRANT EXECUTE ON FUNCTION public.prepare_gtfs_derived(uuid,uuid,jsonb) TO anon;\nCOMMIT;'), 'client called preparation'),
    ('batch-client-execution', mutation('COMMIT;', 'GRANT EXECUTE ON FUNCTION public.write_gtfs_ingest_batch(uuid,uuid,uuid,text,integer,jsonb) TO anon;\nCOMMIT;'), 'client called batch writer'),
    ('derived-plan-shape', mutation("OR p_plan->>'sha256' !~ '^[0-9a-f]{64}$'", ''), 'invalid derived output plan accepted'),
    ('derived-plan-types', mutation("IF jsonb_typeof(p_plan->field) IS DISTINCT FROM 'number' THEN", 'IF false THEN'), 'invalid derived output plan accepted'),
    ('derived-plan-integers', mutation("IF (p_plan->>field)::numeric NOT BETWEEN 1 AND 2147483647\n    OR trunc((p_plan->>field)::numeric)<>(p_plan->>field)::numeric THEN", 'IF false THEN'), 'invalid derived output plan accepted'),
    ('derived-plan-identity', mutation('OR saved.plan IS DISTINCT FROM p_plan THEN', 'THEN'), 'changed derived output plan accepted'),
    ('derived-plan-row-bound', mutation("> (output_plan->>(p_kind||'Rows'))::integer THEN", '> 2147483647 THEN'), 'batch exceeded declared output plan'),
    ('derived-plan-digest-type', mutation("OR jsonb_typeof(p_plan->'sha256') IS DISTINCT FROM 'string'", ''), 'numeric derived digest accepted'),
    ('derived-plan-fields', mutation("WHERE key NOT IN\n     ('sha256','bytes','routeRows','stopRows','routeBatches','stopBatches')", 'WHERE false'), 'invalid derived output plan accepted'),
    ('derived-plan-capacity', mutation("IF (p_plan->>'routeBatches')::numeric NOT BETWEEN ceil((p_plan->>'routeRows')::numeric/1000) AND (p_plan->>'routeRows')::numeric\n   OR (p_plan->>'stopBatches')::numeric NOT BETWEEN ceil((p_plan->>'stopRows')::numeric/1000) AND (p_plan->>'stopRows')::numeric THEN", 'IF false THEN'), 'invalid derived output plan accepted'),
    ('restored', source, None),
]

try:
    for name, sql, expected in cases:
        assert sql.count('BEGIN;') == 1 and sql.count('COMMIT;') == 1
        script = sql.replace('BEGIN;', "BEGIN;\nSET LOCAL statement_timeout='15s';", 1)
        script = script.replace('COMMIT;', checks + '\nROLLBACK;')
        result = subprocess.run(command, input=script, text=True, capture_output=True, timeout=25)
        log = result.stdout + result.stderr
        (out / f'{name}.log').write_text(log)
        cleanup = subprocess.run(command, input="SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';",
                                 text=True, capture_output=True, timeout=10)
        restored = cleanup.returncode == 0 and cleanup.stdout.strip() == '0'
        results.append({'case': name, 'exitCode': result.returncode, 'expectedFailure': expected,
                        'schemaAbsentAfterRollback': restored,
                        'logSha256': hashlib.sha256(log.encode()).hexdigest()})
        assert restored, (name, 'candidate schema survived rollback')
        assert (result.returncode == 0) == (expected is None), (name, log)
        assert expected is None or expected in log, (name, log)
        print(name, 'PASS' if expected is None else 'EXPECTED FAILURE', flush=True)
finally:
    (out / 'controls.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
        'checksSha256': hashlib.sha256(checks.encode()).hexdigest(), 'checks': results}, indent=2) + '\n')
