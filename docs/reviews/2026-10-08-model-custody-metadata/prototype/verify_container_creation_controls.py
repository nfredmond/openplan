"""Serial retention faults with exact-byte restoration."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
path=ROOT/'workers/activitysim_worker/container_creation.py'
original=path.read_bytes();source=original.decode()
cases=[('harmless',[],None),
 ('allow-repeat', [('if self.requested:', 'if False:'), (' | os.O_EXCL','')], 'test_intent_and_reservation_survive_missing_reply_without_retry'),
 ('writable-custody',[('if not read_only and resolved.is_relative_to(Path(source).resolve()):','if False:')],'test_custody_inside_writable_mount_is_refused'),
 ('ignore-intent-change',[('if current_hash != self.intent_hash:','if False:')],'test_changed_intent_refuses_create_and_receipt'),
 ('ignore-directory-change',[('if (info.st_dev, info.st_ino) != self.identity:','if False:')],'test_replaced_directory_refuses_receipt'),
 ('accept-unverified-container',[('identity = verify_created_container(self.plan, daemon_id, observed)', 'identity = {"start_authorized": False}')],'test_wrong_container_is_not_retained_as_created'),
 ('invent-start-authority',[('self._write("created.json",','identity["start_authorized"] = True\n        self._write("created.json",')],'test_verified_creation_is_recorded_once_without_start_authority'),
 ('restored',[],None)]
records=[]
try:
 for name,changes,expected in cases:
  text=source
  for before,after in changes:
   assert before in text
   text=text.replace(before,after)
  if name=='harmless':text+='\n# Harmless creation custody control.\n'
  path.write_text(text)
  result=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','workers/activitysim_worker/tests','-p','test_container_creation.py','-v'],cwd=ROOT,capture_output=True,text=True,timeout=30)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and (f'FAIL: {expected} (' in output or f'ERROR: {expected} (' in output),output
  else:assert result.returncode==0,output
  records.append({'case':name,'verified':True,'returncode':result.returncode,'expected_failure':expected})
finally:path.write_bytes(original)
print(json.dumps({'cases':records,'source_sha256':hashlib.sha256(original).hexdigest(),
 'limits':['Private synthetic creation records','Separate local Docker proof covers actual created containers','No network reply loss, controller crash, startup or owner-loss termination']},indent=2))
