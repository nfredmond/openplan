"""Exclusive intent and private streams precede each fixed external request."""
import hashlib
import json
import os
from pathlib import Path
import subprocess


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync(Path(path).parent)


def record(path, value):
    write(path, (json.dumps(value, sort_keys=True, indent=2)+'\n').encode())


def begin(parent, name, payload):
    path = parent/name
    path.mkdir(mode=0o700)
    sync(parent)
    record(path/'intent.json', payload)
    return path


class Transport:
    def __init__(self, root):
        self.root = root
        self.index = 0

    def start(self, argv, data=None, *, manager=False):
        environment = {'PATH': '/usr/bin:/bin', 'HOME': '/home/nathaniel', 'LANG': 'C.UTF-8'}
        if manager:
            # Local user-manager location only. Never inherit bus/config/auth values.
            environment['XDG_RUNTIME_DIR'] = '/run/user/'+str(os.getuid())
        self.index += 1
        path = begin(self.root, f'request-{self.index:03}', {'argv': argv,
            'environment': environment,
            'inputSHA256': hashlib.sha256(data).hexdigest() if data is not None else None,
            'retry': 'forbidden; interrupted intent remains reserved'})
        if data is not None:
            write(path/'input.bin', data)
        out = open(path/'stdout.bin', 'xb', buffering=0)
        err = open(path/'stderr.bin', 'xb', buffering=0)
        os.chmod(path/'stdout.bin', 0o600)
        os.chmod(path/'stderr.bin', 0o600)
        # Fixed environment. No passwords, DSN, inherited provider or Docker host.
        try:
            proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=out, stderr=err,
                env=environment)
            record(path/'returned-process.json', {'pid': proc.pid})
            return proc, path, out, err
        except BaseException as error:
            record(path/'failure.json', {'type': type(error).__name__, 'ack': 'unknown; no retry'})
            out.close()
            err.close()
            raise

    def finish(self, handle, timeout=90):
        proc, path, out, err = handle
        try:
            code = proc.wait(timeout=timeout)
        except BaseException as error:
            record(path/'failure.json', {'type': type(error).__name__, 'ack': 'unknown; no retry'})
            # Closing our input causes our backend to roll back. Never kill others.
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.close()
            raise
        finally:
            os.fsync(out.fileno())
            os.fsync(err.fileno())
            out.close()
            err.close()
            sync(path)
        record(path/'exit.json', {'returncode': code, 'stdoutSHA256': sha(path/'stdout.bin'),
            'stderrSHA256': sha(path/'stderr.bin')})
        return code, (path/'stdout.bin').read_bytes()

    def run(self, argv, data=b'', timeout=90, input_file=None, *, manager=False):
        h = self.start(argv, data if input_file is None else None, manager=manager)
        proc = h[0]
        try:
            if input_file:
                with input_file.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024*1024), b''):
                        proc.stdin.write(chunk)
            else:
                proc.stdin.write(data)
            proc.stdin.close()
        except BaseException as error:
            record(h[1]/'input-failure.json', {'type': type(error).__name__, 'ack': 'unknown; no retry'})
            if not proc.stdin.closed:
                proc.stdin.close()
            self.finish(h, timeout)
            raise
        code, output = self.finish(h, timeout)
        if code:
            raise ValueError('transport-exit; retained private streams; no retry')
        return output
