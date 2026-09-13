"""Prove installed-fixture completion and the history entry in the isolation census."""
from pathlib import Path
import os,json,subprocess
root=Path(__file__).resolve().parent;app=root.parents[2]/'openplan'
private=Path(os.environ['OPENPLAN_TRANSLATION_PROBE_EVIDENCE']).resolve()
if private.is_relative_to(root.parents[2]): raise ValueError('Evidence must be outside repo')
private.mkdir(parents=True,exist_ok=True)
results=[]
def run(name,live,expected=None):
 report=private/(name+'.json');env=os.environ.copy();env.pop('OPENPLAN_RLS_LIVE_TEST',None)
 test='src/test/engagement-translation-history-rls.test.ts' if live else 'src/test/rls-isolation.test.ts'
 if live:
  env['OPENPLAN_RLS_LIVE_TEST']='1';env['OPENPLAN_SUPABASE_WORKDIR']='/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050'
 args=['node','--env-file=.env.local','node_modules/vitest/vitest.mjs','run',test,'--reporter=json','--outputFile='+str(report)]
 if not live: args+=['-t','covers every direct workspace-scoped table']
 r=subprocess.run(args,cwd=app,env=env,capture_output=True,text=True,timeout=90)
 (private/(name+'.log')).write_text(r.stdout+r.stderr);d=json.loads(report.read_text())
 failed=[a['fullName'] for f in d['testResults'] for a in f['assertionResults'] if a['status']=='failed']
 matched=(r.returncode==0 and d['numPassedTests']>0) if expected is None else r.returncode!=0 and any(expected in title for title in failed)
 result={'case':name,'matched':matched,'outcome':'survived' if r.returncode==0 else 'killed','failed':failed};results.append(result);print(name,matched,flush=True)
 (private/'results.json').write_text(json.dumps(results,indent=2)+'\n');assert matched,result
fixture=app/'src/test/fixtures/engagement/translation-history.sql';original=fixture.read_text()
try:
 run('baseline-fixture',True)
 fixture.write_text(original+'\n-- Harmless live fixture comment.\n');run('harmless-fixture',True)
 fixture.write_text('');run('empty-fixture',True,'translation history retains complete private originals')
finally: fixture.write_text(original)
census=app/'src/test/rls-isolation.test.ts';original=census.read_text()
try:
 run('baseline-census',False)
 census.write_text(original+'\n// Harmless census comment.\n');run('harmless-census',False)
 start=original.index('  {\n    table: "engagement_translation_history",');end=original.index('  {\n',start+5)
 census.write_text(original[:start]+original[end:]);run('missing-history-probe',False,'covers every direct workspace-scoped table')
finally: census.write_text(original)
