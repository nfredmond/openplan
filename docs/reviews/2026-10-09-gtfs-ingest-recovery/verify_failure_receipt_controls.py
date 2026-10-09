"""Check adapter error receipts with reversible source mutations, not SQL semantics."""
from pathlib import Path
import json
import subprocess
ROOT=Path(__file__).resolve().parents[3]
source=ROOT/'openplan/src/lib/gtfs/persist.ts'
original=source.read_text()
cases=[('baseline',original,True),('harmless',original+'\n// Harmless receipt control.\n',True),('wrong-version',original.replace('p_version_id: params.versionId','p_version_id: "wrong-version"'),False),('false-success',original.replace('return { recorded: false, feedStatusChanged: false };','return { recorded: true, feedStatusChanged: false };'),False),('discard-confirmed-receipt',original.replace('return { recorded: data.recorded, feedStatusChanged: data.feedStatusChanged };','return { recorded: false, feedStatusChanged: false };'),False),('restored',original,True)]
results=[]
try:
 for name,text,expected in cases:
  source.write_text(text)
  result=subprocess.run([str(ROOT/'openplan/node_modules/.bin/vitest'),'run','src/test/gtfs-failure-receipts.test.ts','--maxWorkers=1'],cwd=ROOT/'openplan',text=True,capture_output=True,timeout=30)
  if (result.returncode==0)!=expected: raise RuntimeError(name+'\n'+result.stdout+result.stderr)
  if not expected and 'AssertionError' not in result.stdout+result.stderr: raise RuntimeError('Unexpected failure '+name)
  results.append({'case':name,'exitCode':result.returncode,'expectedPass':expected})
finally:
 source.write_text(original)
print(json.dumps(results,indent=2))
