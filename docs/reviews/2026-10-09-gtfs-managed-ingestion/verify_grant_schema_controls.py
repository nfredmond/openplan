"""Run schema audit controls, restoring owned source after each mutation."""
import hashlib,json,os,subprocess,time
from pathlib import Path
b=Path(__file__).parent;app=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009/openplan');source=app/'src/test/migrations/grant-inventory.ts';original=source.read_text();records=[]
env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=768','VITEST_MAX_WORKERS':'1','PYTHONDONTWRITEBYTECODE':'1'}
variants=[('baseline',original,None),('harmless-comment',original.replace('Private schemas keep their own privileges.','Private schemas have separate privileges.'),None),('private-blanket-crosses-public',original.replace('    if (!schemas.includes("public")) return null;','    void schemas;'),'ignores private blanket statements'),('private-named-enters-public',original.replace('  if (normalized.includes(".") && !normalized.startsWith("public.")) return null;','  // Deliberately removed schema filter.'),'keeps public and unqualified named tables'),('public-blanket-is-lost',original.replace('    if (!schemas.includes("public")) return null;','    if (!schemas.includes("public")) return null;\n    return null;'),'replays private revokes')]
try:
 for label,text,expected in variants:
  source.write_text(text);report=b/('grant-schema-'+label+'.json');start=time.monotonic()
  with (b/('grant-schema-'+label+'.log')).open('w') as log:r=subprocess.run(['npm','test','--','--maxWorkers=1','src/test/migrations/grant-inventory-schemas.test.ts','src/test/a-policy-without-a-grant-is-a-locked-door.test.ts','src/test/migrations/inventory.test.ts','--reporter=json','--outputFile='+str(report)],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
  data=json.loads(report.read_text());failed=[a['fullName'] for f in data['testResults'] for a in f['assertionResults'] if a['status']=='failed']
  if expected:assert r.returncode!=0 and any(expected in x for x in failed),(label,failed)
  else:assert r.returncode==0 and not failed,(label,failed)
  if label=='public-blanket-is-lost':
   failures=[a for f in data['testResults'] for a in f['assertionResults'] if 'replays private revokes' in a['fullName'] and a['status']=='failed']
   assert any("expected 'table' to be 'none'" in msg for a in failures for msg in a['failureMessages']),failures
  records.append({'case':label,'expected':('broken' if expected else 'positive'),'exitCode':r.returncode,'failedTests':failed,'seconds':round(time.monotonic()-start,3)});print({'case':label,'exitCode':r.returncode,'failedCount':len(failed)},flush=True)
  source.write_text(original)
finally:source.write_text(original)
report=b/'grant-schema-restored.json'
with (b/'grant-schema-restored.log').open('w') as log:r=subprocess.run(['npm','test','--','--maxWorkers=1','src/test/migrations/grant-inventory-schemas.test.ts','src/test/a-policy-without-a-grant-is-a-locked-door.test.ts','src/test/migrations/inventory.test.ts','--reporter=json','--outputFile='+str(report)],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
assert r.returncode==0
records.append({'case':'restored','exitCode':r.returncode})
(b/'grant-schema-controls.json').write_text(json.dumps({'records':records,'restoredSourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'limits':['Static audit of public table privileges only. Private table privileges, search_path changes, dynamically computed schema names and live row filtering require separate checks.','Targeted source mutations exercise the actual parser and regression tests. All source edits restored in finally.']},indent=2)+'\n')
