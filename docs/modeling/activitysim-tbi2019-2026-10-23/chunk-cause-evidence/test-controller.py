"""Controller refusal tests. Engine choices require the separate native proof."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('hybrid', Path(__file__).with_name('run-hybrid.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ControllerTests(unittest.TestCase):
    def fixture(self, root):
        e = root / 'study/evidence'; e.mkdir(parents=True)
        prior = e.parent / 'choice-parity-evidence'; prior.mkdir()
        inputs = root / 'inputs'; (inputs / 'bundle/configs').mkdir(parents=True)
        (inputs / 'bundle/configs/settings.yaml').write_text('models: [trip_purpose_and_destination, trip_scheduling, trip_mode_choice, write_tables]\n')
        (inputs / 'parity-inputs').mkdir(); (inputs / 'parity-inputs/households.csv').write_text('frozen')
        freeze = {'inputs': {'parity-inputs': {'households.csv': m.digest(inputs / 'parity-inputs/households.csv')}}}
        (prior / 'input-freeze.json').write_text(json.dumps(freeze))
        (e / 'criterion.json').write_text('{}')
        old = root / 'old'; (old / 'parity-current-training/cache').mkdir(parents=True)
        (old / 'parity-current-training/cache/chunk_cache.csv').write_text('cache')
        runs = root / 'runs'; runs.mkdir()
        (runs / 'training-2000-prefix/cache').mkdir(parents=True)
        (runs / 'training-2000-prefix/cache/chunk_cache.csv').write_text('cache')
        return e, inputs, old, runs

    def execute(self, broken=None):
        with tempfile.TemporaryDirectory() as tmp:
            e, inputs, old, runs = self.fixture(Path(tmp))
            calls = []
            def run(name, cfg, data, output):
                calls.append(name)
                text = 'Running chunk 1 of 2\nRunning chunk 2 of 2\n'
                if broken == 'cache': text += 'initial_row_size is zero\n'
                (e / (name + '.stdout.log')).write_text(text)
                (output / 'pipeline.parquetpipeline').mkdir(exist_ok=True)
                return {}
            if broken == 'input':
                (inputs / 'parity-inputs/households.csv').write_text('changed')
            with patch.multiple(m, E=e, INPUT=inputs, OLD=old, R=runs), patch.object(m, 'config', return_value=runs), patch.object(m, 'run', side_effect=run), patch.object(m, 'compare', return_value=broken != 'choice'):
                if broken in ['input', 'cache']:
                    with self.assertRaisesRegex(RuntimeError, 'Frozen input hash mismatch' if broken == 'input' else 'Production cache coverage missing'):
                        m.proof()
                    self.assertEqual(calls, [] if broken == 'input' else ['r3-64-current-reference', 'r3-64-current-prefix'])
                elif broken == 'choice':
                    self.assertEqual(m.proof(), 2)
                    self.assertEqual(calls, ['r3-64-current-reference', 'r3-64-current-prefix', 'r3-64-current-suffix'])
                    self.assertFalse(json.loads((e / 'hybrid-result.json').read_text())['full_runs_authorized'])
                else:
                    self.assertEqual(m.proof(), 0)
                    self.assertEqual(len(calls), 12)
                    self.assertTrue(json.loads((e / 'hybrid-result.json').read_text())['full_runs_authorized'])

    def test_reference_custody(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cfg = root / 'config'; cfg.mkdir()
            (cfg / 'settings.yaml').write_text('frozen settings')
            output = root / 'reference'; output.mkdir()
            table = output / 'final_trips.csv'; table.write_text('frozen reference')
            record = {'exit_code': 0, 'final_files': {table.name: m.digest(table)},
                      'config_files': {'settings.yaml': m.digest(cfg / 'settings.yaml')}}
            receipt = root / 'reference.run.json'; receipt.write_text(json.dumps(record))
            with patch.multiple(m, E=root, R=root):
                self.assertEqual(m.reuse_reference('reference', cfg), output)
                table.write_text('changed reference')
                with self.assertRaisesRegex(RuntimeError, 'Reference custody mismatch'):
                    m.reuse_reference('reference', cfg)
                table.write_text('frozen reference')
                (cfg / 'settings.yaml').write_text('changed settings')
                with self.assertRaisesRegex(RuntimeError, 'Reference custody mismatch'):
                    m.reuse_reference('reference', cfg)
                (cfg / 'settings.yaml').write_text('frozen settings')
                record['exit_code'] = 99; receipt.write_text(json.dumps(record))
                with self.assertRaisesRegex(RuntimeError, 'Reference custody mismatch'):
                    m.reuse_reference('reference', cfg)

    def test_engine_error_remains_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cfg = root / 'config'; cfg.mkdir()
            output = root / 'output'; output.mkdir()
            with patch.object(m, 'E', root), patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=99)):
                with self.assertRaisesRegex(RuntimeError, 'Engine failure in fixture'):
                    m.run('fixture', cfg, root, output)
            self.assertEqual(json.loads((root / 'fixture.run.json').read_text())['exit_code'], 99)

    def test_input_refusal_precedes_execution(self): self.execute('input')
    def test_cache_refusal_precedes_suffix(self): self.execute('cache')
    def test_choice_refusal_precedes_next_arm(self): self.execute('choice')
    def test_all_four_comparisons_required(self): self.execute()


if __name__ == '__main__': unittest.main()
