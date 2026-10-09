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


def current_boot_id():
    value=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if str(uuid.UUID(value))!=value:raise ValueError('Host boot identity is invalid')
    return value


def inspect_saved_scope(identity):
    """Observe a saved scope without constructing a launch or signaling capability."""
    if not isinstance(identity,dict) or identity.get('schema')!='openplan.engine-scope.v1':raise ValueError('Invalid saved scope')
    unit=identity.get('unit','');group=identity.get('cgroup','')
    if not re.fullmatch(r'openplan-engine-[0-9a-f]{32}\.scope',unit):raise ValueError('Invalid saved unit')
    if not re.fullmatch(r'[0-9a-f]{32}',identity.get('invocation_id','')):raise ValueError('Invalid saved invocation')
    for field in ('cgroup_device','cgroup_inode','bootstrap_pid','memory_bytes','tasks','supervisor_uid'):
        value=identity.get(field)
        if type(value) is not int or value<0 or (field!='supervisor_uid' and value==0):raise ValueError('Invalid saved scope identity')
    if identity['supervisor_uid']!=os.getuid():raise ValueError('Saved scope belongs to another user')
    prefix=f'/user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service/'
    if not group.startswith(prefix) or '..' in Path(group).parts or not group.endswith('/'+unit):raise ValueError('Invalid saved cgroup')
    boot=identity.get('boot_id')
    if not isinstance(boot,str) or str(uuid.UUID(boot))!=boot:raise ValueError('Saved boot identity is missing or invalid')
    if boot!=current_boot_id():return {'outcome':'different_host_boot','scope_has_live_processes':None}
    controller=shutil.which('systemctl')
    if not controller:raise SupervisionUnavailable('User systemd is required for scope observation')
    result=subprocess.run([controller,'--user','show',unit,'-p','LoadState','-p','ActiveState','-p','InvocationID','-p','ControlGroup'],capture_output=True,text=True,timeout=5)
    if result.returncode:raise SupervisionUnavailable('Saved scope could not be queried')
    state=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    directory=Path('/sys/fs/cgroup')/group.lstrip('/')
    if state.get('LoadState')=='not-found' and state.get('ActiveState')=='inactive' and not directory.exists():
        return {'outcome':'scope_absent_observed','scope_has_live_processes':False}
    if state.get('InvocationID')!=identity['invocation_id'] or state.get('ControlGroup')!=group:raise ValueError('Saved scope identity differs from current scope')
    try:descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    except FileNotFoundError:return {'outcome':'scope_observation_unconfirmed','scope_has_live_processes':None}
    try:
        info=os.fstat(descriptor)
        if (info.st_dev,info.st_ino)!=(identity['cgroup_device'],identity['cgroup_inode']):raise ValueError('Saved cgroup directory identity differs')
        event=os.open('cgroup.events',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=descriptor)
        with os.fdopen(event) as stream:events=dict(line.split() for line in stream)
    finally:os.close(descriptor)
    if events.get('populated') not in ('0','1'):raise ValueError('Scope population is unconfirmed')
    populated=events['populated']=='1'
    return {'outcome':'scope_populated' if populated else 'scope_empty_observed','scope_has_live_processes':populated}


class OwnedEngineScope:
    """Hold a live startup gate until a caller durably records verified identity."""
    def __init__(self,limits,owner_guard=None):
        if not isinstance(limits,ScopeLimits):raise ValueError('Explicit ScopeLimits required')
        self.runner=shutil.which('systemd-run');self.controller=shutil.which('systemctl')
        if sys.platform!='linux' or not self.runner or not self.controller or not Path('/sys/fs/cgroup/cgroup.controllers').is_file():
            raise SupervisionUnavailable('Linux user systemd and cgroup v2 are required')
        self.limits=limits
        self.owner_guard=owner_guard
        self.unit='openplan-engine-'+uuid.uuid4().hex+'.scope'
        self.parent,self.child=socket.socketpair()
        self.parent.settimeout(10)
        self.identity=None

    def command(self,argv):
        binding=[]
        if self.owner_guard is not None:
            self.owner_guard.require_alive()
            binding=['--property=BindsTo='+self.owner_guard.unit,'--property=After='+self.owner_guard.unit,'--property=KillSignal=SIGKILL']
        return [self.runner,'--user','--scope','--quiet','--expand-environment=no','--unit='+self.unit,
                '--property=MemoryMax='+str(self.limits.memory_bytes),'--property=MemorySwapMax=0','--property=TasksMax='+str(self.limits.tasks),*binding,'--',
                sys.executable,'-B',str(Path(__file__).with_name('model_engine_bootstrap.py')),str(self.child.fileno()),*argv]

    def state(self):
        result=subprocess.run([self.controller,'--user','show',self.unit,'-p','LoadState','-p','ActiveState','-p','InvocationID',
                               '-p','ControlGroup','-p','MemoryMax','-p','MemorySwapMax','-p','TasksMax','-p','Result','-p','BindsTo','-p','After','-p','KillSignal'],capture_output=True,text=True,timeout=5)
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
        if state.get('MemoryMax')!=str(self.limits.memory_bytes) or state.get('MemorySwapMax')!='0' or state.get('TasksMax')!=str(self.limits.tasks):
            raise ValueError('Scope resource policy differs')
        if self.owner_guard is not None:
            self.owner_guard.require_alive()
            if (self.owner_guard.unit not in state.get('BindsTo','').split() or self.owner_guard.unit not in state.get('After','').split()
                    or state.get('KillSignal')!='9'):
                raise ValueError('Engine owner guard binding differs')
        directory=Path('/sys/fs/cgroup')/group.lstrip('/')
        descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:info=os.fstat(descriptor)
        finally:os.close(descriptor)
        self.identity={'schema':'openplan.engine-scope.v1','boot_id':current_boot_id(),'supervisor_uid':os.getuid(),'unit':self.unit,'invocation_id':state['InvocationID'],
                       'cgroup':group,'cgroup_device':info.st_dev,'cgroup_inode':info.st_ino,'bootstrap_pid':pid,
                       'memory_bytes':self.limits.memory_bytes,'tasks':self.limits.tasks}
        return dict(self.identity)

    def authorize(self):
        if self.identity is None:raise ValueError('Scope identity is not verified')
        if self.owner_guard is not None:self.owner_guard.require_alive()
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

    def kill_owned(self,record_intent):
        """Signal through a verified cgroup file descriptor after retaining intent.

        A pinned cgroup.kill file cannot be redirected by reusing a unit name.
        The caller must retain uncertainty if recording or signaling fails.
        """
        if self.identity is None:raise ValueError('Scope identity is not verified')
        state=self.state()
        if state.get('InvocationID')!=self.identity['invocation_id'] or state.get('ControlGroup')!=self.identity['cgroup']:
            raise ValueError('Owned scope identity changed before cancellation')
        directory=Path('/sys/fs/cgroup')/self.identity['cgroup'].lstrip('/')
        descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            info=os.fstat(descriptor)
            if (info.st_dev,info.st_ino)!=(self.identity['cgroup_device'],self.identity['cgroup_inode']):
                raise ValueError('Owned cgroup directory changed before cancellation')
            kill_file=os.open('cgroup.kill',os.O_WRONLY|os.O_NOFOLLOW,dir_fd=descriptor)
            try:
                record_intent(dict(self.identity))
                if os.write(kill_file,b'1')!=1:raise OSError('Owned scope signal write was incomplete')
            finally:os.close(kill_file)
        finally:os.close(descriptor)
        return {'scope':dict(self.identity),'signal':'SIGKILL','signal_written':True,'termination_observed':False}

    def close_gate(self):
        self.parent.close();self.child.close()
