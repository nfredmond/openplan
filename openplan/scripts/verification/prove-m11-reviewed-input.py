"""Verify that the caller's reviewed inputs remain binding through the shared calculation module."""
from pathlib import Path
import subprocess,json
root=Path(__file__).resolve().parents[2];source=root/'src/lib/invoicing/contracts/calculation.ts';original=source.read_text();results=[]
controls=[('harmless-reviewed-input',lambda s:'// Caller-reviewed source identity.\n'+s,None),('ignore-browser-forecast-version',lambda s:s.replace('command.expectedInputHash!==state.delivery.inputHash','false'),'stale browser review'),('ignore-browser-closeout-version',lambda s:s.replace('command.expectedInputHash!==state.closeout.inputHash','false'),'stale closeout preview')]
for name,mutate,expected in controls:
 try:
  changed=mutate(original);assert changed!=original;source.write_text(changed)
  r=subprocess.run(['npm','test','--','--run','src/test/contract-delivery-api.test.ts','src/test/contract-workflow-api.test.ts'],cwd=root,text=True,capture_output=True);log=r.stdout+r.stderr;Path('/tmp/'+name+'.log').write_text(log)
  assert (r.returncode==0 if expected is None else r.returncode!=0 and expected in log),log[-7000:]
  results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected})
 finally:source.write_text(original)
(root.parent/'docs/reviews/2026-09-08-m11-delivery/reviewed-input-controls.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
