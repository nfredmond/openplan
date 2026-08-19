#!/usr/bin/env python3
import csv
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import compare_activitysim_auto_ownership as comparison  # noqa: E402


def write_choices(path: Path, values: list[tuple[str, int]]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["household_id", "auto_ownership"])
        writer.writeheader()
        for household_id, choice in values:
            writer.writerow({"household_id": household_id, "auto_ownership": choice})


class AutoOwnershipComparisonTests(unittest.TestCase):
    def test_accuracy_and_method_sensitivity_remain_distinct(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_choices(root / "reference.csv", [("a", 0), ("b", 1), ("c", 4), ("d", 2)])
            write_choices(root / "borrowed.csv", [("a", 1), ("b", 1), ("c", 3), ("d", 2)])
            write_choices(root / "candidate.csv", [("a", 0), ("b", 2), ("c", 4), ("d", 2)])
            result = comparison.compare(
                root / "reference.csv", root / "borrowed.csv", root / "candidate.csv"
            )
            self.assertEqual(result["borrowed_mtc"]["metrics"]["exact_accuracy"], 0.5)
            self.assertEqual(result["candidate_national"]["metrics"]["exact_accuracy"], 0.75)
            self.assertEqual(result["method_sensitivity"]["same_choice_share"], 0.25)
            self.assertEqual(result["method_sensitivity"]["candidate_closer_households"], 2)
            self.assertIn("does not establish confidence", result["interpretation"])

    def test_mismatched_populations_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_choices(root / "reference.csv", [("a", 0)])
            write_choices(root / "borrowed.csv", [("a", 0)])
            write_choices(root / "candidate.csv", [("b", 0)])
            with self.assertRaisesRegex(comparison.AutoOwnershipComparisonError, "not identical"):
                comparison.compare(
                    root / "reference.csv", root / "borrowed.csv", root / "candidate.csv"
                )


if __name__ == "__main__":
    unittest.main()
