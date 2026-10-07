import pathlib, subprocess, hashlib, json, os, sys
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan')
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/openplan-freeze-route-controls-v2');out.mkdir(exist_ok=False)
paths={'route':'src/app/api/land-use-plans/[planId]/freeze/route.ts','detail':'src/app/api/land-use-plans/[planId]/route.ts','store':'src/lib/land-use-plans/freeze-store.ts','command':'src/lib/land-use-plans/freeze-command.ts','recovery':'src/lib/land-use-plans/freeze-recovery.ts','control':'src/components/land-use-plans/land-use-plan-freeze-control.tsx','api':'src/lib/land-use-plans/api.ts','workbench':'src/components/land-use-plans/land-use-plan-workbench.tsx'}
tests={'route':'src/test/land-use-plan-freeze-route.test.ts','recovery':'src/test/land-use-plan-freeze-recovery.test.ts','control':'src/test/land-use-plan-freeze-control.test.tsx','api':'src/test/land-use-plan-frozen-rules-integration.test.ts','workbench':'src/test/land-use-plan-draft-custody.test.tsx'}
original={key:(app/path).read_bytes() for key,path in paths.items()};rows=[]
def run(name,key=None,old=None,new=None,test=None,target=None):
 try:
  if key:
   source=original[key].decode();assert source.count(old)==1,(name,source.count(old));(app/paths[key]).write_text(source.replace(old,new))
  elif name=='harmless':
   for key,path in paths.items():(app/path).write_bytes(original[key]+b'\n// Harmless freeze verification comment.\n')
  result=subprocess.run(['npm','exec','--','vitest','run',*([tests[test]] if test else tests.values()),'--maxWorkers=1','--reporter=json',f'--outputFile={out/name}.json'],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
  (out/(name+'.log')).write_text(result.stdout)
  report=json.loads((out/(name+'.json')).read_text())
  failed=[a['fullName'] for file in report['testResults'] for a in file['assertionResults'] if a['status']=='failed']
  matched=(result.returncode==0 and not failed) if not target else result.returncode!=0 and any(target in title for title in failed)
  rows.append({'case':name,'exitCode':result.returncode,'matched':matched,'expected':target or 'pass','failedTests':failed})
  print(name,matched,flush=True)
  if not matched:raise RuntimeError('Unexpected outcome '+name)
 finally:
  for key,path in paths.items():(app/path).write_bytes(original[key])
try:
 if len(sys.argv)<3:run('baseline');run('harmless')
 cases=[
 ('agent-source','route','"x-openplan-assistant-execution-source", ','','route','refuses agent header x-openplan-assistant-execution-source'),
 ('agent-input','route','"x-openplan-assistant-input-hash", ','','route','refuses agent header x-openplan-assistant-input-hash'),
 ('agent-approval','route',', "x-openplan-assistant-approval-id"','','route','refuses agent header x-openplan-assistant-approval-id'),
 ('origin','route','requireProviderBrowserOrigin(request);','void request;','route','refuses untrusted or changed scope'),
 ('scope-user','route','request.headers.get("x-openplan-expected-user") !== access.userId','false','route','refuses untrusted or changed scope'),
 ('scope-workspace','route','request.headers.get("x-openplan-expected-workspace") !== access.plan.workspace_id','false','route','refuses untrusted or changed scope'),
 ('write-permission','route','{ write: true }','{ write: false }','route','one scoped transaction'),
 ('raw-command','route','service, scope, command, commandText, frozen.snapshot','service, scope, command, JSON.stringify(command), frozen.snapshot','route','original request'),
 ('body-limit','route','request, 8192','request, 16384','route','bounds request bytes'),
 ('version-match','route','version.id !== command.versionId','false','route','changed or unknown working version'),
 ('revision-match','route','version.draft_revision !== command.expectedDraftRevision','false','route','changed or unknown working version'),
 ('descriptor-match','route','hashFrozenRecord(descriptor) !== command.expectedDescriptorHash','false','route','descriptor drift'),
 ('skip-discovery','route','if (await hasPlanFreezeCommand(service, scope, command.commandId))','if (false)','route','recovers without loading'),
 ('discovery-projection','store','.select("command_id")','.select("wrong_id")','route','one scoped transaction'),
 ('discovery-workspace','store','.eq("workspace_id", scope.workspaceId)','','route','one scoped transaction'),
 ('discovery-error','store','if (error || (data && data.command_id !== commandId))','if ((data && data.command_id !== commandId))','route','read failures unconfirmed'),
 ('snapshot-drift','store','hashFrozenRecord(snapshot.descriptorSnapshot) !== command.expectedDescriptorHash','false','route','descriptor drift'),
 ('snapshot-hash','store','(snapshot && result.data.contentHash !== hashFrozenRecord(snapshot))','false','route','mismatched receipts unconfirmed'),
 ('replay-marker','store','(!snapshot && !result.data.replayed)','false','route','requires a replayed receipt'),
 ('receipt-command','command','result.commandId === command.commandId','true','route','mismatched receipts unconfirmed'),
 ('receipt-version','command','result.versionId === command.versionId','true','route','mismatched receipts unconfirmed'),
 ('receipt-revision','command','result.draftRevision === command.expectedDraftRevision','true','route','mismatched receipts unconfirmed'),
 ('strict-command','command','expectedDraftRevision: revision, expectedDescriptorHash: hash,\n}).strict();','expectedDraftRevision: revision, expectedDescriptorHash: hash,\n});','route','rejects malformed commands'),
 ('retention-before-transport','recovery','if (storage.getItem(key) !== JSON.stringify(valid))','if (false)','recovery','before retention'),
 ('retention-readback','recovery','if (storage.getItem(key) !== raw) throw new Error("The freeze request could not be saved','if (false) throw new Error("The freeze request could not be saved','recovery','missing storage readback'),
 ('immutable-copy','recovery','if (existing !== null && existing !== raw)','if (false)','recovery','refuses overwrites'),
 ('exact-browser-bytes','recovery','body: valid.commandText','body: JSON.stringify(command)','recovery','retained exact bytes'),
 ('receipt-status','recovery','response.status !== (result.replayed ? 200 : 201)','false','recovery','malformed replies'),
 ('scope-validation','recovery','if (pending.actorId !== scope.actorId || pending.workspaceId !== scope.workspaceId || pending.planId !== scope.planId)','if (false)','recovery','isolates accounts'),
 ('acknowledge-custody','recovery','if (storage.getItem(key) !== raw) throw new Error("The freeze is confirmed, but its browser copy changed','if (false) throw new Error("The freeze is confirmed, but its browser copy changed','recovery','after changed retention'),
 ('copy-readback','recovery','storage.getItem(copyKey) !== record.raw || ','','recovery','unverified copy'),
 ('cleanup-readback','recovery','if (storage.getItem(key) !== null) throw new Error("The freeze is confirmed, but its browser copy could not be cleared','if (false) throw new Error("The freeze is confirmed, but its browser copy could not be cleared','recovery','failed cleanup'),
 ('scope-abort','control','controller.current?.abort();','void controller.current;','control','account changes during transport'),
 ('newer-version-retry','control','await sendPlanFreeze(localStorage, request, fetch, abort.signal);','await sendPlanFreeze(localStorage, { ...request, commandText: JSON.stringify({ ...JSON.parse(request.commandText), versionId: props.versionId }) }, fetch, abort.signal);','control','retries original bytes'),
 ('refresh-fence','control','busy || refreshRequired || !ready','busy || !ready','control','failed view refresh'),
 ('snapshot-revision','api','draftRevision: version.draft_revision','draftRevision: 0','api','exact descriptor'),
 ('working-revision-projection','api','applicable_requirement_keys, draft_revision, content_hash','applicable_requirement_keys, content_hash','api','working and detail projections'),
 ('detail-revision-projection','detail','applicable_requirement_keys, draft_revision, content_hash','applicable_requirement_keys, content_hash','api','working and detail projections'),
 ('detail-actor','detail','actorId: access.userId','actorId: access.plan.id','api','working and detail projections'),
 ('detail-descriptor-hash','detail','descriptorHash: hashFrozenRecord(descriptor)','descriptorHash: "a".repeat(64)','api','working and detail projections'),
 ('policy-order','api','.sort((left, right) => left.policy_node_id.localeCompare(right.policy_node_id))','.sort((left, right) => right.policy_node_id.localeCompare(left.policy_node_id))','api','sorts public policy links'),
 ('unsaved-freeze','workbench','disabled={busy || hasUnsavedContent || publicDraftBlockers.length > 0}','disabled={busy || publicDraftBlockers.length > 0}','workbench','blocks freezing until'),
 ]
 for case in cases:
  if len(sys.argv)<3 or case[0]==sys.argv[2]:run(*case)
finally:
 restored=all((app/path).read_bytes()==original[key] for key,path in paths.items())
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':restored,'sourceSha256':{paths[k]:hashlib.sha256(v).hexdigest() for k,v in original.items()}},indent=2)+'\n')
print(json.dumps({'controls':len(rows),'restored':restored}))
