#!/usr/bin/env python3
"""Create a registry-bound NHTS partition without crossing the holdout gate.

The input ZIP stores every division in the same CSV members.  The development
entry point exports only development rows before fitting.  The private
acceptance path additionally requires the evaluator's consumed opening receipt;
the public API and command line refuse it.  Selection parses each row to consult
``CENSUS_D``; it does not derive, summarize, or export outcomes for the excluded
partition.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Iterable, Iterator, Literal, Mapping

import mandatory_tour_frequency_registry as preregistration
import us_nhts_survey as source


SCHEMA_VERSION = "openplan.activitysim-mandatory-tour-partition-source.v2"
OPENING_LOCK_SCHEMA_VERSION = (
    "openplan.activitysim-mandatory-tour-frequency-acceptance-opening-lock.v1"
)
OPENING_LOCK_STATUS = "locked_acceptance_unopened"
OPENING_RECEIPT_SCHEMA_VERSION = (
    "openplan.activitysim-mandatory-tour-frequency-acceptance-opening-receipt.v1"
)
OPENING_RECEIPT_STATUS = "acceptance_opening_consumed_before_source_member_read"
PartitionRole = Literal["development", "acceptance"]
OUTPUT_ARCHIVE_NAMES = {
    "development": "nhts-development.zip",
    "acceptance": "nhts-acceptance.zip",
}
OUTPUT_ARCHIVE_NAME = OUTPUT_ARCHIVE_NAMES["development"]
OUTPUT_MANIFEST_NAME = "manifest.json"
FIXED_ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


class DevelopmentSourceError(RuntimeError):
    """The locked survey partition cannot be produced safely."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _division_code(value: Any) -> str:
    return source.normalize_geographic_holdout_code(value)


def _registry_divisions(registry: Mapping[str, Any]) -> tuple[set[str], set[str]]:
    if registry.get("schema_version") != preregistration.SCHEMA_VERSION:
        raise DevelopmentSourceError("The mandatory-tour preregistration schema is unsupported")
    if registry.get("status") != "pre_registered_before_mandatory_tour_outcome_derivation":
        raise DevelopmentSourceError("The mandatory-tour preregistration is not an unopened lock")
    selection = registry.get("selection") or {}
    development = {
        _division_code(row.get("division_code"))
        for row in selection.get("development_divisions") or []
    }
    acceptance = {
        _division_code(row.get("division_code"))
        for row in selection.get("acceptance_divisions") or []
    }
    if not development or not acceptance:
        raise DevelopmentSourceError("The registry needs development and acceptance divisions")
    overlap = development & acceptance
    if overlap:
        raise DevelopmentSourceError(
            "The registry assigns divisions to both development and acceptance: "
            + ", ".join(sorted(overlap))
        )
    expected = set(source.CENSUS_DIVISIONS)
    if development | acceptance != expected:
        raise DevelopmentSourceError(
            "The registry's development and acceptance sets do not cover the NHTS divisions"
        )
    return development, acceptance


def _verify_source_lock(
    archive_path: Path, registry_path: Path, registry: Mapping[str, Any]
) -> None:
    source_lock = registry.get("source") or {}
    digest = _sha256(archive_path)
    if digest != source_lock.get("archive_sha256"):
        raise DevelopmentSourceError(
            "The NHTS archive SHA-256 does not match the preregistration"
        )
    if archive_path.stat().st_size != source_lock.get("archive_size_bytes"):
        raise DevelopmentSourceError(
            "The NHTS archive size does not match the preregistration"
        )
    if not registry_path.is_file():
        raise DevelopmentSourceError("The preregistration file does not exist")


def _included_rows(
    rows: Iterable[Mapping[str, Any]],
    *,
    included: set[str],
    excluded: set[str],
    table_name: str,
) -> Iterator[Mapping[str, Any]]:
    """Yield one role using only the adapter's geographic selection field."""
    for row in rows:
        division = _division_code(row.get("CENSUS_D"))
        if division in excluded:
            continue
        if division not in included:
            raise DevelopmentSourceError(
                f"{table_name} has a row with missing or unregistered CENSUS_D: "
                f"{division or '<missing>'}"
            )
        yield row


def _zip_info(filename: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(filename=filename, date_time=FIXED_ZIP_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    return info


def _write_filtered_table(
    source_archive: zipfile.ZipFile,
    target_archive: zipfile.ZipFile,
    *,
    source_member: str,
    output_member: str,
    included: set[str],
    excluded: set[str],
    role: PartitionRole,
) -> tuple[int, set[str], set[str]]:
    with source_archive.open(source_member) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        fields = list(reader.fieldnames or [])
        if source.GEOGRAPHIC_HOLDOUT_FIELD not in fields:
            raise DevelopmentSourceError(
                f"{output_member} has no CENSUS_D and cannot be separated before outcomes"
            )
        if "HOUSEID" not in fields:
            raise DevelopmentSourceError(
                f"{output_member} has no HOUSEID and cannot prove cross-table membership"
            )
        row_count = 0
        household_ids: set[str] = set()
        person_ids: set[str] = set()
        with target_archive.open(
            _zip_info(output_member), "w", force_zip64=True
        ) as raw_target, io.TextIOWrapper(
            raw_target, encoding="utf-8", newline=""
        ) as text_target:
            writer = csv.DictWriter(text_target, fieldnames=fields, lineterminator="\n")
            writer.writeheader()
            for row in _included_rows(
                reader,
                included=included,
                excluded=excluded,
                table_name=output_member,
            ):
                household_id = str(row.get("HOUSEID") or "").strip()
                if not household_id:
                    raise DevelopmentSourceError(
                        f"{output_member} has a {role} row without HOUSEID"
                    )
                household_ids.add(household_id)
                if "PERSONID" in fields:
                    person_number = str(row.get("PERSONID") or "").strip()
                    if not person_number:
                        raise DevelopmentSourceError(
                            f"{output_member} has a {role} row without PERSONID"
                        )
                    person_ids.add(f"{household_id}:{person_number}")
                writer.writerow(row)
                row_count += 1
    return row_count, household_ids, person_ids


def _resolve_recorded_path(value: str) -> Path:
    path = Path(value)
    repository_root = Path(__file__).resolve().parents[2]
    return path.resolve() if path.is_absolute() else (repository_root / path).resolve()


def _verify_evaluator_authorization(
    lock_path: Path,
    receipt_path: Path,
    *,
    registry_path: Path,
    archive_path: Path,
    acceptance_codes: set[str],
) -> str:
    try:
        lock = json.loads(lock_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise DevelopmentSourceError("The acceptance opening lock is unreadable") from exc
    if lock.get("schema_version") != OPENING_LOCK_SCHEMA_VERSION:
        raise DevelopmentSourceError("The acceptance opening-lock schema is unsupported")
    if lock.get("status") != OPENING_LOCK_STATUS:
        raise DevelopmentSourceError("The acceptance opening lock is not unopened")
    locked_source = lock.get("source") or {}
    if locked_source.get("preregistration_sha256") != _sha256(registry_path):
        raise DevelopmentSourceError("The opening lock names another preregistration")
    if locked_source.get("archive_sha256") != _sha256(archive_path):
        raise DevelopmentSourceError("The opening lock names another source archive")
    if locked_source.get("archive_size_bytes") != archive_path.stat().st_size:
        raise DevelopmentSourceError("The opening lock source size does not match")
    if set(lock.get("acceptance_division_codes") or []) != acceptance_codes:
        raise DevelopmentSourceError("The opening lock names another acceptance partition")
    one_shot = lock.get("one_shot_outputs") or {}
    recorded_receipt = str(one_shot.get("opening_receipt_path") or "")
    if not recorded_receipt or _resolve_recorded_path(recorded_receipt) != receipt_path:
        raise DevelopmentSourceError("The opening lock names another opening receipt")
    try:
        receipt = json.loads(receipt_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise DevelopmentSourceError(
            "The evaluator opening receipt must exist before acceptance source access"
        ) from exc
    if receipt.get("schema_version") != OPENING_RECEIPT_SCHEMA_VERSION:
        raise DevelopmentSourceError("The acceptance opening-receipt schema is unsupported")
    if receipt.get("status") != OPENING_RECEIPT_STATUS:
        raise DevelopmentSourceError("The acceptance opening receipt is not consumed")
    if receipt.get("opening_lock_sha256") != _sha256(lock_path):
        raise DevelopmentSourceError("The opening receipt names another opening lock")
    if receipt.get("source_archive_sha256") != _sha256(archive_path):
        raise DevelopmentSourceError("The opening receipt names another source archive")
    if receipt.get("aggregate_result_path") != one_shot.get("aggregate_result_path"):
        raise DevelopmentSourceError("The opening receipt names another aggregate result")
    return _sha256(lock_path)


def _build_partition_source(
    archive_path: str | Path,
    registry_path: str | Path,
    output_dir: str | Path,
    *,
    role: PartitionRole,
    opening_lock_path: str | Path | None = None,
    opening_receipt_path: str | Path | None = None,
) -> dict[str, Any]:
    archive_file = Path(archive_path).resolve()
    registry_file = Path(registry_path).resolve()
    output = Path(output_dir).resolve()
    if not archive_file.is_file():
        raise DevelopmentSourceError(f"NHTS archive does not exist: {archive_file}")
    if not registry_file.is_file():
        raise DevelopmentSourceError(f"Preregistration does not exist: {registry_file}")
    registry = json.loads(registry_file.read_text())
    development, acceptance = _registry_divisions(registry)
    _verify_source_lock(archive_file, registry_file, registry)
    if role not in OUTPUT_ARCHIVE_NAMES:
        raise DevelopmentSourceError(f"Unsupported partition role: {role}")
    opening_lock_sha256: str | None = None
    opening_receipt_sha256: str | None = None
    if role == "development":
        if opening_lock_path is not None or opening_receipt_path is not None:
            raise DevelopmentSourceError(
                "The development path must not receive acceptance authorization"
            )
        included, excluded = development, acceptance
    else:
        if opening_lock_path is None or opening_receipt_path is None:
            raise DevelopmentSourceError(
                "The acceptance source requires the frozen lock and consumed receipt"
            )
        receipt_file = Path(opening_receipt_path).resolve()
        opening_lock_sha256 = _verify_evaluator_authorization(
            Path(opening_lock_path).resolve(),
            receipt_file,
            registry_path=registry_file,
            archive_path=archive_file,
            acceptance_codes=acceptance,
        )
        opening_receipt_sha256 = _sha256(receipt_file)
        included, excluded = acceptance, development

    if output.exists() or output.is_symlink():
        raise DevelopmentSourceError(
            f"{output} already exists; refusing to overwrite it"
        )

    try:
        input_archive = zipfile.ZipFile(archive_file)
    except zipfile.BadZipFile as exc:
        raise DevelopmentSourceError("NHTS source is not a readable ZIP archive") from exc

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=f".mandatory-tour-{role}-", dir=output.parent)
    )
    output_archive_name = OUTPUT_ARCHIVE_NAMES[role]
    output_archive = staging / output_archive_name
    output_manifest = staging / OUTPUT_MANIFEST_NAME
    try:
        row_counts: dict[str, int] = {}
        households_by_table: dict[str, set[str]] = {}
        persons_by_table: dict[str, set[str]] = {}
        with input_archive as source_zip, zipfile.ZipFile(
            output_archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as target_zip:
            members = {Path(name).name.lower(): name for name in source_zip.namelist()}
            for table_name, filename in source.TABLE_FILES.items():
                source_member = members.get(filename)
                if not source_member:
                    raise DevelopmentSourceError(f"NHTS archive is missing {filename}")
                count, households, persons = _write_filtered_table(
                    source_zip,
                    target_zip,
                    source_member=source_member,
                    output_member=filename,
                    included=included,
                    excluded=excluded,
                    role=role,
                )
                row_counts[table_name] = count
                households_by_table[table_name] = households
                persons_by_table[table_name] = persons

        household_ids = households_by_table["households"]
        for table_name in ("persons", "trips", "vehicles"):
            outside = households_by_table[table_name] - household_ids
            if outside:
                raise DevelopmentSourceError(
                    f"{role.title()} {table_name} reference households absent from the household table"
                )
        outside_people = persons_by_table["trips"] - persons_by_table["persons"]
        if outside_people:
            raise DevelopmentSourceError(
                f"{role.title()} trips reference people absent from the person table"
            )

        manifest = {
            "schema_version": SCHEMA_VERSION,
            "status": (
                "development_partition_acceptance_unopened"
                if role == "development"
                else "acceptance_partition_opened_under_lock"
            ),
            "source": {
                "source_id": source.SOURCE_ID,
                "source_url": source.SOURCE_URL,
                "source_archive_sha256": _sha256(archive_file),
                "preregistration_sha256": _sha256(registry_file),
            },
            "partition": {
                "role": role,
                "included_geography_codes": sorted(included),
                "excluded_geography_codes": sorted(excluded),
                "row_counts": row_counts,
                "selection_fields_consulted": [source.GEOGRAPHIC_HOLDOUT_FIELD],
                "excluded_rows_exported": False,
                "outcomes_derived": False,
            },
            "authorization": {
                "opening_lock_sha256": opening_lock_sha256,
                "opening_receipt_sha256": opening_receipt_sha256,
            },
            "output": {
                "archive": output_archive_name,
                "archive_sha256": _sha256(output_archive),
                "archive_size_bytes": output_archive.stat().st_size,
                "members": list(source.TABLE_FILES.values()),
            },
        }
        output_manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        if output.exists() or output.is_symlink():
            raise DevelopmentSourceError(
                f"{output} appeared while preparing the source; refusing to overwrite it"
            )
        staging.rename(output)
        return manifest
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def build_partition_source(
    archive_path: str | Path,
    registry_path: str | Path,
    output_dir: str | Path,
    *,
    role: PartitionRole,
    opening_lock_path: str | Path | None = None,
) -> dict[str, Any]:
    """Public partition API; acceptance is owned by the one-shot evaluator."""
    if role != "development":
        raise DevelopmentSourceError(
            "Acceptance source access is available only inside the one-shot evaluator"
        )
    return _build_partition_source(
        archive_path,
        registry_path,
        output_dir,
        role="development",
        opening_lock_path=opening_lock_path,
    )


def build_development_source(
    archive_path: str | Path,
    registry_path: str | Path,
    output_dir: str | Path,
) -> dict[str, Any]:
    return build_partition_source(
        archive_path,
        registry_path,
        output_dir,
        role="development",
    )


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", help="Exact FHWA NHTS CSV ZIP")
    parser.add_argument("registry", help="Committed mandatory-tour preregistration JSON")
    parser.add_argument("output_dir", help="New directory for the development source")
    args = parser.parse_args(argv)
    manifest = build_development_source(args.archive, args.registry, args.output_dir)
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
