"""Retain a supplied complete backend archive without granting artifact release.

The archive inventory establishes byte custody. It does not establish that an
engine produced those bytes, requested-product completeness or measurement quality.
"""
import copy
import hashlib
import os
import re
from pathlib import PurePosixPath
import stat
import time
import zipfile

from admission_journal import private, synchronize
from derived_zip import directory
from engine_effects import same
from retained_source import (CHUNK, absolute, check_time, digest, finite_limit,
    json_bytes, publish, read_json, reader, writer)
from retained_task_observation import Observations, finite_number

FORMAT = 'openplan.odm-supplied-output-archive.v1'


def clear_unpublished(root):
    """Remove only owned publisher temporaries, preserving every canonical record."""
    for path in root.iterdir():
        if not path.name.startswith('.partial-'):
            continue
        if re.fullmatch(r'\.partial-[0-9a-f]{32}', path.name) is None:
            raise ValueError('Output archive has an unknown unpublished record')
        with reader(root, path.name):
            pass
        path.unlink()
        synchronize(root)


def inventory(root, name, limits, deadline):
    """Hash all regular members under raw, directory and expanded byte bounds."""
    rows = []
    total = 0
    with reader(root, name) as (stream, info):
        if info.st_size > limits['archiveBytes']:
            raise ValueError('Output archive exceeds raw byte budget')
        count = directory(stream, info.st_size, limits['entries'], limits['directoryBytes'], deadline)
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            records = archive.infolist()
            if len(records) != count:
                raise ValueError('Output archive directory count differs')
            seen = set()
            for member in records:
                check_time(deadline)
                name = member.orig_filename
                path = name[:-1] if member.is_dir() else name
                if (not path or len(name) > 1024 or '\\' in name
                        or any(ord(char) < 32 or ord(char) == 127 for char in name)
                        or PurePosixPath(path).is_absolute() or str(PurePosixPath(path)) != path
                        or any(part in ('.', '..') for part in path.split('/')) or name in seen):
                    raise ValueError('Output archive member name is unsafe or repeated')
                seen.add(name)
                mode = stat.S_IFMT(member.external_attr >> 16)
                if (member.flag_bits & 1 or mode not in (0, stat.S_IFREG, stat.S_IFDIR)
                        or mode != 0 and (mode == stat.S_IFDIR) != member.is_dir()):
                    raise ValueError('Output archive encrypted or special member is unsupported')
                if member.is_dir():
                    rows.append({'name': name, 'kind': 'directory', 'bytes': 0, 'sha256': None})
                    continue
                if total + member.file_size > limits['expandedBytes']:
                    raise ValueError('Output archive exceeds declared expanded byte budget')
                size = 0
                checksum = hashlib.sha256()
                with archive.open(member) as source:
                    while chunk := source.read(min(CHUNK, limits['expandedBytes'] - total + 1)):
                        check_time(deadline)
                        size += len(chunk)
                        total += len(chunk)
                        if total > limits['expandedBytes']:
                            raise ValueError('Output archive exceeds actual expanded byte budget')
                        checksum.update(chunk)
                if size != member.file_size:
                    raise ValueError('Output archive actual member size differs')
                rows.append({'name': name, 'kind': 'file', 'bytes': size, 'sha256': checksum.hexdigest()})
        if not any(row['kind'] == 'file' for row in rows):
            raise ValueError('Output archive contains no regular output members')
        stream.seek(0)
        size = 0
        checksum = hashlib.sha256()
        while chunk := stream.read(min(CHUNK, limits['archiveBytes'] - size + 1)):
            check_time(deadline)
            size += len(chunk)
            if size > limits['archiveBytes']:
                raise ValueError('Output archive exceeds actual raw byte budget')
            checksum.update(chunk)
        if size != info.st_size:
            raise ValueError('Output archive raw byte size differs')
        os.fsync(stream.fileno())
    return {'bytes': size, 'sha256': checksum.hexdigest(), 'expandedBytes': total,
        'members': sorted(rows, key=lambda row: row['name'])}


def retain(observations, observation_hash, *, source_root, source_name, destination,
           max_archive_bytes, max_expanded_bytes, max_entries=10000,
           max_directory_bytes=4 * 1024 * 1024, timeout=120):
    """Freeze one supplied archive, or recover its complete private original bytes."""
    if not isinstance(observations, Observations) or not finite_number(timeout) or timeout <= 0:
        raise ValueError('Output archive needs original observations and a finite timeout')
    limits = {'archiveBytes': max_archive_bytes, 'expandedBytes': max_expanded_bytes,
        'entries': max_entries, 'directoryBytes': max_directory_bytes}
    for value in limits.values():
        finite_limit(value)
    deadline = time.monotonic() + timeout
    observed = observations.load(observation_hash, deadline=deadline)
    if observed['reportedState'] != 'completed':
        raise ValueError('Output archive requires original reported completion')
    source_root = absolute(source_root)
    destination = absolute(destination)
    roots = [source_root, observations.root, observations.records_root]
    if any(destination == root or destination in root.parents or root in destination.parents for root in roots):
        raise ValueError('Output archive roots must not overlap original custody')
    private(destination.parent, True)
    bound = {'format': FORMAT, 'enginePlan': copy.deepcopy(observations.plan),
        'observationSha256': observation_hash, 'sourceRelativePath': source_name, 'limits': limits}
    try:
        destination.mkdir(mode=0o700)
    except FileExistsError:
        pass
    else:
        synchronize(destination.parent)
    private(destination, True)
    with writer(destination, deadline):
        plan_path = destination / 'plan.json'
        if plan_path.exists() or plan_path.is_symlink():
            plan = read_json(destination, 'plan.json')
            if not isinstance(plan, dict) or not same({key: plan.get(key) for key in bound}, bound) or set(plan) != {*bound, 'archive'}:
                raise ValueError('Saved output archive original plan differs')
        else:
            if any((destination / name).exists() or (destination / name).is_symlink()
                   for name in ('archive.zip', 'receipt.json', '.archive-partial')):
                raise ValueError('Output archive original plan is missing')
            clear_unpublished(destination)
            private(source_root, True)
            plan = {**bound, 'archive': inventory(source_root, source_name, limits, deadline)}
            publish(destination, 'plan.json', json_bytes(plan))
        clear_unpublished(destination)
        archive = destination / 'archive.zip'
        temporary = destination / '.archive-partial'
        if temporary.exists() or temporary.is_symlink():
            if archive.exists():
                left, right = temporary.lstat(), archive.lstat()
                if (left.st_dev, left.st_ino, left.st_nlink) != (right.st_dev, right.st_ino, 2):
                    raise ValueError('Interrupted output archive publication alias differs')
                if not stat.S_ISREG(left.st_mode) or left.st_uid != os.getuid() or stat.S_IMODE(left.st_mode) & 0o077:
                    raise ValueError('Interrupted output archive publication must be private and owned')
            else:
                with reader(destination, '.archive-partial'):
                    pass
            temporary.unlink()
            synchronize(destination)
        if not archive.exists() and not archive.is_symlink():
            private(source_root, True)
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'wb') as output:
                copied = digest(source_root, source_name, limits['archiveBytes'], deadline, output=output)
                output.flush()
                os.fsync(output.fileno())
            if copied != {key: plan['archive'][key] for key in ('bytes', 'sha256')}:
                raise ValueError('Supplied output archive differs from its frozen original bytes')
            check_time(deadline)
            os.link(temporary, archive, follow_symlinks=False)
            temporary.unlink()
            synchronize(destination)
        actual = inventory(destination, 'archive.zip', limits, deadline)
        if not same(actual, plan['archive']):
            raise ValueError('Retained output archive bytes or inventory differ')
        observations.load(observation_hash, deadline=deadline)
        result = {**bound, 'archive': actual, 'archiveRelativePath': 'archive.zip',
            'scope': 'private_supplied_backend_archive', 'archiveTaskProvenanceVerification': 'unassessed',
            'requestedDeliverableCompletenessVerification': 'unassessed',
            'processingQualityVerification': 'unassessed', 'callbackPermission': False,
            'publicationPermission': False}
        check_time(deadline)
        publish(destination, 'receipt.json', json_bytes(result))
        check_time(deadline)
        return result
