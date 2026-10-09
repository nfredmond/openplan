"""Detect mismatched prestart facts without granting container authority."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
path=ROOT/'workers/activitysim_worker/container_identity.py'
original=path.read_bytes();source=original.decode()
cases=[('harmless',None,None,None),
 ('authorize-start','"start_authorized": False','"start_authorized": True','test_verified_observation_does_not_authorize_execution'),
 ('ignore-daemon',' or daemon_id != plan.daemon_id','','test_other_daemon_is_refused'),
 ('ignore-image','if observed.get("Image") != plan.image_id:','if False:','test_policy_and_identity_changes_are_refused'),
 ('ignore-environment','or sorted(environment) != sorted(plan.environment)','or False','test_policy_and_identity_changes_are_refused'),
 ('ignore-mounts','if sorted(actual) != sorted(plan.mounts):','if False:','test_changed_or_additional_mount_is_refused'),
 ('allow-mutable-command','(self.command, self.entrypoint, self.environment, self.mounts)','(self.entrypoint, self.environment, self.mounts)','test_mutable_plan_and_tag_only_image_are_refused'),
 ('restored',None,None,None)]
records=[]
try:
 for name,before,after,expected in cases:
  text=source
  if before:
   assert before in text
   text=text.replace(before,after)
  elif name=='harmless':text+='\n# Harmless container identity control.\n'
  path.write_text(text)
  result=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','workers/activitysim_worker/tests','-p','test_container_identity.py','-v'],cwd=ROOT,capture_output=True,text=True,timeout=30)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and (f'FAIL: {expected} (' in output or f'ERROR: {expected} (' in output),output
  else:assert result.returncode==0,output
  records.append({'case':name,'verified':True,'returncode':result.returncode,'expected_failure':expected})
finally:path.write_bytes(original)
print(json.dumps({'cases':records,'source_sha256':hashlib.sha256(original).hexdigest(),
 'limits':['Supplied synthetic inspection facts','Separate created-container test uses live Docker','No controller or startup authority']},indent=2))
