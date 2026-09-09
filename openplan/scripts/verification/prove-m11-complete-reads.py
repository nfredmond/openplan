"""Check contract summaries against truncated and failed reads."""
from pathlib import Path
import json,subprocess
root=Path(__file__).resolve().parents[2];results=[]
for name,file,old,new,expected in [
 ('harmless-read-comment','src/lib/invoicing/contracts/cash-summary-server.ts','/** One complete','/** Retained currency evidence.\n * One complete',None),
 ('stop-on-short-page','src/lib/supabase/paged-read.ts','batch.length === 0','batch.length < pageSize','continues through a lower server cap'),
 ('skip-capped-rows','src/lib/supabase/paged-read.ts','from += batch.length','from += pageSize','reads every low-cap page'),
 ('assert-partial-cash','src/lib/invoicing/contracts/cash-summary-server.ts','if(!read.complete)','if(false)','does not claim a complete balance'),
 ('hide-incomplete-contract-register','src/app/(app)/projects/[projectId]/management/page.tsx','const readFailed=!read.complete','const readFailed=false','discloses a failed later read'),
 ('read-unscoped-contracts','src/app/(app)/projects/[projectId]/management/page.tsx','.eq("workspace_id",workspaceId)','','reads every low-cap page'),
]:
 path=root/file;original=path.read_text();assert old in original,name
 try:
  path.write_text(original.replace(old,new));run=subprocess.run(['npm','exec','--','vitest','run','src/test/contract-cash-position.test.tsx','src/test/contract-weekly-management.test.tsx'],cwd=root,capture_output=True,text=True);out=run.stdout+run.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(out)
  assert (run.returncode==0 if expected is None else run.returncode!=0 and expected in out),name+'\n'+out[-3000:]
  results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected});print(name,results[-1]['outcome'],flush=True)
 finally:path.write_text(original)
(root.parent/'docs/reviews/2026-09-08-m11-delivery/complete-read-controls.json').write_text(json.dumps(results,indent=2)+'\n')
