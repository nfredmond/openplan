from pathlib import Path
import hashlib,json,subprocess,sys
source=Path('scripts/modeling/prepare_activitysim_walk_transfer.py')
original=source.read_bytes(); records=[]
cmd=[sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p','test_activitysim_walk_transfer.py']
try:
 for reason in ['source archive already exists','development input partition required']:
  old=f"raise ValueError('{reason}')"; new='return {} # synthetic mutation'
  assert original.decode().count(old)==1
  source.write_text(original.decode().replace(old,new))
  r=subprocess.run(cmd,capture_output=True,text=True)
  assert r.returncode!=0 and 'FAIL: test_archive_member_allowlist' in r.stderr
  records.append({'guard':reason,'outcome':'intended assertion failed','exit_code':r.returncode,'output_sha256':hashlib.sha256(r.stderr.encode()).hexdigest()})
finally: source.write_bytes(original)
r=subprocess.run(cmd,capture_output=True,text=True); assert r.returncode==0
print(json.dumps({'records':records,'restored_tests':16,'restoration_exact':source.read_bytes()==original},indent=2))
