"""Prove managed route enrollment, request status and source-scope guards."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False)
names=['src/lib/gtfs/managed-route.ts','src/lib/gtfs/managed-source.ts','src/lib/gtfs/managed-worker-service.ts','src/app/api/gtfs/feeds/route.ts','src/app/api/gtfs/feeds/upload/route.ts','src/app/api/gtfs/feeds/[feedId]/refresh/route.ts','src/app/api/gtfs/submissions/[requestId]/route.ts']
paths=[root/'openplan'/name for name in names];originals=[p.read_text() for p in paths]
def change(index,before,after,count=1):
 assert originals[index].count(before)==count,(index,before)
 sources=originals.copy();sources[index]=sources[index].replace(before,after);return sources
variants=[('baseline',originals,None),('harmless',[s+'\n// Harmless managed enrollment control.\n' for s in originals],None),
 ('agent-refusal',change(0,'readAssistantExecutionSource(request) !== "manual"','false'),'refuses agent submissions'),
 ('request-uuid',change(0,'if (!identity.success) return','if (false) return'),'requires a retained valid request UUID'),
 ('route-workspace',change(0,'...configuration, ...options, requestId,','...configuration, ...options, workspaceId: configuration.installationId, requestId,'),'reports queued processing'),
 ('request-header',change(0,'request.headers.get(GTFS_REQUEST_ID_HEADER)','options.workspaceId'),'reports queued processing'),
 ('ready-tier',change(0,'result.status.state === "ready"','false'),'reports ready as a reviewable version'),
 ('queue-http',change(0,'["queued", "running", "awaiting_archive"].includes(result.status.state)','false'),'reports queued processing'),
 ('outcome-privacy',change(0,'error: "Import submission is unconfirmed", requestId,','error: error instanceof Error ? error.message : "Unknown", requestId,'),'retains request identity when admission outcome is unavailable'),
 ('source-refusal',change(0,'error instanceof GtfsSourceResolutionError','false'),'preserves an identified source refusal'),
 ('membership-role',change(1,'["owner", "admin", "member"].includes','["owner", "admin", "member", "viewer"].includes'),'unavailable writer authority'),
 ('membership-projection',change(1,'.select("role")','.select("*")'),'role projection'),
 ('membership-scope',change(1,'.eq("workspace_id", saved.binding.workspaceId)','.eq("workspace_id", saved.binding.actorId)'),'role projection'),
 ('membership-actor',change(1,'.eq("user_id", saved.binding.actorId)','.eq("user_id", saved.binding.workspaceId)'),'role projection'),
 ('membership-ack',change(1,'Promise.race([query, unavailable])','Promise.resolve(query)'),'cancelled membership acknowledgement'),
 ('harmless-membership-pre-check',change(1,'  signal.throwIfAborted();','  // SDK signal still prevents I/O.'),None),
 ('membership-pre-cancel',change(1,'const ending = new AbortController(), bounded = AbortSignal.any([signal, ending.signal]);','const ending = new AbortController(), bounded = ending.signal;'),'pre-cancelled membership read'),
 ('feed-projection',change(1,'.select("id, agency_name")','.select("*")',2),'explicit workspace and projection'),
 ('feed-workspace',change(1,'.eq("workspace_id", intent.workspaceId)','.eq("workspace_id", intent.feedId ?? "changed")',4),'explicit workspace and projection'),
 ('feed-failure',change(1,'if (failure) throw new GtfsSourceResolutionError(failure.status, failure.body);','if (false) throw new GtfsSourceResolutionError(failure!.status, failure!.body);',3),'failed feed lookup'),
 ('catalog-identity',change(1,'catalogSourceId = resolved.entry.catalogId','catalogSourceId = intent.catalogId'),'takes catalog source identity'),
 ('upload-hash',change(1,'uploadSha256: archive.sha256','uploadSha256: "b".repeat(64)'),'binds uploaded bytes'),
 ('upload-feed-scope',change(1,'if (row.id !== intent.feedId) throw','if (false) throw'),'missing or mismatched replacement feed'),
 ('refresh-scope',change(1,'row.id !== intent.feedId || row.workspace_id !== intent.workspaceId','false'),'unavailable or mismatched refresh source'),
 ('refresh-feed-identity',change(1,'return { feedId: intent.feedId, source:','return { feedId: resolved.feedId, source:'),'refreshes the selected feed'),
 ('intent-overrides',change(1,').strict()',')',9),'caller source overrides'),
 ('status-endpoint',change(2,'"read_gtfs_submission_status", { p_workspace:','"read_gtfs_ingest_status", { p_workspace:'),'exact authenticated request'),
 ('status-request',change(2,'result.requestId === expected.requestId','true'),'reply for another requestId'),
 ('status-workspace',change(2,'workspaceId: expected.workspaceId, versionId: statusSchema.parse(raw).versionId','workspaceId: statusSchema.parse(raw).workspaceId, versionId: statusSchema.parse(raw).versionId'),'reply for another workspaceId'),
 ('url-enrollment',change(3,'if (managedGtfsEnabled())','if (false)'),'enrolls url only after'),
 ('upload-enrollment',change(4,'if (managedGtfsEnabled())','if (false)'),'enrolls upload only after'),
 ('refresh-enrollment',change(5,'if (managedGtfsEnabled())','if (false)'),'enrolls refresh only after'),
 ('url-writer',change(3,'if (isReadOnlyWorkspaceRole(membership.role))','if (false)'),'refuses viewer url'),
 ('upload-writer',change(4,'if (isReadOnlyWorkspaceRole(membership.role))','if (false)'),'refuses viewer upload'),
 ('refresh-writer',change(5,'if (isReadOnlyWorkspaceRole(membership.role))','if (false)'),'refuses viewer refresh'),
 ('recovery-writer',change(6,'if (isReadOnlyWorkspaceRole(membership.role))','if (false)'),'refuses viewer recover'),
 ('recovery-header',change(6,'request.headers.get(GTFS_REQUEST_ID_HEADER)?.toLowerCase() !== params.data.requestId','false'),'header identifies another request'),
 ('recovery-binding',change(6,'saved.binding.requestId !== params.data.requestId || saved.binding.workspaceId !== payload.data.workspaceId || saved.binding.actorId !== user.id\n      || saved.binding.installationId !== configuration.installationId || saved.binding.target !== configuration.target','false'),'retained recovery with changed'),
 ('recovery-enabled',change(6,'if (!managedGtfsEnabled())','if (false)'),'disabled managed recovery'),
 ('status-member',change(6,'if (!membership.ok) return membershipResponse(membership.kind);','if (false) return membershipResponse("error");',2),'does not read status for a nonmember'),
 ('status-actor',change(6,'...params.data, actorId: user.id','...params.data, actorId: query.data.workspaceId'),'viewer to read unconfirmed status'),
 ('refresh-adoption',change(5,'payload.data.adoptDespiteCollapse !== undefined','false'),'unknown refresh adoption'),
 ('empty-upload',change(4,'bodyRead.byteLength === 0','false'),'empty uploaded bytes'),
 ('restored',originals,None)]
tests=['src/test/gtfs-managed-enrollment-routes.test.ts','src/test/gtfs-managed-route-submission.test.ts','src/test/gtfs-submission-status.test.ts','src/test/gtfs-managed-source.test.ts']
variants = [(name, [source.replace('  signal.throwIfAborted();','  // Ignore cancellation before SDK I/O.') if index == 1 else source for index,source in enumerate(sources)] if name == 'membership-pre-cancel' else sources, assertion) for name,sources,assertion in variants]
records=[]
try:
 for name,sources,assertion in variants:
  for path,source in zip(paths,sources):path.write_text(source)
  report=out/f'{name}.json';result=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run',*tests,'--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=root/'openplan',capture_output=True,text=True,timeout=25);(out/f'{name}.log').write_text(result.stdout+result.stderr)
  data=json.loads(report.read_text());failures=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if assertion:assert result.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert result.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:
 for path,source in zip(paths,originals):path.write_text(source)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':{str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},'testSha256':{name:hashlib.sha256((root/'openplan'/name).read_bytes()).hexdigest() for name in tests}},indent=2)+'\n')
