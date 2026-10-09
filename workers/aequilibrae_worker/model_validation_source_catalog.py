"""Resolve declared instrument dependencies without publishing or changing evidence.

Document bytes are checked here. Source bindings are producer-supplied metadata;
a later publisher must verify their stored/logical bytes and retained authority.
"""
import copy
import hashlib
import json
import re
import uuid

SCHEMAS = {
    'observation_package':'openplan.validation-observation-package.v2',
    'match_audit':'openplan.pre-volume-observation-match-audit.v2',
    'input_bundle':'openplan.validation-input-bundle.v2',
    'comparison_basis':'openplan.model-comparison-basis.v2',
    'structural_audit':'openplan.model-structural-input-audit.v1',
}
DOCUMENTS = tuple(SCHEMAS)


class SourceCatalogRefused(ValueError):
    def __init__(self, problems):
        self.problems = tuple(problems)
        super().__init__('Source catalog refused: ' + '; '.join(problems))


def _artifact(value):
    return (isinstance(value, dict) and isinstance(value.get('path'), str) and bool(value['path'].strip())
        and isinstance(value.get('sha256'), str) and re.fullmatch('[0-9a-f]{64}', value['sha256'])
        and type(value.get('bytes')) is int and value['bytes'] >= 0)


def _pointer(parts):
    return '/' + '/'.join(str(part).replace('~', '~0').replace('/', '~1') for part in parts)


def _unique_object(pairs):
    value = {}
    for key, child in pairs:
        if key in value: raise ValueError('Duplicate document key')
        value[key] = child
    return value


def _invalid_number(value):
    raise ValueError('Nonfinite document number')


def build_catalog(*, context, documents, document_records, bindings):
    """Return an unresolved-publication catalog only when every declared role resolves.

    No directory scans, inferred source authority, output evaluation or filesystem
    verification occurs. Caller custody must establish the supplied context.
    """
    problems, parsed, entries, declared = [], {}, [], set()
    if not isinstance(context, dict) or context.get('method') not in ('aequilibrae', 'activitysim'):
        raise SourceCatalogRefused(['invalid method context'])
    for field in ('workspace_id', 'model_run_id', 'stage_id', 'attempt_id'):
        try:
            if str(uuid.UUID(context[field])) != context[field]: raise ValueError()
        except (KeyError, ValueError, TypeError, AttributeError):
            problems.append('invalid context ' + field)
    if not all(isinstance(value, dict) for value in (documents, document_records, bindings)):
        raise SourceCatalogRefused(problems + ['document and binding mappings required'])
    for role in DOCUMENTS:
        payload, record = documents.get(role), document_records.get(role)
        if not isinstance(payload, bytes) or not _artifact(record):
            problems.append(role + ': exact document bytes and record required'); continue
        if len(payload) != record['bytes'] or hashlib.sha256(payload).hexdigest() != record['sha256']:
            problems.append(role + ': document bytes differ'); continue
        try:
            value = json.loads(payload, object_pairs_hook=_unique_object, parse_constant=_invalid_number)
            if not isinstance(value, dict) or value.get('schema') != SCHEMAS[role]: raise ValueError()
            parsed[role] = value
        except (ValueError, UnicodeError):
            problems.append(role + ': invalid document JSON or unsupported schema'); continue
        entries.append({'role': '/' + role, 'phase': 'execution' if role == 'comparison_basis' else 'preparation',
            'original_reference': record['path'], 'artifact': {key: record[key] for key in ('path', 'sha256', 'bytes')},
            'object_name': 'sha256/' + record['sha256']})
    if problems: raise SourceCatalogRefused(problems)
    basis = parsed['comparison_basis']
    if basis.get('model_run_id') != context['model_run_id'] or basis.get('method') != context['method']:
        problems.append('comparison basis run or method differs from context')
    if parsed['structural_audit'].get('method') != context['method']:
        problems.append('structural audit method differs from context')

    def require(parts, expected, *, phase='preparation', path=None, size=None, logical=None):
        role = _pointer(parts); declared.add(role)
        binding = bindings.get(role)
        if not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected):
            problems.append(role + ': declared hash missing or invalid'); return
        if binding is None:
            problems.append(role + ': missing binding'); return
        if isinstance(binding, dict) and binding.get('status', 'available') != 'available':
            problems.append(role + ': source status ' + str(binding['status'])); return
        if not _artifact(binding):
            problems.append(role + ': malformed binding'); return
        if binding['sha256'] != expected or (path is not None and binding['path'] != path) or (size is not None and binding['bytes'] != size):
            problems.append(role + ': binding conflicts with declared reference'); return
        entry = {'role': role, 'phase': phase, 'original_reference': path if path is not None else role,
            'artifact': {key: binding[key] for key in ('path', 'sha256', 'bytes')}, 'object_name': 'sha256/' + expected}
        if logical is not None: entry['logical_source'] = logical
        entries.append(entry)

    def artifact(parts, record, *, phase='preparation'):
        if not isinstance(record, dict) or not isinstance(record.get('path'), str) or not record['path']:
            problems.append(_pointer(parts) + ': artifact reference missing'); return
        if 'bytes' in record and (type(record['bytes']) is not int or record['bytes'] < 0):
            problems.append(_pointer(parts) + ': invalid declared byte count'); return
        require(parts, record.get('sha256'), phase=phase, path=record['path'], size=record.get('bytes'))

    def readiness(parts, value):
        if isinstance(value, dict):
            if any(key in value for key in ('path', 'sha256', 'bytes')): artifact(parts, value)
            elif value:
                for key, child in value.items(): readiness(parts + [key], child)
            else: problems.append(_pointer(parts) + ': empty readiness record')
        elif isinstance(value, list):
            for index, child in enumerate(value): readiness(parts + [index], child)
        else: problems.append(_pointer(parts) + ': invalid readiness record')

    readiness(['input_bundle', 'readiness_inputs'], parsed['input_bundle'].get('readiness_inputs'))
    artifact(['observation_package', 'registry_artifact'], parsed['observation_package'].get('registry_artifact'))
    observations = parsed['observation_package'].get('observations')
    if not isinstance(observations, list): problems.append('observation_package: observations missing')
    else:
        for index, observation in enumerate(observations):
            measurements = observation.get('measurements') if isinstance(observation, dict) else None
            if not isinstance(measurements, list) or not measurements:
                problems.append(f'observation {index}: source measurements missing'); continue
            for offset, measurement in enumerate(measurements):
                if not isinstance(measurement, dict):
                    problems.append(f'observation {index}: malformed measurement'); continue
                artifact(['observation_package','observations',index,'measurements',offset,'source_member'],
                    {'path':measurement.get('source_member_path'),'sha256':measurement.get('source_member_sha256')})
                # exact_record_sha256 identifies a logical measurement, not a source file.
    audit = parsed['match_audit']
    for key in ('network_sha256', 'observation_package_sha256', 'registry_sha256'):
        require(['match_audit', key], audit.get(key))
    matcher = audit.get('matcher')
    require(['match_audit','matcher','sha256'], matcher.get('sha256') if isinstance(matcher, dict) else None)
    sources = parsed['structural_audit'].get('source_hashes')
    if not isinstance(sources, dict) or not sources: problems.append('structural_audit: source hashes missing')
    else:
        for name, record in sources.items():
            if not isinstance(record, dict) or not _artifact(record) or not isinstance(record.get('stored_path'), str):
                problems.append('structural source ' + name + ': malformed logical source'); continue
            stored_path = record['stored_path']
            compression = 'gzip' if stored_path.endswith('.gz') else 'identity'
            if (stored_path[:-3] if compression == 'gzip' else stored_path) != record['path']:
                problems.append('structural source ' + name + ': logical path differs'); continue
            require(['structural_audit','source_hashes',name], record.get('stored_sha256'), path=stored_path,
                logical={'path':record['path'],'sha256':record['sha256'],'bytes':record['bytes'],'compression':compression})
    artifact(['comparison_basis','model_output_artifact'], basis.get('model_output_artifact'), phase='execution')
    roles = [
        (['modeled_quantity','expansion_chain','run_summary_sha256'], 'execution'),
        (['modeled_quantity','expansion_chain','conservation_sha256'], 'execution'),
        (['vehicle_basis','vehicle_pce_equivalence','assignment_profile_sha256'], 'preparation'),
        (['assignment_settings','sha256'], 'preparation'),
    ]
    for parts, phase in roles:
        value = basis
        for key in parts: value = value.get(key) if isinstance(value, dict) else None
        require(['comparison_basis', *parts], value, phase=phase)
    coefficient = basis.get('coefficient_package')
    if not isinstance(coefficient, dict): problems.append('comparison_basis: coefficient package missing')
    elif 'sha256' in coefficient: require(['comparison_basis','coefficient_package','sha256'], coefficient['sha256'])
    elif coefficient.get('status') == 'bound_in_run_summary':
        require(['comparison_basis','coefficient_package','run_summary_sha256'], coefficient.get('run_summary_sha256'), phase='execution')
    else: problems.append('comparison_basis: unsupported coefficient binding')
    networks = basis.get('network_state_hashes')
    if not isinstance(networks, dict) or not networks: problems.append('comparison_basis: network dependencies missing')
    else:
        for name, digest in networks.items(): require(['comparison_basis','network_state_hashes',name], digest)
    readiness_inputs = parsed['input_bundle'].get('readiness_inputs')
    for key, document in (('observation_package','observation_package'), ('pre_volume_match_audit','match_audit')):
        reference = readiness_inputs.get(key) if isinstance(readiness_inputs, dict) else None
        if not isinstance(reference, dict) or reference.get('sha256') != document_records[document]['sha256']:
            problems.append('input_bundle: ' + key + ' differs from supplied document')
    if audit.get('observation_package_sha256') != document_records['observation_package']['sha256']:
        problems.append('match_audit: observation package differs from supplied document')
    output = basis.get('model_output_artifact')
    if isinstance(output, dict) and any(entry['phase'] == 'preparation' and entry['artifact']['path'] == output.get('path') for entry in entries):
        problems.append('preparation source aliases model output reference')
    for role in bindings.keys() - declared: problems.append(str(role) + ': undeclared binding')
    if problems: raise SourceCatalogRefused(sorted(problems))
    return {'schema':'openplan.validation-source-catalog.v1',
        'context':{key:context[key] for key in ('workspace_id','model_run_id','stage_id','attempt_id','method')},
        'entries':copy.deepcopy(sorted(entries,key=lambda row:row['role'])),
        'stored_source_bytes_verified':False, 'publication_state':'not_published',
        'preparation_independence':'unassessed', 'scientific_acceptance':'unassessed'}
