"""A single archive miss is unavailable, not proof that no local feed exists."""
import ast
from pathlib import Path
import unittest
from unittest.mock import patch
import gtfs_skim as gs
import model_transit_skim as transit
import test_transit_feed_handoff as fixtures


class CoverageOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.los=gs.load_feed(raw=fixtures._feed_bytes(),source_name='Synthetic')
        self.settings=gs.TransitSkimSettings(.5,5,1.5,3)

    def skim(self,origin,covered=False):
        return transit.skim_prepared_transit(self.los,{'feed_origin':origin,'discovery_error':'Original catalog state'},
            fixtures.COVERED_LONS if covered else fixtures.ELSEWHERE_LONS,
            fixtures.COVERED_LATS if covered else fixtures.ELSEWHERE_LATS,settings=self.settings)

    def test_every_loaded_origin_miss_remains_unavailable(self):
        for origin in ('workspace_feed_version','operator_url','operator_path','discovered_catalog','bundled_default','bundled_after_catalog_unavailable'):
            with self.subTest(origin=origin),patch.object(gs,'transit_skim',side_effect=AssertionError('Skim on coverage miss')):
                result=self.skim(origin)
            self.assertEqual(result['transit_status'],'feed_unavailable');self.assertIsNone(result['skim'])
            self.assertEqual(result['metadata']['discovery_error'],'Original catalog state')

    def test_catalog_failure_and_selected_refusal_keep_distinct_reasons(self):
        self.assertEqual(self.skim('bundled_after_catalog_unavailable')['metadata']['no_feed_reason'],'feed_catalog_unavailable')
        self.assertEqual(self.skim('workspace_feed_version')['metadata']['no_feed_reason'],'selected_feed_has_no_stops_in_study_area')
        self.assertEqual(self.skim('operator_path')['metadata']['no_feed_reason'],'feed_has_no_stops_in_study_area')

    def test_covered_origins_compute_and_preserve_provenance(self):
        for origin in ('workspace_feed_version','operator_path','operator_url','discovered_catalog','bundled_default','bundled_after_catalog_unavailable'):
            result=self.skim(origin,covered=True)
            self.assertEqual(result['transit_status'],'modeled');self.assertTrue(result['skim']['available'][0,1])
            self.assertEqual(result['metadata']['feed_origin'],origin)
            self.assertIn('Original catalog state',result['metadata']['discovery_error'])

    def test_unknown_origin_is_not_given_a_coverage_claim(self):
        with self.assertRaises(ValueError):self.skim('unknown-origin',covered=True)

    def test_actual_assignment_miss_branch_uses_shared_refusal(self):
        source=(Path(__file__).parent/'main.py').read_text();tree=ast.parse(source)
        stage=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='stage_assignment')
        branches=[n for n in ast.walk(stage) if isinstance(n,ast.If) and ast.unparse(n.test)=='not gtfs_skim.feed_covers(los, lons, lats)']
        self.assertEqual(len(branches),1)
        block=ast.Module(body=branches[0].body,type_ignores=[])
        for origin in ('operator_path','bundled_after_catalog_unavailable'):
            namespace={'transit_coverage_refusal':transit.transit_coverage_refusal,'feed_origin':origin,'transit_status':'modeled','transit_los_meta':{},'log':''}
            exec(compile(block,'main.py','exec'),namespace)
            self.assertEqual(namespace['transit_status'],'feed_unavailable')
            self.assertEqual(namespace['transit_los_meta']['no_feed_reason'],transit.transit_coverage_refusal(origin)['no_feed_reason'])
            self.assertTrue(namespace['log'])


if __name__=='__main__':unittest.main()
