#!/usr/bin/env python3
"""Inspect the US FHWA NHTS survey archive before ActivitySim estimation.

This is a country adapter, not a core modeling type.  It deliberately stops at
the source boundary: observed survey choices must be inventoried and split into
geographic holdouts before a later adapter maps them into ActivitySim's
household/person/tour/trip estimation tables.

The upstream landing page names the download release, but the bytes at a stable
URL can lag that label.  This module therefore fingerprints the archive and
infers the usable contract from its columns.  It never promotes an archive to
V2.1 merely because the page called it V2.1.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


SOURCE_ID = "us-fhwa-nhts-2022"
SOURCE_URL = "https://nhts.ornl.gov/media/2022/download/csv.zip"
ADVERTISED_RELEASE = "2.1"
TABLE_FILES = {
    "households": "hhv2pub.csv",
    "persons": "perv2pub.csv",
    "trips": "tripv2pub.csv",
    "vehicles": "vehv2pub.csv",
}

# V2.1's release notes define TRIPMODE as the new summarized mode field.  It is
# the smallest unambiguous discriminator between the older public-use schema
# and the advertised V2.1 schema; deriving it locally would create a different
# survey definition and hide upstream drift.
ESTIMATION_REQUIRED_COLUMNS = {
    "households": {"HOUSEID", "WTHHFIN", "CENSUS_D"},
    "persons": {"HOUSEID", "PERSONID", "WTPERFIN"},
    "trips": {
        "HOUSEID",
        "PERSONID",
        "TRIPID",
        "WTTRDFIN",
        "TRIPMODE",
        "WHYFROM",
        "WHYTO",
    },
    "vehicles": {"HOUSEID", "VEHID"},
}


class NhtsSourceError(RuntimeError):
    """The received archive cannot support the claimed estimation contract."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def geographic_holdout_assignments(
    census_divisions: Iterable[str], folds: int = 5
) -> dict[str, int]:
    """Keep every record from one Census division in the same balanced fold.

    A row-level random split would leak the same regional behavior into fit and
    validation.  Source-scoped hashes order the geography codes; round-robin
    assignment then prevents a holdout fold from being accidentally empty.
    """
    divisions = {str(value).strip() for value in census_divisions if str(value).strip()}
    if not divisions:
        raise ValueError("NHTS geographic holdouts require a Census division code")
    if len(divisions) < 2:
        raise ValueError("NHTS geographic validation requires at least two Census divisions")
    if folds < 2:
        raise ValueError("NHTS geographic holdouts require at least two folds")
    effective_folds = min(folds, len(divisions))
    ordered = sorted(
        divisions,
        key=lambda division: hashlib.sha256(
            f"{SOURCE_ID}:{division}".encode("utf-8")
        ).digest(),
    )
    return {division: index % effective_folds for index, division in enumerate(ordered)}


def _float_or_zero(value: str | None) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) and number > 0 else 0.0


def _table_inventory(archive: zipfile.ZipFile, member: str) -> tuple[list[str], int]:
    with archive.open(member) as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        try:
            columns = next(reader)
        except StopIteration:
            return [], 0
        return columns, sum(1 for _ in reader)


def _holdout_inventory(
    archive: zipfile.ZipFile, household_member: str, folds: int
) -> dict[str, Any]:
    with archive.open(household_member) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        household_rows = list(reader)
    divisions = [str(row.get("CENSUS_D") or "").strip() for row in household_rows]
    assignments = geographic_holdout_assignments(divisions, folds)
    effective_folds = max(assignments.values()) + 1
    records = Counter()
    weighted_households = Counter()
    divisions_by_fold: dict[int, set[str]] = {
        fold: set() for fold in range(effective_folds)
    }
    missing_geography = 0
    for row, division in zip(household_rows, divisions):
        if not division:
            missing_geography += 1
            continue
        fold = assignments[division]
        records[fold] += 1
        weighted_households[fold] += _float_or_zero(row.get("WTHHFIN"))
        divisions_by_fold[fold].add(division)
    return {
        "strategy": "whole Census divisions assigned by stable source-scoped hash",
        "requested_fold_count": folds,
        "effective_fold_count": effective_folds,
        "folds": [
            {
                "fold": fold,
                "household_records": records[fold],
                "weighted_households": round(weighted_households[fold], 6),
                "division_codes": sorted(divisions_by_fold[fold]),
            }
            for fold in range(effective_folds)
        ],
        "records_missing_geography": missing_geography,
    }


def inspect_archive(path: str | Path, *, holdout_folds: int = 5) -> dict[str, Any]:
    archive_path = Path(path)
    if not archive_path.is_file():
        raise NhtsSourceError(f"NHTS archive does not exist: {archive_path}")

    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as exc:
        raise NhtsSourceError("NHTS source is not a readable ZIP archive") from exc

    with archive:
        members = {Path(name).name.lower(): name for name in archive.namelist()}
        missing_files = [filename for filename in TABLE_FILES.values() if filename not in members]
        if missing_files:
            raise NhtsSourceError(
                "NHTS archive is missing required public-use tables: " + ", ".join(missing_files)
            )

        tables: dict[str, Any] = {}
        missing_columns: dict[str, list[str]] = {}
        for table, filename in TABLE_FILES.items():
            columns, rows = _table_inventory(archive, members[filename])
            tables[table] = {"filename": filename, "rows": rows, "columns": columns}
            absent = sorted(ESTIMATION_REQUIRED_COLUMNS[table] - set(columns))
            if absent:
                missing_columns[table] = absent

        inferred_release = "2.1" if "TRIPMODE" in tables["trips"]["columns"] else "pre-2.1"
        ready = not missing_columns
        return {
            "schema_version": "openplan.behavioral-survey-source.v1",
            "source_id": SOURCE_ID,
            "source_url": SOURCE_URL,
            "advertised_release": ADVERTISED_RELEASE,
            "inferred_release": inferred_release,
            "advertised_release_matches_bytes": inferred_release == ADVERTISED_RELEASE,
            "archive_sha256": _sha256(archive_path),
            "archive_size_bytes": archive_path.stat().st_size,
            "tables": tables,
            "estimation_contract": {
                "ready": ready,
                "missing_columns": missing_columns,
                "note": (
                    "Ready for ActivitySim survey-table mapping."
                    if ready
                    else "Source schema is not the advertised estimation contract; no fields were derived."
                ),
            },
            "geographic_holdouts": _holdout_inventory(
                archive, members[TABLE_FILES["households"]], holdout_folds
            ),
        }


def require_estimation_contract(inventory: dict[str, Any]) -> None:
    contract = inventory.get("estimation_contract") or {}
    if contract.get("ready") is not True:
        missing = contract.get("missing_columns") or {}
        detail = "; ".join(
            f"{table}: {', '.join(columns)}" for table, columns in sorted(missing.items())
        )
        raise NhtsSourceError(
            "NHTS archive cannot enter ActivitySim estimation because its measured schema "
            f"does not satisfy the contract ({detail or 'reason not recorded'})"
        )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", help="Downloaded FHWA NHTS CSV ZIP")
    parser.add_argument("--output", help="Write the JSON inventory here instead of stdout")
    parser.add_argument("--holdout-folds", type=int, default=5)
    parser.add_argument("--require-estimation-ready", action="store_true")
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    inventory = inspect_archive(args.archive, holdout_folds=args.holdout_folds)
    if args.require_estimation_ready:
        require_estimation_contract(inventory)
    rendered = json.dumps(inventory, indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).write_text(rendered)
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
