from pathlib import Path
import subprocess,json,hashlib
root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007/openplan')
base=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority')
out=base/'report-export-controls';out.mkdir(exist_ok=True)
route=root/'src/app/api/reports/[reportId]/provenance/route.ts'
adoption=root/'src/lib/land-use-plans/report-adoption.ts'
component=root/'src/components/reports/land-use-plan-report-adoption.tsx'
paths=[route,adoption,component];original={p:p.read_bytes() for p in paths}
route_test='src/test/land-use-report-provenance-route.test.ts'
adoption_test='src/test/land-use-plan-report-adoption.test.tsx'
cases=[]
def add(name,p,before,after,expected,test=route_test):cases.append((name,p,before,after,test,expected))
add('bypass-all-verification',route,'if (!verified) return','if (false) return','withholds implementation download with missing register')
add('bypass-implementation',route,'verified = Boolean(await loadImplementationReportSnapshot(supabase, { ...report, report_type: report.report_type }, metadata));','verified = true;','withholds implementation download with changed saved status')
add('bypass-decision',route,'verified = adoption.status !== "invalid";','verified = true;','withholds adoption download with changed retained decision')
add('bypass-auth-error',route,'authError || !user','!user','withholds failed authentication with user present')
add('ignore-artifact-plan-signal',route,' || metadata.landUsePlanId','', 'withholds adoption download with wrong kind with artifact plan')
add('ignore-artifact-kind-signal',route,'\n    || metadata.kind === "land_use_plan_implementation_report"','', 'withholds adoption download with wrong kind with artifact kind')
add('force-unrelated-validation',route,'if (report.land_use_plan_id ||','if (true || report.land_use_plan_id ||','preserves unrelated report downloads')
add('omit-artifact-projection',route,'id, artifact_kind, generated_at, metadata_json','id, artifact_kind, generated_at','downloads the retained adopted plan')
add('omit-artifact-filter',route,'.eq("report_id", access.report.id)','', 'downloads the retained adopted plan')
add('reverse-artifact-order',route,'{ ascending: false }','{ ascending: true }','downloads the retained adopted plan')
add('omit-artifact-limit',route,'.limit(1)','', 'downloads the retained adopted plan')
add('omit-attachment-header',route,'"content-disposition":','"x-disposition":','downloads the retained adopted plan')
add('omit-no-store',route,'"cache-control": "no-store"','"cache-control": "public"','downloads the retained adopted plan')
add('false-content-type',route,'application/json; charset=utf-8','text/plain','downloads the retained adopted plan')
# Each existing transport refusal has a status assertion; these mutations leave data flow intact.
for name,message,status,expected in [
 ('invalid-id','Invalid report id',400,'rejects invalid report id'),('signed-out','Unauthorized',401,'withholds signed out'),
 ('report-error','Failed to load report',500,'withholds report error'),('report-missing','Report not found',404,'withholds missing report'),
 ('membership','Forbidden',403,'withholds missing membership'),('artifact-error','Failed to load report provenance',500,'withholds artifact error'),
 ('artifact-missing','Report has no artifact',404,'withholds missing artifact')]:
 add('false-success-'+name,route,'{ error: "'+message+'" }, { status: '+str(status)+' }','{ error: "'+message+'" }, { status: 200 }',expected)
# Re-exercise the extracted checks with the pre-existing adversarial adoption cases.
old=(base/'report-adoption-controls.py').read_text()
namespace={}
exec(old[:old.index('results=[]')],namespace)
for name,p,before,after,test,expected in namespace['cases']:
 if p.name=='land-use-plan-report-adoption.tsx':
  target=adoption if before in original[adoption].decode() else component
  if before in original[target].decode():add('extracted-'+name,target,before,after,expected,test)
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
