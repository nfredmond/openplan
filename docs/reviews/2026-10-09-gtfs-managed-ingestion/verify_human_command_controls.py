"""Check retained human-command and browser-request assertions with reversals."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];out=Path(sys.argv[1]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
human=root/'openplan/src/lib/gtfs/managed-human-command.ts';client=root/'openplan/src/lib/gtfs/managed-client.ts';originals={path:path.read_text() for path in [human,client]}
def change(path,before,after,count=1):
 assert originals[path].count(before)==count,before
 return originals[path].replace(before,after)
variants=[('baseline',None,None,None),('harmless-human',human,originals[human]+'\n// Harmless human command control.\n',None),('harmless-client',client,originals[client]+'\n// Harmless browser request control.\n',None),
 ('human-binding',human,change(human,'isDeepStrictEqual(record.binding, binding)','true'),'changed actorId'),
 ('human-retention',human,change(human,'signal.throwIfAborted(); await writeConnectorJournal(options.directory, record); signal.throwIfAborted();','signal.throwIfAborted();'),'retains the exact cancel command'),
 ('human-replay',human,change(human,'if (record.receipt !== null) verifyReceipt(record.receipt, scope, command);','if (record.receipt !== null) return verifyReceipt(record.receipt, scope, command);'),'rechecks SQL on replay'),
 ('human-saved-receipt',human,change(human,'if (record.receipt !== null) verifyReceipt(record.receipt, scope, command);','// Skip saved receipt validation.'),'tampered saved receipt'),
 ('human-receipt-scope',human,change(human,'value.command === command.commandId && value.version === scope.versionId','true',2),'cancellation receipt with changed command'),
 ('human-receipt-stability',human,change(human,'record.receipt === null || isDeepStrictEqual(receipt, record.receipt)','true'),'changed acknowledged receipt'),
 ('human-closure',human,change(human,'recorded: z.literal(true)','recorded: z.boolean()'),'closure receipt that was not recorded'),
 ('human-adoption-acceptance',human,change(human,'value.humanAcceptShrinkage === command.acceptMaterialShrinkage','true'),'adoption receipt whose basis or acceptance differs'),
 ('human-adoption-evidence',human,change(human,'value.alreadyCurrent ? value.basis.previousVersionId === scope.versionId : value.reviewAccepted === true && value.adoptedAt !== null','true'),'actual adoption evidence'),
 ('human-shrinkage',human,change(human,'(!collapse(binding.command.basis) || binding.command.acceptMaterialShrinkage)','true'),'acceptance for material shrinkage'),
 ('human-review-scope',human,change(human,'binding.command.basis.versionId === binding.scope.versionId','true'),'matching version review'),
 ('human-predecessor',human,change(human,'basis.previousVersionId === null ? basis.previousRouteCount === null && basis.previousStopCount === null\n   : basis.previousRouteCount !== null && basis.previousStopCount !== null','true'),'missing predecessor counts'),
 ('human-masked-collapse',human,change(human,'collapse(review.basis) === review.materialShrinkage','true'),'masked material reduction'),
 ('human-reviewed-version',human,change(human,'review.basis.versionId === scope.versionId','true'),'reviewed different version'),
 ('human-current',human,change(human,'!review.isCurrent || review.basis.previousVersionId === scope.versionId','true'),'current-state claim'),
 ('human-review-schema',human,change(human,'isCurrent: z.boolean() }).strict()','isCurrent: z.boolean() })'),'unknown private review fields'),
 ('human-target',human,change(human,'["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.hash && !target.search','true'),'invalid transport target'),
 ('human-deadline',human,change(human,'ending.abort(new Error("GTFS human command acknowledgement is unavailable"))','undefined'),'uncooperative transport'),
 ('human-lock',human,change(human,'const lock = await acquireConnectorLock(options.directory), ending = new AbortController()','const lock = { signal: new AbortController().signal, release: async () => {} }, ending = new AbortController()'),'concurrent command dispatch'),
 ('client-binding',client,change(client,'records.binding.installationId !== scope.installationId || records.binding.workspaceId !== scope.workspaceId || records.binding.actorId !== scope.actorId','false'),'tampered saved installationId'),
 ('client-current-workspace',client,change(client,'item.intent.workspaceId !== records.binding.workspaceId','false'),'intent in another workspace'),
 ('client-duplicate',client,change(client,'records.items.some(saved => saved.requestId === item.requestId)','false'),'duplicate request UUIDs'),
 ('client-storage-ack',client,change(client,'store.getItem(key) !== text','false'),'storage actually kept'),
 ('client-size',client,change(client,'if (raw.length > 65536)','if (false)'),'oversized retained records'),
 ('client-history-bound',client,change(client,'z.array(itemSchema).max(100)','z.array(itemSchema)'),'too many tracked requests'),
 ('client-request-header',client,change(client,'"x-openplan-gtfs-request-id": item.requestId','"x-openplan-gtfs-request-id": intent.workspaceId'),'exact intent and request identity'),
 ('client-dismiss',client,change(client,'records.items.filter(item => item.requestId !== request)','[]'),'dismisses one browser request'),
 ('client-transport-schema',client,change(client,'const item = itemSchema.parse(request), intent = item.intent;','const item = request, intent = item.intent;'),'arbitrary paths and action overrides'),
 ('restored',None,None,None)]
records=[]
try:
 for name,path,source,assertion in variants:
  for owned,text in originals.items():owned.write_text(text)
  if path:path.write_text(source)
  report=out/f'{name}.json';result=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run','src/test/gtfs-managed-human-command.test.ts','src/test/gtfs-managed-client.test.ts','--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=root/'openplan',capture_output=True,text=True,timeout=30);(out/f'{name}.log').write_text(result.stdout+result.stderr)
  data=json.loads(report.read_text());failures=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if assertion:assert result.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert result.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:
 for path,text in originals.items():path.write_text(text)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in originals},'testSha256':{name:hashlib.sha256((root/'openplan/src/test'/name).read_bytes()).hexdigest() for name in ['gtfs-managed-client.test.ts','gtfs-managed-human-command.test.ts']},'boundary':'Actual private file locks and journals, controlled fetch transport and browser storage. No live PostgreSQL, physical Storage custody, application authorization, rendered journey or release acceptance.'},indent=2)+'\n')
