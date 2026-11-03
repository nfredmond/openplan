"""Synthetic adapter and join controls. They do not validate publisher truth."""
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / 'scripts/modeling'), str(ROOT / 'workers/aequilibrae_worker')]
import station_evidence as s
import audit_station_evidence as audit
from count_observation_uncertainty import attach_observation_interval, digest
from validation_instrument import observation_from_compatibility_row


def encoded(value):
    return json.dumps(value).encode()


def ca_row():
    return dict(RTE=7, CNTY='SYN', PM=2.5, PM_PFX='', PM_SFX='', RTE_SFX='',
                DESCRIPTION='SYNTHETIC ROAD', BACK_AADT=100, AHEAD_AADT=100)


def ca_feature():
    return dict(attributes=ca_row(), geometry=dict(x=-100, y=40))


def workbook(year=2023, formula=False):
    row = ca_row()
    headers = list(row)
    def cell(column, index, value):
        return f'<c r="{column}{index}" t="inlineStr"><is><t>{value}</t></is>' + ('<f>1+1</f>' if formula else '') + '</c>'
    rows = []
    for index, values in enumerate((headers, list(row.values())), 1):
        rows.append('<row r="'+str(index)+'">'+''.join(cell(chr(65+i), index, value) for i,value in enumerate(values))+'</row>')
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as z:
        z.writestr('xl/workbook.xml', f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{year} AADT DATA" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml', f'<worksheet xmlns="{ns}"><sheetData>'+''.join(rows)+'</sheetData></worksheet>')
    return output.getvalue()


def ca_record():
    record = s.caltrans_metadata(encoded({'features':[ca_feature()]}),
                [{'row':ca_row(), 'year':2023, 'locator':'synthetic!2'}], county='SYN')[0]
    record['custody'] = [{'url':'https://example.invalid/synthetic','sha256':'a'*64}]
    return record


def retained():
    return dict(station_id='CT_RTE7_PM2_500', count_year='2023', observed_volume='100',
                source_agency='Caltrans', source_description='SYNTHETIC ROAD', station_role='mainline',
                direction='two_way', bbox_min_lon='-100.001', bbox_max_lon='-99.999',
                bbox_min_lat='39.999', bbox_max_lat='40.001')


def observation(row=None):
    return observation_from_compatibility_row(row or retained(), source_id='synthetic', publisher='synthetic',
        source_url='https://example.invalid/synthetic',source_artifact_sha256='a'*64,downloaded_at='2026-10-23')


def cdot_rows():
    station = dict(stationId='001',route='007A',begRef=2.5,endRef=3,continuous=False,desc='synthetic')
    attrs = dict(COUNTSTATIONID='001',ROUTE='007A',REFPT=2.5,ENDREFPT=3,AADTYR='2025',COUNTYEAR='2023',AADT=100,ISRAMP='0')
    return station, attrs


class CustodyTests(unittest.TestCase):
    def test_fetch_and_verify(self):
        class Response(io.BytesIO):
            def geturl(self): return 'https://example.invalid/synthetic'
        with tempfile.TemporaryDirectory() as td:
            receipt = s.fetch_public('https://example.invalid/synthetic',Path(td),access='public_no_registration',opener=lambda *a,**k:Response(b'synthetic'))
            self.assertEqual(receipt['sha256'],hashlib.sha256(b'synthetic').hexdigest())
            self.assertTrue(receipt['accessed_at'])
            self.assertEqual(s.read_source(Path(td),receipt),b'synthetic')
            (Path(td)/receipt['file']).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'custody'): s.read_source(Path(td),receipt)

    def test_registration_refused_before_network(self):
        with self.assertRaisesRegex(ValueError,'access review'):
            s.fetch_public('https://example.invalid/',Path('.'),access='registration_required',opener=lambda *a,**k: self.fail('network called'))

    def test_redirect_refused(self):
        class Response(io.BytesIO):
            def geturl(self): return 'https://example.invalid/login'
        with self.assertRaisesRegex(ValueError,'redirect'):
            s.fetch_public('https://example.invalid/',Path('.'),access='public_no_registration',opener=lambda *a,**k:Response(b'login'))

    def test_bad_object_name(self):
        with patch.object(Path,'read_bytes',side_effect=AssertionError('invalid object name reaches filesystem')):
            with self.assertRaisesRegex(ValueError,'object name'): s.read_source(Path('.'),{'file':'../secret'})


class AdapterTests(unittest.TestCase):
    def test_workbook_edition_and_fields(self):
        rows=s.caltrans_workbook(workbook(),year=2023,counties={'SYN'})
        self.assertEqual(rows[0]['row']['BACK_AADT'],'100')
        self.assertEqual(rows[0]['year'],2023)
        self.assertEqual(rows[0]['locator'],'2023 AADT DATA!2')
        self.assertEqual(s.caltrans_workbook(workbook(),year=2023,counties={'OTHER'}),[])

    def test_workbook_wrong_year(self):
        with self.assertRaisesRegex(ValueError,'edition'): s.caltrans_workbook(workbook(),year=2024,counties={'SYN'})

    def test_workbook_formula(self):
        with self.assertRaisesRegex(ValueError,'formula'): s.caltrans_workbook(workbook(formula=True),year=2023,counties={'SYN'})

    def test_caltrans_preserves_unknown_process_and_sections(self):
        record=ca_record()
        self.assertIsNone(record['collection_type'])
        self.assertEqual(record['back_aadt'],100)
        self.assertEqual(record['ahead_aadt'],100)
        self.assertEqual(record['vehicle_class'],'all_vehicles')
        self.assertEqual(record['year'],2023)

    def test_caltrans_duplicate_annual_and_prefix_mismatch(self):
        a={'row':ca_row(),'year':2023,'locator':'synthetic!2'}
        for annual in ([a,a],[{'row':{**ca_row(),'PM_PFX':'R'},'year':2023,'locator':'synthetic!2'}]):
            record=s.caltrans_metadata(encoded({'features':[ca_feature()]}),annual,county='SYN')[0]
            self.assertIsNone(record['year'])
            self.assertEqual(record['annual_status'],'annual_row_not_unique')

    def test_caltrans_exact_gis_duplicates_keep_all_locators(self):
        first=ca_feature();first['attributes']['OBJECTID']=1
        second=copy.deepcopy(first);second['attributes']['OBJECTID']=2
        a=[{'row':ca_row(),'year':2023,'locator':'synthetic!2'}]
        parsed=s.caltrans_metadata(encoded({'features':[first,second]}),a,county='SYN')
        self.assertEqual(len(parsed),1);self.assertEqual(parsed[0]['gis_object_ids'],[1,2])
        second['geometry']['x']+=0.00001
        self.assertEqual(len(s.caltrans_metadata(encoded({'features':[first,second]}),a,county='SYN')),2)
        second=copy.deepcopy(first);second['attributes']['BACK_AADT']=99
        self.assertEqual(len(s.caltrans_metadata(encoded({'features':[first,second]}),a,county='SYN')),2)

    def test_caltrans_schema_county_and_truncation(self):
        for document,county in [({'features':[{'attributes':{}}]},'SYN'),({'features':[ca_feature()]},'OTHER'),({'features':[],'exceededTransferLimit':True},'SYN'),({'error':{'code':500}},'SYN')]:
            with self.assertRaises(ValueError): s.caltrans_metadata(encoded(document),[],county=county)

    def test_cdot_type_years_dates_not_duration(self):
        station,attrs=cdot_rows()
        r=s.cdot_metadata(encoded([station]),aadt_payload=encoded([{'attributes':attrs}]),dates={'001':{'continuous':False,'countDates':['20230607','20230606']}})[0]
        self.assertEqual((r['collection_type'],r['year'],r['count_year']),('short_duration',2025,2023))
        self.assertEqual(r['count_dates'],['20230606','20230607'])
        self.assertEqual(r['facility'],'mainline')
        self.assertNotIn('duration',r)
        self.assertNotIn('qa',r)

    def test_cdot_continuous_dates_are_not_complete_days(self):
        station,attrs=cdot_rows();station['continuous']=True
        r=s.cdot_metadata(encoded([station]),aadt_payload=encoded([{'attributes':attrs}]),dates={'001':{'continuous':True,'countDates':['20260930','19960101']}})[0]
        self.assertEqual(r['collection_type'],'continuous')
        self.assertEqual(len(r['count_dates']),2)
        self.assertNotIn('complete_hours',r)

    def test_cdot_refuses_string_boolean_dates_and_schema(self):
        station,attrs=cdot_rows()
        for changed,dates in [({**station,'continuous':'false'},{}),(station,{'001':{'continuous':True,'countDates':[]}}),(station,{'001':{'continuous':False,'countDates':['bad-date']}})]:
            with self.assertRaises(ValueError): s.cdot_metadata(encoded([changed]),aadt_payload=encoded([{'attributes':attrs}]),dates=dates)
        with self.assertRaises(ValueError): s.cdot_metadata(encoded([{}]),aadt_payload=b'[]',dates={})

    def test_incomplete_source_date_retained_and_flagged(self):
        station,attrs=cdot_rows()
        dates=['19960800','20230230','20230606']
        r=s.cdot_metadata(encoded([station]),aadt_payload=encoded([{'attributes':attrs}]),dates={'001':{'continuous':False,'countDates':dates}})[0]
        self.assertEqual(r['count_dates'],sorted(dates))
        self.assertEqual(r['incomplete_or_invalid_dates'],['19960800','20230230'])
        self.assertNotIn('duration',r)

    def test_cdot_refuses_duplicate_aadt_and_ramp(self):
        station,attrs=cdot_rows()
        r=s.cdot_metadata(encoded([station]),aadt_payload=encoded([{'attributes':attrs}]*2),dates={})[0]
        self.assertIsNone(r['year']); self.assertEqual(r['facility'],'unknown')
        attrs['ISRAMP']='1'
        r=s.cdot_metadata(encoded([station]),aadt_payload=encoded([{'attributes':attrs}]),dates={})[0]
        self.assertEqual(r['facility'],'ramp')

    def test_tmas_fields_county_filter_and_method(self):
        fields=['station_id','state_code','county_code','year_record','method_volume','travel_dir','travel_lane','num_lanes','num_lanes_volume','latitude','longitude','posted_signed_route','station_location']
        row=['001','99','001','23','3','1','0','2','2','40000000','100000000','00000007','synthetic']
        raw=('|'.join(fields)+'\n'+'|'.join(row)+'\n').encode()
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('synthetic.STA',raw)
        parsed=s.tmas_metadata(out.getvalue(),members=['synthetic.STA'],counties={'99001'},year=2023)
        self.assertEqual(len(parsed),1)
        r=parsed[0];self.assertEqual((r['longitude'],r['latitude']),(-100,40))
        self.assertEqual((r['collection_type'],r['direction'],r['lane']),('continuous','1','0'))
        self.assertEqual(r['member_sha256'],s.sha256(raw));self.assertEqual(r['facility'],'unknown')
        self.assertEqual(s.tmas_metadata(out.getvalue(),members=['synthetic.STA'],counties={'99003'},year=2023),[])
        with self.assertRaisesRegex(ValueError,'year'):s.tmas_metadata(out.getvalue(),members=['synthetic.STA'],counties={'99001'},year=2024)
        other=io.BytesIO()
        with zipfile.ZipFile(other,'w') as z:z.writestr('synthetic.STA',raw.replace(b'23|3|',b'23|2|'))
        self.assertIsNone(s.tmas_metadata(other.getvalue(),members=['synthetic.STA'],counties={'99001'},year=2023)[0]['collection_type'])

    def test_hpms_section_scope_and_group_duration_refusal(self):
        row=dict(stateid='99',county_id='1',route_id='SYN',begin_point='2',end_point='3',year_record='2024',aadt='100',facility_type='2',aadt_d='20230606',AADT_48='99')
        r=s.hpms_metadata(encoded([row]),geography='99001')[0]
        self.assertIsNone(r['station_id']);self.assertIsNone(r['collection_type'])
        self.assertEqual(r['year'],2024);self.assertNotIn('duration',r)
        no_aadt={k:v for k,v in row.items() if k!='aadt'}
        absent=s.hpms_metadata(encoded([no_aadt]),geography='99001')[0]
        self.assertNotIn('aadt',absent['raw']);self.assertIsNone(absent['collection_type'])
        with self.assertRaisesRegex(ValueError,'county'):s.hpms_metadata(encoded([row]),geography='99003')
        with self.assertRaisesRegex(ValueError,'schema'):s.hpms_metadata(encoded([{}]),geography='99001')


class JoinTests(unittest.TestCase):
    def join(self,record=None,reference=None):
        return s.join_station(reference or s.observation_reference(retained()),[record or ca_record()],max_distance_m=30)

    def test_location_rule_survives_irrelevant_field(self):
        r=ca_record();r['unrelated']='harmless'
        j=self.join(r);self.assertEqual(j['status'],'associated')
        self.assertEqual(j['method'],'route_postmile_description_location')
        self.assertEqual(j['confidence'],'high_identity_only');self.assertEqual(j['distance_m'],0)

    def test_identity_rule(self):
        record=dict(source='cdot',station_id='001',route='007A',postmile=2.5,facility='mainline')
        reference={**record,'direction':'two_way'}
        j=self.join(record,reference);self.assertEqual(j['status'],'associated');self.assertEqual(j['method'],'publisher_station_id_route_section')
        for key,value in [('source','tmas'),('station_id','002'),('route','008A'),('postmile',2.6),('facility','ramp')]:
            self.assertEqual(self.join({**record,key:value},reference)['status'],'unmatched',key)

    def test_location_refusals(self):
        for key,value in [('route','8'),('postmile',3),('facility','ramp'),('facility','unknown'),('longitude',-100.01),('longitude',None),('description','OTHER')]:
            self.assertEqual(self.join({**ca_record(),key:value})['status'],'unmatched',key)
        ref=s.observation_reference(retained());ref['facility']='ramp'
        self.assertEqual(self.join(reference=ref)['status'],'unmatched')

    def test_ambiguous_and_empty(self):
        ref=s.observation_reference(retained())
        j=s.join_station(ref,[ca_record(),ca_record()],max_distance_m=30)
        self.assertEqual(j['reason'],'ambiguous_station_candidates')
        self.assertEqual(s.join_station(ref,[],max_distance_m=30)['reason'],'no_station_candidate')

    def test_distance_tolerance_and_identity_decode(self):
        self.assertLess(s.distance_metres(-100,40,-100.0001,40),30)
        self.assertGreater(s.distance_metres(-100,40,-100.001,40),30)
        self.assertIsNone(s.distance_metres(float('nan'),40,-100,40))
        for n in (0,101,float('inf')):
            with self.assertRaises(ValueError):s.join_station({},[],max_distance_m=n)
        with self.assertRaises(ValueError):s.observation_reference({**retained(),'station_id':'unknown'})

    def test_enrichment_preserves_grade_center_and_input(self):
        obs=observation();before=copy.deepcopy(obs)
        out,reasons=s.annotate_candidate(obs,retained(),self.join())
        self.assertEqual(obs,before)
        self.assertEqual(out['vehicle_basis']['vehicle_class'],'all_vehicles')
        self.assertEqual(out['estimate'],obs['estimate']);self.assertEqual(out['evidence_grade'],obs['evidence_grade'])
        interval=attach_observation_interval(out)['observation_uncertainty']
        self.assertEqual(interval['status'],'unavailable');self.assertIn('interval_evidence_unavailable',interval['reasons'])
        self.assertNotIn('vehicle_class_unavailable',interval['reasons'])

    def test_year_and_value_mismatch_no_transfer(self):
        for record in ({**ca_record(),'year':2024},{**ca_record(),'ahead_aadt':101}):
            out,reasons=s.annotate_candidate(observation(),retained(),self.join(record))
            self.assertNotIn('vehicle_class',out['vehicle_basis']);self.assertTrue(reasons)

    def test_cdot_station_type_not_historical_observation(self):
        obs=observation()
        out,reasons=s.annotate_candidate(obs,retained(),{'status':'associated','record':{**ca_record(),'source':'cdot','collection_type':'continuous','year':2023}})
        self.assertEqual(out,obs);self.assertIn('historical_observation_year_unbound',reasons)

    def test_unmatched_keeps_input_and_section_ambiguity(self):
        obs=observation();out,reasons=s.annotate_candidate(obs,retained(),{'status':'unmatched'})
        self.assertEqual(out,obs);self.assertEqual(reasons,['station_unmatched'])
        r={**ca_record(),'back_aadt':90}
        out,reasons=s.annotate_candidate(obs,retained(),self.join(r))
        self.assertIn('back_ahead_section_scope_unresolved',reasons)
        self.assertEqual(out['estimate']['center'],100)


if __name__=='__main__': unittest.main()
