"""Input custody and national association controls with synthetic data only."""
import copy
import csv
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'scripts/modeling'),str(ROOT/'scripts/modeling/tests')]
import audit_station_evidence as a
import station_evidence as s
from test_station_evidence import retained, ca_record, encoded
from count_observation_uncertainty import digest


class ExternalTests(unittest.TestCase):
    def record(self):
        return dict(source='hpms', route='7', facility='mainline',direction='two_way',year=2024,
                    raw={'line':{'type':'LineString','coordinates':[[-100.01,40],[-99.99,40]]}})

    def associate(self,record=None):
        return s.external_association(s.observation_reference(retained()),[record or self.record()],source='hpms',max_distance_m=30)

    def test_section_location_is_candidate_not_station(self):
        result=self.associate()
        self.assertEqual(result['status'],'candidate_only');self.assertEqual(result['reason'],'publisher_crosswalk_required')
        self.assertEqual(result['confidence'],'low_location_only');self.assertAlmostEqual(result['candidates'][0]['distance_m'],0)

    def test_route_scope_distance_refusals(self):
        for r in ({**self.record(),'route':'8'},{**self.record(),'route':None},{**self.record(),'facility':'ramp'},
                  {**self.record(),'direction':'one_way'},{**self.record(),'raw':{'line':{'type':'LineString','coordinates':[[-100,41],[-99,41]]}}}):
            self.assertEqual(self.associate(r)['status'],'unmatched')

    def test_ambiguous_sections_never_choose_nearest(self):
        result=s.external_association(s.observation_reference(retained()),[self.record(),self.record()],source='hpms',max_distance_m=30)
        self.assertEqual(result['reason'],'ambiguous_section_candidates');self.assertEqual(len(result['candidates']),2)

    def test_tmas_direction_and_facility_unproved(self):
        r=dict(source='tmas',route='7',facility='unknown',direction='1',longitude=-100,latitude=40,year=2023)
        result=s.external_association(s.observation_reference(retained()),[r],source='tmas',max_distance_m=30)
        self.assertEqual(result['reason'],'facility_or_direction_scope_unproved');self.assertEqual(result['status'],'unmatched')

    def test_geometry_missing_and_multi(self):
        self.assertIsNone(s.line_distance_metres(-100,40,{}))
        self.assertIsNone(s.line_distance_metres(-100,40,{'type':'LineString','coordinates':[[float('nan'),40],[-100,40]]}))
        self.assertEqual(s.line_distance_metres(-100,40,{'type':'MultiLineString','coordinates':[[[-100.01,40],[-99.99,40]]]}),0)
        self.assertGreater(s.line_distance_metres(-100,40,{'type':'LineString','coordinates':[[-100.01,41],[-99.99,41]]}),100000)


class AuditTests(unittest.TestCase):
    def fixture(self,root):
        row=retained();out=io.StringIO();writer=csv.DictWriter(out,fieldnames=list(row));writer.writeheader();writer.writerow(row)
        raw=out.getvalue().encode();name='99001/counts/published_counts.csv'
        member={'member':name,'sha256':s.sha256(raw),'bytes':len(raw)}
        archive=root/'input.zip'
        with zipfile.ZipFile(archive,'w') as z:
            z.writestr(name,raw);z.writestr('99001/assignment-output.csv','FORBIDDEN')
            z.writestr('heldout/counts/published_counts.csv','FORBIDDEN')
        registry={'partition':'original five development counties only','study_id':'synthetic',
                  'archive':{'path':str(archive),'sha256':s.sha256(archive.read_bytes())},'geographies':[{'id':'99001'}],'members':[member]}
        registry_bytes=encoded(registry);rp=root/'registry.json';rp.write_bytes(registry_bytes)
        county={'geography':'99001','matched':1,'matched_source_rows':[{'station_id':row['station_id'],'source_row_sha256':digest(row)}], 'match_statuses':{'matched':1}}
        baseline={'registry_sha256':s.sha256(registry_bytes),'archive_sha256':registry['archive']['sha256'],'counties':[county]}
        (root/'baseline.json').write_bytes(encoded(baseline))
        config={'partition':registry['partition'],'input_registry_sha256':s.sha256(registry_bytes),'baseline_path':'baseline.json','baseline_sha256':s.sha256(encoded(baseline)),
                'geographies':[{'id':'99001','name':'Synthetic'}],'location_tolerance_metres':30}
        return config,rp,registry,baseline

    def test_only_count_member_opens_and_recomputes(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);config,rp,_,_=self.fixture(root)
            original=zipfile.ZipFile.read;opened=[]
            def checked(z,name,*args,**kwargs):
                opened.append(name)
                self.assertEqual(name,'99001/counts/published_counts.csv')
                return original(z,name,*args,**kwargs)
            with patch.object(a,'ROOT',root),patch.object(zipfile.ZipFile,'read',checked):
                registry,selected,receipts=a.matched_inputs(config,rp)
            bundle={'config_sha256':digest(config),'records':{'99001':[ca_record()]}}
            before=copy.deepcopy(selected)
            result=a.coverage(config,registry,selected,receipts,bundle)
            self.assertEqual((result['matched'],result['available']),(1,0))
            self.assertEqual(selected,before)
            self.assertEqual(result['assignment_output_files_opened'],0);self.assertEqual(result['residuals_computed'],0)
            self.assertEqual(opened,['99001/counts/published_counts.csv'])
            self.assertEqual(result['counties'][0]['associations'],{'associated':1})
            self.assertIn('interval_evidence_unavailable',result['counties'][0]['rows'][0]['interval']['reasons'])

    def test_registry_hash_refusal(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);config,rp,_,_=self.fixture(root);rp.write_bytes(rp.read_bytes()+b' ')
            with patch.object(a,'ROOT',root),self.assertRaisesRegex(ValueError,'registry hash'):a.matched_inputs(config,rp)

    def test_baseline_and_archive_hash_refusal(self):
        for target,expected in [('baseline.json','baseline hash'),('input.zip','archive hash')]:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);config,rp,_,_=self.fixture(root);(root/target).write_bytes((root/target).read_bytes()+b' ')
                with patch.object(a,'ROOT',root),self.assertRaisesRegex(ValueError,expected):a.matched_inputs(config,rp)

    def test_partition_geography_and_row_refusals(self):
        for mode,expected in [('partition','unauthorized partition'),('geography','geography set'),('row','source row'),('count','denominator')]:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);config,rp,registry,baseline=self.fixture(root)
                if mode=='partition':
                    registry['partition']='heldout';rp.write_bytes(encoded(registry));config['input_registry_sha256']=s.sha256(encoded(registry))
                    baseline['registry_sha256']=config['input_registry_sha256']
                if mode=='geography':config['geographies'][0]['id']='99003'
                if mode=='row':baseline['counties'][0]['matched_source_rows'][0]['source_row_sha256']='b'*64
                if mode=='count':baseline['counties'][0]['matched']=2
                if mode in {'row','count','partition'}:
                    (root/'baseline.json').write_bytes(encoded(baseline));config['baseline_sha256']=s.sha256(encoded(baseline))
                with patch.object(a,'ROOT',root),self.assertRaisesRegex(ValueError,expected):a.matched_inputs(config,rp)

    def test_member_hash_refusal(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);config,rp,registry,baseline=self.fixture(root)
            registry['members'][0]['sha256']='b'*64
            rp.write_bytes(encoded(registry));config['input_registry_sha256']=s.sha256(encoded(registry))
            baseline['registry_sha256']=config['input_registry_sha256']
            (root/'baseline.json').write_bytes(encoded(baseline));config['baseline_sha256']=s.sha256(encoded(baseline))
            with patch.object(a,'ROOT',root),self.assertRaisesRegex(ValueError,'count member hash'):a.matched_inputs(config,rp)

    def test_bundle_config_and_exclusive_output(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);config,rp,_,_=self.fixture(root)
            with patch.object(a,'ROOT',root):registry,selected,receipts=a.matched_inputs(config,rp)
            with self.assertRaisesRegex(ValueError,'configuration'):a.coverage(config,registry,selected,receipts,{'config_sha256':'bad','records':{'99001':[ca_record()]}})
            p=root/'new.json';a.write_new(p,{'synthetic':True})
            with self.assertRaises(FileExistsError):a.write_new(p,{})


if __name__=='__main__':unittest.main()
