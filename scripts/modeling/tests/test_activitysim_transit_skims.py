"""Hand-computed timetable, refusal, MTC-unit and opt-in contract tests."""
from copy import deepcopy
from contextlib import contextmanager
import csv
import gzip
import hashlib
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import activitysim_transit_skims as ts
import activitysim_mtc_inputs as mtc
import build_activitysim_input_bundle as builder
import numpy as np


@contextmanager
def deterministic_omx():
    # Freeze only HDF5's dataset creation clock for byte comparisons. Both
    # parent and candidate use the same setting; numerical/layout writes run.
    import tables
    original=tables.File.create_carray
    def create(self,*args,**kwargs):
        kwargs['track_times']=False
        return original(self,*args,**kwargs)
    with patch.object(tables.File,'create_carray',create):
        yield


def baseline_source(name):
    root=Path(__file__).parent/'fixtures/activitysim-transit-baseline'
    record=json.loads((root/'source.json').read_text())
    source=gzip.decompress((root/(name+'.gz')).read_bytes())
    if hashlib.sha256(source).hexdigest()!=record['files'][name]:
        raise AssertionError('Baseline source custody mismatch')
    return source.decode()


def fixture(path, change=None):
    tables = {
        'agency.txt': [['agency_id','agency_timezone'], ['a','America/Chicago']],
        'stops.txt': [['stop_id','stop_lon','stop_lat'],['A',-93,45],['B',-92.99,45],['C',-92.98,45]],
        'routes.txt': [['route_id','route_type'],['r','3']],
        'trips.txt': [['route_id','service_id','trip_id']],
        'stop_times.txt': [['trip_id','stop_id','stop_sequence','arrival_time','departure_time']],
        'calendar.txt': [['service_id','monday','tuesday','wednesday','thursday','friday','saturday','sunday','start_date','end_date'], ['s',1,1,1,1,1,0,0,'20190101','20191231']],
        'fare_attributes.txt': [['fare_id','price','currency_type','transfers','transfer_duration'],['f',2.5,'USD',1,7200]],
    }
    for hour in [2,8,12,16,20]:
        for tid, a,b,dep,arr in [('a','A','B',5,15),('b','B','C',20,35)]:
            trip=f'{hour}{tid}'
            tables['trips.txt'].append(['r','s',trip])
            tables['stop_times.txt'].extend([[trip,a,1,f'{hour:02}:{dep:02}:00',f'{hour:02}:{dep:02}:00'],[trip,b,2,f'{hour:02}:{arr:02}:00',f'{hour:02}:{arr:02}:00']])
    if change:
        change(tables)
    with zipfile.ZipFile(path,'w') as z:
        for name, data in tables.items():
            out=io.StringIO();csv.writer(out).writerows(data);z.writestr(name,out.getvalue())
    return {'feed_path':str(path),'feed_url':'https://example.org/gtfs.zip','terms_url':'https://example.org/terms',
        'feed_sha256':ts.sha256(path),'service_date':'2019-10-08','walk_access_m':100,'walk_mps':1,
        'min_transfer_seconds':60,'max_journey_minutes':60,
        'departures':dict(zip(ts.PERIODS,['02:00:00','08:00:00','12:00:00','16:00:00','20:00:00']))}

ZONES=[{'zone_id':i+1,'centroid_lon':lon,'centroid_lat':45} for i,lon in enumerate([-93,-92.99,-92.98,-90])]


class TransitTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'gtfs.zip'
        self.config=fixture(self.path)

    def build(self,change=None,zones=None):
        if change:self.config=fixture(self.path,change)
        return ts.build_transit_skims(zones or ZONES,self.config)

    def test_hand_computed_direct_transfer_wait_fare_and_periods(self):
        raw,record=self.build()
        self.assertEqual(record['status'],'available',record)
        for p in ts.PERIODS:
            def value(c,i=0,j=2):return raw[f'WLK_LOC_WLK_{c}__{p}'][i,j]
            self.assertEqual(value('TOTIVT'),25)
            self.assertEqual(value('IWAIT'),5)
            self.assertEqual(value('XWAIT'),5)
            self.assertEqual(value('WAIT'),10)
            self.assertEqual(value('BOARDS'),2)
            self.assertEqual(value('TRANSFERS'),1)
            self.assertEqual(value('TOTAL'),35)
            self.assertEqual(value('FAR'),2.5)
            self.assertEqual(value('TOTAL',0,1),15)
            self.assertEqual(value('TRANSFERS',0,1),0)
            self.assertFalse(value('AVAILABLE',2,0))
            self.assertFalse(value('AVAILABLE',0,0))
            self.assertTrue(np.isnan(value('TOTAL',2,0)))
        self.assertEqual(record['zones_without_walk_access'],[4])
        self.assertEqual(record['feed_sha256'],ts.sha256(self.path))
        self.assertEqual(record['active_service_ids'],['s'])
        self.assertEqual(record['agency_timezone'],'America/Chicago')

    def test_access_egress_and_mtc_units(self):
        zones=deepcopy(ZONES);zones[0]['centroid_lat']+=0.0001;zones[2]['centroid_lat']+=0.0001
        raw,record=self.build(zones=zones)
        prefix='WLK_LOC_WLK_';p='__AM'
        access=ts.distance_m((-93,45.0001),(-93,45))/60
        self.assertAlmostEqual(raw[prefix+'WACC'+p][0,2],access)
        self.assertAlmostEqual(raw[prefix+'WEGR'+p][0,2],access)
        self.assertAlmostEqual(raw[prefix+'IWAIT'+p][0,2],5-access)
        self.assertAlmostEqual(raw[prefix+'TOTAL'+p][0,2],35+access)
        for c,expected in [('TOTIVT',2500),('BOARDS',2),('FAR',250),('WAIT',1000-access*100),('WAUX',access*200)]:
            self.assertAlmostEqual(ts.mtc_matrix(prefix+c+p,raw,(4,4))[0,2],expected)
        self.assertEqual(ts.mtc_matrix('WLK_TRN_WLK_IVT__AM',raw,(4,4))[0,2],2500)
        self.assertEqual(ts.mtc_matrix('WLK_HVY_WLK_TOTIVT__AM',raw,(4,4))[0,2],0)
        with self.assertRaises(ts.TransitUnavailable):ts.mtc_matrix('WLK_LOC_WLK_MYSTERY__AM',raw,(4,4))

    def test_missed_transfer_is_not_a_possible_itinerary(self):
        def change(t):t['transfers.txt']=[['from_stop_id','to_stop_id','transfer_type','min_transfer_time'],['B','B',2,360]]
        raw,_=self.build(change)
        self.assertFalse(raw['WLK_LOC_WLK_AVAILABLE__AM'][0,2])
        self.assertTrue(raw['WLK_LOC_WLK_AVAILABLE__AM'][1,2])

    def test_forbidden_transfer(self):
        def change(t):t['transfers.txt']=[['from_stop_id','to_stop_id','transfer_type'],['B','B',3]]
        raw,_=self.build(change)
        self.assertFalse(raw['WLK_LOC_WLK_AVAILABLE__AM'][0,2])

    def test_calendar_removal_and_addition(self):
        def remove(t):t['calendar_dates.txt']=[['service_id','date','exception_type'],['s','20191008',2]]
        raw,r=self.build(remove);self.assertEqual(raw,{})
        self.assertEqual(r['status'],'unavailable');self.assertIn('No service',r['reason'])
        def add(t):
            t.pop('calendar.txt');t['calendar_dates.txt']=[['service_id','date','exception_type'],['s','20191008',1]]
        raw,r=self.build(add);self.assertEqual(r['status'],'available',r);self.assertTrue(raw['WLK_LOC_WLK_AVAILABLE__AM'][0,2])
        self.assertEqual(len(r['calendar_exceptions']),1)

    def test_missing_feed_hash_unmatched_stop_and_no_access_refuse(self):
        self.config['feed_sha256']='bad'
        raw,r=self.build();self.assertEqual(r['status'],'unavailable');self.assertIn('hash differs',r['reason']);self.assertEqual(raw,{})
        def unmatched(t):t['stop_times.txt'][1][1]='missing'
        raw,r=self.build(unmatched);self.assertIn('Unmatched stop',r['reason']);self.assertEqual(raw,{})
        self.config=fixture(self.path)
        raw,r=self.build(zones=[ZONES[-1]]);self.assertIn('No zones',r['reason']);self.assertEqual(raw,{})
        self.path.unlink();raw,r=self.build();self.assertEqual(r['status'],'unavailable');self.assertEqual(raw,{})

    def test_unknown_fare_is_not_free_or_enabled(self):
        raw,r=self.build(lambda t:t.pop('fare_attributes.txt'))
        self.assertEqual(r['status'],'los_only_fare_unavailable')
        self.assertTrue(raw['WLK_LOC_WLK_AVAILABLE__AM'][0,2])
        self.assertFalse(raw['WLK_LOC_WLK_USABLE__AM'][0,2])
        self.assertTrue(np.isnan(raw['WLK_LOC_WLK_FAR__AM'][0,2]))
        self.assertEqual(ts.mtc_matrix('WLK_LOC_WLK_TOTIVT__AM',raw,(4,4))[0,2],0)
        self.assertEqual(ts.mtc_matrix('WLK_TRN_WLK_IVT__AM',raw,(4,4))[0,2],2500)

    def test_explicit_drive_connectors_both_directions(self):
        self.config['drive_connectors']=[{'zone_id':4,'stop_id':'A','direction':'access','minutes':3,'miles':1,'source':'fixture road'}, {'zone_id':4,'stop_id':'C','direction':'egress','minutes':4,'miles':2,'source':'fixture road'}]
        raw,r=self.build()
        for prefix,i,j,dt,dist,total in [('DRV_LOC_WLK',3,2,3,1,35),('WLK_LOC_DRV',0,3,4,2,39)]:
            self.assertEqual(raw[f'{prefix}_DTIM__AM'][i,j],dt)
            self.assertEqual(raw[f'{prefix}_DDIST__AM'][i,j],dist)
            self.assertEqual(raw[f'{prefix}_TOTAL__AM'][i,j],total)
            self.assertEqual(ts.mtc_matrix(f'{prefix}_DTIM__AM',raw,(4,4))[i,j],dt*100)
        self.config.pop('drive_connectors')
        raw,r=self.build();self.assertFalse(raw['DRV_LOC_WLK_AVAILABLE__AM'].any())
        self.assertIn('no supplied',r['drive_transit'])

    def test_primary_mode_required_with_local_feeder(self):
        def rail(t):
            t['routes.txt'].append(['rail','0'])
            for r in t['trips.txt'][1:]:
                if r[2].endswith('b'):r[0]='rail'
        raw,r=self.build(rail)
        self.assertTrue(raw['WLK_LRF_WLK_AVAILABLE__AM'][0,2])
        self.assertEqual(raw['WLK_LRF_WLK_KEYIVT__AM'][0,2],15)
        self.assertEqual(raw['WLK_LRF_WLK_TOTIVT__AM'][0,2],25)
        self.assertFalse(raw['WLK_LRF_WLK_AVAILABLE__AM'][0,1])
        self.assertFalse(raw['WLK_LOC_WLK_AVAILABLE__AM'][0,2])

    def test_onboard_dwell_does_not_add_boarding_or_wait(self):
        def through(t):
            t['trips.txt']=[t['trips.txt'][0]]+[r for r in t['trips.txt'][1:] if r[2].endswith('a')]
            t['stop_times.txt']=[t['stop_times.txt'][0]]+[r for r in t['stop_times.txt'][1:] if r[0].endswith('a')]
            for r in t['stop_times.txt'][1:]:
                if r[1]=='B':r[4]=r[4].replace(':15:',':20:')
            for h in [2,8,12,16,20]:t['stop_times.txt'].append([f'{h}a','C',3,f'{h:02}:35:00',f'{h:02}:35:00'])
        raw,r=self.build(through)
        self.assertEqual(raw['WLK_LOC_WLK_TOTIVT__AM'][0,2],30)
        self.assertEqual(raw['WLK_LOC_WLK_BOARDS__AM'][0,2],1)
        self.assertEqual(raw['WLK_LOC_WLK_XWAIT__AM'][0,2],0)

    def test_frequency_and_conditional_boarding_refused(self):
        def frequency(t):t['frequencies.txt']=[['trip_id','headway_secs'],['8a',600]]
        raw,r=self.build(frequency);self.assertEqual(r['status'],'unavailable');self.assertIn('Frequency',r['reason']);self.assertEqual(raw,{})
        def conditional(t):
            t['stop_times.txt'][0].append('pickup_type')
            for row in t['stop_times.txt'][1:]:row.append('2')
        raw,r=self.build(conditional);self.assertIn('Demand-responsive',r['reason'])

    def test_zero_fare_is_measured_and_transfer_expiry_charges_again(self):
        def free(t):t['fare_attributes.txt'][1][1]=0
        raw,r=self.build(free)
        self.assertTrue(raw['WLK_LOC_WLK_USABLE__AM'][0,2])
        self.assertEqual(raw['WLK_LOC_WLK_FAR__AM'][0,2],0)
        def expired(t):t['fare_attributes.txt'][1][4]=600
        raw,r=self.build(expired)
        self.assertEqual(raw['WLK_LOC_WLK_FAR__AM'][0,2],5)

    def test_pickup_dropoff_restrictions_and_after_midnight(self):
        def no_pickup(t):
            t['stop_times.txt'][0].append('pickup_type')
            for row in t['stop_times.txt'][1:]:row.append('1' if row[1]=='A' else '0')
        raw,r=self.build(no_pickup);self.assertFalse(raw['WLK_LOC_WLK_AVAILABLE__AM'][0,2])
        def no_dropoff(t):
            t['stop_times.txt'][0].append('drop_off_type')
            for row in t['stop_times.txt'][1:]:row.append('1' if row[1]=='C' else '0')
        raw,r=self.build(no_dropoff);self.assertFalse(raw['WLK_LOC_WLK_AVAILABLE__AM'][0,2])
        def midnight(t):
            for row in t['stop_times.txt'][1:]:
                if row[0].startswith('20'):
                    row[3]=row[3].replace('20:','24:');row[4]=row[4].replace('20:','24:')
        self.config=fixture(self.path,midnight);self.config['departures']['EV']='23:50:00'
        raw,r=self.build();self.assertEqual(raw['WLK_LOC_WLK_TOTAL__EV'][0,2],45)
        self.assertEqual(raw['WLK_LOC_WLK_IWAIT__EV'][0,2],15)

    def test_cross_stop_transfer_walk_and_wait(self):
        def split(t):
            t['stops.txt'].append(['D',-92.99,45.0001])
            for row in t['stop_times.txt'][1:]:
                if row[0].endswith('b') and row[1]=='B':row[1]='D'
            t['transfers.txt']=[['from_stop_id','to_stop_id','transfer_type','min_transfer_time'],['B','D',2,60]]
        raw,r=self.build(split)
        walk=ts.distance_m((-92.99,45),(-92.99,45.0001))/60
        self.assertAlmostEqual(raw['WLK_LOC_WLK_WAUX__AM'][0,2],walk)
        self.assertAlmostEqual(raw['WLK_LOC_WLK_XWAIT__AM'][0,2],5-walk)
        self.assertEqual(raw['WLK_LOC_WLK_TOTAL__AM'][0,2],35)

    def test_configuration_and_runtime_guards(self):
        for key,value,reason in [('walk_mps',0,'walk_mps'),('departures',{'AM':'08:00:00'},'Exactly'),('feed_url','','Feed URL'),('route_families',{'r':'UNKNOWN'},'Unsupported')]:
            config={**self.config,key:value}
            raw,r=ts.build_transit_skims(ZONES,config)
            self.assertEqual(raw,{});self.assertIn(reason,r['reason'])
        config=deepcopy(self.config);config['departures']['AM']='12:00:00'
        raw,r=ts.build_transit_skims(ZONES,config);self.assertIn('outside AM',r['reason'])
        with patch.object(ts.sys,'version_info',(3,14)):
            with self.assertRaisesRegex(ts.TransitUnavailable,'CPython 3.11'):ts.require_runtime()
        with self.assertRaisesRegex(RuntimeError,'MTC config'):
            builder.build_activitysim_input_bundle(output_dir='unused',transit_config=self.config)

    def test_sourced_fare_override_is_explicit(self):
        self.config=fixture(self.path,lambda t:t.pop('fare_attributes.txt'))
        self.config['fare_policy']={'kind':'flat_per_boarding','usd':1.75,'source':'fixture published fare'}
        raw,r=self.build();self.assertEqual(raw['WLK_LOC_WLK_FAR__AM'][0,2],3.5)
        self.config['fare_policy'].pop('source')
        raw,r=self.build();self.assertEqual(raw,{});self.assertIn('sourced',r['reason'])

    @deterministic_omx()
    def test_default_full_mtc_bundle_matches_parent_bytes(self):
        import test_build_activitysim_input_bundle as fixtures
        import shutil
        case=fixtures.BuildMtcConfigPackageTests();case.setUp();self.addCleanup(case.tearDown)
        old_builder=types.ModuleType('old_builder');old_builder.__file__=builder.__file__
        old_mtc=types.ModuleType('old_mtc');old_mtc.__file__=mtc.__file__
        for mod,path in [(old_builder,'build_activitysim_input_bundle.py'),(old_mtc,'activitysim_mtc_inputs.py')]:
            source=baseline_source(path)
            exec(compile(source,mod.__file__,'exec'),mod.__dict__)
        class FixedClock:
            @staticmethod
            def now(tz):return datetime(2026,10,23,tzinfo=timezone.utc)
        out=case.root/'compare'
        with patch.object(fixtures,'build_activitysim_input_bundle',old_builder.build_activitysim_input_bundle), patch.object(mtc,'expand_skims',old_mtc.expand_skims), patch.object(old_builder,'datetime',FixedClock):
            case.build(out)
        expected={str(p.relative_to(out)):p.read_bytes() for p in out.rglob('*') if p.is_file()}
        shutil.rmtree(out)
        with patch.object(builder,'datetime',FixedClock):case.build(out)
        actual={str(p.relative_to(out)):p.read_bytes() for p in out.rglob('*') if p.is_file()}
        self.assertEqual(set(actual),set(expected))
        for name in expected:self.assertEqual(actual[name],expected[name],name)

    def test_full_opt_in_bundle_records_custody_and_replaces_disabled_caveat(self):
        import test_build_activitysim_input_bundle as fixtures
        case=fixtures.BuildMtcConfigPackageTests();case.setUp();self.addCleanup(case.tearDown)
        source=case.screening_run_dir/'package/zone_attributes.csv'
        with source.open() as f:zones=list(csv.DictReader(f))
        for i,z in enumerate(zones[:2]):
            z['centroid_lon']=ZONES[i]['centroid_lon'];z['centroid_lat']=ZONES[i]['centroid_lat']
        with source.open('w') as f:
            w=csv.DictWriter(f,fieldnames=list(zones[0]));w.writeheader();w.writerows(zones)
        def build(**kw):return builder.build_activitysim_input_bundle(**kw,transit_config=self.config)
        (case.stock_root/'configs/constants.yaml').write_text('TRANSIT_SCALE_FACTOR: 100\n')
        out=case.root/'with-transit'
        with patch.object(fixtures,'build_activitysim_input_bundle',build):case.build(out)
        manifest=json.loads((out/'manifest.json').read_text())
        custody=json.loads((out/manifest['files']['transit_custody']).read_text())
        self.assertEqual(custody['status'],'available')
        self.assertEqual(custody['feed_sha256'],self.config['feed_sha256'])
        self.assertEqual(custody,manifest['mtc_inputs']['skim_expansion']['transit'])
        self.assertIn('Opt-in GTFS transit status: available',(out/'README.md').read_text())
        self.assertNotIn('Every transit skim is zero',(out/'README.md').read_text())
        self.assertEqual(custody['raw_artifact_sha256'],ts.sha256(out/manifest['files']['transit_raw_skims']))

    def test_no_reachable_departures_is_not_unknown_fare(self):
        self.config['max_journey_minutes']=1
        raw,record=self.build()
        self.assertEqual(record['status'],'unavailable')
        self.assertIn('No scheduled paths',record['reason'])
        self.assertFalse(raw['WLK_LOC_WLK_AVAILABLE__AM'].any())

    def test_ferry_component_stays_separate_from_light_rail(self):
        def ferry(t):t['routes.txt'][1][1]='4'
        raw,record=self.build(ferry)
        self.assertEqual(raw['WLK_LRF_WLK_TOTIVT__AM'][0,2],25)
        self.assertEqual(raw['WLK_LRF_WLK_FERRYIVT__AM'][0,2],25)
        self.assertEqual(raw['WLK_LRF_WLK_KEYIVT__AM'][0,2],0)

    @deterministic_omx()
    def test_default_skim_bytes_match_prechange_source(self):
        from test_activitysim_mtc_inputs import SkimExpansion
        case=SkimExpansion();case.setUp();self.addCleanup(case.tearDown)
        # The immutable parent implementation supplies the expected bytes.
        source=baseline_source('activitysim_mtc_inputs.py')
        old=types.ModuleType('baseline_mtc');old.__file__=mtc.__file__;exec(compile(source,mtc.__file__,'exec'),old.__dict__)
        with patch.object(mtc,'expand_skims',old.expand_skims):old_record=case.expand()
        expected=case.output_omx.read_bytes()
        current=case.expand()
        self.assertEqual(current,old_record)
        self.assertEqual(case.output_omx.read_bytes(),expected)
        self.assertFalse(case.output_omx.with_name('transit_skims.npz').exists())

    def test_opt_in_refuses_incompatible_stock_scale(self):
        from test_activitysim_mtc_inputs import SkimExpansion
        case=SkimExpansion();case.setUp();self.addCleanup(case.tearDown)
        with self.assertRaisesRegex(mtc.MtcInputError,'TRANSIT_SCALE_FACTOR'):
            case.expand(transit_config=self.config)
        (case.stock_root/'configs/constants.yaml').write_text('TRANSIT_SCALE_FACTOR: 10\n')
        with self.assertRaisesRegex(mtc.MtcInputError,'TRANSIT_SCALE_FACTOR'):
            case.expand(transit_config=self.config)

    def test_opt_in_omx_and_custody(self):
        from test_activitysim_mtc_inputs import SkimExpansion
        import openmatrix as omx
        case=SkimExpansion();case.setUp();self.addCleanup(case.tearDown)
        zones=[{**z,**ZONES[i]} for i,z in enumerate(case.skim_zones()[:3])]
        (case.stock_root/'configs/constants.yaml').write_text('TRANSIT_SCALE_FACTOR: 100\n')
        record=case.expand(internal_zone_rows=zones,transit_config=self.config)
        self.assertEqual(record['transit']['status'],'available')
        with omx.open_file(str(case.output_omx),'r') as f:
            self.assertEqual(f['WLK_LOC_WLK_TOTIVT__AM'][0,2],2500)
            self.assertEqual(f['SOV_TIME__AM'][0,1],11)
        self.assertEqual(record['transit']['raw_artifact_sha256'],ts.sha256(case.output_omx.with_name('transit_skims.npz')))

    def test_default_bundle_bytes_match_prechange_source(self):
        from test_build_activitysim_input_bundle import BuildActivitySimInputBundleTests
        case=BuildActivitySimInputBundleTests();case.setUp();self.addCleanup(case.tearDown)
        source=baseline_source('build_activitysim_input_bundle.py')
        old=types.ModuleType('baseline_builder');old.__file__=builder.__file__;exec(compile(source,builder.__file__,'exec'),old.__dict__)
        class FixedClock:
            @staticmethod
            def now(tz):return datetime(2026,10,23,tzinfo=timezone.utc)
        out=case.root/'compare'
        args=dict(screening_run_dir=str(case.screening_run_dir),output_dir=str(out),population_source='scaffold')
        with patch.object(old,'datetime',FixedClock):old.build_activitysim_input_bundle(**args)
        expected={str(p.relative_to(out)):p.read_bytes() for p in out.rglob('*') if p.is_file()}
        with patch.object(builder,'datetime',FixedClock):builder.build_activitysim_input_bundle(**args,force=True)
        actual={str(p.relative_to(out)):p.read_bytes() for p in out.rglob('*') if p.is_file()}
        self.assertEqual(actual,expected)


if __name__=='__main__':unittest.main()
