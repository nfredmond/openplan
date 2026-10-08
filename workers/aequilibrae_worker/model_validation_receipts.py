"""Check the identity and values returned by legacy assessment custody writes."""
from uuid import UUID
from model_receipt_values import same_json_value


def assessment_receipt(payload: dict, result: object) -> dict:
    # PostgREST versions may return a composite row or a single-row array.
    if isinstance(result, list) and len(result) == 1:
        result = result[0]
    if not isinstance(result, dict):
        raise ValueError('Expected one assessment receipt')
    expected = {
        'workspace_id': payload['p_workspace_id'],
        'model_run_id': payload['p_model_run_id'],
        'track': payload['p_track'],
        'model_output_artifact_id': payload['p_model_output_artifact_id'],
        'comparison_basis_sha256': payload['p_comparison_basis_sha256'],
        'validation_rules_version': 4,
        'partition_json': payload['p_partition'],
        'planning_use': payload['p_planning_use'],
        'scientific_outcome': payload['p_scientific_outcome'],
        'reasons_json': payload['p_reasons'],
    }
    if any(key not in result or not same_json_value(result[key], value) for key, value in expected.items()):
        raise ValueError('Assessment receipt differs from submitted evidence')
    artifact_keys = ('model_output_artifact_id', 'validation_input_bundle_artifact_id',
                     'comparison_basis_artifact_id', 'model_validation_assessment_artifact_id')
    for key in ('id', 'workspace_id', 'model_run_id', *artifact_keys):
        value = result.get(key)
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError('Assessment receipt identity is invalid')
    if len({result[key] for key in artifact_keys}) != len(artifact_keys):
        raise ValueError('Assessment receipt reuses artifact identities')
    return result
