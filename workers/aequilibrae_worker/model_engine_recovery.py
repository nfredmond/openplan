"""Read retained engine custody and observe its scope. Never signal or resume it."""
import argparse
from contextlib import closing
from dataclasses import asdict
import hashlib,json,os,re,sqlite3,stat,subprocess
from pathlib import Path
import model_command_client as client
import model_command_recovery as commands
from model_attempt_invocation import AttemptContext
from model_engine_supervision import inspect_saved_scope,SupervisionUnavailable
from model_owner_guard_recovery import inspect_guard,validate_guard


def unique_object(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Duplicate custody record field')
        result[key]=value
    return result


def invalid_constant(value):
    raise ValueError('Invalid JSON constant')


def read_record(directory,name,*,optional=False):
    try:descriptor=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
    except FileNotFoundError:
        if optional:return None,None
        raise
    with os.fdopen(descriptor,'rb') as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_uid!=os.getuid() or before.st_mode&0o077 or before.st_size>65536:
            raise ValueError('Custody record must be a private bounded regular file')
        content=stream.read(65537);after=os.fstat(stream.fileno())
        fields=('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')
        if any(getattr(before,k)!=getattr(after,k) for k in fields) or len(content)!=before.st_size:raise ValueError('Custody record changed while reading')
    record=json.loads(content,object_pairs_hook=unique_object,parse_constant=invalid_constant)
    if not isinstance(record,dict):raise ValueError('Custody record must be an object')
    return record,hashlib.sha256(content).hexdigest()


def inspect_engine(root,journal_directory,*,base_url,deployment_id,request_id):
    records=commands._checked_records(journal_directory,base_url,deployment_id,request_id,include_resolved=True)
    if len(records)!=1 or not records[0]['resolved']:raise ValueError('Retained claim receipt required')
    command=records[0]['command'];receipt=client.checked_receipt(command,records[0]['response'])
    if command['operation']!='claim_model_stage_attempt' or receipt['outcome']!='claimed':raise ValueError('Claimed execution required')
    uri=(Path(journal_directory)/'model-commands.sqlite3').resolve().as_uri()+'?mode=ro'
    with closing(sqlite3.connect(uri,uri=True)) as connection:
        admission=connection.execute('SELECT workspace_id,entered FROM execution_admissions WHERE request_id=?',(request_id,)).fetchone()
    if admission is None or admission[1]!=1:raise ValueError('Consumed admission required')
    client._uuid(admission[0])
    context=AttemptContext(command['destination'],admission[0],command['arguments']['run_id'],command['arguments']['stage_id'],receipt['attempt_id'],request_id)
    installation=hashlib.sha256(context.destination.encode()).hexdigest()
    descriptor=os.open(Path(root),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    hashes={}
    try:
        for part in (context.run_id,'attempts',installation,context.stage_id,context.attempt_id):
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor);os.close(descriptor);descriptor=child
        owner,hashes['attempt_owner.json']=read_record(descriptor,'attempt_owner.json')
        if owner!={'schema':'openplan.attempt-workspace.v1',**asdict(context)}:raise ValueError('Attempt ownership differs from claim')
        child=os.open('engine_process',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor);os.close(descriptor);descriptor=child
        launch,hashes['launch-reserved.json']=read_record(descriptor,'launch-reserved.json')
        for key in ('run_id','stage_id','attempt_id'):
            if launch.get(key)!=getattr(context,key):raise ValueError('Engine launch differs from claim')
        if launch.get('schema')!='openplan.engine-process.v1' or not re.fullmatch(r'[0-9a-f]{64}',launch.get('command_sha256','')):raise ValueError('Unsupported engine launch record')
        started,digest=read_record(descriptor,'scope-started.json',optional=True)
        result={'run_id':context.run_id,'stage_id':context.stage_id,'attempt_id':context.attempt_id,
                'model_resumed':False,'signal_sent':False,'continuation_authorized':False,'database_status_changed':False,
                'server_ownership_checked':False,'termination_cause':'unconfirmed'}
        if started is None:return {**result,'outcome':'scope_startup_unconfirmed','record_sha256':hashes}
        hashes['scope-started.json']=digest
        if {k:v for k,v in started.items() if k!='scope'}!=launch:raise ValueError('Scope startup differs from launch')
        scope=started['scope']
        if not isinstance(scope,dict):raise ValueError('Invalid startup scope record')
        if launch.get('scope_unit')!=scope.get('unit'):raise ValueError('Scope unit differs from launch')
        guard_record,digest=read_record(descriptor,'owner-guard-started.json',optional=True)
        result['owner_guard']={'outcome':'guard_record_absent','guard_has_live_processes':None}
        guard=None
        if guard_record is None:
            if 'owner_guard_unit' in launch:raise ValueError('Required owner guard record missing')
        else:
            hashes['owner-guard-started.json']=digest
            if {k:v for k,v in guard_record.items() if k!='guard'}!=launch:
                raise ValueError('Owner guard record differs from launch')
            guard=guard_record.get('guard')
            validate_guard(guard)
            if 'owner_guard_unit' in launch and (launch['owner_guard_unit']!=guard['unit'] or launch.get('supervisor_pid')!=guard['owner_pid']):
                raise ValueError('Owner guard identity differs from launch')
            if scope.get('boot_id')!=guard['boot_id']:raise ValueError('Owner guard boot differs from engine')

        for name in ('cancellation-requested.json','cancellation-signal-written.json','cancellation-observed.json'):
            record,digest=read_record(descriptor,name,optional=True)
            result[name.removesuffix('.json').replace('-','_')]=record is not None
            if record is None:continue
            hashes[name]=digest
            if any(record.get(key)!=value for key,value in launch.items()):raise ValueError('Cancellation differs from launch')
            if name=='cancellation-requested.json':
                if record.get('signal')!='SIGKILL' or record.get('termination_observed') is not False:raise ValueError('Invalid cancellation intent')
            elif name=='cancellation-signal-written.json':
                if record.get('signal')!='SIGKILL' or record.get('signal_written') is not True or record.get('termination_observed') is not False:raise ValueError('Invalid cancellation signal receipt')
            elif record.get('termination_observed') is not True or record.get('execution_ready') is not False or record.get('database_status_changed') is not False or type(record.get('returncode')) is not int:
                raise ValueError('Invalid cancellation observation')
            saved=record.get('scope',{})
            if not isinstance(saved,dict):raise ValueError('Invalid cancellation scope record')
            if name=='cancellation-observed.json' and saved.get('observed_scope_empty') is not True:raise ValueError('Invalid empty scope observation')
            if any(saved.get(key)!=value for key,value in scope.items()):raise ValueError('Cancellation scope differs from startup')
        if result['cancellation_signal_written'] and not result['cancellation_requested']:raise ValueError('Cancellation receipt lacks intent')
        if result['cancellation_observed'] and not result['cancellation_signal_written']:raise ValueError('Cancellation observation lacks signal receipt')
        observation=inspect_saved_scope(scope)
        if guard is not None:result['owner_guard']=inspect_guard(guard)
        return {**result,**observation,'record_sha256':hashes}
    finally:os.close(descriptor)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True);parser.add_argument('--journal',type=Path,required=True)
    parser.add_argument('--base-url',required=True);parser.add_argument('--deployment-id',required=True);parser.add_argument('--request-id',required=True)
    args=parser.parse_args(argv)
    try:result=inspect_engine(args.root,args.journal,base_url=args.base_url,deployment_id=args.deployment_id,request_id=args.request_id)
    except (ValueError,TypeError,KeyError,OSError,sqlite3.Error,SupervisionUnavailable,subprocess.TimeoutExpired):
        print(json.dumps({'outcome':'engine_inspection_refused','model_resumed':False,'signal_sent':False,'continuation_authorized':False}));return 3
    print(json.dumps(result,sort_keys=True));return 0

if __name__=='__main__':raise SystemExit(main())
