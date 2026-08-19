#!/usr/bin/env python3
import sys
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import run_auto_ownership_transfer_study as study  # noqa: E402


def result(
    households,
    borrowed_mae,
    candidate_mae,
    borrowed_accuracy,
    candidate_accuracy,
    borrowed_distribution=0.2,
    candidate_distribution=0.1,
):
    return {
        "households": households,
        "borrowed_mtc": {"metrics": {
            "mean_absolute_vehicle_error": borrowed_mae,
            "exact_accuracy": borrowed_accuracy,
            "mean_vehicle_bias": -0.1,
            "distribution_calibration": {
                "total_variation_distance": borrowed_distribution,
            },
        }},
        "candidate_national": {"metrics": {
            "mean_absolute_vehicle_error": candidate_mae,
            "exact_accuracy": candidate_accuracy,
            "mean_vehicle_bias": 0.2,
            "distribution_calibration": {
                "total_variation_distance": candidate_distribution,
            },
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
            result(300, 0.5, 0.6, 0.6, 0.5, 0.1, 0.3),
        ])
        self.assertEqual(summary["households"], 400)
        self.assertAlmostEqual(summary["borrowed_mtc"]["mean_absolute_vehicle_error"], 0.625)
        self.assertAlmostEqual(summary["candidate_national"]["exact_accuracy"], 0.525)
        self.assertEqual(summary["candidate_lower_mae_geographies"], 1)
        self.assertEqual(summary["comparison_outcome"], "candidate_lower_aggregate_mae")
        self.assertAlmostEqual(
            summary["borrowed_mtc"]["choice_distribution_total_variation"], 0.125
        )
        self.assertAlmostEqual(
            summary["candidate_national"]["choice_distribution_total_variation"], 0.25
        )
        self.assertEqual(summary["candidate_lower_distribution_error_geographies"], 1)
        self.assertEqual(
            summary["distribution_comparison_outcome"],
            "candidate_did_not_improve_aggregate_distribution_error",
        )
        self.assertIn("separate stochastic realizations", summary["interpretation"])

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
            saved["schema_version"] = study.COMPARISON_SCHEMA_VERSION
            (output / "complete/comparison.json").write_text(json.dumps(saved) + "\n")
            summary = study.run_study(runs, root / "overlay", root / "stock", root / "cli", output)
            self.assertEqual(summary["geographies"], 1)
            self.assertEqual(summary["directories_discovered"], 2)
            self.assertIn("incomplete", summary["excluded_incomplete_runs"])
            self.assertIn(
                "activitysim_output/output/final_households.csv",
                summary["excluded_incomplete_runs"]["incomplete"],
            )

    def test_stale_cached_comparison_is_recomputed_from_retained_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = root / "runs/configured-geography"
            (run / "activitysim_bundle/configs").mkdir(parents=True)
            for name in ("households.csv", "persons.csv"):
                (run / "activitysim_bundle" / name).write_text("fixture\n")
            (run / "activitysim_bundle/configs/settings.yaml").write_text("fixture\n")
            (run / "activitysim_output/output").mkdir(parents=True)
            (run / "activitysim_output/output/final_households.csv").write_text("fixture\n")
            output = root / "output"
            (output / "configured-geography/output").mkdir(parents=True)
            (output / "configured-geography/output/final_households.csv").write_text("fixture\n")
            recomputed = result(10, 0.5, 0.4, 0.5, 0.6)
            recomputed["schema_version"] = study.COMPARISON_SCHEMA_VERSION
            stale = {**recomputed, "schema_version": "openplan.activitysim-auto-ownership-comparison.v1"}
            (output / "configured-geography/comparison.json").write_text(json.dumps(stale))
            with (
                mock.patch.object(study, "compare", return_value=recomputed) as compare,
                mock.patch.object(study.subprocess, "run") as subprocess_run,
            ):
                summary = study.run_study(
                    root / "runs", root / "overlay", root / "stock", root / "cli", output
                )
            self.assertEqual(summary["geographies"], 1)
            self.assertEqual(compare.call_count, 1)
            self.assertEqual(subprocess_run.call_count, 0)
            saved = json.loads(
                (output / "configured-geography/comparison.json").read_text()
            )
            self.assertEqual(
                saved["schema_version"], study.COMPARISON_SCHEMA_VERSION
            )


if __name__ == "__main__":
    unittest.main()
