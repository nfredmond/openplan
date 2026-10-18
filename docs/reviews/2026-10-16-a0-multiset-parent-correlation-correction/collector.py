"""Held extraction of fixed collection definitions with independent cleanup custody."""
import json
import os
import selectors
import subprocess
import time
import custody as c

DEADLINE=205
BOUNDS={'stdout':1048576,'stderr':65536}


def diagnostic(error,phase):
    reason=str(error);encoded=reason.encode('UTF8',errors='backslashreplace')
    value={'type':type(error).__name__,'reason':reason[:1024],'reasonTruncated':len(reason)>1024,
        'reasonUTF8Bytes':len(encoded),'reasonSHA256':c.digest(encoded),'errno':getattr(error,'errno',None),'phase':phase}
    if isinstance(error,RecordFailure):value.update(primary=error.primary,cleanup=error.cleanup)
    return value


class RecordFailure(Exception):
    def __init__(self,primary,cleanup):
        super().__init__('durable-record-failed');self.primary=primary;self.cleanup=cleanup


def sync(path):
    fd=None;primary=None;cleanup=[]
    try:
        fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd)
    except BaseException as error:primary=diagnostic(error,'directory-sync')
    finally:
        if fd is not None:
            try:os.close(fd)
            except BaseException as error:cleanup.append(diagnostic(error,'directory-close'))
    if primary is not None or cleanup:raise RecordFailure(primary,cleanup)


def record(path,row):
    # Never let close or directory-sync replace an earlier write/fsync error.
    fd=None;primary=None;cleanup=[]
    try:
        raw=c.canonical(row);c.need(len(raw)<=1048576,'parent-record-write-bound')
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        remaining=memoryview(raw)
        while remaining:
            count=os.write(fd,remaining);c.need(type(count) is int and count>0,'parent-record-short-write');remaining=remaining[count:]
        os.fsync(fd)
    except BaseException as error:primary=diagnostic(error,'record-write-or-fsync')
    finally:
        if fd is not None:
            try:os.close(fd)
            except BaseException as error:cleanup.append(diagnostic(error,'record-close'))
        try:sync(path.parent)
        except BaseException as error:cleanup.append(diagnostic(error,'record-directory-sync'))
    if primary is not None or cleanup:raise RecordFailure(primary,cleanup)


def manager_env():return c.manager_env(os.getuid())


def remaining(start):
    value=DEADLINE-(time.monotonic()-start)
    if value<=0:raise TimeoutError('collector-deadline')
    return value


def collect(folder):
    # Setup is inside the primary try. Each acquired descriptor is tracked at once.
    outputs={};selector=None;proc=None;wrapper_pid=None;code=None;primary=None;cleanup=[];evidence=[]
    counts={'stdout':0,'stderr':0};start=time.monotonic();phase='output-setup'
    try:
        for label in BOUNDS:
            outputs[label]=open(folder/(label+'.bin'),'xb',buffering=0)
            os.fchmod(outputs[label].fileno(),0o600)
        phase='popen'
        proc=subprocess.Popen(c.MANAGER_ARGV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            env=manager_env(),close_fds=True)
        wrapper_pid=getattr(proc,'pid',None);c.positive(wrapper_pid,'returned-wrapper-pid')
        phase='returned-process-record'
        record(folder/'returned-process.json',{'parentPID':os.getpid(),'wrapperPID':wrapper_pid,'ack':'process-returned-only'})
        phase='selector-setup';selector=selectors.DefaultSelector()
        for label,pipe in [('stdout',proc.stdout),('stderr',proc.stderr)]:
            os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,label)
        phase='stream-read'
        while selector.get_map():
            left=remaining(start)
            for key,_ in selector.select(min(0.1,left)):
                label=key.data;bound=BOUNDS[label]
                chunk=os.read(key.fd,min(65536,bound-counts[label]+1))
                if not chunk:
                    selector.unregister(key.fileobj);key.fileobj.close();continue
                counts[label]+=len(chunk)
                outputs[label].write(chunk[:len(chunk)-max(0,counts[label]-bound)])
                if counts[label]>bound:raise RuntimeError('collector-overflow:'+label)
        phase='wait';code=proc.wait(timeout=remaining(start));remaining(start)
    except BaseException as error:primary=diagnostic(error,phase)
    finally:
        # Every owned action is attempted independently, including after setup failure.
        if selector is not None:
            try:selector.close()
            except BaseException as error:cleanup.append(diagnostic(error,'selector-close'))
        if proc is not None:
            for label in ['stdout','stderr']:
                pipe=getattr(proc,label,None)
                if pipe is not None:
                    try:
                        if not pipe.closed:pipe.close()
                    except BaseException as error:cleanup.append(diagnostic(error,'pipe-close-'+label))
        for label,stream in outputs.items():
            try:os.fsync(stream.fileno())
            except BaseException as error:cleanup.append(diagnostic(error,'output-fsync-'+label))
            try:stream.close()
            except BaseException as error:cleanup.append(diagnostic(error,'output-close-'+label))
        try:sync(folder)
        except BaseException as error:cleanup.append(diagnostic(error,'outputs-directory-sync'))
    streams={}
    for label,limit in BOUNDS.items():
        try:
            value=c.raw(folder/(label+'.bin'),limit,empty=True)
            streams[label]={'observedBytes':counts[label],'retainedBytes':len(value),'sha256':c.digest(value),'limit':limit}
        except BaseException as error:
            evidence.append(diagnostic(error,'stream-evidence-'+label))
            streams[label]={'observedBytes':counts[label],'retainedBytes':None,'sha256':None,'limit':limit}
    row={'parentPID':os.getpid(),'wrapperPID':wrapper_pid,'returncode':code,'failure':primary,
        'classification':'UNKNOWN_NO_REPLAY' if primary is not None or cleanup or evidence or code is None else 'terminal-zero' if type(code) is int and code==0 else 'terminal-nonzero',
        'elapsedSeconds':time.monotonic()-start,'deadlineSeconds':DEADLINE,'backendDeath':'UNASSESSED',
        'streams':streams,'cleanupErrors':cleanup,'evidenceErrors':evidence}
    record_error=None
    try:record(folder/'terminal.json',row)
    except BaseException as error:record_error=diagnostic(error,'terminal-record')
    # This is a local return, never a claim that failed records or hashes are durable.
    return {'terminal':row,'terminalRecorded':record_error is None,'terminalRecordError':record_error}
