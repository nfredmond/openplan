"""Reconcile one completed Setup package and its seven receipts, never a stage.

No command-line entry point or execution admission lives here. Callers select
the original installation and custody; failure preserves all retained records.
"""
from contextlib import closing
from dataclasses import asdict
import csv
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
from uuid import UUID, uuid5

import model_command_client as client
import model_command_journal as journal
import model_command_recovery as commands
import model_common_population_handoff as handoff
import model_common_population_package as package
import model_legacy_artifact_command as legacy
import model_stage_computation as computation

NAME = 'common-population-package'


def _authority_stamp(authority):
    return {'sha256': hashlib.sha256(journal.canonical(authority).encode()).hexdigest(),
            'request': authority['request']}


def checkpoint_directory(reader, work_dir):
    if getattr(reader, 'population_custody', 'managed_attempt') == 'managed_attempt':
        return Path(reader.directory)
    return Path(work_dir) / 'common-population-commands'


def _checkpoint_path(directory):
    """Refuse aliases before optional inspection or first journal creation."""
    directory = Path(directory).absolute()
    if os.path.normpath(str(directory)) != str(directory):
        raise ValueError('Population checkpoint directory cannot use aliases or non-directories')
    current = Path(directory.anchor)
    for part in directory.parts[1:]:
        current = current / part
        try:
            info = current.lstat()
        except FileNotFoundError:
            break
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError('Population checkpoint directory cannot use aliases or non-directories')
    path = directory / 'model-commands.sqlite3'
    try:
        info = path.lstat()
    except FileNotFoundError:
        return path
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError('Population checkpoint journal must be a private unaliased regular file')
    return path


def read_checkpoint(reader, directory, *, base_url, deployment_id, optional=False):
    """Read the existing computation result without creating or repairing it."""
    # Recovery path fault anchor: absence never bypasses path validation.
    path = _checkpoint_path(directory)
    bound = client.destination(base_url, deployment_id)
    row = None
    if path.exists():
        with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
            if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stage_computations'").fetchone():
                row = connection.execute('SELECT inputs_json,result_json,result_sha256 FROM stage_computations WHERE destination=? AND run_id=? AND stage_id=? AND name=?',
                    (bound, reader.context.run_id, reader.context.stage_id, NAME)).fetchone()
    if row is None:
        if optional:
            return None
        raise computation.ComputationUnconfirmed('Completed population package checkpoint required')
    if row[1] is None:
        raise computation.ComputationUnconfirmed('Population package started without a completed checkpoint')
    inputs, result = json.loads(row[0]), json.loads(row[1])
    if (not isinstance(inputs, dict) or not isinstance(result, dict)
            or journal.canonical(inputs) != row[0] or journal.canonical(result) != row[1]
            or hashlib.sha256(row[1].encode()).hexdigest() != row[2]):
        raise computation.ComputationUnconfirmed('Population package checkpoint digest differs')
    return inputs, result


def setup_inputs(reader, prepared, *, bbox, corridor_geojson, zone_geography, zone_attributes):
    common = package.population_library()
    reader.require_open()
    authority = handoff._resolve(reader, common)
    if not handoff._same(authority['request'], prepared['request']):
        raise ValueError('Population preparation request differs from current authority')
    run = authority['consumer']['run']
    if (zone_geography != run['input_snapshot_json']['zoneGeography']
            or (run['corridor_geojson'] is not None and not handoff._same(corridor_geojson, run['corridor_geojson']))):
        raise ValueError('Population setup geography differs from actual request')
    value = {'workspace_id': reader.context.workspace_id, 'run_id': reader.context.run_id,
             'stage_id': reader.context.stage_id, 'attempt_id': reader.context.attempt_id,
             'claim_request_id': getattr(reader.context, 'claim_request_id', None),
             'authority': _authority_stamp(authority), 'source_record': prepared['source_record'],
             'bbox': list(bbox), 'corridor_geojson': corridor_geojson,
             'zone_geography': zone_geography, 'zone_attributes': zone_attributes}
    common._reject_credentials(value)
    return json.loads(journal.canonical(value))


def check_package(reader, inputs, result):
    """Recheck original authority, fixed bytes and the exact publication plan."""
    if inputs.get('schema') == 'openplan.population-replacement.v1':
        import model_population_replacement as replacement
        return replacement.check_restored(reader, inputs, result)
    common = package.population_library()
    reader.require_open()
    reader.files.verify()
    expected_scope = {'workspace_id': reader.context.workspace_id, 'run_id': reader.context.run_id,
                      'stage_id': reader.context.stage_id, 'attempt_id': reader.context.attempt_id,
                      'claim_request_id': getattr(reader.context, 'claim_request_id', None)}
    if any(inputs.get(key) != value for key, value in expected_scope.items()):
        raise ValueError('Population checkpoint ownership differs')
    if not handoff._same(_authority_stamp(handoff._resolve(reader, common)), inputs['authority']):
        raise ValueError('Population checkpoint authority changed')
    directory = reader.files.path / 'package'
    if set(result) != {'package', 'inventory', 'publication'}:
        raise ValueError('Population checkpoint result fields differ')
    # Recovery fault anchor: a saved result never bypasses current byte checks.
    if package.package_inventory(directory) != result['inventory']:
        raise ValueError('Population package bytes differ from completed checkpoint')
    metadata = common._json((directory / 'manifest.json').read_bytes())
    if (metadata != result['package'] or metadata.get('version') != 'dynamic-v1'
            or metadata.get('files') != {'zone_attributes': 'zone_attributes.csv', 'od_trip_matrix': 'od_trip_matrix.csv'}
            or metadata.get('bbox') != inputs['bbox'] or metadata.get('zone_geography') != inputs['zone_geography']):
        raise ValueError('Population package metadata differs from completed checkpoint')
    record = metadata['common_population']
    with (directory / 'common_population' / common.ROLES['source_zone_attributes']).open(newline='') as stream:
        rows = list(csv.DictReader(stream))
    loaded = common.read_common_population(directory / 'common_population', expected_manifest=record['manifest'], zone_rows=rows)
    expected_source = {key: value for key, value in loaded['source_manifest'].items()
                       if key not in ('selection_coverage', 'study_area')}
    original_source = {key: value for key, value in inputs['source_record'].items()
                       if key not in ('selection_coverage', 'study_area')}
    if not handoff._same(expected_source, original_source):
        raise ValueError('Population checkpoint source record differs')
    if inputs['authority']['request']['mode'] == 'generate':
        if loaded['source_manifest'].get('study_area') != {'bbox': inputs['bbox'], 'corridor_geojson': inputs['corridor_geojson']}:
            raise ValueError('Population checkpoint resolved study differs')
    custody = handoff.confirm_population_publication(reader, loaded)
    origin = inputs['authority']['request'].get('source')
    if record.get('custody') != custody or record.get('origin') != origin:
        raise ValueError('Population checkpoint custody or origin differs')
    import model_population_replacement as replacement
    plan = package.publication_payloads(directory, run_id=reader.context.run_id, stage_id=reader.context.stage_id,
        lineage=replacement.publication_lineage(reader))
    if not handoff._same(plan, result['publication']):
        raise ValueError('Population checkpoint publication plan differs')
    if package.package_inventory(directory) != result['inventory']:
        raise ValueError('Population package changed during verification')
    reader.files.verify()
    return {**metadata, 'package_dir': str(directory)}


def retain_package(reader, directory, inputs, generate, *, base_url, deployment_id):
    """Generate once or verify a completed result inside existing execution authority."""
    target = reader.files.path / 'package'
    saved = read_checkpoint(reader, directory, base_url=base_url, deployment_id=deployment_id, optional=True)
    if saved is None and (target.exists() or target.is_symlink()):
        raise computation.ComputationUnconfirmed('Uncheckpointed population package cannot be adopted')
    def compute():
        reader.require_open()
        if target.exists() or target.is_symlink():
            raise computation.ComputationUnconfirmed('Population package destination is not fresh')
        _checkpoint_path(directory)
        generated = generate()
        manifest = package.population_library()._json((target / 'manifest.json').read_bytes())
        if generated != manifest:
            raise ValueError('Generated population package differs from written manifest')
        import model_population_replacement as replacement
        result = {'package': manifest, 'inventory': package.package_inventory(target, durable=True),
                  'publication': package.publication_payloads(target, run_id=reader.context.run_id, stage_id=reader.context.stage_id,
                      lineage=replacement.publication_lineage(reader))}
        check_package(reader, inputs, result)
        _checkpoint_path(directory)
        return result
    # Recovery fault anchor: compute_once must retain its no-second-fit boundary.
    directory = _checkpoint_path(directory).parent
    result = computation.compute_once(directory, base_url=base_url, deployment_id=deployment_id,
        run_id=reader.context.run_id, stage_id=reader.context.stage_id, name=NAME, inputs=inputs, compute=compute)
    return check_package(reader, inputs, result)


def artifact_command(reader, name, payload, *, base_url, deployment_id):
    """Use the normal delivery identities, independent of mutable payload bytes."""
    bound = client.destination(base_url, deployment_id)
    ctx = reader.context
    if getattr(reader, 'population_custody', 'managed_attempt') == 'legacy_stage_snapshot':
        identity = str(uuid5(legacy.ARTIFACT_NAMESPACE, journal.canonical({
            'destination': bound, 'run_id': ctx.run_id, 'stage_id': ctx.stage_id, 'name': name})))
        command = {'request_id': str(uuid5(legacy.NAMESPACE, journal.canonical({'destination': bound, 'artifact_id': identity}))),
                   'destination': bound, 'operation': 'record_legacy_model_artifact',
                   'arguments': {'workspace_id': ctx.workspace_id, 'run_id': ctx.run_id, 'stage_id': ctx.stage_id,
                                 'payload': {'id': identity, **payload}}}
    else:
        identity = journal.canonical({'destination': bound, 'operation': 'write_model_attempt_artifact', 'name': name})
        command = {'request_id': str(uuid5(UUID(ctx.attempt_id), identity)), 'destination': bound,
                   'operation': 'write_model_attempt_artifact', 'arguments': {
                       'run_id': ctx.run_id, 'stage_id': ctx.stage_id, 'attempt_id': ctx.attempt_id,
                       'payload': {key: value for key, value in payload.items() if key not in ('run_id', 'stage_id')}}}
    client.validate_command(command)
    return command


def publication_state(reader, directory, result, *, base_url, deployment_id):
    """Reject changed or unrelated commands before any publication transport."""
    expected = {name: artifact_command(reader, name, payload, base_url=base_url, deployment_id=deployment_id)
                for name, payload in result['publication'].items()}
    saved = commands._checked_records(Path(directory), base_url, deployment_id, include_resolved=True)
    by_id = {row['command']['request_id']: row for row in saved}
    allowed = {command['request_id'] for command in expected.values()}
    if any(not row['resolved'] and row['command']['request_id'] not in allowed for row in saved):
        raise ValueError('Unrelated pending command requires reconciliation')
    for command in expected.values():
        row = by_id.get(command['request_id'])
        if row is not None:
            if not handoff._same(row['command'], command):
                raise ValueError('Saved population artifact command differs')
            if row['resolved']:
                client.checked_receipt(command, row['response'])
    return expected, by_id


def _check_remote(reader, command, receipt):
    client.checked_receipt(command, receipt)
    row = handoff._row(reader, 'model_run_artifacts', handoff.ARTIFACT_PROJECTION,
        id=receipt['id'], run_id=reader.context.run_id, stage_id=reader.context.stage_id)
    if (any(not handoff._same(row[key], receipt[key]) for key in handoff.ARTIFACT_PROJECTION.split(',') if key != 'file_size_bytes')
            or handoff._size(row['file_size_bytes'], database=True, empty=True) != handoff._size(receipt['file_size_bytes'], database=True, empty=True)):
        raise ValueError('Population artifact row differs from retained receipt')


def verify_acknowledged(reader, expected, saved):
    """Check acknowledged outputs before any new delivery after a restore."""
    for command in expected.values():
        row = saved.get(command['request_id'])
        if row is not None and row['resolved']:
            _check_remote(reader, command, row['response'])


def reconcile_publication(reader, directory, *, base_url, deployment_id, service_key, post=None):
    """Explicit receipt reconciliation only; no stage callback, status or state write."""
    if Path(directory).absolute() != checkpoint_directory(reader, reader.files.path).absolute():
        raise ValueError('Population reconciliation journal differs from original custody')
    inputs, result = read_checkpoint(reader, directory, base_url=base_url, deployment_id=deployment_id)
    check_package(reader, inputs, result)
    expected, saved = publication_state(reader, directory, result, base_url=base_url, deployment_id=deployment_id)
    if os.environ.get('OPENPLAN_HOSTED_ARTIFACT_MIRROR') == '1' and any(
            command['request_id'] not in saved or not saved[command['request_id']]['resolved'] for command in expected.values()):
        raise ValueError('Hosted population mirror requires its existing recovery before registration')
    verify_acknowledged(reader, expected, saved)
    receipts = []
    for command in expected.values():
        check_package(reader, inputs, result)
        row = saved.get(command['request_id'])
        if row is not None and not row['resolved']:
            receipt = commands.recover_request(Path(directory), command['request_id'], base_url=base_url,
                deployment_id=deployment_id, service_key=service_key, post=post)
        else:
            receipt = client.deliver(directory, command, base_url=base_url, deployment_id=deployment_id,
                                     service_key=service_key, post=post)
        _check_remote(reader, command, receipt)
        receipts.append(receipt['id'])
    check_package(reader, inputs, result)
    return {'outcome': 'common_population_publication_reconciled', 'artifact_ids': receipts,
            'model_resumed': False, 'stage_status_changed': False, 'execution_admission_created': False}


class _RecoveryReader:
    """Read the original managed authority without reopening its stopped writer."""
    def __init__(self, context, files, claim, receipt, *, base_url, deployment_id, service_key, get, post):
        self.context, self.files, self.claim, self.receipt = context, files, claim, receipt
        self.base_url, self.deployment_id, self.service_key = base_url, deployment_id, service_key
        self.get, self.post, self.stopped = get, post, False

    def require_open(self):
        if self.stopped:
            raise ValueError('Population recovery reader stopped')
        self.files.verify()
        state = client.inspect_ownership(self.claim, self.receipt, workspace_id=self.context.workspace_id,
            base_url=self.base_url, deployment_id=self.deployment_id, service_key=self.service_key, get=self.get)
        if not state['owns_stage']:
            raise client.OwnershipUnconfirmed('Original population attempt no longer owns publication')

    def read_run(self, run_id, *, expected_stage_name):
        self.require_open()
        if run_id != self.context.run_id or expected_stage_name != 'AequilibraE Setup':
            raise ValueError('Population recovery reader scope differs')
        return handoff._row(self, 'model_runs', handoff.RUN_PROJECTION, id=run_id, workspace_id=self.context.workspace_id)


class _RecoveredFiles:
    def __init__(self, root, context):
        self.root = Path(root).absolute() / 'runs'
        self.path = self.root / context.run_id / 'attempts' / hashlib.sha256(context.destination.encode()).hexdigest() / context.stage_id / context.attempt_id
        self.owner = {'schema': 'openplan.attempt-workspace.v1', **asdict(context)}
        self.identity = (self.path.stat().st_dev, self.path.stat().st_ino)
        self.root_identity = (self.root.stat().st_dev, self.root.stat().st_ino)
        self.verify()

    def verify(self):
        from model_engine_recovery import read_record
        if self.path.resolve(strict=True) != self.path or self.root.resolve(strict=True) != self.root:
            raise ValueError('Population recovery directory cannot use aliases')
        descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(descriptor)
            if (info.st_dev, info.st_ino) != self.root_identity:
                raise ValueError('Population recovery root changed')
            for part in self.path.relative_to(self.root).parts:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            info = os.fstat(descriptor)
            if (info.st_dev, info.st_ino) != self.identity or read_record(descriptor, 'attempt_owner.json')[0] != self.owner:
                raise ValueError('Population recovery attempt owner differs')
        finally:
            os.close(descriptor)


def recovery_reader(root, directory, *, workspace_id, run_id, stage_id, base_url, deployment_id,
                    service_key, custody, claim_request_id=None, get=None, post=None):
    """Select explicit existing custody; never infer legacy from managed failure."""
    directory = _checkpoint_path(directory).parent
    if custody == 'legacy_stage_snapshot':
        if claim_request_id is not None:
            raise ValueError('Legacy population recovery cannot carry a managed claim')
        work = Path(root).absolute() / 'runs' / run_id
        if Path(directory).absolute() != work / 'common-population-commands':
            raise ValueError('Legacy population journal differs from its full-run directory')
        return handoff.StagePopulationReader(base_url=base_url, service_key=service_key,
            workspace_id=workspace_id, run_id=run_id, stage_id=stage_id, shared_root=root, work_dir=work, get=get, post=post)
    if custody != 'managed_attempt' or claim_request_id is None:
        raise ValueError('Explicit population recovery custody required')
    from model_attempt_invocation import AttemptContext
    saved = commands._checked_records(Path(directory), base_url, deployment_id, claim_request_id, include_resolved=True)
    if len(saved) != 1 or not saved[0]['resolved']:
        raise ValueError('Original population claim receipt required')
    claim = saved[0]['command']
    receipt = client.checked_receipt(claim, saved[0]['response'])
    if (claim['operation'] != 'claim_model_stage_attempt' or receipt['outcome'] != 'claimed'
            or claim['arguments']['run_id'] != run_id or claim['arguments']['stage_id'] != stage_id):
        raise ValueError('Original population claim scope differs')
    with closing(sqlite3.connect((Path(directory) / 'model-commands.sqlite3').resolve().as_uri() + '?mode=ro', uri=True)) as connection:
        admitted = connection.execute('SELECT workspace_id,entered FROM execution_admissions WHERE request_id=?', (claim_request_id,)).fetchone()
    if admitted != (workspace_id, 1):
        raise ValueError('Consumed original population admission required')
    context = AttemptContext(claim['destination'], workspace_id, run_id, stage_id, receipt['attempt_id'], claim_request_id)
    reader = _RecoveryReader(context, _RecoveredFiles(root, context), claim, receipt,
        base_url=base_url, deployment_id=deployment_id, service_key=service_key, get=get, post=post)
    reader.directory = Path(directory)
    return reader
