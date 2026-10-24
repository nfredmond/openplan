"""Synthetic custody checks cannot establish scientific accuracy or full-scale parity."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import prove
import full
import reductions

# Mutation controls compile an isolated module namespace, never edit a running source file.
mutation = os.environ.get('PRECHUNK_MUTATION', '')
variants = {
    'input': (prove, 'if m.digest(m.INPUT/folder/name) != expected:', 'if False:'),
    'reduced': (prove, "if m.digest(m.R/name) != row['candidate_sha256']:", 'if False:'),
    'reference': (prove, "if {p.name:m.digest(p) for p in reference.glob('final_*.csv')} != expected:", 'if False:'),
    'coverage': (prove, "if 'initial_row_size is zero' in log:", 'if False:'),
    'status': (full, "proof.get('status') != 'passed_exact_parity'", 'False'),
    'cache': (full, "proof.get('cache_sha256') != m.digest(CACHE)", 'False'),
    'custody': (full, "receipt.get('status') != 'passed_exact_parity' or tables != receipt['tables']", 'False'),
    'scan': (reductions, 'if any(hits.get(c) for c in removed):', 'if False:'),
    'exact': (prove, 'tables = compare_tables(reference, out)', 'tables = []'),
    'stop': (full, '            raise\n', '            pass\n'),
}
if mutation:
    if mutation == 'harmless':
        module, before, after = prove, None, None
    else:
        module, before, after = variants[mutation]
    source = Path(module.__file__).read_text()
    if before is None:
        source += '\n# Harmless comment in isolated compilation.\n'
    else:
        assert source.count(before) == 1
        source = source.replace(before, after)
    exec(compile(source, module.__file__, 'exec'), module.__dict__)


class Guards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.e = self.root/'evidence'
        self.e.mkdir()
        self.inputs = self.root/'inputs'
        self.r = self.root/'runtime'
        self.r.mkdir()
        self.old = self.root/'old'
        self.old.mkdir()
        self.patch(prove, 'E', self.e)
        self.patch(full, 'E', self.e)
        self.patch(prove, 'OLD_R', self.old)
        self.patch(full, 'OLD_R', self.old)
        self.patch(prove.m, 'INPUT', self.inputs)
        self.patch(prove.m, 'R', self.r)
        self.patch(prove.m, 'E', self.e)
        freeze = {}
        for folder in ['bundle','inputs-2000']:
            p = self.inputs/folder
            p.mkdir(parents=True)
            (p/'data.csv').write_text('frozen')
            freeze[folder] = {'data.csv':prove.m.digest(p/'data.csv')}
        p = self.root/'choice-parity-evidence'
        p.mkdir()
        (p/'input-freeze.json').write_text(json.dumps({'inputs':freeze}))
        (self.r/'reduced.csv').write_text('reduced')
        self.write('input-column-scan.json', {'inputs':{'reduced.csv':{'candidate_sha256':prove.m.digest(self.r/'reduced.csv')}}})
        self.cache = self.r/'cache.csv'
        self.cache.write_text('sizes')
        self.patch(full, 'CACHE', self.cache)
        self.patch(prove, 'CACHE', self.cache)
        self.write('columns-parity.json', {'status':'passed_exact_parity','cache_sha256':prove.m.digest(self.cache)})
        self.tables = [{'value_identical':True,'candidate_sha256':'abc','reference_sha256':'def'}]
        for arm in ['current','semcog']:
            self.write('columns-2000-'+arm+'.comparison.json', {'status':'passed_exact_parity','tables':self.tables})

    def patch(self, obj, key, value):
        p = patch.object(obj, key, value)
        p.start()
        self.addCleanup(p.stop)

    def write(self, name, value):
        (self.e/name).write_text(json.dumps(value))

    def test_intact(self):
        prove.verify_inputs()
        with patch.object(full,'compare_tables',return_value=self.tables):
            full.admit('columns')

    def test_input(self):
        (self.inputs/'bundle/data.csv').write_text('changed')
        with self.assertRaisesRegex(RuntimeError,'Frozen input custody'):
            prove.verify_inputs()

    def test_reduced(self):
        (self.r/'reduced.csv').write_text('changed')
        with self.assertRaisesRegex(RuntimeError,'Reduced input custody'):
            prove.verify_inputs()

    def test_status(self):
        self.write('columns-parity.json', {'status':'failed','cache_sha256':prove.m.digest(self.cache)})
        with patch.object(full,'compare_tables',return_value=self.tables):
            with self.assertRaisesRegex(RuntimeError,'Exact parity/cache'):
                full.admit('columns')

    def test_cache(self):
        self.cache.write_text('changed')
        with patch.object(full,'compare_tables',return_value=self.tables):
            with self.assertRaisesRegex(RuntimeError,'Exact parity/cache'):
                full.admit('columns')

    def test_custody(self):
        with patch.object(full,'compare_tables',return_value=[{'changed':True}]):
            with self.assertRaisesRegex(RuntimeError,'Exact reference/candidate custody'):
                full.admit('columns')

    def run_proof_fixture(self, changed_reference=False, missing_cache=False, exact_failure=False):
        p = self.root/'chunk-cause-evidence'
        p.mkdir()
        for arm, ref in [('current','r2-2000-current-reference'), ('semcog','r3-2000-semcog-reference')]:
            d = self.old/ref
            d.mkdir()
            (d/'final_trips.csv').write_text('fixture')
            (p/(ref+'.run.json')).write_text(json.dumps({'final_files':{'final_trips.csv':'wrong' if changed_reference else prove.m.digest(d/'final_trips.csv')}}))
            (self.e/('columns-2000-'+arm+'-prefix.engine.log')).write_text('Running chunk 2 of 2\n'+('initial_row_size is zero' if missing_cache else ''))
        with patch.object(prove,'run'), patch.object(prove,'config'), patch.object(prove,'output',return_value=self.r), patch.object(prove,'compare_tables',return_value=self.tables,side_effect=AssertionError('one ULP') if exact_failure else None):
            prove.prove('columns')

    def test_reference(self):
        with self.assertRaisesRegex(RuntimeError,'Reference custody'):
            self.run_proof_fixture(changed_reference=True)

    def test_coverage(self):
        with self.assertRaisesRegex(RuntimeError,'Production cache coverage'):
            self.run_proof_fixture(missing_cache=True)

    def test_exact(self):
        with self.assertRaisesRegex(AssertionError,'one ULP'):
            self.run_proof_fixture(exact_failure=True)

    def test_full_failure_stops(self):
        with patch.object(full,'admit'), patch.object(full,'config'), patch.object(full,'output',return_value=self.r), patch.object(full,'run',side_effect=RuntimeError('engine failure')) as run:
            with self.assertRaisesRegex(RuntimeError,'engine failure'):
                full.main('columns')
            self.assertEqual(run.call_count,1)
        records = json.loads((self.e/'full-runs.json').read_text())
        self.assertEqual(records[0]['status'],'failed')
        self.assertEqual(records[1]['status'],'not_run')

    def test_scan(self):
        stock = self.root/'stock'
        stock.mkdir()
        (stock/'spec.csv').write_text('Target,Expression\nx,unused + 1\n')
        cfg = self.inputs/'bundle/configs'
        cfg.mkdir()
        (cfg/'settings.yaml').write_text('input_table_list:\n- filename: data.csv\n  index_col: id\n  keep_columns: [value]\n')
        for path in [self.inputs/'bundle', self.inputs/'inputs-2000']:
            (path/'data.csv').write_text('id,value,unused\n1,2,3\n')
        memory = self.root/'memory'
        (memory/'inputs-20000').mkdir(parents=True)
        (memory/'inputs-20000/data.csv').write_text('id,value,unused\n1,2,3\n')
        with patch.object(reductions.m,'STOCK',stock), patch.object(reductions,'MEMORY_R',memory):
            with self.assertRaisesRegex(RuntimeError,'Removed field appears'):
                reductions.prepare_inputs()


if __name__ == '__main__':
    unittest.main()
