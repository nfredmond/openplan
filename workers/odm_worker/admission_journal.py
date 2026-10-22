"""Persist immutable ODM admission and one start intent, without engine resume.

This candidate is not connected to the worker. Accepted queue recovery and
started reconciliation are separate. A returned start flag never authorizes
another worker to repeat uncertain external work.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import sqlite3
import stat

FILENAME = 'odm-admissions.sqlite3'
SCHEMA_VERSION = 1
CREATE = ("CREATE TABLE admissions (request_id TEXT PRIMARY KEY, request_json TEXT NOT NULL, "
          "job_reference TEXT NOT NULL UNIQUE, admission_json TEXT NOT NULL, phase TEXT NOT NULL "
          "CHECK (phase IN ('accepted','started')), started_context_json TEXT)")


class IdentityConflict(ValueError):
    """The caller cannot replace an existing admission or start identity."""


class QueueFull(ValueError):
    """New accepted work exceeds the declared pending capacity."""


@dataclass(frozen=True)
class Entry:
    request: dict
    job_reference: str
    admission: dict
    phase: str
    started_context: dict | None


def encoded(value, *, canonical=False):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=canonical, separators=(',', ':'))


def private(path, directory):
    info = path.lstat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077 or (not directory and info.st_nlink != 1):
        raise ValueError('ODM journal path must be private and owned without aliases')


def synchronize(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def request_identity(request):
    if not isinstance(request, dict) or not isinstance(request.get('requestId'), str) or not 8 <= len(request['requestId']) <= 128:
        raise ValueError('ODM admission request ID is invalid')
    return request['requestId'], encoded(request, canonical=True)


def entry(request_id, row):
    request_json, reference, admission_json, phase, context_json = row
    request, admission = json.loads(request_json), json.loads(admission_json)
    context = json.loads(context_json) if context_json is not None else None
    if request_identity(request) != (request_id, request_json) or not isinstance(admission, dict) or admission.get('requestId') != request_id or admission.get('jobReference') != reference or admission.get('status') != 'accepted' or not isinstance(reference, str) or not reference:
        raise ValueError('Stored ODM admission identity differs')
    if phase not in ('accepted', 'started') or (phase == 'accepted' and context is not None) or (phase == 'started' and not isinstance(context, dict)):
        raise ValueError('Stored ODM start intent differs')
    if encoded(admission) != admission_json:
        raise ValueError('Stored ODM admission encoding differs')
    if context is not None and encoded(context, canonical=True) != context_json:
        raise ValueError('Stored ODM start context encoding differs')
    return Entry(request, reference, admission, phase, context)


class Journal:
    def __init__(self, root, *, timeout=2, require_existing=False):
        if type(require_existing) is not bool:
            raise ValueError('ODM existing journal mode must be boolean')
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('ODM journal timeout must be positive and finite')
        self.root = Path(root)
        if not self.root.is_absolute():
            raise ValueError('ODM journal root must be absolute')
        self.timeout = timeout
        self.require_existing = require_existing

    @contextmanager
    def connection(self):
        for ancestor in [self.root, *self.root.parents]:
            if ancestor.is_symlink():
                raise ValueError('ODM journal path must be private and owned without aliases')
        if not self.require_existing:
            try:
                self.root.mkdir(mode=0o700)
            except FileExistsError:
                pass
            else:
                synchronize(self.root.parent)
        private(self.root, True)
        database = self.root / FILENAME
        if self.require_existing:
            private(database, False)
        else:
            try:
                descriptor = os.open(database, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            except FileExistsError:
                private(database, False)
            else:
                os.close(descriptor)
                synchronize(self.root)
        for suffix in ('-wal', '-shm'):
            companion = self.root / (FILENAME + suffix)
            if companion.exists() or companion.is_symlink():
                try:
                    private(companion, False)
                except (FileNotFoundError, ValueError):
                    # SQLite can unlink a companion during lookup, leaving zero-link
                    # inode metadata. Ignore retirement only when the name is gone.
                    try:
                        companion.lstat()
                    except FileNotFoundError:
                        pass
                    else:
                        raise
        target = database.as_uri()+'?mode=rw' if self.require_existing else database
        connection = sqlite3.connect(target, uri=self.require_existing, timeout=self.timeout, isolation_level=None)
        try:
            version = connection.execute('PRAGMA user_version').fetchone()[0]
            objects = connection.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
            if self.require_existing and version != SCHEMA_VERSION:
                raise ValueError('Original ODM admission journal is not initialized')
            if not ((version == 0 and objects == []) or (version == SCHEMA_VERSION and objects == [('table', 'admissions', CREATE)])):
                raise ValueError('ODM admission journal schema differs')
            if connection.execute('PRAGMA journal_mode=WAL').fetchone() != ('wal',):
                raise ValueError('ODM journal WAL mode unavailable')
            connection.execute('PRAGMA synchronous=FULL')
            connection.execute('BEGIN IMMEDIATE')
            if version == 0:
                connection.execute(CREATE.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ', 1))
                connection.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
            if connection.execute("SELECT 1 FROM admissions WHERE phase NOT IN ('accepted','started') OR phase IS NULL LIMIT 1").fetchone() is not None:
                raise ValueError('Stored ODM start intent differs')
            yield connection
            connection.execute('COMMIT')
            synchronize(self.root)
        except BaseException:
            if connection.in_transaction:
                connection.execute('ROLLBACK')
            raise
        finally:
            connection.close()

    @staticmethod
    def read(connection, request_id):
        row = connection.execute('SELECT request_json,job_reference,admission_json,phase,started_context_json FROM admissions WHERE request_id=?', (request_id,)).fetchone()
        return entry(request_id, row) if row is not None else None

    def admit(self, request, factory, *, max_queued):
        request_id, request_json = request_identity(request)
        if not isinstance(max_queued, int) or isinstance(max_queued, bool) or max_queued < 0:
            raise ValueError('ODM admission queue ceiling is invalid')
        with self.connection() as connection:
            existing = self.read(connection, request_id)
            if existing is not None:
                if encoded(existing.request, canonical=True) != request_json:
                    raise IdentityConflict('ODM request identity already exists with another payload')
                return existing, False
            pending = connection.execute("SELECT COUNT(*) FROM admissions WHERE phase='accepted'").fetchone()[0]
            if pending >= max_queued:
                raise QueueFull('ODM pending admission queue is full')
            reference, admission = factory(json.loads(request_json))
            if not isinstance(reference, str) or not reference or not isinstance(admission, dict) or admission.get('jobReference') != reference or admission.get('requestId') != request_id or admission.get('status') != 'accepted':
                raise ValueError('ODM admission factory identity differs')
            admission_json = encoded(admission)
            connection.execute('INSERT INTO admissions VALUES (?,?,?,?,?,?)',
                               (request_id, request_json, reference, admission_json, 'accepted', None))
            result = self.read(connection, request_id)
        return result, True

    def get(self, request_id):
        with self.connection() as connection:
            return self.read(connection, request_id)

    def get_reference(self, reference):
        """Resolve one original unique reference and recheck its complete row."""
        if not isinstance(reference, str) or not 1 <= len(reference) <= 256:
            raise ValueError('ODM original reference lookup differs')
        with self.connection() as connection:
            row = connection.execute('SELECT request_id FROM admissions WHERE job_reference=?',
                                     (reference,)).fetchone()
            found = self.read(connection, row[0]) if row is not None else None
            if found is not None and found.job_reference != reference:
                raise ValueError('ODM original reference lookup differs')
            return found

    def accepted(self):
        with self.connection() as connection:
            rows = connection.execute("SELECT request_id,request_json,job_reference,admission_json,phase,started_context_json FROM admissions WHERE phase='accepted' ORDER BY request_id").fetchall()
            return [entry(row[0], row[1:]) for row in rows]

    def started(self):
        with self.connection() as connection:
            rows = connection.execute("SELECT request_id,request_json,job_reference,admission_json,phase,started_context_json FROM admissions WHERE phase='started' ORDER BY request_id").fetchall()
            return [entry(row[0], row[1:]) for row in rows]

    def start(self, request_id, reference, context):
        if not isinstance(context, dict):
            raise ValueError('ODM start context must be an object')
        context_json = encoded(context, canonical=True)
        with self.connection() as connection:
            existing = self.read(connection, request_id)
            if existing is None or existing.job_reference != reference:
                raise IdentityConflict('ODM start does not match the original admission')
            if existing.phase == 'started':
                if encoded(existing.started_context, canonical=True) != context_json:
                    raise IdentityConflict('ODM start intent already exists with another context')
                return existing, False
            connection.execute("UPDATE admissions SET phase='started',started_context_json=? WHERE request_id=? AND phase='accepted'", (context_json, request_id))
            result = self.read(connection, request_id)
        return result, True
