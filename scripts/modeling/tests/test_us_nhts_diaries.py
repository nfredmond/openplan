#!/usr/bin/env python3
import csv
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import us_nhts_diaries as diaries  # noqa: E402


def write_table(archive, name, fields, rows):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    archive.writestr(name, stream.getvalue())


def fixture(root: Path) -> Path:
    path = root / "nhts.zip"
    with zipfile.ZipFile(path, "w") as archive:
        write_table(archive, "hhv2pub.csv", [
            "HOUSEID", "WTHHFIN", "CENSUS_D", "HHSIZE", "HHVEHCNT", "WRKCOUNT",
            "HHFAMINC_IMP", "URBRUR",
        ], [
            {"HOUSEID": "10", "WTHHFIN": "2.5", "CENSUS_D": "01", "HHSIZE": "2", "HHVEHCNT": "1", "WRKCOUNT": "1", "HHFAMINC_IMP": "05", "URBRUR": "02"},
            {"HOUSEID": "20", "WTHHFIN": "3", "CENSUS_D": "02", "HHSIZE": "1", "HHVEHCNT": "0", "WRKCOUNT": "0", "HHFAMINC_IMP": "02", "URBRUR": "01"},
        ])
        write_table(archive, "perv2pub.csv", [
            "HOUSEID", "PERSONID", "WTPERFIN", "R_AGE", "R_SEX", "WORKER", "SCHOOL1",
        ], [
            {"HOUSEID": "10", "PERSONID": "1", "WTPERFIN": "4", "R_AGE": "35", "R_SEX": "2", "WORKER": "1", "SCHOOL1": "2"},
            {"HOUSEID": "20", "PERSONID": "1", "WTPERFIN": "5", "R_AGE": "14", "R_SEX": "1", "WORKER": "2", "SCHOOL1": "1"},
        ])
        trip_fields = [
            "HOUSEID", "PERSONID", "TRIPID", "WTTRDFIN", "TRIPMODE", "WHYFROM", "WHYTO",
            "STRTTIME", "ENDTIME", "TRPMILES", "CENSUS_D",
        ]
        write_table(archive, "tripv2pub.csv", trip_fields, [
            {"HOUSEID": "10", "PERSONID": "1", "TRIPID": "1", "WTTRDFIN": "8", "TRIPMODE": "01", "WHYFROM": "01", "WHYTO": "03", "STRTTIME": "0730", "ENDTIME": "0815", "TRPMILES": "12.5", "CENSUS_D": "01"},
            {"HOUSEID": "20", "PERSONID": "1", "TRIPID": "1", "WTTRDFIN": "9", "TRIPMODE": "05", "WHYFROM": "01", "WHYTO": "06", "STRTTIME": "2400", "ENDTIME": "-9", "TRPMILES": "0.8", "CENSUS_D": "02"},
        ])
        write_table(archive, "vehv2pub.csv", ["HOUSEID", "VEHID"], [{"HOUSEID": "10", "VEHID": "1"}])
    return path


class NhtsDiaryTests(unittest.TestCase):
    def test_weighted_diaries_preserve_raw_codes_and_stable_geographic_folds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = diaries.build_diaries(fixture(root), root / "out")
            with (root / "out" / "observed_trips.csv").open() as handle:
                trips = list(csv.DictReader(handle))
            self.assertEqual(trips[0]["mode"], "private_vehicle_driver")
            self.assertEqual(trips[0]["mode_source_code"], "01")
            self.assertEqual(trips[0]["destination_purpose"], "work")
            self.assertEqual(trips[0]["depart_minutes"], "450")
            self.assertEqual(trips[0]["survey_weight"], "8.0")
            self.assertNotEqual(trips[0]["holdout_fold"], trips[1]["holdout_fold"])
            self.assertEqual(manifest["outputs"], {"households": 2, "persons": 2, "trips": 2})

    def test_invalid_time_is_absent_and_cannot_enter_tour_reconstruction(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            diaries.build_diaries(fixture(root), root / "out")
            with (root / "out" / "observed_trips.csv").open() as handle:
                trips = list(csv.DictReader(handle))
            self.assertEqual(trips[1]["depart_minutes"], "1440")
            self.assertEqual(trips[1]["arrive_minutes"], "")
            self.assertEqual(trips[1]["usable_for_tour_reconstruction"], "False")

    def test_component_matrix_refuses_location_models_instead_of_inventing_zones(self):
        support = diaries.activitysim_component_support()
        self.assertEqual(
            support["trip_mode_choice"]["status"], "blocked_missing_local_zone_geography"
        )
        self.assertIn("no local origin/destination", support["trip_destination"]["reason"])
        self.assertEqual(
            support["auto_ownership"]["status"], "candidate_requires_estimation_specification"
        )

    def test_missing_mapping_column_is_a_named_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = fixture(root)
            broken = root / "broken.zip"
            with zipfile.ZipFile(path) as source_archive, zipfile.ZipFile(broken, "w") as target:
                for name in source_archive.namelist():
                    data = source_archive.read(name)
                    if name == "tripv2pub.csv":
                        data = data.replace(b"TRPMILES,", b"")
                    target.writestr(name, data)
            with self.assertRaisesRegex(diaries.NhtsDiaryError, "TRPMILES"):
                diaries.build_diaries(broken, root / "out")


if __name__ == "__main__":
    unittest.main()
