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

import mandatory_tour_frequency_registry as preregistration  # noqa: E402
import prepare_mandatory_tour_development_source as preparation  # noqa: E402


TABLES = {
    "hhv2pub.csv": ["HOUSEID", "CENSUS_D", "STRATUMID", "MARKER"],
    "perv2pub.csv": [
        "HOUSEID", "PERSONID", "WTPERFIN5D", "CENSUS_D", "STRATUMID", "MARKER",
    ],
    "tripv2pub.csv": [
        "HOUSEID", "PERSONID", "CENSUS_D", "STRATUMID", "WHYFROM", "WHYTO", "MARKER",
    ],
    "vehv2pub.csv": ["HOUSEID", "CENSUS_D", "STRATUMID", "MARKER"],
}


def source_fixture(
    root: Path, *, cross_role_trip: bool = False, invalid_trip_division: bool = False
) -> Path:
    path = root / "source.zip"
    with zipfile.ZipFile(path, "w") as archive:
        for filename, fields in TABLES.items():
            stream = io.StringIO()
            writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
            writer.writeheader()
            for number in range(1, 10):
                household = f"h{number}"
                division = f"{number:02d}"
                if filename == "tripv2pub.csv" and cross_role_trip and number == 1:
                    household = "h5"
                if filename == "tripv2pub.csv" and invalid_trip_division and number == 1:
                    division = "10"
                values = {
                    "HOUSEID": household,
                    "PERSONID": "1",
                    "WTPERFIN5D": "100",
                    "CENSUS_D": division,
                    "STRATUMID": f"s{number}",
                    "WHYFROM": "01",
                    "WHYTO": "03",
                    "MARKER": (
                        f"acceptance-secret-{number}"
                        if division in {"05", "06", "08"}
                        else f"development-{number}"
                    ),
                }
                writer.writerow({field: values[field] for field in fields})
            archive.writestr(filename, stream.getvalue())
    return path


def registry_fixture(root: Path, archive: Path, *, wrong_hash: bool = False) -> Path:
    acceptance = {"05", "06", "08"}
    payload = {
        "schema_version": preregistration.SCHEMA_VERSION,
        "status": "pre_registered_before_mandatory_tour_outcome_derivation",
        "source": {
            "archive_sha256": (
                "0" * 64 if wrong_hash else hashlib.sha256(archive.read_bytes()).hexdigest()
            ),
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


def opening_lock_fixture(root: Path, archive: Path, registry: Path) -> Path:
    payload = {
        "schema_version": preparation.OPENING_LOCK_SCHEMA_VERSION,
        "status": preparation.OPENING_LOCK_STATUS,
        "source": {
            "preregistration_sha256": hashlib.sha256(registry.read_bytes()).hexdigest(),
            "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "archive_size_bytes": archive.stat().st_size,
        },
        "acceptance_division_codes": ["05", "06", "08"],
    }
    path = root / "opening-lock.json"
    path.write_text(json.dumps(payload))
    return path


def table_rows(path: Path, member: str):
    with zipfile.ZipFile(path) as archive, archive.open(member) as raw:
        return list(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8")))


class PrepareMandatoryTourDevelopmentSourceTests(unittest.TestCase):
    def test_output_physically_excludes_every_acceptance_row_and_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = source_fixture(root)
            registry = registry_fixture(root, source)
            manifest = preparation.build_development_source(source, registry, root / "out")
            output = root / "out" / preparation.OUTPUT_ARCHIVE_NAME
            for member in TABLES:
                rows = table_rows(output, member)
                self.assertEqual(len(rows), 6)
                self.assertTrue(all(row["CENSUS_D"] not in {"05", "06", "08"} for row in rows))
                self.assertFalse(any("acceptance-secret" in row["MARKER"] for row in rows))
            self.assertEqual(manifest["partition"]["role"], "development")
            self.assertEqual(manifest["partition"]["selection_fields_consulted"], ["CENSUS_D"])
            self.assertFalse(manifest["partition"]["excluded_rows_exported"])
            self.assertFalse(manifest["partition"]["outcomes_derived"])
            self.assertIsNone(manifest["authorization"]["opening_lock_sha256"])
            self.assertIsNone(manifest["authorization"]["opening_receipt_sha256"])

    def test_public_partition_api_refuses_acceptance_with_a_handwritten_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = source_fixture(root)
            registry = registry_fixture(root, source)
            opening_lock = opening_lock_fixture(root, source, registry)
            with mock.patch.object(zipfile, "ZipFile", wraps=zipfile.ZipFile) as zip_constructor:
                with self.assertRaisesRegex(
                    preparation.DevelopmentSourceError, "only inside the one-shot evaluator"
                ):
                    preparation.build_partition_source(
                        source,
                        registry,
                        root / "acceptance",
                        role="acceptance",
                        opening_lock_path=opening_lock,
                    )
            zip_constructor.assert_not_called()
            self.assertFalse((root / "acceptance").exists())

    def test_private_acceptance_path_requires_receipt_before_opening_source_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = source_fixture(root)
            registry = registry_fixture(root, source)
            with mock.patch.object(zipfile, "ZipFile", wraps=zipfile.ZipFile) as zip_constructor:
                with self.assertRaisesRegex(
                    preparation.DevelopmentSourceError, "lock and consumed receipt"
                ):
                    preparation._build_partition_source(
                        source,
                        registry,
                        root / "acceptance",
                        role="acceptance",
                        opening_lock_path=opening_lock_fixture(root, source, registry),
                    )
            zip_constructor.assert_not_called()

    def test_source_bytes_must_match_the_committed_registry_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = source_fixture(root)
            registry = registry_fixture(root, source, wrong_hash=True)
            with self.assertRaisesRegex(preparation.DevelopmentSourceError, "SHA-256"):
                preparation.build_development_source(source, registry, root / "out")

    def test_cross_partition_relationship_cannot_enter_development_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = source_fixture(root, cross_role_trip=True)
            registry = registry_fixture(root, source)
            with self.assertRaisesRegex(
                preparation.DevelopmentSourceError, "households absent"
            ):
                preparation.build_development_source(source, registry, root / "out")
            self.assertFalse((root / "out").exists())
            self.assertEqual(list(root.glob(".mandatory-tour-development-*")), [])

    def test_invalid_table_leaves_no_partial_output_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = source_fixture(root, invalid_trip_division=True)
            registry = registry_fixture(root, source)
            with self.assertRaisesRegex(
                preparation.DevelopmentSourceError, "unregistered CENSUS_D"
            ):
                preparation.build_development_source(source, registry, root / "out")
            self.assertFalse((root / "out").exists())

    def test_output_zip_metadata_and_bytes_are_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = source_fixture(root)
            registry = registry_fixture(root, source)
            first = preparation.build_development_source(source, registry, root / "first")
            second = preparation.build_development_source(source, registry, root / "second")
            self.assertEqual(
                first["output"]["archive_sha256"], second["output"]["archive_sha256"]
            )
            with zipfile.ZipFile(root / "first" / preparation.OUTPUT_ARCHIVE_NAME) as archive:
                self.assertTrue(
                    all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in archive.infolist())
                )

    def test_existing_output_is_not_silently_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = source_fixture(root)
            registry = registry_fixture(root, source)
            preparation.build_development_source(source, registry, root / "out")
            with self.assertRaisesRegex(preparation.DevelopmentSourceError, "refusing to overwrite"):
                preparation.build_development_source(source, registry, root / "out")


if __name__ == "__main__":
    unittest.main()
