"""Mutation controls only in the explicitly named disposable M11 stack and this checkout."""
from pathlib import Path
import os,subprocess,json,re
root=Path(__file__).resolve().parents[2]
out=Path('/tmp/openplan-m11-delivery-mutations');out.mkdir(exist_ok=True)
results=[]
def run(name,command,expected,extra=None):
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m11-contract-verification',**(extra or {})}
 r=subprocess.run(command,cwd=root,env=env,text=True,capture_output=True);log=r.stdout+r.stderr;(out/(name+'.log')).write_text(log)
 if expected is None:assert r.returncode==0,log[-7000:]
 else:assert r.returncode!=0 and expected in log,log[-7000:]
 results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected});(out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
source=root/'src/lib/invoicing/contracts/delivery.ts';original=source.read_text()
controls=[('harmless-calculation',lambda s:'// Deterministic calendar calculation.\n'+s,None),
 ('ignore-unavailable-date',lambda s:s.replace('return exception?exception.working:', 'return false?exception!.working:'),'expected'),
 ('drop-leap-day',lambda s:s.replace('days*DAY','(value===\"2028-02-28\"?2:days)*DAY'),'expected'),
 ('allow-dependency-cycle',lambda s:s.replace('if(visiting.has(id))throw new Error("Finish-to-start dependencies form a cycle.");','if(visiting.has(id))return;'),'expected [Function] to throw'),
 ('missing-review-is-zero',lambda s:s.replace('if(node.durationDays===null||!node.reviewEvidence)', 'if(!node.reviewEvidence)').replace('let remaining=node.durationDays;','let remaining=node.durationDays??0;'),'expected'),
 ('ignore-reviewer-availability',lambda s:s.replace('node.reviewStatus!=="available"','false'),'expected'),
 ('ignore-capacity-overload',lambda s:s.replace('if(reserved>cap)','if(false)'),'expected'),
 ('accept-unreviewed-work',lambda s:s.replace('update.state!=="accepted"','false'),'expected'),
 ('ignore-overdue-update',lambda s:s.replace('update.content.asOf<schedule!.updateDueOn','false'),'expected'),
 ('ignore-blocked-work',lambda s:s.replace('update.content.status==="blocked"','false'),'expected'),
 ('ignore-departed-staff',lambda s:s.replace('if(!staff?.active)','if(false)'),'expected'),
 ('claim-incomplete-costs',lambda s:s.replace('sourceCovered&&remainingCost!==null','remainingCost!==null'),'expected'),
 ('bill-fixed-fee-as-effort',lambda s:s.replace('schedule.billingTreatment==="time_materials"','true'),'expected'),
 ('hide-cost-warning',lambda s:s.replace('cents(actualPlusRemaining)>cents(baseline.content.cost)','false'),'expected'),
 ('hide-fee-warning',lambda s:s.replace('cents(reconciliation.grossBilled)+knownBilling>cents(baseline.content.fee)','false'),'expected'),
 ('hide-date-warning',lambda s:s.replace('result.finish>result.currentApprovedFinish','false'),'expected')]
for name,mutate,expected in controls:
 try:source.write_text(mutate(original));run(name,['npm','test','--','--run','src/test/contract-delivery.test.ts'],expected)
 finally:source.write_text(original)
sql=(root/'supabase/migrations/20260913000001_contract_delivery.sql').read_text();start=sql.index('CREATE FUNCTION public.record_contract_command(');end=sql.index('END $$;',start)+len('END $$;');function=sql[start:end].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
sql_controls=[('harmless-delivery-sql',function.replace('BEGIN','BEGIN\n-- harmless proof\n',1),None),
 ('staff-self-review',function.replace("OR (actor_role='member' AND k<>'work_update')",''),'Staff approved their update'),
 ('stale-reviewed-update',function.replace("old.state<>'submitted' OR old.version IS DISTINCT FROM v OR v IS DISTINCT FROM (p_command->>'expectedVersion')::integer","false"),'Stale work review accepted'),
 ('stale-forecast-input',function.replace("p_command->>'_inputHash' IS DISTINCT FROM public.contract_delivery_hash(e.workspace_id)",'false'),'Concurrent forecast changes accepted'),
 ('stale-capacity',function.replace("IF v IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Shared staff availability changed'", "IF false THEN RAISE EXCEPTION 'Shared staff availability changed'"),'Stale capacity accepted')]
for name,mutation,expected in sql_controls:
 path=out/(name+'.sql');path.write_text(mutation);run(name,['npm','test','--','--run','src/test/contract-delivery-rls.test.ts'],expected,{'OPENPLAN_CONTRACT_TEST_SQL':str(path)})

server=root/'src/lib/invoicing/contracts/server.ts';original_server=server.read_text()
for name,mutation,expected in [
 ('harmless-api',lambda s:'// Server-authoritative forecast inputs.\n'+s,None),
 ('ignore-read-race',lambda s:s.replace('||state.delivery.inputHash!==after.data.inputHash',''),'expected'),
 ('leak-forecast-rates',lambda s:s.replace('rates:[],snapshots:[]','rates:state.rates,snapshots:[]'),'expected'),
 ('allow-agent-write',lambda s:s.replace('readAssistantExecutionSource(request) !== "manual"','false'),'expected'),
 ('discard-forged-fields',lambda s:s.replace('contractCommandSchema.safeParse(input)','contractCommandSchema.safeParse(JSON.parse(JSON.stringify(input),(key,value)=>key==="_result"?undefined:value))'),'expected')]:
 try:server.write_text(mutation(original_server));run(name,['npm','test','--','--run','src/test/contract-delivery-api.test.ts'],expected)
 finally:server.write_text(original_server)
for name,mutation in [
 ('physical-time-staleness',re.search(r'CREATE FUNCTION public.contract_delivery_hash\(.*?\$\$;',sql,re.S).group(0).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace(" UNION ALL SELECT 'time:'||to_jsonb(t)::text FROM public.invoicing_time_entries t WHERE t.workspace_id=p_workspace_id",''))]:
 path=out/(name+'.sql');path.write_text(mutation);run(name,['npm','test','--','--run','src/test/contract-delivery-rls.test.ts'],'Unreconciled physical time did not stale forecast',{'OPENPLAN_CONTRACT_TEST_SQL':str(path)})
for table in ['contract_schedules','contract_capacity_versions','contract_work_updates','contract_forecasts']:
 name='disable-rls-'+table;path=out/(name+'.sql');path.write_text(f'ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY;');run(name,['npm','test','--','--run','src/test/contract-delivery-rls.test.ts'],'Outside delivery stream leaked' if table!='contract_forecasts' else 'Outsider saw forecast',{'OPENPLAN_CONTRACT_TEST_SQL':str(path)})
export=root/'src/lib/invoicing/contracts/export.ts';original_export=export.read_text()
for name,mutation,expected in [('harmless-forecast-export',lambda s:'// Retained reviewed inputs.\n'+s,None),('drop-forecast-evidence',lambda s:s.replace('if(state.schemaVersion===3&&state.delivery)','if(false&&state.delivery)'),'expected')]:
 try:export.write_text(mutation(original_export));run(name,['npm','test','--','--run','src/test/contract-delivery.test.ts'],expected)
 finally:export.write_text(original_export)
(root.parent/'docs/reviews/2026-09-08-m11-delivery/delivery-controls.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
