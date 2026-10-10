"""Child uses retained geometry, settings and feed bytes."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import gtfs_skim as gs
import model_geometry_inputs as geometry_inputs
import model_transit_inputs as transit_inputs
import model_transit_execution as execution
import test_transit_feed_handoff as feeds

class TransitExecutionTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        raw=feeds._feed_bytes()
        self.geometry={'zone_ids':[20,10],'lons':[-121.050,-121.070],'lats':[39.200,39.220]}
        metadata={'feed_origin':'operator_path','source_url':None,'source_name':'synthetic.zip','feed_checksum_sha256':hashlib.sha256(raw).hexdigest()}
        settings=gs.TransitSkimSettings(access_miles=0.5,transfer_penalty_min=2,flat_fare_usd=7,walk_mph=3)
        self.prepared={'status':'retained','deadline':None,'record':transit_inputs.retain(raw,metadata,settings,self.root/'feed'),'geometry_record':geometry_inputs.retain(self.geometry,self.root/'geometry')}

    def test_exact_geometry_settings_and_bytes_drive_skim(self):
        with patch.object(gs,'discover_feed',side_effect=AssertionError('Child discovery forbidden')):
            result=execution.consume_and_skim(self.prepared,self.root/'child')
        self.assertEqual(result['geometry'],self.geometry)
        self.assertEqual(result['transit_status'],'modeled')
        self.assertTrue(result['skim']['available'][0,1])
        self.assertEqual(result['metadata']['skim_settings']['flat_fare_usd'],7)

    def test_deadline_prevents_feed_consumption(self):
        self.prepared['deadline']=0
        with patch.object(transit_inputs,'consume',wraps=transit_inputs.consume) as consume:
            with self.assertRaises(gs.GtfsTimeout):execution.consume_and_skim(self.prepared,self.root/'child')
        consume.assert_not_called()

    def test_unavailable_remains_unavailable_without_feed_read(self):
        self.prepared.update(status='unavailable',transit_status='feed_unavailable',metadata={'no_feed_reason':'feed_catalog_unavailable'})
        with patch.object(transit_inputs,'consume',wraps=transit_inputs.consume) as consume:
            result=execution.consume_and_skim(self.prepared,self.root/'child')
        self.assertEqual(result['transit_status'],'feed_unavailable')
        self.assertEqual(result['metadata']['no_feed_reason'],'feed_catalog_unavailable')
        self.assertIsNone(result['skim']);consume.assert_not_called()

if __name__=='__main__':unittest.main()
