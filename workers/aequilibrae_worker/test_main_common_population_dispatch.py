"""Ordinary entry and real population copies; supplied network/DB boundaries only."""
from contextlib import ExitStack
import copy
import os
from pathlib import Path
from unittest.mock import Mock, patch
import unittest

# Import the actual dispatcher without loading operator credentials.
with patch('dotenv.load_dotenv'), patch.dict(os.environ, {
    'SUPABASE_URL': 'https://bound.invalid', 'SUPABASE_SERVICE_ROLE_KEY': 'fixture-only'}):
    import main
import data_pipeline
import model_attempt_writer
import test_model_common_population_handoff as supplied
response = supplied.response


class OrdinaryPopulationDispatchTests(unittest.TestCase):
    def setUp(self):
        self.fixture = supplied.PopulationHandoffTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.use_stage_snapshot()
        root_patch = patch.object(main, 'RUN_WORK_ROOT', str(self.fixture.root))
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def test_normal_dispatch_reuses_real_population_and_publishes_exact_seven_files(self):
        f = self.fixture
        stage = copy.deepcopy(f.tables['model_run_stages'][1])
        stage['status'] = 'queued'
        run = copy.deepcopy(f.tables['model_runs'][1])
        published, patches = [], []
        def get(url, **kwargs):
            if '?' in url:
                # The normal dispatcher sees later work, so this is not parent completion.
                return response([{'status': 'queued'}])
            return f.get(url, **kwargs)
        def artifact(payload, **kwargs):
            published.append((copy.deepcopy(payload), kwargs))
            return {'id': 'supplied-receipt-id'}
        with ExitStack() as stack:
            values = {'RUN_WORK_ROOT': str(f.root), 'SUPABASE_URL': f.writer.base_url,
                      'SUPABASE_KEY': 'fixture-only'}
            for name, value in values.items():
                stack.enter_context(patch.object(main, name, value))
            stack.enter_context(patch.object(model_attempt_writer, 'current', return_value=None))
            stack.enter_context(patch.object(main, '_CUSTODY', Mock()))
            stack.enter_context(patch.object(main, 'sb_claim_stage', return_value=True))
            stack.enter_context(patch.object(main, 'sb_get_run', return_value=run))
            stack.enter_context(patch.object(main, 'sb_patch_run'))
            stack.enter_context(patch.object(main, 'sb_patch_stage', side_effect=lambda sid, value: patches.append(value)))
            stack.enter_context(patch.object(main, 'resolve_zone_attributes', return_value=(f.zone_payload(f.consumer_id), {})))
            stack.enter_context(patch.object(main.requests, 'get', side_effect=get))
            stack.enter_context(patch.object(main.requests, 'post', side_effect=f.post))
            stack.enter_context(patch.object(data_pipeline, 'fetch_lodes_od_by_tract_pair', return_value=({}, [], [])))
            stack.enter_context(patch.object(main, 'stage_setup', return_value={'log': 'Supplied engine boundary'}))
            stack.enter_context(patch.object(main, 'sb_record_retained_artifact', side_effect=artifact))
            self.assertTrue(main.process_stage(stage))
        self.assertEqual(len(published), 7)
        self.assertEqual({p['artifact_type'] for p, _ in published}, {
            'common_population', 'common_population_households', 'common_population_persons',
            'common_population_selected_zones', 'common_population_diagnostics',
            'common_population_source_manifest', 'common_population_source_zone_attributes'})
        for payload, call in published:
            self.assertEqual(payload['metadata_json']['custody'], 'legacy_stage_snapshot')
            self.assertEqual(payload['metadata_json']['scientific_acceptance'], 'unassessed')
            self.assertEqual(payload['metadata_json']['origin'], f.reference)
            self.assertEqual(call['workspace_id'], f.workspace)
            self.assertEqual(Path(call['journal_dir']), f.consumer_dir / 'common-population-commands')
            self.assertEqual(Path(payload['file_url'][8:]).read_bytes(),
                             (f.source_dir / Path(payload['file_url']).name).read_bytes())
        self.assertTrue(any(value.get('status') == 'succeeded' for value in patches))
        self.assertFalse(any(value.get('status') == 'failed' for value in patches))
        self.assertTrue((f.consumer_dir / 'state.json').is_file())

    def test_managed_request_without_bound_writer_cannot_enter_ordinary_reader(self):
        f = self.fixture
        run = copy.deepcopy(f.tables['model_runs'][1])
        run['input_snapshot_json']['commonPopulation']['custody'] = 'managed_attempt'
        with patch.object(model_attempt_writer, 'current', return_value=None), \
             patch('model_common_population_handoff.StagePopulationReader') as ordinary:
            with self.assertRaisesRegex(RuntimeError, 'actual bound attempt'):
                main.population_setup_reader(f.consumer_id, run, str(f.consumer_dir), stage_id=f.consumer_stage)
            ordinary.assert_not_called()

    def test_ordinary_request_with_bound_attempt_or_unconfirmed_flag_refuses(self):
        f = self.fixture
        run = copy.deepcopy(f.tables['model_runs'][1])
        with patch.object(model_attempt_writer, 'current', return_value=Mock()):
            with self.assertRaisesRegex(RuntimeError, 'actual invocation'):
                main.population_setup_reader(f.consumer_id, run, str(f.consumer_dir), stage_id=f.consumer_stage)
        run['attempt_managed'] = None
        with patch.object(model_attempt_writer, 'current', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'actual invocation'):
                main.population_setup_reader(f.consumer_id, run, str(f.consumer_dir), stage_id=f.consumer_stage)


if __name__ == '__main__':
    unittest.main()
