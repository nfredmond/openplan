"""Check actual SDK health cancellation with strict diagnostics."""
import argparse,copy,hashlib,json,os,re,subprocess
from pathlib import Path


def intended_failure(code,data,failed,title,reason):
    return (code==1 and data.get('success') is False and data.get('numFailedTests')==1
        and len(failed)==1 and failed[0].get('title')==title
        and any(reason in message for message in failed[0].get('failureMessages',[])))


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
    (out/'oracle-controls.json').write_text(json.dumps({'positiveControls':2,'refusedFaults':[row[0] for row in faults]},indent=2)+'\n')


def run(repo,out):
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    app=repo/'openplan';route=app/'src/app/api/health/deep/route.ts'
    test=app/'src/test/deep-health-route.test.ts';original={path:path.read_bytes() for path in (route,test)}
    oracle_controls(out)
    def swap(text,before,after):
        if text.count(before)!=1:raise ValueError('Health mutation anchor must be unique: '+before)
        return text.replace(before,after,1)
    def change(before,after):return lambda text:swap(text,before,after)
    cases=[
        ('rpc',route,'reads the database and Storage, ages each heartbeat, and lists every expected migration',change('.rpc("read_node_queue_process_observations")','.rpc("foreign_process_reader")'),'Node observations use their dedicated reader'),
        ('rpc-payload',route,'reads the database and Storage, ages each heartbeat, and lists every expected migration',change('.rpc("read_node_queue_process_observations")','.rpc("read_node_queue_process_observations", {privatePayload: "sentinel"})'),'Node observations use their dedicated reader'),
        ('unavailable',route,'keeps an unavailable Node observation distinct from no workers',change(' && processes.value !== null',''),'Unavailable Node observation must fail deep health'),
        ('malformed',route,'refuses malformed Node observations instead of forwarding a completion claim',change('parseNodeQueueObservation(data)','(data as never)'),'Malformed process facts cannot pass deep health'),
        ('process-output',route,'reads the database and Storage, ages each heartbeat, and lists every expected migration',change('state: "ok", ms: processes.ms, ...processes.value','state: "ok", ms: processes.ms'),'Process availability remains separate from completed work'),
    ]
    def restore():
        for path,raw in original.items():path.write_bytes(raw)
    def execute(label,title=None):
        result_path=out/(label+'.json')
        args=['npm','exec','--','vitest','run',str(test.relative_to(app)),'--maxWorkers=1','--no-file-parallelism',
            '--reporter=json','--outputFile='+str(result_path)]
        if title:args+=['--testNamePattern',re.escape(title)]
        result=subprocess.run(args,cwd=app,capture_output=True,text=True,timeout=45,
            env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=640'})
        (out/(label+'.log')).write_text(result.stdout+result.stderr);data=json.loads(result_path.read_text())
        if re.search(r'Unhandled (?:Errors?|Rejections?)|Uncaught Exception',result.stdout+result.stderr,re.I):raise AssertionError('Health runner has unrelated errors')
        failed=[row for suite in data['testResults'] for row in suite['assertionResults'] if row['status']=='failed']
        return result.returncode,data,failed
    records=[]
    def positive(label):
        code,data,failed=execute(label)
        if code or not data['success'] or failed or data['numPassedTests']!=11:raise AssertionError(label+' positive differs')
        records.append({'control':label,'outcome':'survived','cases':11});print(label+' survived',flush=True)
    try:
        positive('baseline')
        for path in (route,):path.write_bytes(original[path]+b'\n// Harmless health transport recovery note.\n')
        positive('harmless');restore();positive('restored-after-harmless')
        for label,path,title,change,reason in cases:
            restore();path.write_text(change(original[path].decode()));code,data,failed=execute(label,title)
            if not intended_failure(code,data,failed,title,reason):raise AssertionError(label+' intended diagnostic differs: '+json.dumps(failed)[:2500])
            records.append({'control':label,'test':title,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
        restore();positive('restored-final')
        (out/'controls.json').write_text(json.dumps(records,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(raw).hexdigest() for path,raw in original.items()},indent=2)+'\n')
    finally:restore()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve())
