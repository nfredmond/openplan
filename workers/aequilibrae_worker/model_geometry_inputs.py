"""Retain assignment geometry outside the bounded control channel."""
import json
import os
from pathlib import Path
import tempfile
import model_package_inputs as packages
from model_transit_inputs import _read_verified


def retain(geometry, destination):
    """Caller validates geometry and establishes attempt authority before retention."""
    content=(json.dumps(geometry,sort_keys=True,allow_nan=False)+'\n').encode()
    destination=Path(destination).absolute()
    with tempfile.TemporaryDirectory(prefix='.geometry-source-',dir=destination.parent) as source:
        fd=os.open(Path(source)/'geometry.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as stream:
            stream.write(content);stream.flush();os.fsync(stream.fileno())
        return packages.retain(source,destination)


def consume(record,destination):
    """Verify an independent copy of the parent-confirmed geometry bytes."""
    copied=packages.consume(record,destination)
    manifest=json.loads(_read_verified(copied['manifest_path'],copied['manifest_size_bytes'],copied['manifest_sha256']))
    entries=manifest['entries']
    if set(entries)!={'geometry.json'} or entries['geometry.json']['kind']!='file':
        raise ValueError('Geometry inventory differs')
    entry=entries['geometry.json']
    raw=_read_verified(Path(copied['package_directory'])/'geometry.json',entry['size_bytes'],entry['sha256'])
    return json.loads(raw)
