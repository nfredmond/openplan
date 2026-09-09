"""Prove pending decision filters in the owned checkout and disposable M11 database."""
from pathlib import Path
import os, subprocess, json
root=Path(__file__).resolve().parents[2]
results=[]
def run(name, tests, expected=None, sql=None):
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m11-contract-verification'}
 if sql:
  path=Path('/tmp/openplan-m11-pending-proof.sql');path.write_text(sql);env['OPENPLAN_CONTRACT_TEST_SQL']=str(path)
 result=subprocess.run(['npm','test','--','--run',*tests],cwd=root,env=env,capture_output=True,text=True)
 log=result.stdout+result.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(log)
 assert result.returncode==0 if expected is None else result.returncode!=0 and expected in log, name+'\n'+log[-6000:]
 results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected});print(name,results[-1]['outcome'],flush=True)
 (root.parent/'docs/reviews/2026-09-08-m11-delivery/pending-review-controls.json').write_text(json.dumps(results,indent=2)+'\n')
def code(file,tests,controls):
 path=root/file;original=path.read_text()
 for name,mutate,expected in controls:
  try:
   changed=mutate(original);assert changed!=original,name;path.write_text(changed);run(name,tests,expected)
  finally:path.write_text(original)
sql=(root/'supabase/migrations/20260920000001_contract_pending_reviews.sql').read_text()
for name,changed,expected in [
 ('harmless-pending-sql',sql+'\n-- Retained decision versions.\n',None),
 ('hide-finance-baseline',sql.replace("b.state='proposed'","b.state='approved'"),'Finance baseline queue missing'),
 ('give-pm-finance-queue',sql.replace('public.contract_can_finance(b.engagement_id)','public.contract_can_manage(b.engagement_id)'),'PM received finance decision'),
 ('include-old-master-proposal',sql.replace('newer.version>t.version','false'),'Scoped finance master version incorrect'),
 ('hide-master-finance-queue',sql.replace("t.state='proposed'","t.state='approved'"),'Scoped finance master version incorrect'),
 ('resurrect-received-versions',sql.replace('newer.version>i.version','false'),'Reviewed invoice retained PM approval'),
 ('give-pm-reviewed-invoices',sql.replace('public.contract_can_finance(i.engagement_id)','public.contract_can_manage(i.engagement_id)'),'Reviewed invoice retained PM approval'),
 ('hide-submitted-invoices',sql.replace("i.state='submitted'","false"),'PM invoice queue missing'),
 ('wrong-response-title',sql.replace("r.content->'sourceRecord'","r.content->'record'"),'Latest response decision incorrect'),
 ('show-old-response',sql.replace('(newer.created_at,newer.id)>(r.created_at,r.id)','false'),'Latest response decision incorrect'),
 ('show-applied-response',sql.replace('a.response_id=r.id','false'),'Applied response remained pending')]:
 assert changed!=sql,name;run(name,['src/test/contract-pending-reviews-rls.test.ts'],expected,changed)
code('src/lib/my-work/sources.ts',['src/test/contract-pending-my-work.test.ts'],[
 ('harmless-pending-adapter',lambda s:'// Retained decisions, existing authority.\n'+s,None),
 ('omit-pending-adapter',lambda s:s.replace('  contractPendingReviewsSource,',''),'reads scoped retained versions'),
 ('omit-pending-projection',lambda s:s.replace('title, review_kind, reported_on','title, reported_on'),'reads scoped retained versions'),
 ('hide-pending-read-failure',lambda s:s.replace('readLabel:"pending contract approvals and invoice reviews"','readLabel:"other rows"'),'reports an unavailable decision queue'),
 ('wrong-pending-destination',lambda s:s.replace('kind==="baseline"?"baselines"','kind==="baseline"?"remaining"'),'reads scoped retained versions')])
code('src/test/migrations/inventory.test.ts',['src/test/migrations/inventory.test.ts'],[
 ('harmless-pending-inventory',lambda s:'// Additive decision view.\n'+s,None),
 ('omit-pending-inventory-count',lambda s:s.replace('relations: 239,','relations: 238,'),'reads every relation'),
 ('omit-pending-view-inventory',lambda s:s.replace('      "contract_pending_my_work",\n',''),"reports a view's columns")])
