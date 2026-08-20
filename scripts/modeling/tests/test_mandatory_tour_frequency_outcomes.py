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

import mandatory_tour_frequency_outcomes as outcomes  # noqa: E402
import mandatory_tour_frequency_registry as preregistration  # noqa: E402
import prepare_mandatory_tour_development_source as preparation  # noqa: E402


HOUSEHOLD_FIELDS = [
    "HOUSEID", "CENSUS_D", "STRATUMID", "HHSIZE", "HHVEHCNT", "WRKCOUNT",
    "DRVRCNT", "HHFAMINC_IMP", "URBRUR",
]
PERSON_FIELDS = [
    "HOUSEID", "PERSONID", "CENSUS_D", "STRATUMID", "WTPERFIN", "WTPERFIN5D",
    "R_AGE", "R_SEX", "WORKER", "SCHOOL1",
]
TRIP_FIELDS = [
    "HOUSEID", "PERSONID", "TRIPID", "CENSUS_D", "STRATUMID", "WHYFROM",
    "WHYTO", "STRTTIME", "ENDTIME",
]
VEHICLE_FIELDS = ["HOUSEID", "CENSUS_D", "STRATUMID", "VEHID"]


def _table_bytes(fields, rows):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def _trip(person, number, origin, destination, start, end):
    return {
        "HOUSEID": "h1",
        "PERSONID": person,
        "TRIPID": str(number),
        "CENSUS_D": "01",
        "STRATUMID": "s01",
        "WHYFROM": origin,
        "WHYTO": destination,
        "STRTTIME": str(start),
        "ENDTIME": str(end),
    }


def raw_source(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    households = []
    persons = []
    vehicles = []
    for number in range(1, 10):
        division = f"{number:02d}"
        household = f"h{number}"
        households.append({
            "HOUSEID": household,
            "CENSUS_D": division,
            "STRATUMID": f"s{division}",
            "HHSIZE": "8" if number == 1 else "1",
            "HHVEHCNT": "2",
            "WRKCOUNT": "2",
            "DRVRCNT": "2",
            "HHFAMINC_IMP": "07",
            "URBRUR": "01",
        })
        vehicles.append({
            "HOUSEID": household,
            "CENSUS_D": division,
            "STRATUMID": f"s{division}",
            "VEHID": "1",
        })
        if number != 1:
            persons.append({
                "HOUSEID": household,
                "PERSONID": "1",
                "CENSUS_D": division,
                "STRATUMID": f"s{division}",
                "WTPERFIN": "10",
                "WTPERFIN5D": "10",
                "R_AGE": "35",
                "R_SEX": "01",
                "WORKER": "01",
                "SCHOOL1": "02",
            })
    for person in range(1, 9):
        persons.append({
            "HOUSEID": "h1",
            "PERSONID": str(person),
            "CENSUS_D": "01",
            "STRATUMID": "s01",
            "WTPERFIN": "10",
            "WTPERFIN5D": "-1" if person == 7 else "10",
            "R_AGE": str(10 + person * 4),
            "R_SEX": "01" if person % 2 else "02",
            "WORKER": "01" if person != 2 else "02",
            "SCHOOL1": "01" if person in {2, 3} else "02",
        })

    trips = [
        # p1: work1
        _trip("1", 1, "01", "03", 700, 800),
        _trip("1", 2, "03", "01", 1700, 1800),
        # p2: school2
        _trip("2", 1, "01", "06", 700, 730),
        _trip("2", 2, "06", "01", 1100, 1130),
        _trip("2", 3, "01", "06", 1200, 1230),
        _trip("2", 4, "06", "01", 1500, 1530),
        # p3: work_and_school
        _trip("3", 1, "01", "03", 700, 800),
        _trip("3", 2, "03", "01", 1200, 1300),
        _trip("3", 3, "01", "06", 1400, 1430),
        _trip("3", 4, "06", "01", 1600, 1630),
        # p4: three work tours, deliberately out of support
        _trip("4", 1, "01", "03", 600, 630),
        _trip("4", 2, "03", "01", 700, 730),
        _trip("4", 3, "01", "03", 800, 830),
        _trip("4", 4, "03", "01", 900, 930),
        _trip("4", 5, "01", "03", 1000, 1030),
        _trip("4", 6, "03", "01", 1100, 1130),
        # p5: complete day without a mandatory pattern
        _trip("5", 1, "01", "13", 900, 930),
        _trip("5", 2, "13", "01", 1000, 1030),
        # p6: a valid work tour plus an unclosed chain makes the whole day incomplete
        _trip("6", 1, "01", "03", 700, 800),
        _trip("6", 2, "03", "01", 1200, 1300),
        _trip("6", 3, "01", "13", 1400, 1430),
        # p7: weekend/non-study record; trip outcomes must not be derived
        _trip("7", 1, "01", "03", 700, 800),
        # p8: a valid home-to-home loop does not invalidate the later work tour
        _trip("8", 1, "01", "01", 600, 620),
        _trip("8", 2, "01", "03", 700, 800),
        _trip("8", 3, "03", "01", 1700, 1800),
    ]
    for division in ("05", "06", "08"):
        trips.extend([
            {
                "HOUSEID": f"h{int(division)}",
                "PERSONID": "1",
                "TRIPID": "1",
                "CENSUS_D": division,
                "STRATUMID": f"s{division}",
                "WHYFROM": "01",
                "WHYTO": "03",
                "STRTTIME": "700",
                "ENDTIME": "800",
            },
            {
                "HOUSEID": f"h{int(division)}",
                "PERSONID": "1",
                "TRIPID": "2",
                "CENSUS_D": division,
                "STRATUMID": f"s{division}",
                "WHYFROM": "03",
                "WHYTO": "01",
                "STRTTIME": "1700",
                "ENDTIME": "1800",
            },
        ])

    path = root / "nhts.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("hhv2pub.csv", _table_bytes(HOUSEHOLD_FIELDS, households))
        archive.writestr("perv2pub.csv", _table_bytes(PERSON_FIELDS, persons))
        archive.writestr("tripv2pub.csv", _table_bytes(TRIP_FIELDS, trips))
        archive.writestr("vehv2pub.csv", _table_bytes(VEHICLE_FIELDS, vehicles))
    return path


def registry(root: Path, archive: Path) -> Path:
    acceptance = {"05", "06", "08"}
    payload = {
        "schema_version": preregistration.SCHEMA_VERSION,
        "status": "pre_registered_before_mandatory_tour_outcome_derivation",
        "source": {
            "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "archive_size_bytes": archive.stat().st_size,
        },
        "selection": {
            "acceptance_divisions": [
                {"division_code": code} for code in sorted(acceptance)
            ],
            "development_divisions": [
                {"division_code": code}
                for code in preregistration.NHTS_CENSUS_DIVISIONS
                if code not in acceptance
            ],
        },
    }
    path = root / "registry.json"
    path.write_text(json.dumps(payload))
    return path


def development_fixture(root: Path) -> tuple[Path, Path]:
    source = raw_source(root)
    lock = registry(root, source)
    development = root / "development"
    preparation.build_development_source(source, lock, development)
    return development, lock


def opening_lock_fixture(root: Path, source: Path, registry_path: Path) -> tuple[Path, Path]:
    path = root / "opening-lock.json"
    receipt = root / "opening-receipt.json"
    result = root / "aggregate-result.json"
    path.write_text(json.dumps({
        "schema_version": preparation.OPENING_LOCK_SCHEMA_VERSION,
        "status": preparation.OPENING_LOCK_STATUS,
        "source": {
            "preregistration_sha256": hashlib.sha256(registry_path.read_bytes()).hexdigest(),
            "archive_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "archive_size_bytes": source.stat().st_size,
        },
        "acceptance_division_codes": ["05", "06", "08"],
        "one_shot_outputs": {
            "opening_receipt_path": str(receipt.resolve()),
            "aggregate_result_path": str(result.resolve()),
        },
    }))
    receipt.write_text(json.dumps({
        "schema_version": preparation.OPENING_RECEIPT_SCHEMA_VERSION,
        "status": preparation.OPENING_RECEIPT_STATUS,
        "opening_lock_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "source_archive_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "aggregate_result_path": str(result.resolve()),
    }))
    return path, receipt


def acceptance_fixture(root: Path) -> tuple[Path, Path, Path, Path]:
    source = raw_source(root)
    lock = registry(root, source)
    opening_lock, opening_receipt = opening_lock_fixture(root, source, lock)
    acceptance = root / "acceptance"
    preparation._build_partition_source(
        source,
        lock,
        acceptance,
        role="acceptance",
        opening_lock_path=opening_lock,
        opening_receipt_path=opening_receipt,
    )
    return acceptance, lock, opening_lock, opening_receipt


def output_rows(path: Path):
    with (path / outcomes.OUTPUT_NAME).open(newline="") as handle:
        return {row["person_id"]: row for row in csv.DictReader(handle)}


def rewrite_archive(source_dir: Path, member: str, transform) -> None:
    archive_path = source_dir / preparation.OUTPUT_ARCHIVE_NAME
    replacement = source_dir / "replacement.zip"
    with zipfile.ZipFile(archive_path) as source, zipfile.ZipFile(replacement, "w") as target:
        for name in source.namelist():
            payload = source.read(name)
            target.writestr(name, transform(payload) if name == member else payload)
    replacement.replace(archive_path)
    manifest_path = source_dir / preparation.OUTPUT_MANIFEST_NAME
    manifest = json.loads(manifest_path.read_text())
    manifest["output"]["archive_sha256"] = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    manifest["output"]["archive_size_bytes"] = archive_path.stat().st_size
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


class MandatoryTourFrequencyOutcomeTests(unittest.TestCase):
    def test_person_days_preserve_every_status_and_never_coerce_a_pattern(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            development, lock = development_fixture(root)
            manifest = outcomes.build_outcomes(development, lock, root / "out")
            rows = output_rows(root / "out")
            self.assertEqual(len(rows), 13)
            self.assertEqual(rows["h1:1"]["alternative"], "work1")
            self.assertEqual(rows["h1:1"]["household_id"], "h1")
            self.assertEqual(rows["h1:1"]["stratum_id"], "s01")
            self.assertEqual(rows["h1:2"]["alternative"], "school2")
            self.assertEqual(rows["h1:3"]["alternative"], "work_and_school")
            self.assertEqual(
                rows["h1:4"]["outcome_status"], "out_of_support_mandatory_pattern"
            )
            self.assertEqual(rows["h1:4"]["alternative"], "")
            self.assertEqual(rows["h1:4"]["exclusion_reason"], "work=3;school=0")
            self.assertEqual(
                rows["h1:5"]["outcome_status"], "no_observed_mandatory_pattern"
            )
            self.assertEqual(rows["h1:6"]["outcome_status"], "incomplete_diary")
            self.assertEqual(rows["h1:6"]["work_tours"], "")
            self.assertEqual(
                rows["h1:7"]["outcome_status"], "not_weekday_study_population"
            )
            self.assertEqual(rows["h1:7"]["weekday_weight"], "")
            self.assertEqual(rows["h1:8"]["alternative"], "work1")
            self.assertEqual(manifest["summary"]["weekday_records"], 12)
            self.assertEqual(manifest["summary"]["design_weighted_supported_share"], 0.8)
            self.assertEqual(
                manifest["summary"]["supported_alternatives"]["work1"],
                {"records": 2, "weekday_weight": 20.0},
            )
            self.assertFalse(manifest["study_contract"]["unsupported_patterns_coerced"])
            self.assertFalse(manifest["study_contract"]["acceptance_outcomes_read"])
            self.assertEqual(manifest["partition_role"], "development")
            self.assertTrue(
                all(row["census_division_code"] not in {"05", "06", "08"} for row in rows.values())
            )

    def test_development_archive_bytes_are_locked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            development, lock = development_fixture(root)
            manifest_path = development / preparation.OUTPUT_MANIFEST_NAME
            manifest = json.loads(manifest_path.read_text())
            manifest["output"]["archive_sha256"] = "0" * 64
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(outcomes.MandatoryTourOutcomeError, "SHA-256"):
                outcomes.build_outcomes(development, lock, root / "out")

    def test_acceptance_division_row_is_refused_even_if_the_manifest_is_rewritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            development, lock = development_fixture(root)

            def move_person_to_acceptance(payload):
                return payload.replace(b"h1,1,01,s01", b"h1,1,05,s01", 1)

            rewrite_archive(development, "perv2pub.csv", move_person_to_acceptance)
            with self.assertRaisesRegex(
                outcomes.MandatoryTourOutcomeError, "outside the development partition"
            ):
                outcomes.build_outcomes(development, lock, root / "out")
            self.assertFalse((root / "out").exists())

    def test_invalid_schema_leaves_no_partial_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            development, lock = development_fixture(root)

            def remove_end_time(payload):
                return payload.replace(b",ENDTIME\n", b"\n", 1)

            rewrite_archive(development, "tripv2pub.csv", remove_end_time)
            with self.assertRaisesRegex(outcomes.MandatoryTourOutcomeError, "ENDTIME"):
                outcomes.build_outcomes(development, lock, root / "out")
            self.assertFalse((root / "out").exists())
            self.assertEqual(list(root.glob(".mandatory-tour-outcomes-*")), [])

    def test_failure_after_csv_write_removes_the_staging_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            development, lock = development_fixture(root)
            with mock.patch.object(
                outcomes,
                "_summary",
                side_effect=outcomes.MandatoryTourOutcomeError("summary failed"),
            ):
                with self.assertRaisesRegex(
                    outcomes.MandatoryTourOutcomeError, "summary failed"
                ):
                    outcomes.build_outcomes(development, lock, root / "out")
            self.assertFalse((root / "out").exists())
            self.assertEqual(list(root.glob(".mandatory-tour-outcomes-*")), [])

    def test_output_is_deterministic_and_existing_output_is_immutable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            development, lock = development_fixture(root)
            first = outcomes.build_outcomes(development, lock, root / "first")
            second = outcomes.build_outcomes(development, lock, root / "second")
            self.assertEqual(
                first["outputs"]["person_days_sha256"],
                second["outputs"]["person_days_sha256"],
            )
            self.assertEqual(
                first["implementation"]["closure_sha256"],
                second["implementation"]["closure_sha256"],
            )
            self.assertEqual(
                {item["path"] for item in first["implementation"]["files"]},
                {
                    "scripts/modeling/mandatory_tour_frequency_outcomes.py",
                    "scripts/modeling/mandatory_tour_frequency_registry.py",
                    "scripts/modeling/prepare_mandatory_tour_development_source.py",
                    "scripts/modeling/us_nhts_diaries.py",
                    "scripts/modeling/us_nhts_survey.py",
                },
            )
            with self.assertRaisesRegex(outcomes.MandatoryTourOutcomeError, "refusing to overwrite"):
                outcomes.build_outcomes(development, lock, root / "first")

    def test_acceptance_uses_the_same_outcome_reconstruction_semantics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            development, development_lock = development_fixture(root / "development-side")
            development_rows, _ = outcomes.reconstruct_partition_outcomes(
                development, development_lock, role="development"
            )
            acceptance, acceptance_lock, opening_lock, opening_receipt = acceptance_fixture(
                root / "acceptance-side"
            )
            acceptance_rows, context = outcomes._reconstruct_partition_outcomes(
                acceptance,
                acceptance_lock,
                role="acceptance",
                opening_lock_path=opening_lock,
                opening_receipt_path=opening_receipt,
            )
            development_work1 = next(
                row for row in development_rows if row["person_id"] == "h1:1"
            )
            acceptance_work1 = next(
                row for row in acceptance_rows if row["person_id"] == "h5:1"
            )
            for field in (
                "work_tours",
                "school_tours",
                "alternative",
                "outcome_status",
                "exclusion_reason",
            ):
                self.assertEqual(development_work1[field], acceptance_work1[field])
            self.assertEqual(context["role"], "acceptance")
            self.assertEqual(context["included_geography_codes"], {"05", "06", "08"})

    def test_acceptance_manifest_role_and_opening_lock_are_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            acceptance, lock, opening_lock, opening_receipt = acceptance_fixture(
                root / "wrong-role"
            )
            manifest_path = acceptance / preparation.OUTPUT_MANIFEST_NAME
            manifest = json.loads(manifest_path.read_text())
            manifest["partition"]["role"] = "development"
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(
                outcomes.MandatoryTourOutcomeError, "partition role"
            ):
                outcomes._reconstruct_partition_outcomes(
                    acceptance,
                    lock,
                    role="acceptance",
                    opening_lock_path=opening_lock,
                    opening_receipt_path=opening_receipt,
                )

            acceptance, lock, opening_lock, opening_receipt = acceptance_fixture(
                root / "wrong-lock"
            )
            manifest_path = acceptance / preparation.OUTPUT_MANIFEST_NAME
            manifest = json.loads(manifest_path.read_text())
            manifest["authorization"]["opening_lock_sha256"] = "0" * 64
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(
                outcomes.MandatoryTourOutcomeError, "another opening lock"
            ):
                outcomes._reconstruct_partition_outcomes(
                    acceptance,
                    lock,
                    role="acceptance",
                    opening_lock_path=opening_lock,
                    opening_receipt_path=opening_receipt,
                )

    def test_acceptance_person_days_cannot_be_persisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            acceptance, lock, opening_lock, _opening_receipt = acceptance_fixture(root)
            with mock.patch.object(
                outcomes, "reconstruct_partition_outcomes"
            ) as reconstruct:
                with self.assertRaisesRegex(
                    outcomes.MandatoryTourOutcomeError,
                    "only be reconstructed in memory",
                ):
                    outcomes.build_partition_outcomes(
                        acceptance,
                        lock,
                        root / "persisted-outcomes",
                        role="acceptance",
                        opening_lock_path=opening_lock,
                    )
            reconstruct.assert_not_called()
            self.assertFalse((root / "persisted-outcomes").exists())

    def test_public_reconstruction_api_never_returns_acceptance_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            acceptance, lock, opening_lock, opening_receipt = acceptance_fixture(root)
            with mock.patch.object(
                zipfile, "ZipFile", wraps=zipfile.ZipFile
            ) as zip_constructor:
                with self.assertRaisesRegex(
                    outcomes.MandatoryTourOutcomeError,
                    "only inside the one-shot evaluator",
                ):
                    outcomes.reconstruct_partition_outcomes(
                        acceptance,
                        lock,
                        role="acceptance",
                        opening_lock_path=opening_lock,
                        opening_receipt_path=opening_receipt,
                    )
            zip_constructor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
