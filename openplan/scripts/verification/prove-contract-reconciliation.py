"""Run reversible contract mutations against the explicit isolated test stack."""
import json, os, re, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[2]
os.chdir(root)
output=Path(os.environ.get('CONTRACT_PROOF_OUTPUT','/tmp/openplan-contract-proof'))
output.mkdir(parents=True,exist_ok=True)
results=[]
def run(name,suite,expected,sql=None,path=None,before=None,after=None):
    original=path.read_text() if path else None
    env=os.environ.copy()
    if sql:
        injection=output/'mutation.sql';injection.write_text(sql);env['OPENPLAN_CONTRACT_TEST_SQL']=str(injection)
        env['OPENPLAN_RLS_LIVE_TEST']='1'
    try:
        if path:
            assert original.count(before)==1,(name,'mutation target is not unique')
            path.write_text(original.replace(before,after))
        result=subprocess.run(['npm','test','--','--run',suite],env=env,text=True,capture_output=True)
        log=result.stdout+result.stderr;(output/(name+'.log')).write_text(log)
        status='survived' if result.returncode==0 else 'killed' if expected and re.search(expected,log) else 'invalid'
        results.append({'mutation':name,'status':status,'expectedFailure':expected})
        (output/'results.json').write_text(json.dumps(results,indent=2))
        print(name,status,flush=True)
        assert status==('killed' if expected else 'survived'),name
    finally:
        if path:path.write_text(original)
def function(file,name):
    source=Path('supabase/migrations',file).read_text()
    match=re.search(r'CREATE (?:OR REPLACE )?FUNCTION public\.'+name+r'\([\s\S]*?\$\$;',source)
    assert match,name
    return match[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
def sqlcase(name,file,fn,before,after,expected):
    source=function(file,fn);assert source.count(before)==1,(name,'SQL mutation not unique')
    run(name,'src/test/contract-reconciliation-rls.test.ts',expected,sql=source.replace(before,after))
unit=Path('src/lib/invoicing/contracts/reconciliation.ts')
run('harmless-comment','src/test/contract-reconciliation.test.ts',None,path=unit,before='Reconcile retained sources once.',after='Reconcile each retained source once.')
for name,before,after,expected in [
 ('duplicate-source','if (identities.has(identity))','if (false && identities.has(identity))','expected.*to throw'),
 ('proposed-budget','state.baselines.filter(b => b.state === "approved").at(-1)','state.baselines.at(-1)','expected 2 to be 1'),
 ('cost-plus-billing','incurred: "0.00"','incurred: "1.00"','Unreconciled incurred'),
 ('forecast-coverage','!!options.coverageComplete','true','expected.*to be null'),
 ('opening-overlap','overlappingOpenings.includes(v)','false','expected.*to be null'),
 ('staff-remainder','cents(task.cost) - task.staff.reduce','cents(task.cost) + task.staff.reduce','expected.*200.00'),
 ('gross-retention','cents(i.subtotal_amount)','cents(i.retention_amount)','expected.*100.00'),
]:run(name,'src/test/contract-reconciliation.test.ts',expected,path=unit,before=before,after=after)
base='20260911000001_contract_reconciliation.sql'
sqlcase('sql-harmless',base,'record_contract_command','Invalid contract command','Invalid management command',None)
sqlcase('source-dedup',base,'record_contract_command',"v.workspace_id=e.workspace_id AND v.source_key=p_command->>'sourceKey'", "false AND v.source_key=p_command->>'sourceKey'",'Duplicate source accepted')
sqlcase('private-role',base,'record_contract_command',"IF actor_role='member' AND (category", "IF false AND (category",'Member changed approved actual')
sqlcase('shared-drift',base,'contract_shared_source_stale','SELECT EXISTS','SELECT false AND EXISTS','Reverse shared mapping missed')
sqlcase('shared-billing','20260911000002_contract_billing.sql','bill_contract_actuals','IF public.contract_shared_source_stale(v)','IF false','Stale shared actual billed')
sqlcase('agreement-delete','20260911000007_contract_evidence.sql','guard_contract_agreement_document',"IF EXISTS", "IF false AND EXISTS",'Agreement deleted')
sqlcase('historical-parent','20260911000007_contract_evidence.sql','guard_contract_historical_parent',"IF retained AND (TG_OP='DELETE' OR NEW.project_id", "IF false AND (TG_OP='DELETE' OR NEW.project_id",'Historical deliverable moved')
run('workbook-layout','src/test/contract-reconciliation.test.ts','wrapText',path=Path('src/lib/invoicing/contracts/export.ts'),before='await formatWorkProgramWorkbook(zip,book,{readOnly:true});',after='void formatWorkProgramWorkbook;')
run('private-table','src/test/contract-reconciliation-rls.test.ts','Private contract table leaked: contract_rates',sql='ALTER POLICY management_read ON public.contract_rates USING (true);')
print('Restored all source mutations. See results.json for individual evidence.',flush=True)
