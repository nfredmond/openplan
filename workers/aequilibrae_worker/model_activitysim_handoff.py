"""Read exact screening inputs for managed or ordinary ActivitySim consumers."""
from contextlib import ExitStack, closing
import uuid
import hashlib
import json
import re
from model_predecessor_inputs import select
from model_receipt_values import same_json_value

STAGE_PROJECTION = 'id,run_id,stage_name,sort_order,status,attempt_managed,active_attempt_id'
ARTIFACT_PROJECTION = 'id,run_id,stage_id,attempt_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json,model_run_stages!inner(id,run_id,status,attempt_managed,active_attempt_id)'
KINDS = ('skim_matrix', 'zone_attributes', 'network_setup_summary')
POPULATION_KINDS = ('common_population', 'common_population_households', 'common_population_persons',
    'common_population_selected_zones', 'common_population_diagnostics', 'common_population_source_manifest',
    'common_population_source_zone_attributes')
POPULATION_METADATA_FIELDS = {'schema', 'population_basis', 'population_basis_payload_json',
    'population_basis_digest', 'origin', 'scientific_acceptance', 'custody'}
RUN_PROJECTION = 'id,workspace_id,model_id,project_id,scenario_set_id,scenario_entry_id,engine_key,status,attempt_managed,corridor_geojson,query_text,input_snapshot_json,assumption_snapshot_json'


class ScreeningReadError(ValueError):
    """Fixed diagnostics for ordinary reads. Never retain a response body in text."""

    def __init__(self, phase, reason, *, endpoint=None, record_ids=(), status=None,
                 sqlstate=None, fingerprints=(), error_class=None):
        self.phase, self.reason = phase, reason
        self.endpoint = endpoint
        self.record_ids = tuple(value for value in record_ids if _canonical_id(value))
        self.status = status if type(status) is int and 100 <= status <= 599 else None
        self.sqlstate = sqlstate if isinstance(sqlstate, str) and re.fullmatch(r'[0-9A-Z]{5}', sqlstate) else None
        self.fingerprints = fingerprints
        self.error_class = error_class
        super().__init__(self.diagnostic())

    def diagnostic(self):
        values = {'phase': self.phase, 'reason': self.reason}
        for key, value in (('endpoint', self.endpoint), ('ids', self.record_ids),
                ('http_status', self.status), ('sqlstate', self.sqlstate),
                ('fingerprints', self.fingerprints), ('exception_class', self.error_class)):
            if value is not None and value != ():
                values[key] = value
        return json.dumps(values, sort_keys=True, separators=(',', ':'))


def _canonical_id(value):
    if not isinstance(value, str):
        return False
    try:
        return str(uuid.UUID(value)) == value
    except ValueError:
        return False


def _inventory_map(rows, endpoint):
    """Index every row, including non-selected outputs, without normalizing content."""
    result = {}
    for row in rows:
        value = row.get('id')
        if not _canonical_id(value):
            raise ScreeningReadError('inventory', 'invalid_id', endpoint=endpoint)
        if value in result:
            raise ScreeningReadError('inventory', 'duplicate_id', endpoint=endpoint, record_ids=(value,))
        result[value] = row
    return result


def require_same_inventory(before, after, endpoint):
    """Only the outer row sequence is unordered. Nested arrays remain positional."""
    left, right = _inventory_map(before, endpoint), _inventory_map(after, endpoint)
    if left.keys() != right.keys():
        reason = 'membership_changed'
        affected = sorted(left.keys() ^ right.keys())
    else:
        affected = sorted(key for key in left if not same_json_value(left[key], right[key]))
        if not affected:
            return
        reason = 'content_changed'
    fingerprints = tuple(hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
        allow_nan=False).encode()).hexdigest() for value in (left, right))
    raise ScreeningReadError('inventory', reason, endpoint=endpoint,
        record_ids=affected, fingerprints=fingerprints)


def _ordinary_response(call, endpoint, phase, record_ids):
    """Read one supplied transport response; expose only status and SQLSTATE."""
    try:
        with closing(call()) as response:
            if response.status_code != 200:
                sqlstate = None
                try:
                    body = response.json()
                    sqlstate = body.get('code') if isinstance(body, dict) else None
                except Exception:
                    pass
                raise ScreeningReadError(phase, 'http_failed', endpoint=endpoint,
                    record_ids=record_ids, status=response.status_code, sqlstate=sqlstate)
            try:
                return response.json()
            except Exception as error:
                raise ScreeningReadError(phase, 'invalid_json', endpoint=endpoint,
                    record_ids=record_ids, error_class=type(error).__name__) from error
    except ScreeningReadError:
        raise
    except Exception as error:
        raise ScreeningReadError(phase, 'transport_failed', endpoint=endpoint,
            record_ids=record_ids, error_class=type(error).__name__) from error


def common_population_request(run):
    """A guided behavioral consumer reuses its setup's authorized realization."""
    snapshot = run.get('input_snapshot_json')
    if not isinstance(snapshot, dict) or 'commonPopulation' not in snapshot:
        return None
    request = snapshot['commonPopulation']
    restoring = isinstance(request, dict) and request.get('mode') == 'restore_checkpoint'
    fields = {'schema', 'mode', 'comparisonPolicy', 'source', 'custody'} | ({'checkpoint', 'sourceProfile'} if restoring else set())
    if (not isinstance(request, dict) or set(request) != fields
            or request.get('schema') != 'openplan.common-population-request.v1' or request.get('mode') not in ('reuse', 'restore_checkpoint')
            or request.get('custody') not in ('legacy_stage_snapshot', 'managed_attempt')
            or request.get('comparisonPolicy') != 'fixed_population_auto_trip_change'
            or not isinstance(request.get('source'), dict)):
        raise ValueError('Behavioral population requires its explicit reuse request')
    source = request['source']
    if restoring:
        checkpoint = request['checkpoint']
        if (request['custody'] != 'legacy_stage_snapshot' or not isinstance(checkpoint, dict)
                or set(checkpoint) != {'id', 'sha256'} or str(uuid.UUID(checkpoint['id'])) != checkpoint['id']
                or not isinstance(checkpoint['sha256'], str) or len(checkpoint['sha256']) != 64
                or any(c not in '0123456789abcdef' for c in checkpoint['sha256'])):
            raise ValueError('Unsupported behavioral replacement checkpoint')
    if set(source) != {'modelRunId', 'artifactId', 'stageId', 'attemptId', 'sha256', 'sizeBytes'}:
        raise ValueError('Behavioral population requires an exact source reference')
    for key in ('modelRunId', 'artifactId', 'stageId'):
        value = source[key]
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError('Behavioral population reference identity must be canonical')
    attempt = source['attemptId']
    if request['custody'] == 'legacy_stage_snapshot':
        if attempt is not None:
            raise ValueError('Stage snapshot population requires a null source attempt')
    elif not isinstance(attempt, str) or str(uuid.UUID(attempt)) != attempt:
        raise ValueError('Managed population requires a canonical source attempt')
    digest = source['sha256']
    if (not isinstance(digest, str) or len(digest) != 64 or any(char not in '0123456789abcdef' for char in digest)
            or type(source['sizeBytes']) is not int or not 1 <= source['sizeBytes'] <= 2**53 - 1):
        raise ValueError('Behavioral population reference requires an exact hash and safe byte length')
    return request


def _population_companions(run_id, stage_id, stages, artifacts, request):
    consumers = [row for row in stages if row.get('id') == stage_id]
    producers = [row for row in stages if row.get('stage_name') == 'AequilibraE Setup']
    if len(consumers) != 1 or len(producers) != 1:
        raise ValueError('Population setup and consumer stages must be unique')
    consumer, producer = consumers[0], producers[0]
    managed = request['custody'] == 'managed_attempt'
    for key in (('id', 'active_attempt_id') if managed else ('id',)):
        value = producer.get(key)
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError('Population setup identity must be canonical')
    if (producer.get('run_id') != run_id or producer.get('status') != 'succeeded'
            or producer.get('attempt_managed') is not managed or producer['id'] == stage_id
            or (not managed and producer.get('active_attempt_id') is not None)
            or type(producer.get('sort_order')) is not int or type(consumer.get('sort_order')) is not int
            or producer['sort_order'] >= consumer['sort_order']):
        raise ValueError('Population requires an earlier completed setup with exact custody of this run')
    selected = []
    for kind in POPULATION_KINDS:
        matches = [row for row in artifacts if row.get('artifact_type') == kind]
        if len(matches) != 1:
            raise ValueError('Population companion must be unique: ' + kind)
        row = matches[0]
        value = row.get('id')
        if (not isinstance(value, str) or str(uuid.UUID(value)) != value or row.get('run_id') != run_id
                or row.get('stage_id') != producer['id'] or row.get('attempt_id') != producer['active_attempt_id']):
            raise ValueError('Population companion differs from current setup ownership')
        joined = row.get('model_run_stages')
        if (not isinstance(joined, dict) or any(not same_json_value(joined.get(key), producer.get(key))
                for key in ('id', 'run_id', 'status', 'attempt_managed', 'active_attempt_id'))):
            raise ValueError('Population companion producer snapshot differs')
        metadata = row.get('metadata_json')
        if (not isinstance(metadata, dict) or set(metadata) not in (POPULATION_METADATA_FIELDS, POPULATION_METADATA_FIELDS | {'replacement'})
                or metadata.get('schema') != 'openplan.common-population.v1'
                or metadata.get('custody') != request['custody']
                or metadata.get('scientific_acceptance') != 'unassessed'
                or not same_json_value(metadata.get('origin'), request['source'])):
            raise ValueError('Population companion metadata differs from the declared reuse')
        if selected and not same_json_value(metadata, selected[0]['metadata_json']):
            raise ValueError('Population companion identities disagree')
        selected.append(row)
    if selected[0].get('content_hash') != request['source']['sha256'] or not same_json_value(selected[0].get('file_size_bytes'), request['source']['sizeBytes']):
        raise ValueError('Current setup realization differs from the selected original manifest')
    return selected


def _classify_population_outputs(base_url, service_key, run_id, workspace_id, selected, custody, post=None, diagnostic=None):
    """Use the existing service classifier to check revocation, not row status alone."""
    if custody not in ('managed_attempt', 'legacy_stage_snapshot'):
        raise ValueError('Population classification requires explicit supported custody')
    if post is None:
        import requests
        post = requests.post
    if diagnostic is not None:
        diagnostic.update(phase='classification', endpoint='read_model_attempt_outputs')
    with closing(post(base_url.rstrip('/') + '/rest/v1/rpc/read_model_attempt_outputs',
            headers={'apikey': service_key, 'Authorization': 'Bearer ' + service_key},
            json={'p_run_id': run_id, 'p_workspace_id': workspace_id},
            timeout=(5, 30), allow_redirects=False)) as response:
        result = response.json() if response.status_code == 200 else None
        if (not isinstance(result, dict) or result.get('run_id') != run_id
                or result.get('run_status') != 'running' or not isinstance(result.get('outputs'), list)):
            raise ValueError('Population output classification is incomplete')
        for artifact in selected:
            matches = [item for item in result['outputs'] if isinstance(item, dict) and item.get('kind') == 'artifact'
                and isinstance(item.get('record'), dict) and item['record'].get('id') == artifact['id']]
            expected_state = 'current_completed' if custody == 'managed_attempt' else 'legacy_unknown'
            if len(matches) != 1 or matches[0].get('ownership_state') != expected_state:
                raise ValueError('Population setup output is revoked, inactive or incomplete')
            record = matches[0]['record']
            if any(key not in record or not same_json_value(record[key], artifact.get(key))
                   for key in ARTIFACT_PROJECTION.split(',model_run_stages!inner')[0].split(',')):
                raise ValueError('Classified population output differs from the selected artifact')
    if diagnostic is not None:
        diagnostic.update(phase='lineage', endpoint='read_model_population_lineage')
    with closing(post(base_url.rstrip('/') + '/rest/v1/rpc/read_model_population_lineage',
            headers={'apikey': service_key, 'Authorization': 'Bearer ' + service_key},
            json={'p_workspace_id': workspace_id, 'p_run_id': run_id}, timeout=(5, 30), allow_redirects=False)) as response:
        if response.status_code != 200:
            raise ValueError('Population lineage access is unconfirmed')
        lineage = response.json()
    for artifact in selected:
        if not same_json_value(artifact['metadata_json'].get('replacement'), lineage):
            raise ValueError('Population registered lineage differs from native scope')


def read_screening_artifacts(writer, run_id):
    """Confirm consumer ownership and completed producer identity before file use.

    Separate reads are not a database lease. File-copy verification and fenced
    publication remain necessary after this snapshot.
    """
    owned = writer.read_run(run_id)
    request = common_population_request(owned)
    if request is not None and request['custody'] != 'managed_attempt':
        raise ValueError('A bound managed consumer cannot read stage-snapshot population')
    get = writer.get
    if get is None:
        import requests
        get = requests.get
    headers = {'apikey': writer.service_key, 'Authorization': 'Bearer ' + writer.service_key}
    with ExitStack() as stack:
        def read(table, projection):
            response = stack.enter_context(closing(get(writer.base_url.rstrip('/') + '/rest/v1/' + table,
                headers=headers, params={'run_id': 'eq.' + writer.context.run_id, 'select': projection},
                timeout=(5, 30), allow_redirects=False)))
            if response.status_code != 200:
                raise ValueError('Managed handoff read did not succeed')
            return response.json()
        stages = read('model_run_stages', STAGE_PROJECTION)
        artifacts = read('model_run_artifacts', ARTIFACT_PROJECTION)
        selected = [select(writer.context, stages, artifacts, kind) for kind in KINDS]
        if request is not None:
            companions = _population_companions(writer.context.run_id, writer.context.stage_id, stages, artifacts, request)
            _classify_population_outputs(writer.base_url, writer.service_key, writer.context.run_id,
                writer.context.workspace_id, companions, request['custody'], writer.post)
            selected += companions
        final = writer.read_run(run_id)
        if not same_json_value(owned, final):
            raise ValueError('Behavioral run configuration changed during screening selection')
        return selected


def _read_screening_stage_artifacts(base_url, service_key, run_id, stage_id, *, get=None, post=None, diagnostic):
    """Read ordinary-stage authority without constructing a managed writer.

    The legacy classifier describes rows; only the bounded custody RPC attests
    fresh enrollment and immutable receipts. Repeated snapshots are not a lease.
    """
    if get is None or post is None:
        import requests
        get = requests.get if get is None else get
        post = requests.post if post is None else post
    for value in (run_id, stage_id):
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError('Canonical behavioral run and stage required')
    headers = {'apikey': service_key, 'Authorization': 'Bearer ' + service_key}

    snapshot_phase = 'snapshot_before'

    def read(table, projection, **scope):
        diagnostic.update(phase=snapshot_phase, endpoint=table)
        rows = _ordinary_response(lambda: get(base_url.rstrip('/') + '/rest/v1/' + table, headers=headers,
                params={**{key: 'eq.' + value for key, value in scope.items()}, 'select': projection},
                timeout=(5, 30), allow_redirects=False), table, snapshot_phase, (run_id, stage_id))
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError('Stage-snapshot screening read is incomplete')
        fields = projection.split(',model_run_stages!inner')[0].split(',')
        if any(not set(fields).issubset(row) or any(row.get(key) != value for key, value in scope.items()) for row in rows):
            raise ValueError('Stage-snapshot screening row differs from requested scope')
        return rows

    def read_run():
        rows = read('model_runs', RUN_PROJECTION, id=run_id)
        if len(rows) != 1:
            raise ValueError('Stage-snapshot behavioral run must be unique')
        run = rows[0]
        diagnostic.update(phase='parent', endpoint='model_runs')
        workspace = run.get('workspace_id')
        if (not isinstance(workspace, str) or str(uuid.UUID(workspace)) != workspace
                or run.get('status') != 'running' or run.get('attempt_managed') is not False):
            raise ValueError('Stage-snapshot consumer requires a running ordinary parent')
        request = common_population_request(run)
        if request is None or request['custody'] != 'legacy_stage_snapshot':
            raise ValueError('Ordinary consumer requires explicit stage-snapshot population custody')
        return run, request

    owned, request = read_run()
    stages = read('model_run_stages', STAGE_PROJECTION, run_id=run_id)
    artifacts = read('model_run_artifacts', ARTIFACT_PROJECTION, run_id=run_id)
    _inventory_map(stages, 'model_run_stages')
    _inventory_map(artifacts, 'model_run_artifacts')
    diagnostic.update(phase='consumer', endpoint='model_run_stages')
    consumers = [row for row in stages if row['id'] == stage_id]
    if len(consumers) != 1:
        raise ValueError('Stage-snapshot consumer must be unique')
    consumer = consumers[0]
    if (consumer.get('stage_name') != 'ActivitySim Bundle & Preflight' or consumer.get('status') != 'running'
            or consumer.get('attempt_managed') is not False or consumer.get('active_attempt_id') is not None
            or type(consumer.get('sort_order')) is not int):
        raise ValueError('Stage-snapshot consumer stage is not the running ordinary Bundle claim')

    def attest(stage, artifact=None):
        artifact_id = None if artifact is None else artifact['id']
        expected = {'schema': 'openplan.common-population-stage-custody.v1',
            'custody': 'legacy_stage_snapshot', 'workspace_id': owned['workspace_id'],
            'run_id': run_id, 'stage_id': stage, 'artifact_id': artifact_id, 'eligible': True}
        diagnostic.update(phase='native_attestation', endpoint='read_common_population_stage_custody')
        result = _ordinary_response(lambda: post(base_url.rstrip('/') + '/rest/v1/rpc/read_common_population_stage_custody',
                headers=headers, json={'p_workspace': owned['workspace_id'], 'p_run': run_id,
                    'p_stage': stage, 'p_artifact': artifact_id}, timeout=(5, 30), allow_redirects=False),
            'read_common_population_stage_custody', 'native_attestation', (run_id, stage, artifact_id))
        if not same_json_value(result, expected):
            raise ValueError('Fresh stage-snapshot custody eligibility is unconfirmed')

    attest(stage_id)
    diagnostic.update(phase='producer', endpoint='model_run_stages')
    selected = []
    producers = [row for row in stages if row.get('stage_name') == 'Artifact Extraction']
    if len(producers) != 1:
        raise ValueError('Ordinary screening requires a unique Artifact Extraction producer')
    producer = producers[0]
    if (producer['id'] == stage_id or producer.get('status') != 'succeeded'
            or producer.get('attempt_managed') is not False or producer.get('active_attempt_id') is not None
            or type(producer.get('sort_order')) is not int or producer['sort_order'] >= consumer['sort_order']):
        raise ValueError('Ordinary screening requires its earlier completed ordinary producer')
    diagnostic.update(phase='selection', endpoint='model_run_artifacts')
    for kind in KINDS:
        matches = [row for row in artifacts if row.get('artifact_type') == kind]
        if len(matches) != 1:
            raise ValueError('Ordinary screening companion must be unique')
        row = matches[0]
        joined = row.get('model_run_stages')
        if (row.get('stage_id') != producer['id'] or row.get('attempt_id') is not None
                or not isinstance(joined, dict) or any(not same_json_value(joined.get(key), producer.get(key))
                    for key in ('id', 'run_id', 'status', 'attempt_managed', 'active_attempt_id'))):
            raise ValueError('Ordinary screening companion differs from its producer')
        selected.append(row)
    diagnostic.update(phase='population', endpoint='model_run_artifacts')
    companions = _population_companions(run_id, stage_id, stages, artifacts, request)
    def classified_post(url, **kwargs):
        endpoint = diagnostic['endpoint']
        value = _ordinary_response(lambda: post(url, **kwargs), endpoint, diagnostic['phase'], (run_id, stage_id))
        # The classifier owns and closes this small response view just as for HTTP.
        class Response:
            status_code = 200
            def json(self): return value
            def close(self): pass
        return Response()
    _classify_population_outputs(base_url, service_key, run_id, owned['workspace_id'], companions,
        request['custody'], classified_post, diagnostic=diagnostic)
    for artifact in companions:
        attest(artifact['stage_id'], artifact)
    snapshot_phase = 'snapshot_after'
    final, _ = read_run()
    final_stages = read('model_run_stages', STAGE_PROJECTION, run_id=run_id)
    final_artifacts = read('model_run_artifacts', ARTIFACT_PROJECTION, run_id=run_id)
    diagnostic.update(phase='parent_recheck', endpoint='model_runs')
    if not same_json_value(owned, final):
        raise ValueError('Ordinary behavioral run changed during screening selection')
    require_same_inventory(stages, final_stages, 'model_run_stages')
    require_same_inventory(artifacts, final_artifacts, 'model_run_artifacts')
    attest(stage_id)
    return {'run': owned, 'artifacts': selected + companions}


def read_screening_stage_artifacts(base_url, service_key, run_id, stage_id, *, get=None, post=None):
    """Preserve the failure chain with fixed phase and reason diagnostics."""
    diagnostic = {'phase': 'request', 'endpoint': None}
    try:
        return _read_screening_stage_artifacts(base_url, service_key, run_id, stage_id,
            get=get, post=post, diagnostic=diagnostic)
    except ScreeningReadError:
        raise
    except Exception as error:
        raise ScreeningReadError(diagnostic['phase'],
            'validation_failed' if isinstance(error, ValueError) else 'unexpected_error',
            endpoint=diagnostic['endpoint'], record_ids=(run_id, stage_id),
            error_class=type(error).__name__) from error
