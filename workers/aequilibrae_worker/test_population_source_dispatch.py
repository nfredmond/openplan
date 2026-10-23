"""Actual worker profile/dispatch seams with supplied transport and storage.

These controls do not run synthesis, enroll production sources or prove images,
worker custody, provider authenticity, ActivitySim compatibility or accuracy.
"""
import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT_DIR = Path(__file__).resolve().parents[2] / 'scripts/modeling'
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
import population_source_registry as registry
import common_population as common
import census_pums as cp
import model_common_population_handoff as handoff
import model_common_population_package as package


class PopulationSourceDispatchTests(unittest.TestCase):
    def inputs(self, profile=None, descriptor=None):
        profile = profile or registry._catalog()[1]['profile']
        descriptor = descriptor or registry.registered_source_descriptor(profile)
        run_id = '11111111-1111-4111-8111-111111111111'
        stamp = {'status': 'supplied', 'storageRef': 'storage://run-artifacts/model-runs/' + run_id + '/zone-attributes.json',
            'sourceId': descriptor['id'], 'vintage': descriptor['vintage']}
        run = {'id': run_id, 'input_snapshot_json': {'zoneAttributes': stamp}}
        payload = {'version': 'zone-attributes-v1', 'run_id': run_id,
            'source': {'id': descriptor['id'], 'vintage': descriptor['vintage'], 'retrieval_url': descriptor['retrievalUrl']},
            'tables': {'demographics': {'status': 'supplied'}}}
        return run, payload

    def test_actual_handoff_matches_registered_descriptor_and_preserves_entire_payload(self):
        for entry in registry._catalog():
            run, payload = self.inputs(entry['profile'])
            before = copy.deepcopy((run, payload))
            self.assertEqual(handoff._zone_payload(run, entry['profile'], payload), payload)
            self.assertEqual((run, payload), before)
        run, payload = self.inputs()
        faults = [lambda r, p: p.update(run_id='foreign'), lambda r, p: p.update(version='future'),
            lambda r, p: r['input_snapshot_json']['zoneAttributes'].update(status='unavailable'),
            lambda r, p: r['input_snapshot_json']['zoneAttributes'].update(storageRef='storage://run-artifacts/foreign'),
            lambda r, p: r['input_snapshot_json']['zoneAttributes'].update(sourceId='unknown'),
            lambda r, p: r['input_snapshot_json']['zoneAttributes'].update(vintage='2022'),
            lambda r, p: p['source'].update(id='unknown'), lambda r, p: p['source'].update(vintage='2022'),
            lambda r, p: p['source'].update(retrieval_url='https://unregistered.invalid'),
            lambda r, p: p.update(tables=[]), lambda r, p: p['tables'].update(demographics=[]),
            lambda r, p: p['tables']['demographics'].update(status='unavailable')]
        for fault in faults:
            damaged_run, damaged_payload = copy.deepcopy((run, payload))
            fault(damaged_run, damaged_payload)
            with self.subTest(fault=fault), self.assertRaises(handoff.PopulationHandoffError):
                handoff._zone_payload(damaged_run, registry._catalog()[1]['profile'], damaged_payload)

    def test_generation_and_restoration_requests_require_canonical_retained_profiles(self):
        profile = registry._catalog()[1]['profile']
        for mode in ('generate', 'restore_checkpoint'):
            request = {'schema': handoff.REQUEST_SCHEMA, 'mode': mode, 'comparisonPolicy': handoff.POLICY,
                'custody': 'managed_attempt' if mode == 'generate' else 'legacy_stage_snapshot', 'sourceProfile': profile}
            if mode == 'restore_checkpoint':
                request.update(checkpoint={'id': '11111111-1111-4111-8111-111111111111', 'sha256': 'a' * 64}, source=None)
            self.assertEqual(handoff._request({'commonPopulation': request}, common), request)
            for bad in ({**profile, 'extra': True}, {**profile, 'pums_endpoint': profile['pums_endpoint'] + '/'},
                    {**profile, 'puma_fields': {'2020': 'PUMA20'}}, {'adapter': 'unknown'}):
                damaged = {**request, 'sourceProfile': bad}
                before = copy.deepcopy(damaged)
                with self.assertRaises(common.CommonPopulationError):
                    handoff._request({'commonPopulation': damaged}, common)
                self.assertEqual(damaged, before)

    def test_descriptor_lookup_is_used_by_actual_handoff_for_injected_pure_source(self):
        profile = {'adapter': 'pure_test_population', 'revision': 'v1'}
        descriptor = {'id': 'pure_test', 'vintage': 'v1', 'retrievalUrl': 'https://source.invalid/fixture'}
        pure = registry.PopulationSourceRegistry([{'id': 'test', 'profile': profile, 'descriptor': descriptor,
            'capabilities': {'retained_validation': 'supported'}}])
        run, payload = self.inputs(profile, descriptor)
        with patch.object(registry, 'PRODUCTION_REGISTRY', pure):
            self.assertEqual(handoff._zone_payload(run, profile, payload), payload)
        with self.assertRaises(registry.PopulationSourceError):
            handoff._zone_payload(run, profile, payload)

    def test_unregistered_unassessed_and_missing_producer_refuse_before_files_or_fetch(self):
        profile = {'adapter': 'pure_test_population', 'revision': 'v1'}
        entry = {'id': 'test', 'profile': profile, 'descriptor': {'id': 'pure_test', 'vintage': 'v1', 'retrievalUrl': 'https://source.invalid'},
            'capabilities': {'retained_validation': 'supported'}}
        for capabilities, producers in [({}, {}), (entry['capabilities'], {'pure_test_population': Mock()}),
                ({**entry['capabilities'], 'aequilibrae_production': 'supported'}, {})]:
            pure = registry.PopulationSourceRegistry([{**entry, 'capabilities': capabilities}], producers)
            with tempfile.TemporaryDirectory() as directory, patch.object(registry, 'PRODUCTION_REGISTRY', pure), patch.object(cp, '_get_json') as fetch:
                zones, algorithm = Mock(), Mock()
                with self.assertRaises(ValueError):
                    package.prepare_generated_population(zones, directory, {'mode': 'generate', 'source_profile': profile},
                        coverage_note={}, census_api_key='fixture-only', synthesize=algorithm)
                zones.to_dict.assert_not_called(); zones.to_csv.assert_not_called()
                algorithm.assert_not_called(); fetch.assert_not_called()
                for producer in producers.values(): producer.assert_not_called()
                self.assertEqual(list(Path(directory).iterdir()), [])
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(common.CommonPopulationError):
            package.prepare_generated_population(Mock(), directory, {'mode': 'generate', 'source_profile': profile},
                coverage_note={}, census_api_key='fixture-only')

    def test_actual_package_dispatches_injected_producer_with_storage_boundary_supplied(self):
        profile = {'adapter': 'pure_test_population', 'revision': 'v1'}
        entry = {'id': 'test', 'profile': profile, 'descriptor': {'id': 'pure_test', 'vintage': 'v1', 'retrievalUrl': 'https://source.invalid'},
            'capabilities': {'retained_validation': 'supported', 'aequilibrae_production': 'supported'}}
        result = {'supplied': 'producer result'}
        producer = Mock(return_value=result)
        pure = registry.PopulationSourceRegistry([entry], {'pure_test_population': producer})
        rows = [{'supplied': 'zone fixture'}]
        zones = Mock(); zones.to_dict.return_value = rows
        zones.to_csv.side_effect = lambda path, **kwargs: Path(path).write_text('fixture\n')
        retained = {'supplied': 'retained boundary'}
        with tempfile.TemporaryDirectory() as directory, patch.object(registry, 'PRODUCTION_REGISTRY', pure), \
                patch.object(common, 'retain_population', return_value={'fixture': 'descriptor'}) as retain, \
                patch.object(common, 'read_common_population', return_value=retained), \
                patch.object(common, 'retained_school_enrollment'), patch.object(cp, '_get_json') as fetch:
            self.assertEqual(package.prepare_generated_population(zones, directory,
                {'mode': 'generate', 'source_profile': profile, 'source_record': {'supplied': 'authority'}},
                coverage_note={}, census_api_key='fixture-only'), retained)
            producer.assert_called_once_with(rows, census_api_key='fixture-only', synthesize=None,
                source_profile=profile, include_school_enrollment=True)
            self.assertIs(retain.call_args.args[2], result)
            self.assertEqual(retain.call_args.kwargs['source_profile'], profile)
            fetch.assert_not_called()
        with self.assertRaises(registry.PopulationSourceError):
            registry.registered_population_producer(profile)


if __name__ == '__main__':
    unittest.main()
