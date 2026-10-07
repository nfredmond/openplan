from pathlib import Path
import subprocess, json, hashlib, time
root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007/openplan')
out=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority/report-map-absence-controls')
out.mkdir(exist_ok=True)
route=root/'src/app/api/reports/[reportId]/land-use-map/[designationId]/route.ts'
snapshot=root/'src/lib/land-use-plans/report-snapshot.ts'
reader=root/'src/lib/land-use-plans/public-map.ts'
detail=root/'src/components/reports/land-use-plan-report-detail.tsx'
mapview=root/'src/components/land-use-plans/public-designation-map.tsx'
adoption=root/'src/components/reports/land-use-plan-report-adoption.tsx'
paths=[route,snapshot,reader,detail,mapview,adoption]
original={p:p.read_bytes() for p in paths}
public_test='src/test/land-use-plan-report-map.test.tsx'
custody_test='src/test/land-use-plan-report-custody.test.tsx'
adoption_test='src/test/land-use-plan-report-adoption.test.tsx'
recovery_test='src/test/land-use-designation-map-recovery.test.tsx'
cases=[
 ('missing-evidence-as-not-found',reader,'if (!versionId || !expectedFeatureHash) return { ok: false as const, reason: "incomplete" as const };','if (!versionId || !expectedFeatureHash) return { ok: false as const, reason: "not_found" as const };',public_test,'refuses a designation missing'),
 ('unknown-designation-as-unavailable',reader,'if (!designation) return { ok: false as const, reason: "not_found" as const };','if (!designation) return { ok: false as const, reason: "incomplete" as const };',public_test,'refuses a designation not retained'),
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
 run('baseline',[public_test,custody_test,adoption_test,recovery_test])
 for p in paths:p.write_bytes(original[p]+b'\n// Harmless observation-control comment.\n')
 run('harmless',[public_test,custody_test,adoption_test,recovery_test])
 for p in paths:p.write_bytes(original[p])
 for name,p,before,after,test,expected in cases:
  source=original[p].decode();assert source.count(before)>=1,(name,source.count(before))
  try:
   p.write_text(source.replace(before,after));run(name,[test],expected)
  finally:p.write_bytes(original[p])
finally:
 for p in paths:p.write_bytes(original[p])
 restored=all(p.read_bytes()==original[p] for p in paths)
 (out/'report.json').write_text(json.dumps({'state':'complete' if len(results)==len(cases)+2 and all(r['verified'] for r in results) and restored else 'incomplete','cases':results,'restored':restored,'sourceHashes':{str(p.relative_to(root)):hashlib.sha256(b).hexdigest() for p,b in original.items()},'blindCategory':'Mounted pages and projected mocks only. Does not prove native authorization, browser download, layout, or practitioner acceptance.'},indent=2)+'\n')
