"""Mechanical integration guard controls; no migrations are applied by this script."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
paths={'route':app/'src/app/api/engagement/campaigns/[campaignId]/translations/route.ts',
 'caller':app/'src/test/every-api-route-has-a-caller.test.ts','columns':app/'src/test/a-column-nothing-reads-is-a-question.test.ts',
 'inventory':app/'src/test/migrations/inventory.test.ts','migration':app/'supabase/migrations/20261014000013_engagement_translation_generation.sql'}
original={k:p.read_text() for k,p in paths.items()}
tests=['src/test/engagement-translation-retired-route.test.ts','src/test/every-api-route-audits.test.ts','src/test/every-api-route-has-a-caller.test.ts','src/test/a-column-nothing-reads-is-a-question.test.ts','src/test/migrations/inventory.test.ts']
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('translation-integration-controls-'+time.strftime('%Y%m%dT%H%M%S'));private.mkdir(parents=True)
cases=[('baseline','route',original['route'],None)]
for key in paths:cases.append(('harmless-'+key,key,original[key]+('\n-- Harmless integration control.\n' if key=='migration' else '\n// Harmless integration control.\n'),None))
def mutate(name,key,old,new,expected):
 assert original[key].count(old)==1,(name,original[key].count(old));cases.append((name,key,original[key].replace(old,new),expected))
mutate('revive-excused-endpoint','route','status: 410, headers:','status: 200, headers:','keeps the excused translation endpoint retired')
line=next(line for line in original['caller'].splitlines(True) if line.startswith('  "api/engagement/campaigns/[campaignId]/translations":'))
mutate('omit-retired-caller-registration','caller',line,'','finds no API route that nothing in the product calls')
for line in original['columns'].splitlines(True):
 if line.startswith('  { column: "engagement_translation_generation_'):
  name=re.search(r'column: "([^"]+)"',line).group(1)
  mutate('omit-sql-reader-'+name,'columns',line,'','finds no unread column that is not accounted for')
cases.append(('stale-response-checksum-exception','columns',original['columns'].replace('}> = [','}> = [\n  { column: "engagement_response_write_receipts.payload_sha256", category: "WRITE_ONLY", reason: "SYNTHETIC stale exception for a name now present elsewhere in source code; this must fail the name-based ratchet." },',1),'keeps the ratchet honest'))
cases.append(('unaccounted-table','migration',original['migration']+'\nCREATE TABLE public.synthetic_translation_inventory_control (id uuid);\n','reads every relation the migrations declare'))
mutate('disable-generation-output-rls','migration','ALTER TABLE public.engagement_translation_generation_outputs ENABLE ROW LEVEL SECURITY;','ALTER TABLE public.engagement_translation_generation_outputs DISABLE ROW LEVEL SECURITY;','reads every relation the migrations declare')
results=[];count=None
try:
 for name,key,body,expected in cases:
  assert all(p.read_text()==original[k] for k,p in paths.items());paths[key].write_text(body);out=private/(name+'.json')
  command=['node','--env-file-if-exists=.env.local','node_modules/vitest/vitest.mjs','run',*tests,'--reporter=json','--outputFile='+str(out)]
  if expected:command+=['-t',re.escape(expected)]
  try:run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=60)
  finally:paths[key].write_text(original[key])
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(out.read_text())
  failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  if count is None:count=report['numPassedTests'];assert count>50
  correct=run.returncode==0 and report['numPassedTests']==count if expected is None else run.returncode!=0 and any(expected in name for name in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
  (review/'translation-integration-guard-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in original.items()},'testCount':count,'privateEvidence':str(private),'results':results,'limits':'Executable retired endpoint checks plus static caller, column-name and migration inventories. SQL column reasons are traced to actual SQL but these controls do not execute those readers. Global identifier matching cannot distinguish equal column names on different tables. Database privacy, worker and browser evidence remain separate.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True);assert correct,(name,failed)
finally:assert all(p.read_text()==original[k] for k,p in paths.items())
