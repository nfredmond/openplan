#!/usr/bin/python3
"""ONE future granted pure request. No native capture or successor."""
import hashlib
import json
import os
from pathlib import Path
import re
import time

ROOT = Path('/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016')
UNIT = 'openplan-budget-settings-v2-pure-20261016'


def check(value, reason):
    if not value:
        raise AssertionError(reason)


def pin(path):
    info = path.lstat()
    check(not path.is_symlink() and path.is_file(),'regular-input')
    return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':info.st_size,
            'mode':info.st_mode & 0o777,'uid':info.st_uid}


def record(path,row):
    fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream:
        stream.write((json.dumps(row,sort_keys=True,separators=(',',':'))+'\n').encode())
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def resources():
    groups = [line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines()
              if line.startswith('0::')]
    check(len(groups) == 1,'actual-pure-cgroup')
    base = Path('/sys/fs/cgroup')/groups[0].lstrip('/')
    row = {name:(base/file).read_text().strip() for name,file in (
        ('memory','memory.max'),('swap','memory.swap.max'),('cpu','cpu.max'),('tasks','pids.max'))}
    check(row == {'memory':'536870912','swap':'0','cpu':'50000 100000','tasks':'64'},
          'actual-pure-resources')
    return row


def main():
    os.umask(0o077)
    request = json.loads((ROOT/'pure-window-request.json').read_bytes())
    grant_path, outer_path = ROOT/'pure-grant.json',ROOT/'root-outer-intent.json'
    for path in (grant_path,outer_path):
        info = pin(path)
        check(info['mode'] == 0o600 and info['uid'] == os.getuid(),'private-root-authority-file')
    grant, outer = (json.loads(path.read_bytes()) for path in (grant_path,outer_path))
    request_sha = pin(ROOT/'pure-window-request.json')['sha256']
    for key,value in {'requestSHA256':request_sha,'pureOperationGranted':True,
            'nativeOperationGranted':False,'exclusive':True,'unitName':UNIT,'uid':os.getuid()}.items():
        check(type(grant.get(key)) is type(value) and grant.get(key) == value,'pure-grant:'+key)
    now = int(time.time())
    check(type(grant.get('notBefore')) is int and type(grant.get('notAfter')) is int and
          grant['notBefore'] <= now < grant['notAfter'] and
          0 < grant['notAfter']-grant['notBefore'] <= 600,'pure-finite-window')
    for key,value in {'requestSHA256':request_sha,'grantSHA256':pin(grant_path)['sha256'],
            'argv':request['outerArgv'],'unitName':UNIT,'retry':'FORBIDDEN',
            'parentDeadlineSeconds':145,'perStreamLimit':1048576}.items():
        check(type(outer.get(key)) is type(value) and outer.get(key) == value,'root-outer-intent:'+key)
    for name,expected in request['inputs'].items():
        check(pin(ROOT/name) == expected,'pure-input:'+name)
    for name,expected in request['preserved'].items():
        check(pin(Path(name)) == expected,'preserved-before:'+name)
    invocation = os.environ.get('INVOCATION_ID','')
    check(re.fullmatch('[a-f0-9]{32}',invocation) is not None and invocation != '0'*32,
          'actual-pure-invocation')
    attempt = ROOT/'pure-attempt'
    attempt.mkdir(mode=0o700)
    record(attempt/'intent.json',{'requestSHA256':request_sha,'grantSHA256':pin(grant_path)['sha256'],
        'rootOuterIntentSHA256':pin(outer_path)['sha256'],'invocation':invocation,'pid':os.getpid(),
        'nativeOperationGranted':False,'retry':'FORBIDDEN'})
    mounts = [line.split() for line in Path('/proc/self/mountinfo').read_text().splitlines()]
    named = {path:[parts[5] for parts in mounts if parts[4] == path]
             for path in request['namedReadOnly']+[str(ROOT),'/dev/null']}
    check(all(any('ro' in flags.split(',') for flags in named[path])
              for path in request['namedReadOnly']),'named-protected-ro')
    check(any('rw' in flags.split(',') for flags in named[str(ROOT)]),'named-new-private-rw')
    check(bool(named['/dev/null']),'devnull-bind-present')
    network = str(Path('/proc/self/ns/net').readlink())
    check(network != (ROOT/'host-netns.txt').read_text().strip(),'network-unshared')
    record(attempt/'resources-before.json',{'resources':resources(),'network':network,
        'namedMounts':named,'invocation':invocation,'inheritedWritableSubmounts':'UNASSESSED'})
    # Only here, inside the separately granted finite pure unit, import controls.
    try:
        import controls
        controls.run(record)
    finally:
        exact = {name:pin(ROOT/name) == expected for name,expected in request['inputs'].items()}
        exact.update({name:pin(Path(name)) == expected for name,expected in request['preserved'].items()})
        record(attempt/'post-custody.json',{'exact':exact,'allExact':all(exact.values()),
               'resourcesAfter':resources()})
        check(all(exact.values()),'post-pure-source-modes-bytes')
    record(attempt/'complete.json',{'status':'pure-schema2-controls-complete','invocation':invocation,
        'controlsSHA256':pin(attempt/'controls.json')['sha256'],
        'nativeOperationGranted':False,'successorGranted':False})


if __name__ == '__main__':
    main()
