"""Entropy labels must survive retention and remain bound to every roster row."""
import unittest
import test_common_population as fixture
import common_population as common


class EntropyRetentionTests(unittest.TestCase):
    setUp = fixture.CommonPopulationTests.setUp
    retain = fixture.CommonPopulationTests.retain
    read = fixture.CommonPopulationTests.read
    def test_entropy_roundtrip_and_mislabeled_rows(self):
        self.result['method'] = 'acs_pums_seed_entropy_balancing'
        with self.assertRaisesRegex(common.CommonPopulationError, 'identity/method'):
            self.retain()
        self.household['synthesis_method'] = self.result['method']
        self.person['synthesis_method'] = self.result['method']
        loaded = self.read(self.retain())
        self.assertEqual(loaded['diagnostics']['method'], self.result['method'])
        self.assertEqual(loaded['households'][0]['synthesis_method'], self.result['method'])

    def test_unknown_method_refuses_even_with_matching_roster(self):
        self.result['method'] = 'unverified_method'
        self.household['synthesis_method'] = 'unverified_method'
        self.person['synthesis_method'] = 'unverified_method'
        with self.assertRaisesRegex(common.CommonPopulationError, 'Unknown retained'):
            self.retain()

class EntropyOrchestrationTests(unittest.TestCase):
    def test_explicit_method_routes_fitting_and_roster_labels(self):
        import test_synthetic_population as f
        from synthetic_population import synthesize_study_area, SyntheticPopulationError
        from unittest.mock import patch
        row = f.acs_row(0, 30, 20, 40)
        row['B08202_004E'] = '10'
        row['B08202_003E'] = '20'
        kwargs = f.fake_fetches({f.TRACT_A: row})
        with patch('population_entropy.EntropyFitter.__call__', autospec=True) as call:
            from population_synthesis import ZoneFit
            call.return_value = ZoneFit(1, [10, 20], 1, True, 0, None, [])
            result = synthesize_study_area([f.zone(1, f.TRACT_A)], census_api_key='', fitting_method='entropy',
                                          fitting_max_iterations=321, **kwargs)
            self.assertEqual(call.call_count, 1)
            self.assertEqual(call.call_args.kwargs['max_iterations'], 321)
        self.assertEqual(result['method'], 'acs_pums_seed_entropy_balancing')
        self.assertTrue(all(r['synthesis_method'] == result['method'] for r in result['households'] + result['persons']))
        with self.assertRaisesRegex(SyntheticPopulationError, 'Unknown population fitting method'):
            synthesize_study_area([f.zone(1, f.TRACT_A)], census_api_key='', fitting_method='unknown', **kwargs)

    def test_failed_fit_exclusion_preserves_diagnostics(self):
        import test_synthetic_population as f
        from synthetic_population import synthesize_study_area
        from unittest.mock import patch
        from population_synthesis import ZoneFit
        kwargs = f.fake_fetches({f.TRACT_A: f.acs_row(0, 30, 20, 40)})
        for fit in [ZoneFit(1, [10, 20], 1, False, .5, 'age:adult', []),
                    ZoneFit(1, [10, 20], 1, True, 0, None, [{'control': 'age', 'category': 'adult'}]),
                    ZoneFit(1, [10, 20], 1, True, 0, None, [], [{'control': 'age', 'category': 'adult'}])]:
            with patch('population_entropy.EntropyFitter.__call__', return_value=fit):
                result = synthesize_study_area([f.zone(1, f.TRACT_A)], census_api_key='', fitting_method='entropy',
                                              exclude_failed_fits=True, **kwargs)
            self.assertEqual(result['households'], [])
            self.assertEqual(result['persons'], [])
            self.assertEqual(len(result['zone_fits']), 1)
            self.assertEqual(result['source_controls']['fit_exclusions'][0]['excluded_realized_households'], 30)

    def test_controlled_integerization_is_explicit_and_preserves_counts(self):
        import test_synthetic_population as f
        from synthetic_population import synthesize_study_area, SyntheticPopulationError
        row = f.acs_row(0, 30, 20, 40)
        row.update(B08202_004E='10', B08202_003E='20')
        kwargs = f.fake_fetches({f.TRACT_A: row})
        result = synthesize_study_area([f.zone(1, f.TRACT_A)], census_api_key='', fitting_method='entropy',
                                      integerization_method='controlled', **kwargs)
        self.assertEqual(result['summary']['households'], 30)
        self.assertEqual(result['summary']['persons'], 60)
        self.assertEqual(sum(p['age']<18 for p in result['persons']),20)
        for method in ['controlled', 'unknown']:
            with self.assertRaisesRegex(SyntheticPopulationError,'Unsupported integerization'):
                synthesize_study_area([f.zone(1, f.TRACT_A)], census_api_key='', integerization_method=method, **kwargs)


if __name__ == '__main__':
    unittest.main()
