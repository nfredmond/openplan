"""Targeted adapter/operator refusals, with real runtime CLI controls separate."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];worker=ROOT/'workers/activitysim_worker'
original={name:(worker/name).read_bytes() for name in ('container_execution.py','runtime.py','main.py')}
cases=[('harmless',[],None,False),
 ('unpin-image',[('container_execution.py',"image_id=image.get('Id')","image_id=execution['image']")],'test_image_is_pinned_and_existing_command_mounts_and_home_survive',False),
 ('change-home',[('container_execution.py',"'HOME=' + execution['container_paths']['home_dir']","'HOME=/root'")],'test_image_is_pinned_and_existing_command_mounts_and_home_survive',False),
 ('write-input-mounts',[('container_execution.py',"mount['read_only']","False")],'test_image_is_pinned_and_existing_command_mounts_and_home_survive',False),
 ('discard-engine-options',[('container_execution.py','len(engine) != 1','False')],'test_engine_arguments_are_not_silently_discarded',False),
 ('omit-required-limits',[('runtime.py','if not container_image or container_memory_bytes is None:','if False:')],'test_supervision_requires_explicit_limits_and_absolute_socket',False),
 ('allow-relative-socket',[('runtime.py',' or not Path(container_supervision_socket).is_absolute()','')],'test_supervision_requires_explicit_limits_and_absolute_socket',False),
 ('drop-operator-socket',[('main.py','container_supervision_socket=payload["container_supervision_socket"]','container_supervision_socket=None')],'test_operator_selects_container_limits',True),
 ('accept-http-socket',[('main.py','{"bundlePath", "manifestPath", "runLabel"}','{"bundlePath", "manifestPath", "runLabel", "containerSupervisionSocket"}')],'test_request_cannot_choose_executable_or_replace_unrelated_directory',True),
 ('erase-custody-output',[('runtime.py','if custody.exists() or custody.is_symlink():','if False:')],'test_force_cannot_erase_output_linked_to_retained_custody',False),
 ('restored',[],None,False)]
results=[]
try:
 for name,changes,expected,http in cases:
  for file,content in original.items():(worker/file).write_bytes(content)
  for file,before,after in changes:
   path=worker/file;source=path.read_text();assert before in source;path.write_text(source.replace(before,after))
  if name=='harmless':
   path=worker/'container_execution.py';path.write_text(path.read_text()+'\n# Harmless adapter control.\n')
  result=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s',str(worker if http else worker/'tests'),'-p','test_http_security.py' if http else 'test_container_execution.py','-v'],cwd=ROOT,capture_output=True,text=True,timeout=30)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and (f'FAIL: {expected} (' in output or f'ERROR: {expected} (' in output),output
  else:assert result.returncode==0,output
  results.append({'case':name,'expected_behavior_observed':True,'returncode':result.returncode})
finally:
 for name,content in original.items():(worker/name).write_bytes(content)
print(json.dumps({'cases':results,'sources':{name:hashlib.sha256(content).hexdigest() for name,content in original.items()},'limits':['Synthetic adapter and operator HTTP boundaries; separate live runtime proof covers execution']},indent=2))
