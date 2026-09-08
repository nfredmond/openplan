"""Check review controls preserve warnings, failed requests and role-scoped navigation."""
from pathlib import Path
import subprocess,json
root=Path(__file__).resolve().parents[2];results=[]
for name,file,old,new,expected in [
 ('harmless-layout-comment','forecast-warnings.tsx','/** Repeated','/** Retained review evidence.\n * Repeated',None),
 ('hide-warning-dates','forecast-warnings.tsx','warnings.map((w,i)=>','warnings.slice(0,1).map((w,i)=>','groups repeated warnings'),
 ('drop-warning-link','forecast-warnings.tsx','const link=engagementId?','const link=false?','groups repeated warnings'),
 ('hide-failed-job','calculation-jobs.tsx','jobs.filter(j=>j.status!=="succeeded")','jobs.filter(j=>j.status==="running")','keeps failed work'),
 ('expand-completed-history','calculation-jobs.tsx','finished.length>0&&<details>','finished.length>0&&<details open>','keeps failed work'),
 ('lose-retry-identity','calculation-jobs.tsx','jobId:id','jobId:"wrong"','keeps failed work'),
 ('expose-finance-menu','contract-management.tsx','const visibleTabs=tabs.filter','const visibleTabs=tabs.filter',None),
 ('assert-zero-on-source-error','contract-management.tsx','{position&&!error&&<>','{position&&<>','does not show a zero cash'),
 ('disconnect-mobile-subsection','delivery-management.tsx','onChange={e=>setSection(e.target.value)}','onChange={e=>void e.target.value}','mobile section selectors'),
]:
 path=root/'src/components/invoicing/contracts'/file;original=path.read_text()
 if name=='expose-finance-menu':
  a=original.index(' const visibleTabs=');b=original.index(';',a);changed=original[:a]+' const visibleTabs=tabs'+original[b:];expected='mobile section selectors'
 else:
  assert old in original,name;changed=original.replace(old,new)
 assert changed!=original
 try:
  path.write_text(changed);result=subprocess.run(['npm','test','--','--run','src/test/contract-review-layout.test.tsx'],cwd=root,capture_output=True,text=True);output=result.stdout+result.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(output)
  assert (result.returncode==0 if expected is None else result.returncode!=0 and expected in output),name+'\n'+output[-4000:]
  results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected});print(name,results[-1]['outcome'],flush=True)
  (root.parent/'docs/reviews/2026-09-08-m11-delivery/review-layout-controls.json').write_text(json.dumps(results,indent=2)+'\n')
 finally:path.write_text(original)
