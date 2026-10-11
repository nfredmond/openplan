"""Inventory one quiescent, known private fixture root, including empty directories."""
from contextlib import closing
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import stat

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('point_snapshot_privacy', REPO / 'openplan/scripts/ops/worker_journal_snapshot.py')
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


def inventory(root):
    """Read file bytes and private modes; aliases fail through the existing helper."""
    result = {}
    def visit(path):
        is_directory = path.is_dir()
        privacy.private_path(path, directory=is_directory)
        info = path.stat()
        key = '.' if path == root else path.relative_to(root).as_posix()
        if is_directory:
            result[key] = {'kind': 'directory', 'mode': stat.S_IMODE(info.st_mode)}
            for child in sorted(path.iterdir()):
                visit(child)
        else:
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            result[key] = {'kind': 'file', 'mode': stat.S_IMODE(info.st_mode),
                           'bytes': info.st_size, 'sha256': digest.hexdigest()}
    visit(root)
    return result


def equal_root(expected, actual):
    """Require every known directory, file, private mode and byte identity."""
    if expected != actual:
        raise ValueError('model-point-worker-root-differs')


def sqlite_image(path):
    """Read actual SQLite logical schema and all rows, independently of page layout."""
    privacy.private_path(path, directory=False)
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
        if connection.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('model-point-journal-integrity')
        schema = [list(row) for row in connection.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name')]
        tables = {}
        for kind, name, _, _sql in schema:
            if kind == 'table':
                quoted = '"' + name.replace('"', '""') + '"'
                rows = [list(row) for row in connection.execute('SELECT * FROM ' + quoted)]
                tables[name] = sorted(rows, key=lambda row: json.dumps(row, sort_keys=True))
        return {'schema': schema, 'tables': tables}


def equal_journal(expected, actual):
    """Require complete logical records rather than a path or cached receipt."""
    if expected != actual:
        raise ValueError('model-point-journal-records-differ')
