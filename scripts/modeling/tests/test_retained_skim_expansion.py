"""Supplied-byte custody checks; no claim about matrix scientific validity."""
import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import retained_skim_expansion as retained


class RetainedExpansion(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.cache = self.root / 'cache'; self.cache.mkdir()
        stock = self.root / 'stock'; stock.mkdir(); (stock / 'settings.yaml').write_text('settings')
        source = self.root / 'source.omx'; source.write_bytes(b'synthetic source')
        stock_skim = self.root / 'stock.omx'; stock_skim.write_bytes(b'synthetic stock')
        self.args = dict(source_omx=source, internal_zone_rows=[{'zone_id': 1, 'area': 2}],
                         centroid_map={1: 99}, stock_configs_dir=stock,
                         stock_skims_omx=stock_skim, transit_config={'source': 'synthetic'})
        self.out = self.root / 'output/mtc_skims.omx'
        for name in ['mtc_skims.omx', 'transit_skims.npz']:
            (self.cache / name).write_bytes(('synthetic '+name).encode())
        self.record = {'inputs': retained.expansion_inputs(**self.args), 'accounting': {'matrices_written': 2},
                       'artifacts': {p.name: {'sha256': retained.sha256_for_file(p), 'bytes': p.stat().st_size}
                                     for p in self.cache.iterdir()}}
        self.save()

    def save(self):
        (self.cache / 'record.json').write_text(json.dumps(self.record))

    def test_exact_copy_and_accounting(self):
        actual = retained.copy_expansion(self.cache, output_omx=self.out, **self.args)
        self.assertEqual(actual, {'matrices_written': 2})
        for name in self.record['artifacts']:
            self.assertEqual((self.out.parent/name).read_bytes(), (self.cache/name).read_bytes())

    def test_launch_directory_does_not_change_input_identity(self):
        before = retained.expansion_inputs(**self.args)
        old = Path.cwd()
        try:
            os.chdir(self.root)
            try:
                actual = retained.expansion_inputs(**self.args)
            except FileNotFoundError as exc:
                self.fail('Implementation identity depends on launch directory: '+str(exc))
            self.assertEqual(actual, before)
            self.assertEqual(retained.copy_expansion(self.cache, output_omx=self.out, **self.args),
                             {'matrices_written': 2})
        finally:
            os.chdir(old)

    def test_request_changes_refuse_before_write(self):
        changes = {'zone_rows': [], 'centroid_map': {}, 'transit_config': {},
                   'source_omx_sha256': 'bad', 'stock_configs_sha256': 'bad',
                   'stock_skims_sha256': 'bad', 'implementations': {}}
        original = copy.deepcopy(self.record)
        for key, value in changes.items():
            with self.subTest(key=key):
                self.record = copy.deepcopy(original); self.record['inputs'][key] = value; self.save()
                with self.assertRaisesRegex(ValueError, 'inputs differ'):
                    retained.copy_expansion(self.cache, output_omx=self.out, **self.args)
                self.assertFalse(self.out.exists())

    def test_artifact_and_inventory_changes_refuse(self):
        original = copy.deepcopy(self.record)
        for key, value in [('sha256', 'bad'), ('bytes', 0)]:
            self.record = copy.deepcopy(original); self.record['artifacts']['mtc_skims.omx'][key] = value; self.save()
            with self.assertRaisesRegex(ValueError, 'hash or size'):
                retained.copy_expansion(self.cache, output_omx=self.out, **self.args)
            self.assertFalse(self.out.exists())
        self.record = copy.deepcopy(original); del self.record['artifacts']['transit_skims.npz']; self.save()
        with self.assertRaisesRegex(ValueError, 'inventory'):
            retained.copy_expansion(self.cache, output_omx=self.out, **self.args)
        self.assertFalse(self.out.exists())

    def test_existing_destination_refuses_unchanged(self):
        self.out.parent.mkdir(); self.out.write_bytes(b'keep')
        with self.assertRaisesRegex(ValueError, 'must be new'):
            retained.copy_expansion(self.cache, output_omx=self.out, **self.args)
        self.assertEqual(self.out.read_bytes(), b'keep')


if __name__ == '__main__': unittest.main()
