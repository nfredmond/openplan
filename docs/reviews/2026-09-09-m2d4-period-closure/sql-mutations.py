from pathlib import Path
import os,subprocess,json,re
root=Path('/home/nathaniel/.local/state/openplan/m2d4-period-closure-2026-09-09/openplan')
out=Path('/home/nathaniel/.local/state/openplan/m2d4-period-closure-evidence-2026-09-09')
sql=(root/'supabase/migrations/20261005000001_work_program_period_closure.sql').read_text()
functions='\n'.join(re.findall(r'CREATE (?:OR REPLACE )?FUNCTION.*?END \$\$;',sql,re.S)).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
cases=[('harmless comment',functions+'\n-- Harmless verification comment',True)]
for name,table in [('actual','work_program_actual_versions'),('time','invoicing_time_entries'),('spend','project_spend_entries'),('reporting','work_program_reporting_periods'),('report','work_program_period_reports'),('claim','work_program_reimbursement_claims'),('reconciliation','work_program_closeout_records'),('authority','program_work_program_events')]:
 cases.append((name+' trigger disabled',f'ALTER TABLE public.{table} DISABLE TRIGGER closed_period_{name};',False))
for name,old,new in [
 ('missing closure authority',"coalesce(length(trim(p_command->>'note')),0)=0",'false'),
 ('closure role',"IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Period closure", "IF false THEN RAISE EXCEPTION 'Period closure"),
 ('changed retry',"cached.actor_id<>p_actor_id OR cached.command<>p_command",'false'),
 ('closure sequence',"(p_command->>'expectedClosureVersion')::integer IS DISTINCT FROM v",'false'),
 ('source hash',"OR reconciliation.source_hash IS DISTINCT FROM data->>'sourceHash' OR data->>'sourceHash' IS DISTINCT FROM p_command->>'sourceHash'",''),
 ('fresh approval after reopening',"OR (prior.kind='reopen_period' AND reconciliation.version<=(SELECT version FROM public.work_program_closeout_records WHERE id=prior.reconciliation_id))",''),
 ('issued report',"IF period.state<>'issued' OR EXISTS", "IF false AND EXISTS"),
 ('adoption authority',"IF NOT EXISTS(SELECT 1 FROM public.program_work_program_events e WHERE e.revision_id=(report.snapshot->'baseline'->>'id')::uuid", "IF false AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events e WHERE e.revision_id=(report.snapshot->'baseline'->>'id')::uuid"),
 ('moved actual',"OR EXISTS(SELECT 1 FROM public.work_program_actual_versions a WHERE a.entry_id=entry AND a.entry_date BETWEEN closure.starts_on AND closure.ends_on)",''),
 ('opening range',"(row_data->>'kind'='opening' AND (row_data->'detail'->>'openingStart')::date<=closure.ends_on AND (row_data->'detail'->>'openingEnd')::date>=closure.starts_on)",'false'),
 ('closed hash',"encode(extensions.digest(content::text,'sha256'),'hex'),p_actor_id)","repeat('0',64),p_actor_id)"),
 ('next period blocked',"IF previous.state='approved' AND NOT (kind='save'", "IF previous.state='approved' AND NOT (false AND kind='save'"),
]:
 assert old in functions,name
 cases.append((name,functions.replace(old,new,1),False))
cases += [('member read leaked', 'ALTER POLICY period_closure_private_read ON public.work_program_period_closures USING(true);',False),('immutable history disabled','ALTER TABLE public.work_program_period_closures DISABLE TRIGGER immutable_work_program_period_closure;',False),('authenticated execution granted','GRANT EXECUTE ON FUNCTION public.work_program_period_closure_command(uuid,uuid,jsonb) TO authenticated;',False),('service direct write granted','GRANT INSERT ON public.work_program_period_closures TO service_role;',False)]
results=[]
for index,(name,body,survive) in enumerate(cases):
 path=out/'current-mutation.sql';path.write_text(body)
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m2d4-period-closure-verification','M2D4_SQL_REPLACEMENT':str(path)}
 r=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','src/test/work-program-closeout-rls.test.ts','-t','period closure'],cwd=root,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (out/f'sql-mutation-{index}.log').write_text(r.stdout)
 result={'name':name,'exit':r.returncode,'expected':'survived' if survive else 'detected','matched':(r.returncode==0)==survive}
 results.append(result);(out/'sql-mutations.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True)
 if not result['matched']:raise SystemExit(1)
