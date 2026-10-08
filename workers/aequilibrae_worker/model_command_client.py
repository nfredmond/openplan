"""Deliver retained model commands without treating a missing reply as rollback.

Selected legacy output and assessment writes use this client. Complete stage
restart still requires claim, output, completion and current ownership custody.
Credentials stay in memory; every request is bound to a deployment and URL.
"""
import json
import math
import re
from urllib.parse import urlsplit
from uuid import UUID
import model_command_journal as journal
import model_publication_values as publication
import model_assessment_values as assessment
import model_legacy_artifact_command as legacy_artifact
import model_legacy_kpi_command as legacy_kpi
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


def _kpi_number(value):
    if value is None:
        return None
    if type(value) not in (int, float):
        raise ValueError('KPI value must be a finite number or explicit null')
    try:
        number = float(value)
    except OverflowError:
        raise ValueError('KPI value exceeds stored numeric precision') from None
    if not math.isfinite(number) or number != value:
        raise ValueError('KPI value exceeds stored numeric precision')
    return number


def _validate_kpi(command: dict):
    args = command['arguments']
    if set(args) != {'run_id', 'stage_id', 'attempt_id', 'payload'}:
        raise ValueError('Invalid KPI command arguments')
    for key in ('run_id', 'stage_id', 'attempt_id'):
        _uuid(args[key])
    payload = args['payload']
    required = {'kpi_name', 'kpi_label', 'value'}
    optional = {'kpi_category', 'unit', 'geometry_ref', 'breakdown_json'}
    if not isinstance(payload, dict) or not required <= set(payload) or set(payload) - required - optional:
        raise ValueError('Invalid KPI payload fields')
    if any(not isinstance(payload[key], str) for key in ('kpi_name', 'kpi_label')):
        raise ValueError('KPI name and label must be strings')
    for key in ('kpi_category', 'unit', 'geometry_ref'):
        if payload.get(key) is not None and not isinstance(payload[key], str):
            raise ValueError('KPI text field has an invalid type')
    if payload.get('breakdown_json') is not None and not isinstance(payload['breakdown_json'], dict):
        raise ValueError('KPI breakdown must be an object or null')
    _kpi_number(payload['value'])


def _kpi_receipt(command: dict, receipt: object) -> dict:
    try:
        if not isinstance(receipt, dict):
            raise ValueError('KPI receipt is not an object')
        _uuid(receipt.get('id'))
        args = command['arguments']
        payload = args['payload']
        expected = {'run_id': args['run_id'], 'attempt_id': args['attempt_id'],
                    'kpi_name': payload['kpi_name'], 'kpi_label': payload['kpi_label'],
                    'kpi_category': payload.get('kpi_category') if payload.get('kpi_category') is not None else 'accessibility',
                    'unit': payload.get('unit') if payload.get('unit') is not None else '',
                    'geometry_ref': payload.get('geometry_ref'),
                    'breakdown_json': payload.get('breakdown_json', {})}
        if any(key not in receipt for key in expected) or journal.canonical({key: receipt[key] for key in expected}) != journal.canonical(expected):
            raise ValueError('KPI receipt identity or metadata differs')
        if 'value' not in receipt or _kpi_number(receipt['value']) != _kpi_number(payload['value']):
            raise ValueError('KPI receipt value differs')
    except (ValueError, TypeError, AttributeError, KeyError, OverflowError):
        raise DeliveryUnconfirmed('KPI receipt does not match the prepared command') from None
    return receipt


INSTRUMENT_ROLES = ('model_output', 'input_bundle', 'match_audit', 'comparison_basis', 'assessment', 'diagnosis')


def _validate_instrument(command: dict):
    args = command['arguments']
    if set(args) != {'workspace_id', 'run_id', 'stage_id', 'attempt_id', 'payload'}:
        raise ValueError('Invalid instrument command arguments')
    for key in ('workspace_id', 'run_id', 'stage_id', 'attempt_id'):
        _uuid(args[key])
    payload = args['payload']
    required = {'demand_method', 'scientific_outcome'} | {
        role + suffix for role in INSTRUMENT_ROLES for suffix in ('_artifact_id', '_sha256')}
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError('Incomplete or unexpected instrument payload fields')
    if payload['demand_method'] not in ('aequilibrae', 'activitysim') or payload['scientific_outcome'] != 'inconclusive':
        raise ValueError('Unsupported instrument method or outcome')
    identities = []
    for role in INSTRUMENT_ROLES:
        _uuid(payload[role + '_artifact_id'])
        identities.append(payload[role + '_artifact_id'])
        digest = payload[role + '_sha256']
        if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
            raise ValueError('Instrument artifact hash missing or invalid')
    if len(set(identities)) != len(identities):
        raise ValueError('Instrument artifact identities must be distinct')


def _instrument_receipt(command: dict, receipt: object) -> dict:
    try:
        if not isinstance(receipt, dict):
            raise ValueError('Instrument receipt is not an object')
        _uuid(receipt.get('id'))
        args = command['arguments']
        expected = {'workspace_id': args['workspace_id'], 'model_run_id': args['run_id'],
                    'stage_id': args['stage_id'], 'attempt_id': args['attempt_id'], **args['payload']}
        if any(key not in receipt for key in expected) or journal.canonical({key: receipt[key] for key in expected}) != journal.canonical(expected):
            raise ValueError('Instrument receipt custody differs')
    except (ValueError, TypeError, AttributeError, KeyError):
        raise DeliveryUnconfirmed('Instrument receipt does not match the prepared command') from None
    return receipt


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
    if operation == 'record_legacy_model_kpi':
        legacy_kpi.validate(command)
        return
    if operation == 'record_legacy_model_artifact':
        legacy_artifact.validate(command)
        return
    if operation == 'record_legacy_model_assessment':
        assessment.validate(command)
        return
    if operation == 'publish_legacy_model_evidence':
        publication.validate(command)
        return
    if operation == 'write_model_attempt_artifact':
        _validate_artifact(command)
        return
    if operation == 'write_model_attempt_kpi':
        _validate_kpi(command)
        return
    if operation == 'record_model_attempt_instrument':
        _validate_instrument(command)
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
    if command['operation'] == 'record_legacy_model_kpi':
        try:
            return legacy_kpi.check_receipt(command, receipt)
        except (ValueError, TypeError, KeyError, AttributeError):
            raise DeliveryUnconfirmed('Legacy KPI receipt does not match the prepared command') from None
    if command['operation'] == 'record_legacy_model_artifact':
        try:
            return legacy_artifact.check_receipt(command, receipt)
        except (ValueError, TypeError, KeyError, AttributeError):
            raise DeliveryUnconfirmed('Legacy artifact receipt does not match the prepared command') from None
    if command['operation'] == 'record_legacy_model_assessment':
        try:
            return assessment.check_receipt(command, receipt)
        except (ValueError, TypeError, KeyError, AttributeError):
            raise DeliveryUnconfirmed('Assessment receipt does not match the prepared evidence') from None
    if command['operation'] == 'publish_legacy_model_evidence':
        try:
            return publication.check_receipt(command, receipt)
        except (ValueError, TypeError, KeyError, AttributeError):
            raise DeliveryUnconfirmed('Publication receipt does not match the prepared evidence') from None
    if command['operation'] == 'write_model_attempt_artifact':
        return _artifact_receipt(command, receipt)
    if command['operation'] == 'write_model_attempt_kpi':
        return _kpi_receipt(command, receipt)
    if command['operation'] == 'record_model_attempt_instrument':
        return _instrument_receipt(command, receipt)
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
    if command['operation'] in ('record_legacy_model_artifact', 'record_legacy_model_kpi'):
        return {'p_workspace': args['workspace_id'], 'p_payload': args['payload']}
    if command['operation'] == 'record_legacy_model_assessment':
        return {'p_request': command['request_id'], 'p_payload': args['payload']}
    if command['operation'] == 'publish_legacy_model_evidence':
        return {'p_request': command['request_id'], 'p_workspace': args['workspace_id'], 'p_run': args['run_id'],
                'p_track': args['track'], 'p_expected': args['expected'], 'p_payload': args['payload']}
    result = {'p_request_id': command['request_id']}
    keys = {
        'claim_model_stage_attempt': ('stage_id', 'worker_id'),
        'write_model_stage_attempt': ('attempt_id', 'status', 'log_tail', 'error'),
        'write_model_attempt_artifact': ('attempt_id', 'payload'),
        'write_model_attempt_kpi': ('attempt_id', 'payload'),
        'record_model_attempt_instrument': ('attempt_id', 'payload'),
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


class OwnershipUnconfirmed(RuntimeError):
    """Current ownership could not be read; no terminal write follows from this."""


def inspect_ownership(claim_command: dict, claim_receipt: dict, *, workspace_id: str,
                      base_url: str, deployment_id: str, service_key: str, get=None) -> dict:
    """Read stage and parent together before attempting recovery.

    This is a point-in-time snapshot, not a lease or permission to publish later.
    Every subsequent mutation still needs the database's attempt fence. A false
    result stops this attempt; it does not authorize a failure write or relaunch.
    """
    claim_command = json.loads(journal.canonical(claim_command))
    claim_receipt = json.loads(journal.canonical(claim_receipt))
    validate_command(claim_command)
    if claim_command['operation'] != 'claim_model_stage_attempt':
        raise ValueError('Ownership recovery requires the original claim command')
    if claim_command['destination'] != destination(base_url, deployment_id):
        raise ValueError('Claim belongs to another deployment')
    checked_receipt(claim_command, claim_receipt)
    if claim_receipt['outcome'] != 'claimed':
        raise ValueError('A lost claim owns no attempt to recover')
    _uuid(workspace_id)
    if not service_key:
        raise ValueError('Service credential required')
    args = claim_command['arguments']
    if get is None:
        import requests
        get = requests.get
    try:
        response = get(base_url.rstrip('/') + '/rest/v1/model_run_stages',
                       headers={'apikey': service_key, 'Authorization': 'Bearer ' + service_key},
                       params={'id': 'eq.' + args['stage_id'], 'run_id': 'eq.' + args['run_id'],
                               'model_runs.workspace_id': 'eq.' + workspace_id,
                               'select': 'id,run_id,status,attempt_managed,active_attempt_id,model_runs!inner(id,workspace_id,status,attempt_managed)'},
                       timeout=(5, 30), allow_redirects=False)
    except Exception:
        raise OwnershipUnconfirmed('Model ownership transport did not confirm a snapshot') from None
    try:
        if response.status_code != 200:
            raise OwnershipUnconfirmed('Model ownership read returned an unconfirmed status')
        try:
            rows = response.json()
            if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
                raise ValueError('Missing unique stage snapshot')
            stage = rows[0]
            run = stage['model_runs']
            if not isinstance(run, dict):
                raise ValueError('Missing parent snapshot')
            if stage.get('id') != args['stage_id'] or stage.get('run_id') != args['run_id'] or run.get('id') != args['run_id'] or run.get('workspace_id') != workspace_id:
                raise ValueError('Snapshot identity differs')
            if type(stage.get('attempt_managed')) is not bool or type(run.get('attempt_managed')) is not bool:
                raise ValueError('Snapshot ownership mode missing')
            statuses = ('queued', 'running', 'succeeded', 'failed', 'cancelled')
            if stage.get('status') not in (*statuses, 'skipped') or run.get('status') not in statuses:
                raise ValueError('Snapshot status missing or invalid')
            active = stage['active_attempt_id']
            if active is not None:
                _uuid(active)
        except (ValueError, KeyError, TypeError, AttributeError):
            raise OwnershipUnconfirmed('Model ownership snapshot is incomplete or mismatched') from None
        owns = (stage['attempt_managed'] and run['attempt_managed']
                and stage['status'] == 'running' and run['status'] == 'running'
                and active == claim_receipt['attempt_id'])
        return {'owns_stage': owns, 'active_attempt_id': active,
                'stage_status': stage['status'], 'run_status': run['status'],
                'stage_managed': stage['attempt_managed'], 'run_managed': run['attempt_managed']}
    finally:
        response.close()
