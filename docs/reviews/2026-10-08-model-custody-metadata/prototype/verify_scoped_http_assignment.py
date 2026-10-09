"""Full native scoped assignment with installed commands and committed-reply loss."""
import hashlib,json,os,runpy,time
from pathlib import Path
import verify_native_bound_assignment as native
from model_engine_process import EngineProcess,EngineStillRunning
from model_engine_supervision import ScopeLimits,ScopeStillPopulated
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_SCOPED_HTTP_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
control=os.environ.get('OPENPLAN_SCOPED_HTTP_CONTROL','baseline')
if control not in ('baseline','harmless','lost-progress','lost-progress-harmless','omit-scope','cancel-progress','cancel-progress-harmless','omit-cancellation','cancel-receipt-loss','cancel-receipt-loss-harmless','omit-receipt-loss'):raise ValueError('Unknown scoped HTTP control')
handles=[]
class ScopedHttpEngine(EngineProcess):
    def __init__(self,*args,**kwargs):
        kwargs['env']=dict(kwargs['env'])
        for name in ('XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS'):
            if name in os.environ:kwargs['env'][name]=os.environ[name]
        if control!='omit-scope':kwargs['scope_limits']=ScopeLimits(1024*1024*1024,128)
        super().__init__(*args,**kwargs);handles.append(self)
        if self.scope is not None:(output/'scope-started.json').write_bytes((self.directory/'scope-started.json').read_bytes())
    def confirm_exit(self):
        deadline=time.monotonic()+5
        while True:
            try:return super().confirm_exit()
            except EngineStillRunning:
                if time.monotonic()>deadline:raise
                time.sleep(.02)
native.EngineProcess=ScopedHttpEngine
native.ROOT=output/'reports';native.ROOT.mkdir()
os.environ['OPENPLAN_NATIVE_ASSIGNMENT_HTTP_OUTPUT']=str(output/'live')
os.environ['OPENPLAN_NATIVE_ASSIGNMENT_HTTP_CONTROL']='lost-progress' if control=='omit-scope' else control
runpy.run_path(str(ROOT/'verify_native_assignment_http.py'),run_name='__main__')
result=json.loads((output/'live/result.json').read_text())
assert len(handles)==1 and handles[0].scope is not None,'Live native scope supervision missing'
handle=handles[0]
deadline=time.monotonic()+5
while True:
    try:scope=handle.scope.require_empty();break
    except ScopeStillPopulated:
        if time.monotonic()>deadline:raise
        time.sleep(.02)
started=json.loads((output/'scope-started.json').read_text())
assert all(started['scope'][name]==scope[name] for name in ('unit','invocation_id','cgroup','cgroup_device','cgroup_inode','bootstrap_pid'))
assert scope['observed_scope_empty'] is True
if control.startswith('lost-progress'):
    assert result['replay']['database_state_unchanged'] and result['replay']['http_calls_per_recovery']==[1,0]
    assert result['final_outputs_absent'] and handle.writer.stopped
elif control.startswith('cancel-'):
    if control.startswith('cancel-progress'):assert result['cancellation']['termination_observed']
    else:assert result['cancellation'] is None and result['cancellation_receipt_lost'] is True
    assert result['database_observation']['database_state_unchanged'] and result['engine_inspection']['records_unchanged']
    assert result['final_outputs_absent'] and handle.writer.stopped
else:
    assert result['native_converged'] and result['modeled_transit']=='modeled'
assert result['stage_remains_running']
report={'control':control,'scope_start':started,'scope_empty_observation':scope,'native_http':result,
        'source_sha256':{str(path.relative_to(native.WORKER.parents[1])):hashlib.sha256(path.read_bytes()).hexdigest() for path in [native.WORKER/'model_engine_process.py',native.WORKER/'model_engine_supervision.py',native.WORKER/'model_engine_bootstrap.py',native.WORKER/'model_engine_recovery.py',native.WORKER/'test_engine_scope_recovery.py',ROOT/'verify_native_assignment_http.py']},
        'limits':'Full small native assignment with production scope and installed isolated SQL. Receipt recovery uses a journal backup and does not resume the model. Native cancellation is recorded when selected. No parent-loss recovery, final publication, scientific acceptance or normal dispatch activation.'}
content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(ROOT/('scoped-http-assignment-'+control+'.json')).write_text(content);print(content)
