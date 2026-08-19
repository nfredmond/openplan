#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import activitysim_auto_ownership_fit as fit  # noqa: E402


class AutoOwnershipFitTests(unittest.TestCase):
    def test_larch_case_weight_variable_is_explicit(self):
        class Model:
            weight_co_var = None

        model = fit.configure_case_weights(Model())
        self.assertEqual(model.weight_co_var, "survey_weight")

    def test_weighted_metrics_do_not_reduce_to_record_counts(self):
        metrics = fit.weighted_prediction_metrics(
            observed=[0, 1, 4], predicted=[0, 0, 4], weights=[1, 8, 5]
        )
        self.assertAlmostEqual(metrics["weighted_exact_accuracy"], 6 / 14)
        self.assertAlmostEqual(metrics["weighted_mean_absolute_vehicle_error"], 8 / 14)

    def test_metrics_refuse_misaligned_or_zero_weight_inputs(self):
        with self.assertRaisesRegex(fit.AutoOwnershipFitError, "aligned non-empty"):
            fit.weighted_prediction_metrics([0], [], [1])
        with self.assertRaisesRegex(fit.AutoOwnershipFitError, "positive survey weight"):
            fit.weighted_prediction_metrics([0], [0], [0])


if __name__ == "__main__":
    unittest.main()
