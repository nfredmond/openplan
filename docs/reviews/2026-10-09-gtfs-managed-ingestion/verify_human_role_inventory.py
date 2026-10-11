"""Prove recognized GTFS authorization is real and precedes both writes."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];out=Path(sys.argv[1]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
names=['src/test/workspace-write-role-gate-guard.test.ts','src/lib/gtfs/managed-human-route.ts','src/app/api/gtfs/submissions/[requestId]/cancel/route.ts','src/app/api/gtfs/versions/[versionId]/adopt/route.ts']
paths=[root/'openplan'/name for name in names];originals=[p.read_text() for p in paths]
def change(index,before,after):
 assert originals[index].count(before)==1,(index,before)
 sources=originals.copy();sources[index]=sources[index].replace(before,after);return sources
variants=[('baseline',originals,None),('harmless',[s+'\n// Harmless inventory control: await cancelGtfsRequest() before authorization.\n' for s in originals],None),
 ('unrecognized-gate',change(0,'  "authorizeGtfsHumanRoute",\n',''),'gates or explicitly exempts each one'),
 ('membership-only-helper',change(1,'isReadOnlyWorkspaceRole(membership.role)','false'),'recognizes only gates that actually consult a role'),
 ('cancel-read-mode',change(2,'authorizeGtfsHumanRoute(request, payload.data.workspaceId, true)','authorizeGtfsHumanRoute(request, payload.data.workspaceId, false)'),'GTFS human gate in write mode'),
 ('adopt-read-mode',change(3,'authorizeGtfsHumanRoute(request, payload.data.workspaceId, true)','authorizeGtfsHumanRoute(request, payload.data.workspaceId, false)'),'GTFS human gate in write mode'),
 ('cancel-refusal',change(2,'if ("response" in authorized) return authorized.response;','// Ignore authorization refusal.'),'GTFS human gate in write mode'),
 ('adopt-refusal',change(3,'if ("response" in authorized) return authorized.response;','// Ignore authorization refusal.'),'GTFS human gate in write mode'),
 ('restored',originals,None)]
records=[]
try:
 for name,sources,assertion in variants:
  for path,source in zip(paths,sources):path.write_text(source)
  report=out/f'{name}.json';r=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run','src/test/workspace-write-role-gate-guard.test.ts','--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=root/'openplan',capture_output=True,text=True,timeout=20);(out/f'{name}.log').write_text(r.stdout+r.stderr)
  data=json.loads(report.read_text());failures=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if assertion:assert r.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert r.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:
 for path,source in zip(paths,originals):path.write_text(source)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':{name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in zip(names,paths)},'boundary':'Source inventory from the actual nested package, helper role invocation, write-mode call and refusal ordering. Lexical inspection does not establish runtime authorization or live RLS; separate route and native role cases cover those boundaries.'},indent=2)+'\n')
