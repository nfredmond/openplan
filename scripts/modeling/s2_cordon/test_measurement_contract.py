"""Synthetic result extraction, with no assignment, county input or study opening.

The large fixture crosses NumPy's temporary-elision size threshold. Small
fixtures alone did not expose the Python 3.14 / NumPy 2.0 measurement defect.
"""
from types import SimpleNamespace
import inspect
import textwrap
import unittest
from pathlib import Path
import sys
import json
import tempfile
from unittest.mock import patch

import numpy as np
import pandas as pd
from aequilibrae.paths import TrafficAssignment


def result_fixture(link_count):
    """Supply known solver flows to the installed engine's real result adapter."""
    mapping = SimpleNamespace(
        graph_ab_idx=np.arange(link_count), graph_ba_idx=np.arange(link_count, 2 * link_count),
        network_ab_idx=np.arange(link_count), network_ba_idx=np.arange(link_count))
    class_results = SimpleNamespace(
        get_load_results=lambda: pd.DataFrame({
            'demand_ab': np.full(link_count, 180.),
            'demand_ba': np.full(link_count, 180.),
            'demand_tot': np.full(link_count, 360.)}, index=np.arange(link_count)),
        get_graph_to_network_mapping=lambda: mapping)
    return SimpleNamespace(
        classes=[SimpleNamespace(graph=SimpleNamespace(graph=pd.DataFrame({
            '__supernet_id__': np.arange(2 * link_count)})), results=class_results)],
        assignment=SimpleNamespace(fw_total_flow=np.full(2 * link_count, 180.), preload=None),
        capacity=np.full(2 * link_count, 600.),
        congested_time=np.ones(2 * link_count), free_flow_tt=np.ones(2 * link_count))


class MeasurementContractTests(unittest.TestCase):
    def test_synthetic_lock_uses_test_interpreter(self):
        sys.path.insert(0, str(Path(__file__).parent))
        import test_successor
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry, _, _ = test_successor.fixture(root)
            lock = json.loads(test_successor.synthetic_lock(root, registry).read_text())
            for kind in ('evaluator', 'validator'):
                command = lock[kind]['command']
                self.assertEqual(command[command.index('-B') - 1], sys.executable,
                                 'Synthetic lock must use the test interpreter')

    def test_county_assignment_refuses_before_writing_demand(self):
        # Load numerical imports before spoofing the interpreter identity. This
        # fixture tests our refusal, not third-party conditional imports.
        import aequilibrae.matrix
        import aequilibrae.paths
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        import screening_runtime
        with patch.object(sys, 'version_info', (3, 14, 4)), \
             patch.object(screening_runtime, 'ensure_dir', side_effect=AssertionError('Demand output must not be created')) as create, \
             self.assertRaisesRegex(ValueError, 'CPython 3.11'):
            screening_runtime.run_assignment(None, {}, None, None, {})
        create.assert_not_called()

    def test_trace_refuses_a_non_development_county_before_reading(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import trace_retained_measurement as trace
        with patch.object(trace.pd, 'read_csv', side_effect=AssertionError('Unapproved source must not be read')), \
             self.assertRaisesRegex(ValueError, 'five exposed development counties'):
            trace.trace(Path('/unused'), Path('/unused'), 'not-development', Path('/unused'))

    def test_explicit_division_preserves_the_same_flow(self):
        # Diagnostic control only. Do not patch the installed engine or use
        # this one-expression workaround to admit an unsupported runtime.
        source = textwrap.dedent(inspect.getsource(TrafficAssignment.results))
        expression = 'voc = tot_flow / self.capacity[idx]'
        self.assertEqual(source.count(expression), 1)
        source = source.replace(expression,
            'voc = np.divide(tot_flow, self.capacity[idx], out=np.empty_like(tot_flow))')
        namespace = dict(TrafficAssignment.results.__globals__)
        exec(compile(source, '<diagnostic-explicit-division>', 'exec'), namespace)
        frame = namespace['results'](result_fixture(40000))
        self.assertEqual(float(frame.PCE_tot.min()), 360., 'Explicit division must preserve flow')
        self.assertEqual(float(frame.VOC_max.min()), .3)

    def test_small_and_large_results_preserve_pce_flow(self):
        for size in (6, 40000):
            with self.subTest(links=size):
                frame = TrafficAssignment.results(result_fixture(size))
                self.assertEqual(float(frame.PCE_tot.min()), 360.,
                                 'PCE flow must remain 360, not the 0.6 capacity ratio')
                self.assertEqual(float(frame.PCE_tot.max()), 360.)
                self.assertEqual(float(frame.PCE_AB.min()), 180.)
                self.assertEqual(float(frame.PCE_BA.min()), 180.)
                self.assertEqual(float(frame.VOC_max.min()), .3)
                self.assertEqual(float(frame.demand_tot.min()), 360.)


if __name__ == '__main__':
    unittest.main()
