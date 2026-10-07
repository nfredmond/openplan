import pathlib,subprocess,json,hashlib,os
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');out=pathlib.Path('/tmp/openplan-context-editor-custody-controls');out.mkdir(exist_ok=False)
paths={'editor':'src/components/land-use-plans/land-use-plan-context-editor.tsx','workbench':'src/components/land-use-plans/land-use-plan-workbench.tsx','recovery':'src/lib/land-use-plans/plan-context-recovery.ts'}
original={key:(app/path).read_bytes() for key,path in paths.items()};rows=[]
def run(name,key=None,old=None,new=None,target=None):
 try:
  if key:
   source=original[key].decode();assert source.count(old)==1,(name,source.count(old));(app/paths[key]).write_text(source.replace(old,new))
  elif name=='harmless':
   for key,path in paths.items():(app/path).write_bytes(original[key]+b'\n// Harmless mounted context control.\n')
  r=subprocess.run(['npm','exec','--','vitest','run','src/test/land-use-plan-draft-custody.test.tsx','--maxWorkers=1','--reporter=json',f'--outputFile={out/name}.json'],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
  (out/(name+'.log')).write_text(r.stdout);report=json.loads((out/(name+'.json')).read_text());failed=[a['fullName'] for f in report['testResults'] for a in f['assertionResults'] if a['status']=='failed']
  matched=r.returncode==0 if not target else r.returncode!=0 and any(target in title for title in failed)
  rows.append({'case':name,'exitCode':r.returncode,'matched':matched,'target':target,'failedTests':failed});print(name,matched,flush=True)
  if not matched:raise RuntimeError(name)
 finally:
  for key,path in paths.items():(app/path).write_bytes(original[key])
try:
 run('baseline');run('harmless')
 for case in [
 ('section-freeze-gate','workbench','unsavedSections || unsavedDocuments || unsavedUrls || unsavedContent || contextBlocked','contextBlocked','blocks freezing until all edited content'),
 ('erase-other-drafts','workbench','current.scope === scope && Object.hasOwn(current.drafts, id)','false && Object.hasOwn(current.drafts, id)','keeps another section draft'),
 ('refused-save-treated-saved','workbench','if (!response.ok) throw new Error([payload.error','if (false) throw new Error([payload.error','never acknowledges the only dirty field'),
 ('read-failure-treated-empty','workbench','if (!response.ok) throw new Error(payload.error ?? "Failed to load plan");','if (!response.ok) return;','saved operation cannot refresh'),
 ('acknowledge-current-not-submitted','workbench','drafts: typeof update === "function" ? update(current.drafts) : update','drafts: typeof update === "function" ? update(current.drafts) : update, values: typeof update === "function" ? update(current.values) : update','deliberate reversion'),
 ('clean-policy-not-acknowledged','workbench','acknowledgeContent(nodeId, draft, draftScope);','void draftScope;','server-normalized title'),
 ]:run(*case)
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':all((app/path).read_bytes()==original[key] for key,path in paths.items()),'sourceSha256':{paths[key]:hashlib.sha256(value).hexdigest() for key,value in original.items()}},indent=2)+'\n')
