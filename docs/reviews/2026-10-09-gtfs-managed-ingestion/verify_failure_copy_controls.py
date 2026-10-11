"""Check malformed-archive instructions without changing retained diagnostics."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];app=root/'openplan';out=Path(sys.argv[1]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
source=app/'src/components/data-hub/managed-gtfs-imports.tsx';test=app/'src/test/gtfs-managed-panel.test.tsx';original=source.read_bytes();original_test=test.read_bytes();variants=[('baseline',original,None),('harmless',original+b'\n// Harmless copy control.\n',None)]
def add(name,before,after,assertion):
 text=original.decode();assert text.count(before)==1,(name,text.count(before));variants.append((name,text.replace(before,after).encode(),assertion))
add('raw-job-detail','const status = job.progress?.status, cancelled = job.progress?.cancellation;\n const failure = failureMessage(status);','const status = job.progress?.status, cancelled = job.progress?.cancellation;\n const failure = status?.failureDetail;','explains a malformed ZIP')
add('raw-selected-detail','const status = view.progress?.status, review = view.review;\n const failure = failureMessage(status);','const status = view.progress?.status, review = view.review;\n const failure = status?.failureDetail;','explains a malformed ZIP')
add('discard-other-failures','return status?.failureDetail ?? (status?.failureCode ? `Processing failed. Diagnostic code: ${status.failureCode}. No additional failure detail was recorded.` : null);','return null;','keeps other recorded failures distinct')
add('every-failure-is-zip','status?.failureCode === "not_a_zip"','Boolean(status?.failureCode)','keeps other recorded failures distinct')
variants.append(('restored',original,None));records=[]
try:
 for name,changed,assertion in variants:
  source.write_bytes(changed);test.write_bytes(original_test+(b'\n// Harmless test control.\n' if name=='harmless' else b''));report=out/(name+'.json');result=subprocess.run([str(app/'node_modules/.bin/vitest'),'run',str(test.relative_to(app)),'--maxWorkers=1','--reporter=json','--outputFile='+str(report)],cwd=app,capture_output=True,text=True,timeout=40);(out/(name+'.log')).write_text(result.stdout+result.stderr);data=json.loads(report.read_text());failed=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if assertion:assert result.returncode!=0 and any(assertion in t for t in failed),(name,failed)
  else:assert result.returncode==0 and not failed,(name,failed)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failed});print(name,records[-1]['result'],flush=True)
finally:
 source.write_bytes(original);test.write_bytes(original_test)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(original).hexdigest(),'testSha256':hashlib.sha256(original_test).hexdigest(),'boundary':'Mocked progress and selected-version UI. Three positive and four targeted broken controls. No native diagnostics mutation, browser, physical file chooser, complete restore, capacity or CI acceptance.'},indent=2)+'\n')
