"""Prove request reservation, recovery, status and manual-route boundaries."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];out=Path(sys.argv[1]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
names=['src/lib/gtfs/managed-request-cancellation.ts','src/lib/gtfs/managed-human-route.ts','src/lib/gtfs/managed-submission-recovery.ts','src/lib/gtfs/managed-route.ts','src/app/api/gtfs/submissions/[requestId]/route.ts','src/app/api/gtfs/submissions/[requestId]/cancel/route.ts','src/app/api/gtfs/versions/[versionId]/adopt/route.ts','src/app/api/gtfs/versions/[versionId]/review/route.ts']
paths=[root/'openplan'/name for name in names];originals=[path.read_text() for path in paths]
def change(index,before,after,count=1):
 assert originals[index].count(before)==count,(index,before)
 sources=originals.copy();sources[index]=sources[index].replace(before,after);return sources
variants=[('baseline',originals,None),('harmless',[source+'\n// Harmless request cancellation control.\n' for source in originals],None),
 ('request-binding',change(0,'isDeepStrictEqual(record.binding, binding)','true'),'changed retained actorId'),
 ('request-before-dispatch',change(0,'signal.throwIfAborted(); await writeConnectorJournal(options.directory, record); signal.throwIfAborted();','signal.throwIfAborted();'),'retains exact request command before dispatch'),
 ('request-replay',change(0,'if (record.receipt !== null) verifyGtfsRequestCancellation(record.receipt, binding.scope, binding.command.commandId);','if (record.receipt !== null) return verifyGtfsRequestCancellation(record.receipt, binding.scope, binding.command.commandId);'),'rechecks SQL on replay'),
 ('request-saved-receipt',change(0,'if (record.receipt !== null) verifyGtfsRequestCancellation(record.receipt, binding.scope, binding.command.commandId);','// Skip saved cancellation receipt.'),'tampered retained receipt'),
 ('request-receipt-scope',change(0,'receipt.workspaceId === scope.workspaceId && receipt.requestId === scope.requestId && (commandId === undefined || receipt.command === commandId)','true'),'changed command receipt'),
 ('request-terminal-scope',change(0,'receipt.versionCancellation === null || (receipt.versionId !== null && receipt.versionCancellation.version === receipt.versionId\n  && receipt.versionCancellation.command === receipt.command)','true'),'changed nested terminal command'),
 ('request-closure',change(0,'recorded: z.literal(true)','recorded: z.boolean()'),'unrecorded terminal closure'),
 ('request-stable-receipt',change(0,'record.receipt === null || isDeepStrictEqual(receipt, record.receipt)','true'),'changed acknowledged cancellation time'),
 ('request-private-fields',change(0,'versionCancellation: terminalSchema.nullable() }).strict()','versionCancellation: terminalSchema.nullable() })'),'unknown private fields'),
 ('request-read-scope',change(0,'p_request: scope.requestId','p_request: scope.workspaceId'),'reads scoped membership'),
 ('request-error',change(0,'!result.error','true'),'unavailable read'),
 ('request-null',change(0,'raw === null ? null : verifyGtfsRequestCancellation(raw, scope)','verifyGtfsRequestCancellation(raw, scope)'),'preserves a null reservation'),
 ('request-target',change(0,'["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.hash && !target.search','true'),'invalid target'),
 ('request-deadline',change(0,'ending.abort(new Error("GTFS request cancellation acknowledgement is unavailable"))','undefined'),'uncooperative acknowledgement'),
 ('request-lock',change(0,'const lock = await acquireConnectorLock(options.directory), ending = new AbortController()','const lock = { signal: new AbortController().signal, release: async () => {} }, ending = new AbortController()'),'concurrent command dispatch'),
 ('manual-only',change(1,'writing && readAssistantExecutionSource(request) !== "manual"','false'),'refuses Planner Agent cancel'),
 ('session',[source.replace('if (!user)','if (false)').replace('user.id','(user?.id ?? workspaceId)') if index==1 else source for index,source in enumerate(originals)],'refuses unauthenticated cancel'),
 ('writer',change(1,'writing && isReadOnlyWorkspaceRole(membership.role)','false'),'refuses viewer cancel'),
 ('installation-enabled',change(1,'if (!managedGtfsEnabled())','if (false)'),'installation has not enabled'),
 ('human-directory-command',change(1,'join(`${options.directory}-human`, command)','join(`${options.directory}-human`, options.installationId)'),'command files beside'),
 ('recovery-cancel-read',change(2,'await readGtfsRequestCancellation(options.service, { workspaceId: saved.binding.workspaceId, requestId, actorId: saved.binding.actorId }, signal)','null'),'retains early cancellation'),
 ('recovery-cancel-marker',change(2,'await writeConnectorJournal(markerPath, { binding: saved.binding, cancellation });','// Lose cancelled history.'),'retains early cancellation'),
 ('recovery-cancel-binding',change(2,'isDeepStrictEqual(cancelled.binding, saved.binding)','true'),'changed cancelled history binding'),
 ('recovery-cancel-scope',change(2,'verifyGtfsRequestCancellation(cancelled.cancellation, saved.binding);','// Skip cancelled marker scope.'),'changed cancelled history requestId'),
 ('route-cancel-check',change(3,'if (cancellation !== null) return','if (false) return'),'reports a cancelled request'),
 ('route-cancel-read',change(3,'await readGtfsRequestCancellation(options.service, { workspaceId: options.workspaceId, actorId: options.actorId, requestId }, request.signal)','null'),'cancellation lookup errors unconfirmed'),
 ('status-cancel-fields',change(4,'requestId: params.data.requestId, status, cancellation,','requestId: params.data.requestId, status,'),'committed early cancellation'),
 ('status-cancel-detail',change(4,'status === null && cancellation === null','status === null'),'committed early cancellation'),
 ('status-cancel-read',change(4,'await readGtfsRequestCancellation(service, scope, request.signal)','null'),'lookup is unavailable'),
 ('cancel-session-actor',change(5,'actorId: authorized.actorId','actorId: payload.data.workspaceId'),'binds cancellation to session actor'),
 ('cancel-path',change(5,'requestId: params.data.requestId, actorId:','requestId: payload.data.workspaceId, actorId:'),'binds cancellation to session actor'),
 ('cancel-payload',change(5,'reason: z.string().trim().min(1).max(2000) }).strict()','reason: z.string().trim().min(1).max(2000) })'),'caller actor overrides'),
 ('cancel-body-bound',change(5,'BODY_LIMITS.smallJson','BODY_LIMITS.normalJson'),'bounds cancel bodies'),
 ('adopt-body-bound',change(6,'BODY_LIMITS.smallJson','BODY_LIMITS.normalJson'),'bounds adopt bodies'),
 ('adopt-operation',change(6,' || payload.data.command.operation !== "adopt"',''),'unknown adoption operations'),
 ('adopt-session-actor',change(6,'actorId: authorized.actorId','actorId: payload.data.workspaceId'),'retains exact reviewed adoption'),
 ('adopt-path-version',change(6,'versionId: params.data.versionId, actorId:','versionId: payload.data.workspaceId, actorId:'),'retains exact reviewed adoption'),
 ('review-session-actor',change(7,'actorId: authorized.actorId','actorId: query.data.workspaceId'),'reads parser counts'),
 ('review-query',change(7,'z.object({ workspaceId: id }).strict()','z.object({ workspaceId: id })'),'extra review queries'),
 ('restored',originals,None)]
tests=['src/test/gtfs-managed-request-cancellation.test.ts','src/test/gtfs-managed-human-routes.test.ts','src/test/gtfs-submission-recovery.test.ts','src/test/gtfs-managed-route-submission.test.ts','src/test/gtfs-managed-enrollment-routes.test.ts']
records=[]
try:
 for name,sources,assertion in variants:
  for path,source in zip(paths,sources):path.write_text(source)
  report=out/f'{name}.json';result=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run',*tests,'--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=root/'openplan',capture_output=True,text=True,timeout=30);(out/f'{name}.log').write_text(result.stdout+result.stderr)
  data=json.loads(report.read_text());failures=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if assertion:assert result.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert result.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:
 for path,source in zip(paths,originals):path.write_text(source)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':{str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},'testSha256':{name:hashlib.sha256((root/'openplan'/name).read_bytes()).hexdigest() for name in tests},'boundary':'Private files and controlled service transport, route sessions and query projections. No actual route HTTP authorization, live SQL/RLS, complete worker service installation, Storage custody or browser acceptance.'},indent=2)+'\n')
