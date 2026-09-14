"""Source inventory detects missing resolution policy and RLS activation."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
source=app/'supabase/migrations/20261014000019_engagement_translation_generation_resolution.sql';original=source.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('resolution-inventory-'+str(time.time_ns()));private.mkdir(mode=0o700)
start=original.index('CREATE POLICY translation_generation_resolution_owner');end=original.index('CREATE TRIGGER translation_generation_resolution_immutable',start)
rls='ALTER TABLE public.engagement_translation_generation_resolutions ENABLE ROW LEVEL SECURITY;';assert original.count(rls)==1
cases=[('baseline',original,None),('harmless',original+'\n-- Harmless inventory control.\n',None),('missing-policy',original[:start]+original[end:],'counts what the database actually has'),('missing-rls',original.replace(rls,''),'reads every relation the migrations declare')]
results=[]
try:
 for name,body,expected in cases:
  assert source.read_text()==original;source.write_text(body);target=private/(name+'.json')
  try:
   run=subprocess.run(['npm','exec','--','vitest','run','src/test/migrations/inventory.test.ts','-t',re.escape(expected) if expected else 'counts what the database actually has|reads every relation the migrations declare','--reporter=json','--outputFile='+str(target)],cwd=app,text=True,capture_output=True,timeout=30)
  finally:source.write_text(original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(target.read_text());failed=[a['fullName'] for s in report['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==2 if expected is None else run.returncode!=0 and any(expected in test for test in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct});print(name,results[-1]['outcome'],flush=True);assert correct,(name,failed)
finally:
 assert source.read_text()==original
 (review/'generation-resolution-inventory-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256((app/'src/test/migrations/inventory.test.ts').read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Source policy/schema inventory; temporary source changes restored without applying any SQL. The installed live suite independently verifies actual database behavior.'},indent=2)+'\n')
