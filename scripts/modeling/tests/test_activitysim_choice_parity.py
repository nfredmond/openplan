"""Exercise choice, tolerance and table-identity boundaries without a model run."""
import math
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from activitysim_choice_parity import IDENTITIES, compare_choices, ParityFailure

class ChoiceParityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.a=Path(self.tmp.name)/'a';self.b=Path(self.tmp.name)/'b';self.a.mkdir();self.b.mkdir()
        for table,key in IDENTITIES.items():
            for root in (self.a,self.b):
                (root/f'final_{table}.csv').write_text(f'{key},choice,destination_logsum\n1,1.0,1.0\n2,2.0,2.0\n')
    def test_harmless_order_and_auxiliary_roundoff(self):
        (self.b/'final_trips.csv').write_text('trip_id,choice,destination_logsum\n2,2.0,2.0\n1,1.0,1.0000000000000002\n')
        result=compare_choices(self.a,self.b)
        self.assertEqual(sum(len(t['tolerated_auxiliary_differences']) for t in result),1)
    def test_tolerated_logsum_does_not_hide_departure_choice(self):
        for root in (self.a,self.b):
            (root/"final_trips.csv").write_text("trip_id,destination_logsum,depart\n914860869,1.0,16\n")
        (self.b/"final_trips.csv").write_text("trip_id,destination_logsum,depart\n914860869,1.0000000000000002,18\n")
        with self.assertRaises(ParityFailure) as error:compare_choices(self.a,self.b)
        self.assertEqual(error.exception.records,[{'table':'final_trips.csv','id':'914860869','column':'depart','reference':'16','candidate':'18'}])
        self.assertEqual(sum(len(t["tolerated_auxiliary_differences"]) for t in error.exception.tables),1)

    def test_choice_one_ulp_refuses(self):
        p=self.b/'final_persons.csv';p.write_text(p.read_text().replace('1,1.0,','1,1.0000000000000002,'))
        with self.assertRaises(ParityFailure) as error:compare_choices(self.a,self.b)
        self.assertEqual(error.exception.records[0]['id'],'1')
        self.assertEqual(error.exception.records[0]['column'],'choice')
    def test_excess_tolerance_and_nonfinite_refuse(self):
        p=self.b/'final_trips.csv';original=p.read_text()
        for value in ('1.000000000002','inf','nan'):
            p.write_text(original.replace('1,1.0,1.0',f'1,1.0,{value}'))
            with self.assertRaises(ParityFailure):compare_choices(self.a,self.b)
    def test_four_ulp_at_zero_survives_five_refuses(self):
        for root in (self.a,self.b):(root/'final_trips.csv').write_text('trip_id,choice,destination_logsum\n1,1,0.0\n')
        p=self.b/'final_trips.csv'
        p.write_text(f'trip_id,choice,destination_logsum\n1,1,{4*math.ulp(0.0)}\n');compare_choices(self.a,self.b)
        p.write_text(f'trip_id,choice,destination_logsum\n1,1,{5*math.ulp(0.0)}\n')
        with self.assertRaises(ParityFailure):compare_choices(self.a,self.b)
    def test_missing_table_refuses(self):
        (self.b/'final_tours.csv').unlink()
        with self.assertRaisesRegex(ParityFailure,'census'):compare_choices(self.a,self.b)
    def test_duplicate_and_changed_ids_refuse(self):
        p=self.b/'final_tours.csv';original=p.read_text()
        for replacement in ('1,2.0','3,2.0'):
            p.write_text(original.replace('2,2.0',replacement))
            with self.assertRaises(ParityFailure):compare_choices(self.a,self.b)
    def test_missing_column_refuses(self):
        p=self.b/'final_households.csv';p.write_text(p.read_text().replace('choice','other'))
        with self.assertRaises(ParityFailure):compare_choices(self.a,self.b)
if __name__=='__main__':unittest.main()
