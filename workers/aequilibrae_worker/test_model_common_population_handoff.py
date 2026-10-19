"""Supplied authority rows and real temporary-file copies, no live services.

These controls cannot prove installed RLS, Census origin, a distributed source
lease, model execution or scientific accuracy. Root executes the source tests.
"""
import copy
import csv
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

SCRIPT_DIR = Path(__file__).resolve().parents[2] / 'scripts' / 'modeling'
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import common_population as common
from model_common_population_package import identity as population_identity
import model_common_population_handoff as handoff


def identity(number):
    return f'{number:08x}-1111-4111-8111-111111111111'


def response(value, status=200):
    return Mock(status_code=status, json=Mock(return_value=copy.deepcopy(value)))


class PopulationHandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace, self.project, self.scenario_set = identity(1), identity(2), identity(3)
        self.baseline, self.build = identity(4), identity(5)
        self.source_id, self.consumer_id = identity(6), identity(7)
        self.source_model, self.consumer_model = identity(8), identity(9)
        self.source_stage, self.consumer_stage = identity(10), identity(11)
        self.source_attempt, self.consumer_attempt, self.artifact_id = identity(12), identity(13), identity(14)
        self.geometry = {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
        self.profile = common.census_source_profile('https://api.census.gov/data/2023/acs/acs5', 'https://api.census.gov/data/2023/acs/acs5/pums')
        self.change = {'guidedProjectChange': {'kind': 'assigned_auto_trip_change_pct', 'autoTripChangePct': -5, 'basis': 'Supplied fixture'}}
        self.generate = {'schema': handoff.REQUEST_SCHEMA, 'mode': 'generate', 'custody': 'managed_attempt', 'comparisonPolicy': handoff.POLICY, 'sourceProfile': self.profile}
        self.payload = self.zone_payload(self.source_id)
        source_run = self.make_run(self.source_id, self.source_model, self.baseline, 'succeeded', self.generate)
        consumer_run = self.make_run(self.consumer_id, self.consumer_model, self.build, 'running', None)
        self.tables = {
            'model_runs': [source_run, consumer_run],
            'models': [self.model(self.source_model), self.model(self.consumer_model)],
            'projects': [{'id': self.project, 'workspace_id': self.workspace}],
            'scenario_sets': [{'id': self.scenario_set, 'workspace_id': self.workspace, 'project_id': self.project, 'baseline_entry_id': self.baseline}],
            'scenario_entries': [{'id': self.baseline, 'scenario_set_id': self.scenario_set, 'entry_type': 'baseline', 'assumptions_json': {}},
                                 {'id': self.build, 'scenario_set_id': self.scenario_set, 'entry_type': 'alternative', 'assumptions_json': self.change}],
            'model_run_stages': [self.stage(self.source_stage, self.source_id, self.source_attempt, 'succeeded'),
                                 self.stage(self.consumer_stage, self.consumer_id, self.consumer_attempt, 'running')],
            'model_run_artifacts': [],
        }
        self.source_dir = self.root / 'runs' / self.source_id / 'source-attempt' / 'common_population'
        self.source_dir.parent.mkdir(parents=True)
        self.zones = [{'jobs_source': 'lodes_wac', 'zone_id': 7, 'GEOID': '01001000100', 'zone_kind': 'internal', 'centroid_lon': 0.5,
                       'centroid_lat': 0.5, 'area_sq_mi': 1, 'total_jobs': 5, 'est_population': 100, 'households': 50}]
        self.original_record = {'schema': handoff.SOURCE_SCHEMA, 'custody': 'managed_attempt', 'run_id': self.source_id, 'workspace_id': self.workspace,
            'model_id': self.source_model, 'project_id': self.project, 'scenario_set_id': self.scenario_set,
            'scenario_entry_id': self.baseline, 'corridor_geojson': self.geometry, 'zone_geography': 'tract',
            'source_profile': self.profile, 'zone_attributes': self.payload,
            'selection_coverage': {'candidate_tracts': 1, 'matched_tracts': 1, 'unmatched_tracts': 0}}
        self.source_manifest_path = self.source_dir.parent / 'source.json'
        self.source_manifest_path.write_text(json.dumps(self.original_record))
        self.zone_path = self.source_dir.parent / 'zones.csv'
        with self.zone_path.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(self.zones[0]))
            writer.writeheader()
            writer.writerows(self.zones)
        household = {'household_id': 4, 'home_zone_id': 7, 'persons': 1, 'workers': 1, 'autos': 1, 'income': 90000,
            'hht': 1, 'seed_household_id': 'fixture-H', 'source_geoid': '01001000100', 'synthesis_method': common.SYNTHESIS_METHOD}
        person = {'person_id': 8, 'household_id': 4, 'person_num': 1, 'home_zone_id': 7, 'age': 40, 'sex': 1,
            'is_worker': 1, 'is_student': 0, 'esr': '1', 'schg': '', 'wkhp': '40', 'seed_household_id': 'fixture-H',
            'source_geoid': '01001000100', 'synthesis_method': common.SYNTHESIS_METHOD}
        result = {'households': [household], 'persons': [person], 'provenance': {
            'endpoint': self.profile['pums_endpoint'], 'acs_summary_endpoint': self.profile['acs_summary_endpoint'],
            'acs_sample_years': [2019, 2023], 'income_dollar_year': 2023, 'puma_fields': {'2020': 'PUMA'}},
            'source_controls': {'raw_by_geoid': {'01001000100': {'B01003_001E': '100', 'B09019_002E': '1'}}},
            'fit_quality': {}, 'fit_grading_note': 'Supplied fixture', 'dropped_controls': {}, 'zone_fits': [], 'method': common.SYNTHESIS_METHOD}
        self.descriptor = common.retain_population(self.source_dir, self.zones, result,
            source_manifest_path=self.source_manifest_path, zone_attributes_path=self.zone_path, source_profile=self.profile)
        artifact = {'id': self.artifact_id, 'run_id': self.source_id, 'stage_id': self.source_stage, 'attempt_id': self.source_attempt,
            'artifact_type': 'common_population', 'file_url': 'local://' + str(self.source_dir / common.MANIFEST_NAME),
            'file_size_bytes': self.descriptor['bytes'], 'content_hash': self.descriptor['sha256'], 'metadata_json': {'schema': common.SCHEMA, 'custody': 'managed_attempt'}}
        metadata = {'schema': common.SCHEMA, 'custody': 'managed_attempt',
                    **population_identity(common.read_common_population(self.source_dir,
                        expected_manifest=self.descriptor, zone_rows=self.zones)),
                    'origin': None, 'scientific_acceptance': 'unassessed'}
        artifact['metadata_json'] = metadata
        self.tables['model_run_artifacts'] = [artifact]
        for index, (role, name) in enumerate(common.ROLES.items()):
            descriptor = common.file_descriptor(self.source_dir / name)
            self.tables['model_run_artifacts'].append({**artifact, 'id': identity(20 + index),
                'artifact_type': 'common_population_' + role, 'file_url': 'local://' + str(self.source_dir / name),
                'content_hash': descriptor['sha256'], 'file_size_bytes': descriptor['bytes']})
        self.reference = {'modelRunId': self.source_id, 'artifactId': self.artifact_id, 'stageId': self.source_stage,
            'attemptId': self.source_attempt, 'sha256': self.descriptor['sha256'], 'sizeBytes': self.descriptor['bytes']}
        consumer_run['input_snapshot_json']['commonPopulation'] = {'schema': handoff.REQUEST_SCHEMA, 'mode': 'reuse',
            'comparisonPolicy': handoff.POLICY, 'custody': 'managed_attempt', 'source': self.reference}
        self.ownership_state = 'current_completed'
        self.calls, self.responses = [], []
        self.consumer_dir = self.root / 'runs' / self.consumer_id / 'consumer-attempt'
        self.consumer_dir.mkdir(parents=True)
        self.destination = self.consumer_dir / 'common_population'
        self.writer = SimpleNamespace(context=SimpleNamespace(run_id=self.consumer_id, workspace_id=self.workspace,
            stage_id=self.consumer_stage, attempt_id=self.consumer_attempt), base_url='https://bound.invalid', service_key='fixture-only',
            files=SimpleNamespace(root=self.root / 'runs', path=self.consumer_dir, verify=Mock()), stopped=False)
        self.writer.get = Mock(side_effect=self.get)
        self.writer.post = Mock(side_effect=self.post)
        self.writer.require_open = Mock(side_effect=self.require_open)
        self.writer.read_run = Mock(side_effect=self.read_run)

    def zone_payload(self, run_id):
        return {'version': 'zone-attributes-v1', 'run_id': run_id,
            'source': {'id': 'us_census_acs5', 'vintage': '2023', 'retrieval_url': self.profile['acs_summary_endpoint']},
            'tables': {'demographics': {'status': 'supplied'}, 'equity': {'status': 'unavailable'}}}

    def make_run(self, run_id, model_id, entry_id, status, request):
        return {'id': run_id, 'workspace_id': self.workspace, 'model_id': model_id, 'project_id': self.project,
            'scenario_set_id': self.scenario_set, 'scenario_entry_id': entry_id, 'engine_key': 'aequilibrae',
            'status': status, 'attempt_managed': True, 'corridor_geojson': self.geometry, 'query_text': 'Supplied study',
            'assumption_snapshot_json': {} if entry_id == self.baseline else self.change,
            'input_snapshot_json': {'zoneGeography': 'tract', 'commonPopulation': request, 'zoneAttributes': {
                'status': 'supplied', 'sourceId': 'us_census_acs5', 'vintage': '2023',
                'storageRef': 'storage://run-artifacts/model-runs/' + run_id + '/zone-attributes.json'}}}

    def model(self, model_id):
        return {'id': model_id, 'workspace_id': self.workspace, 'project_id': self.project, 'scenario_set_id': self.scenario_set,
                'config_json': {'guidedProjectComparison': handoff.GUIDED_SCHEMA, 'method': 'aequilibrae'}}

    def stage(self, stage_id, run_id, attempt_id, status):
        return {'id': stage_id, 'run_id': run_id, 'stage_name': 'AequilibraE Setup', 'status': status,
                'attempt_managed': True, 'active_attempt_id': attempt_id}

    def require_open(self):
        if self.writer.stopped:
            raise ValueError('Fixture writer stopped')

    def read_run(self, run_id, *, expected_stage_name):
        self.require_open()
        self.assertEqual(run_id, self.consumer_id)
        self.assertEqual(expected_stage_name, 'AequilibraE Setup')
        return copy.deepcopy(self.tables['model_runs'][1])

    def get(self, url, **kwargs):
        self.calls.append((url, copy.deepcopy(kwargs)))
        self.assertTrue(url.startswith(self.writer.base_url + '/rest/v1/'))
        self.assertFalse(kwargs['allow_redirects'])
        self.assertEqual(kwargs['headers'], {'apikey': 'fixture-only', 'Authorization': 'Bearer fixture-only'})
        table = url.rsplit('/', 1)[-1]
        self.assertNotEqual(table, 'model_stage_attempts')
        rows = [row for row in self.tables[table] if all(key == 'select' or row.get(key) == value[3:]
                for key, value in kwargs['params'].items())]
        reply = response(rows)
        self.responses.append(reply)
        return reply

    def post(self, url, **kwargs):
        if url.endswith('/read_common_population_stage_custody'):
            body = kwargs['json']
            self.assertEqual(set(body), {'p_workspace', 'p_run', 'p_stage', 'p_artifact'})
            self.assertEqual(body['p_workspace'], self.workspace)
            self.assertFalse(kwargs['allow_redirects'])
            reply = response({'schema': 'openplan.common-population-stage-custody.v1',
                'custody': 'legacy_stage_snapshot', 'workspace_id': self.workspace,
                'run_id': body['p_run'], 'stage_id': body['p_stage'], 'artifact_id': body['p_artifact'],
                'eligible': self.stage_eligible})
            self.responses.append(reply)
            return reply
        self.assertEqual(url, self.writer.base_url + '/rest/v1/rpc/read_model_attempt_outputs')
        self.assertEqual(kwargs['json'], {'p_run_id': self.source_id, 'p_workspace_id': self.workspace})
        self.assertFalse(kwargs['allow_redirects'])
        reply = response({'run_id': self.source_id, 'run_status': 'succeeded', 'outputs': [
            {'kind': 'artifact', 'ownership_state': self.ownership_state, 'record': row}
            for row in self.tables['model_run_artifacts']]})
        self.responses.append(reply)
        return reply

    def prepare(self, **kwargs):
        return handoff.prepare_population_input(self.writer, destination=self.destination, **kwargs)

    def use_stage_snapshot(self):
        self.stage_eligible = True
        self.ownership_state = 'legacy_unknown'
        for run in self.tables['model_runs']:
            run['attempt_managed'] = False
            run['input_snapshot_json']['commonPopulation']['custody'] = 'legacy_stage_snapshot'
        for stage in self.tables['model_run_stages']:
            stage.update(attempt_managed=False, active_attempt_id=None)
        self.reference['attemptId'] = None
        self.original_record['custody'] = 'legacy_stage_snapshot'
        self.source_manifest_path.write_text(json.dumps(self.original_record))
        basis_path = self.source_dir / common.MANIFEST_NAME
        basis = json.loads(basis_path.read_bytes())
        source_path = self.source_dir / common.ROLES['source_manifest']
        source_path.write_bytes(self.source_manifest_path.read_bytes())
        basis['files']['source_manifest'] = common.file_descriptor(source_path)
        basis_path.write_text(json.dumps(basis))
        self.descriptor = common.file_descriptor(basis_path)
        self.reference.update(sha256=self.descriptor['sha256'], sizeBytes=self.descriptor['bytes'])
        metadata = {'schema': common.SCHEMA, 'custody': 'legacy_stage_snapshot',
                    **population_identity(common.read_common_population(self.source_dir,
                        expected_manifest=self.descriptor, zone_rows=self.zones)),
                    'origin': None, 'scientific_acceptance': 'unassessed'}
        for artifact in self.tables['model_run_artifacts']:
            artifact.update(attempt_id=None, metadata_json=metadata)
            if artifact['artifact_type'] == 'common_population':
                descriptor = self.descriptor
            else:
                role = artifact['artifact_type'][len('common_population_'):]
                descriptor = common.file_descriptor(self.source_dir / common.ROLES[role])
            artifact.update(content_hash=descriptor['sha256'], file_size_bytes=descriptor['bytes'])
        self.consumer_dir = self.root / 'runs' / self.consumer_id
        self.destination = self.consumer_dir / 'stage-population-source'
        self.writer = handoff.StagePopulationReader(base_url='https://bound.invalid', service_key='fixture-only',
            workspace_id=self.workspace, run_id=self.consumer_id, stage_id=self.consumer_stage,
            shared_root=self.root, work_dir=self.consumer_dir, get=Mock(side_effect=self.get), post=Mock(side_effect=self.post))

    def test_fresh_ordinary_stage_retains_exact_population_without_managed_binding(self):
        self.use_stage_snapshot()
        loaded = self.prepare()
        self.assertEqual(loaded['custody'], 'legacy_stage_snapshot')
        self.assertEqual(loaded['source']['attemptId'], None)
        self.assertEqual(loaded['source_record'], self.original_record)
        self.assertEqual(loaded['population']['realized_zone_counts'][0]['persons'], 1)
        self.assertFalse(self.writer.stopped)
        rpc_calls = self.writer.post.call_args_list
        attestations = [call for call in rpc_calls if call.args[0].endswith('/read_common_population_stage_custody')]
        self.assertEqual(len(attestations), 16)
        self.assertEqual(self.ownership_state, 'legacy_unknown')

    def test_stage_snapshot_requires_fresh_start_and_receipt_not_legacy_classifier_alone(self):
        self.use_stage_snapshot()
        self.stage_eligible = False
        with self.assertRaisesRegex(ValueError, 'Fresh receipt-backed population stage custody'):
            self.prepare()
        self.assertFalse(self.destination.exists())
        self.assertTrue(self.writer.stopped)

    def test_stage_snapshot_requires_each_exact_registered_companion(self):
        self.use_stage_snapshot()
        self.tables['model_run_artifacts'].pop()
        with self.assertRaisesRegex(ValueError, 'incomplete or not unique'):
            self.prepare()
        self.assertFalse(self.destination.exists())

    def test_stage_snapshot_companion_descriptor_and_metadata_cannot_diverge(self):
        self.use_stage_snapshot()
        companion = self.tables['model_run_artifacts'][1]
        companion['content_hash'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'retained manifest descriptor'):
            self.prepare()

    def test_stage_snapshot_companion_receipt_is_checked_independently(self):
        self.use_stage_snapshot()
        original = self.post
        companion_id = self.tables['model_run_artifacts'][-1]['id']
        def wrong_receipt(url, **kwargs):
            value = original(url, **kwargs)
            if url.endswith('/read_common_population_stage_custody') and kwargs['json']['p_artifact'] == companion_id:
                return response({**value.json(), 'eligible': False})
            return value
        self.writer.post.side_effect = wrong_receipt
        with self.assertRaisesRegex(ValueError, 'Fresh receipt-backed population stage custody'):
            self.prepare()
        self.assertFalse(self.destination.exists())

    def test_stage_snapshot_cannot_adopt_managed_null_or_mixed_ownership(self):
        self.use_stage_snapshot()
        run = self.tables['model_runs'][0]
        for managed in (True, None):
            self.writer.stopped = False
            run['attempt_managed'] = managed
            with self.subTest(managed=managed), self.assertRaisesRegex(ValueError, 'completed baseline'):
                self.prepare()
        run['attempt_managed'] = False
        self.writer.stopped = False
        self.tables['model_run_stages'][0]['active_attempt_id'] = self.source_attempt
        with self.assertRaisesRegex(ValueError, 'ownership is inconsistent'):
            self.prepare()

    def test_missing_unknown_or_wrong_invocation_custody_never_falls_back(self):
        request = self.tables['model_runs'][1]['input_snapshot_json']['commonPopulation']
        for custody, reason in ((None, '^Unsupported common-population request$'),
                                ('unknown', '^Unsupported common-population request$'),
                                ('legacy_stage_snapshot', '^Stage snapshot cannot name a managed attempt$')):
            self.writer.stopped = False
            request['custody'] = custody
            with self.subTest(custody=custody), self.assertRaisesRegex(ValueError, reason):
                self.prepare()
        request.pop('custody')
        self.writer.stopped = False
        with self.assertRaisesRegex(ValueError, 'request'):
            self.prepare()

    def test_stage_snapshot_custody_change_during_copy_preserves_partial_and_refuses(self):
        self.use_stage_snapshot()
        original = handoff.copy_registered
        def change(*args, **kwargs):
            result = original(*args, **kwargs)
            self.stage_eligible = False
            return result
        with patch.object(handoff, 'copy_registered', side_effect=change), self.assertRaisesRegex(ValueError, 'Fresh receipt-backed'):
            self.prepare()
        self.assertTrue(self.destination.exists())
        self.assertTrue(self.writer.stopped)

    def test_retains_exact_manifest_all_companions_and_original_zone_rows(self):
        loaded = self.prepare()
        self.assertEqual(loaded['mode'], 'reuse')
        self.assertEqual(loaded['source'], self.reference)
        self.assertEqual(loaded['population']['realized_zone_counts'], [{'zone_id': 7, 'households': 1, 'persons': 1, 'workers': 1}])
        self.assertEqual(loaded['zone_rows'][0]['total_jobs'], '5')
        self.assertEqual(loaded['zone_rows'][0]['est_population'], '100')
        self.assertEqual(loaded['source_record'], self.original_record)
        for name in (common.MANIFEST_NAME, *common.ROLES.values()):
            self.assertEqual((self.destination / name).read_bytes(), (self.source_dir / name).read_bytes())
        expected = {
            'model_runs': 'id,workspace_id,model_id,project_id,scenario_set_id,scenario_entry_id,engine_key,status,attempt_managed,corridor_geojson,query_text,input_snapshot_json,assumption_snapshot_json',
            'models': 'id,workspace_id,project_id,scenario_set_id,config_json',
            'projects': 'id,workspace_id',
            'scenario_sets': 'id,workspace_id,project_id,baseline_entry_id',
            'scenario_entries': 'id,scenario_set_id,entry_type,assumptions_json',
            'model_run_stages': 'id,run_id,stage_name,status,attempt_managed,active_attempt_id',
            'model_run_artifacts': 'id,run_id,stage_id,attempt_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json',
        }
        for url, kwargs in self.calls:
            self.assertEqual(kwargs['params']['select'], expected[url.rsplit('/', 1)[-1]])
        self.assertEqual(self.writer.post.call_count, 14)
        for reply in self.responses:
            reply.close.assert_called_once()
        self.assertFalse(self.writer.stopped)

    def test_generation_returns_authoritative_source_record_without_copy_or_rpc(self):
        run = self.tables['model_runs'][1]
        run['scenario_entry_id'], run['assumption_snapshot_json'] = self.baseline, {}
        run['input_snapshot_json']['commonPopulation'] = copy.deepcopy(self.generate)
        loaded = self.prepare(zone_rows=self.zones, zone_attributes=self.zone_payload(self.consumer_id))
        self.assertEqual(loaded['mode'], 'generate')
        self.assertEqual(loaded['source_record']['run_id'], self.consumer_id)
        self.assertEqual(loaded['source_record']['model_id'], self.consumer_model)
        self.assertEqual(loaded['source_profile'], self.profile)
        self.assertFalse(self.destination.exists())
        self.writer.post.assert_not_called()

    def test_cross_project_workspace_model_set_and_baseline_source_refuse(self):
        faults = [('model_runs', 0, 'project_id', identity(40)), ('model_runs', 0, 'workspace_id', identity(40)),
            ('models', 0, 'project_id', identity(40)), ('models', 0, 'scenario_set_id', identity(40)),
            ('model_runs', 0, 'scenario_entry_id', self.build), ('model_runs', 0, 'status', 'running')]
        original = copy.deepcopy(self.tables)
        for table, index, field, value in faults:
            with self.subTest(table=table, field=field):
                self.tables = copy.deepcopy(original)
                self.tables[table][index][field] = value
                self.writer.stopped = False
                with self.assertRaises((ValueError, KeyError)):
                    self.prepare()
                self.assertTrue(self.writer.stopped)
                self.assertFalse(self.destination.exists())

    def test_wrong_producer_stage_active_attempt_or_classified_revocation_refuse(self):
        for field, value in [('stage_name', 'Artifact Extraction'), ('active_attempt_id', identity(40)), ('status', 'running')]:
            with self.subTest(field=field):
                original = self.tables['model_run_stages'][0][field]
                self.tables['model_run_stages'][0][field] = value
                with self.assertRaises(ValueError):
                    self.prepare()
                self.tables['model_run_stages'][0][field] = original
                self.writer.stopped = False
                self.assertFalse(self.destination.exists())
        self.ownership_state = 'retained_inactive'
        with self.assertRaisesRegex(ValueError, 'revoked, inactive'):
            self.prepare()
        self.assertFalse(self.destination.exists())

    def test_exact_reference_and_complete_projection_required(self):
        for field, value in [('sha256', '0' * 64), ('sizeBytes', self.descriptor['bytes'] + 1), ('stageId', identity(40)),
                             ('attemptId', identity(40)), ('modelRunId', self.consumer_id), ('sizeBytes', True)]:
            with self.subTest(field=field):
                original = self.reference[field]
                self.reference[field] = value
                with self.assertRaises(ValueError):
                    self.prepare()
                self.reference[field] = original
                self.writer.stopped = False
                self.assertFalse(self.destination.exists())
        del self.tables['model_runs'][0]['project_id']
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            self.prepare()

    def test_source_geometry_and_resolution_must_match(self):
        self.tables['model_runs'][0]['corridor_geojson'] = {'type': 'Polygon', 'coordinates': [[[2, 2], [3, 2], [3, 3], [2, 2]]]}
        with self.assertRaisesRegex(ValueError, 'study and zone geography'):
            self.prepare()
        self.tables['model_runs'][0]['corridor_geojson'] = self.geometry
        self.tables['model_runs'][0]['input_snapshot_json']['zoneGeography'] = 'block_group'
        self.writer.stopped = False
        with self.assertRaisesRegex(ValueError, 'study and zone geography'):
            self.prepare()

    def test_two_missing_geometries_require_equal_nonempty_queries(self):
        for run in self.tables['model_runs']:
            run['corridor_geojson'] = None
            run['query_text'] = ''
        with self.assertRaisesRegex(ValueError, 'neither geometry'):
            self.prepare()
        self.writer.stopped = False
        self.tables['model_runs'][0]['query_text'] = 'source query'
        self.tables['model_runs'][1]['query_text'] = 'other query'
        with self.assertRaisesRegex(ValueError, 'study and zone geography'):
            self.prepare()

    def test_changed_source_during_actual_copy_stops_after_preserving_copies(self):
        original = handoff.copy_registered
        changed = False
        def copy_and_revoke(*args, **kwargs):
            nonlocal changed
            retained = original(*args, **kwargs)
            if not changed:
                changed = True
                self.ownership_state = 'retained_inactive'
            return retained
        with patch.object(handoff, 'copy_registered', side_effect=copy_and_revoke):
            with self.assertRaisesRegex(ValueError, 'revoked, inactive'):
                self.prepare()
        self.assertTrue(self.destination.exists())
        self.assertTrue(self.writer.stopped)

    def test_individually_valid_changed_source_snapshot_is_not_the_selected_snapshot(self):
        original = handoff.copy_registered
        changed = False
        def copy_and_change_metadata(*args, **kwargs):
            nonlocal changed
            retained = original(*args, **kwargs)
            if not changed:
                changed = True
                self.tables['models'][0]['config_json']['additional_note'] = 'Changed after selection'
            return retained
        with patch.object(handoff, 'copy_registered', side_effect=copy_and_change_metadata):
            with self.assertRaisesRegex(ValueError, 'source or consumer changed during copy'):
                self.prepare()
        self.assertTrue(self.destination.exists())
        self.assertTrue(self.writer.stopped)

    def test_consistent_foreign_project_and_set_refuse_at_authority_boundary(self):
        other_project, other_set, other_baseline = identity(41), identity(42), identity(43)
        self.tables['projects'].append({'id': other_project, 'workspace_id': self.workspace})
        self.tables['scenario_sets'].append({'id': other_set, 'workspace_id': self.workspace,
                                           'project_id': other_project, 'baseline_entry_id': other_baseline})
        self.tables['scenario_entries'].append({'id': other_baseline, 'scenario_set_id': other_set,
                                               'entry_type': 'baseline', 'assumptions_json': {}})
        self.tables['model_runs'][0].update(project_id=other_project, scenario_set_id=other_set, scenario_entry_id=other_baseline)
        self.tables['models'][0].update(project_id=other_project, scenario_set_id=other_set)
        with self.assertRaisesRegex(ValueError, 'completed baseline in this project'):
            handoff._resolve(self.writer, common)
        self.assertFalse(self.destination.exists())

    def test_corrupt_roster_and_preexisting_destination_refuse(self):
        people = self.source_dir / common.ROLES['persons']
        people.write_bytes(people.read_bytes() + b'changed\n')
        with self.assertRaisesRegex(ValueError, 'byte size differs'):
            self.prepare()
        self.assertTrue(self.destination.exists())
        self.writer.stopped = False
        with self.assertRaisesRegex(ValueError, 'fresh destination'):
            self.prepare()

    def test_missing_transport_result_and_arbitrary_request_fields_never_fallback(self):
        self.writer.get.side_effect = lambda *args, **kwargs: response([], status=503)
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            self.prepare()
        self.writer.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_unknown_source_path_request_and_duplicate_artifact_refuse(self):
        request = self.tables['model_runs'][1]['input_snapshot_json']['commonPopulation']
        request['source']['file_url'] = 'local:///unselected/path'
        with self.assertRaisesRegex(ValueError, 'Exact population source reference'):
            self.prepare()
        del request['source']['file_url']
        self.writer.stopped = False
        self.tables['model_run_artifacts'].append(copy.deepcopy(self.tables['model_run_artifacts'][0]))
        with self.assertRaisesRegex(ValueError, 'not unique'):
            self.prepare()
        self.assertFalse(self.destination.exists())

    def test_stopped_writer_and_generation_from_build_do_no_copy(self):
        self.writer.stopped = True
        with self.assertRaisesRegex(ValueError, 'Fixture writer stopped'):
            self.prepare()
        self.writer.get.assert_not_called()
        self.writer.stopped = False
        self.tables['model_runs'][1]['input_snapshot_json']['commonPopulation'] = copy.deepcopy(self.generate)
        with self.assertRaisesRegex(ValueError, 'first AequilibraE baseline'):
            self.prepare(zone_attributes=self.zone_payload(self.consumer_id))
        self.assertFalse(self.destination.exists())

    def test_requested_zone_map_cannot_replace_retained_map(self):
        zones = [{**self.zones[0], 'zone_id': 8}]
        with self.assertRaisesRegex(ValueError, 'Selected-zone map'):
            self.prepare(zone_rows=zones)
        self.assertTrue(self.destination.exists())
        self.assertTrue(self.writer.stopped)

    def test_harmless_query_metadata_and_reordered_zone_input_survive(self):
        for model in self.tables['models']:
            model['config_json']['unrelated_note'] = 'Harmless supplied metadata'
        loaded = self.prepare(zone_rows=list(reversed(self.zones)))
        self.assertEqual(loaded['population']['realized_zone_counts'][0]['persons'], 1)
        self.assertFalse(self.writer.stopped)


if __name__ == '__main__':
    unittest.main()
