"""Native candidate link lifecycle and fault checks; all DDL and fixtures roll back."""
import hashlib
import importlib.util
import json
from pathlib import Path
import uuid

review = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('context_probe', review/'prove-decision-context.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
f = fixture.f
ids = {key:str(uuid.uuid4()) for key in ('root','second','refresh','withdraw','fork','invalid','foreign')}
candidate = review/'decision-link-candidate.sql'
original = candidate.read_text()
private = fixture.private/'links'
private.mkdir(exist_ok=True)
helpers = f"""
SELECT set_config('request.jwt.claim.sub','{f['actor']}',true);
CREATE TEMP TABLE decision_probe(key text,value jsonb);
GRANT SELECT,INSERT ON decision_probe TO authenticated;
INSERT INTO decision_probe SELECT 'preview',read_engagement_response_decision_context('{f['campaign']}','{f['response']}','{f['decision']}');
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
 IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, observed %',label,expected,coalesce(observed,'success'); END IF;
END $$;
CREATE FUNCTION pg_temp.link(request uuid,operation text,predecessor uuid,expected text,reason text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.write_engagement_response_decision_link(
 '{f['campaign']}','{f['response']}','{f['decision']}',request,operation,predecessor,expected,reason); $$;
SET LOCAL ROLE authenticated;
"""


def command(request, operation='link', predecessor=None, expected='original', reason='SYNTHETIC link reason'):
    checksum = "(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview')" if expected == 'original' else 'NULL' if expected is None else "'"+expected+"'"
    previous = 'NULL' if predecessor is None else "'"+ids[predecessor]+"'"
    return f"SELECT pg_temp.link('{ids[request]}','{operation}',{previous},{checksum},'{reason}')"


def expect_error(query, code, label):
    return f"SELECT pg_temp.expect_error($probe${query}$probe$,'{code}','{label}');\n"


root_command = command('root')
root_save = "INSERT INTO decision_probe " + root_command.replace('SELECT pg_temp',"SELECT 'original',pg_temp",1) + ';\n'
checks = root_save + f"""
SELECT pg_temp.assert_true((SELECT (value->>'replayed')::boolean=false AND value->'link'->>'id'='{ids['root']}' AND value->'link'->>'actor_id'='{f['actor']}' FROM decision_probe WHERE key='original'),'Original receipt differs');
SELECT pg_temp.assert_true((SELECT value->'link'->>'context_text'=(SELECT value->>'contextText' FROM decision_probe WHERE key='preview') FROM decision_probe WHERE key='original'),'Original context changed on save');
SELECT pg_temp.assert_true((SELECT (value->'link'->>'context_text')::jsonb->'decision'->>'status'='proposed' FROM decision_probe WHERE key='original'),'Link promoted decision');
SELECT pg_temp.assert_true((SELECT (value->'link'->>'context_text')::jsonb->'responseHistory'->>'revision'='2' FROM decision_probe WHERE key='original'),'Link lost response revision');
SELECT pg_temp.assert_true((({root_command})->>'replayed')::boolean,'Exact replay not recognized');
SELECT pg_temp.assert_true(({root_command})->'link'=(SELECT value->'link' FROM decision_probe WHERE key='original'),'Exact replay changed original receipt');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_response_decision_links WHERE campaign_id='{f['campaign']}'),'Exact replay duplicated row');
"""
checks += expect_error(command('root', reason='SYNTHETIC changed intent'), '23505', 'Different payload reused request')
checks += expect_error(command('second'), 'PT409', 'Second root was not refused')
checks += expect_error(command('invalid', expected='0'*64), 'PT409', 'Changed source context was not refused') # separate pair below, root guard currently wins
checks += expect_error(command('invalid', operation='refresh', predecessor='root', expected='0'*64), 'PT409', 'Stale context was not refused')
checks += expect_error(command('invalid', operation='refresh', predecessor='second'), 'PT409', 'Missing predecessor was not refused')
checks += expect_error(command('invalid', reason=''), '22023', 'Empty reason was not refused')
checks += expect_error(command('invalid', operation='withdraw', predecessor='root'), '22023', 'Withdrawal accepted current context')
checks += expect_error(command('invalid', operation='refresh'), '22023', 'Refresh accepted missing predecessor')
# Same request submitted by another actual staff member, not just an outsider.
checks += f"RESET ROLE; UPDATE workspace_members SET role='admin' WHERE workspace_id='{f['workspace']}' AND user_id='{f['viewer']}'; SELECT set_config('request.jwt.claim.sub','{f['viewer']}',true); SET LOCAL ROLE authenticated;\n"
checks += expect_error(root_command,'23505','Different staff actor reused receipt')
checks += f"RESET ROLE; UPDATE workspace_members SET role='viewer' WHERE workspace_id='{f['workspace']}' AND user_id='{f['viewer']}'; SET LOCAL ROLE authenticated;\n"
checks += expect_error(root_command,'42501','Viewer replay was not refused')
checks += f"SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_response_decision_links WHERE campaign_id='{f['campaign']}'),'Viewer read leaked history'); SELECT set_config('request.jwt.claim.sub','{f['outsider']}',true);\n"
checks += expect_error(root_command,'42501','Outsider replay was not refused')
checks += f"SELECT pg_temp.assert_true((SELECT count(*)=0 FROM engagement_response_decision_links WHERE campaign_id='{f['campaign']}'),'Outsider read leaked history'); SELECT set_config('request.jwt.claim.sub','{f['actor']}',true);\n"
checks += expect_error(f"UPDATE engagement_response_decision_links SET reason='SYNTHETIC overwrite' WHERE id='{ids['root']}'",'42501','Direct staff update was not refused')
checks += expect_error(f"DELETE FROM engagement_response_decision_links WHERE id='{ids['root']}'",'42501','Direct staff delete was not refused')
# Test the immutable trigger with an otherwise privileged writer.
checks += 'RESET ROLE;\n'
checks += expect_error(f"UPDATE engagement_response_decision_links SET reason='SYNTHETIC overwrite' WHERE id='{ids['root']}'",'P0001','Retained receipt update was not refused')
checks += expect_error(f"DELETE FROM engagement_response_decision_links WHERE id='{ids['root']}'",'P0001','Retained receipt delete was not refused')
checks += f"UPDATE project_decisions SET rationale='SYNTHETIC corrected rationale' WHERE id='{f['decision']}'; SET LOCAL ROLE authenticated;\n"
checks += expect_error(command('invalid', operation='refresh', predecessor='root'), 'PT409', 'Old preview survived decision correction')
checks += f"INSERT INTO decision_probe SELECT 'new-preview',read_engagement_response_decision_context('{f['campaign']}','{f['response']}','{f['decision']}');\n"
refresh = command('refresh',operation='refresh',predecessor='root',reason='SYNTHETIC corrected link').replace("key='preview'","key='new-preview'")
checks += "INSERT INTO decision_probe " + refresh.replace('SELECT pg_temp',"SELECT 'refresh',pg_temp",1) + ';\n'
checks += f"SELECT pg_temp.assert_true((SELECT (value->'link'->>'context_text')::jsonb->'decision'->>'rationale'='SYNTHETIC corrected rationale' AND value->'link'->>'predecessor_id'='{ids['root']}' FROM decision_probe WHERE key='refresh'),'Correction context differs');\n"
checks += expect_error(command('fork',operation='refresh',predecessor='root').replace("key='preview'","key='new-preview'"),'PT409','Correction fork was not refused')
checks += f"SELECT pg_temp.assert_true((SELECT context_text=(SELECT value->'link'->>'context_text' FROM decision_probe WHERE key='original') FROM engagement_response_decision_links WHERE id='{ids['root']}'),'Correction changed original');\n"
# The unique predecessor constraint also protects privileged maintenance writes.
checks += 'RESET ROLE;\n'
copy = f"INSERT INTO engagement_response_decision_links(id,workspace_id,campaign_id,response_id,decision_id,project_id,predecessor_id,operation,actor_id,reason,payload_json,context_text) SELECT '{ids['fork']}',workspace_id,campaign_id,response_id,decision_id,project_id,predecessor_id,operation,actor_id,reason,payload_json,context_text FROM engagement_response_decision_links WHERE id='{ids['refresh']}'"
checks += expect_error(copy,'23505','Unique predecessor constraint did not refuse fork')
checks += f"DELETE FROM project_decisions WHERE id='{f['decision']}'; DELETE FROM engagement_closeloop_entries WHERE id='{f['response']}'; DELETE FROM engagement_campaign_projects WHERE campaign_id='{f['campaign']}'; SET LOCAL ROLE authenticated;\n"
checks += f"SELECT pg_temp.assert_true(({root_command})->'link'=(SELECT value->'link' FROM decision_probe WHERE key='original'),'Original retry lost after source deletion');\n"
withdraw = command('withdraw',operation='withdraw',predecessor='refresh',expected=None,reason='SYNTHETIC withdrawal after source removal')
checks += "INSERT INTO decision_probe " + withdraw.replace('SELECT pg_temp',"SELECT 'withdraw',pg_temp",1) + ';\n'
checks += f"SELECT pg_temp.assert_true((SELECT value->'link'->>'context_text'=(SELECT value->'link'->>'context_text' FROM decision_probe WHERE key='refresh') AND value->'link'->>'operation'='withdraw' FROM decision_probe WHERE key='withdraw'),'Withdrawal lost retained context');\n"
checks += expect_error(command('invalid',operation='withdraw',predecessor='withdraw',expected=None),'PT409','Repeated withdrawal was not refused')
checks += f"SELECT pg_temp.assert_true(({withdraw})->'link'=(SELECT value->'link' FROM decision_probe WHERE key='withdraw'),'Withdrawal retry differs');\n"
checks += f"SELECT pg_temp.assert_true((SELECT count(*)=3 FROM engagement_response_decision_links WHERE campaign_id='{f['campaign']}'),'Unexpected lifecycle row count');\n"
checks += f"SELECT jsonb_build_object('lifecycleRows',count(*),'originalsRetained',bool_and(context_sha256=encode(extensions.digest(context_text,'sha256'),'hex'))) FROM engagement_response_decision_links WHERE campaign_id='{f['campaign']}';\n"


def run(body):
    result = fixture.sql("BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s';\n" + fixture.original + body + fixture.seed + helpers + checks + '\nROLLBACK;')
    assert result.returncode == 0, result.stderr
    data=json.loads(result.stdout.splitlines()[-1])
    assert data == {'lifecycleRows':3,'originalsRetained':True}, str(data)
    return data


command_access = original.split("SELECT c.* INTO campaign", 1)[1].split("    RAISE EXCEPTION 'Staff campaign access required'", 1)[0]

mutations = [
    ('request-payload-reuse', ' OR receipt.payload_json IS DISTINCT FROM envelope', '', 'Different payload reused request'),
    ('request-actor-reuse', 'receipt.actor_id IS DISTINCT FROM auth.uid() OR ', '', 'Different staff actor reused receipt'),
    ('viewer-command', command_access, command_access.replace("('owner', 'admin', 'member')", "('owner', 'admin', 'member', 'viewer')"), 'Viewer replay was not refused'),
    ('viewer-history', "m.role IN ('owner', 'admin', 'member'))", "m.role IN ('owner', 'admin', 'member', 'viewer'))", 'Viewer read leaked history'),
    ('stale-source', "IF snapshot->>'contextSha256' IS DISTINCT FROM p_expected_context_sha256 THEN", 'IF false THEN', 'Stale context was not refused'),
    ('overwritten-history', 'CREATE TRIGGER engagement_response_decision_link_immutable BEFORE UPDATE OR DELETE\n  ON public.engagement_response_decision_links FOR EACH ROW\n  EXECUTE FUNCTION public.refuse_engagement_history_change();', '', 'Retained receipt update was not refused'),
    ('forked-history', 'predecessor_id uuid UNIQUE REFERENCES', 'predecessor_id uuid REFERENCES', 'Unique predecessor constraint did not refuse fork'),
    ('withdrawal-original-context', 'saved_context = previous.context_text;', "saved_context = '{}';", 'Withdrawal lost retained context'),
    ('withdrawal-requires-live-source', "IF p_operation = 'withdraw' THEN\n", "IF false THEN\n", 'Response or decision is unavailable'),
    ('empty-reason', "OR p_request = p_predecessor OR NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 2000", 'OR p_request = p_predecessor', 'Empty reason was not refused'),
]
def main():
    results=[]
    try:
        for name,body,expected in [('baseline',original,None),('harmless-comment',original+'\n-- Harmless link comment.\n',None)]+[(name,original.replace(old,new,1),expected) for name,old,new,expected in mutations]:
            if expected:
                old=next(old for mutation,old,_,_ in mutations if mutation==name)
                assert original.count(old)==1,name
            try:
                summary=run(body)
            except AssertionError as error:
                (private/(name+'.log')).write_text(str(error)+'\n')
                assert expected and expected in str(error),str(error)
                outcome='killed'
            else:
                assert expected is None,'Link mutation survived: '+name
                outcome='survived'
            results.append({'case':name,'outcome':outcome,'expectedFailure':expected})
            print(name,outcome,flush=True)
    finally:
        restored=fixture.state()=='339:20261014000020\nt'
        table=fixture.sql("SELECT to_regclass('public.engagement_response_decision_links') IS NULL;")
        restored=restored and table.returncode==0 and table.stdout.strip()=='t'
        (review/'decision-link-results.json').write_text(json.dumps({
            'container':fixture.container,'database':'postgres','baseLedger':'339:20261014000020',
            'candidateSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),
            'contextCandidateSha256':hashlib.sha256(fixture.candidate.read_bytes()).hexdigest(),
            'results':results,'candidateAndFixturesRolledBack':restored,
            'limits':'Native serial lifecycle and mutation evidence only. Concurrency, direct command grants, all malformed intents, PostgREST recovery, UI, public disclosure and exports remain to test before installation and release.',
        },indent=2)+'\n')
        assert restored,'Candidate schema survived rollback'


if __name__ == "__main__":
    main()
