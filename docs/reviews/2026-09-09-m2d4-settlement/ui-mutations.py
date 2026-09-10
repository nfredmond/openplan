import json,subprocess
from pathlib import Path
root=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-evidence-2026-09-09')
lib=root/'src/lib/programs/work-program/closeout.ts';ui=root/'src/components/programs/work-program/closeout-panel.tsx';route=root/'src/app/api/programs/[programId]/work-program/closeout/route.ts'
probes=[('harmless comment',lib,'Start unknown;','Keep unknown;',True),('unknown refund becomes zero',lib,'refundDue: null','refundDue: "0.00"',False),('unknown work becomes completed',lib,'disposition: "unassessed"','disposition: "completed"',False),('missing reconciliation evidence treated as cash',lib,'!request || !row?.evidence.trim()','!request || !row',False),('add receipts instead of subtract',lib,'cents(request) - row.receipts','cents(request) + row.receipts',False),('refund allows fractional cents',lib,'refundDue: decimal.nullable()','refundDue: z.string().nullable()',False),('approval accepts empty note',lib,'note: evidence.min(1)','note: evidence',False),('pending commands not locked',ui,'|| !!pending','|| false',False),('uncertain request lost on reload',ui,'localStorage.setItem(recoveryKey, JSON.stringify(command));','',False),('retry changes identity',ui,'send(pending)','send({ ...pending, requestId: crypto.randomUUID() })',False),('unsaved approval allowed',ui,'|| dirty','',False),('private history retained on failed read',ui,'setData(null);','',False),('HTTP role check removed',route,'if (!["owner", "admin"].includes(membership.data.role))','if (false)',False),('HTTP agent refusal removed',route,'if (readAssistantExecutionSource(request) !== "manual")','if (false)',False),('HTTP private caching removed',route,'"private, no-store"','"public"',False),('HTTP scope projection omitted',route,'.select("role")','.select("id")',False),('HTTP actor replaced',route,'p_actor_id: access.user!.id','p_actor_id: access.programId',False)]
probes.append(('payment currency selector',ui,' && a.currency === data.source.report.snapshot.baseline.content_json.currency','',False))
probes.append(('successful reload clears old failure',ui,'setBusy(true); setMessage(""); void load(reportId)','setBusy(true); void load(reportId)',False))
results=[]
for i,(name,path,old,new,control) in enumerate(probes):
 original=path.read_text();assert old in original,name
 try:
  path.write_text(original.replace(old,new))
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/work-program-closeout.test.tsx','src/test/work-program-closeout-route.test.ts'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  (out/f'ui-mutation-{i}.log').write_text(run.stdout)
 finally:path.write_text(original)
 result={'name':name,'expected':'survived' if control else 'killed','result':'survived' if run.returncode==0 else 'killed','log':f'ui-mutation-{i}.log','exitCode':run.returncode};results.append(result);print(name,result['result'],flush=True)
 (out/'ui-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
assert all(r['expected']==r['result'] for r in results)
