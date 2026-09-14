"""Exercise the candidate with native roles, rolling back every fixture and DDL."""
from pathlib import Path
import hashlib
import json
import subprocess
import uuid

review = Path(__file__).resolve().parent
container = 'supabase_db_openplan-restore-target-2026091050'
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')
private.mkdir(parents=True, exist_ok=True)
candidate = review / 'decision-context-candidate.sql'
original = candidate.read_text()
f = {key: str(uuid.uuid4()) for key in (
    'actor', 'viewer', 'outsider', 'workspace', 'otherWorkspace', 'campaign',
    'otherCampaign', 'project', 'otherProject', 'unlinkedProject', 'decision',
    'otherDecision', 'unlinkedDecision', 'response', 'otherResponse',
    'knownItem', 'unknownItem', 'missingItem', 'foreignItem')}


def sql(script):
    return subprocess.run([
        'docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
        '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    ], input=script, text=True, capture_output=True, timeout=30)


def state():
    result = sql("SELECT count(*)||':'||max(version) FROM supabase_migrations.schema_migrations;"
                 "SELECT to_regprocedure('public.read_engagement_response_decision_context(uuid,uuid,uuid)') IS NULL;")
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


assert state() == '339:20261014000020\nt', 'Unexpected target schema; do not alter this stack'
seed = f"""
INSERT INTO auth.users(id,aud,role,email)
 SELECT id,'authenticated','authenticated',id::text||'@synthetic-decision.invalid'
 FROM unnest(ARRAY['{f['actor']}'::uuid,'{f['viewer']}'::uuid,'{f['outsider']}'::uuid]) id;
INSERT INTO workspaces(id,name,slug) VALUES
 ('{f['workspace']}','SYNTHETIC decision traceability','{f['workspace']}'),
 ('{f['otherWorkspace']}','SYNTHETIC foreign workspace','{f['otherWorkspace']}');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES
 ('{f['workspace']}','{f['actor']}','owner'),('{f['workspace']}','{f['viewer']}','viewer'),
 ('{f['otherWorkspace']}','{f['outsider']}','owner');
INSERT INTO projects(id,workspace_id,name) VALUES
 ('{f['project']}','{f['workspace']}','SYNTHETIC linked project'),
 ('{f['otherProject']}','{f['otherWorkspace']}','SYNTHETIC foreign project'),
 ('{f['unlinkedProject']}','{f['workspace']}','SYNTHETIC unlinked project');
INSERT INTO engagement_campaigns(id,workspace_id,project_id,title,created_by) VALUES
 ('{f['campaign']}','{f['workspace']}','{f['project']}','SYNTHETIC original question context','{f['actor']}'),
 ('{f['otherCampaign']}','{f['otherWorkspace']}','{f['otherProject']}','SYNTHETIC foreign context','{f['outsider']}');
INSERT INTO project_decisions(id,project_id,title,rationale,status) VALUES
 ('{f['decision']}','{f['project']}','SYNTHETIC decision','SYNTHETIC private rationale','proposed'),
 ('{f['otherDecision']}','{f['otherProject']}','SYNTHETIC foreign decision','SYNTHETIC foreign rationale','approved'),
 ('{f['unlinkedDecision']}','{f['unlinkedProject']}','SYNTHETIC unlinked decision','SYNTHETIC unlinked rationale','rejected');
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type,configuration_version_id,geometry,submitted_by,moderation_notes,metadata_json)
 SELECT '{f['knownItem']}','{f['campaign']}',chr(160)||'SYNTHETIC raw title'||chr(65279),
 'SYNTHETIC original source words','pending','internal',configuration_version_id,
 '{{"type":"LineString","coordinates":[[12.5,-8.25],[12.75,-8.5]]}}',
 'SYNTHETIC private contact','SYNTHETIC moderation notes','{{"private":"SYNTHETIC metadata"}}'
 FROM engagement_campaigns WHERE id='{f['campaign']}';
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type) VALUES
 ('{f['unknownItem']}','{f['campaign']}',NULL,'SYNTHETIC unknown historical configuration','pending','internal'),
 ('{f['foreignItem']}','{f['otherCampaign']}','SYNTHETIC foreign source','SYNTHETIC foreign words','pending','internal');
INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,you_said,we_did,status,source_item_ids) VALUES
 ('{f['response']}','{f['campaign']}','SYNTHETIC theme','SYNTHETIC minority input','SYNTHETIC original answer','draft',
 ARRAY['{f['knownItem']}'::uuid,'{f['unknownItem']}'::uuid,'{f['knownItem']}'::uuid,'{f['missingItem']}'::uuid,'{f['foreignItem']}'::uuid]),
 ('{f['otherResponse']}','{f['otherCampaign']}','SYNTHETIC foreign theme','','','draft','{{}}');
UPDATE engagement_closeloop_entries SET we_did='SYNTHETIC corrected answer' WHERE id='{f['response']}';
UPDATE engagement_campaigns SET title='SYNTHETIC revised question context' WHERE id='{f['campaign']}';
"""


def run(body, *, actor='actor', role='authenticated', change='', response=None, decision=None):
    actor_id = f[actor] if actor else ''
    query = f"""
SELECT set_config('request.jwt.claim.sub','{actor_id}',true);
SET LOCAL ROLE {role};
SELECT public.read_engagement_response_decision_context(
 '{f['campaign']}','{response or f['response']}','{decision or f['decision']}');
"""
    result = sql("BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s';\n"
                 + body + seed + change + query + '\nROLLBACK;')
    return result


def context(result):
    assert result.returncode == 0, result.stderr
    envelope = json.loads(result.stdout.splitlines()[-1])
    assert envelope['contextSha256'] == hashlib.sha256(envelope['contextText'].encode()).hexdigest(), 'Context checksum differs'
    return json.loads(envelope['contextText']), envelope


def denied(result, code, message):
    assert result.returncode != 0 and f'ERROR:  {code}:' in result.stderr, message + ': ' + result.stderr


def check(body):
    data, envelope = context(run(body))
    assert data['visibility'] == 'private' and data['sourceObservation'] == 'current_at_link_preview', 'Preview meaning differs'
    assert data['campaign']['id'] == f['campaign'] and data['project']['id'] == f['project'], 'Context scope differs'
    assert data['decision']['rationale'] == 'SYNTHETIC private rationale', 'Decision content omitted'
    assert data['decision']['status'] == 'proposed', 'Decision status was promoted'
    assert data['response']['we_did'] == 'SYNTHETIC corrected answer', 'Current response omitted'
    assert data['responseHistory']['revision'] == 2, 'Wrong retained revision'
    h = data['responseHistory']
    assert hashlib.sha256(h['recordText'].encode()).hexdigest() == h['recordSha256'], 'History checksum differs'
    assert json.loads(h['recordText']) == data['response'], 'Wrong retained response content'
    assert data['sourceCount'] == 5 and len(data['sources']) == 5, 'Source references dropped'
    assert [s['itemId'] for s in data['sources']] == [f[k] for k in ('knownItem','unknownItem','knownItem','missingItem','foreignItem')], 'Source ordering or duplicates changed'
    assert [s['position'] for s in data['sources']] == [1,2,3,4,5], 'Source positions changed'
    a, b, _, missing, foreign = data['sources']
    assert a['configurationAvailability'] == 'available', 'Known configuration was lost'
    assert a['record']['body'] == 'SYNTHETIC original source words', 'Source body changed'
    assert a['record']['title'] == '\u00a0SYNTHETIC raw title\ufeff', 'Source wording changed'
    assert a['record']['geometry'] == {'type':'LineString','coordinates':[[12.5,-8.25],[12.75,-8.5]]}, 'Source geometry changed'
    assert b['configurationAvailability'] == 'unknown', 'Unknown configuration was fabricated'
    assert missing['availability'] == 'unavailable' and missing['record'] is None, 'Missing source was invented'
    assert foreign['availability'] == 'unavailable' and foreign['record'] is None, 'Foreign source leaked'
    assert not {'submitted_by','moderation_notes','metadata_json','photo_path','created_by'} & a['record'].keys(), 'Unneeded private fields leaked'
    assert data['configurationCount'] == 1 and len(data['configurations']) == 1, 'Wrong definition census'
    definition = data['configurations'][0]
    assert definition['id'] == a['record']['configuration_version_id'], 'Wrong source configuration reference'
    assert json.loads(definition['definitionText'])['campaign']['title'] == 'SYNTHETIC original question context', 'Historical definition was replaced'
    assert hashlib.sha256(definition['definitionText'].encode()).hexdigest() == definition['definitionSha256'], 'Definition checksum differs'
    for actor in ('viewer','outsider',None):
        denied(run(body, actor=actor), '42501', f'{actor} read was not refused')
    for role in ('anon','service_role'):
        denied(run(body, actor=None, role=role), '42501', f'{role} execution was not refused')
        denied(run(body, actor='actor', role=role), '42501', f'{role} authenticated execution was not refused')
    denied(run(body, response=f['otherResponse']), 'P0002', 'Foreign response read was not refused')
    for key in ('otherDecision','unlinkedDecision'):
        denied(run(body, decision=f[key]), 'P0002', f'{key} read was not refused')
    denied(run(body, change=f"DELETE FROM engagement_campaign_projects WHERE campaign_id='{f['campaign']}';"), 'P0002', 'Removed project relationship was not refused')
    bad_history = f"""INSERT INTO engagement_response_history(campaign_id,response_id,revision,event,record_json)
      SELECT campaign_id,response_id,revision+1,'corrected',record_json||'{{"we_did":"SYNTHETIC inconsistent history"}}'
      FROM engagement_response_history WHERE response_id='{f['response']}' ORDER BY revision DESC LIMIT 1;"""
    denied(run(body, change=bad_history), 'PT409', 'Inconsistent response history was not refused')
    no_op, _ = context(run(body, change=f"UPDATE engagement_closeloop_entries SET we_did=we_did WHERE id='{f['response']}';"))
    assert no_op['responseHistory']['revision'] == 2, 'No-op invented a history revision'
    assert no_op['response']['updated_at'] != json.loads(no_op['responseHistory']['recordText'])['updated_at'], 'No-op fixture did not advance its clock'
    before = {k:v for k,v in json.loads(no_op['responseHistory']['recordText']).items() if k != 'updated_at'}
    after = {k:v for k,v in no_op['response'].items() if k != 'updated_at'}
    assert before == after, 'No-op content changed'
    empty, _ = context(run(body, change=f"UPDATE engagement_closeloop_entries SET source_item_ids='{{}}' WHERE id='{f['response']}';"))
    assert empty['sourceCount'] == 0 and empty['sources'] == [] and empty['configurations'] == [], 'Empty sources confused with missing sources'
    # Compare both reads inside one transaction so random fixture times cannot
    # make an omitted source appear to affect the context checksum.
    changes = [
        ("UPDATE project_decisions SET rationale='SYNTHETIC revised rationale' WHERE id='{decision}';", 'decision'),
        ("UPDATE engagement_items SET body='SYNTHETIC revised input',review_expected_updated_at=updated_at,review_reason='SYNTHETIC source correction' WHERE id='{knownItem}';", 'source'),
    ]
    for change, label in changes:
        script = "BEGIN; SET LOCAL statement_timeout='20s';\n" + body + seed
        script += f"SELECT set_config('request.jwt.claim.sub','{f['actor']}',true);"
        script += f"CREATE TEMP TABLE first_context AS SELECT read_engagement_response_decision_context('{f['campaign']}','{f['response']}','{f['decision']}') AS value;"
        script += change.format(**f)
        script += f"SELECT (SELECT value->>'contextSha256' FROM first_context) <> (read_engagement_response_decision_context('{f['campaign']}','{f['response']}','{f['decision']}')->>'contextSha256'); ROLLBACK;"
        result = sql(script)
        assert result.returncode == 0 and result.stdout.splitlines()[-1] == 't', f'{label} change did not change context: {result.stderr}'
    return {'sourceReferences':len(data['sources']),'configurationDefinitions':len(data['configurations'])}


mutations = [
    ('viewer-access', "m.role IN ('owner', 'admin', 'member')", "m.role IN ('owner', 'admin', 'member', 'viewer')", 'viewer read was not refused'),
    ('foreign-source', 'i.id = s.item_id AND i.campaign_id = p_campaign', 'i.id = s.item_id', 'Foreign source leaked'),
    ('unlinked-project', ' OR relationship.id IS NULL', '', 'unlinkedDecision read was not refused'),
    ('missing-history-comparison', "OR (history.record_json - 'updated_at') IS DISTINCT FROM (to_jsonb(response) - 'updated_at')", '', 'Inconsistent response history was not refused'),
    ('wrong-history-order', 'ORDER BY revision DESC LIMIT 1', 'ORDER BY revision ASC LIMIT 1', 'Response history does not match'),
    ('fabricated-configuration', "THEN 'unknown'", "THEN 'available'", 'Unknown configuration was fabricated'),
    ('trimmed-title', "'title', i.title", "'title', btrim(i.title,chr(160)||chr(65279))", 'Source wording changed'),
    ('lost-geometry', "'geometry', i.geometry", "'geometry', NULL", 'Source geometry changed'),
    ('dropped-source', 'unnest(response.source_item_ids)', 'unnest(response.source_item_ids[1:4])', 'Source references dropped'),
    ('private-contact', "'title', i.title", "'submitted_by', i.submitted_by, 'title', i.title", 'Unneeded private fields leaked'),
    ('decision-promoted', "'decision', to_jsonb(decision)", "'decision', to_jsonb(decision)||'{\"status\":\"approved\"}'::jsonb", 'Decision status was promoted'),
    ('missing-definition', 'v.id = i.configuration_version_id', 'v.id = NULL::uuid', 'Known configuration was lost'),
    ('missing-source-body', "'body', i.body", "'body', NULL", 'Source body changed'),
    ('anonymous-grant', 'TO authenticated;', 'TO authenticated, anon;', 'anon authenticated execution was not refused'),
    ('service-grant', 'TO authenticated;', 'TO authenticated, service_role;', 'service_role authenticated execution was not refused'),
    ('wrong-context-checksum', "extensions.digest(context::text, 'sha256')", "extensions.digest('{}', 'sha256')", 'Context checksum differs'),
    ('current-definition-substitution', 'v.id IN (\n    SELECT i.configuration_version_id FROM public.engagement_items i\n    WHERE i.campaign_id = p_campaign AND i.id = ANY(response.source_item_ids)\n  )', 'v.id = campaign.configuration_version_id', 'Wrong source configuration reference'),
]
def main():
    results = []
    try:
        for name, body, expected in [('baseline', original, None), ('harmless-comment', original+'\n-- Harmless context comment.\n', None)] + [
            (name, original.replace(old,new,1), expected) for name,old,new,expected in mutations
        ]:
            if expected is not None:
                old = next(old for mutation,old,_,_ in mutations if mutation == name)
                assert original.count(old) == 1, name
            try:
                counts = check(body)
            except AssertionError as error:
                (private/(name+'.log')).write_text(str(error)+'\n')
                if expected is None or expected not in str(error):
                    raise
                outcome = 'killed'
            else:
                assert expected is None, 'Mutation survived: '+name
                outcome = 'survived'
            results.append({'case':name,'outcome':outcome,'expectedFailure':expected})
            print(name, outcome, flush=True)
    finally:
        restored = state() == '339:20261014000020\nt'
        (review/'decision-context-results.json').write_text(json.dumps({
            'container':container,'database':'postgres','baseLedger':'339:20261014000020',
            'candidateSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),
            'results':results,'candidateAndFixturesRolledBack':restored,
            'limits':'Native SQL snapshot and role evidence only. No link commands, concurrent writes, HTTP or browser acceptance. Source words are observed at preview time. Missing referenced definitions cannot normally be stored because the existing foreign key refuses them.',
        },indent=2)+'\n')
        assert restored, 'Candidate or ledger changed outside rollback'


if __name__ == "__main__":
    main()
