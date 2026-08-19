import csv
import hashlib
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import us_nhts_survey as nhts  # noqa: E402


BASE_COLUMNS = {
    "hhv2pub.csv": ["HOUSEID", "WTHHFIN", "CENSUS_D"],
    "perv2pub.csv": ["HOUSEID", "PERSONID", "WTPERFIN"],
    "tripv2pub.csv": [
        "HOUSEID", "PERSONID", "TRIPID", "WTTRDFIN", "TRIPMODE", "WHYFROM", "WHYTO"
    ],
    "vehv2pub.csv": ["HOUSEID", "VEHID"],
}


def archive_fixture(root: Path, *, tripmode: bool = True) -> Path:
    path = root / "nhts.zip"
    columns = {name: list(values) for name, values in BASE_COLUMNS.items()}
    if not tripmode:
        columns["tripv2pub.csv"].remove("TRIPMODE")
    with zipfile.ZipFile(path, "w") as archive:
        for filename, header in columns.items():
            stream = io.StringIO()
            writer = csv.DictWriter(stream, fieldnames=header)
            writer.writeheader()
            if filename == "hhv2pub.csv":
                for division in ("1", "1", "2", "3", "4", "5", "6", "7", "8", "9", ""):
                    writer.writerow(
                        {"HOUSEID": f"h{division}", "WTHHFIN": "2.5", "CENSUS_D": division}
                    )
            else:
                writer.writerow({column: "1" for column in header})
            archive.writestr(filename, stream.getvalue())
    return path


class NhtsSurveySourceTests(unittest.TestCase):
    def test_inventory_fingerprints_exact_bytes_and_accepts_measured_v21_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = archive_fixture(Path(tmp))
            inventory = nhts.inspect_archive(path)
            self.assertEqual(
                inventory["source_url"],
                "https://nhts.ornl.gov/media/2022/download/csv.zip",
            )
            self.assertEqual(inventory["archive_sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(inventory["inferred_release"], "2.1")
            self.assertTrue(inventory["advertised_release_matches_bytes"])
            self.assertTrue(inventory["estimation_contract"]["ready"])
            nhts.require_estimation_contract(inventory)

    def test_an_older_archive_is_not_promoted_by_the_landing_page_label(self):
        with tempfile.TemporaryDirectory() as tmp:
            inventory = nhts.inspect_archive(archive_fixture(Path(tmp), tripmode=False))
            self.assertEqual(inventory["advertised_release"], "2.1")
            self.assertEqual(inventory["inferred_release"], "pre-2.1")
            self.assertFalse(inventory["advertised_release_matches_bytes"])
            self.assertEqual(inventory["estimation_contract"]["missing_columns"], {"trips": ["TRIPMODE"]})
            with self.assertRaisesRegex(nhts.NhtsSourceError, "TRIPMODE"):
                nhts.require_estimation_contract(inventory)

    def test_geographic_holdouts_keep_divisions_whole_and_retain_survey_weights(self):
        with tempfile.TemporaryDirectory() as tmp:
            inventory = nhts.inspect_archive(archive_fixture(Path(tmp)), holdout_folds=5)
            folds = inventory["geographic_holdouts"]["folds"]
            division_to_fold = {
                division: fold["fold"] for fold in folds for division in fold["division_codes"]
            }
            self.assertEqual(len(division_to_fold), 9)
            self.assertGreaterEqual(len(set(division_to_fold.values())), 3)
            self.assertEqual(sum(fold["household_records"] for fold in folds), 10)
            self.assertEqual(sum(fold["weighted_households"] for fold in folds), 25.0)
            self.assertEqual(inventory["geographic_holdouts"]["records_missing_geography"], 1)
            self.assertEqual(
                nhts.geographic_holdout_assignments([str(i) for i in range(1, 10)])["1"],
                division_to_fold["1"],
            )
            self.assertTrue(all(fold["division_codes"] for fold in folds))

    def test_missing_public_use_table_is_a_named_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("hhv2pub.csv", "HOUSEID,WTHHFIN,CENSUS_D\n")
            with self.assertRaisesRegex(nhts.NhtsSourceError, "perv2pub.csv"):
                nhts.inspect_archive(path)

    def test_a_single_geography_cannot_masquerade_as_a_geographic_holdout(self):
        with self.assertRaisesRegex(ValueError, "at least two Census divisions"):
            nhts.geographic_holdout_assignments(["1", "1"], folds=5)


if __name__ == "__main__":
    unittest.main()
