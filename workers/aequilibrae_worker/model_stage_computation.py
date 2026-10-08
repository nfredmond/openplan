"""Retain computed stage records without silently repeating interrupted computation.

This local checkpoint does not grant stage ownership or scientific access. A
caller must establish both before invoking its computation. An interrupted start
requires explicit reconciliation; this module never guesses whether work ran.
"""
from contextlib import closing
import hashlib
import json
import model_command_client as client
import model_command_journal as journal


class ComputationUnconfirmed(RuntimeError):
    pass


def compute_once(directory, *, base_url, deployment_id, run_id, stage_id, name, inputs, compute):
    client._uuid(run_id)
    client._uuid(stage_id)
    bound = client.destination(base_url, deployment_id)
    if not isinstance(name, str) or not name.strip() or not isinstance(inputs, dict) or not callable(compute):
        raise ValueError('Named computation, input object and callable required')
    request = journal.canonical(inputs)
    identity = (bound, run_id, stage_id, name)
    with closing(journal.connect(directory)) as connection, connection:
        connection.execute('CREATE TABLE IF NOT EXISTS stage_computations (destination TEXT NOT NULL, run_id TEXT NOT NULL, stage_id TEXT NOT NULL, name TEXT NOT NULL, inputs_json TEXT NOT NULL, result_json TEXT, result_sha256 TEXT, PRIMARY KEY(destination,run_id,stage_id,name))')
        connection.execute('BEGIN IMMEDIATE')
        row = connection.execute('SELECT inputs_json,result_json,result_sha256 FROM stage_computations WHERE destination=? AND run_id=? AND stage_id=? AND name=?', identity).fetchone()
        if row is not None:
            if row[0] != request:
                raise ComputationUnconfirmed('Computation inputs changed; reconcile retained records')
            if row[1] is None:
                raise ComputationUnconfirmed('Computation previously started without a saved result; reconcile before continuing')
            if hashlib.sha256(row[1].encode()).hexdigest() != row[2]:
                raise ComputationUnconfirmed('Saved computation result digest differs')
            result = json.loads(row[1])
            if not isinstance(result, dict) or journal.canonical(result) != row[1]:
                raise ComputationUnconfirmed('Saved computation result is not a canonical object')
            return result
        connection.execute('INSERT INTO stage_computations(destination,run_id,stage_id,name,inputs_json) VALUES(?,?,?,?,?)', (*identity, request))
    # Commit the start before calling code that may consume protected evidence.
    # A crash or exception leaves this start visible and prevents automatic reuse.
    result = compute()
    if not isinstance(result, dict):
        raise ComputationUnconfirmed('Computation did not return an object')
    payload = journal.canonical(result)
    digest = hashlib.sha256(payload.encode()).hexdigest()
    with closing(journal.connect(directory)) as connection, connection:
        connection.execute('BEGIN IMMEDIATE')
        cursor = connection.execute('UPDATE stage_computations SET result_json=?,result_sha256=? WHERE destination=? AND run_id=? AND stage_id=? AND name=? AND inputs_json=? AND result_json IS NULL AND result_sha256 IS NULL', (payload, digest, *identity, request))
        if cursor.rowcount != 1:
            raise ComputationUnconfirmed('Computation checkpoint changed before result retention')
    return json.loads(payload)


def summaries(directory, *, base_url, deployment_id):
    """Inspect one deployment without exposing inputs/results or executing work."""
    from pathlib import Path
    import sqlite3
    bound = client.destination(base_url, deployment_id)
    path = (Path(directory) / 'model-commands.sqlite3').resolve()
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=30)) as connection:
        exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stage_computations'").fetchone()
        if exists is None:
            return []
        rows = connection.execute('SELECT run_id,stage_id,name,inputs_json,result_json,result_sha256 FROM stage_computations WHERE destination=? ORDER BY run_id,stage_id,name', (bound,)).fetchall()
    result = []
    for run_id, stage_id, name, inputs_json, result_json, digest in rows:
        client._uuid(run_id)
        client._uuid(stage_id)
        if not isinstance(name, str) or not name.strip():
            raise ValueError('Invalid computation name')
        inputs = json.loads(inputs_json)
        if not isinstance(inputs, dict) or journal.canonical(inputs) != inputs_json:
            raise ValueError('Invalid retained computation inputs')
        if result_json is None:
            if digest is not None:
                raise ValueError('Incomplete computation receipt')
            state = 'started_without_result'
        else:
            saved = json.loads(result_json)
            if not isinstance(saved, dict) or journal.canonical(saved) != result_json or hashlib.sha256(result_json.encode()).hexdigest() != digest:
                raise ValueError('Invalid retained computation result')
            state = 'result_retained'
        result.append({'run_id': run_id, 'stage_id': stage_id, 'name': name,
            'state': state, 'model_resumed': False})
    return result
