"""Validate retained legacy assessment requests and complete artifact receipts."""
import re
from uuid import UUID
from model_validation_receipts import assessment_receipt, verify_assessment_artifacts

PREFIXES = ('p_validation_input', 'p_comparison_basis', 'p_assessment')
IDENTITIES = ('p_workspace_id', 'p_model_run_id', 'p_stage_id', 'p_model_output_artifact_id')
FIELDS = set(IDENTITIES) | {'p_track', 'p_partition', 'p_planning_use', 'p_scientific_outcome', 'p_reasons'} | {prefix + suffix for prefix in PREFIXES for suffix in ('_file_url', '_size', '_sha256', '_metadata')}


def validate(command):
    args = command['arguments']
    if set(args) != {'run_id', 'stage_id', 'track', 'payload'}:
        raise ValueError('Invalid assessment command arguments')
    payload = args['payload']
    if not isinstance(payload, dict) or set(payload) != FIELDS:
        raise ValueError('Invalid assessment payload fields')
    for key in IDENTITIES:
        value = payload[key]
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError('Invalid assessment identity')
    if any(args[key] != payload[field] for key, field in (('run_id', 'p_model_run_id'), ('stage_id', 'p_stage_id'), ('track', 'p_track'))):
        raise ValueError('Assessment command scope differs')
    for prefix in PREFIXES:
        if not isinstance(payload[prefix + '_file_url'], str) or not payload[prefix + '_file_url'].strip():
            raise ValueError('Invalid assessment artifact reference')
        size = payload[prefix + '_size']
        digest = payload[prefix + '_sha256']
        if type(size) is not int or size < 0 or size > 9223372036854775807:
            raise ValueError('Invalid assessment artifact size')
        if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest) or not isinstance(payload[prefix + '_metadata'], dict):
            raise ValueError('Invalid assessment artifact hash or metadata')
    if payload['p_track'] not in ('assignment', 'behavioral_demand') or payload['p_scientific_outcome'] not in ('pass', 'fail', 'inconclusive'):
        raise ValueError('Invalid assessment track or outcome')
    if not isinstance(payload['p_planning_use'], str) or not payload['p_planning_use'].strip() or not isinstance(payload['p_partition'], dict) or not isinstance(payload['p_reasons'], list):
        raise ValueError('Invalid assessment scope')


def check_receipt(command, receipt):
    if not isinstance(receipt, dict) or set(receipt) != {'request_id', 'assessment', 'artifacts'} or receipt['request_id'] != command['request_id']:
        raise ValueError('Assessment request receipt differs')
    payload = command['arguments']['payload']
    if not isinstance(receipt['assessment'], dict):
        raise ValueError('Assessment command requires a single retained row')
    row = assessment_receipt(payload, receipt['assessment'])
    verify_assessment_artifacts(payload, row, receipt['artifacts'])
    return receipt
