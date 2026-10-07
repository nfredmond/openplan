import pathlib,subprocess,hashlib,json
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');out=pathlib.Path('/tmp/openplan-plan-context-controls-v2');out.mkdir(exist_ok=False)
names={'context':'src/lib/land-use-plans/plan-context.ts','server':'src/lib/land-use-plans/plan-context-server.ts','geo':'src/lib/geographies/study-area-capture.ts','descriptor':'src/lib/land-use-plans/descriptor-snapshot.ts'}
original={k:(app/p).read_bytes() for k,p in names.items()};rows=[]
def run(name,key=None,old=None,new=None,target=None):
 try:
  if key:
   source=original[key].decode();assert source.count(old)==1,(name,source.count(old));(app/names[key]).write_text(source.replace(old,new))
  else:
   for k,p in names.items():(app/p).write_bytes(original[k]+b'\n// Harmless verification comment.\n')
  r=subprocess.run(['npx','vitest','run','src/test/land-use-plan-context.test.ts','--maxWorkers=1'],cwd=app,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  (out/(name+'.log')).write_text(r.stdout)
  matched=(r.returncode==0) if not key else (r.returncode!=0 and 'AssertionError' in r.stdout and target in r.stdout)
  rows.append({'case':name,'exitCode':r.returncode,'matched':matched,'expected':'pass' if not key else 'targeted failure','target':target})
  if not matched:raise RuntimeError('Unexpected outcome '+name)
 finally:
  for k,p in names.items():(app/p).write_bytes(original[k])
try:
 run('harmless')
 for args in [
  ('unresolved-is-assessed','context',"return \"Assess this plan's responsible authority and sources before choosing a configured checklist.\";",'return null;','keeps unresolved'),
  ('country-scope','context','authority.jurisdiction?.country !== coverage.country','false','unsupported authority country'),
  ('subdivision-scope','context','authority.jurisdiction?.subdivision !== coverage.subdivision','false','unsupported authority subdivision'),
  ('authority-kind','context','!kinds.includes(authority.kind)','false','unsupported authority kind'),
  ('authority-sources','context','!authority.sourceUrls.length','false','unsupported authority sources'),
  ('first-authority-only','context','selected.some(authority =>','selected.slice(0,1).some(authority =>','checks every selected authority'),
  ('duplicate-authorities','context','ids.size !== value.authorities.length','false','rejects duplicate and dangling'),
  ('dangling-authority','context','selected.some(id => !ids.has(id))','false','rejects duplicate and dangling'),
  ('assessment-sources','context','sourceUrls: sourceUrls.min(1)','sourceUrls: sourceUrls','refuses source-free assessment'),
  ('unsafe-source','context','protocol: /^https?$/','protocol: /.*/','refuses source-free assessment'),
  ('missing-is-legacy','context','value === null','value == null','keeps stored absence'),
  ('invent-unresolved-identity','context','if (["drawn", "uploaded_file"].includes(place.source)','if (false','keeps stored absence'),
  ('client-attribution','server','  assessment: planAuthorityAssessmentSchema,','  assessment: planAuthorityAssessmentSchema, savedBy: z.string().optional(),','invented client attribution'),
  ('actor-substitution','server','savedBy: userId','savedBy: "aa000000-0000-4000-8000-000000000009"','geometry without inventing'),
  ('wrong-resolver-kind','server',' || boundary.kind !== command.place.kind','','wrong-kind resolver result'),
  ('wrong-resolver-id','server',' || boundary.geoid !== command.place.geoid','','wrong-id resolver result'),
  ('skip-applicability','server','if (blocker)','if (false)','refuses unsupported authority before'),
  ('geometry-validation','geo','value => validateCorridorGeometry(value).ok','() => true','rejects projected coordinates'),
  ('lose-upload-source','geo','capture.mode === "drawn" ? DRAWN_PLACE_SOURCE : UPLOADED_PLACE_SOURCE','DRAWN_PLACE_SOURCE','keeps uploaded geometry'),
  ('lose-resolver-extent','geo','bbox: structuredClone(boundary.bbox)','bbox: bboxOfGeometry(boundary.geojson)','retains the server boundary and extent'),
  ('drop-frozen-scope','descriptor','authorityKinds: z.array(text).min(1).optional(),','authorityKinds: z.array(text).min(0).optional(),','retains the adapter authority scope'),
 ]:run(*args)
finally:
 restored=all((app/p).read_bytes()==original[k] for k,p in names.items())
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':restored,'sourceSha256':{names[k]:hashlib.sha256(v).hexdigest() for k,v in original.items()}},indent=2)+'\n')
print(json.dumps({'controls':len(rows),'restored':restored}))
