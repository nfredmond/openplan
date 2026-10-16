"""Prepare a fresh identity-bound packet from sealed v2 files, never execution state."""
import os
import shutil
from common import PUBLIC,ROOT,V2,V1,FROZEN,OBS,OLD_PUBLIC,HEAD,OLD_HEAD,sha,inventory,write,read

os.umask(0o077)
roots=[FROZEN,V1,V2,OBS,OLD_PUBLIC,PUBLIC.parent/'2026-10-15-current-project-preview-app-binding']
before={str(path):inventory(path) for path in roots}
write(ROOT/'old-roots-before-private.json',before)
old=read(OLD_PUBLIC/'manifest.json')
assert old['appHead']==OLD_HEAD
for name,digest in old['privateInputs'].items():assert sha(V2/name)==digest,'v2-seal:'+name
assert sha(V2/'binding-private.json')==old['bindingSha256']
assert sha(V2/'run_stage_v2.sh')==old['runnerSha256']
assert sha(V2/'operation-files.sha256')==old['operationFilesSha256']
# Copy these five small sealed data files only. No candidate, .next, intent or cache copy.
for name in ['app-env-private.json','app-v1.env','migrations.json','dependency-binding.json','recovery-active-binding.json']:
    shutil.copyfile(V2/name,ROOT/name);(ROOT/name).chmod(0o600)
values=read(ROOT/'app-env-private.json');assert values['OPENPLAN_COMMIT_SHA']==OLD_HEAD
values['OPENPLAN_COMMIT_SHA']=HEAD
(ROOT/'app-env-private.json').write_text(__import__('json').dumps(values,indent=2)+'\n')
(ROOT/'app-v1.env').write_text(''.join(key+'='+__import__('json').dumps(value)+'\n' for key,value in values.items()))
for name in ['app_binding_v1.py','attest_start_v1.py']:
    shutil.copyfile(PUBLIC/'templates'/name,ROOT/name);(ROOT/name).chmod(0o600)
shutil.copyfile(PUBLIC/'run_stage_v3.sh',ROOT/'run_stage_v3.sh');(ROOT/'run_stage_v3.sh').chmod(0o600)
binding=read(V2/'binding-private.json');binding['appHead']=HEAD
binding['files']={name:sha(ROOT/name) for name in binding['files']}
write(ROOT/'binding-private.json',binding)
names=['run_stage_v3.sh','app_binding_v1.py','attest_start_v1.py','binding-private.json','app-env-private.json','app-v1.env','migrations.json','dependency-binding.json','recovery-active-binding.json']
with (ROOT/'operation-files.sha256').open('x') as stream:
    stream.write(''.join(sha(ROOT/name)+'  '+str(ROOT/name)+'\n' for name in names))
(ROOT/'operation-files.sha256').chmod(0o600)
assert not (ROOT/'candidate').exists() and not list((ROOT/'execution').iterdir())
# The failed v2 candidate and every partial artifact are retained in the streamed inventory.
assert all(inventory(__import__('pathlib').Path(path))==entries for path,entries in before.items())
write(ROOT/'preparation-private.json',{'preparedOnly':True,'appHead':HEAD,'oldRootsUnchanged':True,
    'oldRootEntries':{path:len(entries) for path,entries in before.items()},
    'bindingSha256':sha(ROOT/'binding-private.json'),'privateInputs':binding['files'],
    'candidateExists':False,'executionFiles':[]})
print('Prepared sealed v3 inputs; frozen original/v1/v2 bytes, modes and link text match.')
