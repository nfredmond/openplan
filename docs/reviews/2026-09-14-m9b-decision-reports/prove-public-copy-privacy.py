"""Exercise public-copy candidate and faults inside rolled-back native transactions."""
from pathlib import Path
import hashlib
import json
import subprocess
import time

REVIEW=Path(__file__).resolve().parent
CONTAINER='supabase_db_openplan-restore-target-2026091050'
CANDIDATE=(REVIEW/'public-copy-privacy-candidate.sql').read_text()
FIXTURE=(REVIEW/'public-report-privacy-fixture.sql').read_text()
PROBE=(REVIEW/'public-copy-privacy-probe.sql').read_text()
SEED,TAIL=FIXTURE.split("SELECT set_config('request.jwt.claim.sub'",1)
TAIL="SELECT set_config('request.jwt.claim.sub'"+TAIL
PRIVATE=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('public-copy-privacy-'+str(time.time_ns()))
PRIVATE.mkdir()

def sql(statement):
    return subprocess.run(['docker','exec','-i',CONTAINER,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=45)

def fingerprint():
    result=sql("SELECT count(*)||':'||max(version) FROM supabase_migrations.schema_migrations; SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'; SELECT to_regclass('public.engagement_public_items') IS NULL;")
    assert result.returncode==0,result.stderr
    return result.stdout

before=fingerprint()
assert before.startswith('341:20261014000022\n') and before.endswith('t\n'),before
cases=[('baseline',CANDIDATE,None),('harmless',CANDIDATE+'\n-- Harmless candidate comment.\n',None)]
def fault(name,old,new,expected,section=None):
    part=CANDIDATE
    if section:
        start=CANDIDATE.index('CREATE OR REPLACE FUNCTION public.'+section+'(')
        delimiter='$function$;' if '$function$' in CANDIDATE[start:CANDIDATE.index('AS ',start)+20] else 'END $$;'
        end=CANDIDATE.index(delimiter,start)+len(delimiter)
        part=CANDIDATE[start:end]
    assert part.count(old)==1,(name,part.count(old))
    changed=part.replace(old,new,1)
    cases.append((name,CANDIDATE.replace(part,changed,1) if section else changed,expected))
fault('review-status',"coalesce(p_status='approved'",'coalesce(true','view-record-selection')
fault('private-flag',"  AND lower(btrim(coalesce(p_metadata->>'private_note',''),chars)) <> 'true'",'', 'view-record-selection')
fault('internal-flag',"  AND lower(btrim(coalesce(p_metadata->>'internal_note',''),chars)) <> 'true'",'', 'view-record-selection')
fault('visibility',"  AND lower(btrim(coalesce(p_metadata->>'visibility',''),chars)) <> 'private'",'', 'view-record-selection')
fault('unicode-private-flag','chr(160)||','', 'view-record-selection')
fault('view-direct-authenticated','GRANT SELECT ON public.engagement_public_items TO service_role;','GRANT SELECT ON public.engagement_public_items TO service_role,authenticated;','view-no-authenticated-read')
fault('view-direct-anonymous','GRANT SELECT ON public.engagement_public_items TO service_role;','GRANT SELECT ON public.engagement_public_items TO service_role,anon;','view-no-anonymous-read')
fault('view-write-grant','GRANT SELECT ON public.engagement_public_items TO service_role;','GRANT ALL ON public.engagement_public_items TO service_role;','view-no-direct-writes')
fault('view-projection','i.parent_item_id,i.created_at,i.status','i.parent_item_id,i.created_at,i.status,i.metadata_json','view-private-columns')
fault('view-item','WHERE public.engagement_item_public_copy_allowed(i.status,i.metadata_json)',"WHERE i.status='approved'",'view-record-selection')
fault('view-parent','AND public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)));\nREVOKE',"AND parent.status='approved'));\nREVOKE",'view-record-selection')
fault('translation-item','AND public.engagement_item_public_copy_allowed(status,metadata_json) FOR SHARE NOWAIT',"AND status='approved' FOR SHARE NOWAIT",'translation-private-denial','lock_public_translation_source')
fault('translation-parent','AND public.engagement_item_public_copy_allowed(status,metadata_json) AND parent_item_id',"AND status='approved' AND parent_item_id",'translation-parent-denial','lock_public_translation_source')
fault('response-publication-item','public.engagement_item_public_copy_allowed(i.status,i.metadata_json)',"i.status='approved'",'private-response-publication-denial','guard_engagement_response_publication')
fault('response-publication-parent','public.engagement_item_public_copy_allowed(p.status,p.metadata_json)',"p.status='approved'",'parent-response-publication-denial','guard_engagement_response_publication')
fault('response-public-read','public.engagement_item_public_copy_allowed(item.status,item.metadata_json)',"item.status='approved'",'published-response-selection','read_engagement_response_snapshot')
fault('old-cache','public.engagement_item_public_copy_allowed(status,metadata_json)',"status='approved'",'private-old-cache-denial','engagement_cache_item_translation')
fault('reviewed-cache','public.engagement_item_public_copy_allowed(status,metadata_json)',"status='approved'",'private-reviewed-cache-denial','engagement_cache_reviewed_translation')
fault('reviewed-cache-parent','public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)',"parent.status='approved'",'parent-reviewed-cache-denial','engagement_cache_reviewed_translation')
fault('privacy-review-version','NEW.review_expected_updated_at IS DISTINCT FROM OLD.updated_at','false','privacy-review-version-required','require_engagement_review_intent')
fault('privacy-review-reason',"IF NULLIF(btrim(NEW.review_reason),'') IS NULL THEN",'IF false THEN','privacy-review-reason-required','require_engagement_review_intent')
flags="ROW(NEW.metadata_json->'private_note',NEW.metadata_json->'internal_note',NEW.metadata_json->'visibility') IS DISTINCT FROM ROW(OLD.metadata_json->'private_note',OLD.metadata_json->'internal_note',OLD.metadata_json->'visibility')"
fault('privacy-withdrawal',flags,'false','privacy-withdraws-response','guard_engagement_public_copy')
fault('privacy-history',flags,'false','privacy-history-retained','retain_engagement_item_history')
fault('reply-write','public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)',"parent.status='approved'",'private-reply-denial','guard_engagement_public_copy')
fault('vote-write','public.engagement_item_public_copy_allowed(status,metadata_json)',"status='approved'",'private-vote-denial','guard_engagement_public_vote')
fault('vote-parent-write','public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)',"parent.status='approved'",'parent-vote-denial','guard_engagement_public_vote')
out=[]
for name,candidate,expected in cases:
    result=sql("BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n"+SEED+'\n'+candidate+'\n'+TAIL+'\n'+PROBE+'\nROLLBACK;')
    (PRIVATE/(name+'.log')).write_text(result.stdout+result.stderr)
    assert result.returncode==0,(name,result.stderr)
    assertions=json.loads(result.stdout.splitlines()[-1]);fail=[key for key,value in assertions.items() if value is not True]
    if expected is None:assert not fail,(name,fail)
    else:assert expected in fail,(name,expected,fail)
    assert fingerprint()==before,'Transaction-local proof changed installed definitions'
    out.append({'name':name,'outcome':'survived' if not fail else 'killed','assertionCount':len(assertions),'failedAssertions':fail})
    print(name,out[-1]['outcome'],flush=True)
(REVIEW/'public-copy-privacy-results.json').write_text(json.dumps({'candidateSha256':hashlib.sha256(CANDIDATE.encode()).hexdigest(),'fixtureSha256':hashlib.sha256(FIXTURE.encode()).hexdigest(),'probeSha256':hashlib.sha256(PROBE.encode()).hexdigest(),'container':CONTAINER,'database':'postgres','outcomes':out,'installedDefinitionsUnchanged':fingerprint()==before,'privateEvidence':str(PRIVATE),'limits':['Candidate only; no application migration installed.','Native transaction proof does not establish application callers, public browser navigation, artifacts or concurrent operations.','Explicit privacy flags only; source-type-only policy remains unchanged.']},indent=2)+'\n')
