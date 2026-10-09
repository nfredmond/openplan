"""Controller boundary refusals with no live daemon or process mutation."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
path=ROOT/'workers/activitysim_worker/container_supervision.py'; original=path.read_bytes(); source=original.decode()
cases=[('harmless',None,None,None),
 ('ignore-owner',' or plan.user != f\'{os.getuid()}:{os.getgid()}\'','','test_other_user_cannot_start_controller'),
 ('writable-records','if not read_only and records.resolve().is_relative_to(Path(source).resolve()):','if False:','test_writable_mount_cannot_contain_execution_records'),
 ('reuse-log','os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600','os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600','test_existing_command_log_is_not_reused'),
 ('restored',None,None,None)]
results=[]
try:
 for name,before,after,expected in cases:
  text=source
  if before:assert before in text;text=text.replace(before,after)
  if name=='harmless':text+='\n# Harmless boundary control.\n'
  path.write_text(text)
  result=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','workers/activitysim_worker/tests','-p','test_container_supervision.py','-v'],cwd=ROOT,capture_output=True,text=True,timeout=30)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and (f'FAIL: {expected} (' in output or f'ERROR: {expected} (' in output),output
  else:assert result.returncode==0,output
  results.append({'case':name,'expected_behavior_observed':True,'returncode':result.returncode})
finally:path.write_bytes(original)
print(json.dumps({'cases':results,'source_sha256':hashlib.sha256(original).hexdigest(),'limits':['Refusal before process or daemon use; separate live controller campaign covers execution']},indent=2))
