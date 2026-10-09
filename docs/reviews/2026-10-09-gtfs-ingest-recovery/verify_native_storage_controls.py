"""Verify native cleanup plus harmless and targeted application mutations."""
import json
import os
from pathlib import Path
import subprocess
import sys

here=Path(__file__).resolve().parent
root=here.parents[2]
p=root/'openplan/src/lib/gtfs/persist.ts'
original=p.read_text()
cases=[('baseline',original,'storage',True),('harmless',original+'\n// harmless control\n','storage',True),
       ('lost_acknowledgment',original,'acknowledgment',True),
       ('omit_removal',original.replace('const removed = await service.storage.from(GTFS_UPLOADS_BUCKET).remove([object.storage_path]);','const removed = { error: null };'),'storage',False),
       ('ignore_acknowledgment_error',original.replace('if (acknowledged.error) throw','if (false) throw'),'acknowledgment',False),
       ('restored',original,'storage',True)]
results=[]
try:
    for name,source,fault,expected in cases:
        if not expected and source==original:raise SystemExit('Mutation did not apply')
        p.write_text(source)
        env={**os.environ,'OPENPLAN_PROOF_NATIVE_STORAGE':'1','OPENPLAN_PROOF_FAILURE':fault}
        r=subprocess.run([sys.executable,str(here/'verify_http.py'),sys.argv[1]],cwd=root,env=env,text=True,capture_output=True,timeout=60)
        if (r.returncode==0)!=expected or (not expected and 'AssertionError' not in r.stderr):
            raise SystemExit(f'{name}: {r.stdout}\n{r.stderr}')
        results.append({'case':name,'expectedPass':expected,'returnCode':r.returncode,'result':json.loads(r.stdout) if expected else None})
finally:
    p.write_text(original)
print(json.dumps(results,indent=2))
