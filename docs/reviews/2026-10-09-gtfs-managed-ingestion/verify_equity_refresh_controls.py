"""Exercise the reproduced adopted-feed refresh defect and late-read guards."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];app=root/'openplan';out=Path(sys.argv[1]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
files={'view':app/'src/components/data-hub/managed-gtfs-imports.tsx','equity':app/'src/components/data-hub/title-vi-service-equity-panel.tsx','mount':app/'src/app/(app)/data-hub/page.tsx'}
tests={'view':'src/test/gtfs-managed-panel.test.tsx','equity':'src/test/gtfs-equity-refresh.test.tsx','mount':'src/test/gtfs-managed-panel-mount.test.ts'}
original={key:path.read_bytes() for key,path in files.items()};test_original={key:(app/path).read_bytes() for key,path in tests.items()}
variants=[('baseline',{},list(tests.values()),None),('harmless',{},list(tests.values()),None)]
def add(name,key,before,after,test,assertion,count=1):
 source=original[key].decode();assert source.count(before)==count,(name,source.count(before));variants.append((name,{key:source.replace(before,after).encode()},[tests[test]],assertion))
add('no-server-refresh','view','registryChanged(); router.refresh();','registryChanged();','view','refreshes dependent server reads')
add('unstable-server-scope','view','}, [installationId, workspaceId, actorId, readOnly]);','}, [scope, readOnly]);','view','refreshes dependent server reads')
add('detached-deferred-read','equity','if (active) void loadEquity(serviceDay);','void loadEquity(serviceDay);','equity','does not start a deferred equity read')
add('no-adopted-feed-dependency','equity','[loadEquity, serviceDay, feedVersionRevision, invalidateEquity]','[loadEquity, serviceDay, invalidateEquity]','equity','rereads a fresh server read')
add('retain-old-comparison','equity','      setEquity(null);','      /* old result retained */','equity','rereads a fresh server read')
add('cached-equity-read','equity','{ cache: "no-store" }','{}','equity','rereads a fresh server read')
add('old-success-overwrite','equity','const body = (await response.json()) as EquityBody;\n        if (generation !== equityGeneration.current) return;','const body = (await response.json()) as EquityBody;','equity','discards old-success')
add('old-http-error-overwrite','equity','const body = (await response.json().catch(() => ({}))) as { error?: string; hint?: string };\n          if (generation !== equityGeneration.current) return;','const body = (await response.json().catch(() => ({}))) as { error?: string; hint?: string };','equity','discards old-http-error')
add('old-network-error-overwrite','equity','} catch {\n        if (generation !== equityGeneration.current) return;','} catch {','equity','discards old-network-error')
add('unchanged-bounded-list','mount','read: randomUUID(),','read: \"unchanged\",','mount','projects adopted version identity')
add('missing-version-projection','mount','id, feed_id, workspace_id, service_start_date','feed_id, workspace_id, service_start_date','mount','projects adopted version identity')
add('feed-id-for-version','mount','.map(version => version.id).sort()','.map(version => version.feed_id).sort()','mount','projects adopted version identity')
add('missing-equity-revision','mount','feedVersionRevision={transitFeedRevision}','','mount','projects adopted version identity')
add('missing-equity-account-key','mount','<TitleViServiceEquityPanel\n        key={`equity:${workspaceId}:${user.id}`}','<TitleViServiceEquityPanel','mount','projects adopted version identity')
add('colliding-sibling-keys','mount','key={`equity:${workspaceId}:${user.id}`}','key={`transit:${workspaceId}:${user.id}`}','mount','keeps sibling transit and equity identity distinct')
variants.append(('restored',{},list(tests.values()),None));records=[]
try:
 for name,changes,selected,assertion in variants:
  for key,path in files.items():path.write_bytes(changes.get(key,original[key])+(b'\n// Harmless refresh comment.\n' if name=='harmless' else b''))
  for key,path in tests.items():(app/path).write_bytes(test_original[key]+(b'\n// Harmless test comment.\n' if name=='harmless' else b''))
  report=out/(name+'.json');result=subprocess.run([str(app/'node_modules/.bin/vitest'),'run',*selected,'--maxWorkers=1','--reporter=json','--outputFile='+str(report)],cwd=app,capture_output=True,text=True,timeout=40);(out/(name+'.log')).write_text(result.stdout+result.stderr)
  data=json.loads(report.read_text());failures=[test['fullName'] for suite in data['testResults'] for test in suite['assertionResults'] if test['status']=='failed']
  if assertion:assert result.returncode!=0 and any(assertion in test for test in failures),(name,failures)
  else:assert result.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:
 for key,path in files.items():path.write_bytes(original[key])
 for key,path in tests.items():(app/path).write_bytes(test_original[key])
record={'runs':records,'sourceSha256':{str(path.relative_to(root)):hashlib.sha256(original[key]).hexdigest() for key,path in files.items()},'testSha256':{tests[key]:hashlib.sha256(value).hexdigest() for key,value in test_original.items()},'boundary':'Mocked component reads and source mount guards. Baseline, harmless and restored controls; targeted missing refresh, unstable owner, dependency, stale result and late response defects. No live cookie, browser, scientific or practitioner acceptance.'}
(out/'result.json').write_text(json.dumps(record,indent=2)+'\n')
