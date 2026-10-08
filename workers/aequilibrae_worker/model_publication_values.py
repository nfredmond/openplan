"""Validate the uninstalled legacy publication candidate's command and receipt."""
from uuid import UUID
from model_receipt_values import same_json_value

CLAIM_FIELDS = {'workspace_id', 'model_run_id', 'track', 'claim_status', 'status_reason', 'validation_summary_json'}
METRIC_FIELDS = {'workspace_id', 'model_run_id', 'track', 'metric_key', 'metric_label', 'threshold_comparator', 'status', 'blocks_claim_grade', 'detail', 'metadata_json'}
TEXT_FIELDS = ('metric_key', 'metric_label', 'threshold_comparator', 'status', 'detail')


def canonical_uuid(value):
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise ValueError('Publication identity must be a canonical UUID')


def scope(row, args):
    if any(row.get(key) != value for key, value in (
        ('workspace_id', args['workspace_id']), ('model_run_id', args['run_id']), ('track', args['track']),
    )):
        raise ValueError('Publication row scope differs')


def validate(command):
    args = command['arguments']
    if set(args) != {'workspace_id', 'run_id', 'track', 'expected', 'payload'}:
        raise ValueError('Invalid publication arguments')
    canonical_uuid(args['workspace_id']); canonical_uuid(args['run_id'])
    if args['track'] not in ('assignment', 'behavioral_demand'):
        raise ValueError('Unsupported publication track')
    expected = args['expected']
    if not isinstance(expected, dict) or set(expected) != {'claims', 'metrics'} or any(not isinstance(expected[key], list) for key in expected) or len(expected['claims']) > 1:
        raise ValueError('Invalid publication snapshot')
    for row in expected['claims'] + expected['metrics']:
        if not isinstance(row, dict):
            raise ValueError('Invalid previous publication row')
        scope(row, args); canonical_uuid(row.get('id'))
        if row.get('county_run_id') is not None:
            raise ValueError('County evidence requires a distinct publication command')
    payload = args['payload']
    if not isinstance(payload, dict) or set(payload) != {'claim', 'metrics'}:
        raise ValueError('Invalid publication payload')
    claim = payload['claim']
    if not isinstance(claim, dict) or set(claim) != CLAIM_FIELDS:
        raise ValueError('Invalid publication claim fields')
    scope(claim, args)
    if claim['claim_status'] != 'prototype_only' or not isinstance(claim['status_reason'], str) or not isinstance(claim['validation_summary_json'], dict):
        raise ValueError('Unsupported publication claim')
    if not isinstance(payload['metrics'], list):
        raise ValueError('Invalid publication metrics')
    keys = set()
    for row in payload['metrics']:
        if not isinstance(row, dict) or set(row) != METRIC_FIELDS:
            raise ValueError('Invalid publication metric fields')
        scope(row, args)
        if any(not isinstance(row[key], str) or not row[key].strip() for key in TEXT_FIELDS):
            raise ValueError('Invalid publication metric text')
        if row['threshold_comparator'] not in ('lte', 'gte', 'between', 'eq', 'exists', 'manual') or row['status'] not in ('pass', 'warn', 'fail') or type(row['blocks_claim_grade']) is not bool or not isinstance(row['metadata_json'], dict):
            raise ValueError('Invalid publication metric values')
        if row['metric_key'] in keys:
            raise ValueError('Duplicate publication metric')
        keys.add(row['metric_key'])


def check_receipt(command, receipt):
    args = command['arguments']
    if not isinstance(receipt, dict) or any(receipt.get(key) != value for key, value in (
        ('request_id', command['request_id']), ('workspace_id', args['workspace_id']),
        ('run_id', args['run_id']), ('track', args['track']),
    )):
        raise ValueError('Publication receipt identity differs')
    evidence = receipt.get('evidence')
    if not isinstance(evidence, dict) or set(evidence) != {'claims', 'metrics'} or not isinstance(evidence['claims'], list) or len(evidence['claims']) != 1 or not isinstance(evidence['metrics'], list):
        raise ValueError('Publication receipt evidence shape differs')
    claim = evidence['claims'][0]
    def matches(row, expected):
        if not isinstance(row, dict):
            raise ValueError('Publication receipt row missing')
        canonical_uuid(row.get('id'))
        if any(key not in row or not same_json_value(row[key], value) for key, value in expected.items()):
            raise ValueError('Publication receipt row differs')
    matches(claim, {**args['payload']['claim'], 'county_run_id': None, 'reasons_json': []})
    prior_claims = args['expected']['claims']
    if prior_claims and claim['id'] != prior_claims[0]['id']:
        raise ValueError('Publication changed retained claim identity')
    expected_metrics = {row['metric_key']: row for row in args['payload']['metrics']}
    if len(evidence['metrics']) != len(expected_metrics):
        raise ValueError('Publication receipt metric count differs')
    identities = set(); keys = set()
    for row in evidence['metrics']:
        if not isinstance(row, dict) or not isinstance(row.get('metric_key'), str) or row['metric_key'] not in expected_metrics:
            raise ValueError('Unexpected publication metric')
        matches(row, {**expected_metrics[row['metric_key']], 'county_run_id': None, 'source_manifest_id': None,
                      'observed_value': None, 'threshold_value': None, 'threshold_max_value': None})
        if row['id'] in identities or row['metric_key'] in keys:
            raise ValueError('Duplicate publication receipt metric')
        identities.add(row['id']); keys.add(row['metric_key'])
    return receipt
