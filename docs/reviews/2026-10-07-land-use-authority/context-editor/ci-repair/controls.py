import pathlib,subprocess,json,hashlib,os
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');out=pathlib.Path('/tmp/openplan-context-editor-ci-controls');out.mkdir(exist_ok=False)
paths={'inventory':'src/test/migrations/inventory.test.ts','columns':'src/test/a-column-nothing-reads-is-a-question.test.ts','panel':'src/components/jurisdiction-readiness/jurisdiction-readiness-panel.tsx','area':'src/components/land-use-plans/plan-study-area-fields.tsx','editor':'src/components/land-use-plans/land-use-plan-context-editor.tsx','workbench':'src/components/land-use-plans/land-use-plan-workbench.tsx','notes':'../CHANGELOG.md'}
original={k:(app/p).read_bytes() for k,p in paths.items()};rows=[]
tests=['src/test/migrations/inventory.test.ts','src/test/a-column-nothing-reads-is-a-question.test.ts','src/test/jurisdiction-readiness-panel.test.tsx','src/test/land-use-plan-context-draft.test.tsx','src/test/land-use-plan-context-editor.test.tsx','src/test/land-use-plan-draft-custody.test.tsx','src/test/migrations/release-ordering.test.ts','src/test/planner-copy-says-the-plain-thing.test.ts']
def run(name,key=None,old=None,new=None,test=None,target=None):
 try:
  if key:
   source=original[key].decode();assert source.count(old)==1,(name,source.count(old));(app/paths[key]).write_text(source.replace(old,new))
  elif name=='harmless':
   for key,path in paths.items():
    if key!='notes':(app/path).write_bytes(original[key]+b'\n// Harmless CI recovery control.\n')
  cmd=['npm','exec','--','vitest','run',*([test] if test else tests),'--maxWorkers=1','--reporter=json',f'--outputFile={out/name}.json']
  r=subprocess.run(cmd,cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=90)
  (out/(name+'.log')).write_text(r.stdout);report=json.loads((out/(name+'.json')).read_text());failed=[a['fullName'] for f in report['testResults'] for a in f['assertionResults'] if a['status']=='failed'];matched=r.returncode==0 if not target else r.returncode!=0 and any(target in title for title in failed)
  rows.append({'case':name,'exitCode':r.returncode,'matched':matched,'target':target,'failedTests':failed});print(name,matched,flush=True)
  if not matched:raise RuntimeError(name)
 finally:
  for key,path in paths.items():(app/path).write_bytes(original[key])
try:
 run('baseline');run('harmless')
 for case in [
 ('inventory-hides-new-relations','inventory','  relations: 296,','  relations: 294,',tests[0],'reads every relation'),
 ('undocumented-context-column','columns','column: "land_use_plan_context_commands.command_text"','column: "land_use_plan_context_commands.absent_control"',tests[1],'finds no unread column'),
 ('stale-column-exemption','columns','column: "land_use_plan_context_commands.command_sha256"','column: "land_use_plan_context_commands.command_id"',tests[1],'keeps the ratchet honest'),
 ('wrong-source-hash','panel','sha256:{source.sha256}','sha256:{"0".repeat(64)}',tests[2],'shows the exact selected cell'),
 ('wrong-source-path','panel','>{source.path}</span>','>Wrong source path</span>',tests[2],'shows the exact selected cell'),
 ('retained-area-not-cleared','area','geometryText: event.target.checked ? value.place.geometryText : ""','geometryText: value.place.geometryText',tests[3],'requires a new boundary choice'),
 ('uploaded-area-label-ignored','area','label: event.target.value','label: value.place.label',tests[4],'saves an uploaded study area'),
 ('typing-treated-saved','workbench','drafts: typeof update === "function" ? update(current.drafts) : update','drafts: typeof update === "function" ? update(current.drafts) : update, values: typeof update === "function" ? update(current.values) : update',tests[5],'blocks freezing until all edited content'),
 ('migration-note-missing','notes','`20261016000006_land_use_plan_retained_study_area.sql`','`missing-migration-control.sql`',tests[6],"Unreleased section names every migration"),
 ('jargon-reintroduced','editor','Save the area covered by this plan,','Record the study area covered by this plan,',tests[7],'uses no term from the ledger'),
 ]:run(*case)
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':all((app/path).read_bytes()==original[key] for key,path in paths.items()),'sourceSha256':{paths[key]:hashlib.sha256(v).hexdigest() for key,v in original.items()}},indent=2)+'\n')
