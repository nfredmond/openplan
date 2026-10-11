"""Check that browser progress cannot promote missing or mismatched evidence."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];path=root/'openplan/src/lib/gtfs/managed-progress.ts';original=path.read_text();out=Path(sys.argv[1]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
def change(before,after,count=1):
 assert original.count(before)==count,before
 return original.replace(before,after)
variants=[('baseline',original,None),('harmless',original+'\n// Harmless progress control.\n',None),
 ('outer-request',change('body.requestId === expected.requestId','true'),'different outer request'),
 ('public-scope',change('status.requestId === expected.requestId && status.workspaceId === expected.workspaceId','true'),'changed public status requestId'),
 ('private-status',change('submitterAccessUnavailable: z.boolean() }).strict()','submitterAccessUnavailable: z.boolean() })'),'private fields'),
 ('ready-stage',change('status.stage === "ready" && status.archiveConfirmed','status.archiveConfirmed'),'completed stage and archive'),
 ('ready-archive',change('status.stage === "ready" && status.archiveConfirmed','status.stage === "ready"'),'completed stage and archive'),
 ('failure-code',change('status.stage === "failed" && status.failureCode !== null','status.stage === "failed"'),'failure code'),
 ('current-ready',change('(!status.isCurrent || status.state === "ready")','true'),'queued as current'),
 ('lease',change('status.state === "running" ? status.attempts > 0 && status.leaseUntil !== null : status.leaseUntil === null','true'),'ownership evidence'),
 ('cancel-scope',change('cancellation.requestId === expected.requestId && cancellation.workspaceId === expected.workspaceId','true'),'changed cancellation requestId'),
 ('cancel-closure',change('cancellation.versionCancellation === null || (cancellation.versionCancellation.version === cancellation.versionId && cancellation.versionCancellation.command === cancellation.command)','true'),'another version closure'),
 ('cancel-stage',change('status === null || (status.state === "cancelled" && status.versionId === cancellation.versionId)','true'),'conflicting cancellation'),
 ('uuid',change('z.string().uuid().transform(value => value.toLowerCase())','z.string().transform(value => value.toLowerCase())'),'invalid local scope'),
 ('managed',change('managed: z.literal(true)','managed: z.boolean()',2),'unavailable response bodies'),
 ('review-scope',change('basis.feedId === expected.feedId && basis.versionId === expected.versionId','true'),'different reviewed feedId'),
 ('review-predecessor',change('basis.previousVersionId === null ? basis.previousRouteCount === null && basis.previousStopCount === null : basis.previousRouteCount !== null && basis.previousStopCount !== null','true'),'complete predecessor counts'),
 ('review-material',change('material === review.materialShrinkage','true'),'concealed shrinkage'),
 ('review-current',change('(!review.isCurrent || basis.previousVersionId === basis.versionId)','true'),'invented current version'),
 ('restored',original,None)]
records=[]
try:
 for name,source,assertion in variants:
  path.write_text(source);report=out/f'{name}.json';r=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run','src/test/gtfs-managed-progress.test.ts','--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=root/'openplan',capture_output=True,text=True,timeout=20);(out/f'{name}.log').write_text(r.stdout+r.stderr)
  data=json.loads(report.read_text());failures=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if assertion:assert r.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert r.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:path.write_text(original)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'testSha256':hashlib.sha256((root/'openplan/src/test/gtfs-managed-progress.test.ts').read_bytes()).hexdigest(),'boundary':'Controlled wire values and pure presentation guards. No component rendering, live HTTP, current database state, real browser navigation or planner acceptance.'},indent=2)+'\n')
