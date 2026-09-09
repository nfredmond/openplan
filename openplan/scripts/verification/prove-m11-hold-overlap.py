"""Hold overlap controls. Does not prove source truth or a particular hold allocation."""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[2];results=[]
tests=['src/test/contract-closeout.test.ts','src/test/contract-workflow-api.test.ts','src/test/contract-cash-position.test.tsx']
changes=[
 ('harmless-hold-comment','src/lib/invoicing/contracts/closeout.ts','/** Invoice obligations','/** Documented position. Invoice obligations',None),
 ('invent-hold-overlap','src/lib/invoicing/contracts/closeout.ts','const unresolvedHolds=(state.schemaVersion??0)>=7','const unresolvedHolds=false','retains cash and each hold'),
 ('rewrite-historic-holds','src/lib/invoicing/contracts/closeout.ts','(state.schemaVersion??0)>=7','true','retains cash and each hold'),
 ('reject-unresolved-payment','src/lib/invoicing/contracts/calculation.ts','if(cents(invoice.retention)<BigInt(0)','if(invoice.currentlyDue===null||cents(invoice.retention)<BigInt(0)','records documented payments'),
 ('allow-excess-release','src/lib/invoicing/contracts/calculation.ts','if(cents(invoice.retention)<BigInt(0)||cents(invoice.disputed)<BigInt(0)||cents(invoice.refunds)>cents(invoice.payments))','if(false)','records documented payments'),
 ('unknown-due-as-zero','src/components/invoicing/contracts/cash-position.tsx','if(due===null)total.unassessedDue++;','', 'keeps known balances'),
 ('omit-unassessed-handoff','src/lib/invoicing/contracts/closeout-export.ts','i[metric]??"unassessed"','i[metric]??"0.00"','retains cash and each hold'),
]
for name,file,old,new,reason in changes:
 path=root/file;original=path.read_text();assert old in original,name
 try:
  path.write_text(original.replace(old,new));p=subprocess.run(['npm','exec','--','vitest','run',*tests],cwd=root,env=os.environ,capture_output=True,text=True);out=p.stdout+p.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(out)
  assert (p.returncode==0 if reason is None else p.returncode!=0 and reason in out),name+'\n'+out[-4000:]
  results.append({'name':name,'outcome':'survived' if reason is None else 'killed','reason':reason});print(name,results[-1]['outcome'],flush=True)
 finally:path.write_text(original)
(root.parent/'docs/reviews/2026-09-08-m11-delivery/hold-overlap-controls.json').write_text(json.dumps(results,indent=2)+'\n')
