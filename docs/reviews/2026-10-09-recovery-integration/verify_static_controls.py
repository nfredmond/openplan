"""Run harmless and broken integration inventories without editing tracked tests."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

root = Path(__file__).resolve().parents[3]
app = root/'openplan'
results=[]
for relative, old, new, failure in [
 ('src/test/migrations/inventory.test.ts','relations: 321','relations: 320','expected'),
 ('src/test/a-column-nothing-reads-is-a-question.test.ts',None,None,'gtfs_feed_versions.ingest_closed_at')]:
 source=app/relative
 original=source.read_text()
 if old:
  assert original.count(old)==1
  broken=original.replace(old,new)
 else:
  lines=[line for line in original.splitlines(keepends=True) if 'column: "gtfs_feed_versions.ingest_closed_at"' in line]
  assert len(lines)==1
  broken=original.replace(lines[0],'')
 target=source.parent/('integration-control-'+uuid.uuid4().hex+'.test.ts')
 try:
  for name,code,expected in [('harmless',original+'\n// harmless comment\n',True),('broken',broken,False),('restored',original,True)]:
   target.write_text(code)
   run=subprocess.run([str(app/'node_modules/.bin/vitest'),'run',str(target.relative_to(app)),'--maxWorkers=1'],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=1024'},capture_output=True,text=True,timeout=40)
   output=run.stdout+run.stderr
   assert (run.returncode==0)==expected, (relative,name,output[-4000:])
   if not expected: assert failure in output,(relative,name,output[-4000:])
   results.append({'test':relative,'case':name,'expectedPass':expected,'exitCode':run.returncode,'sourceSha256':hashlib.sha256(original.encode()).hexdigest()})
 finally:
  target.unlink(missing_ok=True)
  assert source.read_text()==original
print(json.dumps({'cases':results,'trackedTestsUnchanged':True},indent=2))
