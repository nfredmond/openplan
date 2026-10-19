"""Resolve one explicit retained population through the owning worker parent.

The existing writer keeps its same-run scope. This reader checks a separate
source reference, pins its local bytes, then rechecks both row snapshots. Those
reads are not a database lease or scientific acceptance. Publication remains
with the caller's existing attempt writer.
"""
from contextlib import closing
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
from types import SimpleNamespace
import uuid

from model_handoff_files import copy_registered

REQUEST_SCHEMA = 'openplan.common-population-request.v1'
SOURCE_SCHEMA = 'openplan.common-population-source.v1'
POLICY = 'fixed_population_auto_trip_change'
GUIDED_SCHEMA = 'openplan.project_comparison.v1'
MAX_SAFE_INTEGER = 2**53 - 1
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
RUN_PROJECTION = 'id,workspace_id,model_id,project_id,scenario_set_id,scenario_entry_id,engine_key,status,attempt_managed,corridor_geojson,query_text,input_snapshot_json,assumption_snapshot_json'
MODEL_PROJECTION = 'id,workspace_id,project_id,scenario_set_id,config_json'
PROJECT_PROJECTION = 'id,workspace_id'
SET_PROJECTION = 'id,workspace_id,project_id,baseline_entry_id'
ENTRY_PROJECTION = 'id,scenario_set_id,entry_type,assumptions_json'
STAGE_PROJECTION = 'id,run_id,stage_name,status,attempt_managed,active_attempt_id'
ARTIFACT_PROJECTION = 'id,run_id,stage_id,attempt_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json'


class PopulationHandoffError(ValueError):
    """The parent cannot confirm the selected source and consumer relationship."""


def _uuid(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise PopulationHandoffError('Canonical population reference identity required')
    return value


def _stable(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _same(first, second):
    return _stable(first) == _stable(second)


def _size(value, *, database=False, empty=False):
    if database and isinstance(value, str) and re.fullmatch(r'0|[1-9][0-9]*', value):
        value = int(value)
    if type(value) is not int or not (0 if empty else 1) <= value <= MAX_SAFE_INTEGER:
        raise PopulationHandoffError('Exact safe population byte length required')
    return value


def _hash(value):
    if not isinstance(value, str) or re.fullmatch(r'[0-9a-f]{64}', value) is None:
        raise PopulationHandoffError('Exact population SHA-256 required')
    return value


class StagePopulationReader:
    """Read ordinary stage custody without binding or impersonating an attempt writer."""
    population_custody = 'legacy_stage_snapshot'

    def __init__(self, *, base_url, service_key, workspace_id, run_id, stage_id,
                 shared_root, work_dir, get=None, post=None):
        for value in (workspace_id, run_id, stage_id):
            _uuid(value)
        self.base_url, self.service_key = base_url, service_key
        self.get, self.post, self.stopped = get, post, False
        self.context = SimpleNamespace(workspace_id=workspace_id, run_id=run_id,
                                       stage_id=stage_id, attempt_id=None)
        self.files = _StageFiles(shared_root, work_dir, run_id)

    def require_open(self):
        if self.stopped:
            raise PopulationHandoffError('Stage population reader stopped; reconcile original records')
        self.files.verify()

    def read_run(self, run_id, *, expected_stage_name):
        self.require_open()
        if run_id != self.context.run_id:
            raise PopulationHandoffError('Stage population consumer run differs')
        stage = _row(self, 'model_run_stages', STAGE_PROJECTION,
                     id=self.context.stage_id, run_id=run_id)
        if stage['stage_name'] != expected_stage_name:
            raise PopulationHandoffError('Stage population consumer stage differs')
        return _row(self, 'model_runs', RUN_PROJECTION, id=run_id,
                    workspace_id=self.context.workspace_id)


class _StageFiles:
    """Pin the current full-run directory across a fresh checked copy."""
    def __init__(self, shared_root, path, run_id):
        self.root = Path(shared_root).absolute() / 'runs'
        self.path = Path(path).absolute()
        if self.path != self.root / run_id or self.root.resolve(strict=True) != self.root:
            raise PopulationHandoffError('Stage population requires its actual full-run directory')
        if self.path.resolve(strict=True) != self.path or not self.path.is_dir():
            raise PopulationHandoffError('Stage population directory cannot use aliases')
        self.identity = (self.path.stat().st_dev, self.path.stat().st_ino)
        self.root_identity = (self.root.stat().st_dev, self.root.stat().st_ino)

    def verify(self):
        if (self.path.resolve(strict=True) != self.path or self.root.resolve(strict=True) != self.root
                or (self.path.stat().st_dev, self.path.stat().st_ino) != self.identity
                or (self.root.stat().st_dev, self.root.stat().st_ino) != self.root_identity):
            raise PopulationHandoffError('Stage population directory changed during use')


def read_stage_custody(reader, run_id, stage_id, artifact_id=None):
    """Read only scoped fresh-execution eligibility, never a lease or scientific verdict."""
    for value in (run_id, stage_id):
        _uuid(value)
    if artifact_id is not None:
        _uuid(artifact_id)
    post = reader.post
    if post is None:
        import requests
        post = requests.post
    expected = {'schema': 'openplan.common-population-stage-custody.v1',
                'custody': 'legacy_stage_snapshot', 'workspace_id': reader.context.workspace_id,
                'run_id': run_id, 'stage_id': stage_id, 'artifact_id': artifact_id, 'eligible': True}
    with closing(post(reader.base_url.rstrip('/') + '/rest/v1/rpc/read_common_population_stage_custody',
            headers={'apikey': reader.service_key, 'Authorization': 'Bearer ' + reader.service_key},
            json={'p_workspace': reader.context.workspace_id, 'p_run': run_id,
                  'p_stage': stage_id, 'p_artifact': artifact_id},
            timeout=(5, 30), allow_redirects=False)) as response:
        actual = response.json() if response.status_code == 200 else None
        if not isinstance(actual, dict) or not _same(actual, expected):
            raise PopulationHandoffError('Fresh receipt-backed population stage custody is unconfirmed')
        return expected


def _request(snapshot, common):
    request = snapshot.get('commonPopulation') if isinstance(snapshot, dict) else None
    if not isinstance(request, dict):
        raise PopulationHandoffError('Explicit common-population request required')
    mode = request.get('mode')
    if mode == 'restore_checkpoint':
        if (set(request) != {'schema', 'mode', 'custody', 'comparisonPolicy', 'sourceProfile', 'checkpoint', 'source'}
                or request.get('schema') != REQUEST_SCHEMA or request.get('comparisonPolicy') != POLICY
                or request.get('custody') != 'legacy_stage_snapshot' or not isinstance(request.get('checkpoint'), dict)
                or set(request['checkpoint']) != {'id', 'sha256'}):
            raise PopulationHandoffError('Unsupported registered population replacement request')
        _uuid(request['checkpoint']['id'])
        _hash(request['checkpoint']['sha256'])
        common.validate_source_profile(request['sourceProfile'])
        source = request['source']
        if source is not None:
            if not isinstance(source, dict) or set(source) != {'modelRunId', 'artifactId', 'stageId', 'attemptId', 'sha256', 'sizeBytes'} or source['attemptId'] is not None:
                raise PopulationHandoffError('Replacement source must retain its exact legacy baseline reference')
            for key in ('modelRunId', 'artifactId', 'stageId'):
                _uuid(source[key])
            _hash(source['sha256'])
            _size(source['sizeBytes'])
        return json.loads(_stable(request))
    fields = {'schema', 'mode', 'custody', 'comparisonPolicy', 'sourceProfile' if mode == 'generate' else 'source'}
    if (set(request) != fields or request.get('schema') != REQUEST_SCHEMA
            or request.get('comparisonPolicy') != POLICY or mode not in ('generate', 'reuse')
            or request.get('custody') not in ('managed_attempt', 'legacy_stage_snapshot')):
        raise PopulationHandoffError('Unsupported common-population request')
    request = json.loads(_stable(request))
    if mode == 'generate':
        request['sourceProfile'] = common.validate_source_profile(request['sourceProfile'])
    else:
        source = request['source']
        if not isinstance(source, dict) or set(source) != {'modelRunId', 'artifactId', 'stageId', 'attemptId', 'sha256', 'sizeBytes'}:
            raise PopulationHandoffError('Exact population source reference required')
        for key in ('modelRunId', 'artifactId', 'stageId'):
            _uuid(source[key])
        if request['custody'] == 'managed_attempt':
            _uuid(source['attemptId'])
        elif source['attemptId'] is not None:
            raise PopulationHandoffError('Stage snapshot cannot name a managed attempt')
        _hash(source['sha256'])
        _size(source['sizeBytes'])
    return request


def _row(writer, table, projection, **scope):
    get = writer.get
    if get is None:
        import requests
        get = requests.get
    with closing(get(writer.base_url.rstrip('/') + '/rest/v1/' + table,
            headers={'apikey': writer.service_key, 'Authorization': 'Bearer ' + writer.service_key},
            params={**{key: 'eq.' + value for key, value in scope.items()}, 'select': projection},
            timeout=(5, 30), allow_redirects=False)) as response:
        rows = response.json() if response.status_code == 200 else None
        if (not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict)
                or not set(projection.split(',')).issubset(rows[0])):
            raise PopulationHandoffError('Population authority read is incomplete or not unique')
        row = rows[0]
        if any(row.get(key) != value for key, value in scope.items()):
            raise PopulationHandoffError('Population authority row differs from requested scope')
        return json.loads(_stable(row))


def _study(run):
    geometry = run['corridor_geojson']
    if geometry is not None:
        if (not isinstance(geometry, dict) or geometry.get('type') not in ('Polygon', 'MultiPolygon')
                or not isinstance(geometry.get('coordinates'), list) or not geometry['coordinates']):
            raise PopulationHandoffError('Actual population study geometry is incomplete')
        return {'corridor_geojson': geometry}
    query = run['query_text']
    if not isinstance(query, str) or not query.strip():
        raise PopulationHandoffError('Population study has neither geometry nor an explicit query')
    return {'corridor_geojson': None, 'query_sha256': hashlib.sha256(query.encode('utf-8')).hexdigest()}


def _relations(writer, run):
    for key in ('id', 'workspace_id', 'model_id', 'project_id', 'scenario_set_id', 'scenario_entry_id'):
        _uuid(run[key])
    if run['workspace_id'] != writer.context.workspace_id:
        raise PopulationHandoffError('Population source crosses workspaces')
    model = _row(writer, 'models', MODEL_PROJECTION, id=run['model_id'], workspace_id=run['workspace_id'])
    project = _row(writer, 'projects', PROJECT_PROJECTION, id=run['project_id'], workspace_id=run['workspace_id'])
    scenario_set = _row(writer, 'scenario_sets', SET_PROJECTION, id=run['scenario_set_id'], workspace_id=run['workspace_id'])
    entry = _row(writer, 'scenario_entries', ENTRY_PROJECTION, id=run['scenario_entry_id'], scenario_set_id=run['scenario_set_id'])
    if (model['project_id'] != project['id'] or scenario_set['project_id'] != project['id']
            or model['scenario_set_id'] != scenario_set['id']):
        raise PopulationHandoffError('Population run, model, project and scenario set disagree')
    method = {'aequilibrae': 'aequilibrae', 'behavioral_demand': 'activitysim'}.get(run['engine_key'])
    config = model['config_json']
    if (method is None or not isinstance(config, dict)
            or config.get('guidedProjectComparison') != GUIDED_SCHEMA or config.get('method') != method):
        raise PopulationHandoffError('Population request requires the declared guided method')
    baseline = run['scenario_entry_id'] == scenario_set['baseline_entry_id']
    if (baseline and entry['entry_type'] != 'baseline') or (not baseline and entry['entry_type'] != 'alternative'):
        raise PopulationHandoffError('Population scenario role differs from designated baseline')
    if not _same(run['assumption_snapshot_json'] or {}, entry['assumptions_json'] or {}):
        raise PopulationHandoffError('Population scenario assumptions changed after launch')
    if not baseline:
        change = (run['assumption_snapshot_json'] or {}).get('guidedProjectChange')
        value = change.get('autoTripChangePct') if isinstance(change, dict) else None
        if (not isinstance(change, dict) or change.get('kind') != 'assigned_auto_trip_change_pct'
                or type(value) not in (int, float) or not -90 <= value <= 200 or value == 0
                or not isinstance(change.get('basis'), str) or len(change['basis'].strip()) < 3):
            raise PopulationHandoffError('Fixed population requires the explicit guided auto-trip change')
    snapshot = run['input_snapshot_json']
    if not isinstance(snapshot, dict) or snapshot.get('zoneGeography') not in ('tract', 'block_group'):
        raise PopulationHandoffError('Population run requires an explicit zone geography')
    return {'run': run, 'model': model, 'project': project, 'scenario_set': scenario_set,
            'entry': entry, 'baseline': baseline, 'study': _study(run)}


def _producer(writer, run_id, stage_id, attempt_id, *, status, custody='managed_attempt'):
    stage = _row(writer, 'model_run_stages', STAGE_PROJECTION, id=_uuid(stage_id), run_id=run_id)
    if stage['stage_name'] != 'AequilibraE Setup' or stage['status'] != status:
        raise PopulationHandoffError('Population setup producer is inactive or incomplete')
    if custody == 'managed_attempt':
        _uuid(attempt_id)
        if stage['attempt_managed'] is not True or stage['active_attempt_id'] != attempt_id:
            raise PopulationHandoffError('Population setup producer is inactive or incomplete')
    elif (custody != 'legacy_stage_snapshot' or stage['attempt_managed'] is not False
            or stage['active_attempt_id'] is not None or attempt_id is not None):
        raise PopulationHandoffError('Population stage snapshot ownership is inconsistent')
    return {'stage': stage}


def _completed_output(writer, run, artifact, *, custody='managed_attempt'):
    """Use the existing service-only classifier to inspect protected attempts."""
    post = writer.post
    if post is None:
        import requests
        post = requests.post
    with closing(post(writer.base_url.rstrip('/') + '/rest/v1/rpc/read_model_attempt_outputs',
            headers={'apikey': writer.service_key, 'Authorization': 'Bearer ' + writer.service_key},
            json={'p_run_id': run['id'], 'p_workspace_id': writer.context.workspace_id},
            timeout=(5, 30), allow_redirects=False)) as response:
        result = response.json() if response.status_code == 200 else None
        if (not isinstance(result, dict) or result.get('run_id') != run['id']
                or result.get('run_status') != 'succeeded' or not isinstance(result.get('outputs'), list)):
            raise PopulationHandoffError('Population attempt classification is incomplete')
        selected = [item for item in result['outputs'] if isinstance(item, dict)
                    and item.get('kind') == 'artifact' and isinstance(item.get('record'), dict)
                    and item['record'].get('id') == artifact['id']]
        expected_ownership = 'current_completed' if custody == 'managed_attempt' else 'legacy_unknown'
        if len(selected) != 1 or selected[0].get('ownership_state') != expected_ownership:
            raise PopulationHandoffError('Population source attempt is revoked, inactive or incomplete')
        record = selected[0]['record']
        if any(key not in record or not _same(record[key], artifact[key])
               for key in ARTIFACT_PROJECTION.split(',') if key != 'file_size_bytes'):
            raise PopulationHandoffError('Population classified output differs from selected artifact')
        if _size(record.get('file_size_bytes'), database=True) != _size(artifact['file_size_bytes'], database=True):
            raise PopulationHandoffError('Population classified output byte length differs')
        return {key: record[key] for key in ARTIFACT_PROJECTION.split(',')}


def _resolve(writer, common):
    owned = writer.read_run(writer.context.run_id, expected_stage_name='AequilibraE Setup')
    run = _row(writer, 'model_runs', RUN_PROJECTION,
               id=writer.context.run_id, workspace_id=writer.context.workspace_id)
    for key in ('id', 'workspace_id', 'scenario_entry_id', 'corridor_geojson', 'query_text', 'engine_key', 'input_snapshot_json'):
        if key not in owned or not _same(owned[key], run[key]):
            raise PopulationHandoffError('Owned population run changed during read')
    request = _request(run['input_snapshot_json'], common)
    custody = request['custody']
    expected_managed = custody == 'managed_attempt'
    if (run['status'] != 'running' or run['attempt_managed'] is not expected_managed
            or expected_managed != (getattr(writer, 'population_custody', 'managed_attempt') == 'managed_attempt')):
        raise PopulationHandoffError('Population consumer ownership differs from its explicit custody')
    consumer = _relations(writer, run)
    consumer.update(_producer(writer, run['id'], writer.context.stage_id, writer.context.attempt_id,
                              status='running', custody=custody))
    if custody == 'legacy_stage_snapshot':
        consumer['stage_custody'] = read_stage_custody(writer, run['id'], writer.context.stage_id)
    if request['mode'] == 'generate':
        if run['engine_key'] != 'aequilibrae' or not consumer['baseline']:
            raise PopulationHandoffError('Population generation belongs to the first AequilibraE baseline job')
        return {'consumer': consumer, 'request': request}
    if request['mode'] == 'restore_checkpoint':
        raise PopulationHandoffError('Registered replacement must use the copy-only Setup entry')
    reference = request['source']
    if reference['modelRunId'] == run['id']:
        raise PopulationHandoffError('Population reuse requires a distinct source run')
    source_run = _row(writer, 'model_runs', RUN_PROJECTION,
                      id=reference['modelRunId'], workspace_id=writer.context.workspace_id)
    source = _relations(writer, source_run)
    if (source_run['project_id'] != run['project_id'] or source_run['scenario_set_id'] != run['scenario_set_id']
            or source_run['engine_key'] != 'aequilibrae' or source_run['status'] != 'succeeded'
            or source_run['attempt_managed'] is not expected_managed or not source['baseline']
            or not _same(source['study'], consumer['study'])
            or source_run['input_snapshot_json']['zoneGeography'] != run['input_snapshot_json']['zoneGeography']):
        raise PopulationHandoffError('Population source must be the completed baseline in this project, study and zone geography')
    source_request = _request(source_run['input_snapshot_json'], common)
    if source_request['mode'] not in ('generate', 'restore_checkpoint') or source_request['custody'] != custody:
        raise PopulationHandoffError('Population source must name its original generation request')
    artifact = _row(writer, 'model_run_artifacts', ARTIFACT_PROJECTION,
                    id=reference['artifactId'], run_id=source_run['id'], artifact_type='common_population')
    if (artifact['stage_id'] != reference['stageId'] or artifact['attempt_id'] != reference['attemptId']
            or _hash(artifact['content_hash']) != reference['sha256']
            or _size(artifact['file_size_bytes'], database=True) != reference['sizeBytes']
            or not isinstance(artifact['metadata_json'], dict)
            or artifact['metadata_json'].get('schema') != common.SCHEMA
            or artifact['metadata_json'].get('custody') != custody):
        raise PopulationHandoffError('Population artifact differs from the exact selected source reference')
    source.update(_producer(writer, source_run['id'], reference['stageId'], reference['attemptId'],
                            status='succeeded', custody=custody))
    source['completed_output'] = _completed_output(writer, source_run, artifact, custody=custody)
    if custody == 'legacy_stage_snapshot':
        source['stage_custody'] = read_stage_custody(writer, source_run['id'], reference['stageId'], artifact['id'])
    companions = {}
    for role in common.ROLES:
        row = _row(writer, 'model_run_artifacts', ARTIFACT_PROJECTION, run_id=source_run['id'],
                   stage_id=reference['stageId'], artifact_type='common_population_' + role)
        if (row['attempt_id'] != reference['attemptId'] or not _same(row['metadata_json'], artifact['metadata_json'])):
            raise PopulationHandoffError('Population companion ownership or metadata differs from manifest')
        checked = {'artifact': row, 'completed_output': _completed_output(writer, source_run, row, custody=custody)}
        if custody == 'legacy_stage_snapshot':
            checked['stage_custody'] = read_stage_custody(writer, source_run['id'], reference['stageId'], row['id'])
        companions[role] = checked
    result = {'consumer': consumer, 'request': request, 'source': source, 'source_request': source_request,
              'artifact': artifact, 'companions': companions}
    if source_request['mode'] == 'restore_checkpoint':
        import model_population_replacement as replacement
        data = replacement.origin(writer, source_run['id'])
        if artifact['metadata_json'].get('replacement') != data['lineage']:
            raise PopulationHandoffError('Completed replacement population lineage differs')
        result['generation_source'] = _relations(writer, data['origin_run'])
        result['replacement'] = data['lineage']
    return result


def _zone_payload(run, profile, payload):
    stamp = run['input_snapshot_json'].get('zoneAttributes')
    if (not isinstance(stamp, dict) or stamp.get('status') != 'supplied'
            or stamp.get('storageRef') != 'storage://run-artifacts/model-runs/' + run['id'] + '/zone-attributes.json'
            or not isinstance(payload, dict) or payload.get('version') != 'zone-attributes-v1'
            or payload.get('run_id') != run['id'] or not isinstance(payload.get('source'), dict)):
        raise PopulationHandoffError('Population source requires its actual run-scoped app zone payload')
    source = payload['source']
    if (source.get('id') != 'us_census_acs5' or stamp.get('sourceId') != source['id']
            or source.get('vintage') != str(profile['income_dollar_year']) or stamp.get('vintage') != source['vintage']
            or source.get('retrieval_url') != profile['acs_summary_endpoint']
            or not isinstance(payload.get('tables'), dict)
            or not isinstance(payload['tables'].get('demographics'), dict)
            or payload['tables']['demographics'].get('status') != 'supplied'):
        raise PopulationHandoffError('Population app source differs from the checked source profile')
    _stable(payload)
    return json.loads(_stable(payload))


def _source_record(authority, profile, zone_attributes):
    run = authority['run']
    record = {'schema': SOURCE_SCHEMA, 'custody': run['input_snapshot_json']['commonPopulation']['custody'],
              **{key: run[key] for key in ('id', 'workspace_id', 'model_id', 'project_id', 'scenario_set_id', 'scenario_entry_id')},
              'corridor_geojson': run['corridor_geojson'],
              'zone_geography': run['input_snapshot_json']['zoneGeography'],
              'source_profile': profile, 'zone_attributes': _zone_payload(run, profile, zone_attributes)}
    record['run_id'] = record.pop('id')
    if 'query_sha256' in authority['study']:
        record['query_sha256'] = authority['study']['query_sha256']
    return record


def _zone_geography(rows, geography, common):
    expected_length = {'tract': 11, 'block_group': 12}[geography]
    selected = common.selected_zone_map(rows)
    if any(len(zone['GEOID']) != expected_length for zone in selected
           if zone['population_role'] == common.UNIVERSE):
        raise PopulationHandoffError('Retained zone geography differs from the actual run request')


def _owned_destination(writer, destination):
    writer.require_open()
    files = writer.files
    if files is None or files.root.name != 'runs':
        raise PopulationHandoffError('Population copy requires the owned runs workspace')
    files.verify()
    destination = Path(destination).absolute()
    owned = files.path.resolve(strict=True)
    if destination.is_symlink() or not destination.parent.resolve(strict=True).is_relative_to(owned):
        raise PopulationHandoffError('Population copy requires a destination in the owned attempt')
    if destination.parent.resolve(strict=True) != destination.parent or destination.name in ('', '.', '..'):
        raise PopulationHandoffError('Population destination cannot use path aliases')
    return files.root.parent, destination


def _copy_selected_population(writer, root, destination, source, manifest, before, common):
    """Keep matching final files and publish only missing registered companions."""
    basis = common._json(common._checked_bytes(source.parent, manifest, common.MANIFEST_NAME))
    descriptors = basis.get('files') if isinstance(basis, dict) else None
    if not isinstance(descriptors, dict) or set(descriptors) != set(common.ROLES):
        raise PopulationHandoffError('Population manifest has unknown or missing companion roles')
    expected = {common.MANIFEST_NAME: manifest}
    for role, name in common.ROLES.items():
        descriptor = descriptors[role]
        if not isinstance(descriptor, dict) or set(descriptor) != {'path', 'sha256', 'bytes'} or descriptor['path'] != name:
            raise PopulationHandoffError('Population companion descriptor cannot select arbitrary paths')
        registered = before['companions'][role]['artifact']
        if (registered['file_url'] != 'local://' + str(source.parent / name)
                or _hash(registered['content_hash']) != _hash(descriptor['sha256'])
                or _size(registered['file_size_bytes'], database=True, empty=True) != _size(descriptor['bytes'], empty=True)):
            raise PopulationHandoffError('Population companion differs from the retained manifest descriptor')
        expected[name] = descriptor
    for name, receipt in expected.items():
        info = (source.parent / name).lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise PopulationHandoffError('Population source must contain private regular files')
    destination.mkdir(mode=0o700, exist_ok=True)
    descriptor = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        pinned = os.fstat(descriptor)
        def verify():
            writer.files.verify()
            current = destination.lstat()
            if (not stat.S_ISDIR(current.st_mode) or destination.resolve(strict=True) != destination
                    or (current.st_dev, current.st_ino) != (pinned.st_dev, pinned.st_ino)):
                raise PopulationHandoffError('Population copy directory changed during reconciliation')
        verify()
        if set(os.listdir(descriptor)) - set(expected):
            raise PopulationHandoffError('Population copy contains unexplained files')
        # Recovery fault anchor: verify every survivor before filling any gap.
        present = set(os.listdir(descriptor))
        for name in present:
            info = (destination / name).lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise PopulationHandoffError('Population copy must contain private regular files')
            common._checked_bytes(destination, expected[name], name)
            common._checked_bytes(source.parent, expected[name], name)
        for name, receipt in expected.items():
            verify()
            if name not in present:
                copy_registered(root, before['request']['source']['modelRunId'], source.parent / name,
                    destination / name, sha256=receipt['sha256'], size_bytes=receipt['bytes'])
        verify()
        for name, receipt in expected.items():
            info = (destination / name).lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise PopulationHandoffError('Population copy must contain private regular files')
            common._checked_bytes(destination, receipt, name)
        return descriptors, (pinned.st_dev, pinned.st_ino)
    finally:
        os.close(descriptor)


def prepare_population_input(writer, *, destination=None, zone_rows=None, zone_attributes=None):
    """Return checked generation inputs or retain one exact baseline realization.

    The caller loads the actual app zone payload for generation through its
    existing run-scoped input reader. Reuse accepts no caller source identity:
    it follows only the immutable reference on the currently owned run.
    The caller must make scripts/modeling importable, as existing worker bundle
    entry points already do. Partial failed destinations remain for recovery.
    """
    try:
        import common_population as common
        writer.require_open()
        before = _resolve(writer, common)
        if before['request']['mode'] == 'generate':
            profile = before['request']['sourceProfile']
            source_record = _source_record(before['consumer'], profile, zone_attributes)
            if zone_rows is not None:
                _zone_geography(zone_rows, source_record['zone_geography'], common)
            # The common retainer refuses credentials before writing this record.
            common._reject_credentials(source_record)
            after = _resolve(writer, common)
            if not _same(before, after):
                raise PopulationHandoffError('Population authority changed before generation')
            return {'mode': 'generate', 'custody': before['request']['custody'], 'request': before['request'], 'source_profile': profile,
                    'source_record': source_record}
        root, destination = _owned_destination(writer, destination)
        artifact, reference = before['artifact'], before['request']['source']
        source_url = artifact['file_url']
        if not isinstance(source_url, str) or not source_url.startswith('local://'):
            raise PopulationHandoffError('Population reuse requires registered same-host bytes')
        source = Path(source_url[len('local://'):])
        if (not source.is_absolute() or source.name != common.MANIFEST_NAME
                or os.path.normpath(str(source)) != str(source) or '\\' in str(source)
                or source.resolve(strict=True) != source
                or not source.is_relative_to(root / 'runs' / reference['modelRunId'])
                or reference['sizeBytes'] > MAX_MANIFEST_BYTES):
            raise PopulationHandoffError('Population source manifest path or size is unsupported')
        manifest = {'path': common.MANIFEST_NAME, 'sha256': reference['sha256'], 'bytes': reference['sizeBytes']}
        descriptors, directory_identity = _copy_selected_population(
            writer, root, destination, source, manifest, before, common)
        retained_zones = list(csv.DictReader(io.StringIO(common._checked_bytes(
            destination, descriptors['source_zone_attributes'], common.ROLES['source_zone_attributes']).decode('utf-8'), newline='')))
        selected_zones = retained_zones if zone_rows is None else zone_rows
        population = common.read_common_population(destination, expected_manifest=manifest, zone_rows=selected_zones)
        from model_common_population_package import identity
        expected_metadata = {'schema': common.SCHEMA, 'custody': before['request']['custody'],
                             **identity(population), 'origin': None, 'scientific_acceptance': 'unassessed',
                             **({'replacement': before['replacement']} if 'replacement' in before else {})}
        if not _same(artifact['metadata_json'], expected_metadata):
            raise PopulationHandoffError('Population companion identity differs from actual retained records')
        _zone_geography(retained_zones, before['source']['run']['input_snapshot_json']['zoneGeography'], common)
        profile = before['source_request']['sourceProfile']
        source_record = population['source_manifest']
        if not isinstance(source_record, dict):
            raise PopulationHandoffError('Retained population source record is incomplete')
        expected = _source_record(before.get('generation_source', before['source']), profile, source_record.get('zone_attributes'))
        if (set(source_record) - {'study_area', 'selection_coverage'} != set(expected)
                or not _same({key: source_record[key] for key in expected}, expected)
                or not _same(population['basis']['source_profile'], profile)):
            raise PopulationHandoffError('Retained population source record differs from the actual baseline')
        if 'selection_coverage' in source_record:
            from model_common_population_package import validate_selection_coverage
            validate_selection_coverage(source_record['selection_coverage'])
        if 'study_area' in source_record:
            area = source_record['study_area']
            bbox = area.get('bbox') if isinstance(area, dict) else None
            if (not isinstance(area, dict) or set(area) != {'bbox', 'corridor_geojson'}
                    or not isinstance(bbox, list) or len(bbox) != 4
                    or any(type(value) not in (int, float) or not math.isfinite(value) for value in bbox)):
                raise PopulationHandoffError('Retained resolved study area is incomplete')
            if expected['corridor_geojson'] is not None and not _same(area.get('corridor_geojson'), expected['corridor_geojson']):
                raise PopulationHandoffError('Retained resolved geometry differs from the baseline')
        after = _resolve(writer, common)
        if not _same(before, after):
            raise PopulationHandoffError('Population source or consumer changed during copy')
        writer.files.verify()
        if destination.is_symlink() or (destination.stat().st_dev, destination.stat().st_ino) != directory_identity:
            raise PopulationHandoffError('Population copy directory changed during reconciliation')
        population = common.read_common_population(destination, expected_manifest=manifest, zone_rows=selected_zones)
        writer.require_open()
        return {'mode': 'reuse', 'custody': before['request']['custody'], 'request': before['request'], 'source': reference,
                'source_profile': profile, 'source_record': source_record,
                'population': population, 'zone_rows': retained_zones,
                'manifest': manifest, 'directory': str(destination)}
    except BaseException:
        writer.stopped = True
        raise


def confirm_population_publication(reader, population):
    """Recheck actual source and consumer facts before registering produced files."""
    import common_population as common
    try:
        reader.require_open()
        authority = _resolve(reader, common)
        origin = authority.get('generation_source', authority['source']) if authority['request']['mode'] == 'reuse' else authority['consumer']
        profile = (authority['source_request'] if authority['request']['mode'] == 'reuse'
                   else authority['request'])['sourceProfile']
        record = population['source_manifest']
        if not isinstance(record, dict):
            raise PopulationHandoffError('Population consumed source facts are incomplete')
        expected = _source_record(origin, profile, record.get('zone_attributes'))
        if (not isinstance(record, dict) or set(record) - {'study_area', 'selection_coverage'} != set(expected)
                or not _same({key: record[key] for key in expected}, expected)):
            raise PopulationHandoffError('Population consumed source facts changed before publication')
        reader.require_open()
        return authority['request']['custody']
    except BaseException:
        reader.stopped = True
        raise
