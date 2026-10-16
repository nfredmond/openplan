"""Exclusive durable files and finite streamed subprocess custody, adapted from A0 R6."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

import policy as p


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private(path, directory=False):
    info = path.lstat()
    p.require(not path.is_symlink() and info.st_uid == os.getuid() and
              info.st_mode & 0o777 == (0o700 if directory else 0o600) and
              (path.is_dir() if directory else path.is_file()), 'private-path')


def write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)


def record(path, value):
    write(path, p.canonical(value))


def begin(parent, name, value):
    path = parent/name
    path.mkdir(mode=0o700)
    sync(parent)
    record(path/'intent.json', value)
    return path


def read(path):
    private(path)
    return json.loads(path.read_bytes())


class Transport:
    """Popen is the only inert replacement in controls. No replay or automatic kill."""

    def __init__(self, root):
        self.root = root
        self.index = 0

    def run(self, argv, data=b'', *, timeout=30, limit=16777216, input_file=None):
        self.index += 1
        path = begin(self.root, f'request-{self.index:03}', {
            'argv': argv, 'environment': p.ENV, 'timeout': timeout, 'streamByteLimit': limit,
            'inputSHA256': p.digest(data), 'inputFile': str(input_file) if input_file else None,
            'uid': os.getuid(), 'controllerPID': os.getpid(), 'retry': 'FORBIDDEN'})
        write(path/'input.bin', data)
        out = open(path/'stdout.bin', 'xb', buffering=0)
        err = open(path/'stderr.bin', 'xb', buffering=0)
        os.fchmod(out.fileno(), 0o600)
        os.fchmod(err.fileno(), 0o600)
        proc = None
        code = None
        failure = None
        start = time.monotonic()
        try:
            # File input is pinned by the controller before/after rendering. Its
            # exact descriptor remains open across Popen, with no inherited env.
            stream = input_file.open('rb') if input_file else None
            try:
                proc = subprocess.Popen(argv, stdin=stream if stream else subprocess.PIPE,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=p.ENV, close_fds=True)
            finally:
                if stream:
                    stream.close()
            p.positive(proc.pid, 'transport-pid')
            record(path/'returned-process.json', {'pid': proc.pid, 'ack': 'process-returned-only'})
            counts = {'stdout': 0, 'stderr': 0}
            with selectors.DefaultSelector() as selector:
                for pipe, label in ((proc.stdout, 'stdout'), (proc.stderr, 'stderr')):
                    os.set_blocking(pipe.fileno(), False)
                    selector.register(pipe, selectors.EVENT_READ, label)
                pending = memoryview(data)
                if not input_file:
                    os.set_blocking(proc.stdin.fileno(), False)
                    if pending:
                        selector.register(proc.stdin, selectors.EVENT_WRITE, 'input')
                    else:
                        proc.stdin.close()
                while selector.get_map():
                    p.require(time.monotonic()-start < timeout, 'transport-deadline')
                    for key, _ in selector.select(min(0.1, timeout)):
                        if key.data == 'input':
                            written = os.write(key.fd, pending[:65536])
                            pending = pending[written:]
                            if not pending:
                                selector.unregister(key.fileobj)
                                key.fileobj.close()
                            continue
                        bound = limit if key.data == 'stdout' else min(limit,1048576)
                        chunk = os.read(key.fd, min(65536, bound-counts[key.data]+1))
                        if not chunk:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                            continue
                        counts[key.data] += len(chunk)
                        allowed = len(chunk)-max(0, counts[key.data]-bound)
                        (out if key.data == 'stdout' else err).write(chunk[:allowed])
                        p.require(counts[key.data] <= bound, 'transport-output-bound')
            code = proc.wait(timeout=max(0.001, timeout-(time.monotonic()-start)))
            p.require(time.monotonic()-start < timeout, 'transport-late-terminal')
            p.same(0,counts['stderr'],'transport-unknown-stderr')
        except BaseException as error:
            failure = type(error).__name__
            # Close only our descriptors. Never infer rollback/backend death or
            # terminate another process. A surviving process remains UNKNOWN.
            if proc:
                for pipe in (proc.stdin, proc.stdout, proc.stderr):
                    if pipe and not pipe.closed:
                        pipe.close()
            raise
        finally:
            for stream in (out, err):
                os.fsync(stream.fileno())
                stream.close()
            sync(path)
            record(path/'terminal.json', {'returncode': code, 'errorType': failure,
                'classification': 'terminal' if code is not None and failure is None else 'UNKNOWN_NO_REPLAY',
                'backend': 'unassessed', 'commitACK': 'unassessed',
                'stdoutBytes': (path/'stdout.bin').stat().st_size,
                'stderrBytes': (path/'stderr.bin').stat().st_size,
                'stdoutSHA256': p.digest((path/'stdout.bin').read_bytes()),
                'stderrSHA256': p.digest((path/'stderr.bin').read_bytes())})
        p.same(0, code, 'transport-nonzero')
        return (path/'stdout.bin').read_bytes()
