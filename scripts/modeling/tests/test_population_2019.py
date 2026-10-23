"""2019 compatibility, not historical population fit or scientific acceptance."""
import copy
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import census_pums as cp
import activitysim_mtc_inputs as mtc
import population_source_registry as registry

SUMMARY = 'https://api.census.gov/data/2019/acs/acs5'
PUMS = SUMMARY + '/pums'
PROFILE = {'adapter': 'us_census_acs5_pums', 'acs_summary_endpoint': SUMMARY,
           'pums_endpoint': PUMS, 'sample_years': [2015, 2019],
           'income_dollar_year': 2019, 'puma_fields': {'2010': 'PUMA'}}


class Population2019(unittest.TestCase):
    def test_exact_profile_and_capabilities(self):
        self.assertEqual(registry.census_endpoint_profile(SUMMARY, PUMS), PROFILE)
        for name in ('retained_validation', 'aequilibrae_production', 'activitysim_consumption'):
            self.assertEqual(registry.PRODUCTION_REGISTRY.validate(PROFILE, name), PROFILE)
        with self.assertRaises(registry.PopulationSourceError):
            registry.PRODUCTION_REGISTRY.validate(PROFILE, 'new_guided_launch')
        for changes in ({'sample_years': [2019, 2019]}, {'puma_fields': {'2020': 'PUMA'}},
                        {'income_dollar_year': 2022}, {'pums_endpoint': PUMS.replace('2019', '2022')},
                        {'extra': True}):
            with self.assertRaises(registry.PopulationSourceError):
                registry.validate_source_profile({**PROFILE, **changes}, canonical=True)

    def test_2010_boundary_and_2019_microdata_predicate(self):
        payload = {'features': [{'attributes': {'STATE': '27', 'PUMA': '01234', 'NAME': 'Synthetic'}}]}
        with patch.object(cp, '_get_json', return_value=payload) as fetch:
            pumas = cp.resolve_pumas((-1, -1, 1, 1), acs5_url=SUMMARY, pums_url=PUMS)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(fetch.call_args.args[0], cp.PUMA_LAYERS['2010'])
        self.assertEqual(pumas[0]['vintage'], '2010')
        header = [*cp.PUMS_HOUSEHOLD_VARIABLES, *cp.PUMS_PERSON_VARIABLES, 'PUMA']
        values = {k: '1' for k in header}
        values.update(PUMA='01234', SERIALNO='synthetic', HINCP='50000', ADJINC='1080470')
        answer = [header, [values[k] for k in header]]
        with patch.object(cp, '_get_json', return_value=answer) as fetch:
            rows, report = cp.fetch_pums_person_rows(pumas, 'synthetic-not-a-key', acs5_url=SUMMARY, pums_url=PUMS)
        self.assertEqual(fetch.call_args.args[0], PUMS)
        self.assertEqual(fetch.call_args.args[1]['PUMA'], '01234')
        self.assertNotIn('PUMA10', fetch.call_args.args[1])
        self.assertAlmostEqual(cp.adjusted_income(rows[0]['HINCP'], rows[0]['ADJINC']), 54023.5)
        self.assertEqual(report['sources'][0]['person_records'], 1)
        # Reordered columns and an irrelevant metadata column are harmless.
        reordered = [list(reversed(r)) + ['extra' if i == 0 else 'metadata'] for i, r in enumerate(answer)]
        with patch.object(cp, '_get_json', return_value=reordered):
            same, _ = cp.fetch_pums_person_rows(pumas, 'synthetic-not-a-key', acs5_url=SUMMARY, pums_url=PUMS)
        self.assertEqual({k: same[0][k] for k in header}, rows[0])
        for broken in ([header, [*answer[1][:-1], '99999']], [['PUMA10' if k=='PUMA' else k for k in header], answer[1]]):
            with patch.object(cp, '_get_json', return_value=broken), self.assertRaises(cp.CensusPumsError):
                cp.fetch_pums_person_rows(pumas, 'synthetic-not-a-key', acs5_url=SUMMARY, pums_url=PUMS)
        with patch.object(cp, '_get_json') as fetch, self.assertRaises(cp.CensusPumsError):
            cp.fetch_pums_person_rows([{**pumas[0], 'vintage': '2020'}], 'synthetic-not-a-key', acs5_url=SUMMARY, pums_url=PUMS)
        fetch.assert_not_called()

    def test_2019_income_and_provenance_without_default_change(self):
        household = dict(household_id=1, home_zone_id=1, persons=2, workers=1, autos=1, income=100000, hht=1)
        rows, report = mtc.mtc_households([household], acs5_url=SUMMARY, pums_url=PUMS)
        self.assertEqual(rows[0]['income'], 67356)
        self.assertEqual(report['income_source_dollar_year'], 2019)
        self.assertEqual(report['income_dollar_year'], 2000)
        provenance = cp.seed_provenance([], {}, 1, {}, acs5_url=SUMMARY, pums_url=PUMS)
        self.assertEqual(provenance['acs_sample_years'], [2015, 2019])
        self.assertEqual(provenance['puma_fields'], {'2010': 'PUMA'})
        self.assertEqual(provenance['income_dollar_year'], 2019)
        for year, expected in [(2022, 58841), (2023, 56514)]:
            url = SUMMARY.replace('2019', str(year))
            converted, _ = mtc.mtc_households([household], acs5_url=url, pums_url=url+'/pums')
            self.assertEqual(converted[0]['income'], expected)
        with self.assertRaises(mtc.MtcInputError):
            mtc.check_income_vintage(SUMMARY, PUMS.replace('2019', '2023'))


if __name__ == '__main__':
    unittest.main()
