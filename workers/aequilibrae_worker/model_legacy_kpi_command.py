"""Retain complete legacy KPI requests without authorizing stage replay."""
import json
import re
from uuid import UUID, uuid5
import model_command_journal as journal

FIELDS = {'id', 'run_id', 'stage_id', 'kpi_name', 'kpi_label', 'kpi_category', 'value', 'unit', 'geometry_ref', 'breakdown_json'}
NAMESPACE = UUID('73c1d36a-2b92-4076-9391-10b61e9d71d9')


def validate(command):
    import model_command_client as client
    args = command['arguments']
    if set(args) != {'workspace_id', 'run_id', 'stage_id', 'payload'}:
        raise ValueError('Invalid legacy KPI arguments')
    payload = args['payload']
    if not isinstance(payload, dict) or set(payload) != FIELDS:
        raise ValueError('Invalid legacy KPI fields')
    for value in (args['workspace_id'], payload['id'], payload['run_id'], payload['stage_id']):
        client._uuid(value)
    if any(args[key] != payload[key] for key in ('run_id', 'stage_id')):
        raise ValueError('Legacy KPI scope differs')
    if any(not isinstance(payload[key], str) or not payload[key].strip() for key in ('kpi_name', 'kpi_label', 'kpi_category')):
        raise ValueError('Invalid legacy KPI text')
    if payload['kpi_category'] not in ('accessibility', 'assignment', 'safety', 'equity', 'general') or not isinstance(payload['unit'], str):
        raise ValueError('Invalid legacy KPI category or unit')
    if payload['geometry_ref'] is not None and not isinstance(payload['geometry_ref'], str):
        raise ValueError('Invalid legacy KPI geometry')
    if payload['breakdown_json'] is not None and not isinstance(payload['breakdown_json'], dict):
        raise ValueError('Invalid legacy KPI breakdown')
    client._kpi_number(payload['value'])


def check_receipt(command, receipt):
    import model_command_client as client
    expected = {key: value for key, value in command['arguments']['payload'].items() if key != 'stage_id'}
    expected['attempt_id'] = None
    if not isinstance(receipt, dict) or not set(expected) <= set(receipt):
        raise ValueError('Missing legacy KPI receipt fields')
    actual = {key: receipt[key] for key in expected}
    expected['value'] = client._kpi_number(expected['value'])
    actual['value'] = client._kpi_number(actual['value'])
    if journal.canonical(actual) != journal.canonical(expected):
        raise ValueError('Legacy KPI receipt differs')
    return receipt


def prepare(directory, workspace_id, payload, *, name, base_url, deployment_id):
    import model_command_client as client
    if not isinstance(name, str) or not re.fullmatch(r'[a-z][a-z0-9_.-]*', name):
        raise ValueError('Stable logical KPI name required')
    if not isinstance(payload, dict) or set(payload) != FIELDS - {'id'}:
        raise ValueError('Named KPI must supply all fields except identity')
    bound = client.destination(base_url, deployment_id)
    identity = str(uuid5(NAMESPACE, journal.canonical({
        'destination': bound, 'run_id': payload['run_id'], 'stage_id': payload['stage_id'], 'name': name,
    })))
    command = {'request_id': identity, 'destination': bound, 'operation': 'record_legacy_model_kpi',
               'arguments': {'workspace_id': workspace_id, 'run_id': payload['run_id'],
                             'stage_id': payload['stage_id'], 'payload': {'id': identity, **payload}}}
    command = json.loads(journal.canonical(command))
    client.validate_command(command)
    return journal.prepare(directory, command)['command']
