"""Join the full native synthetic assignment to the production scope startup gate."""
import json,os,time
from pathlib import Path
import verify_native_bound_assignment as native
from model_engine_process import EngineProcess,EngineStillRunning
from model_engine_supervision import ScopeLimits
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_SCOPED_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
control=os.environ.get('OPENPLAN_NATIVE_SCOPED_CONTROL','baseline')
if control not in ('baseline','harmless','omit-scope'):raise ValueError('Unknown scoped native control')
class ScopedNativeEngine(EngineProcess):
    def __init__(self,*args,**kwargs):
        kwargs['env']=dict(kwargs['env'])
        for name in ('XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS'):
            if name in os.environ:kwargs['env'][name]=os.environ[name]
        if control!='omit-scope':kwargs['scope_limits']=ScopeLimits(1024*1024*1024,128)
        super().__init__(*args,**kwargs)
        if self.scope is not None:(output/'scope-started.json').write_bytes((self.directory/'scope-started.json').read_bytes())
    def confirm_exit(self):
        deadline=time.monotonic()+5
        while True:
            try:return super().confirm_exit()
            except EngineStillRunning:
                if time.monotonic()>deadline:raise
                time.sleep(.02)
native.EngineProcess=ScopedNativeEngine
native.ROOT=output/'reports';native.ROOT.mkdir()
os.environ['OPENPLAN_BOUND_ASSIGNMENT_OUTPUT']=str(output/'native')
os.environ['OPENPLAN_BOUND_ASSIGNMENT_CONTROL']='harmless' if control=='harmless' else 'baseline'
native.main()
result=json.loads((output/'native/result.json').read_text())
receipt=result['exit_receipt']
assert receipt.get('scope',{}).get('observed_scope_empty') is True,'Native scope supervision missing'
started=json.loads((output/'scope-started.json').read_text())
assert started['scope']['invocation_id']==receipt['scope']['invocation_id']
assert started['scope']['cgroup_inode']==receipt['scope']['cgroup_inode']
report={'control':control,'scope_start':started,'exit_receipt':receipt,'engine_version':result['engine_version'],
        'convergence':result['convergence'],'loaded_links':result['loaded_links'],'modeled_transit':result['mode_split']['transit_status'],
        'artifact_count':len(result['artifacts']),'worker_sha256':result['worker_sha256'],
        'limits':'Full synthetic native assignment with production scope startup and exit checks. Mocked parent database transport. No parent-loss recovery, cancellation, output publication, scientific acceptance or normal dispatch activation.'}
content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(ROOT/('native-scoped-assignment-'+control+'.json')).write_text(content);print(content)
