"""Execute the documented external hash gate with private final-payload stand-ins."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import verify_runner as t

recipe=(t.PUBLIC/'PARENT_RECIPE.md').read_text().split('```bash\n',1)[1].split('\n```',1)[0]
entry,body=recipe.split(" <<'PARENT'\n",1)
body=body.rsplit('\nPARENT',1)[0]+'\n'
rows=[]
for index,name in [(40,'harmless-entry-comment'),(41,'changed-runner-unit-refuses'),(42,'removed-external-runner-gate')]:
    root,v3,runner,unit,peer=t.fixture(index)
    original=runner.read_bytes()
    try:
        expected=hashlib.sha256(original).hexdigest()
        script=body.replace(str(t.ROOT),str(root)).replace('640c666db673aa70a758654722eec625e7491c8120aad3ebe17b57faff19cef3',expected)
        argv=[x.replace(str(t.ROOT),str(root)) for x in shlex.split(entry)]
        if index==40:script='# harmless entry wording\n'+script
        else:runner.write_text(runner.read_text().replace('--unit='+unit,'--unit='+unit+'-changed'))
        if index==42:
            start=script.index('/usr/bin/sha256sum');end=script.index('\nRUNNER\n',start)+len('\nRUNNER\n')
            script=script[:start]+script[end:]
        env={**t.ENV,'PATH':str(root/'traps'),'PYTHONPATH':str(root/'traps'),'ENV':str(root/'traps/shell-init'),'BASH_ENV':str(root/'traps/shell-init')}
        r=subprocess.run(argv,input=script,env=env,capture_output=True,text=True,timeout=40)
        (root/'parent-entry.txt').write_text(script);(root/'parent-stdout.txt').write_text(r.stdout);(root/'parent-stderr.txt').write_text(r.stderr)
        reached=(root/'payload.json').exists()
        assert not any((root/x).exists() for x in ['path-trap','python-trap','shell-trap'])
        if index==41:
            t.no_dispatch(reached,t.absent(unit) and t.absent(unit+'-changed'))
            assert r.returncode==2 and not (root/'attempt-host-01').exists()
            outcome='DETECTED before unit and interpreter'
        else:
            assert r.returncode==0 and reached
            outcome='SURVIVED' if index==40 else t.detected_dispatch({'reachedPayload':True})
        rows.append({'case':name,'exit':r.returncode,'reachedPayload':reached,'outcome':outcome})
    finally:
        runner.write_bytes(original);assert runner.read_bytes()==original
        peer.terminate();peer.wait(timeout=5)
(t.ROOT/'parent-entry-controls.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps({'parentEntryControls':rows}))
