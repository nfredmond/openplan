"""Admit one fresh computation; recovered claim receipts never admit replay.

Normal dispatchers do not use this yet. Their managed write and filesystem
connections must land together. This local journal is not a distributed lease;
database attempt checks still govern every subsequent write.
"""
from contextlib import closing
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Callable, TypeVar
import uuid

import model_command_client as client
import model_command_journal as journal

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
