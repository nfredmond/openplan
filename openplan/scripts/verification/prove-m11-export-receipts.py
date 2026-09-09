"""Failure controls for versioned closeout receipts and continuing obligations.

Synthetic tests do not establish source authenticity, human authority, or visual layout.
"""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[2];results=[]
unit=['src/test/contract-closeout.test.ts','src/test/contract-accounting-handoff.test.ts','src/test/contract-closeout-download.test.ts','src/test/contract-workflow-api.test.ts','src/test/contract-reopened-form.test.tsx']
def run(name,tests,env,reason=None):
 p=subprocess.run(['npm','exec','--','vitest','run',*tests],cwd=root,env=env,capture_output=True,text=True);out=p.stdout+p.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(out)
 assert (p.returncode==0 if reason is None else p.returncode!=0 and reason in out),name+'\n'+out[-4000:]
 results.append({'name':name,'outcome':'survived' if reason is None else 'killed','reason':reason});print(name,results[-1]['outcome'],flush=True)
 (root.parent/'docs/reviews/2026-09-08-m11-delivery/export-receipt-controls.json').write_text(json.dumps(results,indent=2)+'\n')
for name,file,old,new,reason in [
 ('harmless-export-comment','closeout-export.ts','/** Stable financial','/** Retained evidence. Stable financial',None),
 ('omit-received-checksum','closeout-export.ts','invoice.source_receipt?.checksum??"unassessed"','"unassessed"','retains received original checksums'),
 ('rewrite-format-two','closeout-export.ts','pkg.formatVersion>=3','pkg.formatVersion>=2','retains received original checksums'),
 ('lost-obligation-check','closeout.ts','if(!disposition)throw','if(false)throw','requires retained identity'),
 ('unsupported-obligation-satisfaction','closeout.ts','if(disposition.status==="satisfied"','if(false&&disposition.status==="satisfied"','requires retained identity'),
 ('duplicate-obligation-identity','closeout-schema.ts','new Set(items.map(o=>o.id)).size===items.length','items.length>=0','requires retained identity'),
 ('legacy-cash-columns','export.ts','contractMetrics.filter(k=>k!=="payments"&&k!=="credits")','contractMetrics','shows documented cash up front'),
 ('missing-current-cash','export.ts','"gross","payments","credits","refunds","retention","disputed","open","currentlyDue"','"gross","credits","refunds","retention","disputed","open","currentlyDue"','shows documented cash up front'),
 ('missing-retained-byte-count','export.ts','[e.source_receipt.bytes]','[null]','shows documented cash up front'),
 ('split-accounting-record','export.ts','table.name==="Accounting handoff"','table.name==="Never accounting handoff"','keeps one accounting row'),
 ('emit-old-package','calculation.ts','_package:{formatVersion:3,','_package:{formatVersion:2,','computes the retained position'),
]:
 path=root/'src/lib/invoicing/contracts'/file;original=path.read_text();assert old in original,name
 try:path.write_text(original.replace(old,new));run(name,unit,os.environ,reason)
 finally:path.write_text(original)
for name,old,new,reason in [
 ('empty-reopened-form','()=>state.closeout?.versions.filter(v=>v.state==="closed").at(-1)?.content.request.obligations.map(o=>({...o}))??[]','()=>[]','carries open obligations'),
 ('false-reopened-claims','v.state==="closed"?<p>Work acceptance claimed','true?<p>Work acceptance claimed','carries open obligations'),
]:
 path=root/'src/components/invoicing/contracts/settlement-closeout.tsx';original=path.read_text();assert old in original,name
 try:path.write_text(original.replace(old,new));run(name,unit,os.environ,reason)
 finally:path.write_text(original)
path=root/'src/app/api/invoicing/engagements/[engagementId]/management/closeout/route.ts';original=path.read_text()
try:
 path.write_text(original.replace('&&pkg?.formatVersion!==3',''));run('reject-package-three',unit,os.environ,'downloads retained old and new')
finally:path.write_text(original)
sql=(root/'supabase/migrations/20260925000001_contract_export_source_receipts.sql').read_text();sql=sql[:sql.index('CREATE TRIGGER')].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
for name,old,new,reason in [
 ('harmless-receipt-sql','-- New snapshots','-- Retained originals.\n-- New snapshots',None),
 ('omit-receipt-sql',"'checksum',f.checksum","'checksum',NULL",'Original received receipt missing'),
 ('future-receipt-sql',' AND f.created_at<=p_cutoff','', 'Future original receipt crossed cutoff'),
 ('old-report-format-seven',"'schemaVersion',7","'schemaVersion',6",'New snapshot receipt format missing'),
 ('drop-obligation-sql','IF disposition IS NULL THEN','IF false THEN','Prior obligation silently lost'),
 ('satisfy-obligation-sql',"IF disposition->>'status'='satisfied'", "IF false AND disposition->>'status'='satisfied'",'Obligation satisfied without new evidence'),
 ('duplicate-obligation-sql','IF (SELECT count(DISTINCT','IF false AND (SELECT count(DISTINCT','Duplicate obligation identity admitted'),
]:
 assert old in sql,name;scratch=Path('/tmp/openplan-m11-receipt-control.sql');scratch.write_text(sql.replace(old,new));env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_CONTRACT_TEST_SQL':str(scratch)}
 run(name,['src/test/contract-agency-reconciliation-rls.test.ts','src/test/contract-closeout-rls.test.ts','-t','received original receipts|reopened obligation'],env,reason)
