"""Synthetic conservation and default tests, with no geographic acceptance data."""
import ast
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import external_distribution as subject


class ExternalDistributionTests(unittest.TestCase):
    def setUp(self):
        self.matrix = np.array([[0., 9., 40., 60.], [7., 0., 60., 40.],
                                [40., 60., 5., 8.], [60., 40., 4., 6.]])
        self.times = np.array([[0., 20., 2., 30.], [20., 0., 30., 2.],
                               [2., 30., 0., 10.], [30., 2., 10., 0.]])
        self.mask = np.array([True, True, False, False])

    def candidate(self, **kwargs):
        return subject.condition_external_demand(self.matrix, self.times, self.mask,
                                                  setting=subject.CANDIDATE, **kwargs)

    def test_default_identity_and_bytes(self):
        self.matrix[0, 0] = -0.0
        before = self.matrix.tobytes()
        with patch.dict(os.environ, {}, clear=True):
            actual, record = subject.condition_external_demand(self.matrix, None, None)
        self.assertIs(actual, self.matrix)
        self.assertEqual(actual.tobytes(), before)
        self.assertIsNone(record)

    def test_unknown_setting(self):
        with self.assertRaisesRegex(subject.ExternalDistributionRefused, "Unknown"):
            subject.resolve_setting("typo")

    def test_dimensions(self):
        self.times = self.times[:2]
        with self.assertRaisesRegex(subject.ExternalDistributionRefused, "dimensions"):
            self.candidate()

    def test_input_values(self):
        for value in (-1., np.nan, np.inf):
            with self.subTest(value=value):
                self.matrix[0, 0] = value
                with self.assertRaisesRegex(subject.ExternalDistributionRefused, "Baseline"):
                    self.candidate()

    def test_skim_values(self):
        for value in (-1., np.nan):
            with self.subTest(value=value):
                self.times[0, 0] = value
                with self.assertRaisesRegex(subject.ExternalDistributionRefused, "Skim"):
                    self.candidate()

    def test_conditioning_conservation_and_custody(self):
        before = self.matrix.copy()
        actual, record = self.candidate()
        self.assertGreater(actual[0, 2], before[0, 2])
        self.assertLess(actual[0, 3], before[0, 3])
        np.testing.assert_allclose(actual.sum(axis=0), before.sum(axis=0), rtol=1e-7)
        np.testing.assert_allclose(actual.sum(axis=1), before.sum(axis=1), rtol=1e-7)
        self.assertEqual(self.matrix.tobytes(), before.tobytes())
        self.assertEqual(actual[:2, :2].tobytes(), before[:2, :2].tobytes())
        self.assertEqual(actual[2:, 2:].tobytes(), before[2:, 2:].tobytes())
        self.assertEqual(record["input_sha256"], subject.array_sha256(before))
        self.assertEqual(record["output_sha256"], subject.array_sha256(actual))
        self.assertEqual(record["source"]["skim_sha256"], subject.array_sha256(self.times))
        self.assertGreater(record["changed_cells"], 0)

    def test_unreachable_and_zero_retained(self):
        self.times[0, 2] = np.inf
        self.matrix[1, 2] = 0.
        actual, record = self.candidate()
        self.assertEqual(actual[0, 2], 40.)
        self.assertEqual(actual[1, 2], 0.)
        self.assertEqual(record["unreachable_cross_trips_retained"], 40.)

    def test_nonconvergence(self):
        with patch.object(subject, "MAX_ITERATIONS", 0):
            with self.assertRaisesRegex(subject.ExternalDistributionRefused, "converge"):
                self.candidate()

    def test_candidate_values(self):
        candidate = self.matrix.copy()
        candidate[0, 2] = np.nan
        with self.assertRaisesRegex(subject.ExternalDistributionRefused, "invalid"):
            subject.validate_candidate(self.matrix, candidate, np.ones((4, 4), dtype=bool))

    def test_fixed_cells(self):
        candidate = self.matrix.copy()
        candidate[0, 1] += 1
        with self.assertRaisesRegex(subject.ExternalDistributionRefused, "held-fixed"):
            subject.validate_candidate(self.matrix, candidate, self.mask[:, None] != self.mask)

    def test_support(self):
        candidate = self.matrix.copy()
        candidate[0, 0] = 1e-12
        with self.assertRaisesRegex(subject.ExternalDistributionRefused, "support"):
            subject.validate_candidate(self.matrix, candidate, np.ones((4, 4), dtype=bool))

    def test_marginals(self):
        candidate = self.matrix.copy()
        candidate[0, 2] += 1
        with self.assertRaisesRegex(subject.ExternalDistributionRefused, "marginals"):
            subject.validate_candidate(self.matrix, candidate, np.ones((4, 4), dtype=bool))

    def test_geography_free_permutation(self):
        actual, _ = self.candidate()
        order = np.array([3, 0, 2, 1])
        permuted, _ = subject.condition_external_demand(self.matrix[np.ix_(order, order)],
            self.times[np.ix_(order, order)], self.mask[order], setting=subject.CANDIDATE)
        np.testing.assert_allclose(permuted, actual[np.ix_(order, order)])

    def test_worker_call_is_executed(self):
        # Execute the actual integration statements, rather than matching import text.
        tree = ast.parse((Path(__file__).parent / "main.py").read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "stage_assignment")
        assignment = next(n for n in ast.walk(function) if isinstance(n, ast.Assign)
            and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Name)
            and n.value.func.id == "condition_external_demand")
        scope = {"np": np, "condition_external_demand": subject.condition_external_demand,
                 "external_od": self.matrix, "time_skim_full": self.times,
                 "cordon_map": {80: 101, 90: 102}, "assignment_centroids": [101, 102, 103, 104]}
        with patch.dict(os.environ, {subject.SETTING_ENV: subject.CANDIDATE}):
            exec(compile(ast.Module(body=[assignment], type_ignores=[]), "worker-integration", "exec"), scope)
        self.assertGreater(scope["external_od"][0, 2], self.matrix[0, 2])
        self.assertIsNotNone(scope["external_distribution_record"])


if __name__ == "__main__":
    unittest.main()
