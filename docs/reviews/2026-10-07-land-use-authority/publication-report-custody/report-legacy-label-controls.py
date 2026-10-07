from pathlib import Path
import subprocess, json, hashlib, time

root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007/openplan')
out=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority/report-legacy-label-controls')
out.mkdir(exist_ok=True)
index=root/'src/app/(app)/land-use-plans/page.tsx'
review=root/'src/app/(published)/review/land-use-plans/[shareToken]/page.tsx'
adopted=root/'src/app/(published)/published-plans/[planId]/page.tsx'
helper=root/'src/components/land-use-plans/land-use-plan-public-context.tsx'
retained=root/'src/components/land-use-plans/land-use-plan-retained-context.tsx'
paths=[index,review,adopted,helper,retained]
original={p:p.read_bytes() for p in paths}
index_test='src/test/land-use-plan-first-run-jurisdiction.test.tsx'
public_test='src/test/land-use-plan-content-workbench.test.tsx'
cases=[('legacy-heading',retained,'value.status === "legacy" ? "Context not retained with this version" : "Context retained with this version"','"Context retained with this version"',public_test,'separates legacy reviewed identity')]

results=[]
def run(name,tests,expected=None):
 with (out/(name+'.log')).open('w') as log:
  r=subprocess.run(['npm','exec','--','vitest','run',*tests,'--maxWorkers=1'],cwd=root,stdout=log,stderr=subprocess.STDOUT)
 text=(out/(name+'.log')).read_text()
 passed=r.returncode==0 if expected is None else r.returncode!=0 and 'FAIL' in text and expected in text and ('AssertionError' in text or 'TestingLibraryElementError' in text or 'Error: expect(element).toHaveAttribute' in text or 'Error: expect(element).toHaveTextContent' in text)
 results.append({'name':name,'exitCode':r.returncode,'verified':passed,'expectedFailure':expected})
 (out/'report.json').write_text(json.dumps({'state':'running','cases':results},indent=2))
 if not passed:raise RuntimeError('Control did not satisfy expected result: '+name)
try:
 run('baseline',[public_test])
 for p in paths:p.write_bytes(original[p]+b'\n// Harmless observation-control comment.\n')
 run('harmless',[public_test])
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
