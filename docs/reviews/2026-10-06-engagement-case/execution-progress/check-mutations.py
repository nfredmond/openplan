import json,os,subprocess,time,hashlib,sys
from pathlib import Path
app=Path(sys.argv[1]).resolve()
folder=Path(sys.argv[2]).resolve();folder.mkdir(exist_ok=False)
paths={
 'schema':app/'src/lib/engagement/synthesis-progress.ts',
 'server':app/'src/lib/engagement/synthesis-progress-server.ts',
 'plan':app/'src/lib/engagement/synthesis-progress-plan-server.ts',
 'route':app/'src/app/api/engagement/campaigns/[campaignId]/synthesis/progress/route.ts',
 'panel':app/'src/components/engagement/synthesis-progress-panel.tsx'}
tests={name:'src/test/engagement-synthesis-progress'+('-'+name if name not in ['schema','panel'] else '-panel' if name=='panel' else '')+'.test.'+('tsx' if name=='panel' else 'ts') for name in paths}
originals={name:path.read_bytes() for name,path in paths.items()}
results=json.loads((folder/"report.json").read_text())["results"] if (folder/"report.json").exists() else []
def run(label,selected,expected):
 log=folder/(label+'.log')
 with log.open('w') as output:
  result=subprocess.run(['npm','test','--','--maxWorkers=1',*[tests[s] for s in selected]],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},stdout=output,stderr=subprocess.STDOUT,timeout=120)
 content=log.read_text()
 passed=result.returncode==0
 if passed!=expected or (not expected and ('AssertionError' not in content and 'TestingLibraryElementError' not in content and not (label == 'account-remount' and 'Error: expect(element).toHaveAttribute' in content and 'ignores late denial from a previous account' in content) and not (label == 'task-pagination' and 'Error: Synthesis plan seal is incomplete or corrupt' in content and 'reads beyond the first task page without a silent limit' in content))):
  raise RuntimeError(label+' unexpected result; inspect '+str(log))
 results.append({'name':label,'exitCode':result.returncode,'expected':'pass' if expected else 'assertion failure','log':str(log)})
 print(label+' '+str(result.returncode),flush=True)
mutations=[
 ('scope-check','schema','if (Object.keys(expected).some(key => value[key as keyof SynthesisExecutionScope] !== expected[key as keyof SynthesisExecutionScope]))','if (false)'),
 ('completion-claim','schema','if (completed && (!value.taskCount || value.counts.some(row => row.disposition !== success)))','if (false)'),
 ('null-task-count','schema','value.taskCount !== null || total !== 0 || value.selectionSequence !== null','total !== 0 || value.selectionSequence !== null'),
 ('final-access','server','const current = await readSynthesisGenerationRequest(client, requestScope, signal);','const current = original;'),
 ('source-hash','server','result.inventory.source.sha256 !== intent.sourceSha256','false'),
 ('retained-plan','server','const preparation = await readSynthesisProgressPlan(service, result.selections.plan, signal);','const preparation = "sealed" as const;'),
 ('task-bytes','plan','task.task_text !== expected.canonical','false'),
 ('seal-accounting','plan','verifySynthesisGenerationPlanState(plan, {','void ({'),
 ('task-pagination','plan','if (rows.length < 128) break;','if (rows.length <= 128) break;'),
 ('task-projection','plan','request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256','request_id,task_index,task_sha256,task_bytes,cumulative_bytes,chain_sha256'),
 ('route-principal','route','if (request.headers.get("x-openplan-expected-user") !== user.id || request.headers.get("x-openplan-expected-workspace") !== workspaceId)','if (false)'),
 ('route-permission','route','if (!access.campaign || !access.allowed)','if (!access.campaign)'),
 ('response-cache','route','private, no-store','public, max-age=3600'),
 ('stale-results','panel','setSummary(null); setError(null); setBusy(true);','setError(null); setBusy(true);'),
 ('response-scope','panel','const next = verifySynthesisProgress(await response.json(), scope);','const next = await response.json();'),
 ('account-remount','panel','${props.userId}:${props.workspaceId}','${props.workspaceId}'),
]
try:
 for name,path in paths.items():path.write_bytes(originals[name]+b'\n// Harmless evidence control.\n')
 if not any(r['name']=='harmless-comments' for r in results):run('harmless-comments',list(paths),True)
 for name,path in paths.items():path.write_bytes(originals[name])
 for label,key,old,new in mutations:
  if any(r['name']==label for r in results):continue
  text=originals[key].decode()
  if text.count(old)!=1:raise RuntimeError(label+' mutation anchor not unique')
  paths[key].write_text(text.replace(old,new))
  try:run(label,[key],False)
  finally:paths[key].write_bytes(originals[key])
finally:
 for name,path in paths.items():path.write_bytes(originals[name])
 report={'at':time.time(),'results':results,'restored':all(paths[n].read_bytes()==b for n,b in originals.items()),'sha256':{n:hashlib.sha256(p.read_bytes()).hexdigest() for n,p in paths.items()},'blindCategory':'Mocked and pure checks do not prove native access, actual rendering, provider semantics or human acceptance.'}
 (folder/'report.json').write_text(json.dumps(report,indent=2)+'\n')
