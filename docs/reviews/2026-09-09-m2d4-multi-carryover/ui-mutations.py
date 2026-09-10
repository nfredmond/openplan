from pathlib import Path
import json,subprocess
root=Path('/home/nathaniel/.local/state/openplan/m2d4-multi-carryover-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-multi-carryover-evidence-2026-09-09')
lib=root/'src/lib/programs/work-program/closeout.ts';ui=root/'src/components/programs/work-program/closeout-panel.tsx';original={p:p.read_text() for p in [lib,ui]}
cases=[('harmless comment',lib,original[lib]+'\n// harmless mutation control\n',True)]
for name,p,old,new in [
 ('legacy command identity',lib,'.max(100).optional()', '.max(100).default([])'),
 ('allocation whole cents',lib,'amount: decimal.nullable() }).strict();','amount: z.string().nullable() }).strict();'),
 ('allocation list maximum',lib,'.max(100).optional()', '.max(1000).optional()'),
 ('legacy mapping reader',lib,'amount }] : [];','amount: null }] : [];'),
 ('new mapping reader',lib,'if (row.allocations !== undefined) return row.allocations;', 'if (row.allocations !== undefined) return [];'),
 ('empty completed reader',lib,': [];', ': [{ successorRevisionId, successorElementId, sourceFundId, successorFundId, amount }];'),
 ('UI mapping identity',ui,'i === allocationIndex ? { ...a, ...change } : a','i === allocationIndex ? a : { ...a, ...change }'),
 ('UI reset dependent fields',ui,'successorRevisionId: successorRevisionId || null, successorElementId: null, successorFundId: null','successorRevisionId: successorRevisionId || null'),
 ('UI remove row',ui,'allocations.filter((_, i) => i !== allocationIndex)','allocations'),
 ('UI source fund reference',ui,'{sourceFund.name} · {sourceFund.vintage}', '{sourceFund.name} · Incorrect vintage'),
 ('UI successor fund reference',ui,'${targetFund.name} · ${targetFund.vintage}', '${targetFund.name} · Incorrect vintage'),
 ('UI amount',ui,'update({ amount: value || null })','update({ amount: "0.00" })'),
]:
 assert old in original[p],name
 cases.append((name,p,original[p].replace(old,new),False))
results=[]
try:
 for i,(name,p,body,survive) in enumerate(cases):
  p.write_text(body)
  try:r=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','src/test/work-program-closeout.test.tsx','-t','multi carryover'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  finally:p.write_text(original[p])
  (out/f'ui-mutation-{i}.log').write_text(r.stdout)
  result={'name':name,'exit':r.returncode,'expected':'survived' if survive else 'detected','matched':(r.returncode==0)==survive};results.append(result);print(json.dumps(result),flush=True);(out/'ui-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
  if not result['matched']:raise SystemExit(1)
finally:
 for p,s in original.items():p.write_text(s)
