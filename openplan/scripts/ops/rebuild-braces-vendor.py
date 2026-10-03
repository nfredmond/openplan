#!/usr/bin/env python3
"""Rebuild the reviewed local archive in temporary storage and compare exact bytes."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

vendor = Path(__file__).resolve().parents[2] / 'vendor/braces'
manifest = json.loads((vendor / 'manifest.json').read_text())


def verified_bytes(name, digest):
    data = (vendor / name).read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f'{name}: SHA-256 differs from reviewed manifest')
    return data


original = verified_bytes(manifest['upstreamArchive'], manifest['upstreamSha256'])
patch = verified_bytes(manifest['patchFile'], manifest['patchSha256'])
expected = verified_bytes(manifest['archive'], manifest['archiveSha256'])
with tempfile.TemporaryDirectory(prefix='openplan-braces-rebuild-') as directory:
    root = Path(directory)
    with tarfile.open(fileobj=io.BytesIO(original)) as archive:
        for member in archive.getmembers():
            if not member.isfile() or member.name not in {'package/' + n for n in manifest['files']}:
                raise ValueError(f'Unexpected upstream member: {member.name}')
            destination = root / member.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.extractfile(member).read())
    subprocess.run(['patch', '--fuzz=0', '--batch', '-p1'], input=patch,
                   cwd=root / 'package', check=True, capture_output=True)
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for name, digest in sorted(manifest['files'].items()):
            data = (root / 'package' / name).read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError(f'{name}: rebuilt file differs from reviewed manifest')
            member = tarfile.TarInfo('package/' + name)
            member.size = len(data)
            member.mode = 0o644
            member.mtime = 0
            archive.addfile(member, io.BytesIO(data))
    rebuilt = gzip.compress(output.getvalue(), compresslevel=9, mtime=0)
    # Normalize the OS header byte, which differs between Python/zlib versions.
    rebuilt = rebuilt[:9] + b'\xff' + rebuilt[10:]
    if rebuilt != expected:
        raise ValueError('Rebuilt archive differs from the committed archive')
print('braces vendor archive reproduces exactly')
