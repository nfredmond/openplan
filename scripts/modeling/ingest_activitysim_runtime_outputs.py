#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

RUNTIME_MANIFEST_NAME = "runtime_manifest.json"
RUNTIME_SUMMARY_NAME = "runtime_summary.json"
DEFAULT_OUTPUT_SUBDIR = "output"
DEFAULT_INGESTION_SUBDIR = "ingestion"
INGESTION_SUMMARY_NAME = "activitysim_output_ingestion_summary.json"
ARTIFACT_METADATA_NAME = "activitysim_output_artifacts.json"

COMMON_TABLE_NAMES = {
    "households": {"households", "final_households"},
    "persons": {"persons", "final_persons"},
    "tours": {"tours", "final_tours"},
    "trips": {"trips", "final_trips"},
}

SEGMENT_COLUMNS = ("income", "person_type", "household_type")


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest an ActivitySim runtime directory into OpenPlan-native output metadata."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--runtime-dir", help="Path to an ActivitySim runtime directory")
    source_group.add_argument("--runtime-manifest", help="Path to an ActivitySim runtime_manifest.json")
    parser.add_argument(
        "--output-dir",
        help="Directory where ingestion outputs should be written (default: <runtime>/ingestion)",
    )
    parser.add_argument("--force", action="store_true", help="Replace an existing ingestion output directory")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any] | list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def sha256_for_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_runtime_paths(runtime_dir: str | None, runtime_manifest: str | None) -> tuple[Path, Path]:
    provided = [value for value in (runtime_dir, runtime_manifest) if value]
    if len(provided) != 1:
        raise RuntimeError("Provide exactly one of runtime_dir or runtime_manifest")

    if runtime_dir:
        resolved_runtime_dir = Path(runtime_dir).expanduser().resolve()
        resolved_manifest_path = resolved_runtime_dir / RUNTIME_MANIFEST_NAME
    else:
        resolved_manifest_path = Path(runtime_manifest).expanduser().resolve()
        resolved_runtime_dir = resolved_manifest_path.parent

    if resolved_manifest_path.name != RUNTIME_MANIFEST_NAME:
        raise RuntimeError(f"Expected runtime manifest named {RUNTIME_MANIFEST_NAME}, got {resolved_manifest_path.name}")
    if not resolved_runtime_dir.exists():
        raise RuntimeError(f"Runtime directory does not exist: {resolved_runtime_dir}")
    if not resolved_manifest_path.exists():
        raise RuntimeError(f"Runtime manifest does not exist: {resolved_manifest_path}")
    return resolved_runtime_dir, resolved_manifest_path


def validate_runtime_manifest(manifest: dict[str, Any], manifest_path: Path) -> None:
    schema_version = manifest.get("schema_version")
    if not isinstance(schema_version, str) or not schema_version.startswith("openplan.activitysim_runtime."):
        raise RuntimeError(f"Unsupported runtime schema version in {manifest_path}: {schema_version!r}")
    runtime_type = manifest.get("runtime_type")
    if runtime_type != "activitysim_worker_runtime":
        raise RuntimeError(f"Unsupported runtime type in {manifest_path}: {runtime_type!r}")


def relative_file_metadata(path: Path, base_dir: Path) -> dict[str, Any]:
    return {
        "relative_path": str(path.relative_to(base_dir)),
        "byte_size": path.stat().st_size,
        "sha256": sha256_for_file(path),
    }


def output_files(output_dir: Path, runtime_dir: Path) -> list[dict[str, Any]]:
    if not output_dir.exists():
        return []
    files: list[dict[str, Any]] = []
    for path in sorted(output_dir.rglob("*")):
        if path.is_file():
            files.append(relative_file_metadata(path, runtime_dir))
    return files


def _open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", newline="")
    return path.open("r", newline="")


def normalized_table_name(path: Path) -> str:
    name = path.name
    if name.endswith(".csv.gz"):
        return name[: -len(".csv.gz")]
    if name.endswith(".csv"):
        return name[: -len(".csv")]
    return path.stem


def common_table_kind(table_name: str) -> str | None:
    for kind, aliases in COMMON_TABLE_NAMES.items():
        if table_name in aliases:
            return kind
    return None


def inspect_table(path: Path, runtime_dir: Path) -> dict[str, Any] | None:
    if not (path.name.endswith(".csv") or path.name.endswith(".csv.gz")):
        return None

    metadata = relative_file_metadata(path, runtime_dir)
    table_name = normalized_table_name(path)
    try:
        with _open_text(path) as handle:
            reader = csv.reader(handle)
            header = next(reader, [])
            row_count = 0
            for _ in reader:
                row_count += 1
    except Exception as exc:
        return {
            **metadata,
            "table_name": table_name,
            "format": "csv",
            "inspection_error": f"{exc.__class__.__name__}: {exc}",
            "common_table_kind": common_table_kind(table_name),
        }

    return {
        **metadata,
        "table_name": table_name,
        "format": "csv",
        "row_count": row_count,
        "column_count": len(header),
        "columns": header,
        "common_table_kind": common_table_kind(table_name),
    }


def discovered_tables(output_dir: Path, runtime_dir: Path) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    if not output_dir.exists():
        return tables
    for path in sorted(output_dir.rglob("*")):
        if not path.is_file():
            continue
        inspected = inspect_table(path, runtime_dir)
        if inspected is not None:
            tables.append(inspected)
    return tables


def collect_common_tables(tables: list[dict[str, Any]]) -> dict[str, dict[str, Any] | None]:
    selected: dict[str, dict[str, Any] | None] = {key: None for key in COMMON_TABLE_NAMES}
    for kind in COMMON_TABLE_NAMES:
        candidates = [table for table in tables if table.get("common_table_kind") == kind]
        candidates.sort(key=lambda item: (0 if item["table_name"] == kind else 1, item["relative_path"]))
        if candidates:
            selected[kind] = candidates[0]
    return selected


def detected_segments(tables: list[dict[str, Any]]) -> list[str]:
    discovered = set()
    for table in tables:
        for column in table.get("columns", []):
            if column in SEGMENT_COLUMNS:
                discovered.add(column)
    return sorted(discovered)


def stage_statuses(manifest: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for stage in manifest.get("stages", []):
        stage_key = stage.get("stage_key")
        if isinstance(stage_key, str):
            result[stage_key] = str(stage.get("status"))
    return result


def build_caveats(
    *,
    runtime_manifest: dict[str, Any],
    output_file_inventory: list[dict[str, Any]],
    tables: list[dict[str, Any]],
) -> list[str]:
    caveats = [str(item) for item in runtime_manifest.get("caveats", []) if isinstance(item, str)]
    if runtime_manifest.get("mode") == "preflight_only":
        caveats.append("Runtime mode is preflight_only; ingestion only reflects staged support artifacts and any files actually present under output/.")
    if not output_file_inventory:
        caveats.append("No files were discovered under output/; ingestion does not claim behavioral tables or KPI-ready outputs.")
    if runtime_manifest.get("status") == "failed" and output_file_inventory:
        caveats.append("Runtime status is failed; discovered output files are ingested as partial artifacts only.")
    if any(table.get("inspection_error") for table in tables):
        caveats.append("One or more discovered CSV outputs could not be fully inspected; row counts may be incomplete for those files.")
    caveats.append("Prototype ingestion reports file presence and lightweight table stats only; it does not validate KPI meaning or calibration quality.")

    deduped: list[str] = []
    seen = set()
    for caveat in caveats:
        if caveat not in seen:
            deduped.append(caveat)
            seen.add(caveat)
    return deduped


def build_artifact_inventory(
    *,
    runtime_dir: Path,
    runtime_manifest_path: Path,
    runtime_manifest: dict[str, Any],
    output_file_inventory: list[dict[str, Any]],
    tables: list[dict[str, Any]],
    caveats: list[str],
) -> list[dict[str, Any]]:
    common_tables = collect_common_tables(tables)
    segments = detected_segments(tables)

    artifacts: list[dict[str, Any]] = [
        {
            "artifact_type": "activitysim_runtime_manifest",
            "path": str(runtime_manifest_path),
            "relative_path": str(runtime_manifest_path.relative_to(runtime_dir)),
            "metadata_json": {
                "runtimeMode": runtime_manifest.get("mode"),
                "runtimeStatus": runtime_manifest.get("status"),
                "sourceStageKey": "run_activitysim",
            },
        }
    ]

    runtime_summary_path = runtime_dir / RUNTIME_SUMMARY_NAME
    if runtime_summary_path.exists():
        artifacts.append(
            {
                "artifact_type": "activitysim_runtime_summary",
                "path": str(runtime_summary_path),
                "relative_path": str(runtime_summary_path.relative_to(runtime_dir)),
                "metadata_json": {
                    "runtimeMode": runtime_manifest.get("mode"),
                    "runtimeStatus": runtime_manifest.get("status"),
                    "sourceStageKey": "collect_outputs",
                },
            }
        )

    artifacts.append(
        {
            "artifact_type": "activitysim_output_bundle",
            "path": str(runtime_dir / DEFAULT_OUTPUT_SUBDIR),
            "relative_path": DEFAULT_OUTPUT_SUBDIR,
            "metadata_json": {
                "householdCount": int((common_tables["households"] or {}).get("row_count", 0) or 0),
                "personCount": int((common_tables["persons"] or {}).get("row_count", 0) or 0),
                "tourCount": int((common_tables["tours"] or {}).get("row_count", 0) or 0),
                "tripCount": int((common_tables["trips"] or {}).get("row_count", 0) or 0),
                "segments": segments,
                "sourceStageKey": "run_activitysim",
                "runtimeMode": runtime_manifest.get("mode"),
                "runtimeStatus": runtime_manifest.get("status"),
                "outputFileCount": len(output_file_inventory),
                "outputTableCount": len(tables),
                "prototype": True,
            },
            "caveats": caveats,
        }
    )

    for table in tables:
        artifacts.append(
            {
                "artifact_type": "activitysim_output_table",
                "path": str(runtime_dir / table["relative_path"]),
                "relative_path": table["relative_path"],
                "metadata_json": {
                    "tableName": table["table_name"],
                    "rowCount": table.get("row_count"),
                    "columnCount": table.get("column_count"),
                    "commonTableKind": table.get("common_table_kind"),
                    "sourceStageKey": "run_activitysim",
                    "runtimeStatus": runtime_manifest.get("status"),
                },
            }
        )

    return artifacts


def ingest_activitysim_runtime_outputs(
    *,
    runtime_dir: str | None = None,
    runtime_manifest: str | None = None,
    output_dir: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    resolved_runtime_dir, resolved_manifest_path = resolve_runtime_paths(runtime_dir, runtime_manifest)
    manifest = read_json(resolved_manifest_path)
    validate_runtime_manifest(manifest, resolved_manifest_path)

    ingestion_dir = Path(output_dir).expanduser().resolve() if output_dir else resolved_runtime_dir / DEFAULT_INGESTION_SUBDIR
    if ingestion_dir.exists():
        if not force:
            raise RuntimeError(f"Ingestion output directory already exists: {ingestion_dir}")
        shutil.rmtree(ingestion_dir)
    ingestion_dir.mkdir(parents=True, exist_ok=True)

    output_dir_path = resolved_runtime_dir / DEFAULT_OUTPUT_SUBDIR
    output_file_inventory = output_files(output_dir_path, resolved_runtime_dir)
    tables = discovered_tables(output_dir_path, resolved_runtime_dir)
    common_tables = collect_common_tables(tables)
    caveats = build_caveats(runtime_manifest=manifest, output_file_inventory=output_file_inventory, tables=tables)
    artifacts = build_artifact_inventory(
        runtime_dir=resolved_runtime_dir,
        runtime_manifest_path=resolved_manifest_path,
        runtime_manifest=manifest,
        output_file_inventory=output_file_inventory,
        tables=tables,
        caveats=caveats,
    )

    summary = {
        "schema_version": "openplan.activitysim_output_ingestion.v0",
        "ingestion_type": "activitysim_runtime_output_ingestion",
        "created_at_utc": _utc_now(),
        "runtime": {
            "runtime_dir": str(resolved_runtime_dir),
            "runtime_manifest_path": str(resolved_manifest_path),
            "runtime_type": manifest.get("runtime_type"),
            "runtime_schema_version": manifest.get("schema_version"),
            "mode": manifest.get("mode"),
            "status": manifest.get("status"),
            "caveats": list(manifest.get("caveats", [])),
            "errors": list(manifest.get("errors", [])),
            "stage_statuses": stage_statuses(manifest),
        },
        "artifact_inventory": artifacts,
        "output_inventory": output_file_inventory,
        "output_tables": tables,
        "common_tables": common_tables,
        "caveats": caveats,
    }

    artifact_metadata = {
        "schema_version": "openplan.artifact_registration.v0",
        "source_runtime_dir": str(resolved_runtime_dir),
        "artifacts": artifacts,
    }

    summary_path = ingestion_dir / INGESTION_SUMMARY_NAME
    artifact_metadata_path = ingestion_dir / ARTIFACT_METADATA_NAME
    write_json(summary_path, summary)
    write_json(artifact_metadata_path, artifact_metadata)

    return {
        "runtime_dir": str(resolved_runtime_dir),
        "runtime_manifest_path": str(resolved_manifest_path),
        "ingestion_dir": str(ingestion_dir),
        "summary_path": str(summary_path),
        "artifact_metadata_path": str(artifact_metadata_path),
        "mode": manifest.get("mode"),
        "status": manifest.get("status"),
        "output_file_count": len(output_file_inventory),
        "output_table_count": len(tables),
        "caveats": caveats,
    }


def main() -> int:
    args = parse_args()
    summary = ingest_activitysim_runtime_outputs(
        runtime_dir=args.runtime_dir,
        runtime_manifest=args.runtime_manifest,
        output_dir=args.output_dir,
        force=args.force,
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
