"""Admit one fresh computation; recovered claim receipts never admit replay.

Normal dispatchers retain fresh admission before entering managed handlers.
This local journal is not a distributed lease;
database attempt checks still govern every subsequent write.
"""
from contextlib import closing
from dataclasses import dataclass
import json
import hashlib
from pathlib import Path
from typing import Callable, TypeVar
import uuid

import model_command_client as client
import model_command_journal as journal
from supabase_service_headers import service_key_headers

T = TypeVar('T')


class ReconciliationRequired(RuntimeError):
    """Saved or revoked work requires reconciliation, not another invocation."""


@dataclass(frozen=True)
class AttemptContext:
    destination: str
    workspace_id: str
    run_id: str
    stage_id: str
    attempt_id: str
    claim_request_id: str


def _reserve(directory: Path, command: dict, workspace_id: str) -> None:
    """Commit the claim and local admission together before any transport."""
    with closing(journal.connect(directory)) as connection, connection:
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('''CREATE TABLE IF NOT EXISTS execution_admissions (
            request_id TEXT PRIMARY KEY REFERENCES commands(request_id),
            workspace_id TEXT NOT NULL,
            entered INTEGER NOT NULL DEFAULT 0 CHECK(entered IN (0,1)))''')
        existing = connection.execute('SELECT request_json FROM commands WHERE request_id=?',
                                      (command['request_id'],)).fetchone()
        if existing is not None:
            raise ReconciliationRequired('Saved claim requires reconciliation; receipt recovery cannot start computation')
        connection.execute('INSERT INTO commands(request_id,destination,request_json) VALUES(?,?,?)',
                           (command['request_id'], command['destination'], journal.canonical(command)))
        connection.execute('INSERT INTO execution_admissions(request_id,workspace_id) VALUES(?,?)',
                           (command['request_id'], workspace_id))


def _enter(directory: Path, command: dict, workspace_id: str) -> None:
    """Consume admission durably before the callback can perform any work."""
    with closing(journal.connect(directory)) as connection, connection:
        connection.execute('BEGIN IMMEDIATE')
        changed = connection.execute('''UPDATE execution_admissions SET entered=1
            WHERE request_id=? AND workspace_id=? AND entered=0''',
            (command['request_id'], workspace_id)).rowcount
        if changed != 1:
            raise ReconciliationRequired('Computation admission is absent or already consumed')


def invoke_new_attempt(directory: Path, *, run_id: str, stage_id: str, worker_id: str,
                       workspace_id: str, base_url: str, deployment_id: str,
                       service_key: str, handler: Callable[[AttemptContext], T],
                       post=None, get=None) -> T | None:
    """Create a new claim identity, never accept a recovered execution request.

    A separate worker or restored installation also needs its own new claim.
    The database decides whether it can own the stage. Receipt recovery uses
    the existing recovery CLI and has no callback entrypoint.
    """
    command = {'request_id': str(uuid.uuid4()),
               'destination': client.destination(base_url, deployment_id),
               'operation': 'claim_model_stage_attempt',
               'arguments': {'run_id': run_id, 'stage_id': stage_id, 'worker_id': worker_id}}
    return _invoke_fresh_claim(directory, command, workspace_id=workspace_id,
                               base_url=base_url, deployment_id=deployment_id,
                               service_key=service_key, handler=handler, post=post, get=get)


def _invoke_fresh_claim(directory: Path, command: dict, *, workspace_id: str,
                       base_url: str, deployment_id: str, service_key: str,
                       handler: Callable[[AttemptContext], T], post=None, get=None) -> T | None:
    """Invoke only after a fresh checked claim and a current ownership snapshot.

    None means the database declined the claim. Any uncertain claim, ownership
    read, callback failure or process loss leaves a permanent local reservation.
    Recovery can retrieve its receipt but must not call the handler again.
    The callback owns fenced progress/output/terminal commands. This helper
    never guesses a failed terminal state from a transport or callback error.
    """
    command = json.loads(journal.canonical(command))
    client.validate_command(command)
    client._uuid(workspace_id)
    if command['operation'] != 'claim_model_stage_attempt':
        raise ValueError('Execution admission requires a claim command')
    if command['destination'] != client.destination(base_url, deployment_id):
        raise ValueError('Claim belongs to another deployment')
    if not service_key or not callable(handler):
        raise ValueError('Service credential and handler required')
    directory = Path(directory)
    _reserve(directory, command, workspace_id)
    receipt = client.deliver(directory, command, base_url=base_url,
                             deployment_id=deployment_id, service_key=service_key, post=post)
    if receipt['outcome'] == 'not_claimed':
        return None
    snapshot = client.inspect_ownership(command, receipt, workspace_id=workspace_id,
                                        base_url=base_url, deployment_id=deployment_id,
                                        service_key=service_key, get=get)
    if not snapshot['owns_stage']:
        raise ReconciliationRequired('Claim no longer owns the stage; computation was not admitted')
    context = AttemptContext(command['destination'], workspace_id,
                             command['arguments']['run_id'], command['arguments']['stage_id'],
                             receipt['attempt_id'], command['request_id'])
    _enter(directory, command, workspace_id)
    return handler(context)


def dispatch_queued_stage(directory: Path, stage: dict, *, base_url: str,
                          deployment_id: str, service_key: str, worker_id: str,
                          handler, post=None, get=None):
    """Join a queued managed stage to the existing fresh admission and writer.

    The caller owns serialization. A saved uncertain command blocks new claims;
    neither receipt recovery nor caller-supplied scope authorizes computation.
    """
    import model_attempt_writer as managed
    if get is None:
        import requests
        get = requests.get
    for field in ('id', 'run_id'):
        client._uuid(stage[field])
    response = get(base_url.rstrip('/') + '/rest/v1/model_run_stages',
        headers=service_key_headers(service_key),
        params={'id': 'eq.' + stage['id'], 'run_id': 'eq.' + stage['run_id'],
                'select': 'id,run_id,stage_name,status,updated_at,attempt_managed,active_attempt_id,model_runs!inner(id,workspace_id,status,attempt_managed)'},
        timeout=(5, 30), allow_redirects=False)
    try:
        rows = response.json() if response.status_code == 200 else None
        if not isinstance(rows, list) or len(rows) != 1:
            raise ReconciliationRequired('Managed dispatch scope is unreadable')
        row = rows[0]
        run = row['model_runs']
        client._uuid(run['workspace_id'])
        if (row['id'] != stage['id'] or row['run_id'] != stage['run_id']
                or row['stage_name'] != stage['stage_name'] or row['attempt_managed'] is not True
                or run['id'] != stage['run_id'] or run['attempt_managed'] is not True):
            raise ReconciliationRequired('Managed dispatch scope differs')
        if row['status'] != 'queued' or row['active_attempt_id'] is not None or run['status'] not in ('queued', 'running'):
            return None
        workspace_id = run['workspace_id']
        client._timestamp(row['updated_at'])
        if row['updated_at'] != stage['updated_at']:
            return None
        queued_version = row['updated_at']
    finally:
        response.close()
    # A new reviewed queued version gets a separate retained journal. Unknown
    # commands in its own version still block admission; old retry journals stay.
    generation = hashlib.sha256(journal.canonical({'stage_id': stage['id'], 'queued_version': queued_version}).encode()).hexdigest()
    directory = Path(directory) / generation
    destination = client.destination(base_url, deployment_id)
    if directory.exists() and journal.pending(directory, destination):
        raise ReconciliationRequired('Saved uncertain stage command requires reconciliation')
    def admitted(context):
        writer = managed.AttemptWriter(directory, context, base_url=base_url,
            deployment_id=deployment_id, service_key=service_key, post=post, get=get)
        try:
            with managed.bind(writer):
                return handler(stage)
        except BaseException:
            writer.stopped = True
            raise
    return invoke_new_attempt(directory, run_id=stage['run_id'], stage_id=stage['id'],
        workspace_id=workspace_id, worker_id=worker_id, base_url=base_url,
        deployment_id=deployment_id, service_key=service_key, handler=admitted, post=post, get=get)
