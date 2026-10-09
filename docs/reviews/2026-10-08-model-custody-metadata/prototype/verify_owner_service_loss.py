"""Terminate disposable owner services and observe independently scoped children.

Source copies permit harmless and faulty controls without editing the checkout.
No database or native model is involved; only pinned owned cgroups are signaled.
"""
import hashlib,json,os,subprocess,sys,time,uuid
from pathlib import Path
from verify_busy_owner_loss import SUPERVISOR,WORKER,wait_for
sys.path.insert(0,str(WORKER))
from model_engine_supervision import inspect_saved_scope


def state(unit):
    result=subprocess.run(['systemctl','--user','show',unit,'-p','ActiveState','-p','ControlGroup','-p','InvocationID'],capture_output=True,text=True,check=True)
    return dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)


def pin(group):
    directory=os.open('/sys/fs/cgroup'+group,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:return os.open('cgroup.kill',os.O_WRONLY|os.O_NOFOLLOW,dir_fd=directory)
    finally:os.close(directory)


def one(output,mode):
    output.mkdir(mode=0o700)
    modules=output/'modules';modules.mkdir()
    hashes={}
    for name in ('model_engine_owner_guard.py','model_engine_supervision.py','model_engine_bootstrap.py'):
        source=(WORKER/name).read_text();hashes[name]=hashlib.sha256(source.encode()).hexdigest()
        if name=='model_engine_owner_guard.py':
            if mode=='harmless':source+='\n# Harmless scope independence control.\n'
            if mode=='ignore-owner-loss':
                assert source.count('    poller.poll()')==1
                source=source.replace('    poller.poll()','    poller.poll()\n    import time;time.sleep(25)')
        (modules/name).write_text(source)
    code=SUPERVISOR.replace('scope=OwnedEngineScope(ScopeLimits(128*1024*1024,16))',
        "from model_engine_owner_guard import OwnerGuard\nguard=OwnerGuard()\nscope=OwnedEngineScope(ScopeLimits(128*1024*1024,16),owner_guard=guard)")
    code=code.replace("(out/'owner-ready').touch()", "(out/'guard.json').write_text(json.dumps(guard.identity))\n (out/'owner-ready').touch()")
    script=output/'owner.py';script.write_text(code)
    unit='openplan-owner-service-proof-'+uuid.uuid4().hex+'.service'
    descriptors=[];identity=guard=None
    try:
        subprocess.run(['systemd-run','--user','--quiet','--unit='+unit,'-p','Type=exec','-p','MemoryMax=134217728','-p','MemorySwapMax=0','-p','TasksMax=32',
            '--setenv=PYTHONPATH='+str(modules),'--',sys.executable,'-B',str(script),str(output)],check=True,capture_output=True,text=True)
        wait_for(lambda:(output/'owner-ready').exists(),timeout=10)
        owner=state(unit);identity=json.loads((output/'identity.json').read_text());guard=json.loads((output/'guard.json').read_text())
        assert owner['ActiveState']=='active'
        assert guard['cgroup']!=owner['ControlGroup'] and not guard['cgroup'].startswith(owner['ControlGroup']+'/'),'Guard stayed inside owner service'
        for group in (owner['ControlGroup'],guard['cgroup'],identity['cgroup']):descriptors.append(pin(group))
        wait_for(lambda:(output/'engine-ready').exists() and (output/'descendant-ready').exists())
        assert inspect_saved_scope(identity)['scope_has_live_processes'] is True
        if mode=='owner-alive':
            (output/'release').touch()
            wait_for(lambda:(output/'engine-output').exists() and (output/'descendant-output').exists())
            assert state(unit)['ActiveState']=='active' and state(guard['unit'])['ActiveState']=='active'
            result={'owner_alive_outputs_present':True}
        else:
            os.write(descriptors[0],b'1')
            wait_for(lambda:state(unit)['ActiveState'] in ('inactive','failed'))
            deadline=time.monotonic()+3
            while inspect_saved_scope(identity)['scope_has_live_processes'] is not False and time.monotonic()<deadline:time.sleep(.02)
            stopped=inspect_saved_scope(identity)['scope_has_live_processes'] is False
            if mode=='ignore-owner-loss':
                assert not stopped,'Fault did not preserve the engine as intended'
                (output/'release').touch()
                wait_for(lambda:(output/'engine-output').exists() and (output/'descendant-output').exists())
                result={'fault_detected':'Engine and detached child wrote after owner-service loss'}
            else:
                assert stopped,'Engine survives owner-service loss'
                assert state(guard['unit'])['ActiveState'] in ('inactive','failed')
                (output/'release').touch()
                assert not (output/'engine-output').exists() and not (output/'descendant-output').exists()
                result={'owner_service_terminated':True,'engine_scope_empty':True,'guard_scope_stopped':True,'outputs_absent':True}
        return {'mode':mode,'owner_unit':unit,'owner_invocation':owner['InvocationID'],'guard_outside_owner_service':True,'sources':hashes,**result}
    finally:
        for descriptor in descriptors:
            try:os.write(descriptor,b'1')
            except OSError as error:
                if error.errno not in (2,19):raise
            finally:os.close(descriptor)
        # If startup failed before pinning, stop only the service created here.
        if not descriptors:subprocess.run(['systemctl','--user','stop',unit],check=True)
        wait_for(lambda:state(unit)['ActiveState'] in ('inactive','failed'))
        if identity is not None:wait_for(lambda:inspect_saved_scope(identity)['scope_has_live_processes'] is False)
        if guard is not None:wait_for(lambda:state(guard['unit'])['ActiveState'] in ('inactive','failed'))


if __name__=='__main__':
    output=Path(os.environ['OPENPLAN_OWNER_SERVICE_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
    results=[one(output/mode,mode) for mode in ('baseline','owner-alive','harmless','ignore-owner-loss','restored')]
    report={'cases':results,'cleanup':'All owned services, guard scopes and engine scopes observed stopped or empty',
        'limits':['Synthetic engine and detached child only','No native model, database, scientific or human acceptance','Saved identities do not authorize restart'],
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);print(content)
