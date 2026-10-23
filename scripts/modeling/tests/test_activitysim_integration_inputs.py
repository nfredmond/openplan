"""Synthetic fare and missing-service controls, not behavioral evidence."""
import copy
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import activitysim_transit_skims as ts
from test_activitysim_transit_skims import fixture, ZONES

class IntegrationInputs(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.source=self.root/'source';self.source.write_text('synthetic fare source')
        self.policy={'kind':'route_period_single_boarding','source':'https://example.org/policy',
            'source_path':str(self.source),'source_sha256':ts.sha256(self.source),
            'service_date':'2019-10-08','effective_from':'2017-10-01','verified_through':'2019-12-31',
            'route_fares':{'r':[{'start':'00:00:00','end':'06:00:00','usd':2},
                {'start':'06:00:00','end':'09:00:00','usd':2.5},
                {'start':'09:00:00','end':'24:00:00','usd':2}]}}
        self.config=fixture(self.root/'feed.zip');self.config['fare_policy']=self.policy

    def test_direct_peak_offpeak_and_boundary(self):
        for when,expected in [('05:59:59',2),('06:00:00',2.5),('08:59:59',2.5),('09:00:00',2)]:
            self.assertEqual(ts.fare_for_path([('r',ts.seconds(when))],[],[],self.policy),expected)

    def test_unknown_transfer_overlap_and_negative_fares(self):
        for boards in [[],[('unknown',28800)],[('r',28800),('r',30000)]]:
            self.assertIsNone(ts.fare_for_path(boards,[],[],self.policy))
        policy=copy.deepcopy(self.policy);policy['route_fares']['r'].append(policy['route_fares']['r'][1])
        self.assertIsNone(ts.fare_for_path([('r',28800)],[],[],policy))
        self.policy['route_fares']['r'][1]['usd']=-1
        with self.assertRaisesRegex(ts.TransitUnavailable,'nonnegative'):ts.fare_for_path([('r',28800)],[],[],self.policy)

    def test_missing_source_date_and_hash_refuse(self):
        for key,value,expected in [('service_date','2019-10-09','date'),('source','', 'source'),('effective_from','2020-01-01','dates'),
                                    ('verified_through','2018-01-01','dates'),('source_sha256','0'*64,'hash')]:
            config=copy.deepcopy(self.config);config['fare_policy'][key]=value
            raw,record=ts.build_transit_skims(ZONES,config)
            self.assertEqual(raw,{})
            self.assertEqual(record['status'],'unavailable')
            self.assertIn(expected,record['reason'])

    def test_available_fare_direct_unknown_transfer(self):
        import numpy as np
        raw,record=ts.build_transit_skims(ZONES,self.config)
        self.assertEqual(record['status'],'available')
        self.assertEqual(raw['WLK_LOC_WLK_FAR__AM'][0,1],2.5)
        self.assertTrue(np.isnan(raw['WLK_LOC_WLK_FAR__AM'][0,2]))
        self.assertFalse(raw['WLK_LOC_WLK_USABLE__AM'][0,2])
        self.assertTrue(raw['WLK_LOC_WLK_AVAILABLE__AM'][0,2])

    def test_excluded_endpoint_stays_unknown_and_disclosed(self):
        import numpy as np
        self.config['coverage_exclusions']={'source':'https://example.org/missing-agency','zone_ids':[1], 'reason':'missing service'}
        raw,record=ts.build_transit_skims(ZONES,self.config)
        self.assertEqual(record['coverage_exclusions']['zone_ids'],[1])
        self.assertNotIn(1,record['walk_access_zone_ids'])
        for key,value in raw.items():
            if 'AVAILABLE' in key or 'USABLE' in key:
                self.assertFalse(value[0].any());self.assertFalse(value[:,0].any())
            else:
                self.assertTrue(np.isnan(value[0]).all());self.assertTrue(np.isnan(value[:,0]).all())
        self.assertTrue(raw['WLK_LOC_WLK_AVAILABLE__AM'][1,2])

    def test_exclusion_source_and_zone_refuse(self):
        for exclusions in [{'source':'','zone_ids':[1]},{'source':'https://example.org','zone_ids':[99]}]:
            self.config['coverage_exclusions']=exclusions
            raw,record=ts.build_transit_skims(ZONES,self.config)
            self.assertEqual(raw,{})
            self.assertEqual(record['status'],'unavailable')
            self.assertRegex(record['reason'],'Coverage exclusions|Excluded zone')

if __name__=='__main__':unittest.main()
