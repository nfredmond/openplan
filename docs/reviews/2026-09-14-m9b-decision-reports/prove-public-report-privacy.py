"""Prove report selection with transaction-local candidates; never install or alter originals."""
from pathlib import Path
import collections
import hashlib
import json
import subprocess
import time

REVIEW=Path(__file__).resolve().parent
CONTAINER='supabase_db_openplan-restore-target-2026091050'
CANDIDATE=(REVIEW/'public-report-privacy-candidate.sql').read_text()
FIXTURE=(REVIEW/'public-report-privacy-fixture.sql').read_text()
PRIVATE=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('public-report-privacy-'+str(time.time_ns()))
PRIVATE.mkdir()

def sql(statement):
    return subprocess.run(['docker','exec','-i',CONTAINER,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=45)

def fingerprint():
    value=sql("SELECT count(*)||':'||max(version) FROM supabase_migrations.schema_migrations; SELECT md5(pg_get_functiondef('public.queue_engagement_report(uuid,uuid,text,jsonb)'::regprocedure)); SELECT to_regprocedure('public.engagement_item_public_copy_allowed(text,jsonb)') IS NULL;")
    assert value.returncode==0,value.stderr
    return value.stdout

before=fingerprint()
assert before.startswith('341:20261014000022\n') and before.endswith('t\n'),before
cases=[('baseline',CANDIDATE,None),('harmless',CANDIDATE+'\n-- Harmless public report comment.\n',None)]
def fault(name,old,new,expected):
    assert CANDIDATE.count(old)==1,(name,CANDIDATE.count(old))
    cases.append((name,CANDIDATE.replace(old,new,1),expected))
fault('private-flag',"  AND lower(btrim(coalesce(p_metadata->>'private_note',''),chars)) <> 'true'",'', 'public-record-selection')
fault('internal-flag',"  AND lower(btrim(coalesce(p_metadata->>'internal_note',''),chars)) <> 'true'",'', 'public-record-selection')
fault('visibility',"  AND lower(btrim(coalesce(p_metadata->>'visibility',''),chars)) <> 'private'",'', 'public-record-selection')
fault('review-state',"coalesce(p_status='approved'",'coalesce(true','public-record-selection')
fault('unicode-private-flag','chr(160)||','', 'public-record-selection')
fault('queue-record-scope','public.engagement_item_public_copy_allowed(i.status,i.metadata_json)',"i.status='approved'",'public-record-selection')
fault('queue-parent-scope','public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)',"parent.status='approved'",'public-record-selection')
fault('internal-originals',"AND (p_scope='internal' OR (public.engagement_item_public_copy_allowed",'AND (false OR (public.engagement_item_public_copy_allowed','internal-original-retention')
fault('response-source-selection','AND NOT EXISTS(SELECT 1 FROM unnest(e.source_item_ids) source_id WHERE NOT EXISTS(SELECT 1 FROM selected_items i WHERE i.id=source_id))','AND true','public-response-selection')
out=[]
for name,candidate,expected in cases:
    result=sql("BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n"+candidate+'\n'+FIXTURE+'\nROLLBACK;')
    (PRIVATE/(name+'.log')).write_text(result.stdout+result.stderr)
    assert result.returncode==0,(name,result.stderr)
    snapshots=json.loads(result.stdout.splitlines()[-1]);fail=[]
    expected_public={'81100000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000006'}
    if {i['id'] for i in snapshots['public']['items']}!=expected_public:fail.append('public-record-selection')
    if len(snapshots['internal']['items'])!=8:fail.append('internal-original-retention')
    if [r['id'] for r in snapshots['public']['responses']]!=['81100000-0000-4000-8000-000000000010']:fail.append('public-response-selection')
    if len(snapshots['internal']['responses'])!=2:fail.append('internal-response-retention')
    if expected is None:assert not fail,(name,fail)
    else:assert expected in fail,(name,expected,fail)
    assert fingerprint()==before,'Transaction-local proof changed installed definitions'
    out.append({'name':name,'outcome':'survived' if not fail else 'killed','failedAssertions':fail})
    print(name,out[-1]['outcome'],flush=True)
(REVIEW/'public-report-privacy-results.json').write_text(json.dumps({'candidateSha256':hashlib.sha256(CANDIDATE.encode()).hexdigest(),'fixtureSha256':hashlib.sha256(FIXTURE.encode()).hexdigest(),'container':CONTAINER,'database':'postgres','outcomes':out,'installedDefinitionsUnchanged':fingerprint()==before,'privateEvidence':str(PRIVATE),'limits':['Candidate only; no application migration installed.','Tests cover report queue selection, not existing archived artifacts, public portal, attachment or translation reads.','Flags are explicit private_note/internal_note/visibility. Source-type-only privacy policy is not changed.']},indent=2)+'\n')
