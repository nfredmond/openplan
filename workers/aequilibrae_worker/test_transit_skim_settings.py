"""Numerical transit settings survive different process defaults."""
import json,os,subprocess,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import numpy as np
import gtfs_skim as gs
import model_transit_skim as transit
import test_transit_feed_handoff as fixtures


class TransitSettingsTests(unittest.TestCase):
    def test_record_refuses_missing_extra_nonfinite_and_invalid_numbers(self):
        valid=gs.TransitSkimSettings(.5,5,1.5,3).to_record()
        self.assertEqual(gs.TransitSkimSettings.from_record(valid).to_record(),valid)
        for record in ({},dict(valid,extra=1),dict(valid,walk_mph=0),dict(valid,access_miles=-1),dict(valid,flat_fare_usd=True),dict(valid,flat_fare_usd=float('nan')),dict(valid,transfer_penalty_min=float('inf'))):
            with self.subTest(record=record),self.assertRaises(ValueError):gs.TransitSkimSettings.from_record(record)

    def test_explicit_access_changes_served_pairs(self):
        los=gs.load_feed(raw=fixtures._feed_bytes())
        lons=fixtures.COVERED_LONS+.001;lats=fixtures.COVERED_LATS
        narrow=gs.transit_skim(los,lons,lats,settings=gs.TransitSkimSettings(0,5,1,3))
        wide=gs.transit_skim(los,lons,lats,settings=gs.TransitSkimSettings(.2,5,1,3))
        self.assertFalse(narrow['available'].any());self.assertTrue(wide['available'][0,1])

    def test_transfer_penalty_changes_selected_itinerary(self):
        los=SimpleNamespace(stops={'a':(-121,39),'t':(-120.99,39),'b':(-120.98,39)},
            stop_lines={'a':{'direct','first'},'t':{'first','second'},'b':{'direct','second'}},
            lines={'direct':{'cum':{'a':0,'b':600},'headway_min':0},
                   'first':{'cum':{'a':0,'t':60},'headway_min':0},
                   'second':{'cum':{'t':0,'b':60},'headway_min':0}})
        lons=np.array([-121,-120.98]);lats=np.array([39,39])
        low=gs.transit_skim(los,lons,lats,settings=gs.TransitSkimSettings(.01,0,2,3))
        high=gs.transit_skim(los,lons,lats,settings=gs.TransitSkimSettings(.01,20,2,3))
        self.assertEqual(low['ivtt'][0,1],2);self.assertEqual(high['ivtt'][0,1],10)

    def test_child_uses_record_despite_different_environment(self):
        settings=gs.TransitSkimSettings(.2,7,2.25,2)
        raw=fixtures._feed_bytes();los=gs.load_feed(raw=raw,source_name='Synthetic')
        lons=fixtures.COVERED_LONS+.001;lats=fixtures.COVERED_LATS
        meta,skim,_=transit.skim_prepared_feed_version(los,{},lons,lats,settings=settings)
        self.assertEqual(meta['skim_settings'],settings.to_record())
        self.assertTrue(skim['available'][0,1]);self.assertGreater(skim['walk'][0,1],0)
        expected={key:value.tolist() for key,value in skim.items()}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'feed.zip').write_bytes(raw)
            (root/'settings.json').write_text(json.dumps(settings.to_record()))
            code='''
import json,sys
from pathlib import Path
import numpy as np
import gtfs_skim as gs
import model_transit_skim as transit
root=Path(sys.argv[1])
settings=gs.TransitSkimSettings.from_record(json.loads((root/'settings.json').read_text()))
los=gs.load_feed(raw=(root/'feed.zip').read_bytes(),source_name='Synthetic')
meta,skim,_=transit.skim_prepared_feed_version(los,{},np.array([-121.049,-121.069]),np.array([39.200,39.220]),settings=settings)
print(json.dumps({'skim':{k:v.tolist() for k,v in skim.items()},'access':meta['access_buffer_miles'],'fare':meta['flat_fare_usd']}))
'''
            env={'PATH':os.environ.get('PATH','/usr/bin'),'PYTHONPATH':str(Path(__file__).parent),'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1',
                 'GTFS_ACCESS_MILES':'0','GTFS_TRANSFER_PENALTY_MIN':'999','GTFS_FLAT_FARE':'77','MODE_WALK_MPH':'99'}
            result=subprocess.run([sys.executable,'-B','-c',code,directory],env=env,cwd=directory,capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stderr);actual=json.loads(result.stdout)
        for key in expected:np.testing.assert_allclose(actual['skim'][key],expected[key])
        self.assertEqual(actual['access'],settings.access_miles);self.assertEqual(actual['fare'],settings.flat_fare_usd)

    def test_explicit_access_controls_prepared_coverage(self):
        los=gs.load_feed(raw=fixtures._feed_bytes())
        lons=np.array([-121.04]);lats=np.array([39.20])
        with patch.object(gs,'GTFS_ACCESS_MILES',100):
            with self.assertRaises(gs.SelectedFeedError):
                transit.skim_prepared_feed_version(los,{},lons,lats,settings=gs.TransitSkimSettings(0,5,1,3))


if __name__=='__main__':unittest.main()
