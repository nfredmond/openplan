"""Reversible source mutations for the reimbursement arithmetic, export, HTTP and test-target boundaries."""
import json
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[2]
cases = [
 ('harmless comment','src/lib/programs/work-program/reimbursement.ts','no billing or payment enters','no payment or billing enters',True,'work-program-reimbursement.test.ts'),
 ('duplicate source','src/lib/programs/work-program/reimbursement.ts','if (seen.has(actual.entry_id))','if (false)',False,'work-program-reimbursement.test.ts'),
 ('reimbursement arithmetic','src/lib/programs/work-program/reimbursement.ts','reimbursement += value','reimbursement += value + BigInt(1)',False,'work-program-reimbursement.test.ts'),
 ('numeric-looking evidence','src/lib/programs/work-program/reporting-export.ts','&& /^(Incurred|Commitments|Billed|Payments|Known hours|Adopted budget|Budget remaining|Remaining estimate|Actual plus remaining|Remaining hours|Remaining cost|Amount|Hours|Source cost|Eligible cost)$/.test(String(table.rows[0][column]))','&& column > 0',False,'work-program-reimbursement.test.ts'),
 ('agent refusal','src/app/api/programs/[programId]/work-program/reimbursement/route.ts','readAssistantExecutionSource(request) !== "manual"','false',False,'work-program-reimbursement-route.test.ts'),
 ('correction projection','src/app/api/programs/[programId]/work-program/reimbursement/route.ts','id, version, state, draft, current_report_id','id, version, state, draft',False,'work-program-reimbursement-route.test.ts'),
 ('disposable database guard','src/test/helpers/contract-verification-stack.ts','!named.includes(container)','!named.includes(container) && container !== "supabase_db_demo"',False,'contract-practice-rpc-rls.test.ts'),
]
results=[]
for label,file,before,after,survive,test in cases:
 p=root/file; original=p.read_text()
 if original.count(before)!=1: raise RuntimeError('Ambiguous mutation anchor '+label)
 try:
  p.write_text(original.replace(before,after,1))
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/'+test],cwd=root,capture_output=True,text=True)
  valid=run.returncode==0 if survive else run.returncode!=0 and ('AssertionError' in run.stdout+run.stderr)
  if not valid:
   Path('/tmp/m2d3-ts-control-failure.log').write_text(run.stdout+run.stderr)
   raise RuntimeError('Unexpected mutation outcome '+label)
  results.append({'case':label,'expected':'survived' if survive else 'assertion failed','exit':run.returncode,'reasonObserved':valid})
  print(label+': expected result',flush=True)
 finally: p.write_text(original)
(root.parent/'docs/reviews/2026-09-09-m2d3-reimbursement/typescript-controls.json').write_text(json.dumps(results,indent=2)+'\n')
