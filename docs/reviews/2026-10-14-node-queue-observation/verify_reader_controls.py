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
    app=repo/'openplan';route=app/'src/lib/ops/node-queue-observation-reader.ts'
    test=app/'src/test/node-queue-observation-reader.test.ts';original={path:path.read_bytes() for path in (route,test)}
    oracle_controls(out)
    def swap(text,before,after):
        if text.count(before)!=1:raise ValueError('Health mutation anchor must be unique: '+before)
        return text.replace(before,after,1)
    def change(before,after):return lambda text:swap(text,before,after)
    cases=[
        ('reject-valid',route,'keeps a complete missing-observation report distinct from unreadable data',change('return parsed.success ? parsed.data : null;','return null;'),'A valid unobserved census must remain readable'),
        ('duplicate',route,'refuses a duplicated kind that hides another queue',change('.refine(rows => new Set(rows.map(value => value.kind)).size === NODE_QUEUE_KINDS.length)','.refine(() => true)'),'Every declared queue needs its own observation'),
        ('extra',route,'refuses a duplicated kind that hides another queue',change('.length(NODE_QUEUE_KINDS.length)','.min(NODE_QUEUE_KINDS.length)'),'An extra duplicate cannot expand the declared census'),
        ('time',route,'refuses a foreign queue or missing time',lambda text:swap(swap(text,'observedAt: z.string().datetime({ offset: true })','observedAt: z.string()'),'if (now === null) return false;','if (now === null) return true;'),'Observation time must remain readable'),
        ('kind',route,'refuses a foreign queue or missing time',change('kind: z.enum(NODE_QUEUE_KINDS)','kind: z.string()'),'Unknown queues cannot replace declared observations'),
        ('negative-count',route,'refuses negative fractional and unsafe instance counts',change('runningInstances: z.number().int().nonnegative()','runningInstances: z.number().int()'),'Unreadable instance counts cannot imply process availability'),
        ('fraction-count',route,'refuses negative fractional and unsafe instance counts',change('runningInstances: z.number().int().nonnegative()','runningInstances: z.number().nonnegative()'),'Unreadable instance counts cannot imply process availability'),
        ('unsafe-count',route,'refuses negative fractional and unsafe instance counts',change('runningInstances: z.number().int().nonnegative()','runningInstances: z.number().nonnegative().refine(Number.isInteger)'),'Unreadable instance counts cannot imply process availability'),
        ('scope',route,'cannot promote process facts to accepted work',change('scope: z.literal("process_only")','scope: z.string()'),'Process observations cannot approve work'),
        ('completion',route,'cannot promote process facts to accepted work',change('jobCompletion: z.literal("unassessed")','jobCompletion: z.string()'),'Process observations cannot approve work'),
        ('running',route,'refuses a running claim without a matching count',change('return !recent && item.state === "stale";','return item.state === "observed_running" || (!recent && item.state === "stale");'),'A running observation needs at least one observed instance'),
        ('unobserved',route,'refuses an unobserved claim carrying an instance or timestamp',change('return item.lastSeenAt === null && item.lastState === null','return item.lastState === null'),'Unobserved cannot carry an observed timestamp'),
        ('stale',route,'refuses stale or stopped claims carrying live instances',change('if (item.runningInstances > 0) return item.state === "observed_running"','if (item.runningInstances > 0) return true'),'Stale cannot carry a live instance count'),
        ('stopped',route,'refuses stale or stopped claims carrying live instances',change('if (item.lastState === "stopped")','if (item.state === "last_observed_stopped" || item.lastState === "stopped")'),'A stopped observation must actually record stopped'),
        ('consistent',route,'keeps consistent stopping stale stopped and unknown facts readable',change('return parsed.success ? parsed.data : null;','return null;'),'Consistent process observations must remain readable'),
        ('stopping-empty',route,'refuses a stopping claim with no stopping instance or a live running instance',change('return !recent && item.state === "stale";','return item.state === "observed_stopping" || (!recent && item.state === "stale");'),'Stopping requires an observed stopping instance'),
        ('stopping-running',route,'refuses a stopping claim with no stopping instance or a live running instance',change('if (item.runningInstances > 0) return item.state === "observed_running"','if (item.runningInstances > 0) return item.state === "observed_stopping"'),'Stopping cannot hide an observed running instance'),
        ('activity-time',route,'refuses activity claims with missing or unreadable time and state',change('return item.lastSeenAt === null && item.lastState === null','return item.lastSeenAt === null || (item.lastSeenAt === null && item.lastState === null)'), 'Activity requires a readable observation time'),
        ('states',route,'refuses unsupported summary states instead of treating them as assessed',lambda text:swap(swap(text,'state: z.enum(["observed_running", "observed_stopping", "last_observed_stopped", "unobserved", "stale", "unknown"])','state: z.string()'),'return !recent && item.state === "stale";','return item.state === "approved" || (!recent && item.state === "stale");'),'Unsupported process states cannot be promoted'),
        ('extra-fields',route,'refuses an unknown field rather than forwarding it',change('}).strict().refine(value => {','}).refine(value => {'),'Operational reports cannot accept unknown fields'),
        ('extra-row-fields',route,'refuses an unknown field rather than forwarding it',change('}).strict();','});'),'Operational reports cannot accept unknown fields'),
        ('micro-boundary',route,'keeps exact microsecond freshness and future boundaries',change('seen >= now - BigInt(120_000_000)','seen > now - BigInt(120_000_000)'),'Exact producer time boundaries must remain readable'),
        ('future-running',route,'refuses producer time and state contradictions',change('if (seen > now) return item.state === "unknown";','if (seen > now) return item.state === "unknown" || item.state === "observed_running";'),'Inconsistent producer facts cannot pass operational health'),
        ('latest-running',route,'requires each fresh latest instance to contribute to its own state count',change(' && item.lastState !== "running"',''),'Fresh latest instances must contribute to their own state count'),
        ('latest-stopping',route,'requires each fresh latest instance to contribute to its own state count',change('&& (item.lastState !== "stopping" || item.stoppingInstances > 0)',''),'Fresh latest instances must contribute to their own state count'),
        ('mixed-running',route,'keeps mixed instances readable when the latest row has another state',change('return item.state === "observed_running"','return item.lastState === "running" && item.state === "observed_running"'),'Mixed latest and active instance states must remain readable'),
        ('mixed-stopping',route,'keeps mixed instances readable when the latest row has another state',change('return item.state === "observed_stopping"','return item.lastState === "stopping" && item.state === "observed_stopping"'),'Mixed latest and active instance states must remain readable'),
        ('precision',route,'refuses unsupported timestamp precision without rounding it into a claim',change('if (now === null) return false;','if (now === null) return true;'),'Unsupported producer precision must remain unavailable'),
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
        if code or not data['success'] or failed or data['numPassedTests']!=18:raise AssertionError(label+' positive differs')
        records.append({'control':label,'outcome':'survived','cases':18});print(label+' survived',flush=True)
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
