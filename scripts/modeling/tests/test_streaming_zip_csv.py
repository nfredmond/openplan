#!/usr/bin/env python3
from __future__ import annotations

import gc
import sqlite3
import sys
import tempfile
import tracemalloc
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[3]
RESEARCH_DIR = REPO_ROOT / "scripts" / "research"
if str(RESEARCH_DIR) not in sys.path:
    sys.path.insert(0, str(RESEARCH_DIR))

import streaming_zip_csv  # noqa: E402


def write_archive(path: Path, rows: int) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        with archive.open("people.csv", "w") as member:
            member.write(b"row_id,value\n")
            for index in range(rows):
                member.write(f"{index},value-{index % 17}\n".encode())
        archive.writestr("ignored.csv", "private_id\nsecret\n")


def measured_peak(rows: int, directory: Path) -> int:
    archive = directory / f"source-{rows}.zip"
    database = directory / f"stage-{rows}.sqlite"
    write_archive(archive, rows)
    gc.collect()
    tracemalloc.start()
    try:
        result = streaming_zip_csv.stage_zip_csv_tables(
            archive,
            {"people.csv": {"table": "people", "columns": ["row_id", "value"]}},
            database,
        )
        _current, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    if result != {"people": rows}:
        raise AssertionError(f"wrong row count: {result}")
    return peak


class StreamingZipCsvTests(unittest.TestCase):
    def test_selected_tables_are_staged_in_two_thousand_row_batches(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "source.zip"
            database = root / "stage.sqlite"
            write_archive(archive, 4_501)
            connect = sqlite3.connect
            original = sqlite3.Connection.executemany
            batch_lengths: list[int] = []

            class RecordingConnection(sqlite3.Connection):
                def executemany(self, sql, parameters):
                    batch_lengths.append(len(parameters))
                    return original(self, sql, parameters)

            with mock.patch.object(
                streaming_zip_csv.sqlite3,
                "connect",
                side_effect=lambda path: connect(path, factory=RecordingConnection),
            ):
                counts = streaming_zip_csv.stage_zip_csv_tables(
                    archive,
                    {"people.csv": {"table": "people", "columns": ["row_id", "value"]}},
                    database,
                )
            self.assertEqual(counts, {"people": 4_501})
            self.assertEqual(batch_lengths, [2_000, 2_000, 501])
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT count(*) FROM people").fetchone()[0], 4_501)
                self.assertEqual(
                    connection.execute("SELECT value FROM people WHERE row_id = '4500'").fetchone()[0],
                    "value-12",
                )

    def test_peak_python_allocation_stays_bounded_when_rows_grow_tenfold(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            small_peak = measured_peak(10_000, root)
            large_peak = measured_peak(100_000, root)
            self.assertLess(large_peak, 256 * 1024 * 1024)
            self.assertLess(large_peak, small_peak * 2)

    def test_member_inventory_uses_uncompressed_sizes_and_missing_members_fail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "source.zip"
            write_archive(archive, 12)
            with zipfile.ZipFile(archive) as opened:
                expected = opened.getinfo("people.csv").file_size
            self.assertEqual(
                streaming_zip_csv.selected_uncompressed_bytes(archive, ["people.csv"]),
                expected,
            )
            with self.assertRaisesRegex(
                streaming_zip_csv.StreamingZipCsvError, "missing"
            ):
                streaming_zip_csv.selected_uncompressed_bytes(archive, ["absent.csv"])

    def test_existing_database_and_changed_headers_are_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "source.zip"
            database = root / "stage.sqlite"
            write_archive(archive, 2)
            database.write_text("do not replace")
            with self.assertRaisesRegex(
                streaming_zip_csv.StreamingZipCsvError, "must not already exist"
            ):
                streaming_zip_csv.stage_zip_csv_tables(
                    archive, {"people.csv": "people"}, database
                )
            database.unlink()
            with self.assertRaisesRegex(
                streaming_zip_csv.StreamingZipCsvError, "columns differ"
            ):
                streaming_zip_csv.stage_zip_csv_tables(
                    archive,
                    {"people.csv": {"table": "people", "columns": ["wrong"]}},
                    database,
                )


if __name__ == "__main__":
    unittest.main()
