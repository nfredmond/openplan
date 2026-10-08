"""Journal one artifact RPC attempt; caller schedules any retry explicitly.

This prototype has no normal worker caller and requires the prototype SQL command.
Credentials stay in memory. A deployment identity and URL bind each request.
"""
import json
import re
from urllib.parse import urlsplit
from uuid import UUID
import request_journal as journal


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


def validate_command(command: dict):
    journal.validate(command)
    if command['operation'] != 'write_model_attempt_artifact':
        raise ValueError('Unsupported journal operation')
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


def checked_receipt(command: dict, receipt: object) -> dict:
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


def deliver(directory, command: dict, *, base_url: str, deployment_id: str, service_key: str, post=None) -> dict:
    """Keep uncertainty pending; only an exact checked receipt resolves the journal."""
    # Freeze caller-owned dictionaries before preparation and transport.
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
    args = command['arguments']
    try:
        response = post(base_url.rstrip('/') + '/rest/v1/rpc/write_model_attempt_artifact',
                        headers={'apikey': service_key, 'Authorization': 'Bearer ' + service_key},
                        json={'p_request_id': command['request_id'], 'p_attempt_id': args['attempt_id'], 'p_payload': args['payload']},
                        timeout=(5, 30), allow_redirects=False)
    except Exception:
        raise DeliveryUnconfirmed('Artifact RPC transport did not confirm a receipt') from None
    try:
        if response.status_code != 200:
            raise DeliveryUnconfirmed('Artifact RPC returned an unconfirmed status')
        try:
            receipt = response.json()
        except (ValueError, TypeError):
            raise DeliveryUnconfirmed('Artifact RPC returned invalid JSON') from None
        receipt = checked_receipt(command, receipt)
    finally:
        response.close()
    return journal.resolve(directory, command, receipt)['response']
