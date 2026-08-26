import unittest

import numpy as np

import scenario_adjustment


class GuidedScenarioAdjustmentTests(unittest.TestCase):
    def test_applies_planner_supplied_auto_trip_change(self):
        run = {
            "input_snapshot_json": {
                "scenarioAdjustment": {
                    "kind": "assigned_auto_trip_change_pct",
                    "autoTripChangePct": -8,
                    "basis": "Local corridor mode-shift study, 2025",
                }
            }
        }
        adjustment = scenario_adjustment.resolve_assigned_auto_trip_adjustment(run)
        self.assertEqual(adjustment["factor"], 0.92)
        result = scenario_adjustment.apply_assigned_auto_trip_adjustment(
            np.array([[0.0, 100.0], [50.0, 0.0]]), adjustment
        )
        np.testing.assert_allclose(result, np.array([[0.0, 92.0], [46.0, 0.0]]))

    def test_missing_or_invalid_evidence_never_changes_demand(self):
        demand = np.array([[0.0, 100.0], [50.0, 0.0]])
        for run in (
            {},
            {"input_snapshot_json": {"scenarioAdjustment": {"kind": "assigned_auto_trip_change_pct", "autoTripChangePct": 0, "basis": "study"}}},
            {"input_snapshot_json": {"scenarioAdjustment": {"kind": "assigned_auto_trip_change_pct", "autoTripChangePct": -8, "basis": ""}}},
        ):
            adjustment = scenario_adjustment.resolve_assigned_auto_trip_adjustment(run)
            self.assertIsNone(adjustment)
            np.testing.assert_array_equal(
                scenario_adjustment.apply_assigned_auto_trip_adjustment(demand, adjustment), demand
            )


if __name__ == "__main__":
    unittest.main()
