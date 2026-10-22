"""Storage delta for the retained V6 controllers. No database or app launcher."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path('/dev/shm/openplan-pr330-preview-20261015')
DURABLE = Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')
HEAD = 'f0cbeddff5ae3fc37e0dd8b91c02601429d977a6'
TREE = 'a13c491da3ad3ba5b237ca5fa8802b236c4ef27b'
DEPS = '/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules'
TRACKED_LINKS = {'candidate/.agents/skills': '../.claude/skills'}
GiB = 1024**3
SOURCE_BYTES = 528310488
# Planning reservations, not observations of this head's build output or peak.
OUTPUT_RESERVE = 3*GiB
EVIDENCE_RESERVE = GiB//2
HOST_RESERVE = 2*GiB
DISK_RESERVE = GiB//4


def require(value, reason):
    if not value:
        raise ValueError(reason)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def write_once(path, value):
    fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY|os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def mount_check(observed):
    require(observed['target']=='/dev/shm' and observed['fstype']=='tmpfs', 'memory-mount')
    flags = set(observed['options'].split(','))
    require('rw' in flags and 'noexec' not in flags, 'memory-execution')
    require({'nosuid','nodev'} <= flags, 'memory-mount-flags')


def capacity_check(available, memory_free, durable_free, staged=0):
    # MemAvailable already excludes resident tmpfs pages. Never count tmpfs free
    # as extra RAM. Build-created output pages are charged inside its 10 GiB cap.
    require(available >= 10*GiB and memory_free >= 8*GiB, 'original-headroom-floor')
    require(available >= 10*GiB + EVIDENCE_RESERVE + HOST_RESERVE + max(0,SOURCE_BYTES-staged),
            'memory-total-budget')
    # Reserve uncompressed size plus tar/gzip overhead. Compression is never a
    # capacity assumption. A larger actual inventory refuses archive/start.
    raw = SOURCE_BYTES + OUTPUT_RESERVE + EVIDENCE_RESERVE
    require(durable_free >= raw + raw//100 + DISK_RESERVE, 'durable-archive-budget')
    return {'available':available, 'memoryFree':memory_free, 'durableFree':durable_free,
            'sourceBytes':SOURCE_BYTES, 'stagedBytes':staged,
            'outputReservation':OUTPUT_RESERVE, 'unitCap':10*GiB,
            'hostReservation':HOST_RESERVE, 'durableRequired':raw+raw//100+DISK_RESERVE}


def observe_capacity():
    result = subprocess.run(['/usr/bin/findmnt','-J','-T','/dev/shm','-o','TARGET,FSTYPE,OPTIONS'],
                            capture_output=True, check=True)
    mount = json.loads(result.stdout)['filesystems']
    require(len(mount)==1, 'memory-mount-census')
    mount_check(mount[0])
    available = int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines()
                         if x.startswith('MemAvailable:')))*1024
    staged = sum(x.get('bytes',0) for x in inventory(ROOT).values()) if ROOT.exists() else 0
    return capacity_check(available,shutil.disk_usage('/dev/shm').free,
                          shutil.disk_usage(DURABLE).free,staged)


def inventory(root):
    require(root.is_dir() and not root.is_symlink(), 'archive-root')
    values = {'.':{'kind':'directory','mode':root.stat().st_mode&0o777}}
    for path in sorted(root.rglob('*')):
        name = str(path.relative_to(root))
        value = {'mode':path.lstat().st_mode&0o777}
        if path.is_symlink():
            require(name in {**TRACKED_LINKS, 'candidate/openplan/node_modules':DEPS} and
                    os.readlink(path)=={**TRACKED_LINKS, 'candidate/openplan/node_modules':DEPS}[name], 'archive-link')
            value.update(kind='symlink',target=os.readlink(path))
        elif path.is_dir():
            value.update(kind='directory')
        else:
            require(path.is_file(), 'archive-special-file')
            value.update(kind='file',bytes=path.stat().st_size,sha256=sha(path))
        values[name] = value
    return values


def identity_check(identity):
    require(identity=={'head':HEAD,'appTree':TREE}, 'archive-identity')


def archive_space(entries, free):
    raw = sum(v.get('bytes',0) for v in entries.values())
    overhead = len(entries)*2048 + raw//100 + 1048576
    require(free >= raw+overhead+DISK_RESERVE, 'archive-actual-capacity')
    return raw+overhead


def verify_archive(archive, manifest):
    require(not archive.is_symlink() and archive.stat().st_mode&0o777==0o600, 'archive-private')
    require(sha(archive)==manifest['archiveSha256'], 'archive-hash')
    seen = {}
    with tarfile.open(archive, 'r|gz') as stream:
        for member in stream:
            require(member.name not in seen and member.name in manifest['entries'], 'archive-member')
            expected = manifest['entries'][member.name]
            if member.isfile():
                data = stream.extractfile(member)
                h = hashlib.sha256(); size = 0
                for block in iter(lambda:data.read(1048576), b''):
                    size += len(block); h.update(block)
                actual = {'kind':'file','mode':member.mode,'bytes':size,'sha256':h.hexdigest()}
            elif member.isdir():
                actual = {'kind':'directory','mode':member.mode}
            else:
                require(member.issym(), 'archive-member-kind')
                actual = {'kind':'symlink','mode':member.mode,'target':member.linkname}
            require(actual==expected, 'archive-content')
            seen[member.name] = actual
    require(set(seen)==set(manifest['entries']), 'archive-census')
    identity_check(manifest['identity'])


def capture(root, destination, identity, outcome):
    identity_check(identity)
    require(outcome in {'successful','failed-or-incomplete'}, 'archive-outcome')
    require(destination.is_dir() and not destination.is_symlink() and
            destination.stat().st_mode&0o777==0o700, 'archive-destination')
    entries = inventory(root)
    archive_space(entries, shutil.disk_usage(destination).free)
    write_once(destination/'archive-intent.json', {'identity':identity,'outcome':outcome,'entries':entries})
    path = destination/'build.tar.gz'
    fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    # A failed compression leaves its partial exclusive file and intent. No retry.
    with os.fdopen(fd,'wb') as raw:
        with gzip.GzipFile(fileobj=raw,mode='wb',compresslevel=3,mtime=0) as zipped:
            with tarfile.open(fileobj=zipped,mode='w|',dereference=False) as stream:
                for name in entries:
                    stream.add(root if name=='.' else root/name,arcname=name,recursive=False)
        raw.flush(); os.fsync(raw.fileno())
    require(inventory(root)==entries, 'archive-source-race')
    manifest = {'identity':identity,'outcome':outcome,'entries':entries,'archiveSha256':sha(path)}
    verify_archive(path,manifest)
    write_once(destination/'archive-ready.json',manifest)
    return manifest


def startup_archive():
    manifest = json.loads((DURABLE/'build-record/archive-ready.json').read_text())
    verify_archive(DURABLE/'build-record/build.tar.gz',manifest)
    require(manifest['outcome']=='successful', 'archive-success-required')
    current = inventory(ROOT)
    # Start admission/request and subsequent observer receipts legitimately add
    # files. Candidate source/output must still equal the pre-start archive.
    candidate = lambda rows:{k:v for k,v in rows.items() if k=='candidate' or k.startswith('candidate/')}
    require(candidate(current)==candidate(manifest['entries']), 'archive-candidate-drift')
    return {'archiveSHA256':manifest['archiveSha256'],
            'manifestSHA256':sha(DURABLE/'build-record/archive-ready.json')}
