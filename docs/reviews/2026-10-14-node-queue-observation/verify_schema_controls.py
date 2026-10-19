"""Check schema census and SQL-read field accounting with strict diagnostics."""
import argparse,copy,hashlib,json,os,re,subprocess
from pathlib import Path


def intended_failure(code,data,failed,title,reason,diagnostic=''):
    return (code==1 and data.get('success') is False and data.get('numFailedTests')==1
        and len(failed)==1 and failed[0].get('title')==title
        and any(reason in message for message in [*failed[0].get('failureMessages',[]),diagnostic]))


def oracle_controls(out):
    title='Original health transport check';reason='Required report behavior'
    row={'title':title,'failureMessages':[reason]};data={'success':False,'numFailedTests':1}
    for report,failed in [(data,[row]),(copy.deepcopy(data),[copy.deepcopy(row)])]:
        if not intended_failure(1,report,failed,title,reason):raise AssertionError('Health transport oracle positive differs')
    faults=[('runner-error',2,data,[row]),('false-success',1,{**data,'success':True},[row]),
        ('extra-failure',1,{**data,'numFailedTests':2},[row,row]),
        ('wrong-test',1,data,[{**row,'title':'Other test'}]),
        ('wrong-diagnostic',1,data,[{**row,'failureMessages':['Other failure']}]),
        ('missing-failure',1,data,[])]
    for label,code,report,failed in faults:
        if intended_failure(code,report,failed,title,reason):raise AssertionError('Health transport oracle accepted '+label)
    abbreviated=[{**row,'failureMessages':['AssertionError: expected [ Array(1) ] to deeply equal []']}]
    if not intended_failure(1,data,abbreviated,title,reason,'AssertionError: '+reason):raise AssertionError('Full diagnostic positive differs')
    if intended_failure(1,data,abbreviated,title,reason,'AssertionError: Other failure'):raise AssertionError('Full diagnostic accepted wrong reason')
    (out/'oracle-controls.json').write_text(json.dumps({'positiveControls':3,'refusedFaults':[row[0] for row in faults]+['wrong-full-diagnostic']},indent=2)+'\n')


def run(repo,out):
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    app=repo/'openplan';route=app/'supabase/migrations/20261017000015_node_queue_process_observations.sql'
    population=app/'supabase/migrations/20261019051430_model_population_replacement.sql'
    manual=app/'supabase/migrations/20261019000002_rtp_manual_source_page_proposals.sql'
    test=app/'src/test/migrations/inventory.test.ts';columns=app/'src/test/a-column-nothing-reads-is-a-question.test.ts';original={path:path.read_bytes() for path in (route,test,columns,population,manual)}
    oracle_controls(out)
    def swap(text,before,after):
        if text.count(before)!=1:raise ValueError('Health mutation anchor must be unique: '+before)
        return text.replace(before,after,1)
    def change(before,after):return lambda text:swap(text,before,after)
    entry=next(line for line in columns.read_text().splitlines(keepends=True) if 'column: "node_queue_process_observations.build_sha"' in line)
    def expected_count(field):
        values=re.findall(r'^  '+re.escape(field)+r': (\d+),$',original[test].decode(),re.M)
        if len(values)!=1:raise ValueError('Schema expectation must be a unique literal: '+field)
        return int(values[0])
    manual_entry=next(line for line in columns.read_text().splitlines(keepends=True) if 'column: "rtp_extraction_runs.manual_request_payload"' in line)
    population_entry=next(line for line in columns.read_text().splitlines(keepends=True) if 'column: "model_population_checkpoint_receipts.context_json"' in line)
    cases=[
        ('unaccounted-table',route,'reads every relation the migrations declare',lambda text:text+'\nCREATE TABLE public.node_queue_unaccounted_probe (probe text);\n','have a length of '+str(expected_count('relations'))),
        ('disabled-rls',route,'reads every relation the migrations declare',change('ENABLE ROW LEVEL SECURITY','DISABLE ROW LEVEL SECURITY'),'have a length of '+str(expected_count('rlsEnabledTables'))),
        ('population-field-projection',population,'reads every relation the migrations declare',change('context_json jsonb NOT NULL','context_probe jsonb NOT NULL'),'context_json'),
        ('unaccounted-population-context',columns,'finds no unread column that is not accounted for',change(population_entry,''),'these columns exist and nothing in the application ever names them'),
        ('manual-field-projection',manual,'reads every relation the migrations declare',change('ADD COLUMN manual_request_payload jsonb','ADD COLUMN manual_request_probe jsonb'),'manual_request_payload'),
        ('unaccounted-manual-request',columns,'finds no unread column that is not accounted for',change(manual_entry,''),'rtp_extraction_runs.manual_request_payload'),
        ('unaccounted-build',columns,'finds no unread column that is not accounted for',change(entry,''),'these columns exist and nothing in the application ever names them'),
    ]
    def restore():
        for path,raw in original.items():path.write_bytes(raw)
    def execute(label,title=None):
        result_path=out/(label+'.json')
        args=['npm','exec','--','vitest','run',str(test.relative_to(app)),str(columns.relative_to(app)),'--maxWorkers=1','--no-file-parallelism',
            '--reporter=json','--reporter=default','--outputFile='+str(result_path)]
        if title:args+=['--testNamePattern',re.escape(title)]
        result=subprocess.run(args,cwd=app,capture_output=True,text=True,timeout=45,
            env={**os.environ,'NODE_OPTIONS':os.environ.get('NODE_OPTIONS','--max-old-space-size=640')})
        (out/(label+'.log')).write_text(result.stdout+result.stderr);data=json.loads(result_path.read_text())
        if re.search(r'Unhandled (?:Errors?|Rejections?)|Uncaught Exception',result.stdout+result.stderr,re.I):raise AssertionError('Health runner has unrelated errors')
        failed=[row for suite in data['testResults'] for row in suite['assertionResults'] if row['status']=='failed']
        return result.returncode,data,failed,result.stdout+result.stderr
    records=[]
    def positive(label):
        code,data,failed,_=execute(label)
        suites=data['testResults'];assertions=[row for suite in suites for row in suite['assertionResults']]
        identities={(Path(suite['name']).resolve(),row['title']) for suite in suites for row in suite['assertionResults']}
        required={(test.resolve(),'reads every relation the migrations declare'),
                  (columns.resolve(),'finds no unread column that is not accounted for'),
                  (columns.resolve(),'keeps name collisions tied to existing columns and actual source names')}
        if (code or not data['success'] or failed or data['numPassedTests']!=37 or len(assertions)!=37
            or any(row['status']!='passed' for row in assertions)
            or {Path(suite['name']).resolve() for suite in suites}!={test.resolve(),columns.resolve()}
            or not required.issubset(identities)):
            raise AssertionError(label+' positive differs: '+json.dumps({'exitCode':code,'success':data.get('success'),
                'numPassedTests':data.get('numPassedTests'),'numFailedTests':data.get('numFailedTests'),
                'failed':failed,'missingRequiredTests':sorted((str(path),title) for path,title in required-identities),
                'report':str(out/(label+'.json')),'log':str(out/(label+'.log'))}))
        records.append({'control':label,'outcome':'survived','cases':37});print(label+' survived',flush=True)
    try:
        positive('baseline')
        for path in (route,):path.write_bytes(original[path]+b'\n-- Harmless schema observation note.\n')
        positive('harmless');restore();positive('restored-after-harmless')
        for label,path,title,change,reason in cases:
            restore();path.write_text(change(original[path].decode()));code,data,failed,diagnostic=execute(label,title)
            if not intended_failure(code,data,failed,title,reason,diagnostic):raise AssertionError(label+' intended diagnostic differs: '+json.dumps(failed)[:2500])
            records.append({'control':label,'test':title,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
        restore();positive('restored-final')
        (out/'controls.json').write_text(json.dumps(records,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(raw).hexdigest() for path,raw in original.items()},indent=2)+'\n')
    finally:restore()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve())
