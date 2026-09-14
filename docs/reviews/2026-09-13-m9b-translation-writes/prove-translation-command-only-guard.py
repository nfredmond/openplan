"""The legacy policy exception must never restore direct translation grants."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
source=app/'supabase/migrations/20261014000017_engagement_translation_command_activation.sql'
test=app/'src/test/a-policy-without-a-grant-is-a-locked-door.test.ts'
original=source.read_text();test_original=test.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('translation-command-only-controls-'+time.strftime('%Y%m%dT%H%M%S'));private.mkdir(parents=True)
cases=[('baseline',source,original,None),('harmless-migration',source,original+'\n-- Harmless grant control.\n',None),('harmless-test',test,test_original+'\n// Harmless guard control.\n',None)]
for role in ['authenticated','anon']:
 for verb in ['INSERT','UPDATE','DELETE']:
  cases.append((role+'-'+verb.lower(),source,original+f'\nGRANT {verb} ON public.engagement_content_translations TO {role};\n','retired translation row policies never authorize direct client writes'))
cases.append(('deny-staff-read',source,original+'\nREVOKE SELECT ON public.engagement_content_translations FROM authenticated;\n','retired translation row policies never authorize direct client writes'))
cases.append(('omit-retired-policy-name',test,test_original.replace('  engagement_content_translations_writer_insert: "INSERT",\n',''),'grants every command its permissive policies promise a signed-in user'))
results=[]
try:
 for name,path,body,expected in cases:
  assert source.read_text()==original and test.read_text()==test_original;path.write_text(body)
  output=private/(name+'.json')
  command=['node','node_modules/vitest/vitest.mjs','run',str(test.relative_to(app)),'--reporter=json','--outputFile='+str(output)]
  if expected:command+=['-t',re.escape(expected)]
  try:run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=45)
  finally:path.write_text(original if path==source else test_original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  report=json.loads(output.read_text());failed=[a['fullName'] for s in report['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  correct=run.returncode!=0 and any(expected in f for f in failed) if expected else run.returncode==0 and report['numPassedTests']==6
  results.append({'case':name,'outcome':'killed' if run.returncode else 'survived','expectedFailure':expected,'expectedOutcome':correct})
  (review/'translation-command-only-controls.json').write_text(json.dumps({'migrationSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256(test_original.encode()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Static migration grant composition. Fault SQL is parsed only, never applied to a database. Actual command and direct-write boundaries are separately covered by activation SQL controls and full isolated RLS.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],correct,flush=True);assert correct,failed
finally:assert source.read_text()==original and test.read_text()==test_original
