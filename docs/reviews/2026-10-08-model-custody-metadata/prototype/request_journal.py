"""Retain exact command identity before transport; no automatic dispatch.

Uses the existing OCR journal's private SQLite/WAL/FULL approach. Requests and
resolved receipts are immutable, unlike the OCR job's evolving payload.
"""
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import time


def canonical(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def enable_wal(connection, timeout: float = 30):
    """Retry first-open WAL negotiation, which can return BUSY immediately."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            connection.execute('PRAGMA journal_mode=WAL')
            return
        except sqlite3.OperationalError as error:
            if getattr(error, 'sqlite_errorcode', None) != sqlite3.SQLITE_BUSY or time.monotonic() >= deadline:
                raise
            time.sleep(0.05)


def connect(directory: Path):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    path = directory / 'model-commands.sqlite3'
    connection = sqlite3.connect(path, timeout=30)
    try:
        os.chmod(path, 0o600)
        enable_wal(connection)
        connection.execute('PRAGMA synchronous=FULL')
        connection.execute('CREATE TABLE IF NOT EXISTS commands (request_id TEXT PRIMARY KEY, destination TEXT NOT NULL, request_json TEXT NOT NULL, response_json TEXT)')
        return connection
    except BaseException:
        connection.close()
        raise


def validate(command: dict) -> str:
    if not isinstance(command, dict) or set(command) != {'request_id', 'destination', 'operation', 'arguments'}:
        raise ValueError('Invalid journal command shape')
    if any(not isinstance(command[key], str) or not command[key].strip() for key in ('request_id', 'destination', 'operation')) or not isinstance(command['arguments'], dict):
        raise ValueError('Invalid journal command identity')
    return canonical(command)


def record(row) -> dict:
    return {'command': json.loads(row[0]), 'response': None if row[1] is None else json.loads(row[1]), 'resolved': row[1] is not None}


def prepare(directory: Path, command: dict) -> dict:
    """Commit an exact request before the caller sends it to its bound deployment."""
    request = validate(command)
    with closing(connect(directory)) as connection, connection:
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('INSERT INTO commands(request_id,destination,request_json) VALUES(?,?,?) ON CONFLICT(request_id) DO NOTHING', (command['request_id'], command['destination'], request))
        row = connection.execute('SELECT request_json,response_json FROM commands WHERE request_id=?', (command['request_id'],)).fetchone()
        if row[0] != request:
            raise ValueError('Journal request identity reused with different contents')
        return record(row)


def resolve(directory: Path, command: dict, response: dict) -> dict:
    """Retain a checked server receipt; the transport validates its meaning first."""
    request = validate(command)
    if not isinstance(response, dict):
        raise ValueError('Journal receipt must be an object')
    receipt = canonical(response)
    with closing(connect(directory)) as connection, connection:
        connection.execute('BEGIN IMMEDIATE')
        row = connection.execute('SELECT request_json,response_json FROM commands WHERE request_id=?', (command['request_id'],)).fetchone()
        if row is None or row[0] != request:
            raise ValueError('Journal receipt has no matching prepared request')
        if row[1] is not None and row[1] != receipt:
            raise ValueError('Journal resolved receipt cannot change')
        connection.execute('UPDATE commands SET response_json=? WHERE request_id=?', (receipt, command['request_id']))
        return record((request, receipt))


def pending(directory: Path, destination: str) -> list[dict]:
    """Read unresolved commands for one configured deployment without dispatching."""
    with closing(connect(directory)) as connection:
        rows = connection.execute('SELECT request_json,response_json FROM commands WHERE destination=? AND response_json IS NULL ORDER BY rowid', (destination,)).fetchall()
        return [record(row) for row in rows]
