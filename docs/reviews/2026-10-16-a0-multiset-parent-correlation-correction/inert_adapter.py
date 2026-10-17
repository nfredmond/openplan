"""Future inert controls only. Logical paths stay fixed; all writes stay in scratch."""
import builtins
import contextlib
import fcntl
import os
from pathlib import Path as RealPath, PurePosixPath
import subprocess
import sys
import types

PUBLIC=RealPath(__file__).resolve().parent
LOGICAL_ROOT='/home/nathaniel/.local/state/openplan/a0-multiset-parent-correlation-correction-20261016'
LOGICAL_SUBJECT='/home/nathaniel/.local/state/openplan/a0-catalogue-dependency-multiset-correction-20261016'
LOGICAL_LOCK='/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock'
UNIT='openplan-a0-catalogue-dependency-multiset-20261016'
WRAPPER_PID=710002
FIXED_ENTRY='exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 PYTHONDONTWRITEBYTECODE=1 INVOCATION_ID="$INVOCATION_ID" /usr/bin/python3 -B /home/nathaniel/.local/state/openplan/a0-catalogue-dependency-multiset-correction-20261016/runtime/catalogue.py --capture-once'
FIXED_MANAGER_ARGV=['/usr/bin/systemd-run','--user','--wait','--pipe','--collect',
    '--unit=openplan-a0-catalogue-dependency-multiset-20261016','-p','RuntimeMaxSec=180','-p','MemoryMax=512M',
    '-p','MemorySwapMax=0','-p','CPUQuota=50%','-p','TasksMax=64','-p','UMask=0077','/bin/sh','-c',FIXED_ENTRY]


def manager_environment(uid):
    return {'PATH':'/usr/bin:/bin','HOME':'/home/nathaniel','LANG':'C.UTF-8',
        'XDG_RUNTIME_DIR':'/run/user/'+str(uid),'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/'+str(uid)+'/bus'}


class Surface:
    def __init__(self,scratch,readonly,source):
        self.scratch=RealPath(scratch);self.readonly=set(readonly);self.source=source
        self.events=[];self.fds={};self.streams=[];self.fault=None;self.used=set();self.stage=lambda:None
        self.wait_bytes=b'';self.popen_count=0;self.lock_events=[];self.diagnostics=[]
        surface=self
        class LogicalPath:
            def __init__(self,*parts):
                self.logical=PurePosixPath(*(str(p) for p in parts))
                if not self.logical.is_absolute() or '..' in self.logical.parts:raise ValueError('adapter-path-shape')
            def __str__(self):return str(self.logical)
            def __repr__(self):return 'LogicalPath('+repr(str(self))+')'
            def __fspath__(self):return str(surface.physical(self))
            def __truediv__(self,item):return LogicalPath(self.logical/str(item))
            def __eq__(self,other):return type(other) is type(self) and self.logical==other.logical
            def __hash__(self):return hash(self.logical)
            @property
            def parent(self):return LogicalPath(self.logical.parent)
            @property
            def parents(self):return tuple(LogicalPath(p) for p in self.logical.parents)
            @property
            def name(self):return self.logical.name
            def with_name(self,name):return LogicalPath(self.logical.with_name(name))
            def resolve(self):return self
            def lstat(self):return surface.physical(self).lstat()
            def stat(self):return surface.physical(self).stat()
            def is_symlink(self):return surface.physical(self).is_symlink()
            def is_file(self):return surface.physical(self).is_file()
            def is_dir(self):return surface.physical(self).is_dir()
            def exists(self):return surface.physical(self).exists()
            def iterdir(self):
                for item in surface.physical(self).iterdir():yield self/item.name
            def mkdir(self,mode=0o777,parents=False,exist_ok=False):
                surface.writable(self);return surface.physical(self).mkdir(mode=mode,parents=parents,exist_ok=exist_ok)
        self.Path=LogicalPath
        self.os=OS(self,False);self.collector_os=OS(self,True)
        self.fcntl=types.SimpleNamespace(LOCK_EX=fcntl.LOCK_EX,LOCK_NB=fcntl.LOCK_NB,flock=self.flock)
        self.subprocess=types.SimpleNamespace(PIPE=subprocess.PIPE,DEVNULL=subprocess.DEVNULL,Popen=self.popen)

    def physical(self,path):
        logical=str(path)
        if logical in self.source:return self.source[logical]
        root_files={'operation-source-pins.json','root-operation-intent.json','root-preflight.json',
            'root-risk-decision.json','root-risk-evidence.json'}
        parent_files={'intent.json','returned-process.json','stdout.bin','stderr.bin','terminal.json',
            'collection-return.json','result.json','failure.json','lock-release-failure.json'}
        root_allowed={''}|root_files|{'catalogue-parent-attempt','collector-case','record-case','record-case/record.json'}
        root_allowed|={'catalogue-parent-attempt/'+name for name in parent_files}
        root_allowed|={'collector-case/'+name for name in ['returned-process.json','stdout.bin','stderr.bin','terminal.json']}
        if logical==LOGICAL_ROOT or logical.startswith(LOGICAL_ROOT+'/'):
            relative=logical[len(LOGICAL_ROOT):].lstrip('/')
            if relative in root_allowed:return self.scratch/'root'/relative
        subject_allowed={'','catalogue-admission.json','source-review.md','operation-review.md','catalogue-attempt'}
        subject_allowed|={'catalogue-attempt/'+name for name in ['intent.json','manager-ack.json','complete.json',
            'before.json','catalogue.json','verification.json']}
        for n in range(1,8):
            prefix='catalogue-attempt/request-'+str(n).zfill(3)
            subject_allowed.add(prefix)
            names=['intent.json','input.bin','returned-process.json','stdout.bin','stderr.bin','terminal.json']
            if n in [4,5,6]:names+=['ready.stdout','ready.json','dependent.sql','dependent-intent.json']
            subject_allowed|={prefix+'/'+name for name in names}
        if logical==LOGICAL_SUBJECT or logical.startswith(LOGICAL_SUBJECT+'/'):
            relative=logical[len(LOGICAL_SUBJECT):].lstrip('/')
            if relative in subject_allowed:return self.scratch/'subject'/relative
        if logical==LOGICAL_LOCK:return self.scratch/'compiler-file-model'
        if logical in self.readonly:return RealPath(logical)
        raise ValueError('adapter-unapproved-path:'+logical)

    def writable(self,path):
        logical=str(path);physical=self.physical(path)
        if logical in self.readonly or logical in self.source:raise ValueError('adapter-readonly-write')
        if not physical.is_relative_to(self.scratch):raise ValueError('adapter-write-outside-scratch')

    def trip(self,key):
        if self.fault==key and key not in self.used:
            self.used.add(key);self.events.append(('fault',key));raise OSError(5,'INERT_'+key)

    def fopen(self,path,mode='r',*args,**kwargs):
        if any(x in mode for x in 'wax+'):self.writable(path)
        if str(path).endswith('/stderr.bin'):self.trip('second-output-open')
        stream=builtins.open(self.physical(path),mode,*args,**kwargs)
        wrapped=File(self,stream,str(path),'output');self.streams.append(wrapped);return wrapped

    def flock(self,file,flags):
        fd=file if type(file) is int else file.fileno()
        if flags!=fcntl.LOCK_EX|fcntl.LOCK_NB or type(fd) is not int:raise ValueError('adapter-flock-shape')
        os.fstat(fd);self.lock_events.append(fd)
        if len(self.lock_events)!=1:raise ValueError('adapter-flock-repeated')
        # Inert delegate only. The future root wrapper owns the actual compiler lock.

    def popen(self,argv,**kwargs):
        if argv!=FIXED_MANAGER_ARGV or kwargs!={'stdin':subprocess.DEVNULL,'stdout':subprocess.PIPE,
            'stderr':subprocess.PIPE,'env':manager_environment(os.getuid()),'close_fds':True}:
            raise ValueError('adapter-popen-fixed-construction')
        self.popen_count+=1
        if self.popen_count!=1:raise ValueError('adapter-popen-repeated')
        self.stage();self.events.append(('fake-popen',WRAPPER_PID))
        pipes=[]
        for label,data in [('stdout',b''),('stderr',self.wait_bytes)]:
            r,w=os.pipe()
            try:
                if data:os.write(w,data)
            finally:os.close(w)
            stream=File(self,os.fdopen(r,'rb',buffering=0),'pipe:'+label,'pipe')
            self.streams.append(stream);pipes.append(stream)
        return types.SimpleNamespace(pid=WRAPPER_PID,stdout=pipes[0],stderr=pipes[1],wait=lambda timeout:0)

    def restore(self):
        # Attempt every owned close. An unexpected close error cannot become a named kill.
        errors=[]
        for stream in self.streams:
            if not stream.closed:
                try:stream.real.close()
                except BaseException as error:errors.append(type(error).__name__+':'+str(error))
        for fd in list(self.fds):
            try:os.close(fd)
            except BaseException as error:errors.append(type(error).__name__+':'+str(error))
            else:self.fds.pop(fd,None)
        self.diagnostics.extend(errors)
        if errors:raise RuntimeError('inert-finally-close-failure:'+repr(errors))


class File:
    def __init__(self,surface,real,label,kind='fdopen'):self.surface=surface;self.real=real;self.label=label;self.kind=kind
    def __getattr__(self,name):return getattr(self.real,name)
    def __enter__(self):return self
    def __exit__(self,*args):self.close()
    def fileno(self):return self.real.fileno()
    @property
    def closed(self):return self.real.closed
    def close(self):
        self.surface.events.append(('stream-close',self.label));self.real.close()


class OS:
    def __init__(self,surface,faults):
        self.surface=surface;self.faults=faults
        self.path=types.SimpleNamespace(lexists=lambda p:os.path.lexists(surface.physical(p)))
    def __getattr__(self,name):return getattr(os,name)
    def umask(self,mask):
        if mask!=0o077:raise ValueError('adapter-umask')
        return 0o077
    def open(self,path,flags,mode=0o777):
        s=self.surface
        if flags&(os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND):s.writable(path)
        if self.faults and str(path).endswith('/terminal.json'):
            s.events.append(('terminal-attempt',str(path)));s.trip('terminal-open')
        fd=os.open(s.physical(path),flags,mode);s.fds[fd]=str(path);return fd
    def fdopen(self,fd,*args,**kwargs):
        s=self.surface;stream=File(s,os.fdopen(fd,*args,**kwargs),s.fds.pop(fd,'fdopen'))
        s.streams.append(stream);return stream
    def read(self,fd,count):
        if self.faults:self.surface.trip('primary-read')
        return os.read(fd,count)
    def write(self,fd,data):
        if self.faults and self.surface.fault in ['record-write-close','record-write-close-sync']:
            self.surface.trip(self.surface.fault)
        return os.write(fd,data)
    def fsync(self,fd):
        s=self.surface
        if self.faults:
            for stream in s.streams:
                if not stream.closed and stream.fileno()==fd and stream.label.endswith('/stdout.bin'):
                    if s.fault=='primary-read' and 'read-followup-fsync' not in s.used:
                        s.used.add('read-followup-fsync');raise OSError(5,'INERT_followup_fsync')
                    if s.fault=='cleanup-only' and 'cleanup-only' not in s.used:
                        s.used.add('cleanup-only');raise OSError(5,'INERT_cleanup_only')
            if s.fault=='record-write-close-sync' and s.fds.get(fd,'').endswith('/record-case'):
                raise OSError(5,'INERT_directory_sync')
        return os.fsync(fd)
    def close(self,fd):
        s=self.surface;label=s.fds.pop(fd,'');os.close(fd);s.events.append(('fd-close',label))
        if self.faults and s.fault in ['record-write-close','record-write-close-sync'] and label.endswith('/record.json'):
            raise OSError(5,'INERT_record_close')


@contextlib.contextmanager
def loaded(surface,source_bytes):
    """Load only these three new parent sources in a future granted process."""
    names=['custody','collector','outer'];saved={name:sys.modules.get(name) for name in names}
    missing={name for name in names if name not in sys.modules};modules={};original_globals={}
    try:
        for name in names:
            module=types.ModuleType(name);module.__file__=str(PUBLIC/(name+'.py'))
            sys.modules[name]=module;modules[name]=module
            exec(compile(source_bytes[name+'.py'],module.__file__,'exec'),module.__dict__)
        original_globals={name:dict(module.__dict__) for name,module in modules.items()}
        c=modules['custody'];surface.c=c;c.Path=surface.Path;c.os=surface.os
        for name in ['HERE','ROOT','SUBJECT']:setattr(c,name,surface.Path(str(getattr(c,name))))
        outer=modules['outer'];outer.Path=surface.Path;outer.os=surface.os
        for name in ['ROOT','SUBJECT','LOCK']:setattr(outer,name,surface.Path(str(getattr(outer,name))))
        outer.fcntl=surface.fcntl;outer.sys=types.SimpleNamespace(argv=[str(PUBLIC/'outer.py'),'--record-once'],stderr=sys.stderr)
        collector=modules['collector'];collector.os=surface.collector_os;collector.open=surface.fopen;collector.subprocess=surface.subprocess
        if str(c.ROOT)!=LOGICAL_ROOT or str(c.SUBJECT)!=LOGICAL_SUBJECT or c.UNIT!=UNIT:
            raise ValueError('adapter-literal-binding-drift')
        yield types.SimpleNamespace(c=c,collector=collector,outer=outer,surface=surface)
    finally:
        try:surface.restore()
        finally:
            for name,values in original_globals.items():
                modules[name].__dict__.clear();modules[name].__dict__.update(values)
            for name in names:
                if name in missing:sys.modules.pop(name,None)
                else:sys.modules[name]=saved[name]
