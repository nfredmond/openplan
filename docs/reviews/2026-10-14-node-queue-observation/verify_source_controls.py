"""Check malformed configuration and path-token recovery with strict diagnostics."""
import argparse,copy,hashlib,json,os,re,subprocess
from pathlib import Path


def intended_failure(code,data,failed,title,reason):
    return (code==1 and data.get('success') is False and data.get('numFailedTests')==1
        and len(failed)==1 and failed[0].get('title')==title
        and any(reason in message for message in failed[0].get('failureMessages',[])))


def oracle_controls(out):
    title='Original node observation check';reason='Required report behavior'
    row={'title':title,'failureMessages':[reason]};data={'success':False,'numFailedTests':1}
    for report,failed in [(data,[row]),(copy.deepcopy(data),[copy.deepcopy(row)])]:
        if not intended_failure(1,report,failed,title,reason):raise AssertionError('Node observation oracle positive differs')
    faults=[('runner-error',2,data,[row]),('false-success',1,{**data,'success':True},[row]),
        ('extra-failure',1,{**data,'numFailedTests':2},[row,row]),
        ('wrong-test',1,data,[{**row,'title':'Other test'}]),
        ('wrong-diagnostic',1,data,[{**row,'failureMessages':['Other failure']}]),
        ('missing-failure',1,data,[])]
    for label,code,report,failed in faults:
        if intended_failure(code,report,failed,title,reason):raise AssertionError('Node observation oracle accepted '+label)
    (out/'oracle-controls.json').write_text(json.dumps({'positiveControls':2,'refusedFaults':[row[0] for row in faults]},indent=2)+'\n')


def run(repo,out):
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    app=repo/'openplan';subject=app/'src/lib/ops/node-queue-observation.ts'
    test=app/'src/test/node-queue-observation.test.ts';wiring=app/'src/test/node-queue-observation-wiring.test.ts'
    kinds=['document-exports','engagement-email','provider-api','translation-generation',
        'synthesis-preparation','synthesis-execution','contract-calculations','gtfs-ingestion']
    scripts={kind:app/'scripts/workers'/(kind+'.ts') for kind in kinds}
    startup=app/'src/test/node-queue-observation-startup.test.ts'
    cli=app/'src/test/engagement-synthesis-preparation-cli-process.test.ts'
    original={path:path.read_bytes() for path in (subject,test,wiring,startup,cli,*scripts.values())}
    oracle_controls(out)
    def swap(text,before,after):
        if text.count(before)!=1:raise ValueError('Node observation mutation anchor must be unique: '+before)
        return text.replace(before,after,1)
    def change(before,after):return lambda text:swap(text,before,after)
    core='preserves work and records one original instance then stopped'
    cases=[
        ('work-result',subject,core,change('    return await work(notice);','    await work(notice); return undefined as T;'),'Observation must preserve work result'),
        ('sequence',subject,core,change('send(state, ++sequence, signal)','send(state, sequence, signal)'),'Process states keep original ordering'),
        ('rpc-target',subject,core,change('client.rpc("record_node_queue_process_observation"','client.rpc("read_node_queue_process_observations"'),'Observation must use its dedicated POST RPC'),
        ('rpc-fields',subject,core,change('p_build_sha: build,','p_build_sha: build, privatePayload: "synthetic-private-field",'),'Observation carries only operational fields'),
        ('timer-reference',subject,core,change('timer.unref();','// Deliberately retain diagnostic timer reference.'),'Diagnostic timer cannot keep the worker alive'),
        ('signal-ownership',subject,core,change('    pulse(); timer =','    process.on("SIGTERM", notice); pulse(); timer ='),'Observation cannot take ownership of process signals'),
        ('work-error',subject,'preserves work errors when diagnostic storage refuses',change('    return await work(notice);','    return await work(notice).catch(() => undefined as T);'),'promise resolved'),
        ('warning-count',subject,'preserves work errors when diagnostic storage refuses',change('    if (warned) return;','    // Deliberately repeat diagnostic warnings.'),'expected "error" to be called 1 times'),
        ('factory-failure',subject,'runs work when the diagnostic client cannot be created',change('  try { client = createServiceRoleClient(); } catch { warn(); return work(() => {}); }','  client = createServiceRoleClient();'),'private-provider-sentinel'),
        ('help',subject,'skips observation for direct help',change('  if (process.argv.slice(2).includes("--help")) return work(() => {});','  // Deliberately observe help.'),'Help cannot construct a diagnostic client'),
        ('unknown-kind',subject,'refuses an unsupported diagnostic kind without failing work',change('  if (!NODE_QUEUE_KINDS.includes(kind)) return work(() => {});','  // Deliberately observe an unknown kind.'),'Unsupported observation cannot construct its client'),
        ('exit-abort',subject,'closes an actual in-flight read on exit without warning about its own cancellation',change('    pending?.controller.abort();','    // Deliberately leave active request pending.'),'Actual observation exit must close promptly'),
        ('own-cancellation',subject,'closes an actual in-flight read on exit without warning about its own cancellation',change('const ownCancellation = () => value !== "stopped" && state === "stopped" && signal.aborted;','const ownCancellation = () => false;'),'Own cancellation is not a diagnostic failure'),
        ('overlap',subject,'keeps one active request while a heartbeat stalls',change('if (activity.current || state === "stopped")','if (state === "stopped")'),'A stalled observation cannot queue overlapping writes'),
        ('client-capture',subject,'captures the client and build for the original process',change('await client.rpc(','await createServiceRoleClient().rpc('),'Original process must keep one diagnostic client'),
        ('receipt',subject,'treats an unaccepted RPC result as unavailable without changing work',change('result.error || result.data !== true','result.error'),'A false diagnostic receipt cannot imply acceptance'),
        ('logging',subject,'does not let a failed diagnostic logger fail work',change('try { console.error("Node worker process observation is unavailable. Queue outcomes remain separate."); } catch { /* Diagnostics do not fail work. */ }','console.error("Node worker process observation is unavailable. Queue outcomes remain separate.");'),'Diagnostic logging cannot fail work'),
        ('identity',subject,'uses a new identity for a restarted observation',change('const instance = randomUUID();','const instance = "00000000-0000-4000-8000-000000000001";'),'A restarted process cannot revive the old observation identity'),
        ('stopping',subject,'records stopping on the next pulse with an increasing sequence',change('const notice = () => { state = "stopping"; };','const notice = () => {};'),'Signal observations keep monotone process state'),
        ('timer-cleanup',subject,'records stopping on the next pulse with an increasing sequence',change('    if (timer) clearInterval(timer);','    // Deliberately retain diagnostic timer.'),'Observer exit must clear its owned timer'),
        ('request-deadline',subject,'closes an actual stalled observation by its request deadline',change('const REQUEST_MS = 3_000;','const REQUEST_MS = 30_000;'),'Actual diagnostic deadline must close its SDK connection'),
        ('actual-sdk-signal',subject,'closes an actual stalled observation by its request deadline',change('}).abortSignal(signal);','});'),'Actual diagnostic deadline must close its SDK connection'),
        ('final-deadline',subject,'bounds the final stopped write and keeps its deadline failure visible',change('await send("stopped", ++sequence, AbortSignal.timeout(REQUEST_MS));','await send("stopped", ++sequence, new AbortController().signal);'),'Final diagnostic deadline must close its SDK connection'),
        ('final-failure',subject,'bounds the final stopped write and keeps its deadline failure visible',change('value !== "stopped" && state === "stopped" && signal.aborted','state === "stopped" && signal.aborted'),'Stopped observation deadline remains visible'),
        ('build',subject,'records an unknown build instead of persisting arbitrary environment text',change('candidate && /^[a-f0-9]{7,40}$/.test(candidate) ? candidate : null','candidate ?? null'),'Invalid build metadata must remain unrecorded'),
        ('registry',subject,'keeps its registry aligned with deployed and standalone queues',change('  "document-exports", "engagement-email",','  "engagement-email",'),'Observation registry must cover declared queue workers'),
    ]
    title='invokes the observer at every actual declared entry point'
    for kind,path in scripts.items():
        before,after=(('return observeNodeQueue("synthesis-preparation", main);','return main(() => {});') if kind=='synthesis-preparation' else ('void observeNodeQueue("'+kind+'", main).catch','void main().catch'))
        cases.append(('caller-'+kind,path,title,change(before,after),'Queue '+kind+' must invoke its observer around main'))
    cases.append(('preflight-order',scripts['synthesis-preparation'],title,change('  const options = synthesisPreparationOptions(process.argv.slice(2), process.env);\n  return observeNodeQueue("synthesis-preparation", main);','  return observeNodeQueue("synthesis-preparation", main);\n  const options = synthesisPreparationOptions(process.argv.slice(2), process.env);'),'Queue synthesis-preparation must invoke its observer around main'))
    path=scripts['provider-api']
    cases.extend([
        ('dead-caller',path,title,change('void observeNodeQueue("provider-api", main).catch','if (false) void observeNodeQueue("provider-api", main).catch'),'Queue provider-api must invoke its observer around main'),
        ('wrong-kind',path,title,change('observeNodeQueue("provider-api", main)','observeNodeQueue("engagement-email", main)'),'Queue provider-api must invoke its observer around main'),
        ('duplicate-main',path,title,lambda text:text+'\nvoid main().catch(() => undefined);\n','Queue provider-api must invoke its observer around main'),
    ])
    for kind,path in scripts.items():
        cases.append(('stop-notice-'+kind,path,'keeps stopping notification inside each worker signal handler',
            lambda text:text.replace('noticeStopping();',''), 'Queue '+kind+' must notify from its actual stop handlers'))
    for signal in ['SIGTERM','SIGINT']:
        for kind in ['document-exports','engagement-email']:
            cases.append(('startup-'+kind+'-'+signal,subject,'preserves default stop during '+kind+' startup',
                change('    pulse(); timer =','    process.on("'+signal+'", notice); pulse(); timer ='),
                'Startup signal must keep default termination before worker handlers'))
    cases.append(('stop-callback',subject,'records stopping on the next pulse with an increasing sequence',
        change('return await work(notice);','return await work(() => {});'),'Signal observations keep monotone process state'))
    cases.append(('actual-cli-business-inventory',subject,'runs one bounded empty pass and creates private target custody',
        change('client.rpc("record_node_queue_process_observation"','client.rpc("unexpected_node_observation"'),
        'A bounded empty pass makes one business inventory read'))
    cases.append(('actual-cli-stopped',subject,'runs one bounded empty pass and creates private target custody',
        change('    await send("stopped", ++sequence, AbortSignal.timeout(REQUEST_MS));','    // Deliberately omit the final observation.'),
        'An actual worker exit must attempt its private stopped observation'))
    cases.append(('actual-cli-preflight',scripts['synthesis-preparation'],"rejects invalid arguments before HTTP [ '--unknown' ]",
        change('  const options = synthesisPreparationOptions(process.argv.slice(2), process.env);\n  return observeNodeQueue("synthesis-preparation", main);','  return observeNodeQueue("synthesis-preparation", main);\n  const options = synthesisPreparationOptions(process.argv.slice(2), process.env);'),
        'Invalid arguments cannot start an HTTP request'))
    def restore():
        for path,raw in original.items():path.write_bytes(raw)
    def execute(label,title=None):
        result_path=out/(label+'.json')
        args=['npm','exec','--','vitest','run',str(test.relative_to(app)),str(wiring.relative_to(app)),str(startup.relative_to(app)),str(cli.relative_to(app)),'--maxWorkers=1','--no-file-parallelism',
            '--reporter=json','--outputFile='+str(result_path)]
        if title:args+=['--testNamePattern',re.escape(title)]
        result=subprocess.run(args,cwd=app,capture_output=True,text=True,timeout=50,
            env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=640'})
        (out/(label+'.log')).write_text(result.stdout+result.stderr);data=json.loads(result_path.read_text())
        if re.search(r'Unhandled (?:Errors?|Rejections?)|Uncaught Exception',result.stdout+result.stderr,re.I):raise AssertionError('Node observation runner has unrelated errors')
        failed=[row for suite in data['testResults'] for row in suite['assertionResults'] if row['status']=='failed']
        return result.returncode,data,failed
    records=[]
    def positive(label):
        code,data,failed=execute(label)
        if code or not data['success'] or failed or data['numPassedTests']!=33:raise AssertionError(label+' positive differs')
        records.append({'control':label,'outcome':'survived','cases':33});print(label+' survived',flush=True)
    try:
        positive('baseline')
        for path in (subject,*scripts.values()):path.write_bytes(original[path]+b'\n// Harmless node observation recovery note.\n')
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
