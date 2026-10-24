"""Final-table comparison catches a one-ULP mismatch and missing tables."""
import sys,unittest,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from activitysim_chunk_parity import compare_tables


class ChunkParityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.a=Path(self.tmp.name)/'a';self.b=Path(self.tmp.name)/'b';self.a.mkdir();self.b.mkdir()
        for name in ['land_use','accessibility','households','persons','tours','trips','joint_tour_participants']:
            for folder in [self.a,self.b]:(folder/f'final_{name}.csv').write_text('id,value\n1,1.0\n2,2.0\n')

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

    def test_missing_or_extra_table_refuses(self):
        p=self.b/'final_other.csv';p.write_text('id\n1\n')
        with self.assertRaisesRegex(AssertionError,'census'):compare_tables(self.a,self.b)
        p.unlink();(self.b/'final_trips.csv').unlink()
        with self.assertRaisesRegex(AssertionError,'census'):compare_tables(self.a,self.b)

    def test_changed_column_and_row_refuse(self):
        p=self.b/'final_tours.csv';p.write_text('id,other\n1,1.0\n2,2.0\n')
        with self.assertRaisesRegex(AssertionError,'Exact final-table'):compare_tables(self.a,self.b)
        p.write_text('id,value\n1,1.0\n')
        with self.assertRaisesRegex(AssertionError,'Exact final-table'):compare_tables(self.a,self.b)


if __name__=='__main__':unittest.main()
