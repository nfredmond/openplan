import pathlib,subprocess,json,hashlib,os
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');out=pathlib.Path('/tmp/openplan-context-recovery-controls-v1');out.mkdir(exist_ok=False)
p=app/'src/lib/land-use-plans/plan-context-recovery.ts';original=p.read_bytes();rows=[]
def run(name,old=None,new=None,target=None):
 try:
  if old:
   source=original.decode();assert source.count(old)==1,(name,source.count(old));p.write_text(source.replace(old,new))
  elif name=='harmless':p.write_bytes(original+b'\n// Harmless context recovery control.\n')
  r=subprocess.run(['npm','exec','--','vitest','run','src/test/land-use-plan-context-recovery.test.ts','--maxWorkers=1','--reporter=json',f'--outputFile={out/name}.json'],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
  (out/(name+'.log')).write_text(r.stdout);report=json.loads((out/(name+'.json')).read_text());failed=[a['fullName'] for f in report['testResults'] for a in f['assertionResults'] if a['status']=='failed']
  matched=r.returncode==0 if not target else r.returncode!=0 and any(target in title for title in failed)
  rows.append({'case':name,'exitCode':r.returncode,'matched':matched,'target':target,'failedTests':failed});print(name,matched,flush=True)
  if not matched:raise RuntimeError(name)
 finally:p.write_bytes(original)
try:
 run('baseline');run('harmless')
 for case in [
 ('actor-scope','value.actorId !== scope.actorId','false','another actorId'),
 ('workspace-scope','value.workspaceId !== scope.workspaceId','false','another workspaceId'),
 ('plan-scope','value.planId !== scope.planId','false','another planId'),
 ('read-hash-state','(value.contextState.status === "legacy") === (value.contextHash === null)','true','unreadable current state'),
 ('read-normalization','if (!same(value, raw))','if (false)','unreadable current state'),
 ('read-status','if (response.status !== 200)','if (false)','read status'),
 ('command-byte-limit','new TextEncoder().encode(pending.commandText).length > 2_000_000','false','bounds command bytes'),
 ('copy-byte-limit','new TextEncoder().encode(raw).length > MAX_COPY_BYTES','false','bounds command bytes'),
 ('base-command-match','if (!same(command, expected))','if (false)','diverge from retained draft'),
 ('retained-required','pending.retainedPlace === null || pending.base.contextHash === null','false','diverge from retained draft'),
 ('capture-no-retained',' : pending.retainedPlace !== null',' : false','returned drawn'),
 ('key-match','if (!archived && recordKey(value) !== key)','if (false)','wrong-key records'),
 ('draft-previous','if (storage.getItem(key) !== previousRaw)','if (false)','owns mutable drafts'),
 ('draft-readback','if (storage.getItem(key) !== raw) throw new Error("The draft','if (false) throw new Error("The draft','failed draft storage readback'),
 ('restore-base','savedAt, base: source.base, draft: source.draft','savedAt, base: { ...source.base, contextHash: null }, draft: source.draft','owns mutable drafts'),
 ('current-base','&& same(draft.base, { versionId: current.versionId, contextHash: current.contextHash, descriptorId: current.descriptorId, planKindKey: current.planKindKey })','&& true','owns mutable drafts'),
 ('current-scope','same(scopeOf(draft), scopeOf(current)) &&','true &&','owns mutable drafts'),
 ('immutable-command','if (existing !== null && existing !== raw)','if (false)','duplicate command overwrites'),
 ('command-readback','if (storage.getItem(key) !== raw) throw new Error("The request','if (false) throw new Error("The request','missing pending readback'),
 ('only-pending-restored','if (value.kind !== "pending")','if (false)','preserves malformed originals'),
 ('receipt-command','result.commandId !== command.commandId','false','mismatched save replies'),
 ('receipt-version','result.versionId !== command.versionId','false','mismatched save replies'),
 ('receipt-actor','result.context.savedBy !== pending.actorId','false','mismatched save replies'),
 ('receipt-assessment','!same(result.context.assessment, command.assessment)','false','mismatched save replies'),
 ('receipt-retained-place','return same(place, pending.retainedPlace);','return true;','mismatched save replies'),
 ('receipt-captured-place','return same(place, placeOfRecordFromCapturedArea(command.place));','return true;','returned drawn'),
 ('receipt-resolved-source','place.source === TIGERWEB_GEOGRAPHY_SOURCE','true','returned place'),
 ('receipt-resolved-kind','place.kind === command.place.kind','true','returned place'),
 ('receipt-resolved-ref','place.ref === command.place.geoid','true','returned place'),
 ('receipt-resolved-label','place.label === command.place.label','true','returned place'),
 ('receipt-resolved-country','place.countryCode === "US"','true','returned place'),
 ('receipt-resolved-subdivision','place.subdivisionCode === subdivisionCodeFromTigerwebGeoid(command.place.kind, command.place.geoid)','true','returned place'),
 ('send-retention','if (storage.getItem(recordKey(pending)) !== JSON.stringify(pending))','if (false)','sending before retention'),
 ('send-exact-bytes','body: pending.commandText','body: JSON.stringify(JSON.parse(pending.commandText))','sends exact bytes'),
 ('send-scope-header','"x-openplan-expected-user": pending.actorId','"x-openplan-expected-user": pending.workspaceId','sends exact bytes'),
 ('reply-status','response.status !== (result.replayed ? 200 : 201)','false','mismatched save replies'),
 ('cleanup-receipt','if (!matchingResult(parseUnchanged(planContextSaveResultSchema, receipt), checked))','if (false)','matching receipt'),
 ('cleanup-exact-copy','if (storage.getItem(key) !== raw) throw new Error("The save is confirmed, but its browser copy changed','if (false) throw new Error("The save is confirmed, but its browser copy changed','sending before retention'),
 ('cleanup-readback','if (storage.getItem(key) !== null) throw new Error("The save is confirmed','if (false) throw new Error("The save is confirmed','failed cleanup'),
 ('preserve-scope','!record.key.startsWith(prefix(checked))','false','preservation without verified copy or scope'),
 ('preserve-original','|| storage.getItem(record.key) !== record.raw) throw new Error("This recovery copy changed','|| false) throw new Error("This recovery copy changed','preservation without verified copy or scope'),
 ('preserve-copy','storage.getItem(copyKey) !== record.raw || storage.getItem(record.key) !== record.raw','false','preservation without verified copy or scope'),
 ('preserve-clear-readback','if (storage.getItem(record.key) !== null)','if (false)','failed cleanup'),
 ]:run(*case)
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':p.read_bytes()==original,'sourceSha256':hashlib.sha256(original).hexdigest()},indent=2)+'\n')
