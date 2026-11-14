"""Register prospective package bytes and copy them into an honestly new run.

Native receipts authorize data access, never reentry into the original stage.
Local hashes detect changes; they do not exclude a hostile same-user writer.
"""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
from uuid import UUID, uuid5

import model_command_journal as journal
import model_command_client as client
import model_common_population_package as package
import model_common_population_handoff as handoff
import model_common_population_setup_recovery as recovery
import model_package_inputs as snapshots
from supabase_service_headers import service_key_headers

SCHEMA = 'openplan.population-replacement.v1'
NAMESPACE = UUID('34842a38-af5e-4163-8ae7-f4e3690229dc')
OPS = ('register_model_population_checkpoint', 'create_model_population_replacement')


def digest(value):
    return hashlib.sha256(journal.canonical(value).encode()).hexdigest()


def require_local(custody):
    if custody != 'legacy_stage_snapshot':
        raise ValueError('population_replacement_managed_unsupported: normal managed entry remains a full-v1 obligation')
    if os.getenv('OPENPLAN_HOSTED_ARTIFACT_MIRROR') == '1':
        raise ValueError('population_replacement_mirror_unsupported: registered snapshot transport remains a full-v1 obligation')


def rpc(reader, name, arguments):
    post = reader.post
    if post is None:
        import requests
        post = requests.post
    with closing(post(reader.base_url.rstrip('/') + '/rest/v1/rpc/' + name,
            headers=service_key_headers(reader.service_key),
            json=arguments, timeout=(5, 30), allow_redirects=False)) as response:
        if response.status_code != 200:
            raise ValueError('Registered population access is unconfirmed')
        value = response.json()
    if not isinstance(value, dict):
        raise ValueError('Registered population reply must be an object')
    return value


def origin(reader, run_id=None):
    """Get checked original data lineage without changing original custody."""
    value = rpc(reader, 'read_model_population_origin', {
        'p_workspace_id': reader.context.workspace_id,
        'p_run_id': run_id or reader.context.run_id})
    if value.get('schema') != SCHEMA or set(value) != {'schema', 'registration', 'origin_run', 'lineage'}:
        raise ValueError('Population origin reply differs')
    registration = value['registration']
    if (not isinstance(registration, dict) or registration.get('workspace_id') != reader.context.workspace_id
            or value['lineage'] != lineage(registration)):
        raise ValueError('Population origin scope differs')
    command = {'request_id': registration['request_id'], 'operation': OPS[0],
        'arguments': {key: registration[key] for key in ('workspace_id', 'run_id', 'stage_id', 'deployment_id', 'facts')}}
    validate(command)
    check_receipt(command, registration)
    return value


def lineage(registration):
    return {'schema': SCHEMA, 'checkpoint_id': registration['request_id'],
            'checkpoint_sha256': registration['checkpoint_sha256'],
            'source_run_id': registration['run_id'], 'source_stage_id': registration['stage_id'],
            'source_attempt_id': None, 'population_digest': registration['facts']['population_digest'],
            'package_sha256': registration['facts']['inventory']['manifest.json']['sha256']}


def publication_lineage(reader):
    run = handoff._row(reader, 'model_runs', handoff.RUN_PROJECTION,
        id=reader.context.run_id, workspace_id=reader.context.workspace_id)
    request = run['input_snapshot_json'].get('commonPopulation', {})
    if request.get('mode') == 'restore_checkpoint':
        return origin(reader)['lineage']
    if request.get('mode') == 'reuse':
        source = handoff._row(reader, 'model_runs', handoff.RUN_PROJECTION,
            id=request['source']['modelRunId'], workspace_id=reader.context.workspace_id)
        if source['input_snapshot_json']['commonPopulation'].get('mode') == 'restore_checkpoint':
            return origin(reader, source['id'])['lineage']
    return None


def validate(command):
    args = command['arguments']
    if command['operation'] == OPS[0]:
        if set(args) != {'workspace_id', 'run_id', 'stage_id', 'deployment_id', 'facts'}:
            raise ValueError('Checkpoint registration fields differ')
        for key in ('workspace_id', 'run_id', 'stage_id'):
            client._uuid(args[key])
        if not isinstance(args['deployment_id'], str) or not args['deployment_id'].strip():
            raise ValueError('Checkpoint installation required')
        if not isinstance(args['facts'], dict) or set(args['facts']) != {
                'inputs', 'inputs_sha256', 'result_sha256', 'inventory', 'snapshot', 'population_digest', 'settings', 'publication_sha256'}:
            raise ValueError('Completed checkpoint facts required')
        snapshot = args['facts']['snapshot']
        if not isinstance(snapshot, dict) or set(snapshot) != {'manifest_sha256', 'manifest_size_bytes'}:
            raise ValueError('Snapshot receipt cannot contain host paths')
        handoff._hash(snapshot['manifest_sha256'])
        handoff._size(snapshot['manifest_size_bytes'])
        for key in ('inputs_sha256', 'result_sha256', 'population_digest', 'publication_sha256'):
            handoff._hash(args['facts'][key])
        package.population_library()._reject_credentials(args['facts'])
    else:
        if set(args) != {'workspace_id', 'run_id', 'actor_id', 'expected_state', 'checkpoint_id',
                         'checkpoint_sha256', 'reason', 'acknowledged_new_run'}:
            raise ValueError('Replacement request fields differ')
        for key in ('workspace_id', 'run_id', 'actor_id', 'checkpoint_id'):
            client._uuid(args[key])
        handoff._hash(args['checkpoint_sha256'])
        if (args['acknowledged_new_run'] is not True or not isinstance(args['reason'], str)
                or not 1 <= len(args['reason'].strip()) <= 2000
                or args['expected_state'].get('status') not in ('failed', 'cancelled')):
            raise ValueError('Explicit reviewed new-run intent required')
        state = args['expected_state']
        if state.get('run_id') != args['run_id'] or state.get('workspace_id') != args['workspace_id']:
            raise ValueError('Replacement source scope differs')


def check_receipt(command, receipt):
    args = command['arguments']
    if command['operation'] == OPS[0]:
        expected = {'schema': SCHEMA, 'request_id': command['request_id'], **args,
                    'checkpoint_sha256': args['facts']['result_sha256'], 'outcome': 'checkpoint_registered'}
        if receipt != expected:
            raise ValueError('Checkpoint registration receipt differs')
    else:
        if (not isinstance(receipt, dict) or set(receipt) != {'schema', 'request_id', 'request_payload',
                'outcome', 'replacement_run_id', 'engine_key', 'old_run_changed', 'model_resumed'}
                or receipt['schema'] != SCHEMA or receipt['request_id'] != command['request_id']
                or receipt['request_payload'] != args or receipt['outcome'] != 'replacement_created'
                or receipt['old_run_changed'] is not False or receipt['model_resumed'] is not False
                or receipt['engine_key'] not in ('aequilibrae', 'behavioral_demand')):
            raise ValueError('Replacement creation receipt differs')
        client._uuid(receipt['replacement_run_id'])
        if receipt['replacement_run_id'] == args['run_id']:
            raise ValueError('Replacement must have a new identity')
    return receipt


def register(reader, directory, *, settings, deployment_id):
    """Seal a prospective completed package before the owning handler starts OSM."""
    run = handoff._row(reader, 'model_runs', handoff.RUN_PROJECTION,
        id=reader.context.run_id, workspace_id=reader.context.workspace_id)
    request = run['input_snapshot_json']['commonPopulation']
    if request['mode'] == 'restore_checkpoint':
        return origin(reader)
    require_local(request['custody'])
    inputs, result = recovery.read_checkpoint(reader, directory, base_url=reader.base_url, deployment_id=deployment_id)
    recovery.check_package(reader, inputs, result)
    request_id = str(uuid5(NAMESPACE, journal.canonical({'deployment': deployment_id,
        'run': reader.context.run_id, 'stage': reader.context.stage_id, 'result': digest(result)})))
    target = reader.files.path / 'population-checkpoints' / request_id
    reader.files.verify()
    recovery._checkpoint_path(target.parent)
    registration_dir = reader.files.path / 'population-checkpoint-commands'
    # Replacement survivor anchor: registration cannot adopt an unacknowledged snapshot.
    journal_path = recovery._checkpoint_path(registration_dir)
    saved = journal.read_existing(registration_dir, client.destination(reader.base_url, deployment_id), request_id, include_resolved=True) if journal_path.exists() else []
    if saved:
        command = saved[0]['command']
        validate(command)
        if command['arguments']['facts']['settings'] != settings:
            raise ValueError('Registered population settings changed')
        receipt = client.deliver(registration_dir, command, base_url=reader.base_url,
            deployment_id=deployment_id, service_key=reader.service_key, post=reader.post)
        return check_receipt(command, receipt)
    target.parent.mkdir(mode=0o700, exist_ok=True)
    recovery._checkpoint_path(target.parent)
    snapshot = snapshots.retain(reader.files.path / 'package', target)
    # Host paths are derived from identity, never accepted from browser input.
    facts = {'inputs': inputs, 'inputs_sha256': digest(inputs), 'result_sha256': digest(result), 'inventory': result['inventory'],
             'snapshot': {key: snapshot[key] for key in ('manifest_sha256', 'manifest_size_bytes')},
             'population_digest': result['package']['common_population']['population_basis_digest'],
             'settings': settings, 'publication_sha256': digest(result['publication'])}
    command = {'request_id': request_id, 'destination': client.destination(reader.base_url, deployment_id),
               'operation': OPS[0], 'arguments': {'workspace_id': reader.context.workspace_id,
               'run_id': reader.context.run_id, 'stage_id': reader.context.stage_id,
               'deployment_id': deployment_id, 'facts': facts}}
    recovery.check_package(reader, inputs, result)
    return client.deliver(registration_dir, command, base_url=reader.base_url,
        deployment_id=deployment_id, service_key=reader.service_key, post=reader.post)


def restore(reader, *, settings, deployment_id):
    """Copy a registered completed package during this new run's ordinary first Setup."""
    data = origin(reader)
    registration = data['registration']
    require_local('legacy_stage_snapshot')
    if registration['deployment_id'] != deployment_id or registration['facts']['settings'] != settings:
        raise ValueError('Replacement installation or effective settings differ')
    root = reader.files.root
    source = root / registration['run_id'] / 'population-checkpoints' / registration['request_id']
    if source.resolve(strict=True) != source:
        raise ValueError('Replacement snapshot cannot use aliases')
    snapshot = {'manifest_path': str(source / 'manifest.json'), 'package_directory': str(source / 'files'),
                **registration['facts']['snapshot']}
    directory = recovery.checkpoint_directory(reader, reader.files.path)
    inputs = {'schema': SCHEMA, 'registration': registration['request_id'],
              'checkpoint_sha256': registration['checkpoint_sha256'], 'workspace_id': reader.context.workspace_id,
              'run_id': reader.context.run_id, 'stage_id': reader.context.stage_id, 'settings': settings}
    def copy():
        reader.require_open()
        target = reader.files.path / 'package'
        if target.exists() or target.is_symlink():
            raise ValueError('Replacement package destination already exists')
        # Replacement fault anchor: this callback copies only, never calls a generator.
        copied = snapshots.consume(snapshot, reader.files.path / 'package-copy')
        os.rename(copied['package_directory'], target)
        descriptor = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        return checked(target)
    def checked(target):
        if package.package_inventory(target) != registration['facts']['inventory']:
            raise ValueError('Replacement package bytes differ')
        package.read_package_population(target)
        metadata = json.loads((target / 'manifest.json').read_bytes())
        if metadata['common_population']['population_basis_digest'] != data['lineage']['population_digest']:
            raise ValueError('Replacement realized population differs')
        if origin(reader) != data:
            raise ValueError('Replacement access changed during copy')
        return {'package': metadata, 'inventory': registration['facts']['inventory'],
                'publication': package.publication_payloads(target, run_id=reader.context.run_id,
                    stage_id=reader.context.stage_id, lineage=data['lineage'])}
    import model_stage_computation as computation
    result = computation.compute_once(directory, base_url=reader.base_url, deployment_id=deployment_id,
        run_id=reader.context.run_id, stage_id=reader.context.stage_id, name=recovery.NAME,
        inputs=inputs, compute=copy)
    if checked(reader.files.path / 'package') != result:
        raise ValueError('Replacement result changed after checkpoint')
    return {**result['package'], 'package_dir': str(reader.files.path / 'package')}


def check_effective_settings(reader, *, settings, deployment_id):
    """A successor on another worker must preserve the registered scientific defaults."""
    data = origin(reader)
    require_local('legacy_stage_snapshot')
    if data['registration']['deployment_id'] != deployment_id or data['registration']['facts']['settings'] != settings:
        raise ValueError('Replacement successor installation or effective settings differ')
    reader.files.verify()
    return data


def check_restored(reader, inputs, result):
    reader.require_open()
    data = origin(reader)
    if (set(inputs) != {'schema', 'registration', 'checkpoint_sha256', 'workspace_id', 'run_id', 'stage_id', 'settings'}
            or inputs['workspace_id'] != reader.context.workspace_id or inputs['settings'] != data['registration']['facts']['settings']
            or set(result) != {'package', 'inventory', 'publication'}
            or inputs.get('registration') != data['registration']['request_id']
            or inputs.get('run_id') != reader.context.run_id or inputs.get('stage_id') != reader.context.stage_id
            or inputs.get('checkpoint_sha256') != data['registration']['checkpoint_sha256']
            or package.package_inventory(reader.files.path / 'package') != result['inventory']
            or result['inventory'] != data['registration']['facts']['inventory']):
        raise ValueError('Replacement checkpoint or inventory differs')
    target = reader.files.path / 'package'
    package.read_package_population(target)
    metadata = json.loads((target / 'manifest.json').read_bytes())
    if (result['package'] != metadata or result['publication'] != package.publication_payloads(target,
            run_id=reader.context.run_id, stage_id=reader.context.stage_id, lineage=data['lineage'])):
        raise ValueError('Replacement publication plan differs')
    reader.files.verify()
    return {**metadata, 'package_dir': str(target)}
