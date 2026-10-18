"""Read-only visibility probe. No attestor import, HTTP or runtime receipt write."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-fix-20261015')
V3=ROOT.parent/'current-project-preview-app-binding-20261015-v3'
UNIT='openplan-current-project-preview-app-21510042e-v3-web.service'
ENV={'PATH':'/usr/bin:/bin','HOME':str(ROOT),'XDG_RUNTIME_DIR':'/run/user/1000'}
result={'namespaces':{n:os.readlink('/proc/self/ns/'+n) for n in ['user','pid','net']}}
s=subprocess.run(['/usr/bin/ss','-H','-ltnp','sport = :3585'],env=ENV,capture_output=True,text=True,timeout=5)
rows=s.stdout.splitlines()
result['oneExactListener']=s.returncode==0 and len(rows)==1 and rows[0].split()[3]=='127.74.19.10:3585'
pids=set(re.findall(r'pid=([0-9]+)',s.stdout))
result['listenerPids']=sorted(pids)
# This probe uses the PID from the retained host socket observation, not MainPID.
# Live runner/attestor has no such adaptation and still derives its own PID from ss.
p=Path('/proc/4104299')
for name in ['cwd','cgroup','environ']:
    try:
        if name=='cwd':result['cwdExact']=(p/name).resolve()==V3/'candidate/openplan'
        elif name=='cgroup':result['webCgroupExact']=(p/name).read_text().strip().endswith('/'+UNIT)
        else:
            raw=(p/name).read_bytes()
            environment=dict(s.split('=',1) for s in raw.decode().split('\0') if '=' in s)
            values=json.loads((V3/'app-env-private.json').read_bytes())
            result['environment']={'sha256':hashlib.sha256(raw).hexdigest(),'sealedValuesMatch':all(environment.get(k)==v for k,v in values.items()),'fullAppShaMatch':environment.get('OPENPLAN_COMMIT_SHA')=='21510042e94bcaf80f262205ad156a7bb639e35c'}
    except OSError as e:result[name+'Error']={'type':type(e).__name__,'errno':e.errno}
print(json.dumps(result,indent=2))
