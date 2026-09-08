"""Exercise job failure controls on the explicitly disposable M11 database; every edit rolls back."""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/migrations/20260916000001_contract_calculation_jobs.sql').read_text()
start=source.index('CREATE FUNCTION public.enqueue_contract_calculation');functions=source[start:source.index('REVOKE ALL ON FUNCTION public.enqueue_contract_calculation',start)].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
delivery=(root/'supabase/migrations/20260913000001_contract_delivery.sql').read_text();a=delivery.index('CREATE FUNCTION public.record_contract_command(');b=delivery.index('REVOKE ALL ON FUNCTION public.record_contract_command',a);delivery_guard=delivery[a:b].replace('CREATE FUNCTION public.record_contract_command(', 'CREATE OR REPLACE FUNCTION public.record_contract_command_delivery(').replace("p_command->>'_inputHash' IS DISTINCT FROM public.contract_delivery_hash(e.workspace_id)",'false')
controls=[('harmless-job-comment',functions+'\n-- Harmless job custody comment.\n',None),
('changed-request-retry',functions.replace('j.command<>p_command','false'),'Queue retry changed'),
('stale-browser-queue',functions.replace("p_command->>'expectedInputHash' IS DISTINCT FROM expected_hash",'false'),'Stale browser queued'),
('expired-worker-commit',functions.replace('j.lease_token IS DISTINCT FROM p_token','false'),'Old worker committed'),
('normalized-request-replacement',functions.replace("p_normalized->'_request' IS DISTINCT FROM j.command",'false'),'Normalized request replaced'),
('redundant-queue-source-check',functions.replace('j.source_hash IS DISTINCT FROM current_hash','false'),None),
('changed-source-both-guards',functions.replace('j.source_hash IS DISTINCT FROM current_hash','false')+'\n'+delivery_guard,'Stale queued calculation committed'),
('revoked-worker-authority',functions.replace('NOT public.contract_calculation_job_visible(j.engagement_id,j.actor_id,j.kind)','false'),'Queued inputs changed'),
('expired-heartbeat',functions.replace("AND lease_until>clock_timestamp();\n RETURN FOUND;",";\n RETURN FOUND;"),'Expired lease revived'),
('outside-job-visibility','ALTER TABLE public.contract_calculation_jobs DISABLE ROW LEVEL SECURITY;','Outside calculation metadata leaked'),
('private-job-payload','GRANT SELECT(command) ON public.contract_calculation_jobs TO authenticated;','Private job request readable')]
results=[]
for name,sql,expected in controls:
 if expected and sql==functions:raise AssertionError('Mutation no-op: '+name)
 mutation=Path('/tmp/openplan-m11-job-control.sql');mutation.write_text(sql)
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m11-contract-verification','OPENPLAN_CONTRACT_TEST_SQL':str(mutation)}
 run=subprocess.run(['npm','test','--','--run','src/test/contract-calculation-jobs-rls.test.ts'],cwd=root,env=env,capture_output=True,text=True);log=run.stdout+run.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(log)
 if not (run.returncode==0 if expected is None else run.returncode!=0 and expected in log):raise AssertionError(name+'\n'+log[-6000:])
 results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected})
 print(name,results[-1]['outcome'],flush=True)
(root.parent/'docs/reviews/2026-09-08-m11-delivery/calculation-job-controls.json').write_text(json.dumps(results,indent=2)+'\n')
api_source=root/'src/lib/invoicing/contracts/jobs-server.ts';original=api_source.read_text()
for name,mutate,expected in [('harmless-job-api',lambda s:'// Exact queued authorship.\n'+s,None),('allow-agent-queue',lambda s:s.replace('readAssistantExecutionSource(request)!=="manual"','false'),'denies ungoverned agent requests'),('strip-forged-queue-result',lambda s:s.replace('contractCommandSchema.safeParse(input)','contractCommandSchema.safeParse(JSON.parse(JSON.stringify(input),(key,value)=>key==="_result"?undefined:value))'),'denies ungoverned agent requests')]:
 try:
  changed=mutate(original);assert changed!=original;api_source.write_text(changed)
  run=subprocess.run(['npm','test','--','--run','src/test/contract-calculation-jobs-api.test.ts'],cwd=root,capture_output=True,text=True);log=run.stdout+run.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(log)
  assert (run.returncode==0 if expected is None else run.returncode!=0 and expected in log),log[-6000:]
  results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected})
 finally:api_source.write_text(original)
(root.parent/'docs/reviews/2026-09-08-m11-delivery/calculation-job-controls.json').write_text(json.dumps(results,indent=2)+'\n')
