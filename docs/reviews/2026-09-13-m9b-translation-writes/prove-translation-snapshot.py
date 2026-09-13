"""Install only in the disconnected proof DB and exercise the scalar snapshot."""
from pathlib import Path
import hashlib,json,subprocess,uuid

review=Path(__file__).parent
root=review.resolve().parents[2]
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-snapshot')
private.mkdir(exist_ok=True)
database='openplan_translation_command_proof_20260913'
base=['docker','exec','-i','supabase_db_openplan-restore-target-2731143','psql','-U','postgres','-d',database,'-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def query(sql,timeout=30):
    return subprocess.check_output(base,input=sql,text=True,timeout=timeout).strip()
def auth(actor):
    return f"SET LOCAL request.jwt.claim.sub='{actor}'; SET LOCAL ROLE authenticated;"
migration=root/'openplan/supabase/migrations/20261014000011_engagement_translation_snapshot.sql'
original=migration.read_text().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
assert query("SELECT to_regprocedure('public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)') IS NOT NULL;")=='t'
query(original)
fixture_path=review/'translation-snapshot-fixture.json'
if not fixture_path.exists():
    f={key:str(uuid.uuid4()) for key in ['actor','viewer','outsider','workspace','campaign','publishedQuestion','draftQuestion','publishedOption','draftOption','publishedResponse','draftResponse']}
    sql=f"""BEGIN; SET LOCAL statement_timeout='90s';
INSERT INTO auth.users(id,aud,role,email) SELECT id,'authenticated','authenticated',id::text||'@translation-snapshot.invalid'
 FROM unnest(ARRAY['{f['actor']}'::uuid,'{f['viewer']}'::uuid,'{f['outsider']}'::uuid]) id;
INSERT INTO workspaces(id,name,slug) VALUES('{f['workspace']}','SYNTHETIC translation snapshot','{f['workspace']}');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('{f['workspace']}','{f['actor']}','owner'),('{f['workspace']}','{f['viewer']}','viewer');
INSERT INTO engagement_campaigns(id,workspace_id,title,summary,created_by) VALUES('{f['campaign']}','{f['workspace']}',chr(160)||'SYNTHETIC raw source'||chr(65279),NULL,'{f['actor']}');
INSERT INTO engagement_categories(campaign_id,label,slug,sort_order)
 SELECT '{f['campaign']}','SYNTHETIC category '||i,'snapshot-'||i,i FROM generate_series(1,1005) i;
INSERT INTO engagement_survey_questions(id,campaign_id,question_type,prompt,status)
 VALUES('{f['publishedQuestion']}','{f['campaign']}','single_choice','SYNTHETIC question','published'),('{f['draftQuestion']}','{f['campaign']}','single_choice','SYNTHETIC draft question','draft');
INSERT INTO engagement_survey_question_options(id,campaign_id,question_id,label)
 VALUES('{f['publishedOption']}','{f['campaign']}','{f['publishedQuestion']}','SYNTHETIC answer'),('{f['draftOption']}','{f['campaign']}','{f['draftQuestion']}','SYNTHETIC draft answer');
INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,you_said,we_did,status)
 VALUES('{f['publishedResponse']}','{f['campaign']}','SYNTHETIC theme','SYNTHETIC input','SYNTHETIC response','published'),('{f['draftResponse']}','{f['campaign']}','SYNTHETIC draft theme','','','draft');
{auth(f['actor'])}
INSERT INTO engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,created_by)
 SELECT '{f['workspace']}','{f['campaign']}','category',id,'label','qaa',chr(160)||'SYNTHETIC wording '||sort_order||chr(65279),'operator','{f['actor']}'
 FROM engagement_categories WHERE campaign_id='{f['campaign']}';
COMMIT;
"""
    run=subprocess.run(base,input=sql,text=True,capture_output=True,timeout=110)
    (private/'seed.log').write_text(run.stdout+run.stderr)
    assert run.returncode==0,run.stderr
    fixture_path.write_text(json.dumps(f,indent=2)+'\n')
f=json.loads(fixture_path.read_text())
def snapshot(actor):
    return json.loads(query(f"BEGIN; {auth(actor)} SELECT read_engagement_translation_snapshot('{f['campaign']}'); ROLLBACK;"))
def check():
    data=snapshot(f['actor'])
    assert data['campaignId']==f['campaign'],'Campaign scope differs'
    assert data['campaign']['title']=='\u00a0SYNTHETIC raw source\ufeff','Raw source was changed'
    expected={'categories':1005,'questions':2,'options':2,'responses':2,'translations':1005}
    assert data['counts']==expected,'Snapshot census differs'
    for key,count in expected.items():
        assert len(data[key])==count,'Snapshot rows truncated: '+key
        assert all(row['campaign_id']==f['campaign'] for row in data[key]),'Cross-campaign row: '+key
    assert all(row['revision']==1 for row in data['translations']),'Current translation revision omitted'
    assert all(row['translated_text'].startswith('\u00a0') and row['translated_text'].endswith('\ufeff') for row in data['translations']),'Stored words were trimmed'
    # Current words/revisions are visible to the same viewer that can read the
    # campaign. Full private change history and command receipts are separate.
    assert snapshot(f['viewer'])==data,'Viewer current-state read differs'
    denied=subprocess.run(base,input=f"BEGIN; {auth(f['outsider'])} SELECT read_engagement_translation_snapshot('{f['campaign']}'); ROLLBACK;",text=True,capture_output=True,timeout=10)
    assert denied.returncode!=0 and 'ERROR:  42501:' in denied.stderr,'Outsider snapshot was not refused'
    return data
results=[]
try:
    for name,body in [('baseline',original),('harmless-comment',original+'\n-- Harmless snapshot comment.\n')]:
        query(body);data=check();results.append({'case':name,'outcome':'survived'})
    for name,old,new,failure in [
      ('truncate-categories',"FROM categories k)","FROM (SELECT * FROM categories LIMIT 1000) k)",'Snapshot rows truncated: categories'),
      ('omit-translation-revision',"AS revision","AS missing_revision",'revision'),
      ('trim-raw-source',"'title',c.title","'title',btrim(c.title,chr(160)||chr(65279))",'Raw source was changed'),
      ('omit-snapshot-authority',"IF auth.uid() IS NULL OR NOT EXISTS(","IF false AND (auth.uid() IS NULL OR NOT EXISTS(",'Outsider snapshot was not refused'),
    ]:
        assert old in original
        changed=original.replace(old,new,1)
        if name=='omit-snapshot-authority': changed=changed.replace(") THEN RAISE EXCEPTION 'Campaign access required'", ")) THEN RAISE EXCEPTION 'Campaign access required'",1)
        query(changed)
        try: check()
        except (AssertionError,KeyError) as error:
            (private/(name+'.log')).write_text(str(error)+'\n')
            assert failure in str(error),str(error)
            results.append({'case':name,'outcome':'killed','expectedFailure':failure})
        else: raise AssertionError('Snapshot mutation survived: '+name)
finally:
    query(original)
data=check()
(private/'snapshot.json').write_text(json.dumps(data)+'\n')
(review/'translation-snapshot-sql-results.json').write_text(json.dumps({'database':database,'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'counts':data['counts'],'results':results,'limits':'Installed scalar SQL through real roles, not HTTP row-cap or concurrent snapshot acceptance yet.'},indent=2)+'\n')
print(json.dumps({'counts':data['counts'],'results':results}))
