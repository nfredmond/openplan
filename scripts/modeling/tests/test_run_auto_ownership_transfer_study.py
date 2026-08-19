#!/usr/bin/env python3
import sys
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import run_auto_ownership_transfer_study as study  # noqa: E402


def result(households, borrowed_mae, candidate_mae, borrowed_accuracy, candidate_accuracy):
    return {
        "households": households,
        "borrowed_mtc": {"metrics": {
            "mean_absolute_vehicle_error": borrowed_mae,
            "exact_accuracy": borrowed_accuracy,
            "mean_vehicle_bias": -0.1,
        }},
        "candidate_national": {"metrics": {
            "mean_absolute_vehicle_error": candidate_mae,
            "exact_accuracy": candidate_accuracy,
            "mean_vehicle_bias": 0.2,
        }},
    }


class TransferStudyTests(unittest.TestCase):
    def test_component_isolation_exports_the_household_result(self):
        self.assertIn("- auto_ownership_simulate", study.EVALUATION_SETTINGS)
        self.assertIn("- write_tables", study.EVALUATION_SETTINGS)
        self.assertIn("tablename: households", study.EVALUATION_SETTINGS)

    def test_aggregate_is_household_weighted_and_counts_geography_wins(self):
        summary = study.aggregate([
            result(100, 1.0, 0.0, 0.4, 0.6),
            result(300, 0.5, 0.6, 0.6, 0.5),
        ])
        self.assertEqual(summary["households"], 400)
        self.assertAlmostEqual(summary["borrowed_mtc"]["mean_absolute_vehicle_error"], 0.625)
        self.assertAlmostEqual(summary["candidate_national"]["exact_accuracy"], 0.525)
        self.assertEqual(summary["candidate_lower_mae_geographies"], 1)
        self.assertEqual(summary["comparison_outcome"], "candidate_lower_aggregate_mae")
        self.assertIn("not confidence", summary["interpretation"])

    def test_empty_study_is_refused(self):
        with self.assertRaisesRegex(study.TransferStudyError, "no geography"):
            study.aggregate([])

    def test_resumption_keeps_complete_result_and_names_incomplete_exclusion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runs = root / "runs"
            complete = runs / "complete"
            incomplete = runs / "incomplete"
            for directory in (complete, incomplete):
                (directory / "activitysim_bundle/configs").mkdir(parents=True)
                for name in ("households.csv", "persons.csv"):
                    (directory / "activitysim_bundle" / name).write_text("fixture\n")
                (directory / "activitysim_bundle/configs/settings.yaml").write_text("fixture\n")
            (complete / "activitysim_output/output").mkdir(parents=True)
            (complete / "activitysim_output/output/final_households.csv").write_text("fixture\n")
            output = root / "output"
            (output / "complete").mkdir(parents=True)
            saved = result(10, 0.5, 0.4, 0.5, 0.6)
            saved["households"] = 10
            (output / "complete/comparison.json").write_text(json.dumps(saved) + "\n")
            summary = study.run_study(runs, root / "overlay", root / "stock", root / "cli", output)
            self.assertEqual(summary["geographies"], 1)
            self.assertEqual(summary["directories_discovered"], 2)
            self.assertIn("incomplete", summary["excluded_incomplete_runs"])
            self.assertIn(
                "activitysim_output/output/final_households.csv",
                summary["excluded_incomplete_runs"]["incomplete"],
            )


if __name__ == "__main__":
    unittest.main()
