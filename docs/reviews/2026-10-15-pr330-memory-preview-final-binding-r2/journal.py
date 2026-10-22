"""Exclusive durable custody for trusted fixed controllers. No retry or cleanup."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

DURABLE=Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')
HEAD='f0cbeddff5ae3fc37e0dd8b91c02601429d977a6'
TREE='a13c491da3ad3ba5b237ca5fa8802b236c4ef27b'


def require(value, reason):
    if not value:
        raise ValueError(reason)


def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_directory(path):
    require(path.is_dir() and not path.is_symlink() and path.stat().st_mode&0o777==0o700,'journal-private-directory')


def bytes_once(path, data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream:
        stream.write(data);stream.flush();os.fsync(stream.fileno())
    sync_directory(path.parent)


def json_once(path, value):
    bytes_once(path,(json.dumps(value,sort_keys=True,indent=2)+'\n').encode())


def directory(path):
    if not path.exists():
        path.mkdir(mode=0o700);sync_directory(path.parent)
    private_directory(path)


def record(name, value):
    # Mirror receipts to disk before publishing their working-root counterparts.
    private_directory(DURABLE)
    parts=Path(name).parts
    require(parts and not Path(name).is_absolute() and all(re.fullmatch('[A-Za-z0-9_.-]+',p) and p not in {'.','..'} for p in parts),'journal-record-name')
    parent=DURABLE/'receipts';directory(parent)
    for component in parts[:-1]:
        parent=parent/component;directory(parent)
    json_once(parent/parts[-1],value)


def begin(name, payload):
    require(re.fullmatch('[a-z0-9][a-z0-9-]{0,127}',name) is not None,'journal-operation-name')
    private_directory(DURABLE)
    parent=DURABLE/'journal';directory(parent)
    path=parent/name
    # The directory itself fences a retry even if intent publication is interrupted.
    path.mkdir(mode=0o700);sync_directory(parent)
    json_once(path/'intent.json',{'head':HEAD,'appTree':TREE,'operation':name,'payload':payload})
    return path


def failure(path, error):
    # Native error text may contain credentials. Exact streams stay private.
    json_once(path/'failure.json',{'type':type(error).__name__,'acknowledgement':'unknown; no automatic retry'})


def effect(name, payload, action):
    path=begin(name,payload)
    try:
        value=action()
        json_once(path/'result.json',{'value':value})
        return value
    except BaseException as error:
        failure(path,error)
        raise


def execute(name, argv, *, data=None, stdin=None, input_file=None, cwd=None, env=None,
            timeout=120, combined=False, return_output=True, payload=None):
    fields={'argv':argv,'cwd':str(cwd) if cwd else None,'inputFile':input_file,
        'environment':dict(os.environ) if env is None else env,'detail':payload,
        'inputSHA256':hashlib.sha256(data).hexdigest() if data is not None else None}
    path=begin(name,fields)
    if data is not None:
        bytes_once(path/'input.bin',data)
    # Streams are on durable storage while the child runs, including after parent
    # interruption. Completed and failed outputs receive fsync before any return.
    stdout_path=path/'stdout.bin';stderr_path=path/'stderr.bin'
    out=os.open(stdout_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    err=os.open(stderr_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(out,'wb') as stdout,os.fdopen(err,'wb') as stderr:
            try:
                result=subprocess.run(argv,input=data,stdin=stdin,cwd=cwd,env=env,
                    stdout=stdout,stderr=subprocess.STDOUT if combined else stderr,timeout=timeout)
            finally:
                stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
        sync_directory(path)
        json_once(path/'exit.json',{'returncode':result.returncode,
            'stdoutSHA256':sha(stdout_path),'stderrSHA256':sha(stderr_path),
            'boundary':'Process exit or manager acknowledgement only; not domain/job completion.'})
        return subprocess.CompletedProcess(argv,result.returncode,
            stdout_path.read_bytes() if return_output else None,
            stderr_path.read_bytes() if return_output else None)
    except BaseException as error:
        failure(path,error)
        raise


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for b in iter(lambda:stream.read(1048576),b''):
            h.update(b)
    return h.hexdigest()


def stopped_web():
    path=DURABLE/'journal/unit-start'
    private_directory(path)
    streams={}
    for name in ['web-stdout.bin','web-stderr.bin']:
        file=path/name
        if file.exists():
            fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
            try:os.fsync(fd)
            finally:os.close(fd)
            streams[name]=sha(file)
    json_once(path/'web-exit.json',{'exitCode':os.environ.get('EXIT_CODE'),
        'exitStatus':os.environ.get('EXIT_STATUS'),'streams':streams,
        'boundary':'Actual user-manager stop status. Not readiness or journey acceptance.'})


def main():
    os.umask(0o077)
    # The sealed runner supplies these fixed commands. This is trusted same-user
    # transport, not an authorization broker or a hostile-controller sandbox.
    if len(sys.argv)==3 and sys.argv[1]=='claim':
        begin(sys.argv[2],{'kind':'stage reservation; no job completion asserted'})
        return
    if sys.argv[1:]==['stopped-web']:
        stopped_web()
        return
    require(len(sys.argv)>4 and sys.argv[1]=='execute' and sys.argv[3]=='--','journal-cli')
    result=execute(sys.argv[2],sys.argv[4:],timeout=2100,
        payload={'kind':'user-manager request; startup exit is acknowledgement only'})
    sys.stdout.buffer.write(result.stdout);sys.stderr.buffer.write(result.stderr)
    raise SystemExit(result.returncode)


if __name__=='__main__':
    main()
