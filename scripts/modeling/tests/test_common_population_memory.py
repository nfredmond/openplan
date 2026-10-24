"""Exact retained-byte parity and pre-materialization refusal under streaming."""
import copy,gzip,hashlib,json,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import common_population as common
import test_common_population as supplied

class MemoryParity(unittest.TestCase):
    def setUp(self):
        self.f=supplied.CommonPopulationTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
        root=Path(__file__).parent/'fixtures/common-population-memory-baseline'
        source=gzip.decompress((root/'common_population.py.gz').read_bytes())
        self.assertEqual(hashlib.sha256(source).hexdigest(),json.loads((root/'source.json').read_text())['sha256'])
        self.old=types.ModuleType('retained_memory_baseline');exec(compile(source,'retained_memory_baseline','exec'),self.old.__dict__)

    def test_retained_bytes_and_loaded_rows_match_original(self):
        result=copy.deepcopy(self.f.result)
        result['households'][0].update(persons=2)
        result['persons'].append({**result['persons'][0],'person_id':9,'person_num':2,'is_worker':0,'esr':'6','wkhp':''})
        result['zone_fits']=[{'weights':[0.0,1.123456789,3e-25], 'source':'unicode \u00e9', 'missing':None}]
        old_path=self.f.root/'old';new_path=self.f.directory
        args=dict(source_manifest_path=self.f.source,zone_attributes_path=self.f.zone_file,source_profile=self.f.profile)
        old=self.old.retain_population(old_path,self.f.zones,result,**args)
        new=common.retain_population(new_path,self.f.zones,result,**args)
        self.assertEqual(old,new)
        for name in [common.MANIFEST_NAME,*common.ROLES.values()]:
            self.assertEqual((old_path/name).read_bytes(),(new_path/name).read_bytes(),name)
        a=self.old.read_common_population(old_path,expected_manifest=old,zone_rows=self.f.zones)
        b=common.read_common_population(new_path,expected_manifest=new,zone_rows=self.f.zones)
        for field in ['households','persons','diagnostics','realized_zone_counts','basis']:
            self.assertEqual(a[field],b[field],field)

    def test_descriptor_streams_same_hash_and_length_without_whole_file_read(self):
        path = self.f.root / 'large-diagnostic.json'
        path.write_bytes(b'abcdefg' * 500000)
        expected = self.old.file_descriptor(path, relative_path='diagnostics.json')
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('whole-file read')):
            actual = common.file_descriptor(path, relative_path='diagnostics.json')
        self.assertEqual(actual, expected)

    def test_nonfinite_diagnostic_refuses_before_creating_directory(self):
        self.f.result['zone_fits']=[{'weights':[float('nan')]}]
        with self.assertRaises(ValueError):self.f.retain()
        self.assertFalse(self.f.directory.exists())

if __name__=='__main__':unittest.main()
