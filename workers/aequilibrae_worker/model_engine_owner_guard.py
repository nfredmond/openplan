"""Live owner observation in an independent scope; saved identities cannot launch it."""
import json
import os
from pathlib import Path
import re
import select
import shutil
import subprocess
import sys
import uuid


class OwnerGuardUnavailable(RuntimeError):
    pass


class OwnerGuard:
    """Keep a scope active only while its original owner and stop pipe are live."""
    def __init__(self):
        runner=shutil.which('systemd-run')
        if sys.platform!='linux' or runner is None or not hasattr(os,'pidfd_open'):
            raise OwnerGuardUnavailable('Linux process descriptors and user systemd are required')
        self.unit='openplan-owner-'+uuid.uuid4().hex+'.scope'
        self.process=None
        self.stop_fd=None
        self.stopped=False
        owner=stop_read=ready_read=ready_write=None
        try:
            owner=os.pidfd_open(os.getpid())
            stop_read,self.stop_fd=os.pipe()
            ready_read,ready_write=os.pipe()
            self.process=subprocess.Popen([runner,'--user','--scope','--quiet','--expand-environment=no','--unit='+self.unit,
                '-p','MemoryMax=67108864','-p','MemorySwapMax=0','-p','TasksMax=16','--',sys.executable,'-B',str(Path(__file__).resolve()),
                str(owner),str(stop_read),str(ready_write)],pass_fds=(owner,stop_read,ready_write),
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,start_new_session=True)
            os.close(ready_write);ready_write=None
            if not select.select([ready_read],[],[],10)[0]:raise OwnerGuardUnavailable('Owner guard readiness timed out')
            ready=os.read(ready_read,4096)
            try:record=json.loads(ready)
            except (ValueError,TypeError) as error:raise OwnerGuardUnavailable('Owner guard did not report readiness') from error
            state=self.state()
            if record!={'pid':self.process.pid,'cgroup':Path(f'/proc/{self.process.pid}/cgroup').read_text()}:
                raise OwnerGuardUnavailable('Owner guard process identity differs')
            group=state.get('ControlGroup','')
            prefix=f'/user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service/'
            if not group.startswith(prefix) or '..' in Path(group).parts or not group.endswith('/'+self.unit):
                raise OwnerGuardUnavailable('Owner guard cgroup differs')
            if (record['cgroup']!='0::'+group+'\n' or state.get('ActiveState')!='active'
                    or not re.fullmatch(r'[0-9a-f]{32}',state.get('InvocationID',''))
                    or state.get('MemoryMax')!='67108864' or state.get('MemorySwapMax')!='0' or state.get('TasksMax')!='16'):
                raise OwnerGuardUnavailable('Owner guard policy or state differs')
            info=(Path('/sys/fs/cgroup')/group.lstrip('/')).stat()
            self.identity={'schema':'openplan.owner-guard.v1','unit':self.unit,'pid':self.process.pid,
                'invocation_id':state['InvocationID'],'cgroup':group,'cgroup_device':info.st_dev,'cgroup_inode':info.st_ino,
                'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'owner_pid':os.getpid()}
            self.require_alive()
        except BaseException:
            self.stop()
            raise
        finally:
            for fd in (owner,stop_read,ready_read,ready_write):
                if fd is not None:os.close(fd)

    def state(self):
        result=subprocess.run(['systemctl','--user','show',self.unit,'-p','ActiveState','-p','InvocationID','-p','ControlGroup',
            '-p','MemoryMax','-p','MemorySwapMax','-p','TasksMax'],capture_output=True,text=True,timeout=5)
        if result.returncode:raise OwnerGuardUnavailable('Owner guard state is unavailable')
        return dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)

    def require_alive(self):
        if self.stopped or self.process is None or self.process.poll() is not None:
            raise OwnerGuardUnavailable('Owner guard is no longer live')
        state=self.state()
        if (state.get('ActiveState')!='active' or state.get('InvocationID')!=self.identity['invocation_id']
                or state.get('ControlGroup')!=self.identity['cgroup']):
            raise OwnerGuardUnavailable('Owner guard identity changed')

    def stop(self):
        """Release only this live guard. Bound engine scopes stop if still active."""
        if self.stopped:return
        self.stopped=True
        if self.stop_fd is not None:os.close(self.stop_fd);self.stop_fd=None
        if self.process is not None:
            try:self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill();self.process.wait(timeout=5)
            if self.process.stderr is not None:self.process.stderr.close()


def observe_owner(owner,stop,ready):
    if os.readlink(f'/proc/self/fd/{owner}')!='anon_inode:[pidfd]':
        raise ValueError('Live owner process descriptor required')
    poller=select.poll()
    poller.register(owner,select.POLLIN)
    poller.register(stop,select.POLLIN|select.POLLHUP)
    record={'pid':os.getpid(),'cgroup':Path('/proc/self/cgroup').read_text()}
    os.write(ready,json.dumps(record).encode());os.close(ready)
    # No signal authority or database credentials are needed here. The engine
    # scope binds its lifetime to this independently supervised scope.
    poller.poll()


if __name__=='__main__':
    if len(sys.argv)!=4:raise ValueError('Three inherited descriptors required')
    observe_owner(*(int(value) for value in sys.argv[1:]))
