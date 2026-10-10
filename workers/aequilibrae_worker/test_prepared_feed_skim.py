"""Real synthetic GTFS skims after preparation, without another source read."""
import copy
import unittest
from unittest.mock import patch
import test_transit_feed_handoff as fixtures
main=fixtures.main


class PreparedFeedTests(unittest.TestCase):
    def prepare(self):
        fake=fixtures._FakeRequests(version_rows=[fixtures._version_row()],object_bytes=fixtures._feed_bytes())
        return fixtures._with_requests(fake,lambda:main.load_selected_feed_version(fixtures.VERSION_ID,fixtures.WORKSPACE))

    def test_prepared_skim_preserves_input_and_ingest_facts_without_loading(self):
        los,meta=self.prepare();original=copy.deepcopy(meta)
        with patch.object(main,'load_selected_feed_version',side_effect=AssertionError('Unexpected reload')),patch.object(main.requests,'get',side_effect=AssertionError('Unexpected HTTP')):
            result,skim,log=main.skim_prepared_feed_version(los,meta,fixtures.COVERED_LONS,fixtures.COVERED_LATS)
        self.assertEqual(meta,original)
        for key in main._INGEST_AUTHORITATIVE_FEED_KEYS:
            self.assertEqual(result[key],original[key])
        self.assertEqual(result['feed_checksum_sha256'],original['feed_checksum_sha256'])
        self.assertTrue(skim['available'][0,1]);self.assertIn('Transit LOS from Test Transit',log)

    def test_existing_entrypoint_delegates_loaded_feed_and_options(self):
        los,meta=self.prepare();sentinel=object()
        with patch.object(main,'load_selected_feed_version',return_value=(los,meta)) as load,patch.object(main,'skim_prepared_feed_version',return_value=sentinel) as skim:
            result=main.skim_selected_feed_version(fixtures.VERSION_ID,fixtures.WORKSPACE,fixtures.COVERED_LONS,fixtures.COVERED_LATS,deadline=123,feed_origin='synthetic-origin')
        self.assertIs(result,sentinel)
        load.assert_called_once_with(fixtures.VERSION_ID,fixtures.WORKSPACE)
        skim.assert_called_once_with(los,meta,fixtures.COVERED_LONS,fixtures.COVERED_LATS,deadline=123,feed_origin='synthetic-origin')

    def test_prepared_feed_outside_area_keeps_selected_feed_refusal(self):
        los,meta=self.prepare()
        with self.assertRaises(main.gtfs_skim.SelectedFeedError) as caught:
            main.skim_prepared_feed_version(los,meta,fixtures.ELSEWHERE_LONS,fixtures.ELSEWHERE_LATS)
        self.assertEqual(caught.exception.no_feed_reason,'selected_feed_has_no_stops_in_study_area')

    def test_expired_deadline_refuses_prepared_skim(self):
        los,meta=self.prepare()
        with self.assertRaises(main.gtfs_skim.GtfsTimeout):
            main.skim_prepared_feed_version(los,meta,fixtures.COVERED_LONS,fixtures.COVERED_LATS,deadline=0)


if __name__=='__main__':unittest.main()
