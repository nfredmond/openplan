import pathlib,subprocess,json,hashlib,os
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');out=pathlib.Path('/tmp/openplan-context-recovery-controls-supplement');out.mkdir(exist_ok=False)
p=app/'src/lib/land-use-plans/plan-context-recovery.ts';original=p.read_bytes();rows=[]
def run(name,old=None,new=None,target=None):
 try:
  if old:
   source=original.decode();assert source.count(old)==1,(name,source.count(old));p.write_text(source.replace(old,new))
  elif name=='harmless':p.write_bytes(original+b'\n// Harmless context recovery control.\n')
  r=subprocess.run(['npm','exec','--','vitest','run','src/test/land-use-plan-context-recovery.test.ts','--maxWorkers=1','--reporter=json',f'--outputFile={out/name}.json'],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
  (out/(name+'.log')).write_text(r.stdout);report=json.loads((out/(name+'.json')).read_text());failed=[a['fullName'] for f in report['testResults'] for a in f['assertionResults'] if a['status']=='failed']
  matched=r.returncode==0 if not target else r.returncode!=0 and any(target in title for title in failed)
  rows.append({'case':name,'exitCode':r.returncode,'matched':matched,'target':target,'failedTests':failed});print(name,matched,flush=True)
  if not matched:raise RuntimeError(name)
 finally:p.write_bytes(original)
try:
 run('baseline');run('harmless')
 for case in [
 ('abort-propagation','...(signal ? [signal] : [])','...[]','never starts an aborted request'),
 ('post-json-read-abort','await response.json()); active.throwIfAborted(); checkScope','await response.json()); checkScope','cancellation arrives during response parsing'),
 ('post-json-save-abort','await response.json()); active.throwIfAborted();\n  if (!matchingResult','await response.json());\n  if (!matchingResult','cancellation arrives during response parsing'),
 ('preserve-archived','|| record.archived ||','|| false ||','archive nesting'),
 ('preserve-copy-collision','if (storage.getItem(copyKey) !== null)','if (false)','identifier collisions'),
 ('preserve-newer-original','storage.getItem(copyKey) !== record.raw || storage.getItem(record.key) !== record.raw','storage.getItem(copyKey) !== record.raw','concurrently changed original'),
 ]:run(*case)
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':p.read_bytes()==original,'sourceSha256':hashlib.sha256(original).hexdigest()},indent=2)+'\n')
