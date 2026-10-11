"""Check exact browser decision retention and transport intent boundaries."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];path=root/'openplan/src/lib/gtfs/managed-client-decision.ts';original=path.read_text();out=Path(sys.argv[1]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
def change(before,after,count=1):
 assert original.count(before)==count,before
 return original.replace(before,after)
variants=[('baseline',original,None),('harmless',original+'\n// Harmless browser decision control.\n',None),
 ('scope',change('record.binding.installationId !== scope.installationId || record.binding.workspaceId !== scope.workspaceId || record.binding.actorId !== scope.actorId','false'),'tampered binding'),
 ('duplicate-history',change('new Set(record.decisions.map(item => item.commandId)).size !== record.decisions.length','false'),'duplicate command IDs'),
 ('saved-command',change('JSON.stringify(saved) !== JSON.stringify(decision)','false'),'changed reason or reviewed counts'),
 ('storage-ack',change('store.getItem(storageKey) !== text','false'),'silent browser storage'),
 ('read-size',change('if (raw.length > 65536)','if (false)'),'bounds history'),
 ('write-size',change('if (text.length > 65536)','if (false)'),'oversized serialized decisions'),
 ('history-limit',change('z.array(decisionSchema).max(100)','z.array(decisionSchema)'),'bounds history'),
 ('preserve-earlier',change('record.decisions.push(decision);','record.decisions = [decision];'),'new explicit review command'),
 ('basis-scope',change('decision.basis.versionId !== decision.versionId','false'),'different version or partial predecessor'),
 ('predecessor',change('decision.basis.previousVersionId === null\n  ? decision.basis.previousRouteCount !== null || decision.basis.previousStopCount !== null\n  : decision.basis.previousRouteCount === null || decision.basis.previousStopCount === null','false'),'different version or partial predecessor'),
 ('dismiss',change('record.decisions.filter(item => item.commandId !== command)','[]'),'dismisses browser history'),
 ('transport-scope',change('workspaceId: scope.workspaceId','workspaceId: scope.actorId',2),'derives exact routes'),
 ('transport-path',change('`/api/gtfs/submissions/${decision.requestId}/cancel`','`/api/gtfs/submissions/${decision.commandId}/cancel`'),'derives exact routes'),
 ('transport-schema',change('const decision = decisionSchema.parse(raw);','const decision = raw;'),'arbitrary paths'),
 ('restored',original,None)]
records=[]
try:
 for name,source,assertion in variants:
  path.write_text(source);report=out/f'{name}.json';r=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run','src/test/gtfs-managed-client-decision.test.ts','--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=root/'openplan',capture_output=True,text=True,timeout=20);(out/f'{name}.log').write_text(r.stdout+r.stderr)
  data=json.loads(report.read_text());failures=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if assertion:assert r.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert r.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:path.write_text(original)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'testSha256':hashlib.sha256((root/'openplan/src/test/gtfs-managed-client-decision.test.ts').read_bytes()).hexdigest(),'boundary':'Controlled browser storage and pure transport construction. No component order, real HTTP, SQL, rendered interaction or browser storage durability acceptance.'},indent=2)+'\n')
