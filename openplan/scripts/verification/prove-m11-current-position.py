"""Current staffing/financial controls, confined to the named disposable database and owned checkout."""
from pathlib import Path
import os,subprocess,json,re
root=Path(__file__).resolve().parents[2]
receipt=root.parent/'docs/reviews/2026-09-08-m11-delivery/current-position-controls.json'
results=json.loads(receipt.read_text()) if os.environ.get('M11_PROOF_RESUME') and receipt.exists() else []
finished={r['name'] for r in results}
def run(name,tests,expected=None,sql=None):
 if name in finished:return
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m11-contract-verification'}
 if sql:
  p=Path('/tmp/openplan-m11-current-position-control.sql');p.write_text(sql);env['OPENPLAN_CONTRACT_TEST_SQL']=str(p)
 r=subprocess.run(['npm','test','--','--run',*tests],cwd=root,env=env,capture_output=True,text=True);log=r.stdout+r.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(log)
 assert (r.returncode==0 if expected is None else r.returncode!=0 and expected in log),name+'\n'+log[-6000:]
 results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected});print(name,results[-1]['outcome'],flush=True)
 (root.parent/'docs/reviews/2026-09-08-m11-delivery/current-position-controls.json').write_text(json.dumps(results,indent=2)+'\n')
def code(file,tests,controls):
 p=root/file;original=p.read_text()
 for name,mutate,expected in controls:
  if name in finished:continue
  try:
   changed=mutate(original);assert changed!=original,name;p.write_text(changed);run(name,tests,expected)
  finally:p.write_text(original)
code('src/lib/invoicing/contracts/delivery.ts',['src/test/contract-delivery.test.ts'],[
 ('harmless-current-schedule',lambda s:'// Current working assignments.\n'+s,None),
 ('zero-effort-hides-late-finish',lambda s:s.replace('result.finish=result.actualFinish??start;}else{','result.finish=result.actualFinish??start;return;}else{'),'keeps a missed approved deadline'),
 ('ignore-changed-working-assignment',lambda s:s.replace('if(delivery.assignments&&!delivery.assignments.some','if(false&&delivery.assignments&&!delivery.assignments.some'),'withholds a forecast after an amendment')])
code('src/lib/invoicing/contracts/closeout.ts',['src/test/contract-closeout.test.ts'],[
 ('ignore-corrected-received-date',lambda s:s.replace('[...currentReceived.values()].some(i=>i.content.date>command.asOf)','(state.receivedInvoices??[]).some(i=>i.content.date>command.asOf)'),'uses corrected current received invoice'),
 ('harmless-financial-coverage',lambda s:'// Known financial sources remain explicit.\n'+s,None),
 ('hide-undated-obligation',lambda s:s.replace('(!i.invoice_date||i.invoice_date<=asOf)','(!!i.invoice_date&&i.invoice_date<=asOf)'),'keeps undated obligations'),
 ('paid-status-without-evidence',lambda s:s.replace('invoice.legacyStatus==="paid"&&open!==BigInt(0)','false'),'keeps undated obligations'),
 ('ignore-future-financial-records',lambda s:'\n'.join(line for line in s.split('\n') if 'warnings.push("Known financial records' not in line),'does not settle a past period')])
code('src/lib/invoicing/contracts/cash-summary-server.ts',['src/test/contract-cash-position.test.tsx'],[
 ('harmless-complete-cash-read',lambda s:'// Complete currency-safe cash source.\n'+s,None),
 ('ignore-changed-invoice-row',lambda s:s.replace('||position.version!==row.updated_at',''),'ages the amount currently due'),
 ('truncate-cash-read',lambda s:s.replace('if(page.data.length<200)break;','break;'),'reads beyond the first page')])
code('src/components/invoicing/contracts/cash-position.tsx',['src/test/contract-cash-position.test.tsx'],[
 ('harmless-cash-aging',lambda s:'// Documented amounts currently due.\n'+s,None),
 ('age-held-amounts-as-due',lambda s:s.replace('due=cents(p.currentlyDue)','due=cents(p.open)'),'ages the amount currently due'),
 ('mix-cash-currencies',lambda s:s.replace('totals.set(p.currency,total)','totals.set("USD",total)'),'reads beyond the first page')])
code('src/lib/invoicing/contracts/reconciliation.ts',['src/test/contract-reconciliation.test.ts'],[
 ('harmless-gross-authorization',lambda s:'// Credits do not increase gross authorization.\n'+s,None),
 ('credits-increase-unbilled-gross',lambda s:s.replace('((state.schemaVersion??0)<5?cents(total.credits):BigInt(0))','cents(total.credits)'),'separates internal cost')])
code('src/lib/invoicing/contracts/export.ts',['src/test/contract-delivery.test.ts'],[
 ('harmless-current-forecast-report',lambda s:'// Preserve old report formats.\n'+s,None),
 ('reuse-stale-report-forecast',lambda s:s.replace('latestForecast?.input_hash===state.delivery?.inputHash','true'),'exports versioned forecast dates')])
sql=(root/'supabase/migrations/20260917000001_contract_staff_schedule_integrity.sql').read_text().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
controls=[('harmless-current-staff-sql',sql+'\n-- Staff custody proof.\n',None),
 ('ignore-departed-membership',sql.replace('AND (s.user_id IS NULL OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p_workspace AND m.user_id=s.user_id))',''),'Departed staff received new work'),
 ('retain-removed-node-assignment',sql.replace('UPDATE public.contract_task_assignments SET active=false WHERE engagement_id=e.id;',"UPDATE public.contract_task_assignments SET active=false WHERE engagement_id=e.id AND task_id IN (SELECT (n->>'taskId')::uuid FROM jsonb_array_elements(c->'nodes') n);"),'Removed node left an active assignment'),
 ('hide-new-pm-colleague',sql.replace("(actor_role='pm' AND (public.contract_staff_available(s.id,e.workspace_id) OR EXISTS", "(actor_role='pm' AND (false OR EXISTS"),'Scoped PM cannot choose a new colleague'),
 ('reserve-closed-assignment',sql.replace("AND coalesce((SELECT c.state FROM public.contract_closeouts c WHERE c.engagement_id=s.engagement_id AND c.created_at<=p_cutoff ORDER BY c.version DESC LIMIT 1),'reopened')<>'closed'",''),'Closed assignment still reserved capacity'),
 ('closure-does-not-stale-capacity',sql.replace(" UNION ALL SELECT 'closeout:'||id||':'||state FROM public.contract_closeouts WHERE workspace_id=p_workspace_id",''),'Closure did not stale reservation inputs')]
for name,changed,expected in controls:
 assert changed!=sql,name
 run(name,['src/test/contract-staff-schedule-rls.test.ts'],expected,changed)

source=(root/'supabase/migrations/20260918000001_contract_mutable_source_cutoffs.sql').read_text()
cutoff_sql='\n'.join(re.findall(r'CREATE (?:OR REPLACE )?FUNCTION.*?\$\$;',source,re.S)).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
cutoff_controls=[('harmless-cutoff-custody',cutoff_sql+'\n-- Exact historical boundary.\n',None),
 ('omit-staff-custody',cutoff_sql.replace(" IF TG_OP='UPDATE' AND", " IF TG_TABLE_NAME='invoicing_staff' THEN RETURN NEW;END IF;\n IF TG_OP='UPDATE' AND"),'Staff change was not retained'),
 ('omit-membership-deletion-custody',cutoff_sql.replace(" IF TG_OP='UPDATE' AND", " IF TG_OP='DELETE' AND TG_TABLE_NAME='workspace_members' THEN RETURN OLD;END IF;\n IF TG_OP='UPDATE' AND"),'Departed membership was not retained'),
 ('expose-later-project-response',cutoff_sql.replace("WHERE (r->>'updated_at')::timestamptz<=p_cutoff", ''),'Later project response entered cutoff'),
 ('ignore-mutable-cutoff',cutoff_sql.replace("AND c.changed_at>p_cutoff", "AND false"),'Mutable inputs entered an earlier cutoff'),
 ('expose-private-mutation-timing',cutoff_sql+"\nGRANT SELECT ON public.contract_source_changes TO authenticated;CREATE POLICY synthetic_bad ON public.contract_source_changes FOR SELECT TO authenticated USING(true);",'Private change timing exposed')]
for name,changed,expected in cutoff_controls:
 assert changed!=cutoff_sql,name
 run(name,['src/test/contract-staff-schedule-rls.test.ts'],expected,changed)

code('src/test/a-column-nothing-reads-is-a-question.test.ts',['src/test/a-column-nothing-reads-is-a-question.test.ts'],[
 ('harmless-column-registration',lambda s:'// SQL-only custody field.\n'+s,None),
 ('omit-used-sql-field-registration',lambda s:'\n'.join(line for line in s.split('\n') if 'column: "contract_source_changes.changed_at"' not in line),'these columns exist')])
code('src/test/planner-copy-says-the-plain-thing.test.ts',['src/test/planner-copy-says-the-plain-thing.test.ts'],[
 ('harmless-copy-ratchet',lambda s:'// Preserve removed vocabulary.\n'+s,None),
 ('allow-old-copy-count',lambda s:s.replace('workspace: 159,','workspace: 160,'),'A term of art moved')])
code('src/test/migrations/inventory.test.ts',['src/test/migrations/inventory.test.ts'],[
 ('harmless-schema-inventory',lambda s:'// Additive custody relation.\n'+s,None),
 ('forget-new-custody-relation',lambda s:s.replace('relations: 238,','relations: 237,'),'reads every relation')])
