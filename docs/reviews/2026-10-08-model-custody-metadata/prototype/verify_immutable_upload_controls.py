"""Readback must detect wrong bytes and failed reads for every upload family."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'workers/aequilibrae_worker/main.py'
original=source.read_bytes()
condition=b'if retained.status_code != 200 or retained.content != data:'
assert original.count(condition)==1
variants=[('harmless',original+b'\n# Harmless upload recovery control.\n',None),
 ('ignore-bytes',original.replace(condition,b'if retained.status_code != 200:'),'test_changed_bytes_refused'),
 ('ignore-status',original.replace(condition,b'if retained.content != data:'),'test_unavailable_read_refused'),
 ('restored',original,None)]
cases=[]
try:
 for name,content,test in variants:
  source.write_bytes(content)
  args=[sys.executable,'-B',str(ROOT/'workers/aequilibrae_worker/test_immutable_upload_recovery.py')]
  if test:args.append('ImmutableUploadRecoveryTests.'+test)
  result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True)
  detail=result.stdout+result.stderr
  if test:assert result.returncode!=0 and test in detail and 'AssertionError' in detail,detail
  else:assert result.returncode==0,detail
  cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
 # The changed legacy test must still detect a false stored-byte confirmation.
 source.write_bytes(original.replace(condition,b'if False:'))
 result=subprocess.run([sys.executable,'-B',str(ROOT/'workers/aequilibrae_worker/test_count_ingest.py')],cwd=ROOT,capture_output=True,text=True)
 assert result.returncode!=0 and 'a failed immutable upload was accepted as custody' in result.stdout+result.stderr
 cases.append({'control':'legacy-failed-read-accepted','returncode':result.returncode,'expected_behavior_observed':True})
finally:source.write_bytes(original)
report={'cases':cases,'source_sha256':hashlib.sha256(original).hexdigest(),
 'limits':['Mock HTTP failure controls complement the separate native Storage campaign', 'No transaction custody, full user RLS matrix, process restart or scientific acceptance']}
Path(__file__).with_name('immutable-upload-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
