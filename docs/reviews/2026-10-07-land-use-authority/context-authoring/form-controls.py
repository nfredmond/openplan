import pathlib,subprocess,json,hashlib,os
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');out=pathlib.Path('/tmp/openplan-context-authoring-controls-v2');out.mkdir(exist_ok=False)
paths={'store':'src/lib/land-use-plans/plan-context-store.ts','draft':'src/lib/land-use-plans/plan-context-draft.ts','fields':'src/components/land-use-plans/plan-authority-fields.tsx','area':'src/components/land-use-plans/plan-study-area-fields.tsx'}
original={key:(app/path).read_bytes() for key,path in paths.items()};rows=[]
tests=['src/test/land-use-plan-context-route.test.ts','src/test/land-use-plan-context-draft.test.tsx']
def run(name,key=None,old=None,new=None,target=None):
 try:
  if key:
   source=original[key].decode();assert source.count(old)==1,(name,source.count(old));(app/paths[key]).write_text(source.replace(old,new))
  elif name=='harmless':
   for key,path in paths.items():(app/path).write_bytes(original[key]+b'\n// Harmless context authoring control.\n')
  r=subprocess.run(['npm','exec','--','vitest','run',*tests,'--maxWorkers=1','--reporter=json',f'--outputFile={out/name}.json'],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
  (out/(name+'.log')).write_text(r.stdout);report=json.loads((out/(name+'.json')).read_text());failed=[a['fullName'] for f in report['testResults'] for a in f['assertionResults'] if a['status']=='failed']
  matched=r.returncode==0 if not target else r.returncode!=0 and any(target in title for title in failed)
  rows.append({'case':name,'exitCode':r.returncode,'matched':matched,'target':target,'failedTests':failed});print(name,matched,flush=True)
  if not matched:raise RuntimeError(name)
 finally:
  for key,path in paths.items():(app/path).write_bytes(original[key])
try:
 run('baseline');run('harmless')
 for case in [
 ('retained-hash','store','current.contextHash !== command.expectedContextHash','false','hash precondition changed'),
 ('retained-version','store','current.versionId !== command.versionId','false','version precondition changed'),
 ('retained-descriptor','store','current.descriptorId !== command.descriptorId','false','descriptor precondition changed'),
 ('retained-kind','store','current.planKindKey !== command.planKindKey','false','kind precondition changed'),
 ('retained-applicability','store','if (planApplicabilityBlocker(command.assessment, descriptor))','if (false)','requires an applicability assessment'),
 ('retained-place-copy','store','...current.contextState.context, assessment: command.assessment','...current.contextState.context, place: { ...current.contextState.context.place, label: "Substituted" }, assessment: command.assessment','authority-only edit'),
 ('no-default-jurisdiction','draft','jurisdictionUnknown: true, country: "", subdivision: ""','jurisdictionUnknown: false, country: "US", subdivision: "CA"','inherited labels'),
 ('saved-area-mode','draft','place: { mode: "retained", label: context.place.label','place: { mode: "uploaded", label: context.place.label','without resending resolver'),
 ('ignore-jurisdiction-unknown','draft','authority.jurisdictionUnknown ? null','false ? null','does not assign jurisdiction'),
 ('drawn-identity','draft','mode: "drawn", kind: null, geoid: ""','mode: "drawn", kind: draft.place.kind, geoid: draft.place.geoid','changes a study place'),
 ('place-borrows-old-label','draft','label: place.label ?? ""','label: place.label ?? draft.place.label','missing place labels'),
 ('erase-authority-on-place','draft','return { ...draft, place: place ?','return { ...draft, authorities: [emptyPlanAuthority()], place: place ?','changes a study place'),
 ('dangling-selected-authority','fields','authorityIds: value.applicability.authorityIds.filter(id => id !== authority.id)','authorityIds: value.applicability.authorityIds','without dangling'),
 ('trim-typing','fields','updateAuthority(authority.id, { sourceText: event.target.value })','updateAuthority(authority.id, { sourceText: event.target.value.trim() })','incomplete source text'),
 ('reuse-inherited-geometry','area','geometryText: event.target.checked ? value.place.geometryText : ""','geometryText: value.place.geometryText','requires a new boundary choice'),
 ('late-file-overwrite','area',' || read !== reads.current','','delayed file read'),
 ('uploaded-identity','area','mode: "uploaded", kind: null, geoid: ""','mode: "place", kind: "county", geoid: "00000"','keeps uploads distinct'),
 ('skip-geometry-validation','area','studyAreaGeometrySchema.parse(candidate)','candidate','refuses invalid coordinates'),
 ('ignore-disabled','area','if (unavailable.current) return;','void unavailable.current;','pending upload or map callback'),
 ('body-type-label','fields','suggestedBodyTypes.find(type => type.label === event.target.value)?.value ?? event.target.value','event.target.value','shows body type names'),
 ('file-size','area','file.size > 2_000_000','false','bounds boundary files'),
 ]:run(*case)
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':all((app/path).read_bytes()==original[key] for key,path in paths.items()),'sourceSha256':{paths[key]:hashlib.sha256(value).hexdigest() for key,value in original.items()}},indent=2)+'\n')
