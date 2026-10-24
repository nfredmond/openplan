"""Exercise admission with synthetic file records and isolated source mutations."""
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).with_name('run.py')

def module(text=None):
    m=types.ModuleType('controller');m.__file__=str(SOURCE)
    exec(compile(text or SOURCE.read_text(),str(SOURCE),'exec'),m.__dict__)
    return m

class AdmissionTests(unittest.TestCase):
    def fixture(self, broken=None, source_text=None):
        m=module(source_text)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            def source(name): return root/Path(name).name
            fixtures={
                'input-column-scan.json':{'inputs':{'inputs-full/households.csv':{'candidate_sha256':'good'}}},
                'input-freeze.json':{'inputs':{'bundle':{'persons.csv':'good'},'inputs-2000':{}}},
                'columns-parity.json':{'status':'failed' if broken=='proof-status' else 'passed_exact_parity','cache_sha256':'good'},
            }
            for arm in ['current','semcog']:
                fixtures[f'columns-2000-{arm}.comparison.json']={'status':'failed' if broken=='receipt-status' else 'passed_exact_parity','tables':{'table':'unchanged'}}
            for name,data in fixtures.items():(root/name).write_text(json.dumps(data))
            def digest(p):
                if broken=='reduced' and p==m.PRIOR/'inputs-full/households.csv':return 'changed'
                if broken=='frozen' and p==m.INPUT/'bundle/persons.csv':return 'changed'
                if broken=='cache' and p==m.CACHE:return 'changed'
                return 'good'
            parity=types.ModuleType('activitysim_chunk_parity')
            parity.compare_tables=lambda a,b:{'table':'changed' if broken=='tables' else 'unchanged'}
            with patch.object(m,'source',side_effect=source),patch.object(m,'digest',side_effect=digest),patch.object(m,'save') as save,patch.dict('sys.modules',{'activitysim_chunk_parity':parity}):
                if broken:
                    with self.assertRaisesRegex(RuntimeError, {'reduced':'Reduced input','frozen':'Frozen input','cache':'Cache or parity','proof-status':'Cache or parity','receipt-status':'Exact parity','tables':'Exact parity'}[broken]):m.verify()
                    save.assert_not_called()
                else:
                    m.verify();save.assert_called_once()
    def test_valid(self):self.fixture()
    def test_reduced_input(self):self.fixture('reduced')
    def test_frozen_input(self):self.fixture('frozen')
    def test_cache(self):self.fixture('cache')
    def test_proof_status(self):self.fixture('proof-status')
    def test_receipt_status(self):self.fixture('receipt-status')
    def test_tables(self):self.fixture('tables')

if __name__=='__main__': unittest.main()
