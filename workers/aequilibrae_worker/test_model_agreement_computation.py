"""Retained comparison execution and files, with synthetic scientific outputs."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import model_agreement_computation as subject
from worker_import_for_tests import import_worker_main
main = import_worker_main()
RUN = '11111111-1111-4111-8111-111111111111'
STAGE = '22222222-2222-4222-8222-222222222222'


class AgreementComputation(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.arguments = dict(output_dir=str(self.root / 'output'), force=False,
            first_label='Trip based', second_label='Activity based',
            first_convergence_record={'gap': 0.001}, second_convergence_record={'gap': 0.002})
        for key in ('first_csv', 'second_csv', 'loaded_links_geojson'):
            path = self.root / key
            path.write_text(key)
            self.arguments[key] = str(path)
        self.calls = 0

    def compare(self, **arguments):
        self.calls += 1
        self.assertEqual(arguments['first_convergence_record'], {'gap': 0.001})
        self.assertEqual(arguments['second_convergence_record'], {'gap': 0.002})
        result = {'summary': {'is_average': False, 'call': self.calls}}
        for key, name in subject.OUTPUTS.items():
            path = Path(arguments['output_dir']) / name
            path.write_bytes((name + '\r\n').encode())
            result[key] = str(path)
        return result

    def run_retained(self, compare=None):
        with patch.object(main, 'SUPABASE_URL', 'http://127.0.0.1:54321'), patch.dict(main.os.environ, {'OPENPLAN_DEPLOYMENT_ID': 'synthetic'}):
            return main.retain_agreement_comparison(RUN, STAGE, str(self.root),
                compare=compare or self.compare, **self.arguments)

    def test_exact_repeat_repairs_missing_files_without_recomputing_or_replacing(self):
        original = self.run_retained()
        path = Path(original['json_path'])
        inode = path.stat().st_ino
        self.assertEqual(path.read_bytes(), b'corridor_agreement.json\r\n')
        self.assertEqual(self.run_retained(), original)
        self.assertEqual(path.stat().st_ino, inode)
        Path(original['markdown_path']).unlink()
        self.assertEqual(self.run_retained(), original)
        self.assertEqual(Path(original['markdown_path']).read_bytes(), b'corridor_agreement.md\r\n')
        self.assertEqual(self.calls, 1)
        path.write_bytes(b'altered')
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained()
        self.assertEqual(path.read_bytes(), b'altered')
        self.assertEqual(self.calls, 1)

    def test_changed_inputs_refuse_before_recomputation(self):
        self.run_retained()
        path = Path(self.arguments['first_csv'])
        path.write_text('changed')
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained()
        self.assertEqual(self.calls, 1)
        path.write_text('first_csv')
        self.arguments['second_convergence_record'] = {'gap': 0.01}
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained()
        self.assertEqual(self.calls, 1)

    def test_interrupted_computation_never_restarts_automatically(self):
        def fail(**arguments):
            self.calls += 1
            raise RuntimeError('synthetic interruption')
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained(fail)
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained()
        self.assertEqual(self.calls, 1)
        self.assertFalse(Path(self.arguments['output_dir']).exists())

    def test_changed_source_during_compute_is_not_retained(self):
        def change(**arguments):
            result = self.compare(**arguments)
            Path(arguments['second_csv']).write_text('changed during computation')
            return result
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained(change)
        Path(self.arguments['second_csv']).write_text('second_csv')
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained()
        self.assertEqual(self.calls, 1)
        self.assertFalse(Path(self.arguments['output_dir']).exists())

    def test_real_comparator_retains_timestamp_bytes_and_separate_methods(self):
        import json
        import sys
        scripts = Path(__file__).resolve().parents[2] / 'scripts' / 'modeling'
        sys.path.insert(0, str(scripts / 'tests'))
        from test_compare_behavioral_demand_outputs import (
            ComparingTwoDemandModelsOnOneNetwork, compare_link_volume_runs,
            convergence_record, verified_network_evidence, assignment_evidence_kwargs,
        )
        fixture = ComparingTwoDemandModelsOnOneNetwork()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        self.arguments.update(
            first_csv=str(fixture._links_csv('first.csv', {1: 20000, 2: 500})),
            second_csv=str(fixture._links_csv('second.csv', {1: 20100, 2: 4000})),
            loaded_links_geojson=str(fixture._loaded_links('network.geojson', [1, 2])),
            first_convergence_record=convergence_record(),
            second_convergence_record=convergence_record(),
            **assignment_evidence_kwargs(verified_network_evidence([1, 2])),
        )
        from unittest.mock import Mock
        compare = Mock(wraps=compare_link_volume_runs)
        original = self.run_retained(compare)
        contents = {key: Path(original[key]).read_bytes() for key in subject.OUTPUTS}
        second = self.run_retained(compare)
        self.assertEqual(compare.call_count, 1)
        self.assertEqual(original, second)
        self.assertEqual(contents, {key: Path(second[key]).read_bytes() for key in subject.OUTPUTS})
        payload = json.loads(contents['json_path'])
        self.assertEqual(payload['methods'], {'first': 'Trip based', 'second': 'Activity based'})
        self.assertIn('never averaged', ' '.join(payload['what_this_is_not']))
        self.assertEqual(payload['sources']['first'], self.arguments['first_csv'])
        self.assertIn('generated_at_utc', payload)

    def test_forced_replacement_and_missing_geometry_refuse(self):
        self.arguments['force'] = True
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained()
        self.arguments['force'] = False
        del self.arguments['loaded_links_geojson']
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained()
        self.assertEqual(self.calls, 0)

    def test_escaped_comparator_output_refuses_before_publication(self):
        def escaped(**arguments):
            result = self.compare(**arguments)
            path = self.root / 'escaped.json'
            path.write_text('escaped')
            result['json_path'] = str(path)
            return result
        with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained(escaped)
        self.assertFalse(Path(self.arguments['output_dir']).exists())

    def test_incomplete_saved_record_refuses_before_publication(self):
        with patch.object(subject.computation, 'compute_once', return_value={
                'result': {}, 'records': {'corridor_agreement.json': '7b7d'}}):
            with self.assertRaises(main.WorkerStateWriteUnconfirmed): self.run_retained()
        self.assertFalse(Path(self.arguments['output_dir']).exists())

if __name__ == '__main__': unittest.main()
