from pathlib import Path
import subprocess, json, hashlib, time
root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007/openplan')
out=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority/report-copy-controls')
out.mkdir(exist_ok=True)
page=root/'src/components/reports/land-use-plan-report-page.tsx'
detail=root/'src/components/reports/land-use-plan-report-detail.tsx'
adoption=root/'src/components/reports/land-use-plan-report-adoption.tsx'
paths=[page,detail,adoption]
original={p:p.read_bytes() for p in paths}
public_test='src/test/land-use-plan-report-adoption.test.tsx'
cases=[
 ('omit-saved-heading', adoption, 'Saved adoption decision', '', public_test, 'renders the retained decision'),
 ('omit-legacy-absence', adoption, 'This report did not retain the adoption details.', '', public_test, 'discloses a legacy'),
 ('omit-legacy-boundary', adoption, 'This does not establish whether an agency adopted the plan.', '', public_test, 'discloses a legacy'),
 ('omit-legal-boundary', adoption, 'These details do not establish legal validity.', '', public_test, 'renders the retained decision'),
 ('omit-historical-boundary', adoption, 'Later decisions do not replace it here.', '', public_test, 'renders the retained decision'),
 ('omit-invalid-disclosure', adoption, 'The adoption details could not be verified', 'Details unavailable', public_test, 'withholds changed artifact decision'),
 ('omit-related-kind', detail, 'text(relationship, "relationship_kind")', 'null', public_test, 'renders related plan labels'),
 ('omit-refusal-identity', page, 'The saved report does not match its frozen plan version.', '', 'src/test/land-use-plan-report-custody.test.tsx', 'withholds changed artifact'),
 ('omit-refusal-boundary', page, 'This does not mean the agency withdrew the plan.', '', 'src/test/land-use-plan-report-custody.test.tsx', 'withholds changed artifact'),
 ('regress-copy', adoption, 'Saved adoption decision', 'Recorded adoption decision', 'src/test/planner-copy-says-the-plain-thing.test.ts', 'uses no term from the ledger'),
]
results=[]
def run(name,tests,expected=None):
 with (out/(name+'.log')).open('w') as log:
  r=subprocess.run(['npm','exec','--','vitest','run',*tests,'--maxWorkers=1'],cwd=root,stdout=log,stderr=subprocess.STDOUT)
 text=(out/(name+'.log')).read_text()
 passed=r.returncode==0 if expected is None else r.returncode!=0 and 'FAIL' in text and expected in text and ('AssertionError' in text or 'TestingLibraryElementError' in text or 'Error: expect(element).toHaveAttribute' in text or 'Error: expect(element).toHaveTextContent' in text or 'Error: expect(element).toHaveClass' in text)
 results.append({'name':name,'exitCode':r.returncode,'verified':passed,'expectedFailure':expected})
 (out/'report.json').write_text(json.dumps({'state':'running','cases':results},indent=2))
 if not passed:raise RuntimeError('Control did not satisfy expected result: '+name)
try:
 run('baseline',[public_test,'src/test/land-use-plan-report-custody.test.tsx','src/test/planner-copy-says-the-plain-thing.test.ts'])
 for p in paths:p.write_bytes(original[p]+b'\n// Harmless observation-control comment.\n')
 run('harmless',[public_test,'src/test/land-use-plan-report-custody.test.tsx','src/test/planner-copy-says-the-plain-thing.test.ts'])
 for p in paths:p.write_bytes(original[p])
 for name,p,before,after,test,expected in cases:
  source=original[p].decode();assert source.count(before)==1,(name,source.count(before))
  try:
   p.write_text(source.replace(before,after));run(name,[test],expected)
  finally:p.write_bytes(original[p])
finally:
 for p in paths:p.write_bytes(original[p])
 restored=all(p.read_bytes()==original[p] for p in paths)
 (out/'report.json').write_text(json.dumps({'state':'complete' if len(results)==len(cases)+2 and all(r['verified'] for r in results) and restored else 'incomplete','cases':results,'restored':restored,'sourceHashes':{str(p.relative_to(root)):hashlib.sha256(b).hexdigest() for p,b in original.items()},'blindCategory':'Mounted pages and projected mocks only. Does not prove native authorization, browser download, layout, or practitioner acceptance.'},indent=2)+'\n')
