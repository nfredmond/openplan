"""Owned Linux scope startup and observation, without saved-receipt relaunch.

A user scope detects detached sessions, but is not a same-user migration sandbox.
"""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import uuid


class SupervisionUnavailable(RuntimeError):pass
class ScopeStillPopulated(RuntimeError):pass


@dataclass(frozen=True)
class ScopeLimits:
    memory_bytes:int
    tasks:int

    def __post_init__(self):
        for value in (self.memory_bytes,self.tasks):
            if type(value) is not int or value<=0:raise ValueError('Scope limits must be positive integers')


class OwnedEngineScope:
    """Hold a live startup gate until a caller durably records verified identity."""
    def __init__(self,limits):
        if not isinstance(limits,ScopeLimits):raise ValueError('Explicit ScopeLimits required')
        self.runner=shutil.which('systemd-run');self.controller=shutil.which('systemctl')
        if sys.platform!='linux' or not self.runner or not self.controller or not Path('/sys/fs/cgroup/cgroup.controllers').is_file():
            raise SupervisionUnavailable('Linux user systemd and cgroup v2 are required')
        self.limits=limits
        self.unit='openplan-engine-'+uuid.uuid4().hex+'.scope'
        self.parent,self.child=socket.socketpair()
        self.parent.settimeout(10)
        self.identity=None

    def command(self,argv):
        return [self.runner,'--user','--scope','--quiet','--expand-environment=no','--unit='+self.unit,
                '--property=MemoryMax='+str(self.limits.memory_bytes),'--property=TasksMax='+str(self.limits.tasks),'--',
                sys.executable,'-B',str(Path(__file__).with_name('model_engine_bootstrap.py')),str(self.child.fileno()),*argv]

    def state(self):
        result=subprocess.run([self.controller,'--user','show',self.unit,'-p','LoadState','-p','ActiveState','-p','InvocationID',
                               '-p','ControlGroup','-p','MemoryMax','-p','TasksMax','-p','Result'],capture_output=True,text=True,timeout=5)
        if result.returncode:raise SupervisionUnavailable('Owned user scope could not be queried')
        return dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)

    def verify_start(self,pid):
        self.child.close()
        content=bytearray()
        while not content.endswith(b'\n'):
            block=self.parent.recv(4096-len(content))
            if not block:raise SupervisionUnavailable('Scope bootstrap closed before readiness')
            content.extend(block)
            if len(content)>=4096:raise ValueError('Scope readiness exceeds limit')
        ready=json.loads(content)
        if set(ready)!={'pid','cgroup'} or type(ready['pid']) is not int or ready['pid']!=pid:
            raise ValueError('Scope bootstrap process identity differs')
        state=self.state()
        group=state.get('ControlGroup','')
        if state.get('LoadState')!='loaded' or state.get('ActiveState')!='active' or not re.fullmatch(r'[0-9a-f]{32}',state.get('InvocationID','')):
            raise ValueError('Scope startup identity is incomplete')
        if not group.startswith('/user.slice/') or '..' in Path(group).parts or not group.endswith('/'+self.unit):
            raise ValueError('Scope cgroup identity differs')
        if ready['cgroup']!='0::'+group+'\n' or Path(f'/proc/{pid}/cgroup').read_text()!=ready['cgroup']:
            raise ValueError('Bootstrap is outside the owned scope')
        if state.get('MemoryMax')!=str(self.limits.memory_bytes) or state.get('TasksMax')!=str(self.limits.tasks):
            raise ValueError('Scope resource policy differs')
        directory=Path('/sys/fs/cgroup')/group.lstrip('/')
        descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:info=os.fstat(descriptor)
        finally:os.close(descriptor)
        self.identity={'schema':'openplan.engine-scope.v1','unit':self.unit,'invocation_id':state['InvocationID'],
                       'cgroup':group,'cgroup_device':info.st_dev,'cgroup_inode':info.st_ino,'bootstrap_pid':pid,
                       'memory_bytes':self.limits.memory_bytes,'tasks':self.limits.tasks}
        return dict(self.identity)

    def authorize(self):
        if self.identity is None:raise ValueError('Scope identity is not verified')
        self.parent.sendall(b'G')
        self.parent.close()

    def require_empty(self):
        if self.identity is None:raise ValueError('Scope identity is not verified')
        state=self.state();directory=Path('/sys/fs/cgroup')/self.identity['cgroup'].lstrip('/')
        if state.get('LoadState')=='not-found' and state.get('ActiveState')=='inactive' and not directory.exists():
            return {**self.identity,'observed_scope_empty':True,'scope_result':state.get('Result')}
        if state.get('InvocationID')!=self.identity['invocation_id'] or state.get('ControlGroup')!=self.identity['cgroup']:
            raise ValueError('Owned scope identity changed')
        try:descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        except FileNotFoundError as error:
            raise ScopeStillPopulated('Owned scope removal observation has not settled') from error
        try:
            info=os.fstat(descriptor)
            if (info.st_dev,info.st_ino)!=(self.identity['cgroup_device'],self.identity['cgroup_inode']):
                raise ValueError('Owned cgroup directory changed')
            event=os.open('cgroup.events',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=descriptor)
            with os.fdopen(event) as stream:events=dict(line.split() for line in stream)
        finally:os.close(descriptor)
        if events.get('populated')!='0':raise ScopeStillPopulated('Owned engine scope still has live descendants')
        if state.get('ActiveState') not in ('inactive','failed'):raise ScopeStillPopulated('Owned engine scope has not settled')
        if state.get('Result')!='success':raise RuntimeError('Owned engine scope failed')
        return {**self.identity,'observed_scope_empty':True,'scope_result':state['Result']}

    def close_gate(self):
        self.parent.close();self.child.close()
