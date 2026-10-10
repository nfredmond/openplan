"""Copy completed projects and verify each copied SQLite database independently.

Callers establish producer ownership and successful engine closure. This does not
fence host writers or prove cross-database consistency. Failed copies remain.
"""
import hashlib
import json
from pathlib import Path
import sqlite3
import model_package_inputs as package


def validate(record):
    """Inspect the private copy without modifying source or replaying journals."""
    root = Path(record['package_directory'])
    entries = json.loads(Path(record['manifest_path']).read_bytes())['entries']
    if entries.get('project_database.sqlite', {}).get('kind') != 'file':
        raise ValueError('Project database is missing')
    for name in entries:
        if name.endswith(('-wal', '-shm', '-journal')) or '-mj ' in name:
            raise ValueError('Project contains a SQLite sidecar; closure is unconfirmed')
    checks = {}
    for name, entry in entries.items():
        if entry['kind'] != 'file':
            continue
        path = root / name
        with path.open('rb') as stream:
            header = stream.read(16)
        if path.suffix not in ('.sqlite', '.sqlite3', '.db') and header != b'SQLite format 3\x00':
            continue
        if header != b'SQLite format 3\x00':
            raise ValueError('Project database has an invalid SQLite header')
        before = package.identity(path.stat(follow_symlinks=False))
        connection = sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)
        try:
            if connection.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise ValueError('Project SQLite integrity check failed')
        finally:
            connection.close()
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        if (before != package.identity(path.stat(follow_symlinks=False))
                or digest.hexdigest() != entry['sha256'] or before[3] != entry['size_bytes']):
            raise ValueError('Project database changed during integrity check')
        checks[name] = {'integrity': 'ok', 'sha256': entry['sha256'], 'size_bytes': entry['size_bytes']}
    return {**record, 'database_checks': checks,
            'database_consistency': 'individual_sqlite_integrity_checked',
            'cross_database_consistency': 'unassessed', 'scientific_acceptance': 'unassessed'}


def retain(source, destination):
    """Copy the complete project, then refuse journals or invalid databases."""
    return validate(package.retain(source, destination))


def consume(record, destination):
    """Verify the registered inventory before checking independent copied databases."""
    return validate(package.consume(record, destination))
