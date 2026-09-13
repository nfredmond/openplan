"""Focused source mutations; restores exact bytes after every run, including failure."""
import hashlib, json, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[3]
app=root/'openplan'
review=Path(__file__).resolve().parent
reader=app/'src/lib/engagement/response-history-server.ts'
route=app/'src/app/api/engagement/campaigns/[campaignId]/closeloop/history/route.ts'
ui=app/'src/components/engagement/response-history.tsx'
cases=[
 ('harmless-comment',ui,'/** Opens','/** Harmless comment. Opens',None),
 ('fetch-before-open',ui,'{open && <HistoryRecords','{true && <HistoryRecords','loads on demand'),
 ('hide-read-failure',ui,'if (error) return','if (false) return','keeps failed reads distinct'),
 ('accept-foreign-history',ui,'if (rows.some(row => row.campaign_id !== campaignId || row.record.campaign_id !== campaignId || row.record.id !== row.response_id))','if (false)','refuses a foreign history'),
 ('leave-interrupted-read',ui,'return () => controller.abort();','return () => {};','aborts interrupted reads'),
]

results=[]
for name,path,before,after,expected in cases:
 original=path.read_text(); assert original.count(before)==1,(name,original.count(before))
 try:
  path.write_text(original.replace(before,after))
  run=subprocess.run(['npx','vitest','run','src/test/engagement-response-history-ui.test.tsx'],cwd=app,capture_output=True,text=True,timeout=60)
 finally: path.write_text(original)
 output=run.stdout+run.stderr
 matched=run.returncode==0 if expected is None else run.returncode!=0 and expected in output and ('AssertionError' in output or 'TestingLibraryElementError: Unable to find role="alert"' in output)
 results.append({'name':name,'status':run.returncode,'outcome':'survived' if run.returncode==0 else 'killed','matched':matched,'expectedTest':expected,'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'diagnostic':output[-1600:] if not matched else None})
 (review/'reader-ui-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
 print(name,results[-1]['outcome'],matched,flush=True)
 if not matched: raise RuntimeError(output)
