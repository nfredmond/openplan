#!/usr/bin/env python3
import csv
import hashlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import mandatory_tour_frequency_registry as registry  # noqa: E402


def fixture(
    root: Path,
    *,
    missing_column: str | None = None,
    blank_design_id: bool = False,
) -> Path:
    path = root / "nhts.zip"
    fields = ["HOUSEID", "PERSONID", "WTPERFIN5D", "CENSUS_D", "STRATUMID"]
    if missing_column:
        fields.remove(missing_column)
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for division_number in range(1, 10):
        for person_number in range(1, division_number + 3):
            values = {
                "HOUSEID": f"h{division_number}-{person_number}",
                "PERSONID": str(person_number),
                "WTPERFIN5D": str(100 + 2 * division_number),
                "CENSUS_D": str(division_number),
                "STRATUMID": f"s{division_number}",
            }
            if blank_design_id and division_number == 1 and person_number == 1:
                values["STRATUMID"] = ""
            writer.writerow({key: value for key, value in values.items() if key in fields})
        values = {
            "HOUSEID": f"weekend-{division_number}",
            "PERSONID": "99",
            "WTPERFIN5D": "0",
            "CENSUS_D": str(division_number),
            "STRATUMID": f"s{division_number}",
        }
        writer.writerow({key: value for key, value in values.items() if key in fields})
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("perv2pub.csv", stream.getvalue())
        # If the registry opens this file, it will not find any usable outcome
        # fields. The preregistration must not need or inspect it.
        archive.writestr("tripv2pub.csv", "THIS_IS_NOT_AN_OUTCOME_TABLE\n")
    return path


class MandatoryTourFrequencyRegistryTests(unittest.TestCase):
    def test_selection_reads_only_pre_outcome_person_design(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = fixture(Path(tmp))
            opened = []
            original_open = zipfile.ZipFile.open

            def tracking_open(archive, name, *args, **kwargs):
                opened.append(str(name))
                return original_open(archive, name, *args, **kwargs)

            with mock.patch.object(zipfile.ZipFile, "open", new=tracking_open):
                result = registry.inspect_pre_outcome_person_design(path)
            self.assertEqual(result["person_table"], "perv2pub.csv")
            self.assertEqual(opened, ["perv2pub.csv"])
            self.assertEqual(result["outcome_tables_read"], [])
            self.assertEqual(result["zero_weekday_weight_records"], 9)
            self.assertEqual(len(result["divisions"]), 9)
            self.assertNotIn("WHYTO", result["person_columns_used"])

    def test_selection_is_stable_and_balances_only_counts_and_weights(self):
        divisions = [
            {
                "division_code": f"{number:02d}",
                "division": f"division_{number}",
                "weekday_person_records": 10 * number,
                "weighted_weekday_persons": 1000 * number,
                "survey_strata": 1,
                "household_clusters": 10 * number,
            }
            for number in range(1, 10)
        ]
        first = registry.select_acceptance_divisions(divisions)
        second = registry.select_acceptance_divisions(list(reversed(divisions)))
        self.assertEqual(first, second)
        self.assertEqual(len(first["acceptance"]), 3)
        self.assertEqual(len(first["development"]), 6)
        self.assertEqual(
            {row["division_code"] for row in first["acceptance"]},
            {"01", "05", "09"},
        )
        self.assertAlmostEqual(first["acceptance_record_share"], 1 / 3)
        self.assertAlmostEqual(first["acceptance_weight_share"], 1 / 3)

    def test_registry_locks_source_rules_seeds_and_component_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = fixture(Path(tmp))
            result = registry.build_registry(path)
            self.assertEqual(
                result["source"]["archive_sha256"],
                hashlib.sha256(path.read_bytes()).hexdigest(),
            )
            self.assertEqual(result["outcome_access_lock"]["outcome_tables_read"], [])
            self.assertEqual(result["component"], "mandatory_tour_frequency")
            self.assertEqual(len(result["selection"]["acceptance_divisions"]), 3)
            self.assertEqual(len(result["selection"]["development_divisions"]), 6)
            self.assertEqual(
                result["acceptance_rules"]["stochastic_stability"]["activitysim_seeds"],
                list(range(2026081901, 2026081921)),
            )
            self.assertFalse(result["reference_model"]["holdout_information_allowed"])
            self.assertIn(
                "regional scalar", result["candidate"]["forbidden_adjustments"]
            )
            self.assertIn(
                "outcome-reconstruction implementation SHA-256",
                result["acceptance_opening_lock"][
                    "required_before_any_acceptance_outcome_is_derived_or_read"
                ],
            )
            self.assertIn(
                "1.96*sqrt",
                result["acceptance_rules"]["stochastic_stability"]["interval"],
            )

    def test_missing_design_column_is_a_named_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = fixture(Path(tmp), missing_column="WTPERFIN5D")
            with self.assertRaisesRegex(
                registry.MandatoryTourRegistryError, "WTPERFIN5D"
            ):
                registry.build_registry(path)

    def test_positive_weekday_records_require_variance_design_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = fixture(Path(tmp), blank_design_id=True)
            with self.assertRaisesRegex(
                registry.MandatoryTourRegistryError, "STRATUMID or HOUSEID"
            ):
                registry.build_registry(path)

    def test_an_existing_registry_cannot_be_rewritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "registry.json"
            registry.write_registry({"locked": 1}, output)
            registry.write_registry({"locked": 1}, output)
            with self.assertRaisesRegex(
                registry.MandatoryTourRegistryError, "rewriting it is forbidden"
            ):
                registry.write_registry({"locked": 2}, output)

    def test_checked_in_registry_has_the_verified_source_and_unopened_outcome_lock(self):
        path = (
            SCRIPT_DIR.parents[1]
            / "data/modeling/mandatory-tour-frequency-preregistration-2026-08-19.json"
        )
        result = json.loads(path.read_text())
        self.assertEqual(
            result["source"]["archive_sha256"],
            "64530c396d5f164d2259a22f7042f27bee5147babcd367568ddbfafe6c8bf34c",
        )
        self.assertEqual(result["outcome_access_lock"]["outcome_tables_read"], [])
        self.assertEqual(result["status"], "pre_registered_before_mandatory_tour_outcome_derivation")
        self.assertEqual(len(result["selection"]["acceptance_divisions"]), 3)
        self.assertEqual(len(result["selection"]["development_divisions"]), 6)


if __name__ == "__main__":
    unittest.main()
