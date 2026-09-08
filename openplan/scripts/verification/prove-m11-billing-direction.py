"""Failure controls for agency billing perspective and versioned accounting attribution."""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[2]
results=[]
unit=['src/test/contract-billing-direction.test.ts','src/test/contract-accounting-handoff.test.ts','src/test/contract-billing-direction-form.test.tsx','src/test/contract-closeout-download.test.ts','src/test/contract-workflow-api.test.ts']
def run(name,tests,env,expected=None):
 result=subprocess.run(['npm','test','--','--run',*tests],cwd=root,env=env,capture_output=True,text=True)
 output=result.stdout+result.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(output)
 assert (result.returncode==0 if expected is None else result.returncode!=0 and expected in output),name+'\n'+output[-5000:]
 results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected})
 print(name,results[-1]['outcome'],flush=True)
 (root.parent/'docs/reviews/2026-09-08-m11-delivery/billing-direction-controls.json').write_text(json.dumps(results,indent=2)+'\n')
changes=[
 ('harmless-billing-comment','src/lib/invoicing/contracts/reconciliation.ts',' // Missing direction',' // Retained compatibility.\n // Missing direction',None),
 ('ignore-purchaser-direction','src/lib/invoicing/contracts/reconciliation.ts','baseline?.content.billingDirection ?? "outgoing"','"outgoing"','draws agency fee'),
 ('sum-historical-received','src/lib/invoicing/contracts/reconciliation.ts','[...latestReceived.values()].filter','(state.receivedInvoices ?? []).filter','draws agency fee'),
 ('treat-pending-as-approved','src/lib/invoicing/contracts/reconciliation.ts',' || pendingReceived ||',' ||','does not infer zero'),
 ('skip-received-currency','src/lib/invoicing/contracts/reconciliation.ts','received.some(i => i.content.currency !== baseline?.content.currency)','false','does not infer zero'),
 ('rewrite-old-report-direction','src/lib/invoicing/contracts/reconciliation.ts','(state.schemaVersion ?? 0) >= 6','true','preserves issued format 5'),
 ('omit-handoff-source-version','src/lib/invoicing/contracts/closeout-export.ts','match.versionId,invoice.content.fileId','"",invoice.content.fileId','retains received line basis'),
 ('omit-handoff-review-history','src/lib/invoicing/contracts/closeout-export.ts','state.accountingReviews??[]','[]','retains original accounting identity'),
 ('omit-handoff-line-basis','src/lib/invoicing/contracts/closeout-export.ts','${line.description}; ${line.basis}','${line.description}','retains received line basis'),
 ('rewrite-old-handoff','src/lib/invoicing/contracts/closeout-export.ts','if(pkg.formatVersion===2)','if(true)','leaves format 1 columns'),
 ('omit-purchaser-cash','src/components/invoicing/contracts/contract-management.tsx','invoices=settlementPosition(state)','invoices=settlementPosition(state).filter(i=>i.direction==="outgoing")','shows supplier cash totals'),
 ('sum-both-cash-directions','src/components/invoicing/contracts/contract-management.tsx','invoices.filter(i=>i.direction===position?.billingDirection)','invoices','shows supplier cash totals'),
 ('pending-cash-as-zero','src/components/invoicing/contracts/contract-management.tsx','=>position?.pendingReceived||','=>','shows supplier cash totals'),
 ('internal-billing-forecast','src/lib/invoicing/contracts/delivery.ts','&&(!baseline.content.billingDirection||["outgoing","received"].includes(baseline.content.billingDirection))','','separates outgoing, internal'),
 ('emit-old-closeout-package','src/lib/invoicing/contracts/calculation.ts','_package:{formatVersion:2,','_package:{formatVersion:1,','computes the retained position'),
 ('reject-new-closeout-download','src/app/api/invoicing/engagements/[engagementId]/management/closeout/route.ts','if(pkg?.formatVersion!==1&&pkg?.formatVersion!==2)','if(pkg?.formatVersion!==1)','downloads retained old and new'),
 ('unscoped-closeout-download','src/app/api/invoicing/engagements/[engagementId]/management/closeout/route.ts','.eq("engagement_id",engagementId)','','downloads retained old and new'),
 ('omit-form-perspective','src/components/invoicing/contracts/baseline-form.tsx','set("billingDirection",e.target.value as ContractBaseline["billingDirection"])','void e.target.value','retains the selected purchaser'),
]
for name,file,old,new,expected in changes:
 path=root/file;original=path.read_text();assert old in original,name
 try:
  path.write_text(original.replace(old,new));run(name,unit,os.environ,expected)
 finally:path.write_text(original)
sql=(root/'supabase/migrations/20260922000001_contract_billing_direction.sql').read_text().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
sql=sql[:sql.index('CREATE TRIGGER')]+sql[sql.index('CREATE OR REPLACE FUNCTION public.read_contract_management('):]
hash_sql=(root/'supabase/migrations/20260923000001_contract_forecast_billing_custody.sql').read_text()
for name,changed,expected in [
 ('harmless-direction-sql',sql+'\n-- Exact approval retains this field.\n',None),
 ('admit-unknown-direction',sql.replace("IF NEW.content ? 'billingDirection' AND",'IF false AND'),'Invalid perspective accepted'),
 ('admit-undocumented-direction',sql.replace("IF NEW.content->>'billingDirection' IN",'IF false AND NEW.content->>\'billingDirection\' IN'),'Undocumented perspective accepted'),
 ('old-snapshot-format',sql.replace("'schemaVersion',6","'schemaVersion',5"),'Approved perspective or report format lost'),
 ('omit-received-forecast-custody',hash_sql.replace(" UNION ALL SELECT 'received:'||id FROM public.contract_received_invoices WHERE workspace_id=p_workspace_id\n",''),'Received invoice did not stale forecast')]:
 path=Path('/tmp/openplan-m11-direction-control.sql');path.write_text(changed)
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m11-contract-verification','OPENPLAN_CONTRACT_TEST_SQL':str(path)}
 run(name,['src/test/contract-billing-direction-rls.test.ts'],env,expected)
