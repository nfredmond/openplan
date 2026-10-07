from pathlib import Path
import subprocess,json,hashlib
root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007/openplan')
base=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority')
out=base/'report-export-signal-controls';out.mkdir(exist_ok=True)
route=root/'src/app/api/reports/[reportId]/provenance/route.ts'
adoption=root/'src/lib/land-use-plans/report-adoption.ts'
component=root/'src/components/reports/land-use-plan-report-adoption.tsx'
paths=[route,adoption,component];original={p:p.read_bytes() for p in paths}
route_test='src/test/land-use-report-provenance-route.test.ts'
adoption_test='src/test/land-use-plan-report-adoption.test.tsx'
cases=[]
def add(name,p,before,after,expected,test=route_test):cases.append((name,p,before,after,test,expected))
add('ignore-plan-link',route,'report.land_use_plan_id || ','','withholds adoption download with plan link alone')
add('ignore-plan-type',route,'report.report_type === "land_use_plan_packet"','false','withholds adoption download with plan type alone')
add('ignore-implementation-type',route,'|| report.report_type === "land_use_plan_implementation_report"','|| false','withholds adoption download with implementation type alone')

results=[]
def run(name,expected=None,test=None):
 tests=[test] if test else [route_test,adoption_test]
 cmd=['npm','exec','--','vitest','run',*tests,'--maxWorkers=1']
 if expected:cmd+=['-t',expected]
 with (out/(name+'.log')).open('w') as f:r=subprocess.run(cmd,cwd=root,stdout=f,stderr=subprocess.STDOUT)
 text=(out/(name+'.log')).read_text()
 ok=r.returncode==0 if expected is None else r.returncode!=0 and 'FAIL' in text and expected in text and any(s in text for s in ['AssertionError','TestingLibraryElementError','Error: expect(element)'])
 results.append({'name':name,'exitCode':r.returncode,'verified':ok,'expectedFailure':expected})
 (out/'report.json').write_text(json.dumps({'state':'running','cases':results},indent=2))
 print(name,ok,flush=True)
 if not ok:raise RuntimeError(name)
try:
 run('baseline')
 route.write_bytes(original[route]+b'\n// Harmless control comment.\n');run('harmless');route.write_bytes(original[route])
 for name,p,before,after,test,expected in cases:
  s=original[p].decode();assert before in s,name
  try:p.write_text(s.replace(before,after));run(name,expected,test)
  finally:p.write_bytes(original[p])
finally:
 for p in paths:p.write_bytes(original[p])
 restored=all(p.read_bytes()==b for p,b in original.items())
 (out/'report.json').write_text(json.dumps({'state':'complete' if len(results)==len(cases)+2 and all(x['verified'] for x in results) and restored else 'incomplete','cases':results,'restored':restored,'sourceHashes':{str(p.relative_to(root)):hashlib.sha256(b).hexdigest() for p,b in original.items()},'blindCategory':'Projected query mocks and component output, not live RLS, download transport, printer behavior or practitioner acceptance.'},indent=2)+'\n')
