"""Prove the live JOIN census notices a missing receipt-table registration."""
from pathlib import Path
import hashlib,json,os,subprocess,time
review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
source=app/'src/test/rls-isolation.test.ts'
original=source.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('translation-receipt-census-'+time.strftime('%Y%m%dT%H%M%S'))
private.mkdir(parents=True)
env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050'}
needle='  "engagement_translation_write_receipts",\n'
assert original.count(needle)==2
cases=[('baseline',original,False),('harmless',original+'\n// Harmless receipt census control.\n',False),('omit-receipt-registration',original.replace(needle,'',1),True)]
results=[]
try:
 for name,body,broken in cases:
  assert source.read_text()==original
  source.write_text(body)
  try:
   run=subprocess.run(['node','--env-file-if-exists=.env.local','node_modules/vitest/vitest.mjs','run','src/test/rls-isolation.test.ts','-t','every workspace_id table is probed','--reporter=verbose'],cwd=app,env=env,text=True,capture_output=True,timeout=90)
  finally:
   source.write_text(original)
  output=run.stdout+run.stderr
  (private/(name+'.log')).write_text(output)
  correct=(run.returncode!=0 and 'engagement_translation_write_receipts' in output and 'THROUGH A JOIN' in output and 'AssertionError' in output) if broken else run.returncode==0 and '1 passed' in output
  results.append({'case':name,'outcome':'killed' if run.returncode else 'survived','expectedOutcome':correct})
  print(name,results[-1]['outcome'],correct,flush=True)
  assert correct,output[-4000:]
finally:
 assert source.read_text()==original
(review/'translation-receipt-census-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Live schema census checks registration only. Receipt read/privacy behavior is independently exercised by translation-command-activation.sql and its policy faults. No browser or worker coverage.'},indent=2)+'\n')
