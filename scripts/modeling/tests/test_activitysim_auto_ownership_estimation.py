#!/usr/bin/env python3
import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import activitysim_auto_ownership_estimation as estimation  # noqa: E402


def write_diaries(root: Path, households: list[dict[str, object]], schema="openplan.behavioral-survey-diaries.v3") -> Path:
    diaries = root / "diaries"
    diaries.mkdir()
    (diaries / "manifest.json").write_text(json.dumps({"schema_version": schema}) + "\n")
    with (diaries / "observed_households.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(households[0]))
        writer.writeheader()
        writer.writerows(households)
    return diaries


class AutoOwnershipEstimationTests(unittest.TestCase):
    def test_native_bundles_use_weights_and_whole_fold_holdouts(self):
        households = [
            {"household_id": "a", "survey_weight": 2, "holdout_fold": 0, "household_size": 2, "vehicles": 1, "workers": 1, "drivers": 2, "income_category_code": "05"},
            {"household_id": "b", "survey_weight": 3, "holdout_fold": 1, "household_size": 4, "vehicles": 6, "workers": 2, "drivers": 3, "income_category_code": "10"},
            {"household_id": "c", "survey_weight": 5, "holdout_fold": 1, "household_size": 1, "vehicles": 0, "workers": 0, "drivers": 0, "income_category_code": "02"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = estimation.build_bundles(write_diaries(root, households), root / "edb")
            self.assertEqual(manifest["status"], "estimation_input_not_coefficients")
            self.assertEqual(manifest["all"]["survey_weight"], 10)
            self.assertEqual([fold["holdout_fold"] for fold in manifest["holdouts"]], [0, 1])
            with (root / "edb/fold_0/validation/auto_ownership/auto_ownership_values_combined.csv").open() as handle:
                validation = list(csv.DictReader(handle))
            with (root / "edb/fold_0/train/auto_ownership/auto_ownership_values_combined.csv").open() as handle:
                train = list(csv.DictReader(handle))
            self.assertEqual([row["household_id"] for row in validation], ["a"])
            self.assertEqual({row["household_id"] for row in train}, {"b", "c"})
            self.assertIn("override_choice", train[0])
            self.assertNotIn("override_choice_code", train[0])
            self.assertEqual(next(row for row in train if row["household_id"] == "b")["override_choice"], "4")
            self.assertEqual(validation[0]["income_in_thousands"], "35")
            spec = (root / "edb/all/auto_ownership/auto_ownership_SPEC.csv").read_text()
            self.assertIn("income_in_thousands >= 35", spec)
            self.assertNotIn("income_ge_35k,income_ge_35k", spec)

    def test_missing_fields_are_counted_and_never_zero_filled(self):
        households = [
            {"household_id": "a", "survey_weight": 2, "holdout_fold": 0, "household_size": 2, "vehicles": 1, "workers": 1, "drivers": 2, "income_category_code": "05"},
            {"household_id": "b", "survey_weight": 3, "holdout_fold": 1, "household_size": 2, "vehicles": 1, "workers": 1, "drivers": "", "income_category_code": "05"},
            {"household_id": "c", "survey_weight": 4, "holdout_fold": 1, "household_size": 2, "vehicles": 1, "workers": 1, "drivers": 1, "income_category_code": "05"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = estimation.build_bundles(write_diaries(root, households), root / "edb")
            self.assertEqual(manifest["records_received"], 3)
            self.assertEqual(manifest["records_eligible"], 2)
            self.assertEqual(manifest["exclusions"], {"missing_num_drivers": 1})

    def test_old_diary_schema_is_refused(self):
        household = {"household_id": "a", "survey_weight": 2, "holdout_fold": 0, "household_size": 2, "vehicles": 1, "workers": 1, "drivers": 2, "income_category_code": "05"}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            diaries = write_diaries(root, [household], schema="openplan.behavioral-survey-diaries.v2")
            with self.assertRaisesRegex(estimation.AutoOwnershipEstimationError, "schema v3"):
                estimation.build_bundles(diaries, root / "edb")


if __name__ == "__main__":
    unittest.main()
