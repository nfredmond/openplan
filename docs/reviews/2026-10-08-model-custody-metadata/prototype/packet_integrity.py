"""Verify cross-file bindings in supplied logical bytes, without opening a study.

This is post-computation packet integrity, not preparation-order or scientific
acceptance proof. Callers must separately verify Storage transport bytes.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
from typing import Mapping

_spec = importlib.util.spec_from_file_location('packet_rules_v5', Path(__file__).resolve().parents[4] / 'workers/aequilibrae_worker/model_validation_core_v5.py')
_rules = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_rules)

SCHEMAS = {
    'input_bundle': 'openplan.validation-input-bundle.v2',
    'match_audit': 'openplan.pre-volume-observation-match-audit.v2',
    'comparison_basis': 'openplan.model-comparison-basis.v2',
    'assessment': 'openplan.model-validation-assessment.v2',
    'diagnosis': 'openplan.model-validation-structural-diagnosis.v2',
}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_packet(payloads: Mapping[str, bytes], *, model_run_id: str, demand_method: str) -> dict:
    """Return exact file identities only after all declared packet links agree."""
    _require(demand_method in {'aequilibrae', 'activitysim'}, 'unsupported demand method')
    _require(set(payloads) == {*SCHEMAS, 'model_output', 'observation_package'}, 'incomplete or unexpected packet files')
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in payloads.items()}
    documents = {name: json.loads(payloads[name]) for name in SCHEMAS}
    for name, schema in SCHEMAS.items():
        _require(isinstance(documents[name], dict) and documents[name].get('schema') == schema, 'packet schema mismatch: ' + name)
    bundle, audit, basis, assessment, diagnosis = [documents[name] for name in SCHEMAS]
    _rules.validate_basis(basis)
    _require(basis.get('model_run_id') == model_run_id, 'packet run mismatch')
    _require(all(item.get('method') == demand_method for item in (basis, assessment, diagnosis)), 'packet method mismatch')
    _require(assessment.get('rules_version') == 5 and assessment.get('scientific_outcome') == diagnosis.get('scientific_outcome') == 'inconclusive', 'packet outcome or rules mismatch')
    _require((basis.get('model_output_artifact') or {}).get('sha256') == hashes['model_output'], 'basis output hash mismatch')
    readiness = bundle.get('readiness_inputs') or {}
    _require((readiness.get('pre_volume_match_audit') or {}).get('sha256') == hashes['match_audit'], 'bundle audit hash mismatch')
    _require((readiness.get('observation_package') or {}).get('sha256') == hashes['observation_package'] == audit.get('observation_package_sha256'), 'observation package hash mismatch')
    exact = assessment.get('exact_inputs') or {}
    expected = {
        'validation_input_bundle_sha256': hashes['input_bundle'],
        'match_audit_sha256': hashes['match_audit'],
        'model_output_sha256': hashes['model_output'],
        'observation_package_sha256': hashes['observation_package'],
        'comparison_basis_sha256': _rules.sha256_payload(basis),
        'network_sha256': audit.get('network_sha256'),
    }
    _require(isinstance(audit.get('network_sha256'), str) and len(audit['network_sha256']) == 64 and all(c in '0123456789abcdef' for c in audit['network_sha256']), 'audit network identity missing')
    _require(all(exact.get(key) == value for key, value in expected.items()), 'assessment input binding mismatch')
    bindings = diagnosis.get('bindings') or {}
    expected = {name + '_sha256': hashes[name] for name in ('model_output', 'input_bundle', 'match_audit', 'comparison_basis', 'assessment', 'observation_package')}
    _require(all(bindings.get(key) == value for key, value in expected.items()), 'diagnosis file binding mismatch')
    return {name: {'sha256': hashes[name], 'bytes': len(data)} for name, data in payloads.items()}
