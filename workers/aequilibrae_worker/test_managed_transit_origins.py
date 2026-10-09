"""Parent preparation preserves feed-plan origin and failure distinctions."""
import os
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
import requests
import model_attempt_writer as managed
import model_transit_inputs as inputs
import test_managed_transit_retention as fixtures
import test_transit_feed_handoff as feeds
from test_model_skip_dispatch import aeq


class TransitOriginTests(unittest.TestCase):
    response=fixtures.ManagedTransitTests.response

    def setUp(self):
        fixtures.ManagedTransitTests.setUp(self)
        self.row=fixtures.ManagedTransitTests.prepare(self)
        self.row['model_runs']['input_snapshot_json']={}
        self.local=self.directory/'bundled.zip';self.local.write_bytes(self.raw)
        for context in (patch.dict(os.environ,{'GTFS_URL':'','GTFS_PATH':'','GTFS_CACHE_DIR':str(self.directory/'cache')}),
                        patch.object(aeq,'GTFS_DISCOVER',True),patch.object(aeq.gtfs_skim,'_DEFAULT_GTFS_PATH',str(self.local))):
            context.start();self.addCleanup(context.stop)

    def call(self,deadline=None):
        with managed.bind(self.writer),patch.object(aeq,'requests',self.fake):
            return aeq.prepare_managed_transit_for_engine(self.output,lons=feeds.COVERED_LONS,lats=feeds.COVERED_LATS,deadline=deadline)

    def metadata(self,result):
        self.assertEqual(result['status'],'retained')
        _,raw,meta,settings=inputs.consume(result['record'],self.root/'consumed-transit')
        self.assertEqual(raw,self.raw);self.post.assert_called_once()
        return meta

    def test_operator_path_does_not_discover(self):
        with patch.dict(os.environ,{'GTFS_PATH':str(self.local)}),patch.object(aeq.gtfs_skim,'discover_feed',side_effect=AssertionError('Unexpected discovery')):
            meta=self.metadata(self.call())
        self.assertEqual(meta['feed_origin'],'operator_path');self.assertEqual(meta['source_name'],'bundled.zip')

    def test_operator_url_does_not_discover(self):
        url='https://synthetic.invalid/operator.zip'
        with patch.dict(os.environ,{'GTFS_URL':url}),patch.object(aeq.gtfs_skim,'discover_feed',side_effect=AssertionError('Unexpected discovery')),patch.object(requests,'get',return_value=Mock(status_code=200,content=self.raw)) as get:
            meta=self.metadata(self.call())
        self.assertEqual(meta['feed_origin'],'operator_url');self.assertEqual(meta['source_url'],url);get.assert_called_once_with(url,timeout=120)

    def test_discovered_feed_uses_exact_centroid_extent(self):
        url='https://synthetic.invalid/discovered.zip'
        discovery=aeq.gtfs_skim.FeedDiscovery(url,'found',None)
        with patch.object(aeq.gtfs_skim,'discover_feed',return_value=discovery) as discover,patch.object(requests,'get',return_value=Mock(status_code=200,content=self.raw)):
            meta=self.metadata(self.call())
        discover.assert_called_once_with((-121.070,39.200,-121.050,39.220))
        self.assertEqual(meta['feed_origin'],'discovered_catalog');self.assertEqual(meta['source_url'],url)

    def test_disabled_discovery_retains_bundled_origin(self):
        with patch.object(aeq,'GTFS_DISCOVER',False),patch.object(aeq.gtfs_skim,'discover_feed',side_effect=AssertionError('Unexpected discovery')):
            meta=self.metadata(self.call())
        self.assertEqual(meta['feed_origin'],'bundled_default')
        self.assertFalse(meta['fallback_after_catalog_failure'])

    def test_catalog_failure_retains_fallback_disclosure(self):
        discovery=aeq.gtfs_skim.FeedDiscovery(None,'catalog_unavailable','Synthetic offline')
        with patch.object(aeq.gtfs_skim,'discover_feed',return_value=discovery):meta=self.metadata(self.call())
        self.assertEqual(meta['feed_origin'],'bundled_after_catalog_unavailable')
        self.assertTrue(meta['fallback_after_catalog_failure']);self.assertEqual(meta['discovery_error'],'Synthetic offline')

    def test_catalog_no_match_does_not_substitute_bundle(self):
        discovery=aeq.gtfs_skim.FeedDiscovery(None,'no_match',None)
        with patch.object(aeq.gtfs_skim,'discover_feed',return_value=discovery),patch.object(aeq.gtfs_skim,'acquire_feed_archive') as acquire:
            result=self.call()
        self.assertEqual(result['transit_status'],'no_local_feed')
        self.assertEqual(result['metadata']['no_feed_reason'],'discovery_found_no_covering_feed')
        acquire.assert_not_called();self.post.assert_not_called()

    def test_selected_feed_outranks_operator_and_catalog(self):
        self.row['model_runs']['input_snapshot_json']=feeds._stamp()['input_snapshot_json']
        with patch.dict(os.environ,{'GTFS_URL':'https://unused.invalid'}),patch.object(aeq.gtfs_skim,'discover_feed',side_effect=AssertionError('Unexpected discovery')),patch.object(requests,'get',side_effect=AssertionError('Unexpected operator download')):
            meta=self.metadata(self.call())
        self.assertEqual(meta['feed_origin'],'workspace_feed_version');self.assertTrue(meta['operator_env_overridden'])
        self.assertEqual(meta['feed_version_id'],feeds.VERSION_ID);self.assertEqual(meta['source_name'],'Test Transit')

    def test_selected_failure_never_substitutes_another_origin(self):
        self.row['model_runs']['input_snapshot_json']=feeds._stamp()['input_snapshot_json']
        self.fake.version_rows[0]['workspace_id']='foreign'
        with patch.object(aeq.gtfs_skim,'acquire_feed_archive') as acquire:
            result=self.call()
        self.assertEqual(result['transit_status'],'feed_unavailable')
        self.assertEqual(result['metadata']['no_feed_reason'],'selected_feed_not_found')
        acquire.assert_not_called();self.post.assert_not_called()

    def test_uncertain_registration_is_not_feed_unavailable(self):
        self.post.side_effect=TimeoutError('Synthetic lost reply')
        with patch.object(aeq,'GTFS_DISCOVER',False):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):self.call()
        self.assertTrue(self.writer.stopped)

    def test_deadline_refusal_does_not_register_archive(self):
        with patch.object(aeq,'GTFS_DISCOVER',False):result=self.call(deadline=0)
        self.assertEqual(result['status'],'unavailable')
        self.assertEqual(result['metadata']['no_feed_reason'],'transit_skim_timed_out')
        self.post.assert_not_called()


if __name__=='__main__':unittest.main()
