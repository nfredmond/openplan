"""Verify every supplied byte before making runtime inputs available."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile


class Refusal(RuntimeError):
    pass


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def verify_archive(archive, inventory_path, expected_sha256, expected_bytes, destination):
    """Stream all members, extracting only the admitted runtime bundle."""
    archive, destination = Path(archive), Path(destination)
    if archive.stat().st_size != expected_bytes or digest(archive) != expected_sha256:
        raise Refusal('archive hash or byte length mismatch')
    inventory = Path(inventory_path).read_bytes()
    records = json.loads(inventory)['files']
    expected = {r['archive_path']: r for r in records}
    if len(expected) != len(records):
        raise Refusal('duplicate inventory entry')
    expected['archive-inventory.json'] = {'bytes': len(inventory), 'sha256': hashlib.sha256(inventory).hexdigest()}
    seen = set()
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive, 'r|gz') as tar:
        for member in tar:
            name = member.name
            path = PurePosixPath(name)
            if (not member.isfile() or path.is_absolute() or '..' in path.parts
                    or str(path) != name or name in seen or name not in expected):
                raise Refusal('unexpected or unsafe archive member')
            seen.add(name)
            record = expected[name]
            if member.size != record['bytes']:
                raise Refusal('member byte length mismatch: ' + name)
            target = None
            if name.startswith('inputs/bundle/'):
                target = destination / name.removeprefix('inputs/bundle/')
                target.parent.mkdir(parents=True, exist_ok=True)
            h = hashlib.sha256()
            sink = target.open('xb') if target else None
            try:
                with tar.extractfile(member) as source:
                    for block in iter(lambda: source.read(1024 * 1024), b''):
                        h.update(block)
                        if sink:
                            sink.write(block)
            finally:
                if sink:
                    sink.close()
            if h.hexdigest() != record['sha256']:
                raise Refusal('member hash mismatch: ' + name)
    if seen != set(expected):
        raise Refusal('archive member census mismatch')
    return {'archive_sha256': expected_sha256, 'archive_bytes': expected_bytes,
            'inventory_sha256': hashlib.sha256(inventory).hexdigest(), 'verified_members': len(seen)}
