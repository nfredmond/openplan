"""Exercise browser storage helpers with native crypto and controlled storage faults."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent; app=review.parents[2]/'openplan'
source=app/'src/lib/engagement/translation-resolution-recovery.ts'; test='src/test/translation-resolution-recovery.test.ts'
original=source.read_text(); private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('resolution-storage-controls-'+str(time.time_ns()));private.mkdir(mode=0o700)
cases=[('baseline',original,None),('harmless',original+'\n// Harmless storage control.\n',None)]
def mutation(name,old,new,expected):
 assert original.count(old)==1,(name,original.count(old));cases.append((name,original.replace(old,new),expected))
mutation('lose-page-copy','if (pageCopy !== undefined && !copies.includes(pageCopy)) copies.push(pageCopy);','/* Page copy omitted. */','preserves a page-held copy when storage has lost the source')
mutation('drop-second-copy','if (pageCopy !== undefined && !copies.includes(pageCopy))','if (pageCopy !== undefined && copies.length === 0)','freezes both exact copies including whitespace and damaged strings')
mutation('duplicate-identical-copy','!copies.includes(pageCopy)','true','deduplicates only identical copies')
mutation('copy-comparison','JSON.parse(intent.copyJson) === raw','true','freezes both exact copies including whitespace and damaged strings')
mutation('foreign-key','throw new Error("Recovery copy belongs to another scope");','return key.slice(-36);','refuses unowned or malformed source key')
mutation('malformed-resolution','uuid.parse(parts[1]);','/* Invalid resolution ID accepted. */','refuses unowned or malformed source key')
mutation('source-scope','if (parsed?.success && (parsed.data.workspaceId !== scope.workspaceId || pendingGenerationKey(parsed.data) !== key))','if (false)','refuses a readable generation from another workspace')
mutation('source-collision','value.sourceKey === resolutionPendingPrefix(value) + value.intents[0].requestId + ":" + value.intents[0].resolutionId','false','rejects incoherent bundle source-collision')
mutation('request-inventory','value.intents.some(intent => intent.requestId !== requestId)','false','rejects incoherent bundle request')
mutation('resolution-inventory','new Set(value.intents.map(intent => intent.resolutionId)).size !== value.intents.length','false','rejects incoherent bundle resolution')
mutation('copy-inventory','new Set(value.intents.map(intent => intent.copyJson)).size !== value.intents.length','false','rejects incoherent bundle copy')
mutation('overwrite-pending','if (old !== null && !same(pendingResolutionSchema.parse(JSON.parse(old)), value))','if (false)','retains exact intent for retry and refuses overwriting another retained intent')
mutation('missing-intent-readback','if (storage.getItem(key) !== raw)','if (false)','refuses unretained dispatch intent on readback failure')
mutation('read-unbound-key','if (pendingResolutionKey(value) !== key || !same({ userId: value.userId, workspaceId: value.workspaceId, campaignId: value.campaignId }, scope))','if (false)','reads only current scope and retains unreadable and mismatched bundles')
mutation('missing-payload-checksum','await sha(packet.payloadText) !== packet.payloadSha256','false','rejects invalid payloadSha256 before touching originals')
mutation('missing-result-checksum','await sha(packet.resultText) !== packet.resultSha256','false','rejects invalid resultSha256 before touching originals')
mutation('missing-receipt-binding','return readTranslationGenerationResolution(packet, { campaignId: value.campaignId, workspaceId: value.workspaceId, actorId: value.userId }, value.intents[index]);','return packet;','rejects a correctly hashed receipt from another intent')
mutation('missing-receipt-inventory','if (packets.length !== value.intents.length)','if (false)','requires every copy receipt before creating an archive')
mutation('missing-archive-verification','for (let index = 0; index < packets.length; index++) await verifyBrowserResolution(packets[index], value, index);','/* Receipts unchecked. */','rejects invalid payloadSha256 before touching originals')
mutation('missing-pending-binding','if (pending === null || !same(pendingResolutionSchema.parse(JSON.parse(pending)), value))','if (false)','refuses a different pending bundle before archiving')
mutation('replace-archive','if (old !== null && old !== archiveRaw)','if (false)','refuses replacing an existing different archive')
mutation('missing-archive-write','storage.setItem(archive, archiveRaw);','/* Archive not written. */','archives verified receipts and exact copies before retiring both source and intent')
mutation('missing-archive-readback','storage.getItem(archive) !== archiveRaw','false','preserves originals when archive write has readback failure')
mutation('missing-pending-recheck',' || storage.getItem(key) !== pending','','preserves originals when archive write has pending-changed failure')
mutation('missing-first-lifecycle','assertCurrent();\n  const key','/* Stale scope. */\n  const key','aborts stale lifecycle at checkpoint 1 before retiring originals')
mutation('missing-second-lifecycle','assertCurrent();\n  const currentSource','/* Stale scope. */\n  const currentSource','aborts stale lifecycle at checkpoint 2 before retiring originals')
mutation('delete-changed-source','currentSource !== null && value.intents.some(intent => JSON.parse(intent.copyJson) === currentSource)','currentSource !== null','preserves changed or absent original different')
mutation('missing-source-retirement-check','if (storage.getItem(value.sourceKey) !== null)','if (false)','retries after failed source retirement using replay receipts and the existing archive')
mutation('missing-pending-retirement-check','if (storage.getItem(key) !== null)','if (false)','retries after failed pending retirement using replay receipts and the existing archive')
mutation('erase-changed-pending','if (storage.getItem(key) !== pending)','if (false)','preserves a pending bundle changed during source retirement')
mutation('unstable-replay-archive','receipts: packets.map(packet => ({ ...packet, replayed: false }))','receipts: packets','retries after failed pending retirement using replay receipts and the existing archive')
results=[]
try:
 for name,body,expected in cases:
  assert source.read_text()==original
  target=private/(name+'.json');source.write_text(body)
  args=['npm','exec','--','vitest','run',test,'--reporter=json','--outputFile='+str(target)]
  if expected: args+=['-t',re.escape(expected)]
  try: run=subprocess.run(args,cwd=app,text=True,capture_output=True,timeout=35)
  finally: source.write_text(original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  report=json.loads(target.read_text());failed=[a['fullName'] for s in report['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==38 if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct})
  print(name,results[-1]['outcome'],flush=True);assert correct,(name,failed)
finally:
 assert source.read_text()==original
 (review/'resolution-recovery-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256((app/test).read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Native WebCrypto and actual recovery helper with synthetic receipts and in-memory Storage fault injection. No React lifecycle, browser navigation, cross-tab scheduling, server/database join, quota capacity measurement or end-to-end acceptance.'},indent=2)+'\n')
