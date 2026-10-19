"""Protect lightweight discovery without importing the native engine."""
import ast
import importlib.abc
import io
from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import patch

WORKER = Path(__file__).resolve().parent
NATIVE = WORKER / 'native_tests'


class NoEngine(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] == 'aequilibrae':
            raise ImportError('Native engine is absent from the lightweight cohort')


class NativeGraphCohortTests(unittest.TestCase):
    def test_root_graph_suites_load_with_native_engine_unavailable(self):
        self.assertNotIn('aequilibrae', sys.modules)
        with patch.object(sys, 'meta_path', [NoEngine(), *sys.meta_path]):
            for source in sorted(WORKER.glob('test_assignment_graph*.py')):
                runpy.run_path(str(source))
            guard = runpy.run_path(str(WORKER / 'test_assignment_compact_graph.py'))
            suite = unittest.defaultTestLoader.loadTestsFromTestCase(guard['CompactGraphTests'])
            result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
        self.assertEqual(result.testsRun, 8)
        self.assertTrue(result.wasSuccessful())
        self.assertEqual(result.skipped, [])

    def test_native_cases_and_dedicated_ci_entry_remain_explicit(self):
        source = NATIVE / 'test_assignment_graph_adapter.py'
        tree = ast.parse(source.read_text())
        cases = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')]
        self.assertGreaterEqual(len(cases), 15)
        self.assertFalse((WORKER / source.name).exists())
        runner = runpy.run_path(str(NATIVE / 'run_compact_graph.py'))
        versions = runner['declared_versions']()
        self.assertEqual(versions['aequilibrae'], '1.6.2')
        self.assertEqual(versions['numpy'], '2.0.2')
        self.assertEqual(versions['pandas'], '2.3.3')
        workflow = (WORKER.parents[1] / '.github/workflows/compact-graph-native.yml').read_text()
        self.assertIn('python-version: "3.11.15"', workflow)
        self.assertIn('-r workers/aequilibrae_worker/native_tests/requirements.txt', workflow)
        self.assertIn('"$python_path" -B workers/aequilibrae_worker/native_tests/run_compact_graph.py', workflow)
        self.assertNotIn('continue-on-error', workflow)


if __name__ == '__main__': unittest.main()
