"""Pure source/capability controls. No model, provider or scientific acceptance."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
import population_source_registry as registry
import common_population as common
import census_pums as cp

CANONICAL_2023 = {'adapter': 'us_census_acs5_pums',
    'acs_summary_endpoint': 'https://api.census.gov/data/2023/acs/acs5',
    'pums_endpoint': 'https://api.census.gov/data/2023/acs/acs5/pums',
    'sample_years': [2019, 2023], 'income_dollar_year': 2023, 'puma_fields': {'2020': 'PUMA'}}
CANONICAL_2022 = {'adapter': 'us_census_acs5_pums',
    'acs_summary_endpoint': 'https://api.census.gov/data/2022/acs/acs5',
    'pums_endpoint': 'https://api.census.gov/data/2022/acs/acs5/pums',
    'sample_years': [2018, 2022], 'income_dollar_year': 2022, 'puma_fields': {'2020': 'PUMA20', '2010': 'PUMA10'}}


class PopulationSourceRegistryTests(unittest.TestCase):
    def test_exact_construction_and_frozen_sql_projection(self):
        entries = registry._catalog()
        self.assertEqual([e['profile'] for e in entries], [CANONICAL_2022, CANONICAL_2023])
        for profile in (CANONICAL_2022, CANONICAL_2023):
            self.assertEqual(common.census_source_profile(profile['acs_summary_endpoint'], profile['pums_endpoint']), profile)
            self.assertEqual(common.validate_source_profile(profile, canonical=True), profile)
            vintage = cp.census_vintage_profile(profile['acs_summary_endpoint'], profile['pums_endpoint'])
            self.assertEqual((vintage.first_year, vintage.final_year, dict(vintage.puma_fields)),
                (profile['sample_years'][0], profile['income_dollar_year'], profile['puma_fields']))
        projection = [{'profile': e['profile'], 'purposes': [p for p in registry.PURPOSES if e['capabilities'].get(p) == 'supported']} for e in entries]
        frozen = json.dumps(projection, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
        sql = (SCRIPT_DIR.parents[1] / 'openplan/supabase/migrations/20261022010004_model_common_population_profiles.sql').read_text()
        self.assertIn('$population_catalog$' + frozen + '$population_catalog$::pg_catalog.jsonb', sql)
        self.assertIn(hashlib.sha256(frozen.encode()).hexdigest(), sql)
        self.assertEqual(registry.PRODUCTION_REGISTRY.validate(CANONICAL_2023, 'new_guided_launch'), CANONICAL_2023)
        with self.assertRaises(registry.PopulationSourceError) as result:
            registry.PRODUCTION_REGISTRY.validate(CANONICAL_2022, 'new_guided_launch')
        self.assertEqual(result.exception.status, 'unsupported')
        for purpose in registry.PURPOSES[1:]:
            self.assertEqual(registry.PRODUCTION_REGISTRY.validate(CANONICAL_2022, purpose), CANONICAL_2022)

    def test_missing_unknown_capability_objects_and_unknown_purposes_never_accept(self):
        entry = copy.deepcopy(registry._catalog()[1])
        del entry['capabilities']
        for candidate in (entry, {**entry, 'capabilities': None},
                {**entry, 'capabilities': {'retained_validation': 'unknown'}}):
            pure = registry.PopulationSourceRegistry([candidate])
            with self.assertRaises(registry.PopulationSourceError) as result:
                pure.validate(CANONICAL_2023)
            self.assertEqual(result.exception.status, 'unassessed')
        for purpose in (None, 'future'):
            with self.assertRaises(registry.PopulationSourceError) as result:
                registry.PRODUCTION_REGISTRY.validate(CANONICAL_2023, purpose)
            self.assertEqual(result.exception.status, 'unsupported')

    def test_exact_profile_refusals_preserve_raw_values(self):
        bad = [None, [], 'profile', {}, {**CANONICAL_2023, 'adapter': 'unknown'},
            {**CANONICAL_2023, 'income_dollar_year': 2024}, {**CANONICAL_2023, 'income_dollar_year': '2023'},
            {**CANONICAL_2023, 'income_dollar_year': True}, {**CANONICAL_2023, 'sample_years': [2018, 2023]},
            {**CANONICAL_2023, 'pums_endpoint': CANONICAL_2022['pums_endpoint']},
            {**CANONICAL_2023, 'puma_fields': CANONICAL_2022['puma_fields']},
            {**CANONICAL_2023, 'extra': True}, {**CANONICAL_2023, 'puma_fields': {'2020': 'PUMA', 'extra': 'PUMA'}}]
        for value in bad:
            with self.subTest(profile=value):
                before = copy.deepcopy(value)
                with self.assertRaises(common.CommonPopulationError):
                    common.validate_source_profile(value, canonical=True)
                self.assertEqual(value, before)
        value = copy.deepcopy(CANONICAL_2023)
        checked = common.validate_source_profile(value, canonical=True)
        self.assertIs(checked['puma_fields'], value['puma_fields'])

    def test_all_optional_slash_spellings_stay_lower_level_and_unmodified(self):
        for canonical in (CANONICAL_2022, CANONICAL_2023):
            for summary_slash, pums_slash in (('', '/'), ('/', ''), ('/', '/')):
                summary = canonical['acs_summary_endpoint'] + summary_slash
                microdata = canonical['pums_endpoint'] + pums_slash
                profile = common.census_source_profile(summary, microdata)
                self.assertEqual(profile, {**canonical, 'acs_summary_endpoint': summary, 'pums_endpoint': microdata})
                self.assertEqual(common.validate_source_profile(profile), profile)
                self.assertEqual(cp.census_vintage_profile(summary, microdata).final_year, canonical['income_dollar_year'])
                with self.assertRaises(common.CommonPopulationError):
                    common.validate_source_profile(profile, canonical=True)
                with self.assertRaises(registry.PopulationSourceError):
                    registry.registered_source_descriptor(profile)
                with self.assertRaises(registry.PopulationSourceError):
                    registry.registered_population_producer(profile)

    def test_unknown_product_refuses_before_any_provider_fetch(self):
        with patch.object(cp, '_get_json') as fetch:
            for summary, microdata in [(CANONICAL_2023['acs_summary_endpoint'], CANONICAL_2022['pums_endpoint']),
                ('https://api.census.gov/data/2024/acs/acs5', 'https://api.census.gov/data/2024/acs/acs5/pums')]:
                with self.assertRaises(cp.CensusPumsError):
                    cp.resolve_pumas((0, 0, 1, 1), acs5_url=summary, pums_url=microdata)
            fetch.assert_not_called()

    def test_census_compatibility_reader_refuses_unassessed_production_before_fetch(self):
        entry = copy.deepcopy(registry._catalog()[1])
        del entry['capabilities']['aequilibrae_production']
        with patch.object(registry, '_catalog', return_value=[entry]), patch.object(cp, '_get_json') as fetch:
            with self.assertRaises(cp.CensusPumsError):
                cp.resolve_pumas((0, 0, 1, 1), acs5_url=CANONICAL_2023['acs_summary_endpoint'], pums_url=CANONICAL_2023['pums_endpoint'])
            fetch.assert_not_called()

    def test_registered_production_dispatch_calls_selected_adapter_not_census(self):
        profile = {'adapter': 'pure_test', 'revision': 'v1'}
        descriptor = {'id': 'pure_test', 'vintage': 'v1', 'retrievalUrl': 'https://source.invalid/fixture'}
        entry = {'id': 'pure_test', 'profile': profile, 'descriptor': descriptor,
            'capabilities': {'retained_validation': 'supported', 'aequilibrae_production': 'supported'}}
        producer, wrong = Mock(return_value={'dispatch': 'pure_test'}), Mock(side_effect=AssertionError('Census fallback'))
        pure = registry.PopulationSourceRegistry([entry], {'pure_test': producer, registry.CENSUS_ADAPTER: wrong})
        rows = [{'supplied': 'no geographic producer claim'}]
        self.assertEqual(pure.producer(profile)(rows, source_profile=profile), {'dispatch': 'pure_test'})
        producer.assert_called_once_with(rows, source_profile=profile)
        wrong.assert_not_called()
        self.assertEqual(pure.descriptor(profile), descriptor)
        with self.assertRaises(registry.PopulationSourceError):
            registry.registered_population_producer(profile)
        for capabilities, expected in [({}, 'unassessed'), ({'aequilibrae_production': 'unassessed'}, 'unassessed'),
                ({'aequilibrae_production': 'unsupported'}, 'unsupported'), ({'aequilibrae_production': 'unavailable'}, 'unavailable')]:
            pure = registry.PopulationSourceRegistry([{**entry, 'capabilities': capabilities}], {'pure_test': producer})
            producer.reset_mock()
            with self.assertRaises(registry.PopulationSourceError) as result:
                pure.producer(profile)
            self.assertEqual(result.exception.status, expected)
            producer.assert_not_called()
        missing = registry.PopulationSourceRegistry([entry])
        with self.assertRaises(registry.PopulationSourceError) as result:
            missing.producer(profile)
        self.assertEqual(result.exception.status, 'unassessed')

    def test_production_census_dispatch_preserves_arguments_and_separate_consumer_capability(self):
        rows = [{'supplied': 'fixture'}]
        producer = registry.registered_population_producer(CANONICAL_2023)
        algorithm = Mock(return_value={'supplied': 'result'})
        self.assertEqual(producer(rows, source_profile=CANONICAL_2023, census_api_key='fixture-only',
            include_school_enrollment=True, synthesize=algorithm), {'supplied': 'result'})
        algorithm.assert_called_once_with(rows, source_profile=CANONICAL_2023, census_api_key='fixture-only', include_school_enrollment=True)
        entry = copy.deepcopy(registry._catalog()[1])
        entry['capabilities'] = {'retained_validation': 'supported'}
        pure = registry.PopulationSourceRegistry([entry], {registry.CENSUS_ADAPTER: algorithm})
        for purpose in ('new_guided_launch', 'activitysim_consumption'):
            with self.assertRaises(registry.PopulationSourceError) as result:
                pure.validate(CANONICAL_2023, purpose)
            self.assertEqual(result.exception.status, 'unassessed')


if __name__ == '__main__':
    unittest.main()
