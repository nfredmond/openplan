#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from evaluate_gateway_volume_study import joint_adoption_verdict, paired_method_metrics  # noqa: E402


THRESHOLDS = {
    "counties_improved_minimum": 12,
    "median_county_improvement_percentage_points": 5.0,
    "minimum_road_class_comparisons": 30,
    "maximum_road_class_worsening_percentage_points": 5.0,
}


def county(index: int, improvement: float, *, road_worsening: float = 0.0) -> dict:
    baseline = [50.0, 60.0]
    candidate = [value - improvement for value in baseline]
    return {
        "county_fips": f"{index:05d}",
        "baseline_median_ape": 55.0,
        "candidate_median_ape": 55.0 - improvement,
        "baseline_apes": baseline,
        "candidate_apes": candidate,
        "baseline_by_road_class": {"primary": [50.0, 60.0]},
        "candidate_by_road_class": {
            "primary": [50.0 + road_worsening, 60.0 + road_worsening]
        },
    }


class RegisteredAcceptanceArithmetic(unittest.TestCase):
    def test_all_six_registered_criteria_can_pass(self) -> None:
        result = paired_method_metrics([county(index, 6.0) for index in range(16)], THRESHOLDS)
        self.assertTrue(result["passed"])
        self.assertEqual(result["criteria"]["counties_improved"]["actual"], 16)
        self.assertEqual(
            result["criteria"]["median_county_improvement_percentage_points"]["actual"],
            6.0,
        )
        self.assertEqual(result["criteria"]["pooled_station_median_ape"]["candidate"], 49.0)

    def test_eleven_improved_counties_fail_even_when_the_median_looks_good(self) -> None:
        records = [county(index, 6.0 if index < 11 else 0.0) for index in range(16)]
        result = paired_method_metrics(records, THRESHOLDS)
        self.assertFalse(result["criteria"]["counties_improved"]["passed"])
        self.assertFalse(result["passed"])

    def test_exactly_twelve_improved_counties_meet_the_count_rule(self) -> None:
        records = [county(index, 6.0 if index < 12 else 0.0) for index in range(16)]
        result = paired_method_metrics(records, THRESHOLDS)
        self.assertTrue(result["criteria"]["counties_improved"]["passed"])

    def test_county_median_just_below_five_points_fails(self) -> None:
        result = paired_method_metrics([county(index, 4.99) for index in range(16)], THRESHOLDS)
        self.assertFalse(
            result["criteria"]["median_county_improvement_percentage_points"]["passed"]
        )

    def test_exactly_five_points_meets_the_registered_median_rule(self) -> None:
        result = paired_method_metrics([county(index, 5.0) for index in range(16)], THRESHOLDS)
        self.assertTrue(
            result["criteria"]["median_county_improvement_percentage_points"]["passed"]
        )

    def test_equal_pooled_median_is_not_an_improvement(self) -> None:
        result = paired_method_metrics([county(index, 0.0) for index in range(16)], THRESHOLDS)
        self.assertFalse(result["criteria"]["pooled_station_median_ape"]["passed"])

    def test_road_class_with_thirty_comparisons_refuses_more_than_five_points_worse(self) -> None:
        records = [county(index, 6.0, road_worsening=6.0) for index in range(16)]
        result = paired_method_metrics(records, THRESHOLDS)
        self.assertEqual(result["road_classes"]["primary"]["comparisons"], 32)
        self.assertFalse(result["road_classes"]["primary"]["passed"])
        self.assertFalse(result["passed"])

    def test_small_road_class_sample_is_reported_without_applying_the_threshold(self) -> None:
        records = [county(index, 6.0, road_worsening=100.0) for index in range(14)]
        result = paired_method_metrics(records, THRESHOLDS)
        self.assertEqual(result["road_classes"]["primary"]["comparisons"], 28)
        self.assertFalse(result["road_classes"]["primary"]["threshold_applies"])
        self.assertTrue(result["road_classes"]["primary"]["passed"])

    def test_two_demand_methods_are_not_collapsed_here(self) -> None:
        result = paired_method_metrics([county(index, 6.0) for index in range(16)], THRESHOLDS)
        self.assertNotIn("activitysim", result)
        self.assertNotIn("aequilibrae", result)

    def test_one_failing_method_refuses_joint_adoption(self) -> None:
        verdict = joint_adoption_verdict(
            "holdout",
            True,
            {"aequilibrae": {"passed": True}, "activitysim": {"passed": False}},
        )
        self.assertFalse(verdict["thresholds_passed_for_both_methods"])
        self.assertFalse(verdict["adoption_authorized"])

    def test_development_can_never_authorize_adoption(self) -> None:
        verdict = joint_adoption_verdict(
            "development",
            True,
            {"aequilibrae": {"passed": True}, "activitysim": {"passed": True}},
        )
        self.assertTrue(verdict["thresholds_passed_for_both_methods"])
        self.assertFalse(verdict["adoption_authorized"])


if __name__ == "__main__":
    unittest.main()
