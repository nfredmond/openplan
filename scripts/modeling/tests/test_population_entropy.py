"""Controls for the explicit mixed-count entropy fitter, without source outcomes."""
import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from population_synthesis import Control, SeedHousehold, build_seed_matrix, PopulationSynthesisError
from population_entropy import EntropyFitter


class EntropyTests(unittest.TestCase):
    def setUp(self):
        self.controls = [Control('size', 'household', ('one', 'many')),
                         Control('age', 'person', ('adult', 'child'))]
        self.seed = [SeedHousehold('a', 2, {'size': 'one'}, {'age': {'adult': 1}}, 1),
                     SeedHousehold('b', 3, {'size': 'many'}, {'age': {'adult': 2, 'child': 1}}, 3),
                     SeedHousehold('c', 5, {'size': 'many'}, {'age': {'adult': 1, 'child': 4}}, 5),
                     SeedHousehold('d', 6, {'size': 'one'}, {'age': {'adult': 1}}, 1)]
        self.matrix = build_seed_matrix(self.seed, self.controls)
        self.fitter = EntropyFitter(self.seed, self.controls, self.matrix)
        self.targets = {'size': {'one': 20, 'many': 30}, 'age': {'adult': 60, 'child': 90}}

    def fit(self, targets=None, **kwargs):
        return self.fitter(self.seed, self.controls, targets or self.targets,
                           seed_matrix=self.matrix, **kwargs)

    def test_mixed_counts_converge_without_changing_targets(self):
        fit = self.fit()
        self.assertTrue(fit.converged)
        self.assertLessEqual(fit.worst_deviation, .001)
        for c in self.controls:
            actual = self.matrix.contributions[c.name].T @ fit.weights
            np.testing.assert_allclose(actual, list(self.targets[c.name].values()), rtol=.001)
        self.assertAlmostEqual(fit.weights[3] / fit.weights[0], 3.0)

    def test_zero_cannot_reenter_and_unreachable_target_fails(self):
        target = {'size': {'one': 20, 'many': 30}, 'age': {'adult': 80, 'child': 0}}
        fit = self.fit(target, max_iterations=3)
        self.assertFalse(fit.converged)
        self.assertEqual(fit.weights[1:3], [0.0, 0.0])
        self.assertTrue(fit.unmet_controls)

    def test_inconsistent_totals_stay_failed_with_margins(self):
        target = {'size': {'one': 20, 'many': 0}, 'age': {'adult': 80, 'child': 0}}
        fit = self.fit(target, max_iterations=5, margins={'size': {'one': 1, 'many': 1}, 'age': {'adult': 1, 'child': 1}})
        self.assertFalse(fit.converged)
        self.assertTrue(fit.outside_margin)

    def test_nonfinite_or_negative_target_refuses(self):
        for value in [float('nan'), -1, float('inf')]:
            target = {**self.targets, 'age': {'adult': value, 'child': 90}}
            with self.assertRaisesRegex(PopulationSynthesisError, 'targets'):
                self.fit(target)

    def test_seed_identity_refuses(self):
        with self.assertRaisesRegex(PopulationSynthesisError, 'identities'):
            self.fitter(list(self.seed), self.controls, self.targets, seed_matrix=self.matrix)

    def test_invalid_seed_and_contributions_refuse(self):
        self.seed[0].weight = 0
        with self.assertRaisesRegex(PopulationSynthesisError, 'weights'):
            EntropyFitter(self.seed, self.controls, self.matrix)
        self.seed[0].weight = 2
        for value in [-1, float('nan'), .5]:
            self.matrix.contributions['age'][0, 0] = value
            with self.assertRaises(PopulationSynthesisError):
                EntropyFitter(self.seed, self.controls, self.matrix)

    def test_iteration_limit_and_zero_population(self):
        self.assertFalse(self.fit(max_iterations=1).converged)
        zero = {c.name: {cat: 0 for cat in c.categories} for c in self.controls}
        fit = self.fit(zero)
        self.assertTrue(fit.converged)
        self.assertEqual(sum(fit.weights), 0)
        for kwargs in [{'tolerance': 0}, {'max_iterations': 0}]:
            with self.assertRaises(PopulationSynthesisError):
                self.fit(**kwargs)


if __name__ == '__main__':
    unittest.main()
