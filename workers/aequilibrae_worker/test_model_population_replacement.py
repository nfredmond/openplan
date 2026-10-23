"""Actual controller/files/journals with supplied REST and native-engine boundaries.

Root executes these sources. They do not prove SQL/RLS, Census origin, real OSM,
scientific acceptance or hostile same-user filesystem isolation.
"""
from contextlib import ExitStack
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch
import unittest
from urllib.parse import parse_qs, urlsplit

# Keep this suite importable without an operator environment.
os.environ.setdefault("SUPABASE_URL", "http://worker-import-only.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "import-only-not-a-key")

with patch('dotenv.load_dotenv'), patch.dict(os.environ, {
        'SUPABASE_URL': 'https://bound.invalid', 'SUPABASE_SERVICE_ROLE_KEY': 'fixture-only'}):
    import main
import model_population_replacement as replacement
import model_common_population_package as package
import model_common_population_setup_recovery as recovery
import model_command_journal as journal
import model_command_client as client
import model_attempt_writer
import test_model_common_population_setup_recovery as supplied
from test_model_common_population_handoff import identity, response

DEPLOYMENT = 'replacement-controller-fixture'
SETTINGS = {'schema': 'openplan.population-replacement-settings.v1', 'fixture': 'supplied runtime configuration'}


class ReplacementControllerTests(unittest.TestCase):
    def setUp(self):
        self.seed = supplied.SetupRecoveryTests()
        self.seed.setUp()
        self.addCleanup(self.seed.doCleanups)
        self.seed.prepare()
        self.f = self.seed.f
        self.registrations = []
        self.artifacts = []
        self.revoked = False
        self.new_id, self.new_stage = identity(401), identity(402)

    def get(self, url, **kwargs):
        parsed = urlsplit(url)
        params = kwargs.get('params') or {k: v[0] for k, v in parse_qs(parsed.query).items()}
        table = parsed.path.rsplit('/', 1)[-1]
        rows = []
        for row in self.f.tables[table]:
            if all(key == 'select' or (str(row.get(key)) != value[4:] if value.startswith('neq.') else str(row.get(key)) == value[3:]) for key, value in params.items()):
                selected = params.get('select', '').split(',')
                rows.append({key: row[key] for key in selected} if selected != [''] else copy.deepcopy(row))
        return response(rows)

    def post(self, url, **kwargs):
        args = kwargs['json']
        if url.endswith('/register_model_population_checkpoint'):
            command_args = {key[2:]: value for key, value in args.items() if key != 'p_request_id'}
            value = {'schema': replacement.SCHEMA, 'request_id': args['p_request_id'], **command_args,
                     'outcome': 'checkpoint_registered', 'checkpoint_sha256': command_args['facts']['result_sha256']}
            self.registrations.append(copy.deepcopy(value))
            return response(value)
        if url.endswith('/read_model_population_origin'):
            if self.revoked:
                return response({'error': 'source access revoked'}, 403)
            registration = self.registrations[0]
            return response({'schema': replacement.SCHEMA, 'registration': registration,
                'origin_run': self.f.tables['model_runs'][0], 'lineage': replacement.lineage(registration)})
        if url.endswith('/record_legacy_model_artifact'):
            row = {**args['p_payload'], 'attempt_id': None}
            self.f.tables['model_run_artifacts'].append(row)
            self.artifacts.append(copy.deepcopy(row))
            return response(row)
        return self.f.post(url, **kwargs)

    def patches(self, run_id, values):
        next(row for row in self.f.tables['model_runs'] if row['id'] == run_id).update(values)

    def stage_patches(self, stage_id, values):
        next(row for row in self.f.tables['model_run_stages'] if row['id'] == stage_id).update(values)

    def controller(self, stage, *, fail_network, actual_settings=False):
        class SuppliedProject:
            def __init__(inner):
                inner.network = SimpleNamespace(create_from_osm=Mock(side_effect=RuntimeError('Overpass HTTP 502')))
            def new(inner, path):
                Path(path).mkdir()
            def close(inner):
                pass
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {'OPENPLAN_DEPLOYMENT_ID': DEPLOYMENT, 'OPENPLAN_HOSTED_ARTIFACT_MIRROR': '0'}))
            for name, value in {'RUN_WORK_ROOT': str(self.f.root), 'SUPABASE_URL': self.f.writer.base_url,
                                'SUPABASE_KEY': 'fixture-only', '_CUSTODY': Mock()}.items():
                stack.enter_context(patch.object(main, name, value))
            stack.enter_context(patch.object(model_attempt_writer, 'current', return_value=None))
            stack.enter_context(patch.object(main.requests, 'get', side_effect=self.get))
            stack.enter_context(patch.object(main.requests, 'post', side_effect=self.post))
            stack.enter_context(patch.object(main, 'sb_claim_stage', return_value=True))
            stack.enter_context(patch.object(main, 'sb_patch_run', side_effect=self.patches))
            stack.enter_context(patch.object(main, 'sb_patch_stage', side_effect=self.stage_patches))
            if not actual_settings:
                stack.enter_context(patch.object(main, 'population_replacement_settings', return_value=SETTINGS))
            assignment = stack.enter_context(patch.object(main, 'stage_assignment', return_value={'log': 'Supplied Assignment'}))
            generation = stack.enter_context(patch.object(main, 'generate_package', side_effect=lambda **_: self.seed.generate_files()))
            attributes = stack.enter_context(patch.object(main, 'resolve_zone_attributes', return_value=(self.f.zone_payload(self.f.consumer_id), {})))
            if fail_network:
                stack.enter_context(patch.dict(sys.modules, {'aequilibrae': SimpleNamespace(Project=SuppliedProject)}))
                stack.enter_context(patch.object(main, 'install_fresh_osm_modes'))
            else:
                stack.enter_context(patch.object(main, 'stage_setup', return_value={'log': 'Supplied complete native network'}))
            self.assertTrue(main.process_stage(copy.deepcopy(stage)))
            self.last_assignment_calls = assignment.call_count
            return generation.call_count, attributes.call_count

    def prepare_failed_original(self, *, actual_settings=False):
        original = self.f.tables['model_runs'][1]
        original['run_title'] = 'Original prospective source'
        stage = self.f.tables['model_run_stages'][1]
        stage['log_tail'] = None
        counts = self.controller(stage, fail_network=True, actual_settings=actual_settings)
        self.assertEqual(counts[0], 1)
        self.assertEqual(original['status'], 'failed')
        self.assertIn('502', stage['error_message'])
        self.assertEqual(len(self.registrations), 1)
        self.assertEqual(self.artifacts, [])
        return original, stage

    def new_run(self, original, stage):
        registration = self.registrations[0]
        run = copy.deepcopy(original)
        run.update(id=self.new_id, status='running', run_title='Explicit new replacement')
        run['input_snapshot_json']['commonPopulation'] = {
            'schema': 'openplan.common-population-request.v1', 'custody': 'legacy_stage_snapshot',
            'mode': 'restore_checkpoint', 'comparisonPolicy': 'fixed_population_auto_trip_change',
            'sourceProfile': self.f.profile, 'source': self.f.reference,
            'checkpoint': {'id': registration['request_id'], 'sha256': registration['checkpoint_sha256']}}
        successor = copy.deepcopy(stage)
        successor.update(id=self.new_stage, run_id=self.new_id, status='running', error_message=None)
        self.f.tables['model_runs'].append(run)
        self.f.tables['model_run_stages'].append(successor)
        for number, name in ((403, 'Network Assignment'), (404, 'Artifact Extraction')):
            descendant = copy.deepcopy(successor)
            descendant.update(id=identity(number), stage_name=name, status='queued', sort_order=number - 401)
            self.f.tables['model_run_stages'].append(descendant)
        return run, successor

    def test_actual_controller_retains_before_later_osm_failure_then_new_controller_copies_without_generation(self):
        original, stage = self.prepare_failed_original()
        before_run, before_stage = copy.deepcopy(original), copy.deepcopy(stage)
        directory = self.f.consumer_dir / 'common-population-commands'
        before_journal = (directory / 'model-commands.sqlite3').read_bytes()
        before_files = package.package_inventory(self.f.consumer_dir / 'package')
        _, successor = self.new_run(original, stage)
        generated, attributes = self.controller(successor, fail_network=False)
        self.assertEqual((generated, attributes), (0, 0))
        self.assertEqual(original, before_run)
        self.assertEqual(stage, before_stage)
        self.assertEqual((directory / 'model-commands.sqlite3').read_bytes(), before_journal)
        self.assertEqual(package.package_inventory(self.f.root / 'runs' / self.new_id / 'package'), before_files)
        self.assertEqual(len(self.artifacts), 7)
        self.assertEqual({row['run_id'] for row in self.artifacts}, {self.new_id})
        for row in self.artifacts:
            self.assertEqual(row['metadata_json']['replacement'], replacement.lineage(self.registrations[0]))
            self.assertEqual(row['metadata_json']['scientific_acceptance'], 'unassessed')
        self.assertEqual(successor['status'], 'succeeded')
        self.assertTrue((self.f.root / 'runs' / self.new_id / 'state.json').is_file())

    def test_changed_registered_bytes_refuse_before_network_or_generation(self):
        original, stage = self.prepare_failed_original()
        registration = self.registrations[0]
        snapshot = self.f.consumer_dir / 'population-checkpoints' / registration['request_id'] / 'files' / 'od_trip_matrix.csv'
        snapshot.write_bytes(snapshot.read_bytes() + b'changed')
        _, successor = self.new_run(original, stage)
        generated, attributes = self.controller(successor, fail_network=False)
        self.assertEqual((generated, attributes), (0, 0))
        self.assertEqual(self.artifacts, [])
        self.assertNotEqual(successor['status'], 'succeeded')

    def test_managed_and_mirror_are_explicit_refusals(self):
        with self.assertRaisesRegex(ValueError, 'managed_unsupported'):
            replacement.require_local('managed_attempt')
        with patch.dict(os.environ, {'OPENPLAN_HOSTED_ARTIFACT_MIRROR': '1'}), self.assertRaisesRegex(ValueError, 'mirror_unsupported'):
            replacement.require_local('legacy_stage_snapshot')

    def transit_assignment_case(self, change=None):
        """Use the real settings helper at registration, restore and Assignment."""
        first, second, bundled = [self.f.root / name for name in ('feed-a.zip', 'feed-b.zip', 'bundled.zip')]
        # Supplied archive bytes are fingerprinted, never parsed as a real feed.
        first.write_bytes(b'supplied archive A')
        second.write_bytes(first.read_bytes())
        bundled.write_bytes(b'supplied bundled archive')
        url = 'https://operator.invalid/a.zip?token=fixture-private-A' if change == 'url' else ''
        path = '' if change in ('url', 'bundled') else str(first)
        with patch.dict(os.environ, {'GTFS_URL': url, 'GTFS_PATH': path, 'GTFS_DISCOVER': '0',
                'GTFS_CACHE_DIR': str(self.f.root / 'url-cache')}), \
                patch.object(main, 'GTFS_DISCOVER', False), \
                patch.object(main.gtfs_skim, '_DEFAULT_GTFS_PATH', str(bundled)), \
                patch.object(main.gtfs_skim, 'discover_feed', side_effect=AssertionError('Unexpected settings discovery')), \
                patch.object(main.gtfs_skim, 'acquire_feed_archive', side_effect=AssertionError('Unexpected settings download')):
            original, stage = self.prepare_failed_original(actual_settings=True)
            _, successor = self.new_run(original, stage)
            self.controller(successor, fail_network=False, actual_settings=True)
            self.assertEqual(successor['status'], 'succeeded')
            registered = self.registrations[0]['facts']['settings']['transit_policy']
            if change == 'url':
                self.assertEqual(registered['state'], 'operator_url')
                self.assertEqual(registered['archive_state'], 'unresolved_remote_or_url_cache')
                os.environ['GTFS_URL'] = 'https://operator.invalid/b.zip?token=fixture-private-B'
            elif change == 'path':
                os.environ['GTFS_PATH'] = str(second)
            elif change == 'bytes':
                first.write_bytes(b'supplied changed archive A')
            elif change == 'bundled':
                self.assertEqual(registered['state'], 'bundled_default')
                bundled.write_bytes(b'supplied changed bundled archive')
            assignment = next(row for row in self.f.tables['model_run_stages']
                if row['run_id'] == self.new_id and row['stage_name'] == 'Network Assignment')
            self.controller(assignment, fail_network=False, actual_settings=True)
            if change is None:
                self.assertEqual(self.last_assignment_calls, 1)
                self.assertEqual(assignment['status'], 'succeeded')
            else:
                self.assertEqual(self.last_assignment_calls, 0)
                self.assertEqual(assignment['status'], 'failed')
                self.assertIn('effective settings differ', assignment['error_message'])
            serialized = journal.canonical(self.registrations[0]['facts']['settings'])
            for sensitive in ('fixture-private-A', 'fixture-private-B', 'token=', str(first), str(bundled)):
                self.assertNotIn(sensitive, serialized)

    def test_actual_transit_settings_unchanged_source_survives_to_assignment(self):
        self.transit_assignment_case()

    def test_actual_transit_settings_changed_effective_url_refuses_before_assignment(self):
        self.transit_assignment_case('url')

    def test_actual_transit_settings_changed_url_refuses_before_replacement_copy(self):
        with patch.dict(os.environ, {'GTFS_URL': 'https://operator.invalid/a.zip', 'GTFS_PATH': '',
                'GTFS_CACHE_DIR': str(self.f.root / 'cache')}):
            original, stage = self.prepare_failed_original(actual_settings=True)
            _, successor = self.new_run(original, stage)
            os.environ['GTFS_URL'] = 'https://operator.invalid/b.zip'
            generated, attributes = self.controller(successor, fail_network=False, actual_settings=True)
            self.assertEqual((generated, attributes), (0, 0))
            self.assertEqual(successor['status'], 'failed')
            self.assertIn('effective settings differ', successor['error_message'])
            self.assertFalse((self.f.root / 'runs' / self.new_id / 'package').exists())
            self.assertEqual(self.artifacts, [])

    def test_actual_transit_settings_changed_effective_path_refuses_before_assignment(self):
        self.transit_assignment_case('path')

    def test_actual_transit_settings_changed_same_path_bytes_refuse_before_assignment(self):
        self.transit_assignment_case('bytes')

    def test_actual_transit_settings_changed_bundled_bytes_refuse_before_assignment(self):
        self.transit_assignment_case('bundled')

    def test_actual_transit_settings_preserve_workspace_precedence_and_explicit_unresolved_states(self):
        bundled = self.f.root / 'bundled.zip'
        bundled.write_bytes(b'supplied fallback archive')
        version = main.gtfs_skim.TRANSIT_FEED_STAMP_VERSION
        selected = {'input_snapshot_json': {'transitFeed': {'version': version,
            'status': 'selected', 'feedVersionId': identity(601)}}}
        automatic = {'input_snapshot_json': {'transitFeed': {'version': version, 'status': 'not_selected'}}}
        refused = {'input_snapshot_json': {'transitFeed': {'version': version,
            'status': 'selected', 'feedVersionId': 'not-a-version'}}}
        with patch.object(main, 'SUPABASE_URL', self.f.writer.base_url), \
                patch.dict(os.environ, {'OPENPLAN_DEPLOYMENT_ID': DEPLOYMENT, 'GTFS_URL': 'https://user:fixture-password@operator.invalid/a?key=fixture-private',
                'GTFS_PATH': str(self.f.root / 'ignored.zip'), 'GTFS_CACHE_DIR': str(self.f.root / 'cache')}), \
                patch.object(main, 'GTFS_DISCOVER', True), \
                patch.object(main.gtfs_skim, '_DEFAULT_GTFS_PATH', str(bundled)), \
                patch.object(main.gtfs_skim, 'discover_feed', side_effect=AssertionError('Unexpected settings discovery')), \
                patch.object(main.gtfs_skim, 'acquire_feed_archive', side_effect=AssertionError('Unexpected settings download')):
            before = main.population_replacement_settings(selected)
            self.assertEqual(before['transit_policy']['state'], 'workspace_feed_version')
            self.assertEqual(before['transit_policy']['selection_state'], 'selected')
            os.environ.update(GTFS_URL='https://other.invalid/b', GTFS_PATH=str(self.f.root / 'also-ignored.zip'))
            self.assertEqual(main.population_replacement_settings(selected), before)
            self.assertEqual(main.population_replacement_settings(automatic)['transit_policy']['state'], 'operator_url')
            denied = main.population_replacement_settings(refused)['transit_policy']
            self.assertEqual(denied['selection_state'], 'unavailable')
            self.assertEqual(denied['fallback'], 'forbidden')
            os.environ.update(GTFS_URL='', GTFS_PATH='')
            unresolved = main.population_replacement_settings(automatic)['transit_policy']
            self.assertEqual(unresolved['state'], 'automatic_discovery_unresolved')
            self.assertEqual(unresolved['archive_state'], 'unresolved_remote_or_url_cache')
            self.assertEqual(unresolved['fallback_archive']['sha256'], hashlib.sha256(b'supplied fallback archive').hexdigest())
            os.environ['GTFS_URL'] = 'https://selected.invalid/a'
            os.environ['GTFS_PATH'] = str(bundled)
            url_first = main.population_replacement_settings(automatic)
            bundled.write_bytes(b'ignored by effective operator URL')
            self.assertEqual(main.population_replacement_settings(automatic), url_first)
            os.environ['GTFS_URL'] = ''
            missing = self.f.root / 'missing.zip'
            os.environ['GTFS_PATH'] = str(missing)
            unavailable = main.population_replacement_settings(automatic)
            self.assertEqual(unavailable['transit_policy']['archive']['state'], 'unavailable')
            missing.write_bytes(b'new archive must not silently replace unavailable bytes')
            self.assertNotEqual(main.population_replacement_settings(automatic), unavailable)
            encoded = journal.canonical(before)
            self.assertNotIn('fixture-password', encoded)
            self.assertNotIn('fixture-private', encoded)
            self.assertNotIn('https://user:', encoded)


class ReplacementCommandTests(unittest.TestCase):
    def test_cli_retains_exact_new_run_request_after_lost_reply(self):
        import tempfile
        import model_command_recovery as commands
        actor, workspace, model, run, stage, checkpoint, request_id, new_id = [identity(n) for n in range(510, 518)]
        state = {'workspace_id': workspace, 'model_id': model, 'run_id': run, 'status': 'failed',
                 'updated_at': '2026-10-18T00:00:00Z', 'attempt_managed': False,
                 'stages': [{'id': stage, 'status': 'failed', 'updated_at': '2026-10-18T00:00:00Z', 'active_attempt_id': None, 'attempt_managed': False}]}
        decision = {'requestId': request_id, 'decision': 'create_population_replacement', 'expectedState': state,
                    'checkpointId': checkpoint, 'checkpointSha256': 'a' * 64, 'reason': 'Exact saved population', 'acknowledgedNewRun': True}
        copies = []
        def post(url, **kwargs):
            self.assertTrue(url.endswith('/create_model_population_replacement'))
            body = copy.deepcopy(kwargs['json'])
            copies.append(body)
            if len(copies) == 1:
                raise TimeoutError('supplied commit and lost reply')
            return response({'schema': replacement.SCHEMA, 'request_id': request_id,
                'request_payload': {k[2:]: v for k, v in body.items() if k != 'p_request_id'},
                'replacement_run_id': new_id, 'engine_key': 'aequilibrae', 'outcome': 'replacement_created',
                'old_run_changed': False, 'model_resumed': False})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            saved = root / 'operator-copy.json'
            saved.write_text(json.dumps({'version': 1, 'scope': {'userId': actor, 'workspaceId': workspace, 'modelId': model, 'runId': run},
                'decision': decision, 'phase': 'pending', 'receipt': None}))
            argv = ['--journal', str(root / 'decision-journal'), '--base-url', 'https://bound.invalid',
                    '--deployment-id', DEPLOYMENT, '--replacement-request', str(saved)]
            with patch.dict(os.environ, {'OPENPLAN_RECOVERY_ACTOR_ID': actor, 'SUPABASE_SERVICE_ROLE_KEY': 'fixture-only'}), patch('requests.post', side_effect=post):
                self.assertEqual(commands.main(argv), 2)
                self.assertEqual(commands.main(argv), 0)
            self.assertEqual(copies[0], copies[1])
            stored = journal.read_existing(root / 'decision-journal', client.destination('https://bound.invalid', DEPLOYMENT), include_resolved=True)
            self.assertEqual(len(stored), 1)
            self.assertTrue(stored[0]['resolved'])
            self.assertEqual(stored[0]['response']['replacement_run_id'], new_id)


if __name__ == '__main__':
    unittest.main()
