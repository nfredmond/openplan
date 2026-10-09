"""Bind initial assignment metadata to a confirmed, byte-checked preparation.

This checks custody and declared profile equality. It does not assert that every
solver setting matches its declaration, or establish network, demand or
observation equivalence and independence.
"""
import json

import model_command_client as client
import model_command_journal as journal


def _document(path, expected_hash, expected_size):
    from model_assignment_input_publication import _file
    from model_engine_channel import _unique
    record, content = _file(path, capture=True)
    if record['sha256'] != expected_hash or record['bytes'] != expected_size:
        raise ValueError('Preparation link file bytes differ')
    return json.loads(content, object_pairs_hook=_unique,
        parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite preparation metadata')))


def retained_preparation(writer, method, *, assignment_profile):
    """Select from this parent's journal, never a child-provided artifact ID."""
    from model_assignment_input_publication import _file
    from model_validation_source_catalog import _artifact
    ctx = writer.context
    selected = []
    for saved in journal.read_existing(writer.directory, ctx.destination, include_resolved=True):
        command = saved['command']
        args = command['arguments']
        if (command['operation'] != 'write_model_attempt_artifact'
                or any(args.get(key) != getattr(ctx, key) for key in ('run_id', 'stage_id', 'attempt_id'))
                or args.get('payload', {}).get('artifact_type') != 'model_validation_preparation_consumption'):
            continue
        selected.append(saved)
    if not selected:
        return {'status': 'not_retained', 'solver_input_equivalence': 'unassessed'}
    if len(selected) != 1:
        raise ValueError('Preparation link requires one confirmed consumption')
    saved = selected[0]
    receipt = client.checked_receipt(saved['command'], saved['response'])
    payload = saved['command']['arguments']['payload']
    metadata = payload.get('metadata_json', {})
    producer = metadata.get('producer', {})
    path = writer.files.path / ('predecessor_preparation_' + method) / 'manifest.json'
    if (metadata.get('schema') != 'openplan.validation-preparation-consumption.v1'
            or metadata.get('demand_method') != method
            or metadata.get('execution_authorized') is not False
            or metadata.get('scientific_acceptance') != 'unassessed'
            or payload.get('file_url') != 'local://' + str(path)):
        raise ValueError('Preparation link method, location or claims differ')
    manifest = _document(path, payload.get('content_hash'), payload.get('file_size_bytes'))
    expected_context = {'workspace_id': ctx.workspace_id, 'run_id': ctx.run_id,
        'stage_id': producer.get('stage_id'), 'attempt_id': producer.get('attempt_id'),
        'destination': ctx.destination, 'method': method}
    if (manifest.get('schema') != metadata['schema']
            or any(manifest.get('producer_context', {}).get(key) != value for key, value in expected_context.items())
            or manifest.get('producer_manifest_sha256') != producer.get('manifest_sha256')
            or manifest.get('execution_authorized') is not False
            or manifest.get('scientific_acceptance') != 'unassessed'):
        raise ValueError('Preparation link producer scope differs')
    original = _document(path.parent / 'producer_manifest.json',
        manifest['producer_manifest_sha256'], manifest['producer_manifest_size_bytes'])
    if (original.get('schema') != 'openplan.validation-preparation-files.v1'
            or original.get('context') != manifest['producer_context']
            or original.get('entries') != manifest.get('entries')
            or original.get('bundle') != manifest.get('bundle')):
        raise ValueError('Preparation link producer inventory differs')
    bundle_record = manifest.get('bundle')
    if not _artifact(bundle_record) or bundle_record['path'] != 'validation_input_bundle.json':
        raise ValueError('Preparation link bundle invalid')
    _document(path.parent / bundle_record['path'], bundle_record['sha256'], bundle_record['bytes'])
    entries = manifest.get('entries')
    if not isinstance(entries, list) or not entries:
        raise ValueError('Preparation link inventory missing')
    for entry in entries:
        record = {'path': entry.get('object_name'), 'sha256': entry.get('sha256'), 'bytes': entry.get('bytes')}
        if not _artifact(record) or record['path'] != 'sha256/' + record['sha256']:
            raise ValueError('Preparation link source identity invalid')
        actual, _ = _file(path.parent / record['path'])
        if actual['sha256'] != record['sha256'] or actual['bytes'] != record['bytes']:
            raise ValueError('Preparation link source bytes differ')
    profiles = [entry for entry in entries if entry['role'] == 'assignment_profile']
    if len(profiles) != 1:
        raise ValueError('Preparation link requires one assignment profile')
    profile_record = profiles[0]
    prepared = _document(path.parent / profile_record['object_name'],
        profile_record['sha256'], profile_record['bytes'])
    from assignment_settings import canonical_assignment_profile, assignment_profile_digest
    prepared = canonical_assignment_profile(prepared)
    current = canonical_assignment_profile(assignment_profile)
    if prepared != current:
        raise ValueError('Prepared assignment profile differs from initial assignment')
    return {'status': 'retained', 'artifact_id': receipt['id'],
        'manifest_sha256': payload['content_hash'], 'producer': producer,
        'assignment_profile': {'status': 'matched', 'scope': 'declared_assignment_profile',
            'prepared_sha256': profile_record['sha256'], 'canonical_sha256': assignment_profile_digest(current)},
        'solver_input_equivalence': 'unassessed'}
