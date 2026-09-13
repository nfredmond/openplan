"""Apply the actual two development migrations together, then roll back."""
from pathlib import Path
import json,subprocess

review=Path(__file__).parent
root=review.resolve().parents[2]
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-migration-install')
private.mkdir(exist_ok=True)
base=['docker','exec','-i','supabase_db_openplan-restore-target-2731143','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1']
def query(sql):
    return subprocess.check_output(base,input=sql,text=True,timeout=15).strip()
assert query("SELECT count(*)||':'||max(version) FROM supabase_migrations.schema_migrations")=='328:20261014000009'
fixture=json.loads((review/'translation-command-lock-fixture.json').read_text())
command=(root/'openplan/supabase/migrations/20261014000010_engagement_translation_commands.sql').read_text()
snapshot=(root/'openplan/supabase/migrations/20261014000011_engagement_translation_snapshot.sql').read_text()
proof=f"""
DO $proof$ DECLARE snapshot jsonb; BEGIN
 IF has_function_privilege('authenticated','public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Unfinished command exposed before producer integration'; END IF;
 IF has_function_privilege('anon','public.read_engagement_translation_snapshot(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Private snapshot exposed anonymously'; END IF;
 PERFORM set_config('request.jwt.claim.sub','{fixture['actor']}',true); SET LOCAL ROLE authenticated;
 snapshot:=read_engagement_translation_snapshot('{fixture['campaign']}');
 IF snapshot->>'campaignId' IS DISTINCT FROM '{fixture['campaign']}' OR snapshot#>>'{{counts,categories}}' IS DISTINCT FROM '2' THEN
  RAISE EXCEPTION 'Installed migration snapshot failed its owner control'; END IF;
 RESET ROLE;
END $proof$;
SELECT 'TRANSLATION_MIGRATION_INSTALL_OK';
"""
cases=[('baseline',command+snapshot,None),('harmless-comment',command+snapshot+'\n-- Harmless installation note.\n',None),
 ('expose-unfinished-command',command+snapshot+'\nGRANT EXECUTE ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) TO authenticated;','Unfinished command exposed before producer integration'),
 ('expose-private-snapshot',command+snapshot+'\nGRANT EXECUTE ON FUNCTION public.read_engagement_translation_snapshot(uuid) TO anon;','Private snapshot exposed anonymously')]
results=[]
for name,body,failure in cases:
    run=subprocess.run(base,input="BEGIN; SET LOCAL statement_timeout='10s';\n"+body+proof+'\nROLLBACK;',text=True,capture_output=True,timeout=20)
    output=run.stdout+run.stderr
    (private/(name+'.log')).write_text(output)
    if failure is None: assert run.returncode==0 and 'TRANSLATION_MIGRATION_INSTALL_OK' in output,output
    else: assert run.returncode!=0 and failure in output,output
    absent=query("""SELECT to_regclass('public.engagement_translation_write_receipts') IS NULL
AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('write_engagement_translations','seal_translation_write_receipt','translation_source_compatibility_hash','translation_source_snapshot','link_translation_history_receipt','read_engagement_translation_snapshot'))
AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='engagement_translation_history' AND column_name='write_request_id');""")
    assert absent=='t','Development migration objects survived rollback'
    results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':failure,'rolledBack':True})
(review/'translation-migration-install-results.json').write_text(json.dumps({'base':'328:20261014000009','container':'supabase_db_openplan-restore-target-2731143','results':results,'limits':'Rollback migration installation and privilege controls; not a release upgrade/restore drill or a grant for unfinished application writes.'},indent=2)+'\n')
print(json.dumps(results))
