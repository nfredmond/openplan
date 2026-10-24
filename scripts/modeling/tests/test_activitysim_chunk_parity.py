"""Final-table comparison catches a one-ULP mismatch and missing tables."""
import sys,unittest,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from activitysim_chunk_parity import compare_tables, chunk_evidence


class ChunkParityTests(unittest.TestCase):
    def test_actual_chunk_splitting_and_no_fallback(self):
        log='Running chunk 1 of 3 with 2 of 6 choosers\nRunning chunk 2 of 3 with 2 of 6 choosers'
        self.assertEqual(chunk_evidence(log)['largest_chunk_ordinal'],2)
        for invalid in ['', 'Running chunk 1 of 1 with 6 of 6 choosers']:
            with self.assertRaisesRegex(AssertionError,'No actual chooser split'):chunk_evidence(invalid)
        for fallback in ['training', 'retraining']:
            with self.assertRaisesRegex(AssertionError,'fell back'):
                chunk_evidence(log+'\nchunk_training_mode falling back to '+fallback)

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.a=Path(self.tmp.name)/'a';self.b=Path(self.tmp.name)/'b';self.a.mkdir();self.b.mkdir()
        for name,key in {'land_use':'zone_id','accessibility':'zone_id','households':'household_id','persons':'person_id','tours':'tour_id','trips':'trip_id','joint_tour_participants':'participant_id'}.items():
            for folder in [self.a,self.b]:(folder/f'final_{name}.csv').write_text(f'value,{key}\n1.0,1\n2.0,2\n')

    def test_identical_and_harmless_line_endings(self):
        self.assertTrue(all(x['byte_identical'] for x in compare_tables(self.a,self.b)))
        p=self.b/'final_trips.csv';p.write_bytes(p.read_bytes().replace(b'\n',b'\r\n'))
        result=compare_tables(self.a,self.b)
        self.assertTrue(all(x['value_identical'] for x in result))
        self.assertFalse(all(x['byte_identical'] for x in result))

    def test_one_ulp_is_a_failure(self):
        p=self.b/'final_persons.csv';p.write_text(p.read_text().replace('1.0','1.0000000000000002'))
        with self.assertRaisesRegex(AssertionError,'Exact final-table parity failed'):
            compare_tables(self.a,self.b)

    def test_row_order_survives_but_duplicate_identity_refuses(self):
        p=self.b/'final_persons.csv';p.write_text('value,person_id\n2.0,2\n1.0,1\n')
        self.assertTrue(all(r['value_identical'] for r in compare_tables(self.a,self.b)))
        for folder in [self.a,self.b]:
            (folder/'final_persons.csv').write_text('value,person_id\n1.0,1\n2.0,1\n')
        with self.assertRaisesRegex(AssertionError,'unambiguous row identity'):
            compare_tables(self.a,self.b)
        for folder in [self.a,self.b]:
            (folder/'final_persons.csv').write_text('value,other_id\n1.0,1\n2.0,2\n')
        with self.assertRaisesRegex(AssertionError,'unambiguous row identity'):
            compare_tables(self.a,self.b)

    def test_missing_or_extra_table_refuses(self):
        p=self.b/'final_other.csv';p.write_text('id\n1\n')
        with self.assertRaisesRegex(AssertionError,'census'):compare_tables(self.a,self.b)
        p.unlink();(self.b/'final_trips.csv').unlink()
        with self.assertRaisesRegex(AssertionError,'census'):compare_tables(self.a,self.b)

    def test_changed_column_and_row_refuse(self):
        p=self.b/'final_tours.csv';p.write_text('other,tour_id\n1.0,1\n2.0,2\n')
        with self.assertRaisesRegex(AssertionError,'Exact final-table'):compare_tables(self.a,self.b)
        p.write_text('value,tour_id\n1.0,1\n')
        with self.assertRaisesRegex(AssertionError,'Exact final-table'):compare_tables(self.a,self.b)


if __name__=='__main__':unittest.main()
