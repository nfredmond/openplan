"""Reserve one engine launch and observe its original process group exit.

This is not connected to normal dispatch. Optional owned Linux scope supervision
tracks detached sessions but does not replace cross-process attempt authorization.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import socket
import threading
from model_engine_channel import ProgressParent, CHANNEL_FD_ENV


class EngineStillRunning(RuntimeError):
    pass


def _record(descriptor, name, payload):
    content=(json.dumps(payload,sort_keys=True,allow_nan=False)+'\n').encode()
    file=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=descriptor)
    with os.fdopen(file,'wb') as stream:
        stream.write(content);stream.flush();os.fsync(stream.fileno())
    os.fsync(descriptor)


class EngineProcess:
    """Observe only a process launched by this object, never a saved PID."""
    def __init__(self, writer, argv, *, env, progress=False, output_name=None, count_preparer=None, transit_preparer=None, scope_limits=None):
        writer.require_open()
        if writer.files is None:
            raise ValueError('Engine launch requires an owned attempt workspace')
        if not isinstance(argv,list) or not argv or any(not isinstance(arg,str) or not arg for arg in argv):
            raise ValueError('Engine launch requires a nonempty argument vector')
        if CHANNEL_FD_ENV in env:
            raise ValueError("Engine channel descriptor must come from this launch")
        self.writer=writer
        self.directory=writer.files.path/'engine_process'
        self.receipt=None
        self.progress=None
        self.scope=None
        self.cancellation_requested=False
        self.cancellation=None
        self.cancelled_receipt=None
        child_channel=None
        child_env=dict(env)
        inherited=()
        try:
            with writer.files.pinned() as descriptor:
                os.mkdir('engine_process',mode=0o700,dir_fd=descriptor)
                os.fsync(descriptor)
                child=os.open('engine_process',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor)
                try:
                    info=os.fstat(child)
                    self.directory_identity=(info.st_dev,info.st_ino)
                finally:os.close(child)
            writer.files.verify()
            self.identity={'schema':'openplan.engine-process.v1','run_id':writer.context.run_id,
                           'stage_id':writer.context.stage_id,'attempt_id':writer.context.attempt_id,
                           'command_sha256':hashlib.sha256(json.dumps(argv,separators=(',',':')).encode()).hexdigest()}
            if progress:
                parent_channel,child_channel=socket.socketpair()
                self.progress=ProgressParent(parent_channel,writer,output_name=output_name,count_preparer=count_preparer,transit_preparer=transit_preparer)
                inherited=(child_channel.fileno(),)
                child_env[CHANNEL_FD_ENV]=str(child_channel.fileno())
            launch_argv=argv
            if scope_limits is not None:
                from model_engine_supervision import OwnedEngineScope
                self.scope=OwnedEngineScope(scope_limits)
                launch_argv=self.scope.command(argv)
                inherited=(*inherited,self.scope.child.fileno())
                self.identity['scope_unit']=self.scope.unit
            with self._pinned() as descriptor:
                _record(descriptor,'launch-reserved.json',self.identity)
                # Reservation survives spawn failure. Raw arguments and environment
                # are not written to the receipt; child output belongs in a private log.
                file=os.open('engine.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=descriptor)
                with os.fdopen(file,'wb') as log, writer.files.pinned() as working:
                    # Linux procfs resolves the parent's pinned directory while Popen
                    # waits for exec. No directory descriptor is inherited by the engine.
                    working_path=f'/proc/{os.getpid()}/fd/{working}'
                    self.process=subprocess.Popen(launch_argv,cwd=working_path,env=child_env,
                        stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,
                        start_new_session=True,close_fds=True,pass_fds=inherited)
            if self.scope is not None:
                scope_identity=self.scope.verify_start(self.process.pid)
                with self._pinned() as descriptor:
                    _record(descriptor,'scope-started.json',{**self.identity,'scope':scope_identity})
                self.scope.authorize()
        except BaseException:
            writer.stopped=True
            if self.progress is not None:self.progress.stop()
            if self.scope is not None:
                self.scope.close_gate()
                if hasattr(self,'process'):
                    if self.process.poll() is None:self.process.terminate()
                    self.process.wait(timeout=10)
            raise
        finally:
            if child_channel is not None:child_channel.close()

    @contextmanager
    def _pinned(self):
        with self.writer.files.pinned() as parent:
            descriptor=os.open('engine_process',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            try:
                info=os.fstat(descriptor)
                if (info.st_dev,info.st_ino)!=self.directory_identity:
                    raise ValueError('Engine process directory identity changed')
                yield descriptor
            finally:os.close(descriptor)

    def cancel(self):
        """Stop this live object's owned scope without changing database status.

        A stopped writer may still terminate its own processes. This never restores
        write authority or reconstructs cancellation from a saved unit name.
        """
        if self.writer.thread_id!=threading.get_ident():raise ValueError('Cancellation belongs to another invocation thread')
        if self.scope is None:raise ValueError('Cancellation requires an owned engine scope')
        if self.receipt is not None:raise ValueError('Engine exit was already observed')
        if self.cancellation is not None:return dict(self.cancellation)
        if self.cancellation_requested:raise RuntimeError('Unconfirmed cancellation requires reconciliation')
        self.writer.stopped=True
        def record_intent(scope):
            with self._pinned() as descriptor:
                _record(descriptor,'cancellation-requested.json',{**self.identity,'scope':scope,'signal':'SIGKILL','termination_observed':False})
            self.cancellation_requested=True
        result=self.scope.kill_owned(record_intent)
        with self._pinned() as descriptor:
            _record(descriptor,'cancellation-signal-written.json',{**self.identity,**result})
        self.cancellation=result
        if self.progress is not None:self.progress.stop()
        return dict(result)

    def confirm_cancelled(self):
        """Retain observed termination separately from a database cancellation decision."""
        if self.writer.thread_id!=threading.get_ident():raise ValueError('Cancellation belongs to another invocation thread')
        if self.cancellation is None:raise RuntimeError('Cancellation signal has not been confirmed')
        if self.cancelled_receipt is not None:return dict(self.cancelled_receipt)
        code=self.process.poll()
        if code is None:raise EngineStillRunning('Cancelled engine has not exited')
        from model_engine_supervision import ScopeStillPopulated
        try:scope=self.scope.require_empty()
        except ScopeStillPopulated as error:raise EngineStillRunning(str(error)) from error
        receipt={**self.identity,'scope':scope,'returncode':code,'termination_observed':True,
                 'execution_ready':False,'database_status_changed':False}
        with self._pinned() as descriptor:_record(descriptor,'cancellation-observed.json',receipt)
        self.cancelled_receipt=receipt
        return dict(receipt)

    def confirm_exit(self):
        """Refuse live work; retain observed exit without authorizing model capture."""
        self.writer.require_open()
        if self.receipt is not None:
            return dict(self.receipt)
        code=self.process.poll()
        if code is None:
            raise EngineStillRunning('Engine process has not exited')
        try:
            os.killpg(self.process.pid,0)
        except ProcessLookupError:
            pass
        else:
            raise EngineStillRunning('Engine process group still has members')
        scope_receipt=None
        if self.scope is not None:
            from model_engine_supervision import ScopeStillPopulated
            try:scope_receipt=self.scope.require_empty()
            except ScopeStillPopulated as error:raise EngineStillRunning(str(error)) from error
            except BaseException:
                self.writer.stopped=True
                raise
        try:
            self.writer.files.verify()
            receipt={**self.identity,'pid':self.process.pid,'returncode':code,
                     'observed_original_process_group_empty':True,'execution_ready':False,
                     'scientific_acceptance':'unassessed'}
            if scope_receipt is not None:receipt['scope']=scope_receipt
            with self._pinned() as descriptor:
                _record(descriptor,'observed-exit.json',receipt)
            self.receipt=receipt
        except BaseException:
            self.writer.stopped=True
            raise
        if self.progress is not None:self.progress.stop()
        if code!=0:
            self.writer.stopped=True
            raise RuntimeError('Engine exited unsuccessfully; retained files require reconciliation')
        return dict(receipt)
