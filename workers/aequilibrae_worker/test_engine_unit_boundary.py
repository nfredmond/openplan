"""Unit fixtures must restore engine imports and refuse numerical computation."""
import sys
import unittest
from unittest.mock import Mock
from worker_import_for_tests import mock_engine_runtime


class EngineUnitBoundaryTests(unittest.TestCase):
    def test_restores_modules_even_after_interruption(self):
        names = ('aequilibrae', 'aequilibrae.matrix', 'aequilibrae.paths')
        before = {name: sys.modules.get(name) for name in names}
        factory = Mock(return_value=object())
        with self.assertRaises(KeyboardInterrupt):
            with mock_engine_runtime(factory):
                from aequilibrae import Project
                self.assertIs(Project, factory)
                raise KeyboardInterrupt()
        for name in names:
            self.assertIs(sys.modules.get(name), before[name])

    def test_unconfigured_computation_cannot_succeed(self):
        with mock_engine_runtime(Mock()):
            from aequilibrae.matrix import AequilibraeMatrix
            from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming
            for factory in (AequilibraeMatrix, TrafficAssignment, TrafficClass, NetworkSkimming):
                with self.subTest(factory=factory), self.assertRaisesRegex(AssertionError, 'unconfigured native computation'):
                    factory()


if __name__ == '__main__':
    unittest.main()
