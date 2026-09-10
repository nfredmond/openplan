import json, subprocess, hashlib
from pathlib import Path
root=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-evidence-2026-09-09')
text=(root/'src/test/work-program-closeout-rls.test.ts').read_text()
fixture=text[text.index('DO $test$ DECLARE'):text.index('   close_data:=public.read_work_program_closeout')].replace('${extraSource}','').replace('${progress}','Review remains')+'\n INSERT INTO upgrade_ids VALUES(p); END $test$;'
base=(root/'supabase/migrations/20261003000001_work_program_reimbursement.sql').read_text();migration=(root/'supabase/migrations/20261004000001_work_program_closeout_reconciliation.sql').read_text()
assert base==subprocess.check_output(['git','show','v0.47.0:openplan/supabase/migrations/20261003000001_work_program_reimbursement.sql'],cwd=root,text=True)
tables=['programs','program_work_program_revisions','program_work_program_events','work_program_actual_versions','work_program_actual_allocations','work_program_period_reports','work_program_reimbursement_claims','work_program_reimbursement_sources','work_program_reimbursement_events']
rows=' UNION ALL '.join("SELECT '%s' AS name, count(*) AS rows, md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'')) AS checksum FROM public.%s t"%(t,t) for t in tables)
common='BEGIN;\n'+base+'\nCREATE TEMP TABLE upgrade_ids(id uuid);\n'+fixture+'\nCREATE TEMP TABLE custody_before AS '+rows+';\n'+migration
results=[]
for name,edit,expected in [('baseline','',0),('harmless comment','-- harmless upgrade control',0),('changed saved program',"UPDATE public.programs SET title=title||' mutation' WHERE id IN (SELECT id FROM upgrade_ids);",1)]:
 sql=common+'\n'+edit+'\nCREATE TEMP TABLE custody_after AS '+rows+";\nDO $$ BEGIN IF EXISTS(SELECT * FROM custody_before EXCEPT SELECT * FROM custody_after) OR EXISTS(SELECT * FROM custody_after EXCEPT SELECT * FROM custody_before) THEN RAISE EXCEPTION 'Upgrade changed retained source records'; END IF; IF (SELECT rows FROM custody_before WHERE name='work_program_reimbursement_claims')=0 THEN RAISE EXCEPTION 'Vacuous upgrade seed'; END IF; END $$;\nSELECT jsonb_agg(to_jsonb(c) ORDER BY name) FROM custody_after c; SELECT 'M2D4_UPGRADE_RETAINED'; ROLLBACK;"
 run=subprocess.run(['docker','exec','-i','supabase_db_m11-contract-verification-upgrade','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=sql,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (out/('upgrade-'+name.replace(' ','-')+'.log')).write_text(run.stdout)
 if expected==0: assert run.returncode==0 and 'M2D4_UPGRADE_RETAINED' in run.stdout,run.stdout[-3000:]
 else: assert run.returncode!=0 and 'Upgrade changed retained source records' in run.stdout,run.stdout[-3000:]
 results.append({'name':name,'exitCode':run.returncode,'result':'retained' if run.returncode==0 else 'targeted mutation detected'})
 print(results[-1],flush=True)
(out/'upgrade-results.json').write_text(json.dumps({'container':'supabase_db_m11-contract-verification-upgrade','transaction':'rolled back; original stack retained at 306 migrations','baseline':'v0.47.0 reimbursement schema and populated synthetic source records applied inside transaction','newMigration':'20261004000001_work_program_closeout_reconciliation.sql','migrationSha256':hashlib.sha256(migration.encode()).hexdigest(),'tables':tables,'results':results},indent=2)+'\n')
