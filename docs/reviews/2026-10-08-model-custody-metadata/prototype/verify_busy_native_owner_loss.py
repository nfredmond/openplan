"""Observe ongoing native routing before loss of an owned disposable supervisor."""
import hashlib,json,os,signal,subprocess,sys,time
from pathlib import Path
from verify_busy_owner_loss import WORKER,wait_for
from verify_owner_service_loss import pin,state
sys.path.insert(0,str(WORKER))
from model_engine_supervision import inspect_saved_scope
ROOT=Path(__file__).resolve().parent
SUPERVISOR='''
import json,subprocess,sys,time
from pathlib import Path
from model_engine_owner_guard import OwnerGuard
from model_engine_supervision import OwnedEngineScope,ScopeLimits
out=Path(sys.argv[1]);guard=OwnerGuard();scope=OwnedEngineScope(ScopeLimits(1536*1024*1024,32),owner_guard=guard)
with (out/'engine.log').open('wb') as log:
 command=scope.command([sys.executable,'-B',sys.argv[2],str(out)])
 command.insert(command.index('--'),'--property=MemorySwapMax=0')
 child=subprocess.Popen(command,pass_fds=(scope.child.fileno(),),start_new_session=True,stdout=log,stderr=subprocess.STDOUT)
 identity=scope.verify_start(child.pid)
 (out/'identity.json').write_text(json.dumps(identity));(out/'guard.json').write_text(json.dumps(guard.identity))
 scope.authorize();(out/'owner-ready').touch();time.sleep(120)
'''

def cpu_ticks(pid):
    fields=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()
    return int(fields[11])+int(fields[12])


def one(output,mode):
    output.mkdir(mode=0o700);modules=output/'modules';modules.mkdir()
    for name in ('model_engine_owner_guard.py','model_engine_supervision.py','model_engine_bootstrap.py'):
        source=(WORKER/name).read_text()
        if name=='model_engine_owner_guard.py' and mode=='ignore-owner-loss':
            assert source.count('    poller.poll()')==1
            source=source.replace('    poller.poll()','    poller.poll()\n    import time;time.sleep(100)')
        (modules/name).write_text(source)
    child=output/'native-child.py';source=(ROOT/'native_busy_assignment_child.py').read_text()
    if mode=='harmless':source+='\n# Harmless native busy-assignment comment.\n'
    child.write_text(source);owner=None;identity=guard=None;descriptors=[]
    try:
        with (output/'owner.log').open('wb') as log:
            owner=subprocess.Popen([sys.executable,'-B','-c',SUPERVISOR,str(output),str(child)],stdout=log,stderr=subprocess.STDOUT,start_new_session=True,
                env=dict(os.environ,PYTHONPATH=str(modules),OPENBLAS_NUM_THREADS='1',OMP_NUM_THREADS='1',AEQ_CORES='1'))
        wait_for(lambda:(output/'owner-ready').exists() or owner.poll() is not None,timeout=15)
        assert owner.poll() is None,(output/'owner.log').read_text()
        identity=json.loads((output/'identity.json').read_text());guard=json.loads((output/'guard.json').read_text())
        for group in (guard['cgroup'],identity['cgroup']):descriptors.append(pin(group))
        wait_for(lambda:(output/'progress.json').exists() or not inspect_saved_scope(identity)['scope_has_live_processes'],timeout=30)
        assert (output/'progress.json').exists(),'Native computation did not report routing: '+(output/'engine.log').read_text()
        before=json.loads((output/'progress.json').read_text());ticks=cpu_ticks(identity['bootstrap_pid'])
        time.sleep(.25)
        after=json.loads((output/'progress.json').read_text());delta=cpu_ticks(identity['bootstrap_pid'])-ticks
        assert after['completed_native_calls']>before['completed_native_calls'] and delta>0,'Native routing did not advance'
        assert not (output/'native-complete.json').exists(),'Native assignment completed before interruption'
        result={'mode':mode,'native_calls_before':before['completed_native_calls'],'native_calls_after':after['completed_native_calls'],'cpu_ticks_advanced':delta}
        if mode=='owner-alive':
            wait_for(lambda:(output/'native-complete.json').exists(),timeout=90)
            assert owner.poll() is None and state(guard['unit'])['ActiveState']=='active'
            result['completion']=json.loads((output/'native-complete.json').read_text())
        else:
            owner.kill();assert owner.wait(timeout=5)==-signal.SIGKILL
            if mode=='ignore-owner-loss':
                wait_for(lambda:(output/'native-complete.json').exists(),timeout=90)
                result['fault_detected']='Native assignment completed after owner loss'
            else:
                wait_for(lambda:inspect_saved_scope(identity)['scope_has_live_processes'] is False)
                assert not (output/'native-complete.json').exists(),'Native assignment published completion after owner loss'
                result.update(scope_empty=True,completion_absent=True)
        return result
    finally:
        for descriptor in descriptors:
            try:os.write(descriptor,b'1')
            except OSError as error:
                if error.errno not in (2,19):raise
            finally:os.close(descriptor)
        if owner is not None:
            if owner.poll() is None:owner.kill()
            owner.wait(timeout=5)
        if identity is not None:wait_for(lambda:inspect_saved_scope(identity)['scope_has_live_processes'] is False)
        if guard is not None:wait_for(lambda:state(guard['unit'])['ActiveState'] in ('inactive','failed'))

if __name__=='__main__':
    output=Path(os.environ['OPENPLAN_BUSY_NATIVE_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
    modes=os.environ.get('OPENPLAN_BUSY_NATIVE_MODES','baseline,owner-alive,harmless,ignore-owner-loss,restored').split(',')
    assert set(modes)<={'baseline','owner-alive','harmless','ignore-owner-loss','restored'}
    results=[one(output/mode,mode) for mode in modes]
    report={'cases':results,'source_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (Path(__file__),ROOT/'native_busy_assignment_child.py',WORKER/'model_engine_owner_guard.py',WORKER/'model_engine_supervision.py')},
        'cleanup':'Owned engine and guard scopes observed empty or stopped',
        'limits':['Synthetic native all-or-nothing assignment, not a validated planning model','Samples establish advancing native calls and CPU activity, not the exact machine instruction at termination','No installed worker database, ActivitySim, restart, publication or scientific acceptance']}
    content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);print(content)
