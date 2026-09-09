"""Harmless survivors and behavior failures, confined to this branch and the named synthetic stack."""
from pathlib import Path
import os, subprocess, json, re
root=Path(__file__).resolve().parents[2]
out=Path('/tmp/openplan-m11-workflow-mutations');out.mkdir(exist_ok=True)
results=json.loads((out/"results.json").read_text()) if os.environ.get("M11_PROOF_RESUME") and (out/"results.json").exists() else []
finished={r["name"] for r in results}
def run(name,tests,expected=None,sql=None):
 if name in finished:return
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m11-contract-verification'}
 if sql:
  path=out/(name+'.sql');path.write_text(sql);env['OPENPLAN_CONTRACT_TEST_SQL']=str(path)
 r=subprocess.run(['npm','test','--','--run',*tests],cwd=root,env=env,text=True,capture_output=True)
 log=r.stdout+r.stderr;(out/(name+'.log')).write_text(log)
 if expected is None:assert r.returncode==0,log[-7000:]
 else:assert r.returncode!=0 and expected in log,log[-7000:]
 results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected});(out/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(name,results[-1]['outcome'],flush=True)
def source_controls(path,tests,controls):
 file=root/path;original=file.read_text()
 for name,mutate,expected in controls:
  if name in finished:continue
  changed=mutate(original);assert changed!=original,name
  try:file.write_text(changed);run(name,tests,expected)
  finally:file.write_text(original)
source_controls('src/lib/invoicing/contracts/response.ts',['src/test/contract-responses.test.ts'],[
 ('harmless-response',lambda s:'// Reviewed response proof.\n'+s,None),
 ('ignore-stale-response',lambda s:s.replace('forecast.input_hash!==delivery.inputHash','false'),'expected [Function] to throw'),
 ('ignore-record-content-version',lambda s:s.replace('||record.recordHash!==command.recordHash',''),'expected [Function] to throw'),
 ('promote-scenario-to-staff-review',lambda s:s.replace(' return {request:command,record,inputs:', ' state.delivery!.workUpdates.push(proposed.workUpdates.at(-1)!);\n return {request:command,record,inputs:'),'expected'),
 ('allow-unrelated-work-assumption',lambda s:s.replace('if(!command.schedule.nodes.some','if(false&&!command.schedule.nodes.some'),'expected [Function] to throw')])
source_controls('src/lib/invoicing/contracts/closeout.ts',['src/test/contract-closeout.test.ts'],[
 ('harmless-settlement',lambda s:'// Exact financial evidence.\n'+s,None),
 ('ignore-partial-payment',lambda s:s.replace('if(e.kind==="payment")payments+=amount','if(e.kind==="payment")payments+=BigInt(0)'),'expected'),
 ('retention-reduces-open-debt',lambda s:s.replace('const open=cents(invoice.gross)+adjustments-credits-payments+refunds','const open=cents(invoice.gross)+adjustments-credits-payments+refunds-retention'),'expected'),
 ('refund-reduces-debt',lambda s:s.replace('adjustments-credits-payments+refunds','adjustments-credits-payments-refunds'),'expected'),
 ('duplicate-legacy-payment',lambda s:s.replace('source was linked twice.");continue;','source was linked twice.");'),'expected'),
 ('ignore-unaccepted-delivery',lambda s:s.replace('if(command.workAccepted&&!workAccepted)','if(false)'),'expected [Function] to throw'),
 ('claim-unsettled-finances',lambda s:s.replace('if(command.financialSettled&&!financialSettled)','if(false)'),'expected [Function] to throw'),
 ('erase-valid-underspend',lambda s:s.replace('cents(authorizedCost)-cents(reconciled.total.incurred)','BigInt(0)'),'expected')])
source_controls('src/lib/invoicing/contracts/calculation.ts',['src/test/contract-workflow-api.test.ts'],[
 ('harmless-workflow-api',lambda s:'// Retained financial review.\n'+s,None),
 ('ignore-financial-read-race',lambda s:s.replace('state.closeout.inputHash!==(confirm.data as ContractState).closeout?.inputHash','false'),'expected'),
 ('leak-closeout-rates',lambda s:s.replace('safeState={...state,rates:[],access:[]','safeState={...state,rates:state.rates,access:[]'),'expected'),
 ('allow-excess-retention-release',lambda s:s.replace('if(invoice.warnings.some(w=>w.includes("exceeds")||w.includes("exceed")))','if(false)'),'expected')])
source_controls('src/lib/invoicing/contracts/cash-summary-server.ts',['src/test/contract-cash-position.test.tsx'],[
 ('harmless-register-balance',lambda s:'// Complete invoice reading.\n'+s,None),
 ('truncate-invoice-balance-pages',lambda s:s.replace('if(page.data.length<200)break;','break;'),'expected')])
source_controls('src/components/invoicing/contracts/cash-position.tsx',['src/test/contract-cash-position.test.tsx'],[('harmless-currency-totals',lambda s:'// Exact currency totals.\n'+s,None),('sum-different-currencies',lambda s:s.replace('totals.set(p.currency,total)','totals.set("USD",total)'),'expected')])
source_controls('src/lib/invoicing/contracts/export.ts',['src/test/contract-responses.test.ts'],[
 ('harmless-response-export',lambda s:'// Response review evidence.\n'+s,None),
 ('omit-response-history',lambda s:s.replace('if(state.responses){','if(false&&state.responses){'),'expected')])
def function(filename,name,new_name=None):
 source=(root/'supabase/migrations'/filename).read_text()
 f=re.search(r'CREATE (?:OR REPLACE )?FUNCTION public\.'+name+r'\(.*?\$\$;',source,re.S).group(0)
 f=f.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
 if new_name:f=f.replace('public.'+name+'(','public.'+new_name+'(',1)
 return f
close=function('20260915000001_contract_settlement_closeout.sql','record_contract_command','record_contract_command_closeout')
responses=function('20260914000001_contract_management_responses.sql','record_contract_command','record_contract_command_responses')
tests=['src/test/contract-closeout-rls.test.ts','src/test/contract-responses-rls.test.ts']
run('harmless-workflow-sql',tests,sql=close.replace('BEGIN','BEGIN\n-- harmless control\n',1))
for name,sql,expected in [
 ('allow-staff-financial-event',close.replace("k IN ('settlement','closeout','reopen') AND", "k IN ('closeout','reopen') AND"),'Staff posted financial event'),
 ('allow-unsubmitted-acceptance',close.replace("(v=0 AND p_command->>'state'<>'submitted')","false"),'Unsubmitted deliverable accepted'),
 ('allow-stale-financial-version',close.replace("c->>'invoiceVersion')::timestamptz IS DISTINCT FROM inv.updated_at","c->>'invoiceVersion')::timestamptz IS DISTINCT FROM (c->>'invoiceVersion')::timestamptz"),'Changed invoice accepted'),
 ('allow-duplicate-financial-source',close.replace("s.source_key=c->>'sourceKey' AND s.event_id<>","false AND s.event_id<>"),'Duplicate financial source accepted'),
 ('allow-stale-closeout',close.replace("p_command->>'_inputHash' IS DISTINCT FROM public.contract_closeout_hash(e.id)",'false'),'Stale closeout accepted'),
 ('apply-changed-project-decision',responses.replace("record_json->>'recordHash' IS DISTINCT FROM response.content->'request'->>'recordHash' OR ",''),'Changed project decision applied'),
 ('allow-private-pm-report',function('20260915000002_contract_management_reports.sql','contract_snapshot_can_read').replace("s.audience='management' AND ",''),'PM queued private finance report'),
 ('publish-revoked-pm-export',function('20260915000002_contract_management_reports.sql','finish_work_program_export').replace('NOT public.contract_snapshot_can_read(d.contract_snapshot_id,j.requested_by)','false'),'Revoked PM export published'),
 ('allow-closed-raw-source-change',function('20260915000003_contract_closeout_relationships.sql','guard_closed_contract_source').replace("='closed' THEN", "='impossible' THEN"),'Closed raw financial source changed'),
 ('allow-foreign-closeout-workspace',function('20260915000003_contract_closeout_relationships.sql','guard_contract_delivery_relationship').replace('e.workspace_id IS DISTINCT FROM NEW.workspace_id','false'),'Wrong workspace history accepted'),
]:run(name,tests,expected,sql)
for table in ['contract_management_responses','contract_response_applications','contract_settlement_events','contract_deliverable_events','contract_closeouts']:
 run('disable-rls-'+table,tests,'Outside response evidence leaked' if table.startswith('contract_response') or table=='contract_management_responses' else 'Outside closeout evidence leaked',f'ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY;')
source_controls('supabase/migrations/20260915000001_contract_settlement_closeout.sql',['src/test/a-column-nothing-reads-is-a-question.test.ts','src/test/migrations/inventory.test.ts'],[
 ('harmless-schema-inventory',lambda s:'-- Harmless inventory proof.\n'+s,None),
 ('introduce-unread-column',lambda s:s+'\nALTER TABLE public.contract_closeouts ADD COLUMN unexplained_marker text;\n','contract_closeouts.unexplained_marker')])
source_controls('src/app/(app)/invoicing/_components/reimbursement-lane.tsx',['src/test/invoicing-read-failures.test.tsx'],[
 ('harmless-reimbursement-read-bootstrap',lambda s:'// Existing reimbursement read boundary.\n'+s,None),
 ('conceal-reimbursement-read-failure',lambda s:s.replace('const invoiceRegisterUnavailable = invoiceRegisterPending || invoiceRegisterUnreadable;', 'const invoiceRegisterUnavailable = false;'),'invoicing-read-failures.test.tsx')])
source_controls('src/app/(app)/invoicing/_components/invoicing-cash-strip.tsx',['src/test/one-money-figure-reads-the-same-on-both-screens.test.tsx'],[
 ('harmless-funder-money-bootstrap',lambda s:'// Existing funder amount presentation.\n'+s,None),
 ('change-funder-ledger-cents',lambda s:s.replace('formatCurrency(reimbursementSummary.outstandingNetAmount)', 'formatCurrency(reimbursementSummary.outstandingNetAmount+1)'),'expected')])
source_controls('src/components/invoicing/contracts/cash-position.tsx',['src/test/planner-copy-says-the-plain-thing.test.ts'],[
 ('harmless-copy-ratchet',lambda s:'// Plain financial copy.\n'+s,None),
 ('introduce-machine-copy',lambda s:s.replace('<h2 className="text-sm font-semibold">', '<p>Portfolio posture</p><h2 className="text-sm font-semibold">'),'posture')])
(root.parent/'docs/reviews/2026-09-08-m11-delivery/workflow-controls.json').write_text(json.dumps(results,indent=2)+'\n')
