"""Disposable RPC money controls; does not establish browser or HTTP retry behavior."""
from pathlib import Path
import json, os, subprocess
root=Path(__file__).resolve().parents[2]
scratch=Path.home()/'.local/state/openplan/m11-resumed-acceptance-2026-09-08'
source=root/'src/lib/invoicing/contracts/closeout.ts'
original=source.read_text()
controls=[('harmless-comment','/** Invoice obligations','/** Retained invoice obligations',True),('credit-sign','+adjustments-credits-payments+refunds','+adjustments+credits-payments+refunds',False)]
results=[]
for name,old,new,survives in controls:
 assert original.count(old)==1
 try:
  source.write_text(original.replace(old,new))
  env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':str(Path.home()/'.local/state/openplan/m11-contract-verification')}
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/contract-practice-rpc-rls.test.ts'],cwd=root,env=env,capture_output=True,text=True)
  output=run.stdout+run.stderr
  (scratch/f'practice-{name}.log').write_text(output)
  assert (run.returncode==0 if survives else run.returncode!=0 and '"open": "100.00"' in output and '"open": "0.00"' in output),output
  results.append({'control':name,'outcome':'survived' if survives else 'killed','exit':run.returncode})
  print(name,results[-1]['outcome'],flush=True)
 finally:
  source.write_text(original)
(root.parent/'docs/reviews/2026-09-08-m11-delivery/resumed-practice-controls.json').write_text(json.dumps(results,indent=2)+'\n')
