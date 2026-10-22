"""Challenge storage-room boundaries with actual Vitest diagnostics, restoring bytes."""
import argparse,copy,hashlib,json,os,re,subprocess
from pathlib import Path


def intended_failure(code,data,failed,title,reason):
    return (code==1 and data.get('success') is False and data.get('numFailedTests')==1
        and len(failed)==1 and failed[0].get('title')==title
        and any(reason in message for message in failed[0].get('failureMessages',[])))

def challenge_oracle(out):
    title='Original storage refusal';reason='Required storage refusal'
    good={'title':title,'failureMessages':[reason]};data={'success':False,'numFailedTests':1}
    if not intended_failure(1,data,[good],title,reason):raise AssertionError('Oracle refuses intended failure')
    if not intended_failure(1,copy.deepcopy(data),[copy.deepcopy(good)],title,reason):raise AssertionError('Oracle harmless copy differs')
    faults=[('runner-error',2,data,[good]),('false-success',1,{**data,'success':True},[good]),
        ('extra-failure',1,{**data,'numFailedTests':2},[good,good]),
        ('wrong-test',1,data,[{**good,'title':'Other test'}]),
        ('wrong-diagnostic',1,data,[{**good,'failureMessages':['Other diagnostic']}]),
        ('missing-failure',1,data,[])]
    records=[]
    for label,code,report,failed in faults:
        if intended_failure(code,report,failed,title,reason):raise AssertionError('Oracle accepted '+label)
        records.append({'fault':label,'outcome':'refused'})
    (out/'oracle-controls.json').write_text(json.dumps({'positiveControls':2,'faults':records},indent=2)+'\n')


def run(repo,out):
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    challenge_oracle(out)
    app=repo/'openplan';intake=app/'src/lib/gtfs/managed-worker-intake.ts';admission=app/'src/lib/gtfs/managed-admission.ts'
    tests=[app/'src/test'/name for name in ['gtfs-managed-worker-intake.test.ts','gtfs-managed-admission.test.ts','gtfs-managed-storage-room.test.ts']]
    original={p:p.read_bytes() for p in [intake,admission,*tests]}
    def swap(text,before,after):
        if text.count(before)!=1:raise ValueError('Storage-room fault anchor must be unique: '+before)
        return text.replace(before,after,1)
    def restore():
        for p,raw in original.items():p.write_bytes(raw)
    results=[];cases=[]
    def add(label,file,test,title,change,reason):cases.append((label,file,test,title,change,reason))
    for prefix,file,test,call in [
        ('worker',intake,tests[0],'await requireGtfsStorageRoom(upload, snapshot.workspaceId, archive, uploadSignal, options.fetchOptions?.env);'),
        ('admission',admission,tests[1],'await requireGtfsStorageRoom(storage, binding.workspaceId, archive, uploadSignal, options.env);')]:
        for key,title in [('full','refuses new archive bytes when the installation has no storage room'),('unreadable','refuses unreadable storage use before upload')]:
            add(prefix+'-'+key,file,test,title,lambda text,call=call:swap(text,call,'// Broken: upload without storage-room observation.'),'promise resolved')
        scope='snapshot.workspaceId' if prefix=='worker' else 'binding.workspaceId'
        wrong='snapshot.actorId' if prefix=='worker' else 'binding.actorId'
        add(prefix+'-workspace',file,test,'checks storage use for the original workspace with active transport cancellation',lambda text,call=call,scope=scope,wrong=wrong:swap(text,call,call.replace(scope,wrong)),'Original workspace storage RPC projection differs')
        add(prefix+'-exact-reconciliation',file,test,'reconciles exact retained bytes even when the installation is full',lambda text:swap(text,'if (!remote.ok) {','if (true) {'),'storage limit')
        message='GTFS uploaded archive is unconfirmed' if prefix=='worker' else 'GTFS admission upload is unconfirmed'
        add(prefix+'-metadata-not-custody',file,test,'charges no additional bytes for a same-size immutable key without treating metadata as custody',lambda text,message=message:swap(text,'requireMatch(remote.ok, "'+message+'");','// Broken: confirm without actual retained bytes.'),'promise resolved')
        add(prefix+'-refusal-message',file,test,'refuses new archive bytes when the installation has no storage room',lambda text:swap(text,'if (error instanceof GtfsStorageRoomRefusal) throw error;','// Broken: swallow known storage refusal.'),'unconfirmed')
    add('actual-rpc-scope',intake,tests[2],'reads the original immutable key and workspace through actual SDK HTTP',lambda text:swap(text,'checkWorkspaceStorageRoom(client, workspaceId, incoming, env)','checkWorkspaceStorageRoom(client, "ed000000-0000-4000-8000-000000000099", incoming, env)'),'Actual workspace storage RPC projection differs')
    add('actual-request-cancellation',intake,tests[2],'closes an actual stalled capacity request when ownership ends',lambda text:swap(text,'return transport(input, { ...init, signal: active });','return transport(input, init);'),'Cancelled capacity connection did not close')
    add('pre-cancelled-sdk',intake,tests[2],'refuses pre-cancelled work before invoking the Storage client',lambda text:swap(text,'  signal.throwIfAborted();\n  const incoming =','  const incoming ='),'to not be called')
    def execute(label,files,title=None):
        report=out/(label+'.json');args=['npm','exec','--','vitest','run',*[str(p.relative_to(app)) for p in files],'--maxWorkers=1','--no-file-parallelism','--reporter=json','--outputFile='+str(report)]
        if title:args+=['--testNamePattern',re.escape(title)]
        r=subprocess.run(args,cwd=app,capture_output=True,text=True,timeout=40,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=640'})
        (out/(label+'.log')).write_text(r.stdout+r.stderr)
        data=json.loads(report.read_text());failed=[c for s in data['testResults'] for c in s['assertionResults'] if c['status']=='failed']
        return r.returncode,data,failed
    def positive(label):
        code,data,failed=execute(label,tests)
        if code or not data['success'] or failed or data['numPassedTests']!=93:raise AssertionError(label+' full positive differs')
        results.append({'control':label,'outcome':'survived','cases':93});print(label+' survived',flush=True)
    try:
        positive('baseline');intake.write_bytes(original[intake]+b'\n// Harmless storage-room note.\n');positive('harmless');restore();positive('restored-after-harmless')
        for label,file,test,title,change,reason in cases:
            restore();file.write_text(change(original[file].decode()));code,data,failed=execute(label,[test],title)
            if not intended_failure(code,data,failed,title,reason):
                raise AssertionError(label+' intended diagnostic differs: '+json.dumps(failed)[:2000])
            results.append({'control':label,'outcome':'intended_failure','test':title,'reason':reason});print(label+' intended failure',flush=True)
        restore();positive('restored-final')
        (out/'controls.json').write_text(json.dumps(results,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(raw).hexdigest() for p,raw in original.items()},indent=2)+'\n')
    finally:restore()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
