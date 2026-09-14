"""Run candidate recovery and fault controls inside rolled-back isolated transactions."""
import hashlib
import importlib.util
import json
from pathlib import Path
import uuid

review = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('decision_fixture', review/'prove-decision-context.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
f = fixture.f
ids = {name: str(uuid.uuid4()) for name in ('cancelled', 'cancelResolution', 'secondResolution', 'saved', 'savedResolution', 'laterResolution', 'invalid', 'otherResolution')}
candidate = review/'decision-resolution-candidate.sql'
original = candidate.read_text()
private = fixture.private/'resolution'
private.mkdir(exist_ok=True)


def state():
    result = fixture.sql("SELECT count(*)||':'||max(version) FROM supabase_migrations.schema_migrations; SELECT to_regclass('public.engagement_decision_request_resolutions') IS NULL; SELECT encode(extensions.digest(pg_get_functiondef('public.write_engagement_response_decision_link(uuid,uuid,uuid,uuid,text,uuid,text,text)'::regprocedure),'sha256'),'hex');")
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def resolve(request='cancelled', resolution='cancelResolution', copy="'\"SYNTHETIC damaged bytes \\ud800 \\u0000 \\n\"'", reason="'SYNTHETIC preserve my original copy'"):
    return f"SELECT resolve_engagement_decision_request('{f['campaign']}','{ids[request]}','{ids[resolution]}',{copy},{reason})"


def write(request):
    return f"SELECT write_engagement_response_decision_link('{f['campaign']}','{f['response']}','{f['decision']}','{ids[request]}','link',NULL,(SELECT value->>'contextSha256' FROM resolution_probe WHERE key='preview'),'SYNTHETIC original decision intent')"


def expect_error(query, code, label):
    return f"SELECT pg_temp.expect_error($query${query}$query$,'{code}','{label}');\n"


def keep(key, query):
    return query.replace('SELECT ', f"INSERT INTO resolution_probe SELECT '{key}',", 1)+';\n'


helpers = f"""
SELECT set_config('request.jwt.claim.sub','{f['actor']}',true);
CREATE TEMP TABLE resolution_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON resolution_probe TO authenticated;
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
 IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, observed %',label,expected,coalesce(observed,'success'); END IF;
END $$;
INSERT INTO resolution_probe SELECT 'preview',read_engagement_response_decision_context('{f['campaign']}','{f['response']}','{f['decision']}');
SET LOCAL ROLE authenticated;
"""
checks = keep('cancel', resolve()) + f"""
SELECT pg_temp.assert_true((SELECT (value->>'resultText')::jsonb->>'state'='cancelled' AND (value->>'resultText')::jsonb->'link'='null'::jsonb AND NOT (value->>'replayed')::boolean FROM resolution_probe WHERE key='cancel'),'Unknown request was not cancelled');
SELECT pg_temp.assert_true((SELECT (value->>'payloadText')::jsonb->>'copyJson'='"SYNTHETIC damaged bytes \\ud800 \\u0000 \\n"' FROM resolution_probe WHERE key='cancel'),'Damaged copy bytes changed');
SELECT pg_temp.assert_true((SELECT value->>'payloadSha256'=encode(extensions.digest(value->>'payloadText','sha256'),'hex') AND value->>'resultSha256'=encode(extensions.digest(value->>'resultText','sha256'),'hex') FROM resolution_probe WHERE key='cancel'),'Resolution checksum differs');
SELECT pg_temp.assert_true((({resolve()})->>'replayed')::boolean,'Exact resolution retry not recognized');
SELECT pg_temp.assert_true(({resolve()})-'replayed'=(SELECT value-'replayed' FROM resolution_probe WHERE key='cancel'),'Exact resolution retry changed bytes');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_decision_request_resolutions),'Resolution replay duplicated archive');
"""
checks += expect_error(resolve(copy="'\"SYNTHETIC changed bytes\"'"),'PT409','Changed copy reused resolution identity')
checks += expect_error(resolve(request='invalid'),'PT409','Changed request reused resolution identity')
checks += expect_error(resolve(resolution='invalid',copy="'{}'"),'22023','Nonstring copy accepted')
checks += expect_error(resolve(resolution='invalid',copy="'broken'"),'22023','Malformed JSON copy accepted')
checks += expect_error(resolve(resolution='invalid',reason="' '"),'22023','Blank reason accepted')
checks += expect_error(resolve(resolution='invalid',reason="chr(160)||chr(65279)"),'22023','Unicode blank reason accepted')
checks += expect_error(write('cancelled'),'PT409','Resolved request arrived late')
checks += keep('secondCopy',resolve(resolution='secondResolution',copy="'\"SYNTHETIC alternate surviving copy\"'"))
checks += "SELECT pg_temp.assert_true((SELECT count(*)=2 FROM engagement_decision_request_resolutions),'Second original copy was lost');\n"
checks += keep('saved',write('saved'))
checks += keep('savedResolution',resolve('saved','savedResolution'))
checks += "SELECT pg_temp.assert_true((SELECT (value->>'resultText')::jsonb->>'state'='saved' AND (value->>'resultText')::jsonb->'link'=(SELECT value->'link' FROM resolution_probe WHERE key='saved') FROM resolution_probe WHERE key='savedResolution'),'Saved decision receipt was not preserved');\n"
checks += f"SELECT pg_temp.assert_true(({write('saved')})->'link'=(SELECT value->'link' FROM resolution_probe WHERE key='saved'),'Resolution broke exact saved retry');\n"
checks += f"RESET ROLE; UPDATE workspace_members SET role='admin' WHERE workspace_id='{f['workspace']}' AND user_id='{f['viewer']}'; SELECT set_config('request.jwt.claim.sub','{f['viewer']}',true); SET LOCAL ROLE authenticated;\n"
checks += "SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_decision_request_resolutions),'Other staff read private recovery copies');\n"
checks += expect_error(resolve(),'42501','Other staff replayed original resolution')
checks += expect_error(resolve('saved','otherResolution'),'42501','Other staff recovered private original receipt')
checks += f"RESET ROLE; UPDATE workspace_members SET role='viewer' WHERE workspace_id='{f['workspace']}' AND user_id='{f['viewer']}'; SET LOCAL ROLE authenticated;\n"
checks += expect_error(resolve(),'42501','Viewer recovered private resolution')
checks += f"SELECT set_config('request.jwt.claim.sub','{f['outsider']}',true);\n"
checks += expect_error(resolve(),'42501','Outsider recovered private resolution')
checks += f"SELECT set_config('request.jwt.claim.sub','{f['actor']}',true);\n"
checks += expect_error("UPDATE engagement_decision_request_resolutions SET actor_id=gen_random_uuid()",'42501','Staff updated immutable recovery')
checks += expect_error("DELETE FROM engagement_decision_request_resolutions",'42501','Staff removed immutable recovery')
for role in ('anon','service_role'):
    checks += f'RESET ROLE; SET LOCAL ROLE {role};\n'
    checks += expect_error(resolve(),'42501',f'{role} executed recovery')
    checks += expect_error('SELECT * FROM engagement_decision_request_resolutions','42501',f'{role} read private copies')
checks += 'RESET ROLE;\n'
checks += expect_error("UPDATE engagement_decision_request_resolutions SET actor_id=gen_random_uuid()",'P0001','Privileged update destroyed recovery')
checks += expect_error("DELETE FROM engagement_decision_request_resolutions",'P0001','Privileged delete destroyed recovery')
checks += f"DELETE FROM engagement_closeloop_entries WHERE id='{f['response']}'; DELETE FROM project_decisions WHERE id='{f['decision']}'; SET LOCAL ROLE authenticated;\n"
checks += keep('laterResolution',resolve('saved','laterResolution'))
checks += "SELECT pg_temp.assert_true((SELECT (value->>'resultText')::jsonb->'link'=(SELECT value->'link' FROM resolution_probe WHERE key='saved') FROM resolution_probe WHERE key='laterResolution'),'Missing source lost saved receipt');\n"
checks += f"SELECT pg_temp.assert_true(({resolve('saved','savedResolution')})-'replayed'=(SELECT value-'replayed' FROM resolution_probe WHERE key='savedResolution'),'Missing source changed prior resolution');\n"
checks += f"RESET ROLE; UPDATE workspace_members SET role='owner' WHERE workspace_id='{f['workspace']}' AND user_id='{f['viewer']}'; UPDATE workspace_members SET role='viewer' WHERE workspace_id='{f['workspace']}' AND user_id='{f['actor']}'; SET LOCAL ROLE authenticated;\n"
checks += expect_error(resolve(),'42501','Lost membership replayed recovery')
checks += "SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_decision_request_resolutions),'Lost membership retained table access'); RESET ROLE; SELECT 'decision-resolution-verified';\n"

checks += f"SELECT jsonb_build_object('synthetic',true,'scope',jsonb_build_object('campaignId','{f['campaign']}','workspaceId','{f['workspace']}','actorId','{f['actor']}'),'cancelled',(SELECT value FROM resolution_probe WHERE key='cancel'),'saved',(SELECT value FROM resolution_probe WHERE key='savedResolution'));\n"


def run(body, label):
    script = "BEGIN; SET LOCAL statement_timeout='20s';\n"+body+fixture.seed+helpers+checks+'ROLLBACK;\n'
    result = fixture.sql(script)
    (private/(label+'.log')).write_text(result.stdout+'\n'+result.stderr)
    return result


def main():
    before = state()
    assert before.startswith('340:20261014000021\nt\n'), before
    results = []
    baseline_output = ''
    for label, body in [('baseline',original),('harmless',original.replace('-- Candidate only.', '-- Harmless explanatory comment; candidate only.',1))]:
        result=run(body,label)
        assert result.returncode == 0 and 'decision-resolution-verified' in result.stdout, result.stderr
        if label == 'baseline': baseline_output = result.stdout
        results.append({'name':label,'outcome':'passed','log':str(private/(label+'.log'))})
    mutations = [
        ('unicode-blank-reason', "public.translation_source_compatibility_hash(p_reason) = public.translation_source_compatibility_hash('')", "NULLIF(btrim(p_reason), '') IS NULL", 'Unicode blank reason accepted'),
        ('late-write', "WHERE request_id = p_request AND campaign_id = p_campaign\n      AND workspace_id = campaign.workspace_id AND actor_id = auth.uid()", "WHERE false", 'Resolved request arrived late'),
        ('copy-loss', "'copyJson', p_copy_json, 'reason', p_reason", "'copyJson', '\"SYNTHETIC replaced copy\"', 'reason', p_reason", 'Damaged copy bytes changed'),
        ('replay-payload', "IF saved.payload_json::jsonb IS DISTINCT FROM payload THEN", 'IF false THEN', 'Changed copy reused resolution identity'),
        ('replay-actor', 'OR saved.actor_id IS DISTINCT FROM actor THEN', 'THEN', 'Other staff replayed original resolution'),
        ('receipt-actor', 'OR receipt.actor_id IS DISTINCT FROM actor THEN', 'THEN', 'Other staff recovered private original receipt'),
        ('saved-receipt-loss', "retained_link := to_jsonb(receipt) || jsonb_build_object('payload_text', receipt.payload_json::text);", 'retained_link := NULL;', 'Saved decision receipt was not preserved'),
        ('private-copy-policy', 'actor_id = auth.uid() AND EXISTS (', 'EXISTS (', 'Other staff read private recovery copies'),
        ('anonymous-grant', 'TO authenticated;\n\nCREATE OR REPLACE FUNCTION', 'TO authenticated, anon;\n\nCREATE OR REPLACE FUNCTION', 'anon executed recovery'),
        ('immutable-trigger', 'BEFORE UPDATE OR DELETE\n  ON public.engagement_decision_request_resolutions', 'BEFORE INSERT\n  ON public.engagement_decision_request_resolutions', None),
    ]
    # Omitting the trigger tests the intended UPDATE boundary, rather than making
    # every baseline INSERT fail and calling that an immutability check.
    mutations[-1]=('immutable-update', 'BEFORE UPDATE OR DELETE\n  ON public.engagement_decision_request_resolutions', 'BEFORE DELETE\n  ON public.engagement_decision_request_resolutions','Privileged update destroyed recovery')
    for label, old, new, failure in mutations:
        assert original.count(old)==1, (label,original.count(old))
        result=run(original.replace(old,new,1),label)
        assert result.returncode != 0 and failure in result.stderr, (label,result.stdout,result.stderr)
        results.append({'name':label,'outcome':'killed','assertion':failure,'log':str(private/(label+'.log'))})
    assert state()==before, 'Candidate changed installed schema or writer'
    native = next(json.loads(line) for line in baseline_output.splitlines() if line.startswith('{'))
    (review.parents[2]/'openplan/src/test/fixtures/decision-resolution-native.json').write_text(json.dumps(native,indent=2)+'\n')
    packet={'candidateSha256':hashlib.sha256(original.encode()).hexdigest(),'applicationStateBeforeAndAfter':before,'database':fixture.container+'/postgres','rolledBack':True,'results':results,'limits':['Serial transactions do not establish lock ordering or concurrent write-resolution exclusion.','Candidate is not installed and has no API or browser caller yet.','Private owner policy and native guards are separate from browser account and storage custody.']}
    (review/'decision-resolution-results.json').write_text(json.dumps(packet,indent=2)+'\n')
    print(json.dumps({'baseline':True,'harmless':True,'faultsKilled':len(mutations),'stateUnchanged':True}))


if __name__=='__main__':
    main()
