"""Retain exact legacy artifact registration without permitting stage replay."""
import json
import re
from uuid import UUID, uuid5
import model_command_journal as journal

FIELDS = {'id', 'run_id', 'stage_id', 'artifact_type', 'file_url', 'file_size_bytes', 'content_hash', 'metadata_json'}
NAMESPACE = UUID('c37e1830-3e06-48be-afd9-222880975247')


def validate(command):
    args = command['arguments']
    if set(args) != {'workspace_id', 'run_id', 'stage_id', 'payload'}:
        raise ValueError('Invalid legacy artifact arguments')
    payload = args['payload']
    if not isinstance(payload, dict) or set(payload) != FIELDS:
        raise ValueError('Invalid legacy artifact fields')
    for value in (args['workspace_id'], payload['id'], payload['run_id'], payload['stage_id']):
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError('Invalid legacy artifact identity')
    if any(args[key] != payload[key] for key in ('run_id', 'stage_id')):
        raise ValueError('Legacy artifact scope differs')
    for key in ('artifact_type', 'file_url'):
        if not isinstance(payload[key], str) or not payload[key].strip():
            raise ValueError('Invalid legacy artifact text')
    size = payload['file_size_bytes']
    if type(size) is not int or not 0 <= size <= 9223372036854775807:
        raise ValueError('Invalid legacy artifact size')
    digest = payload['content_hash']
    if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest) or not isinstance(payload['metadata_json'], dict):
        raise ValueError('Invalid legacy artifact hash or metadata')


def check_receipt(command, receipt):
    expected = {**command['arguments']['payload'], 'attempt_id': None}
    if not isinstance(receipt, dict) or not set(expected) <= set(receipt):
        raise ValueError('Missing legacy artifact receipt fields')
    if journal.canonical({key: receipt[key] for key in expected}) != journal.canonical(expected):
        raise ValueError('Legacy artifact receipt differs')
    return receipt


def prepare(directory, workspace_id, payload, *, base_url, deployment_id):
    import model_command_client as client
    bound = client.destination(base_url, deployment_id)
    request = str(uuid5(NAMESPACE, journal.canonical({'destination': bound, 'artifact_id': payload['id']})))
    command = {'request_id': request, 'destination': bound, 'operation': 'record_legacy_model_artifact',
               'arguments': {'workspace_id': workspace_id, 'run_id': payload['run_id'],
                             'stage_id': payload['stage_id'], 'payload': payload}}
    command = json.loads(journal.canonical(command))
    client.validate_command(command)
    return journal.prepare(directory, command)['command']
