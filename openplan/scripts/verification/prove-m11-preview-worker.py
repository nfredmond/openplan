"""Worker lifecycle failure controls; browser delivery remains separate evidence."""
from pathlib import Path
import subprocess,json
root=Path(__file__).resolve().parents[2];results=[]
for name,file,old,new,reason in [
 ('harmless-preview-comment','lib/invoicing/contracts/forecast-preview.ts','/** A disposable','/** Cancellable. A disposable',None),
 ('skip-worker-request','lib/invoicing/contracts/forecast-preview.ts','worker.postMessage(input);','', 'calculates preview outside the page'),
 ('keep-completed-worker','lib/invoicing/contracts/forecast-preview.ts','=>{worker.terminate();if(event.data.error','=>{if(event.data.error','calculates preview outside the page'),
 ('hide-worker-error','lib/invoicing/contracts/forecast-preview.ts','reject(new Error(event.data.error))','resolve(event.data.result!)','reports calculation and transport errors'),
 ('skip-worker-cancel','lib/invoicing/contracts/forecast-preview.ts','cancel(){worker.terminate();','cancel(){','cancels and discards late replies'),
 ('skip-page-cleanup','components/invoicing/contracts/delivery-management.tsx','useEffect(()=>()=>{job.current?.cancel();job.current=null;},[state]);','useEffect(()=>()=>{},[state]);','discards calculations and previous previews'),
 ('show-stale-preview','components/invoicing/contracts/delivery-management.tsx','preview?.state===state','preview','discards calculations and previous previews'),
 ('calculate-before-queue','components/invoicing/contracts/delivery-management.tsx','if(val(d,"reviewEvidence")){await send','if(val(d,"reviewEvidence")){startForecastPreview({state,delivery:state.delivery!,options});await send','queues reviewed calculation without'),
 ('worker-false-result','lib/invoicing/contracts/forecast-preview.worker.ts','result:forecastDelivery(state,delivery,options)','result:{...forecastDelivery(state,delivery,options),finish:"2099-01-01"}','runs the worker'),
 ('worker-hide-validation','lib/invoicing/contracts/forecast-preview.worker.ts','error instanceof Error?error.message','error instanceof Error?"Unknown"','runs the worker'),
]:
 path=root/'src'/file;original=path.read_text();assert old in original,name
 try:
  path.write_text(original.replace(old,new));p=subprocess.run(['npm','exec','--','vitest','run','src/test/contract-forecast-preview.test.tsx',*(['-t',reason] if reason else [])],cwd=root,capture_output=True,text=True);out=p.stdout+p.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(out)
  assert (p.returncode==0 if reason is None else p.returncode!=0 and reason in out),name+'\n'+out[-4000:]
  results.append({'name':name,'outcome':'survived' if reason is None else 'killed','reason':reason});print(name,results[-1]['outcome'],flush=True)
  (root.parent/'docs/reviews/2026-09-08-m11-delivery/preview-worker-controls.json').write_text(json.dumps(results,indent=2)+'\n')
 finally:path.write_text(original)
