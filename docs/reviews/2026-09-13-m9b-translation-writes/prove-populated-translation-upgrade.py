"""Rehearse migrations on the retained v0.58.1 schema inside rolled-back transactions."""
import hashlib,json,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[3]
review=Path(__file__).resolve().parent
container='supabase_db_openplan-restore-target-2731143'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('translation-populated-upgrade-'+str(time.time_ns()))
private.mkdir(mode=0o700)
def sql(text):
 return subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=text,text=True,capture_output=True,timeout=120)
ledger=sql("SELECT count(*)||':'||max(version) FROM supabase_migrations.schema_migrations;")
assert ledger.returncode==0 and ledger.stdout.strip()=='328:20261014000009',ledger.stderr
migrations=sorted((root/'openplan/supabase/migrations').glob('202610140000*.sql'))
migrations=[p for p in migrations if p.name[:14]>'20261014000009']
assert len(migrations)==11
seed="""
CREATE TEMP TABLE upgrade_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() workspace,gen_random_uuid() campaign,gen_random_uuid() item,gen_random_uuid() translation;
INSERT INTO auth.users(id,aud,role,email) SELECT actor,'authenticated','authenticated',actor::text||'@synthetic-upgrade.invalid' FROM upgrade_fixture;
INSERT INTO workspaces(id,name,slug) SELECT workspace,'SYNTHETIC translation upgrade',workspace::text FROM upgrade_fixture;
INSERT INTO workspace_members(workspace_id,user_id,role) SELECT workspace,actor,'owner' FROM upgrade_fixture;
SELECT set_config('request.jwt.claim.sub',(SELECT actor::text FROM upgrade_fixture),true);
INSERT INTO engagement_campaigns(id,workspace_id,title,created_by,status,share_token) SELECT campaign,workspace,'SYNTHETIC original title',actor,'active','SYNTHETIC-upgrade-'||campaign FROM upgrade_fixture;
INSERT INTO engagement_content_translations(id,workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,created_by)
 SELECT translation,workspace,campaign,'campaign',campaign,'title','es','SYNTHETIC original wording','operator',actor FROM upgrade_fixture;
UPDATE engagement_content_translations SET translated_text='SYNTHETIC corrected wording' WHERE id=(SELECT translation FROM upgrade_fixture);
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type) SELECT item,campaign,'SYNTHETIC title','SYNTHETIC body','approved','internal' FROM upgrade_fixture;
SELECT engagement_cache_reviewed_translation(item,'fr','SYNTHETIC legacy cache','SYNTHETIC title','SYNTHETIC body','425486ff8c087a93e2139240f4ddd1ab7b84b1229589eabd3c0f9c451f3ad098') FROM upgrade_fixture;
DO $$ BEGIN IF (SELECT count(*) FROM engagement_translation_history WHERE translation_id=(SELECT translation FROM upgrade_fixture))<>2 THEN RAISE EXCEPTION 'Missing positive history fixture'; END IF; END $$;
CREATE TEMP TABLE upgrade_snapshots(schema_name text,table_name text,projection text,rows bigint,hash text);
DO $$ DECLARE r record; cols text; n bigint; h text; BEGIN
 FOR r IN SELECT t.table_schema,t.table_name FROM information_schema.tables t WHERE t.table_schema IN ('public','auth','storage') AND t.table_type='BASE TABLE' ORDER BY 1,2 LOOP
  SELECT string_agg(quote_ident(column_name),',' ORDER BY ordinal_position) INTO cols FROM information_schema.columns WHERE table_schema=r.table_schema AND table_name=r.table_name;
  EXECUTE format('SELECT count(*),encode(extensions.digest(coalesce(string_agg(row_to_json(x)::text,E''\\n'' ORDER BY row_to_json(x)::text),''''),''sha256''),''hex'') FROM (SELECT %s FROM %I.%I) x',cols,r.table_schema,r.table_name) INTO n,h;
  INSERT INTO upgrade_snapshots VALUES(r.table_schema,r.table_name,cols,n,h);
 END LOOP;
END $$;
"""
verify="""
DO $$ DECLARE r record; n bigint; h text; BEGIN
 FOR r IN SELECT * FROM upgrade_snapshots ORDER BY CASE table_name WHEN 'engagement_content_translations' THEN 0 WHEN 'engagement_translation_history' THEN 1 ELSE 2 END,schema_name,table_name LOOP
  EXECUTE format('SELECT count(*),encode(extensions.digest(coalesce(string_agg(row_to_json(x)::text,E''\\n'' ORDER BY row_to_json(x)::text),''''),''sha256''),''hex'') FROM (SELECT %s FROM %I.%I) x',r.projection,r.schema_name,r.table_name) INTO n,h;
  IF n IS DISTINCT FROM r.rows OR h IS DISTINCT FROM r.hash THEN RAISE EXCEPTION 'Upgrade changed existing rows: %.%',r.schema_name,r.table_name; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=(SELECT translation FROM upgrade_fixture) AND record_json->>'translated_text'='SYNTHETIC original wording') THEN RAISE EXCEPTION 'Original history missing'; END IF;
 IF read_public_translation_cache('SYNTHETIC-upgrade-'||(SELECT campaign FROM upgrade_fixture),(SELECT item FROM upgrade_fixture),'fr',read_public_translation_source('SYNTHETIC-upgrade-'||(SELECT campaign FROM upgrade_fixture),(SELECT item FROM upgrade_fixture))) IS DISTINCT FROM '"SYNTHETIC legacy cache"'::jsonb THEN RAISE EXCEPTION 'Legacy cache not readable after upgrade'; END IF;
END $$;
SELECT json_build_object('tablesCompared',count(*),'populatedTables',count(*) FILTER (WHERE rows>0),'retainedRows',sum(rows),'preserved',true) FROM upgrade_snapshots;
"""
results=[]
for name,fault,expected in [('baseline','',None),('harmless-comment','-- no behavior change\n',None),('changed-saved-wording',"UPDATE engagement_content_translations SET translated_text='SYNTHETIC damaged wording' WHERE id=(SELECT translation FROM upgrade_fixture);",'Upgrade changed existing rows: public.engagement_content_translations'),('changed-cached-wording',"UPDATE engagement_items SET metadata_json='{}'::jsonb WHERE id=(SELECT item FROM upgrade_fixture);",'Upgrade changed existing rows: public.engagement_items')]:
 script="BEGIN; SET LOCAL statement_timeout='90s'; SET LOCAL lock_timeout='5s';\n"+seed+fault+'\n'+'\n'.join(p.read_text() for p in migrations)+verify+'\nROLLBACK;\n'
 result=sql(script)
 (private/(name+'.sql')).write_text(script)
 (private/(name+'.log')).write_text(result.stdout+result.stderr)
 ok=(result.returncode==0 and '"preserved" : true' in result.stdout) if expected is None else result.returncode!=0 and expected in result.stderr
 results.append({'case':name,'exit':result.returncode,'expectedOutcome':ok,'expectedFailure':expected,'output':result.stdout.splitlines()[-1:] if result.returncode==0 else result.stderr.splitlines()[-3:]})
 print(name,ok,flush=True)
 if not ok: break
final=sql("SELECT count(*)||':'||max(version) FROM supabase_migrations.schema_migrations; SELECT to_regclass('public.engagement_public_translation_requests') IS NULL;")
restored=final.returncode==0 and final.stdout.strip()=='328:20261014000009\nt'
(review/'populated-translation-upgrade.json').write_text(json.dumps({'container':container,'privateEvidence':str(private),'baseLedger':ledger.stdout.strip(),'migrations':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in migrations},'results':results,'baselineSchemaRestored':restored,'limits':'Rolled-back application of all eleven migrations on an installed v0.58.1 schema, preserving original columns of all existing public/auth/storage tables. Synthetic legacy writes use the old allowed direct staff producer and cache RPC. Not a committed CLI installation, archive restoration or translation quality test. The separate GitHub upgrade workflow covers committed CLI application.'},indent=2)+'\n')
assert len(results)==4 and all(r['expectedOutcome'] for r in results) and restored
