"""Disposable native supervisor held at one confirmed iteration for parent-loss testing."""
import json,os,sys,time,uuid
from pathlib import Path
import requests
import verify_native_bound_assignment as native
from model_engine_process import EngineProcess,EngineStillRunning
from model_engine_supervision import ScopeLimits
import model_engine_process as engine_module
from model_engine_supervision import OwnedEngineScope
import model_attempt_invocation as invocation
import model_attempt_writer as managed

config=json.loads(Path(sys.argv[1]).read_text());output=Path(config['output'])
key=os.environ['OPENPLAN_PARENT_PROOF_SERVICE_KEY']
def hold_parent(writer,scope):
    ready={'supervisor_pid':os.getpid(),'engine_pid':scope['bootstrap_pid'],'root':str(writer.files.root),
           'work_directory':str(writer.files.path),'journal':str(writer.directory),
           'claim_request_id':writer.context.claim_request_id,'scope':scope}
    path=output/'parent-ready.json';temporary=output/'parent-ready.tmp'
    with temporary.open('x') as stream:
        json.dump(ready,stream);stream.flush();os.fsync(stream.fileno())
    temporary.replace(path)
    deadline=time.monotonic()+30
    while not (output/'release-parent').exists():
        if time.monotonic()>deadline:raise RuntimeError('Parent-loss fixture hold expired')
        time.sleep(.02)

active={}
class Fixture:
    live_transport=True
    def setUp(self):
        self.directory=Path(config['journal']);self.get=requests.get
        self.artifact={name:str(uuid.uuid4()) for name in ('id','stage_id','attempt_id')}
        self.writer=invocation.invoke_new_attempt(self.directory,run_id=config['run_id'],stage_id=config['stage_id'],worker_id='native-parent-loss-proof',workspace_id=config['workspace_id'],
            base_url=config['base_url'],deployment_id=config['deployment_id'],service_key=key,
            handler=lambda context:managed.AttemptWriter(self.directory,context,base_url=config['base_url'],deployment_id=config['deployment_id'],service_key=key))
        assert self.writer is not None,'Native parent claim was not admitted'
        active['writer']=self.writer
    def doCleanups(self):pass

class SupervisedEngine(EngineProcess):
    def __init__(self,*args,**kwargs):
        kwargs['env']=dict(kwargs['env'])
        for name in ('XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS'):
            if name in os.environ:kwargs['env'][name]=os.environ[name]
        kwargs['scope_limits']=ScopeLimits(1024*1024*1024,128)
        super().__init__(*args,**kwargs)
        send=self.progress.send;held=False
        def hold_iteration(payload):
            nonlocal held
            if not held and 'Assignment iteration' in (self.writer.state or {}).get('log_tail',''):
                held=True
                hold_parent(self.writer,self.scope.identity)
            return send(payload)
        self.progress.send=hold_iteration
    def confirm_exit(self):
        deadline=time.monotonic()+5
        while True:
            try:return super().confirm_exit()
            except EngineStillRunning:
                if time.monotonic()>deadline:raise
                time.sleep(.02)
native.ProjectWorkingCopyTests=Fixture;native.EngineProcess=SupervisedEngine
native.ROOT=output/'reports';native.ROOT.mkdir()
os.environ['OPENPLAN_BOUND_ASSIGNMENT_OUTPUT']=str(output/'native')
os.environ['OPENPLAN_BOUND_ASSIGNMENT_CONTROL']='baseline'
if config['harmless']:native.CHILD+='\n# Harmless native parent-loss comment.\n'
if config['swallow']:
    native.CHILD=native.CHILD.replace('import main\n',"import main\noriginal_stream=main.stream_assignment_progress\ndef swallow(*args,**kwargs):\n kwargs['fatal_exceptions']=()\n return original_stream(*args,**kwargs)\nmain.stream_assignment_progress=swallow\n")
if config.get('startup'):
    verify=OwnedEngineScope.verify_start;record=engine_module._record
    def verified(scope,pid):
        result=verify(scope,pid);active['scope']=scope;return result
    def startup_record(descriptor,name,value):
        if name!='scope-started.json':return record(descriptor,name,value)
        if config['startup']=='after':record(descriptor,name,value)
        if config['startup']=='early':
            active['scope'].authorize()
            deadline=time.monotonic()+10
            while not (active['writer'].files.path/'engine-started').exists():
                if time.monotonic()>deadline:raise RuntimeError('Early-start fault did not execute engine')
                time.sleep(.02)
        hold_parent(active['writer'],value['scope'])
        if config['startup']!='after':record(descriptor,name,value)
    OwnedEngineScope.verify_start=verified;engine_module._record=startup_record
    native.CHILD="from pathlib import Path\nPath('engine-started').touch()\n"+native.CHILD
native.main()
