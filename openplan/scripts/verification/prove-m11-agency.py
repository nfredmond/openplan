"""Run transactional mutations against the explicitly named disposable M11 stack."""
import json, os, re, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[2]
os.chdir(root)
stack='/home/nathaniel/.local/state/openplan/m11-contract-verification'
out=Path('/tmp/openplan-m11-mutations');out.mkdir(exist_ok=True)
env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':stack}
results=[]
def definition(file,name):
 text=Path('supabase/migrations',file).read_text()
 return re.search(r'CREATE (?:OR REPLACE )?FUNCTION public\.'+name+r'\(.*?\n(?:END \$\$;|\$\$;)',text,re.S)[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
def run(name,suite,sql,expected=None):
 file=out/(name+'.sql');file.write_text(sql)
 r=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','src/test/'+suite],env={**env,'OPENPLAN_CONTRACT_TEST_SQL':str(file)},text=True,capture_output=True)
 log=r.stdout+r.stderr;(out/(name+'.log')).write_text(log)
 survived=r.returncode==0
 if expected is None: assert survived,(name,log[-4000:])
 else: assert not survived and expected in log,(name,log[-4000:])
 results.append({'name':name,'outcome':'survived' if survived else 'killed','expectedFailure':expected})
 (out/'results.json').write_text(json.dumps({'complete':False,'controls':results},indent=2))
 print(name,results[-1]['outcome'],flush=True)
def mutate(name,suite,source,before,after,expected):
 assert before in source,(name,before)
 run(name,suite,source.replace(before,after),expected)
master=definition('20260912000001_contract_master_authorization.sql','validate_contract_master_authorization')
master_suite='contract-master-authorization-rls.test.ts'
run('harmless-master-comment',master_suite,'-- harmless mutation\n'+master)
mutate('shared-ceiling',master_suite,master,'IF total>p_terms.ceiling THEN','IF false THEN','Shared ceiling exceeded')
check=definition('20260912000001_contract_master_authorization.sql','check_contract_master_approval')
mutate('proposal-is-not-authority',master_suite,check,"AND state='approved' ORDER BY version DESC LIMIT 1",'ORDER BY version DESC LIMIT 1','Proposal increased authority')
mutate('master-end-date',master_suite,master,"(period->>'endsOn')::date>p_terms.ends_on",'false','Invalid authorization accepted: period')
guard=definition('20260912000001_contract_master_authorization.sql','guard_contract_master_terms')
mutate('immutable-master-evidence',master_suite,guard,"IF OLD.state<>'proposed' OR NEW.state<>'approved' OR", "IF false AND (OLD.state<>'proposed' OR NEW.state<>'approved') AND",'Approved terms rewritten')
reader=definition('20260912000002_contract_scoped_access.sql','read_contract_management_v046')
agency='contract-agency-reconciliation-rls.test.ts'
run('harmless-role-comment',agency,'-- harmless role comment\n'+reader)
mutate('pm-rate-record-privacy',agency,reader,"'rates','[]'::jsonb,'imports'","'rates',result->'rates','imports'",'PM cost or rate boundary incorrect')
command=definition('20260912000002_contract_scoped_access.sql','record_contract_command_v046')
mutate('pm-rate-edit-refusal',agency,command,"IF actor_role='pm' AND (k NOT IN", "IF false AND (k NOT IN",'PM edited rates')
received=definition('20260912000003_received_consultant_invoices.sql','record_received_invoice')
mutate('no-duplicate-source-matching',agency,received,"IF consumed+(item->>'amount')::numeric>v.amount THEN",'IF false THEN','Cost matched twice')
mutate('exact-invoice-review',agency,received,"IF coalesce(old.version,0) IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN",'IF false THEN','Stale invoice review accepted')
accounting=definition('20260912000004_contract_accounting_reconciliation.sql','record_contract_accounting')
account_suite='contract-accounting-reconciliation-rls.test.ts'
run('harmless-accounting-comment',account_suite,'-- harmless accounting comment\n'+accounting)
mutate('accounting-discrepancy',account_suite,accounting,"actual.amount IS DISTINCT FROM (row_data->>'amount')::numeric",'false','Mismatched accounting values reconciled')
mutate('exact-accounting-valuation',account_suite,accounting,"IF p_command->>'actualVersionId' IS DISTINCT FROM actual.id::text THEN",'IF false THEN','Stale accounting valuation accepted')
# UI parser mutation: restore the exact original text, without checkout/reset.
path=Path('src/lib/invoicing/contracts/import.ts');original=path.read_text()
try:
 path.write_text(original+'\n// harmless parser mutation\n');run('harmless-csv-comment','contract-accounting-import.test.ts','')
 path.write_text(original.replace('if(seen.has(row.data.externalId))','if(false)'));run('csv-duplicate-identifiers','contract-accounting-import.test.ts','', 'expected [Function] to throw an error')
finally:path.write_text(original)
(out/'results.json').write_text(json.dumps({'controls':results,'blindCategories':['Synthetic records do not establish agency finance acceptance','Transactional SQL tests do not establish browser reachability','Mutation families cover named decisions, not all possible malformed JSON or distributed failures']},indent=2))
