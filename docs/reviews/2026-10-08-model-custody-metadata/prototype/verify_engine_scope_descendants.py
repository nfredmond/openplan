"""Observe detached descendants in an owned scope before selecting a launch adapter."""
import hashlib,json,os,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
sys.path.insert(0,str(WORKER))
from model_engine_process import EngineProcess
from test_model_engine_process import EngineProcessTests

DESCENDANT='''
import json,os,sys,time
from pathlib import Path
root=Path(sys.argv[1])
(root/'descendant.json').write_text(json.dumps({'pid':os.getpid(),'pgid':os.getpgrp(),'sid':os.getsid(0),'cgroup':Path('/proc/self/cgroup').read_text()}))
deadline=time.monotonic()+20
while not (root/'release-descendant').exists() and time.monotonic()<deadline:time.sleep(.02)
'''
LEADER='''
import json,os,subprocess,sys,time
from pathlib import Path
from model_engine_channel import inherited_progress_client
root=Path(sys.argv[1]);client=inherited_progress_client()
client.progress('Owned scope startup before detached descendant')
client.stop()
(root/'leader.json').write_text(json.dumps({'pid':os.getpid(),'pgid':os.getpgrp(),'cgroup':Path('/proc/self/cgroup').read_text()}))
subprocess.Popen([sys.executable,'-B','-c',sys.argv[2],str(root)],start_new_session=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,close_fds=True)
deadline=time.monotonic()+5
while not (root/'descendant.json').exists():
 if time.monotonic()>deadline:raise RuntimeError('Descendant readiness timed out')
 time.sleep(.02)
'''

def scope_state(unit):
    result=subprocess.run(['systemctl','--user','show',unit,'-p','ControlGroup','-p','InvocationID','-p','ActiveState','-p','LoadState','-p','MemoryMax','-p','TasksMax'],capture_output=True,text=True,timeout=5)
    if result.returncode:raise RuntimeError('Owned scope query failed: '+result.stderr)
    return dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)

def main():
    output=Path(os.environ['OPENPLAN_ENGINE_SCOPE_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
    control=os.environ.get('OPENPLAN_ENGINE_SCOPE_CONTROL','baseline')
    if control not in ('baseline','harmless','process-group-only'):raise ValueError('Unknown scope control')
    fixture=EngineProcessTests();fixture.setUp();handle=None;root=None
    unit='openplan-engine-probe-'+uuid.uuid4().hex+'.scope'
    try:
        fixture.prepared();fixture.writer.get=fixture.get;root=fixture.writer.files.path
        argv=['systemd-run','--user','--scope','--quiet','--unit='+unit,'--property=MemoryMax=128M','--property=TasksMax=16','--',sys.executable,'-B','-c',LEADER+('\n# Harmless comment.\n' if control=='harmless' else ''),str(root),DESCENDANT]
        handle=EngineProcess(fixture.writer,argv,env=dict(os.environ,PYTHONPATH=str(WORKER)),progress=True)
        handle.progress.connection.settimeout(10);handle.progress.serve_one()
        assert handle.process.wait(timeout=10)==0
        leader=json.loads((root/'leader.json').read_text());descendant=json.loads((root/'descendant.json').read_text())
        assert descendant['pid']==descendant['pgid']==descendant['sid'] and descendant['pgid']!=leader['pgid']
        observed=handle.confirm_exit()
        assert observed['observed_original_process_group_empty'] and observed['execution_ready'] is False
        state=scope_state(unit)
        assert state['ActiveState']=='active' and len(state['InvocationID'])==32
        assert state['ControlGroup'].endswith('/'+unit)
        assert leader['cgroup']==descendant['cgroup']=='0::'+state['ControlGroup']+'\n'
        cgroup=Path('/sys/fs/cgroup')/state['ControlGroup'].lstrip('/')
        events=dict(line.split() for line in (cgroup/'cgroup.events').read_text().splitlines())
        assert events['populated']=='1'
        assert int(state['MemoryMax'])==128*1024*1024 and int(state['TasksMax'])==16
        # A process-group-only substitute must fail the descendant completion check.
        would_allow_capture=observed['observed_original_process_group_empty'] if control=='process-group-only' else events['populated']=='0'
        assert would_allow_capture is False,'Detached descendant escaped completion check'
        (root/'release-descendant').touch()
        deadline=time.monotonic()+10
        while True:
            final=scope_state(unit)
            if final['ActiveState']=='inactive' and not cgroup.exists():break
            if time.monotonic()>deadline:raise RuntimeError('Owned scope did not become empty')
            time.sleep(.05)
        report={'control':control,'unit':unit,'scope_identity':state,'leader':leader,'detached_descendant':descendant,
                'progress_channel_confirmed':True,'original_group_empty_while_scope_populated':True,'completion_refused_while_descendant_live':True,
                'scope_removed_after_descendant_exit':True,'legacy_exit_receipt':observed,'worker_sha256':hashlib.sha256((WORKER/'model_engine_process.py').read_bytes()).hexdigest(),
                'limits':'Linux user scope feasibility with real launch and progress channel. No production scope adapter, startup gate, parent-loss recovery, migration-resistant sandbox, output publication or scientific acceptance.'}
        content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(ROOT/('engine-scope-descendants-'+control+'.json')).write_text(content);print(content)
    finally:
        # Release only this fixture's descendant. Its independent 20-second deadline
        # also bounds cleanup if the parent fails before it can create this marker.
        if root is not None:(root/'release-descendant').touch(exist_ok=True)
        if handle is not None:
            handle.progress.stop()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)
        deadline=time.monotonic()+10
        while scope_state(unit)['ActiveState'] not in ('inactive','failed'):
            if time.monotonic()>deadline:raise RuntimeError('Owned probe scope still active at cleanup')
            time.sleep(.05)
        fixture.doCleanups()

if __name__=='__main__':main()
