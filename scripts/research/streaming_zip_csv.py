#!/usr/bin/env python3
"""Stage selected ZIP CSV members in SQLite without loading a table in memory."""

from __future__ import annotations

import csv
import io
import re
import sqlite3
import zipfile
from collections.abc import Mapping, Sequence
from contextlib import closing
from pathlib import Path
from typing import Any


DEFAULT_BATCH_SIZE = 2_000
_SQL_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class StreamingZipCsvError(RuntimeError):
    """The selected CSV members cannot be staged under the frozen contract."""


def _identifier(value: str, label: str) -> str:
    if not _SQL_IDENTIFIER.fullmatch(value):
        raise StreamingZipCsvError(f"{label} is not a safe SQLite identifier")
    return value


def _table_spec(member: str, raw: Any) -> tuple[str, tuple[str, ...] | None]:
    if isinstance(raw, str):
        return _identifier(raw, f"table for {member}"), None
    if not isinstance(raw, Mapping):
        raise StreamingZipCsvError(f"table configuration for {member} is invalid")
    table = _identifier(str(raw.get("table", "")), f"table for {member}")
    raw_columns = raw.get("columns")
    if raw_columns is None:
        return table, None
    if (
        not isinstance(raw_columns, Sequence)
        or isinstance(raw_columns, (str, bytes))
        or not raw_columns
        or not all(isinstance(column, str) and column for column in raw_columns)
        or len(set(raw_columns)) != len(raw_columns)
    ):
        raise StreamingZipCsvError(f"columns for {member} are invalid")
    return table, tuple(raw_columns)


def stage_zip_csv_tables(
    archive_path: str | Path,
    tables: Mapping[str, str | Mapping[str, Any]],
    sqlite_path: str | Path,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    encoding: str = "utf-8-sig",
) -> dict[str, int]:
    """Stream configured members into one new SQLite database.

    Values stay as CSV text. Each in-memory batch contains at most ``batch_size``
    rows, and SQLite owns all complete-table storage.
    """
    if not isinstance(batch_size, int) or isinstance(batch_size, bool) or batch_size <= 0:
        raise StreamingZipCsvError("batch_size must be a positive integer")
    if not tables:
        raise StreamingZipCsvError("at least one ZIP member must be selected")

    destination = Path(sqlite_path).resolve()
    if destination.exists() or destination.is_symlink():
        raise StreamingZipCsvError("the SQLite staging path must not already exist")
    destination.parent.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}

    try:
        with zipfile.ZipFile(Path(archive_path).resolve()) as archive:
            available = set(archive.namelist())
            missing = set(tables) - available
            if missing:
                raise StreamingZipCsvError(
                    "selected ZIP members are missing: " + ", ".join(sorted(missing))
                )
            with closing(sqlite3.connect(destination)) as database:
                database.execute("PRAGMA journal_mode=DELETE")
                database.execute("PRAGMA synchronous=FULL")
                for member, raw_spec in tables.items():
                    table, configured_columns = _table_spec(member, raw_spec)
                    with archive.open(member, "r") as binary:
                        with io.TextIOWrapper(binary, encoding=encoding, newline="") as text:
                            reader = csv.reader(text)
                            try:
                                header = tuple(next(reader))
                            except StopIteration as exc:
                                raise StreamingZipCsvError(f"{member} has no header") from exc
                            if not header or any(not column for column in header):
                                raise StreamingZipCsvError(f"{member} has an invalid header")
                            if len(set(header)) != len(header):
                                raise StreamingZipCsvError(f"{member} has duplicate columns")
                            if configured_columns is not None and header != configured_columns:
                                raise StreamingZipCsvError(
                                    f"{member} columns differ from the frozen configuration"
                                )

                            quoted_columns = ", ".join(
                                f'"{column.replace(chr(34), chr(34) * 2)}"' for column in header
                            )
                            database.execute(
                                f'CREATE TABLE "{table}" ({quoted_columns})'
                            )
                            placeholders = ", ".join("?" for _ in header)
                            insert = f'INSERT INTO "{table}" VALUES ({placeholders})'
                            batch: list[tuple[str, ...]] = []
                            row_count = 0
                            for row in reader:
                                if len(row) != len(header):
                                    raise StreamingZipCsvError(
                                        f"{member} row {row_count + 2} has the wrong field count"
                                    )
                                batch.append(tuple(row))
                                if len(batch) == batch_size:
                                    database.executemany(insert, batch)
                                    row_count += len(batch)
                                    batch.clear()
                            if batch:
                                database.executemany(insert, batch)
                                row_count += len(batch)
                                batch.clear()
                            counts[table] = row_count
                database.commit()
    except (OSError, csv.Error, sqlite3.Error, zipfile.BadZipFile) as exc:
        raise StreamingZipCsvError("ZIP CSV staging failed") from exc
    return counts


def selected_uncompressed_bytes(
    archive_path: str | Path, members: Sequence[str]
) -> int:
    """Read only the ZIP directory and total the selected members' declared sizes."""
    if not members or not all(isinstance(member, str) and member for member in members):
        raise StreamingZipCsvError("selected_members must be a non-empty string array")
    if len(set(members)) != len(members):
        raise StreamingZipCsvError("selected_members contains duplicates")
    try:
        with zipfile.ZipFile(Path(archive_path).resolve()) as archive:
            by_name = {entry.filename: entry for entry in archive.infolist()}
            missing = set(members) - set(by_name)
            if missing:
                raise StreamingZipCsvError(
                    "selected ZIP members are missing: " + ", ".join(sorted(missing))
                )
            return sum(by_name[member].file_size for member in members)
    except (OSError, zipfile.BadZipFile) as exc:
        raise StreamingZipCsvError("the source is not a readable ZIP archive") from exc
