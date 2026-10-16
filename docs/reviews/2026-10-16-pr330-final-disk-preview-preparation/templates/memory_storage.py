"""Storage delta for the retained V6 controllers. No database or app launcher."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path('/home/nathaniel/.local/state/openplan/pr330-final-disk-working-20261016')
DURABLE = Path('/home/nathaniel/.local/state/openplan/pr330-final-disk-preview-20261016')
HEAD = '607ee0895a79457181eda1d2ebbda1de4f2a4d40'
TREE = 'bed283ab0c937ead65378a2e9d26c177ceee6938'
DEPS = '/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules'
TRACKED_LINKS = {'candidate/.agents/skills': '../.claude/skills'}
GiB = 1024**3
SOURCE_BYTES = 528937508
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
    require(observed['target'] == '/' and observed['fstype'] == 'ext4' and
            observed['source'] == '/dev/nvme0n1p2' and
            observed['uuid'] == 'c7f8e9a2-2767-4dba-81a8-5ae1ade8d595', 'disk-mount-identity')
    flags = set(observed['options'].split(','))
    require('rw' in flags and 'noexec' not in flags, 'disk-execution')


def capacity_check(available, working_free, durable_free, staged=0):
    # Source, output and custody reside on disk. Page cache used during a build
    # remains charged to that build's unchanged 10 GiB cgroup and is reclaimable.
    # No disk or tmpfs free bytes count as extra RAM.
    require(type(staged) is int and staged >= 0, 'disk-staged-count')
    memory_required = 10*GiB + HOST_RESERVE
    require(available >= memory_required, 'disk-memory-total-budget')
    raw = SOURCE_BYTES + OUTPUT_RESERVE + EVIDENCE_RESERVE
    working_required = max(0, raw-staged)
    archive_raw = max(raw, staged)
    archive_required = archive_raw + archive_raw//100 + DISK_RESERVE
    # Both directories share this identified filesystem. Reserve working bytes
    # AND an uncompressed-size archive together, rather than counting free twice.
    combined_required = working_required + archive_required
    require(min(working_free, durable_free) >= 8*GiB, 'disk-headroom-floor')
    require(min(working_free, durable_free) >= combined_required, 'disk-combined-budget')
    return {'available': available, 'workingFree': working_free, 'durableFree': durable_free,
            'sourceBytes': SOURCE_BYTES, 'stagedBytes': staged,
            'outputReservation': OUTPUT_RESERVE, 'unitCap': 10*GiB,
            'hostReservation': HOST_RESERVE, 'memoryRequired': memory_required,
            'workingRequired': working_required, 'archiveRequired': archive_required,
            'durableRequired': combined_required, 'storage': 'disk'}


def observe_capacity():
    require(ROOT.parent.resolve() == ROOT.parent and DURABLE.resolve() == DURABLE,
            'disk-parent-symlink')
    require(os.stat(ROOT.parent).st_dev == os.stat(DURABLE).st_dev, 'disk-shared-device')
    result = subprocess.run(['/usr/bin/findmnt', '-J', '-T', str(ROOT.parent), '-o',
                             'TARGET,SOURCE,FSTYPE,OPTIONS,UUID'],
                            capture_output=True, check=True, timeout=5)
    mount = json.loads(result.stdout)['filesystems']
    require(len(mount) == 1, 'disk-mount-census')
    mount_check(mount[0])
    available = int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines()
                         if x.startswith('MemAvailable:')))*1024
    staged = sum(x.get('bytes', 0) for x in inventory(ROOT).values()) if ROOT.exists() else 0
    return capacity_check(available, shutil.disk_usage(ROOT.parent).free,
                          shutil.disk_usage(DURABLE).free, staged)


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
