"""Reserve one engine launch and observe its original process group exit.

This is not connected to normal dispatch. It does not contain children that
create another session or replace cross-process attempt authorization.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess


class EngineStillRunning(RuntimeError):
    pass


def _record(directory, name, payload):
    content=(json.dumps(payload,sort_keys=True,allow_nan=False)+'\n').encode()
    descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        file=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=descriptor)
        with os.fdopen(file,'wb') as stream:
            stream.write(content);stream.flush();os.fsync(stream.fileno())
        os.fsync(descriptor)
    finally:os.close(descriptor)


class EngineProcess:
    """Observe only a process launched by this object, never a saved PID."""
    def __init__(self, writer, argv, *, env):
        writer.require_open()
        if writer.files is None:
            raise ValueError('Engine launch requires an owned attempt workspace')
        if not isinstance(argv,list) or not argv or any(not isinstance(arg,str) or not arg for arg in argv):
            raise ValueError('Engine launch requires a nonempty argument vector')
        self.writer=writer
        self.directory=writer.files.path/'engine_process'
        self.receipt=None
        try:
            with writer.files.pinned() as descriptor:
                os.mkdir('engine_process',mode=0o700,dir_fd=descriptor)
                os.fsync(descriptor)
            writer.files.verify()
            self.identity={'schema':'openplan.engine-process.v1','run_id':writer.context.run_id,
                           'stage_id':writer.context.stage_id,'attempt_id':writer.context.attempt_id,
                           'command_sha256':hashlib.sha256(json.dumps(argv,separators=(',',':')).encode()).hexdigest()}
            _record(self.directory,'launch-reserved.json',self.identity)
            # The reservation survives even if Popen fails or this supervisor dies.
            # Environment and raw arguments are not written to the local receipt.
            with (self.directory/'engine.log').open('xb') as log:
                os.chmod(self.directory/'engine.log',0o600)
                self.process=subprocess.Popen(argv,cwd=writer.files.path,env=env,
                    stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,
                    start_new_session=True,close_fds=True)
        except BaseException:
            writer.stopped=True
            raise

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
        try:
            self.writer.files.verify()
            receipt={**self.identity,'pid':self.process.pid,'returncode':code,
                     'observed_original_process_group_empty':True,'execution_ready':False,
                     'scientific_acceptance':'unassessed'}
            _record(self.directory,'observed-exit.json',receipt)
            self.receipt=receipt
        except BaseException:
            self.writer.stopped=True
            raise
        if code!=0:
            self.writer.stopped=True
            raise RuntimeError('Engine exited unsuccessfully; retained files require reconciliation')
        return dict(receipt)
