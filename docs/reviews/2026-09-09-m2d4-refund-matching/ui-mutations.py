from pathlib import Path
import subprocess,json
root=Path('/home/nathaniel/.local/state/openplan/m2d4-refund-matching-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-refund-matching-evidence-2026-09-09')
lib=root/'src/lib/programs/work-program/closeout.ts';ui=root/'src/components/programs/work-program/closeout-panel.tsx'
original={p:p.read_text() for p in [lib,ui]}
cases=[('harmless comment',lib,original[lib]+'\n// Harmless verification comment\n',True)]
for name,p,old,new in [
 ('unknown refund',lib,'row.refundDue === null || !row.evidence.trim()','false'),
 ('refund evidence',lib,'|| !row.evidence.trim()',''),
 ('refund subtraction',lib,'cents(row.refundDue) -','cents(row.refundDue) +'),
 ('legacy payload identity',lib,'.max(300).optional()','.max(300).default([])'),
 ('refund amount validation',lib,'refundPayments: z.array(z.object({ actualVersionId: id, amount: decimal }','refundPayments: z.array(z.object({ actualVersionId: id, amount: z.string() }'),
 ('UI refund identity',ui,'i === paymentIndex ? { ...r, actualVersionId } : r','i === paymentIndex ? { ...r, actualVersionId: "" } : r'),
 ('UI refund amount',ui,'i === paymentIndex ? { ...r, amount } : r','i === paymentIndex ? { ...r, amount: "0.00" } : r'),
 ('UI remove refund',ui,'(row.refundPayments ?? []).filter((_, i) => i !== paymentIndex)','row.refundPayments ?? []'),
 ('UI payment reference',ui,'data.source.actuals.find(a => a.id === payment.actualVersionId)?.detail.sourceReference','"Synthetic incorrect reference"'),
 ('UI refund currency',ui,'a.currency === data.source.report.snapshot.baseline.content_json.currency','true'),
]:
 assert old in original[p],name
 cases.append((name,p,original[p].replace(old,new),False))
results=[]
try:
 for index,(name,p,body,survive) in enumerate(cases):
  p.write_text(body)
  try:r=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','src/test/work-program-closeout.test.tsx','-t','refund matching'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  finally:p.write_text(original[p])
  (out/f'ui-mutation-{index}.log').write_text(r.stdout)
  result={'name':name,'exit':r.returncode,'expected':'survived' if survive else 'detected','matched':(r.returncode==0)==survive};results.append(result);print(json.dumps(result),flush=True)
  (out/'ui-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
  if not result['matched']:raise SystemExit(1)
finally:
 for p,s in original.items():p.write_text(s)
