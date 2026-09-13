"""Prove retained writer gates cannot excuse a newly opened direct-write path.

This reads migration inventories only. Actual grants, RLS and RPC authorization
are covered separately by live tests; this script never changes a database.
"""
import json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent;app=root.parents[2]/'openplan'
p=app/'supabase/migrations/20261014000006_engagement_response_rpc_policy_cleanup.sql';original=p.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/retained-gate-mutations');private.mkdir(mode=0o700,exist_ok=True)
cases=[('baseline',original,False),('harmless-comment',original+'\n-- Harmless inventory control.\n',False),('authenticated-write-restored',original+'\nGRANT UPDATE ON public.engagement_closeloop_entries TO authenticated;\n',True),('public-column-write-restored',original+'\nGRANT UPDATE (we_did) ON public.engagement_closeloop_entries TO PUBLIC;\n',True),('permissive-write-restored',original.replace('DROP POLICY IF EXISTS engagement_closeloop_entries_insert ON public.engagement_closeloop_entries;',''),True)]
results=[]
try:
 for name,source,fault in cases:
  p.write_text(source);report=private/(name+'.json')
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/viewer-write-denial-guard.test.ts','--reporter=json','--outputFile='+str(report)],cwd=app,capture_output=True,text=True,timeout=60)
  (private/(name+'.log')).write_text(run.stdout+'\n'+run.stderr)
  d=json.loads(report.read_text());failed=[t['fullName'] for f in d['testResults'] for t in f['assertionResults'] if t['status']=='failed']
  matched=run.returncode==0 and d['numPassedTests']==7 if not fault else run.returncode!=0 and any('accounts for retained RPC-only gates' in t for t in failed)
  row={'name':name,'matched':matched,'outcome':'survived' if run.returncode==0 else 'killed','passed':d['numPassedTests'],'failed':failed};results.append(row);(root/'retained-gate-mutations.json').write_text(json.dumps(results,indent=2)+'\n');print(name,row['outcome'],matched,flush=True);assert matched,row
finally:p.write_text(original)
