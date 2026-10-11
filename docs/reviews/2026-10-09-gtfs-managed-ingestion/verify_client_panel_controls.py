"""Exercise planner progress, exact retries and manual decisions before acceptance."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];app=root/'openplan';out=Path(sys.argv[1]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
files={
 'controller':app/'src/lib/gtfs/managed-client-controller.ts',
 'transport':app/'src/lib/gtfs/managed-client-transport.ts',
 'config':app/'src/lib/gtfs/managed-ui-config.ts',
 'view':app/'src/components/data-hub/managed-gtfs-imports.tsx',
 'panel':app/'src/components/data-hub/gtfs-ingest-panel.tsx',
 'mount':app/'src/app/(app)/data-hub/page.tsx',
 'route':app/'src/app/api/gtfs/versions/[versionId]/status/route.ts',
}
original={key:path.read_bytes() for key,path in files.items()}
tests={key:f'src/test/{name}' for key,name in [('controller','gtfs-managed-client-controller.test.ts'),('panel','gtfs-managed-panel.test.tsx'),('config','gtfs-managed-ui-config.test.ts'),('route','gtfs-managed-version-status-route.test.ts'),('mount','gtfs-managed-panel-mount.test.ts')]}
test_original={name:(app/name).read_bytes() for name in tests.values()}
def edit(key,before,after,count=1):
 text=original[key].decode();assert text.count(before)==count,(key,before,text.count(before));return {key:text.replace(before,after).encode()}
variants=[('baseline',{},list(tests.values()),None)]
harmless={key:data+b'\n// Harmless planner progress control.\n' for key,data in original.items()}
harmless['mount']+=b'// <GtfsIngestPanel managed={gtfsManagedClientMode(workspaceId, fakeActor)} />\n'
variants.append(('harmless',harmless,list(tests.values()),None))
def add(name,key,before,after,test,assertion,count=1):variants.append((name,edit(key,before,after,count),[tests[test]],assertion))
add('retain-before-post','controller','const request = retainGtfsClientRequest(this.options.store, this.options.scope, intent);','const request = { requestId: crypto.randomUUID(), intent };','controller','retains identity before bytes leave')
add('decision-before-post','controller','const decision = retainGtfsClientDecision(this.options.store, this.options.scope, raw);','const decision = raw;','controller','retains a decision before dispatch')
add('viewer-writes','controller','if (this.options.readOnly) throw new Error("Viewers cannot submit or decide transit imports.");','','controller','allows viewer reads but refuses every write')
add('same-input-recovery','controller','`/api/gtfs/submissions/${requestId}`, { method: "POST", headers: { "content-type": "application/json", "x-openplan-gtfs-request-id": requestId }, body: JSON.stringify({ workspaceId: this.options.scope.workspaceId }) }','gtfsClientSubmission(job.request).path, gtfsClientSubmission(job.request).init','controller','recovers retained server custody')
add('retry-uuid','controller','gtfsClientSubmission(request, file)','gtfsClientSubmission({ ...request, requestId: crypto.randomUUID() }, file)','controller','retries the original intent and UUID')
add('terminal-recovery','controller','if (job.progress?.cancellation || ["ready", "failed", "cancelled"].includes(job.progress?.status?.state ?? ""))','if (false)','controller','does not recover terminal ready')
add('admitted-resupply','controller','if (job.progress?.status || job.progress?.cancellation)','if (false)','controller','refuses resupply for an already admitted')
add('progress-wire','controller','progress = readGtfsClientProgress(reply.body, { workspaceId: this.options.scope.workspaceId, requestId });','progress = reply.body as Progress;','controller','rejects status from another workspace')
add('progress-http','controller','if (!reply.ok) throw new Error(`Transit progress is unavailable (${reply.status}). Retain this request.`);','','controller','status from an HTTP refusal')
add('decision-http','controller','if (!reply.ok) throw new Error(`Decision acknowledgement is unavailable (${reply.status}). Retain this exact command.`);','','controller','valid-looking receipt in an HTTP refusal')
add('decision-receipt','controller','readGtfsClientDecisionReceipt(reply.body, this.options.scope.workspaceId, decision);','','controller','does not confirm a mismatched command')
add('older-progress','controller',' || this.reads.get(requestId) !== generation','','controller','older progress read overwrite')
add('inspect-version','controller','if (!progress.status || progress.status.feedId !== feedId || progress.status.versionId !== versionId)','if (false)','controller','opens workspace progress')
source=original['controller'].decode().replace('if (!this.ending.signal.aborted) this.options.changed(this.snapshot);','this.options.changed(this.snapshot);').replace('if (this.ending.signal.aborted || this.reads.get(requestId) !== generation) return;','if (this.reads.get(requestId) !== generation) return;')
variants.append(('disposed-scope',{'controller':source.encode()},[tests['controller']],'does not display late responses'))
add('automatic-decision','controller','this.loaded = true; this.emit(); void this.loop();','this.loaded = true; this.emit(); void this.loop(); for (const item of decisions) void this.decide(item.decision);','controller','does not automatically replay decisions')
add('receipt-command','transport','receipt.command !== decision.commandId','false','controller','rejects changed adoption command')
add('receipt-version','transport','receipt.version !== decision.versionId','false','controller','rejects changed adoption version')
add('receipt-basis','transport','JSON.stringify(receipt.basis) !== JSON.stringify(basis.parse(decision.basis))','false','controller','rejects changed adoption basis')
add('receipt-acceptance','transport','receipt.humanAcceptShrinkage !== decision.acceptMaterialShrinkage','false','controller','rejects changed adoption humanAcceptShrinkage')
add('receipt-evidence','transport','if (receipt.alreadyCurrent ? receipt.basis.previousVersionId !== decision.versionId : receipt.reviewAccepted !== true || receipt.adoptedAt === null)','if (false)','controller','requires adoption evidence')
add('receipt-material','transport','if (material && !decision.acceptMaterialShrinkage)','if (false)','controller','requires adoption evidence')
add('cancel-command','transport','progress.cancellation.command !== decision.commandId','false','controller','rejects another cancellation command')
add('response-bound','transport','if (length > 65536)','if (false)','controller','refuses oversized bodies')
add('response-deadline','transport',')), deadlineMs);',')), deadlineMs * 100);','controller','bounds stalled headers')
add('pre-cancel','transport','signal.throwIfAborted();','','controller','refuses oversized bodies')
add('normalized-path','transport',' || target.origin !== "http://openplan.invalid" || !target.pathname.startsWith("/api/gtfs/")','','controller','refuses oversized bodies')
add('material-ui','view','(review.materialShrinkage && !accept)','false','panel','requires explicit acceptance')
add('parser-review-ui','view','{review.basis.routeCount} routes and {review.basis.stopCount} stops','95 routes and 717 stops','panel','reviews parser counts')
add('url-door','panel','if (managed.enabled) { await submitManaged({ source: "url"','if (false) { await submitManaged({ source: "url"','panel','retained URL identity')
add('catalog-door','panel','if (managed.enabled) { await submitManaged({ source: "catalog"','if (false) { await submitManaged({ source: "catalog"','panel','retained ZIP, catalog and refresh')
add('refresh-door','panel','if (managed.enabled) { await submitManaged({ source: "refresh"','if (false) { await submitManaged({ source: "refresh"','panel','retained ZIP, catalog and refresh')
add('zip-door','panel','if (managed.enabled) {\n      await submitManaged({ source: "upload"','if (false) {\n      await submitManaged({ source: "upload"','panel','retained ZIP, catalog and refresh')
add('configuration-fallback','config','return { enabled: true, unavailable:','return { enabled: false, unavailable:','config','does not fall back')
add('configuration-private','config','return { enabled: true, scope };','return { enabled: true, scope, env };','config','exposes only installation')
add('mount-config','mount','managed={gtfsManagedClientMode(workspaceId, user.id)}','','mount','binds the visible panel')
add('mount-actor','mount','gtfsManagedClientMode(workspaceId, user.id)','gtfsManagedClientMode(workspaceId, workspaceId)','mount','binds the visible panel')
add('mount-scope-key','mount','<GtfsIngestPanel\n        key={`transit:${workspaceId}:${user.id}`}','<GtfsIngestPanel\n        key={workspaceId}','mount','binds the visible panel')
add('route-refusal','route','if ("response" in authorized) return authorized.response;','if (false && "response" in authorized) return authorized.response;','route','authorization refusal 401')
add('route-actor','route','actorId: authorized.actorId','actorId: params.data.versionId','route','current member without original-actor impersonation',2)
add('route-cancellation','route','const cancellation = await readGtfsRequestCancellation(authorized.service, { workspaceId: query.data.workspaceId, requestId: status.requestId, actorId: authorized.actorId }, request.signal);','const cancellation = null;','route','does not fabricate cancellation')
add('route-unavailable','route','}, { status: 503 });','}, { status: 200 });','route','legacy or unavailable progress')
add('missing-current-route_service_level_rows','panel','version.route_service_level_rows ?? "not recorded"','version.route_service_level_rows ?? 0','panel','does not convert missing current counts')
add('missing-current-stop_service_level_rows','panel','version.stop_service_level_rows ?? "not recorded"','version.stop_service_level_rows ?? 0','panel','does not convert missing current counts')
add('missing-current-route_count','panel','version.route_count ?? "not recorded"','version.route_count ?? 0','panel','does not convert missing current counts')
add('missing-current-stop_count','panel','version.stop_count ?? "not recorded"','version.stop_count ?? 0','panel','does not convert missing current counts')
add('missing-current-trip_count','panel','version.trip_count ?? "not recorded"','version.trip_count ?? 0','panel','does not convert missing current counts')
add('missing-history-route_service_level_rows','panel','historyVersion.route_service_level_rows ?? "not recorded"','historyVersion.route_service_level_rows ?? 0','panel','does not convert missing historical counts')
add('missing-history-stop_service_level_rows','panel','historyVersion.stop_service_level_rows ?? "not recorded"','historyVersion.stop_service_level_rows ?? 0','panel','does not convert missing historical counts')
variants.append(('restored',{},list(tests.values()),None));records=[]
try:
 for name,changes,selected,assertion in variants:
  for key,path in files.items():path.write_bytes(changes.get(key,original[key]))
  if name=='harmless':
   for relative,data in test_original.items():(app/relative).write_bytes(data+b'\n// Harmless test control.\n')
  else:
   for relative,data in test_original.items():(app/relative).write_bytes(data)
  report=out/f'{name}.json';result=subprocess.run([str(app/'node_modules/.bin/vitest'),'run',*selected,'--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=app,capture_output=True,text=True,timeout=45);(out/f'{name}.log').write_text(result.stdout+result.stderr)
  data=json.loads(report.read_text());failures=[test['fullName'] for suite in data['testResults'] for test in suite['assertionResults'] if test['status']=='failed']
  if assertion:assert result.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert result.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:
 for key,path in files.items():path.write_bytes(original[key])
 for relative,data in test_original.items():(app/relative).write_bytes(data)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':{str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in files.values()},'testSha256':{f'openplan/{relative}':hashlib.sha256(data).hexdigest() for relative,data in test_original.items()},'boundary':'Controlled component DOM, browser storage, mock HTTP and source mount inventory. Does not prove T3 navigation, screenshots, live application sessions, worker installation, complete restore, capacity, CI or practitioner acceptance.'},indent=2)+'\n')
