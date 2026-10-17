#!/usr/bin/python3
"""One separately granted inert-control and non-authoritative builder preparation."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import socket
import subprocess
import sys
import time

ROOT = Path("/home/nathaniel/.local/state/openplan/budget-observe-outer-preparation-20261016")
CAPTURE = Path("/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2")
UNIT = 'openplan-budget-observe-outer-preparation-20261016-01'


def require(value, reason):
    if not value:
        raise ValueError(reason)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def private(path, directory=False):
    info = path.lstat()
    require(not path.is_symlink() and info.st_uid == os.getuid() and
            info.st_mode & 0o777 == (0o700 if directory else 0o600) and
            (path.is_dir() if directory else path.is_file()), 'private-preparation-path')


def record(path, row):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(json.dumps(row, sort_keys=True, separators=(',', ':'))+'\n')
        stream.flush()
        os.fsync(stream.fileno())


def verify(pins):
    for name, expected in pins.items():
        path = Path(name)
        info = path.lstat()
        require(not path.is_symlink() and path.is_file() and
                sha(path) == expected['sha256'] and info.st_size == expected['bytes'] and
                info.st_mode & 0o777 == expected['mode'] and
                info.st_uid == expected['uid'] and info.st_gid == expected['gid'],
                'exact-preparation-input:'+name)


def resources():
    group = [line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines()
             if line.startswith('0::')]
    require(len(group) == 1, 'pure-unified-cgroup')
    base = Path('/sys/fs/cgroup')/group[0].lstrip('/')
    row = {'memoryMax':int((base/'memory.max').read_text()),
           'swapMax':int((base/'memory.swap.max').read_text()),
           'cpuMax':(base/'cpu.max').read_text().strip(),
           'tasksMax':int((base/'pids.max').read_text())}
    require(row == {'memoryMax':536870912,'swapMax':0,'cpuMax':'50000 100000','tasksMax':64},
            'pure-preparation-resources')
    return row


def absent(paths):
    for name in paths:
        path = Path(name)
        require(not path.exists() and not path.is_symlink(),
                'occupied-preparation-operating-path:'+name)


def mounts(paths):
    rows = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        left, _, right = line.partition(' - ')
        fields = left.split()
        rows.append((fields[4], set(fields[5].split(','))))
    result = {}
    for path in paths:
        candidates = [row for row in rows if path == row[0] or
                      path.startswith(row[0].rstrip('/')+'/')]
        mount, options = max(candidates, key=lambda row:len(row[0]))
        require('ro' in options, 'named-preparation-input-not-ro:'+path)
        result[path] = {'mount':mount,'readOnly':True}
    return result


def forbidden(*args, **kwargs):
    raise AssertionError('PREPARATION_NATIVE_CONTACT_FORBIDDEN')


def main():
    os.umask(0o077)
    require(sys.argv[1:] == ['--prepare-once'], 'fixed-preparation-entry')
    private(ROOT, True)
    request_path, grant_path = ROOT/'preparation-request.json', ROOT/'pure-grant.json'
    private(request_path)
    private(grant_path)
    request, grant = json.loads(request_path.read_bytes()), json.loads(grant_path.read_bytes())
    request_sha, grant_sha = sha(request_path), sha(grant_path)
    require(grant.get('requestSHA256') == sha(request_path) and
            grant.get('purpose') == 'INERT_OUTER_CONTROLS_AND_FALSE_BUILDER' and
            grant.get('nativeOperationGranted') is False and grant.get('exclusive') is True and
            type(grant.get('uid')) is int and grant['uid'] == os.getuid() == 1000 and
            grant.get('unitName') == UNIT, 'exact-new-pure-grant')
    now = int(time.time())
    require(type(grant.get('notBefore')) is int and type(grant.get('notAfter')) is int and
            grant['notBefore'] <= now < grant['notAfter'] and
            0 < grant['notAfter']-grant['notBefore'] <= 600, 'fresh-pure-preparation-grant')
    require(type(grant.get('hostNetworkNamespace')) is str and
            grant['hostNetworkNamespace'].startswith('net:[') and
            os.readlink('/proc/self/ns/net') != grant['hostNetworkNamespace'],
            'pure-unshared-network')
    invocation = os.environ.get('INVOCATION_ID', '')
    require(len(invocation) == 32 and all(ch in '0123456789abcdef' for ch in invocation),
            'actual-pure-invocation')
    verify(request['inputs'])
    verify(request['materializedBuilderInputs'])
    absent(request['mustRemainAbsent'])
    before_names = sorted(os.listdir(CAPTURE))
    require('observe-proposal.json' not in before_names, 'builder-output-must-be-new')
    named_mounts = mounts(request['readOnlyPaths'])
    limits = resources()
    attempt = ROOT/'preparation-attempt'
    attempt.mkdir(mode=0o700)
    record(attempt/'intent.json', {'requestSHA256':sha(request_path),
        'grantSHA256':sha(grant_path),'unitName':UNIT,'invocation':invocation,
        'parentPID':os.getpid(),'uid':os.getuid(),'resources':limits,
        'namedReadOnlyMounts':named_mounts,'retry':'FORBIDDEN',
        'nativeOperationGranted':False,'builderOutput':str(CAPTURE/'observe-proposal.json')})
    controls_root = attempt/'controls'
    controls_root.mkdir(mode=0o700)
    saved = [(subprocess, 'Popen', subprocess.Popen), (socket, 'socket', socket.socket)]
    for name in ('system','fork','forkpty','posix_spawn','posix_spawnp',
                 'execv','execve','execvp','execvpe','spawnv','spawnve','spawnvp','spawnvpe'):
        if hasattr(os, name):
            saved.append((os, name, getattr(os, name)))
    saved_argv, saved_path = sys.argv[:], sys.path[:]
    try:
        for module, name, _ in saved:
            setattr(module, name, forbidden)
        controls = runpy.run_path(str(ROOT/'controls.py'), run_name='inert_controls_definitions')
        result = controls['run'](controls_root, ROOT)
        require(result['baseline'] == 'PASS' and result['harmless'] == 'SURVIVED' and
                len(result['mutations']) == 4 and result['restoredBaseline'] == 'PASS' and
                result['exactRestoration'] is True and result['sourceExact'] is True,
                'focused-controls-complete')
        verify(request['inputs'])
        verify(request['materializedBuilderInputs'])
        sys.path.insert(0, str(CAPTURE))
        sys.argv = [str(CAPTURE/'build_observe_proposal.py'), '--prepare-only']
        runpy.run_path(sys.argv[0], run_name='__main__')
        output = CAPTURE/'observe-proposal.json'
        private(output)
        proposal = json.loads(output.read_bytes())
        require(proposal.get('status') == 'PREPARED_NOT_ADMITTED' and
                proposal['admissionProposal']['exclusive'] is False and
                proposal['admissionProposal']['nativeOperationGranted'] is False and
                proposal['admissionProposal']['notBefore'] == 1792201147 and
                proposal['admissionProposal']['notAfter'] == 1792201747,
                'builder-only-false-proposal')
        require(sorted(os.listdir(CAPTURE)) == sorted(before_names+['observe-proposal.json']),
                'builder-only-one-new-output')
        verify(request['inputs'])
        verify(request['materializedBuilderInputs'])
        require(resources() == limits, 'pure-resource-restoration')
        absent(request['mustRemainAbsent'])
        require(sha(request_path) == request_sha and sha(grant_path) == grant_sha,
                'pure-request-grant-unchanged')
        record(attempt/'complete.json', {'status':'PREPARED_NOT_ADMITTED',
            'invocation':invocation,'requestSHA256':sha(request_path),
            'controlsSHA256':sha(controls_root/'controls.json'),
            'builderOutputSHA256':sha(output),'builderOutputBytes':output.stat().st_size,
            'sourceExact':True,'nativeOperationGranted':False,'successorGranted':False})
    except BaseException as error:
        record(attempt/'failure.json', {'status':'FENCED_NO_REPLAY',
            'errorType':type(error).__name__,'nativeOperationGranted':False,
            'builderOutputRetained':(CAPTURE/'observe-proposal.json').exists()})
        raise
    finally:
        for module, name, value in reversed(saved):
            setattr(module, name, value)
        sys.argv = saved_argv
        sys.path[:] = saved_path


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print('PREPARATION STOP: preserve partials; no retry, native grant or successor', file=sys.stderr)
        raise SystemExit(1)
