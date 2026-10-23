import csv
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import census_bulk_inputs as bulk
import census_pums as cp

PROFILE = {'acs_summary_endpoint': 'https://api.census.gov/data/2019/acs/acs5', 'pums_endpoint': 'https://api.census.gov/data/2019/acs/acs5/pums'}

class BulkInputs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.pumas = [{'state_fips':'01','puma':'00100','vintage':'2010','name':'fixture'}]
        self.hh = dict.fromkeys(cp.PUMS_HOUSEHOLD_VARIABLES, '1')
        self.hh.update(SERIALNO='H1',NP='1',ST='01',PUMA='00100',ADJINC='1000000')
        self.person = dict.fromkeys(cp.PUMS_PERSON_VARIABLES,'1')
        self.person.update(SERIALNO='H1',ST='01',PUMA='00100',RELP='0')

    def archive(self, name, records):
        text = io.StringIO(); writer = csv.DictWriter(text,fieldnames=list(records[0]));writer.writeheader();writer.writerows(records)
        path = self.root/(name+'.zip')
        with zipfile.ZipFile(path,'w') as z:z.writestr('psam_'+name+'.csv',text.getvalue())
        return path

    def read(self, hh=None, people=None, pumas=None):
        return bulk.read_pums(self.archive('h',hh or [self.hh]),self.archive('p',people or [self.person]),pumas or self.pumas,PROFILE)

    def test_join_projects_only_required_fields_and_keeps_adjustment(self):
        rows, summary = self.read(people=[{**self.person,'JWTR':'DO_NOT_READ'}])
        self.assertEqual(rows[0]['ADJINC'],'1000000')
        self.assertNotIn('JWTR',rows[0])
        self.assertEqual(summary['person_records'],1)
        self.assertEqual(rows[0]['SERIALNO'],'H1')

    def test_duplicate_household(self):
        with self.assertRaisesRegex(ValueError,'Duplicate PUMS household'):self.read(hh=[self.hh,self.hh])

    def test_duplicate_person(self):
        with self.assertRaisesRegex(ValueError,'Duplicate person'):self.read(people=[self.person,self.person])

    def test_missing_person(self):
        with self.assertRaisesRegex(ValueError,'count differs'):self.read(hh=[{**self.hh,'NP':'2'}])

    def test_orphan_person_and_group_quarters(self):
        orphan={**self.person,'SERIALNO':'G1'}
        with self.assertRaisesRegex(ValueError,'matching household'):self.read(people=[orphan])
        rows,_=self.read(people=[self.person,{**orphan,'RELP':'16'}]);self.assertEqual(len(rows),1)

    def test_wrong_vintage_and_empty_area(self):
        with self.assertRaisesRegex(ValueError,'vintage differs'):self.read(pumas=[{**self.pumas[0],'vintage':'2020'}])
        with self.assertRaisesRegex(ValueError,'omit selected PUMAs'):self.read(pumas=[{**self.pumas[0],'puma':'99999'}])

    def test_partial_puma_coverage_refuses(self):
        with self.assertRaisesRegex(ValueError,'omit selected PUMAs'):
            self.read(pumas=self.pumas+[{**self.pumas[0],'state_fips':'02'}])

    def test_puma_join_and_no_residents(self):
        hh2={**self.hh,'SERIALNO':'H2','PUMA':'00200','NP':'0'}
        with self.assertRaisesRegex(ValueError,'PUMA join mismatch'):
            self.read(hh=[self.hh,hh2],people=[{**self.person,'PUMA':'00200'}],
                pumas=self.pumas+[{**self.pumas[0],'puma':'00200'}])
        with self.assertRaisesRegex(ValueError,'No household residents'):
            self.read(hh=[{**self.hh,'NP':'0'}],people=[{**self.person,'SERIALNO':'G1','RELP':'16'}])

    def test_pums_member_count(self):
        archive=self.archive('h',[self.hh])
        with zipfile.ZipFile(archive,'a') as z:z.writestr('psam_extra.csv','SERIALNO\n')
        with self.assertRaisesRegex(ValueError,'one PUMS CSV'):
            bulk.read_pums(archive,self.archive('p',[self.person]),self.pumas,PROFILE)

    def test_lookup_missing_start_duplicate_and_dual_vintage(self):
        row={'Table ID':'B00001','Sequence Number':'0001','Line Number':'1','Start Position':''}
        with self.assertRaisesRegex(ValueError,'lacks table start'):
            bulk.sequence_cells([row],['B00001_001E'])
        with self.assertRaisesRegex(ValueError,'Duplicate sequence cell'):
            bulk.sequence_cells([{**row,'Start Position':'7'},row],['B00001_001E'])
        profile={k:v.replace('2019','2022') for k,v in PROFILE.items()}
        with self.assertRaisesRegex(ValueError,'one PUMA vintage'):
            bulk.read_pums(Path('unused'),Path('unused'),self.pumas,profile)

    def test_geography_identity_not_row_order(self):
        row=['ACSSF','AA','140','00','0000009']+['']*5+['14000US01001000100']
        self.assertEqual(bulk.geography_logrecs([row],{'01001000100'}),{'0000009':'01001000100'})
        with self.assertRaisesRegex(ValueError,'Duplicate'):bulk.geography_logrecs([row,row],{'01001000100'})
        with self.assertRaisesRegex(ValueError,'every requested'):bulk.geography_logrecs([row],{'01001000200'})

    def test_sequence_positions_estimates_margins_and_identity(self):
        lookup=self.root/'lookup.txt'
        fields=['Table ID','Sequence Number','Line Number','Start Position']
        with lookup.open('w') as f:
            w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows([
                dict(zip(fields,['B00001','0001','','8'])),dict(zip(fields,['B00001','0001','1',''])),dict(zip(fields,['B00001','0001','2','']))])
        geo=self.root/'geo.csv';geo.write_text('ACSSF,AA,140,00,0000009,14000US01001000100\n')
        archive=self.root/'sequence.zip'
        def write(seq='0001',duplicate=False):
            with zipfile.ZipFile(archive,'w') as z:
                for prefix,values in [('e','100,7,8,99'),('m','900,2,3,98')]:
                    line=f'ACSSF,20195,AA,000,{seq},0000009,{values}\n'
                    z.writestr(prefix+'fixture.txt',line*(2 if duplicate else 1))
        variables=['B00001_001E','B00001_002M']
        write();actual=bulk.read_sequence_controls(geo,lookup,{'0001':archive},{'01001000100'},variables)
        self.assertEqual(actual,{'01001000100':{'B00001_001E':'7','B00001_002M':'3'}})
        write('0002')
        with self.assertRaisesRegex(ValueError,'Sequence identity'):bulk.read_sequence_controls(geo,lookup,{'0001':archive},{'01001000100'},variables)
        write(duplicate=True)
        with self.assertRaisesRegex(ValueError,'Duplicate sequence'):bulk.read_sequence_controls(geo,lookup,{'0001':archive},{'01001000100'},variables)
        write()
        with zipfile.ZipFile(archive,'w') as z:
            z.writestr('efixt.txt','ACSSF,20195,AA,000,0001,0000098,1,2,3,4\n')
            z.writestr('mfixt.txt','ACSSF,20195,AA,000,0001,0000098,1,2,3,4\n')
        with self.assertRaisesRegex(ValueError,'omits requested'):
            bulk.read_sequence_controls(geo,lookup,{'0001':archive},{'01001000100'},variables)
        with zipfile.ZipFile(archive,'w') as z:z.writestr('unrecognized.txt','')
        with self.assertRaisesRegex(ValueError,'one estimate or margin'):
            bulk.read_sequence_controls(geo,lookup,{'0001':archive},{'01001000100'},variables)
        with zipfile.ZipFile(archive,'w') as z:z.writestr('efixt.txt','ACSSF,20195,AA,000,0001,0000009\n')
        with self.assertRaisesRegex(ValueError,'row width'):
            bulk.read_sequence_controls(geo,lookup,{'0001':archive},{'01001000100'},variables)
        with lookup.open() as f:
            with self.assertRaisesRegex(ValueError,'Missing sequence'):bulk.sequence_cells(csv.DictReader(f),['B99999_001E'])

if __name__=='__main__':unittest.main()
