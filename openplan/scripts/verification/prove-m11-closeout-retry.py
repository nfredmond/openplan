"""Retry controls across the API adapter and disposable SQL transaction."""
from pathlib import Path
import os,subprocess,json
root=Path(__file__).resolve().parents[2]
scratch=Path.home()/'.local/state/openplan/m11-resumed-acceptance-2026-09-08'
path=root/'src/lib/invoicing/contracts/calculation.ts';original=path.read_text()
guard='if(command.kind==="closeout"&&state.closeout.versions.some(v=>v.content.request?.requestId===command.requestId))return {...command,_request:command};'
controls=[('harmless-comment','// SQL replays','// The SQL transaction replays',True,None),('remove-retry',guard,'',False,'closeout data changed'),('replace-caller-payload',guard,'if(command.kind==="closeout"&&state.closeout.versions.some(v=>v.content.request?.requestId===command.requestId)){const retained=state.closeout.versions.find(v=>v.content.request?.requestId===command.requestId)!.content.request;return {...retained,_request:retained};}',False,'promise resolved')]
results=[]
for name,old,new,survives,reason in controls:
 assert original.count(old)==1
 try:
  path.write_text(original.replace(old,new))
  env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':str(Path.home()/'.local/state/openplan/m11-contract-verification')}
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/contract-practice-rpc-rls.test.ts','src/test/contract-workflow-api.test.ts'],cwd=root,env=env,capture_output=True,text=True)
  output=run.stdout+run.stderr;(scratch/f'retry-{name}.log').write_text(output)
  assert (run.returncode==0 if survives else run.returncode!=0 and reason in output),output
  results.append({'control':name,'outcome':'survived' if survives else 'killed','reason':reason})
  print(name,results[-1]['outcome'],flush=True)
 finally:path.write_text(original)
(root.parent/'docs/reviews/2026-09-08-m11-delivery/resumed-retry-controls.json').write_text(json.dumps(results,indent=2)+'\n')
