import pathlib,subprocess,json,hashlib
root=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007')
p=root/'openplan/supabase/migrations/20261016000002_land_use_plan_context.sql';original=p.read_text();out=pathlib.Path('/tmp/openplan-plan-context-migration-controls-v2');out.mkdir(exist_ok=False)
probe="""
DO $test$
DECLARE p uuid := gen_random_uuid(); ctx jsonb := '{"schemaVersion":1,"place":{},"assessment":{"authorities":[{"label":"SYNTHETIC"}]},"savedBy":"3d24e1c0-71cb-4ca6-8c7b-ce2d5d2e7705","savedAt":"2026-10-07T10:00:00Z"}'; actual text;
BEGIN
 INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label,created_by)
 VALUES(p,'6674ea52-e439-4e82-9c4e-15b11cdf9ca7','SYNTHETIC rollback-only schema control','local-unconfigured','community','SYNTHETIC','SYNTHETIC','3d24e1c0-71cb-4ca6-8c7b-ce2d5d2e7705');
 IF EXISTS(SELECT 1 FROM public.land_use_plans WHERE id=p AND (plan_context IS NOT NULL OR plan_context_hash IS NOT NULL)) THEN RAISE EXCEPTION 'Legacy absence was changed'; END IF;
 UPDATE public.land_use_plans SET plan_context=ctx WHERE id=p;
 SELECT plan_context_hash INTO actual FROM public.land_use_plans WHERE id=p;
 IF actual IS DISTINCT FROM encode(extensions.digest(ctx::text,'sha256'),'hex') THEN RAISE EXCEPTION 'Context hash does not cover retained JSON'; END IF;
 BEGIN
  UPDATE public.land_use_plans SET plan_context=ctx - 'place' WHERE id=p;
  RAISE EXCEPTION 'Missing context fields were accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  UPDATE public.land_use_plans SET plan_context=jsonb_set(ctx,'{assessment,authorities}','[]') WHERE id=p;
  RAISE EXCEPTION 'Empty authorities were accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $test$;
ROLLBACK;
"""
rows=[]
cases=[('baseline',original,True,''),('harmless',original+'\n-- Harmless verification comment.\n',True,''),('nullable-check',original.replace(') IS TRUE',')'),False,'Missing context fields were accepted'),('constant-hash',original.replace("encode(extensions.digest(plan_context::text, 'sha256'), 'hex')","repeat('0',64)"),False,'Context hash does not cover retained JSON')]
for name,sql,passing,marker in cases:
 result=subprocess.run(['docker','exec','-i','supabase_db_openplan-restore-target-2026091050','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input='BEGIN;\n'+sql+'\n'+probe,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (out/(name+'.log')).write_text(result.stdout)
 matched=(result.returncode==0) if passing else (result.returncode!=0 and marker in result.stdout)
 rows.append({'case':name,'exitCode':result.returncode,'expected':'pass' if passing else 'targeted failure','matched':matched})
 if not matched:raise RuntimeError('Unexpected outcome '+name)
remaining=subprocess.check_output(['docker','exec','supabase_db_openplan-restore-target-2026091050','psql','-U','postgres','-d','postgres','-Atc',"select count(*) from information_schema.columns where table_schema='public' and table_name='land_use_plans' and column_name='plan_context';"],text=True).strip()
assert remaining=='0'
report={'results':rows,'allTransactionsRolledBack':True,'persistentSchemaChanged':False,'sourceUnchanged':p.read_text()==original,'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'boundary':'Real PostgreSQL DDL, nullable CHECK and generated hash. Not RLS, attribution, concurrent update, route or workflow acceptance.'}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
