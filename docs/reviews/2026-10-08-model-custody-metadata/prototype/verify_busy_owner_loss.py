"""Observe the live owner-loss gap and test a descriptor-bound guard candidate.

Only disposable processes created here are terminated. No database is used.
The candidate is not wired into EngineProcess or normal model dispatch.
"""
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
WORKER = ROOT / 'workers/aequilibrae_worker'
sys.path.insert(0, str(WORKER))
from model_engine_supervision import inspect_saved_scope

SUPERVISOR = r'''
import json,os,subprocess,sys,time
from pathlib import Path
from model_engine_supervision import OwnedEngineScope,ScopeLimits
out=Path(sys.argv[1])
scope=OwnedEngineScope(ScopeLimits(128*1024*1024,16))
child="""
import subprocess,sys,time
from pathlib import Path
out=Path(sys.argv[1])
descendant="import sys,time;from pathlib import Path;o=Path(sys.argv[1]);(o/'descendant-ready').touch();end=time.monotonic()+20\\nwhile not (o/'release').exists() and time.monotonic()<end:time.sleep(.01)\\nif (o/'release').exists():(o/'descendant-output').write_text('synthetic work')"
subprocess.Popen([sys.executable,'-B','-c',descendant,str(out)],start_new_session=True,close_fds=True)
(out/'engine-ready').touch()
end=time.monotonic()+20
while not (out/'release').exists() and time.monotonic()<end:time.sleep(.01)
if (out/'release').exists():(out/'engine-output').write_text('synthetic work')
"""
argv=scope.command([sys.executable,'-B','-c',child,str(out)])
with (out/'engine.log').open('wb') as log:
 process=subprocess.Popen(argv,pass_fds=(scope.child.fileno(),),start_new_session=True,stdout=log,stderr=subprocess.STDOUT)
 identity=scope.verify_start(process.pid)
 (out/'identity.json').write_text(json.dumps(identity))
 scope.authorize()
 (out/'owner-ready').touch()
 time.sleep(25)
'''

GUARD = r'''
import os,select,sys
owner,kill,stop,ready=map(int,sys.argv[1:])
poller=select.poll();poller.register(owner,select.POLLIN);poller.register(stop,select.POLLIN|select.POLLHUP)
os.write(ready,b'R');os.close(ready)
while True:
 events=dict(poller.poll())
 if owner in events:
  if os.write(kill,b'1')!=1:raise RuntimeError('Incomplete owned-scope signal')
  break
 if stop in events:break
'''


def wait_for(predicate, timeout=8):
    deadline=time.monotonic()+timeout
    while not predicate():
        if time.monotonic()>=deadline:raise AssertionError('Owned proof readiness deadline exceeded')
        time.sleep(.02)


def one(output, mode):
    output.mkdir(mode=0o700)
    owner=guard=None
    kill=owner_fd=stop_r=stop_w=ready_r=ready_w=None
    identity=None
    try:
        with (output/'owner.log').open('wb') as log:
            owner=subprocess.Popen([sys.executable,'-B','-c',SUPERVISOR,str(output)],
                env=dict(os.environ,PYTHONPATH=str(WORKER)),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        wait_for(lambda:(output/'owner-ready').exists() or owner.poll() is not None)
        assert owner.poll() is None, 'Supervisor failed before startup: '+(output/'owner.log').read_text()
        identity=json.loads((output/'identity.json').read_text())
        assert inspect_saved_scope(identity)['scope_has_live_processes'] is True
        # Pin the exact live scope while its owning process is still present.
        directory=os.open('/sys/fs/cgroup'+identity['cgroup'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            info=os.fstat(directory)
            assert (info.st_dev,info.st_ino)==(identity['cgroup_device'],identity['cgroup_inode'])
            kill=os.open('cgroup.kill',os.O_WRONLY|os.O_NOFOLLOW,dir_fd=directory)
        finally:os.close(directory)
        wait_for(lambda:(output/'engine-ready').exists() and (output/'descendant-ready').exists())
        owner_fd=os.pidfd_open(owner.pid)
        assert not select.select([owner_fd],[],[],0)[0]
        if mode!='unguarded':
            stop_r,stop_w=os.pipe();ready_r,ready_w=os.pipe()
            code=GUARD+'\n# Harmless owner observation comment.\n' if mode=='harmless' else GUARD
            if mode=='early-signal':code=code.replace('while True:', "os.write(kill,b'1')\nwhile True:",1)
            if mode=='omit-signal':code=code.replace("if os.write(kill,b'1')!=1:raise RuntimeError('Incomplete owned-scope signal')",'pass')
            with (output/'guard.log').open('wb') as log:
                guard=subprocess.Popen([sys.executable,'-B','-c',code,str(owner_fd),str(kill),str(stop_r),str(ready_w)],
                    pass_fds=(owner_fd,kill,stop_r,ready_w),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            os.close(ready_w);ready_w=None
            assert select.select([ready_r],[],[],5)[0] and os.read(ready_r,1)==b'R','Guard did not become ready'
            time.sleep(.1)
            assert owner.poll() is None and inspect_saved_scope(identity)['scope_has_live_processes'] is True,'Guard stopped work while owner was alive'
            if mode=='owner-alive':
                (output/'release').touch()
                wait_for(lambda:(output/'engine-output').exists() and (output/'descendant-output').exists())
                wait_for(lambda:inspect_saved_scope(identity)['scope_has_live_processes'] is False)
                assert owner.poll() is None and guard.poll() is None
                os.close(stop_w);stop_w=None
                assert guard.wait(timeout=5)==0
                return {'mode':mode,'owner_remained_alive':True,'engine_output_present':True,'detached_output_present':True,'guard_stopped_without_signal':True}
        owner.kill();assert owner.wait(timeout=5)==-signal.SIGKILL
        assert select.select([owner_fd],[],[],2)[0],'Owner descriptor did not report exit'
        if guard is not None:assert guard.wait(timeout=5)==0,(output/'guard.log').read_text()
        if mode=='unguarded':
            assert inspect_saved_scope(identity)['scope_has_live_processes'] is True
            (output/'release').touch()
            wait_for(lambda:(output/'engine-output').exists() and (output/'descendant-output').exists())
            result={'mode':mode,'owner_exit':-signal.SIGKILL,'engine_wrote_after_owner_loss':True,'detached_descendant_wrote_after_owner_loss':True}
        else:
            # A guard must stop the whole scope before any continuation is considered.
            deadline=time.monotonic()+3
            while inspect_saved_scope(identity)['scope_has_live_processes'] is not False and time.monotonic()<deadline:time.sleep(.02)
            assert inspect_saved_scope(identity)['scope_has_live_processes'] is False,'Live scope survives owner loss'
            (output/'release').touch()
            assert not (output/'engine-output').exists() and not (output/'descendant-output').exists()
            result={'mode':mode,'owner_exit':-signal.SIGKILL,'scope_empty_observed':True,'engine_output_absent':True,'detached_output_absent':True}
        return result
    finally:
        if kill is not None and identity is not None:
            if inspect_saved_scope(identity)['scope_has_live_processes'] is True:os.write(kill,b'1')
            wait_for(lambda:inspect_saved_scope(identity)['scope_has_live_processes'] is False)
        if owner is not None:
            if owner.poll() is None:owner.kill()
            owner.wait(timeout=5)
        if stop_w is not None:os.close(stop_w);stop_w=None
        if guard is not None:
            if guard.poll() is None:guard.terminate()
            guard.wait(timeout=5)
        for fd in (kill,owner_fd,stop_r,stop_w,ready_r,ready_w):
            if fd is not None:os.close(fd)


def main():
    output=Path(os.environ['OPENPLAN_BUSY_OWNER_LOSS_OUTPUT']).absolute()
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    results=[]
    for mode in ('unguarded','owner-alive','guarded','harmless','omit-signal','early-signal','restored'):
        try:
            result=one(output/mode,mode)
        except AssertionError as error:
            expected={'omit-signal':'Live scope survives owner loss','early-signal':'Guard stopped work while owner was alive'}
            if str(error)!=expected.get(mode):raise
            result={'mode':mode,'fault_detected':str(error)}
        else:
            assert mode not in ('omit-signal','early-signal'),'Targeted signal fault was not detected'
        results.append(result)
    identities=[json.loads(p.read_text()) for p in output.glob('*/identity.json')]
    assert len(identities)==7 and all(inspect_saved_scope(i)['scope_has_live_processes'] is False for i in identities)
    report={'cases':results,'owned_scopes_empty_after_cleanup':len(identities),'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'worker_sha256':{n:hashlib.sha256((WORKER/n).read_bytes()).hexdigest() for n in ('model_engine_supervision.py','model_engine_bootstrap.py')},
        'evidence_directory':str(output),'limits':'Real disposable Python processes, scope and detached descendant. No native model, database, production guard wiring, guard-failure recovery, termination receipt or restart acceptance.'}
    text=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(text)
    (Path(__file__).parent/'busy-owner-loss-controls.json').write_text(text);print(text)


if __name__=='__main__':main()
