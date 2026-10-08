"""Retain the selected count bytes and sidecars before assignment consumes them.

The configured sources and destination parent are administrator-owned. This
captures local bytes, not source validity or independent scientific acceptance.
A failed capture leaves its exclusive directory for explicit reconciliation.
"""
import hashlib
import json
import os
from pathlib import Path
import stat

FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


def retain(counts_path, status_directory, destination):
    source = Path(counts_path).absolute() if counts_path else None
    sources = {'counts.csv': source,
               'counts.csv.count-source.json': Path(str(source) + '.count-source.json') if source else None,
               'count_source_status.json': Path(status_directory).absolute() / 'count_source_status.json'}
    destination = Path(destination).absolute()
    destination.mkdir(mode=0o700, exist_ok=False)
    descriptor = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    target_identity = os.fstat(descriptor)
    records, opened = {}, []
    try:
        for name, path in sources.items():
            record = {'source': str(path) if path else None, 'status': 'unavailable'}
            records[name] = record
            if path is None:
                opened.append((path, None, None))
                continue
            try:
                file = os.open(path, FLAGS)
            except FileNotFoundError:
                opened.append((path, None, None))
                continue
            before = os.fstat(file)
            opened.append((path, file, before))
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise ValueError('Count input must be a private regular file')
            digest = hashlib.sha256()
            size = 0
            output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
            with os.fdopen(output, 'wb') as writer, os.fdopen(os.dup(file), 'rb') as reader:
                while chunk := reader.read(min(1024 * 1024, before.st_size - size + 1)):
                    size += len(chunk)
                    if size > before.st_size:
                        raise ValueError('Count input grew during retention')
                    digest.update(chunk)
                    writer.write(chunk)
                if size != before.st_size:
                    raise ValueError('Count input size changed during retention')
                writer.flush()
                os.fsync(writer.fileno())
            record.update(status='retained', sha256=digest.hexdigest(), size_bytes=size)
        # Recheck the entire source set before publishing its completion record.
        # This includes absent sidecars that appeared while another file copied.
        for path, file, before in opened:
            if path is None:
                continue
            if file is None:
                try:
                    os.stat(path, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                raise ValueError('Previously absent count input appeared during retention')
            after = os.fstat(file)
            named = os.stat(path, follow_symlinks=False)
            if identity(before) != identity(after) or identity(after) != identity(named):
                raise ValueError('Count input changed during retention')
        current = os.stat(destination, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (target_identity.st_dev, target_identity.st_ino):
            raise ValueError('Count input destination changed during retention')
        manifest = {'schema': 'openplan.count-inputs.v1', 'source_reference': counts_path,
                    'files': records, 'scientific_acceptance': 'unassessed'}
        content = (json.dumps(manifest, sort_keys=True, allow_nan=False) + '\n').encode()
        marker = os.open('manifest.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
        with os.fdopen(marker, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.fsync(descriptor)
        return {'counts_path': str(destination / 'counts.csv'),
                'counts_input_directory': str(destination), 'manifest_path': str(destination / 'manifest.json'),
                'manifest_sha256': hashlib.sha256(content).hexdigest(), 'manifest_size_bytes': len(content),
                'counts_status': records['counts.csv']['status']}
    finally:
        for _, file, _ in opened:
            if file is not None:
                os.close(file)
        os.close(descriptor)
