"""Bounded-log controls using the actual ActivitySim runtime and disposable CLI."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
path=ROOT/'workers/activitysim_worker/runtime.py';original=path.read_bytes();source=original.decode()
cases=[('harmless',source+'\n# Harmless runtime log control.\n',None),
 ('buffer-output',source.replace('stdout=run_log,','stdout=subprocess.PIPE,'),'test_command_log_survives_runtime_owner_loss'),
 ('drop-stderr',source.replace('stderr=subprocess.STDOUT,','stderr=subprocess.DEVNULL,'),'test_command_log_survives_runtime_owner_loss'),
 ('read-whole-log',source.replace('handle.seek(max(0, size - max_chars * 4))','handle.seek(0)').replace('handle.read(max_chars * 4)','handle.read()'),'Reading a tail allocated the whole log'),
 ('invalid-limit',source.replace('if type(max_chars) is not int or max_chars <= 0:','if False:'),'ValueError not raised'),
 ('wrong-tail',source.replace('return text[-max_chars:] if text else None','return text[:max_chars] if text else None'),'test_tail_preserves_unicode_and_empty_file_behavior'),
 ('restored',source,None)]
records=[]
try:
 for name,body,expected in cases:
  if expected:assert body!=source
  path.write_text(body)
  result=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','workers/activitysim_worker/tests','-p','test_runtime*.py','-v'],cwd=ROOT,capture_output=True,text=True,timeout=45)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and expected in output,output
  else:assert result.returncode==0,output
  records.append({'case':name,'returncode':result.returncode,'detected':expected,'verified':True})
finally:path.write_bytes(original)
print(json.dumps({'cases':records,'runtime_sha256':hashlib.sha256(original).hexdigest(),
 'limits':['Synthetic CLI through real runtime; container CLI mocked','Python allocation measurement excludes kernel cache and other processes','Log retention does not establish process termination, managed dispatch or scientific acceptance']},indent=2))
