"""Deliver retained model commands without treating a missing reply as rollback.

The stage dispatchers do not use this client yet. Adoption requires their complete
claim, output, assessment, completion and restart paths to use attempt custody.
Credentials stay in memory; every request is bound to a deployment and URL.
"""
import json
import re
from urllib.parse import urlsplit
from uuid import UUID
import model_command_journal as journal
from datetime import datetime


class DeliveryUnconfirmed(RuntimeError):
    pass


def destination(base_url: str, deployment_id: str) -> str:
    parsed = urlsplit(base_url)
    if not deployment_id.strip() or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Invalid configured deployment identity or URL')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('Deployment requires HTTPS or explicit loopback HTTP')
    if not parsed.hostname:
        raise ValueError('Deployment host missing')
    return journal.canonical({'deployment_id': deployment_id, 'base_url': base_url.rstrip('/')})


def _validate_artifact(command: dict):
    args = command['arguments']
    if set(args) != {'run_id', 'stage_id', 'attempt_id', 'payload'}:
        raise ValueError('Invalid artifact command arguments')
    for value in [command['request_id'], args['run_id'], args['stage_id'], args['attempt_id']]:
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError('Artifact command identities must be canonical UUIDs')
    payload = args['payload']
    required = {'artifact_type', 'file_url', 'file_size_bytes', 'content_hash'}
    if not isinstance(payload, dict) or not required <= set(payload) or set(payload) - required - {'metadata_json'}:
        raise ValueError('Invalid artifact payload fields')
    if any(not isinstance(payload[key], str) or not payload[key] for key in ('artifact_type', 'file_url')):
        raise ValueError('Artifact type and reference required')
    if type(payload['file_size_bytes']) is not int or payload['file_size_bytes'] < 0 or not isinstance(payload['content_hash'], str) or not re.fullmatch('[0-9a-f]{64}', payload['content_hash']):
        raise ValueError('Invalid artifact byte identity')
    if not isinstance(payload.get('metadata_json', {}), dict):
        raise ValueError('Artifact metadata must be an object')


def _artifact_receipt(command: dict, receipt: object) -> dict:
    if not isinstance(receipt, dict):
        raise DeliveryUnconfirmed('Artifact receipt is not an object')
    try:
        if str(UUID(receipt['id'])) != receipt['id']:
            raise ValueError('noncanonical')
    except (KeyError, ValueError, TypeError, AttributeError):
        raise DeliveryUnconfirmed('Artifact receipt has no valid identity') from None
    args = command['arguments']
    expected = {key: args[key] for key in ('run_id', 'stage_id', 'attempt_id')}
    expected.update({'metadata_json': {}, **args['payload']})
    if any(key not in receipt for key in expected) or journal.canonical({key: receipt[key] for key in expected}) != journal.canonical(expected):
        raise DeliveryUnconfirmed('Artifact receipt does not match the prepared command')
    return receipt


def _uuid(value):
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise ValueError('Command identities must be canonical UUIDs')


def validate_command(command: dict):
    journal.validate(command)
    _uuid(command['request_id'])
    args = command['arguments']
    operation = command['operation']
    if operation == 'write_model_attempt_artifact':
        _validate_artifact(command)
        return
    fields = {
        'claim_model_stage_attempt': {'run_id', 'stage_id', 'worker_id'},
        'write_model_stage_attempt': {'run_id', 'stage_id', 'attempt_id', 'status', 'log_tail', 'error'},
    }
    if operation not in fields or set(args) != fields[operation]:
        raise ValueError('Unsupported operation or invalid command arguments')
    for key in ('run_id', 'stage_id'):
        _uuid(args[key])
    if operation == 'claim_model_stage_attempt':
        worker = args['worker_id']
        if not isinstance(worker, str) or not worker.strip() or len(worker) > 200:
            raise ValueError('Invalid worker identity')
        return
    _uuid(args['attempt_id'])
    if args['status'] not in ('running', 'succeeded', 'failed'):
        raise ValueError('Invalid stage status')
    for key, limit in (('log_tail', 20000), ('error', 2000)):
        value = args[key]
        if value is not None and (not isinstance(value, str) or len(value) > limit):
            raise ValueError('Invalid stage text')
    if args['status'] != 'failed' and args['error'] is not None:
        raise ValueError('Only a failed stage may carry an error')


def _timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Missing completion timestamp')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('Completion timestamp requires a timezone')


def checked_receipt(command: dict, receipt: object) -> dict:
    if command['operation'] == 'write_model_attempt_artifact':
        return _artifact_receipt(command, receipt)
    args = command['arguments']
    try:
        if not isinstance(receipt, dict):
            raise ValueError('Missing receipt object')
        if any(receipt.get(key) != value for key, value in
               (('request_id', command['request_id']), ('stage_id', args['stage_id']))):
            raise ValueError('Receipt identity differs')
        if command['operation'] == 'claim_model_stage_attempt':
            if receipt.get('run_id') != args['run_id']:
                raise ValueError('Claim belongs to another run')
            if receipt.get('outcome') == 'claimed':
                _uuid(receipt.get('attempt_id'))
            elif receipt.get('outcome') == 'not_claimed':
                if 'attempt_id' not in receipt or receipt['attempt_id'] is not None:
                    raise ValueError('Lost claim carries an attempt')
            else:
                raise ValueError('Unknown claim outcome')
        else:
            if receipt.get('attempt_id') != args['attempt_id'] or receipt.get('status') != args['status']:
                raise ValueError('Stage receipt differs from command')
            if args['status'] == 'running':
                if 'completed_at' not in receipt or receipt['completed_at'] is not None:
                    raise ValueError('Running stage has completion')
            else:
                _timestamp(receipt.get('completed_at'))
            allowed_parent = {'running': ('queued', 'running'),
                              'succeeded': ('queued', 'running', 'succeeded'),
                              'failed': ('failed',)}[args['status']]
            if receipt.get('run_status') not in allowed_parent:
                raise ValueError('Parent outcome contradicts stage outcome')
            if receipt['run_status'] in ('succeeded', 'failed'):
                _timestamp(receipt.get('run_completed_at'))
            elif 'run_completed_at' not in receipt or receipt['run_completed_at'] is not None:
                raise ValueError('Active parent has completion')
    except (ValueError, TypeError, AttributeError, KeyError):
        raise DeliveryUnconfirmed('Model command receipt does not match the prepared command') from None
    return receipt


def rpc_arguments(command: dict) -> dict:
    args = command['arguments']
    result = {'p_request_id': command['request_id']}
    keys = {
        'claim_model_stage_attempt': ('stage_id', 'worker_id'),
        'write_model_stage_attempt': ('attempt_id', 'status', 'log_tail', 'error'),
        'write_model_attempt_artifact': ('attempt_id', 'payload'),
    }[command['operation']]
    result.update({'p_' + key: args[key] for key in keys})
    return result


def deliver(directory, command: dict, *, base_url: str, deployment_id: str, service_key: str, post=None) -> dict:
    """Keep uncertainty pending; only an exact checked receipt resolves the journal.

    A retained claim receipt records the original claim, not current ownership.
    Recovery must reconcile the attempt before reusing any files or executing work.
    There is deliberately no automatic retry or dispatcher in this client.
    """
    command = json.loads(journal.canonical(command))
    validate_command(command)
    if command['destination'] != destination(base_url, deployment_id):
        raise ValueError('Prepared command belongs to another deployment')
    retained = journal.prepare(directory, command)
    if retained['resolved']:
        return checked_receipt(command, retained['response'])
    if not service_key:
        raise ValueError('Service credential required')
    if post is None:
        import requests
        post = requests.post
    try:
        response = post(base_url.rstrip('/') + '/rest/v1/rpc/' + command['operation'],
                        headers={'apikey': service_key, 'Authorization': 'Bearer ' + service_key},
                        json=rpc_arguments(command), timeout=(5, 30), allow_redirects=False)
    except Exception:
        raise DeliveryUnconfirmed('Model RPC transport did not confirm a receipt') from None
    try:
        if response.status_code != 200:
            raise DeliveryUnconfirmed('Model RPC returned an unconfirmed status')
        try:
            receipt = response.json()
        except (ValueError, TypeError):
            raise DeliveryUnconfirmed('Model RPC returned invalid JSON') from None
        try:
            receipt = checked_receipt(command, receipt)
        except (ValueError, TypeError, OverflowError):
            raise DeliveryUnconfirmed('Model RPC returned a malformed receipt') from None
    finally:
        response.close()
    return journal.resolve(directory, command, receipt)['response']
