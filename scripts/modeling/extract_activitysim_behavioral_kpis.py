#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import shutil
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ingest_activitysim_runtime_outputs import (
    COMMON_TABLE_NAMES,
    DEFAULT_OUTPUT_SUBDIR,
    RUNTIME_MANIFEST_NAME,
    build_caveats,
    collect_common_tables,
    discovered_tables,
    output_files,
    read_json,
    resolve_runtime_paths,
    stage_statuses,
    validate_runtime_manifest,
)

KPI_SUMMARY_NAME = "activitysim_behavioral_kpi_summary.json"
KPI_PACKET_NAME = "activitysim_behavioral_kpi_packet.md"
DEFAULT_KPI_SUBDIR = "kpis"
INGESTION_SUMMARY_NAME = "activitysim_output_ingestion_summary.json"

PURPOSE_COLUMNS = ("purpose", "trip_purpose", "primary_purpose", "tour_type")
MODE_COLUMNS = ("trip_mode", "mode", "tour_mode")
MISSING_VALUE_LABEL = "(missing)"
INCOME_BINS = (
    (25_000, "under_25k"),
    (50_000, "25k_to_49k"),
    (100_000, "50k_to_99k"),
    (150_000, "100k_to_149k"),
)


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract a lightweight behavioral KPI packet from ActivitySim runtime outputs."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--runtime-dir", help="Path to an ActivitySim runtime directory")
    source_group.add_argument(
        "--ingestion-summary",
        help="Path to an activitysim_output_ingestion_summary.json file",
    )
    parser.add_argument(
        "--output-dir",
        help="Directory where KPI outputs should be written (default: <runtime>/kpis)",
    )
    parser.add_argument("--force", action="store_true", help="Replace an existing KPI output directory")
    return parser.parse_args()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def write_markdown(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


def resolve_kpi_source(
    *,
    runtime_dir: str | None = None,
    ingestion_summary: str | None = None,
) -> dict[str, Any]:
    if runtime_dir:
        resolved_runtime_dir, resolved_manifest_path = resolve_runtime_paths(runtime_dir, None)
        manifest = read_json(resolved_manifest_path)
        validate_runtime_manifest(manifest, resolved_manifest_path)
        output_dir = resolved_runtime_dir / DEFAULT_OUTPUT_SUBDIR
        output_inventory = output_files(output_dir, resolved_runtime_dir)
        tables = discovered_tables(output_dir, resolved_runtime_dir)
        common_tables = collect_common_tables(tables)
        caveats = build_caveats(
            runtime_manifest=manifest,
            output_file_inventory=output_inventory,
            tables=tables,
        )
        return {
            "runtime_dir": resolved_runtime_dir,
            "runtime_manifest_path": resolved_manifest_path,
            "runtime_manifest": manifest,
            "ingestion_summary_path": None,
            "ingestion_summary": None,
            "tables": tables,
            "common_tables": common_tables,
            "caveats": caveats,
        }

    if not ingestion_summary:
        raise RuntimeError("Provide exactly one of runtime_dir or ingestion_summary")

    summary_path = Path(ingestion_summary).expanduser().resolve()
    if summary_path.name != INGESTION_SUMMARY_NAME:
        raise RuntimeError(f"Expected ingestion summary named {INGESTION_SUMMARY_NAME}, got {summary_path.name}")
    if not summary_path.exists():
        raise RuntimeError(f"Ingestion summary does not exist: {summary_path}")

    summary = read_json(summary_path)
    schema_version = summary.get("schema_version")
    if not isinstance(schema_version, str) or not schema_version.startswith("openplan.activitysim_output_ingestion."):
        raise RuntimeError(f"Unsupported ingestion schema version in {summary_path}: {schema_version!r}")

    runtime = summary.get("runtime", {})
    resolved_runtime_dir = Path(runtime["runtime_dir"]).expanduser().resolve()
    resolved_manifest_path = Path(runtime["runtime_manifest_path"]).expanduser().resolve()
    manifest = read_json(resolved_manifest_path)
    validate_runtime_manifest(manifest, resolved_manifest_path)
    return {
        "runtime_dir": resolved_runtime_dir,
        "runtime_manifest_path": resolved_manifest_path,
        "runtime_manifest": manifest,
        "ingestion_summary_path": summary_path,
        "ingestion_summary": summary,
        "tables": list(summary.get("output_tables", [])),
        "common_tables": dict(summary.get("common_tables", {})),
        "caveats": list(summary.get("caveats", [])),
    }


def load_table_rows(runtime_dir: Path, table_metadata: dict[str, Any] | None) -> list[dict[str, str]]:
    if not table_metadata:
        return []
    relative_path = table_metadata.get("relative_path")
    if not isinstance(relative_path, str) or not relative_path:
        return []
    path = runtime_dir / relative_path
    if not path.exists():
        return []
    with path.open("r", newline="") as handle:
        reader = csv.DictReader(handle)
        return [dict(row) for row in reader]


def first_present_column(rows: list[dict[str, str]], columns: tuple[str, ...]) -> str | None:
    if not rows:
        return None
    keys = set(rows[0].keys())
    for column in columns:
        if column in keys:
            return column
    return None


def normalize_value(value: Any) -> str:
    text = "" if value is None else str(value).strip()
    return text or MISSING_VALUE_LABEL


def parse_numeric(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def income_bin_label(value: Any) -> str:
    numeric = parse_numeric(value)
    if numeric is None:
        return normalize_value(value)
    for upper_bound, label in INCOME_BINS:
        if numeric < upper_bound:
            return label
    return "150k_plus"


def summarize_counter(counter: Counter[str]) -> list[dict[str, Any]]:
    total = sum(counter.values())
    rows = []
    for label, count in sorted(counter.items(), key=lambda item: (-item[1], item[0])):
        rows.append(
            {
                "label": label,
                "count": int(count),
                "share": round((count / total), 6) if total else None,
            }
        )
    return rows


def summarize_grouped_counts(
    rows: list[dict[str, str]],
    *,
    column: str,
    transform: callable | None = None,
) -> dict[str, Any]:
    counter: Counter[str] = Counter()
    for row in rows:
        raw_value = row.get(column)
        label = transform(raw_value) if transform else normalize_value(raw_value)
        counter[label] += 1
    return {
        "available": bool(rows),
        "source_column": column,
        "total_records_summarized": int(sum(counter.values())),
        "values": summarize_counter(counter),
    }


def build_indexes(
    households_rows: list[dict[str, str]],
    persons_rows: list[dict[str, str]],
) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    households_by_id = {
        normalize_value(row.get("household_id")): row
        for row in households_rows
        if normalize_value(row.get("household_id")) != MISSING_VALUE_LABEL
    }
    persons_by_id = {
        normalize_value(row.get("person_id")): row
        for row in persons_rows
        if normalize_value(row.get("person_id")) != MISSING_VALUE_LABEL
    }
    return households_by_id, persons_by_id


def segment_value_for_row(
    *,
    row: dict[str, str],
    segment: str,
    households_by_id: dict[str, dict[str, str]],
    persons_by_id: dict[str, dict[str, str]],
) -> tuple[str | None, str | None]:
    if segment in row:
        return row.get(segment), "direct"

    if segment == "person_type":
        person_id = normalize_value(row.get("person_id"))
        person = persons_by_id.get(person_id)
        if person and "person_type" in person:
            return person.get("person_type"), "person_lookup"
        return None, None

    household_id = normalize_value(row.get("household_id"))
    household = households_by_id.get(household_id)
    if household and segment in household:
        return household.get(segment), "household_lookup"

    person_id = normalize_value(row.get("person_id"))
    person = persons_by_id.get(person_id)
    if person:
        person_household_id = normalize_value(person.get("household_id"))
        household = households_by_id.get(person_household_id)
        if household and segment in household:
            return household.get(segment), "person_household_lookup"

    return None, None


def summarize_segment(
    *,
    target_kind: str,
    rows: list[dict[str, str]],
    segment: str,
    households_by_id: dict[str, dict[str, str]],
    persons_by_id: dict[str, dict[str, str]],
) -> dict[str, Any] | None:
    if not rows:
        return None

    counter: Counter[str] = Counter()
    relationship = None
    for row in rows:
        raw_value, current_relationship = segment_value_for_row(
            row=row,
            segment=segment,
            households_by_id=households_by_id,
            persons_by_id=persons_by_id,
        )
        if current_relationship is None:
            continue
        relationship = relationship or current_relationship
        if segment == "income":
            label = income_bin_label(raw_value)
        else:
            label = normalize_value(raw_value)
        counter[label] += 1

    if not counter:
        return None

    return {
        "target_kind": target_kind,
        "segment": "income_bin" if segment == "income" else segment,
        "source_column": segment,
        "relationship": relationship,
        "total_records_summarized": int(sum(counter.values())),
        "values": summarize_counter(counter),
    }


def build_segment_summaries(
    *,
    households_rows: list[dict[str, str]],
    persons_rows: list[dict[str, str]],
    tours_rows: list[dict[str, str]],
    trips_rows: list[dict[str, str]],
) -> list[dict[str, Any]]:
    households_by_id, persons_by_id = build_indexes(households_rows, persons_rows)
    target_rows = {
        "households": households_rows,
        "persons": persons_rows,
        "tours": tours_rows,
        "trips": trips_rows,
    }
    summaries: list[dict[str, Any]] = []
    for target_kind in ("households", "persons", "tours", "trips"):
        for segment in ("person_type", "income", "household_type"):
            summary = summarize_segment(
                target_kind=target_kind,
                rows=target_rows[target_kind],
                segment=segment,
                households_by_id=households_by_id,
                persons_by_id=persons_by_id,
            )
            if summary is not None:
                summaries.append(summary)
    summaries.sort(key=lambda item: (item["target_kind"], item["segment"]))
    return summaries


def availability_status(
    *,
    runtime_manifest: dict[str, Any],
    trips_rows: list[dict[str, str]],
    tours_rows: list[dict[str, str]],
    persons_rows: list[dict[str, str]],
    households_rows: list[dict[str, str]],
    trip_purpose: dict[str, Any] | None,
    mode_share: dict[str, Any] | None,
) -> tuple[str, list[str]]:
    reasons: list[str] = []
    mode = runtime_manifest.get("mode")
    status = runtime_manifest.get("status")

    if mode == "preflight_only":
        reasons.append("Runtime mode is preflight_only, so this prototype does not claim behavioral KPI readiness.")
    if status == "blocked":
        reasons.append("Runtime status is blocked, so behavioral KPIs are not supportable.")
    if reasons:
        return "not_enough_behavioral_outputs", reasons

    if not any((households_rows, persons_rows, tours_rows, trips_rows)):
        reasons.append("No household/person/tour/trip tables were available for KPI extraction.")
        return "not_enough_behavioral_outputs", reasons

    if not trips_rows:
        reasons.append("Trips table is missing, so trip-purpose and mode-share KPIs are unavailable.")
        return "partial_behavioral_outputs", reasons

    if trip_purpose is None:
        reasons.append("Trip purpose column was not detected in the trips table.")
    if mode_share is None:
        reasons.append("Mode column was not detected in the trips table.")

    if status == "failed":
        reasons.append("Runtime status is failed; any derived KPIs reflect only partial outputs that happened to be present.")
        return "partial_behavioral_outputs", reasons

    if trip_purpose is not None or mode_share is not None:
        return "behavioral_kpis_available", reasons

    return "partial_behavioral_outputs", reasons


def markdown_for_summary(summary: dict[str, Any]) -> str:
    availability = summary["availability"]
    totals = summary["totals"]
    lines = [
        "# ActivitySim Behavioral KPI Prototype",
        "",
        "This packet is a lightweight prototype built only from ActivitySim outputs that were actually present.",
        "It does not claim calibration quality, policy meaning, or production-readiness.",
        "",
        f"- Runtime dir: `{summary['source']['runtime_dir']}`",
        f"- Runtime mode: `{summary['source']['runtime_mode']}`",
        f"- Runtime status: `{summary['source']['runtime_status']}`",
        f"- KPI availability: **{availability['status']}**",
        "",
        "## Available totals",
        "",
        f"- Households: **{totals['households']}**" if totals["households"] is not None else "- Households: not available",
        f"- Persons: **{totals['persons']}**" if totals["persons"] is not None else "- Persons: not available",
        f"- Tours: **{totals['tours']}**" if totals["tours"] is not None else "- Tours: not available",
        f"- Trips: **{totals['trips']}**" if totals["trips"] is not None else "- Trips: not available",
    ]

    if availability["status"] == "not_enough_behavioral_outputs":
        lines.extend(["", "## Limits", ""])
        for reason in availability["reasons"]:
            lines.append(f"- {reason}")
        for caveat in summary["caveats"]:
            lines.append(f"- {caveat}")
        return "\n".join(lines) + "\n"

    trip_purpose = summary.get("trip_volumes_by_purpose")
    lines.extend(["", "## Trip volumes by purpose", ""])
    if trip_purpose and trip_purpose["available"]:
        lines.extend(
            [
                f"- Source column: `{trip_purpose['source_column']}`",
                "",
                "| Purpose | Trips | Share |",
                "|---|---:|---:|",
            ]
        )
        for item in trip_purpose["values"]:
            share = f"{item['share'] * 100:.1f}%" if item["share"] is not None else ""
            lines.append(f"| {item['label']} | {item['count']} | {share} |")
    else:
        lines.append("- Not supportable from the discovered trips table.")

    mode_share = summary.get("mode_shares")
    lines.extend(["", "## Mode shares", ""])
    if mode_share and mode_share["available"]:
        lines.extend(
            [
                f"- Source column: `{mode_share['source_column']}`",
                "",
                "| Mode | Trips | Share |",
                "|---|---:|---:|",
            ]
        )
        for item in mode_share["values"]:
            share = f"{item['share'] * 100:.1f}%" if item["share"] is not None else ""
            lines.append(f"| {item['label']} | {item['count']} | {share} |")
    else:
        lines.append("- Not supportable from the discovered trips table.")

    lines.extend(["", "## Segment summaries", ""])
    if summary["segment_summaries"]:
        for item in summary["segment_summaries"]:
            lines.append(f"### {item['target_kind']} by {item['segment']}")
            lines.append(f"- Relationship: `{item['relationship']}`")
            lines.append("")
            lines.append("| Segment | Count | Share |")
            lines.append("|---|---:|---:|")
            for value in item["values"]:
                share = f"{value['share'] * 100:.1f}%" if value["share"] is not None else ""
                lines.append(f"| {value['label']} | {value['count']} | {share} |")
            lines.append("")
    else:
        lines.append("- No supportable segment summaries were detected.")

    lines.extend(["## Caveats", ""])
    for reason in availability["reasons"]:
        lines.append(f"- {reason}")
    for caveat in summary["caveats"]:
        lines.append(f"- {caveat}")

    return "\n".join(lines) + "\n"


def extract_activitysim_behavioral_kpis(
    *,
    runtime_dir: str | None = None,
    ingestion_summary: str | None = None,
    output_dir: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    source = resolve_kpi_source(runtime_dir=runtime_dir, ingestion_summary=ingestion_summary)
    resolved_runtime_dir: Path = source["runtime_dir"]
    manifest: dict[str, Any] = source["runtime_manifest"]

    kpi_dir = Path(output_dir).expanduser().resolve() if output_dir else resolved_runtime_dir / DEFAULT_KPI_SUBDIR
    if kpi_dir.exists():
        if not force:
            raise RuntimeError(f"KPI output directory already exists: {kpi_dir}")
        shutil.rmtree(kpi_dir)
    kpi_dir.mkdir(parents=True, exist_ok=True)

    common_tables = {
        key: (source["common_tables"].get(key) if isinstance(source["common_tables"], dict) else None)
        for key in COMMON_TABLE_NAMES
    }

    households_rows = load_table_rows(resolved_runtime_dir, common_tables.get("households"))
    persons_rows = load_table_rows(resolved_runtime_dir, common_tables.get("persons"))
    tours_rows = load_table_rows(resolved_runtime_dir, common_tables.get("tours"))
    trips_rows = load_table_rows(resolved_runtime_dir, common_tables.get("trips"))

    trip_purpose = None
    purpose_column = first_present_column(trips_rows, PURPOSE_COLUMNS)
    if trips_rows and purpose_column:
        trip_purpose = summarize_grouped_counts(trips_rows, column=purpose_column)

    mode_share = None
    mode_column = first_present_column(trips_rows, MODE_COLUMNS)
    if trips_rows and mode_column:
        mode_share = summarize_grouped_counts(trips_rows, column=mode_column)

    segment_summaries = build_segment_summaries(
        households_rows=households_rows,
        persons_rows=persons_rows,
        tours_rows=tours_rows,
        trips_rows=trips_rows,
    )

    availability, reasons = availability_status(
        runtime_manifest=manifest,
        trips_rows=trips_rows,
        tours_rows=tours_rows,
        persons_rows=persons_rows,
        households_rows=households_rows,
        trip_purpose=trip_purpose,
        mode_share=mode_share,
    )

    totals = {
        "households": len(households_rows) if households_rows else None,
        "persons": len(persons_rows) if persons_rows else None,
        "tours": len(tours_rows) if tours_rows else None,
        "trips": len(trips_rows) if trips_rows else None,
    }

    summary = {
        "schema_version": "openplan.activitysim_behavioral_kpis.v0",
        "summary_type": "activitysim_behavioral_kpi_summary",
        "created_at_utc": _utc_now(),
        "source": {
            "runtime_dir": str(resolved_runtime_dir),
            "runtime_manifest_path": str(source["runtime_manifest_path"]),
            "ingestion_summary_path": str(source["ingestion_summary_path"]) if source["ingestion_summary_path"] else None,
            "runtime_mode": manifest.get("mode"),
            "runtime_status": manifest.get("status"),
            "runtime_stage_statuses": stage_statuses(manifest),
        },
        "availability": {
            "status": availability,
            "reasons": reasons,
        },
        "coverage": {
            "totals": [key for key, value in totals.items() if value is not None],
            "trip_volumes_by_purpose": bool(trip_purpose),
            "mode_shares": bool(mode_share),
            "segment_summaries": [f"{item['target_kind']}:{item['segment']}" for item in segment_summaries],
        },
        "totals": totals,
        "trip_volumes_by_purpose": trip_purpose or {
            "available": False,
            "source_column": None,
            "total_records_summarized": 0,
            "values": [],
        },
        "mode_shares": mode_share or {
            "available": False,
            "source_column": None,
            "total_records_summarized": 0,
            "values": [],
        },
        "segment_summaries": segment_summaries,
        "caveats": list(source["caveats"]),
    }

    if availability == "not_enough_behavioral_outputs":
        summary["totals"] = {key: None for key in totals}
        summary["trip_volumes_by_purpose"] = {
            "available": False,
            "source_column": None,
            "total_records_summarized": 0,
            "values": [],
        }
        summary["mode_shares"] = {
            "available": False,
            "source_column": None,
            "total_records_summarized": 0,
            "values": [],
        }
        summary["segment_summaries"] = []
        summary["coverage"] = {
            "totals": [],
            "trip_volumes_by_purpose": False,
            "mode_shares": False,
            "segment_summaries": [],
        }

    markdown = markdown_for_summary(summary)

    summary_path = kpi_dir / KPI_SUMMARY_NAME
    packet_path = kpi_dir / KPI_PACKET_NAME
    write_json(summary_path, summary)
    write_markdown(packet_path, markdown)

    return {
        "runtime_dir": str(resolved_runtime_dir),
        "kpi_dir": str(kpi_dir),
        "summary_path": str(summary_path),
        "packet_path": str(packet_path),
        "availability_status": summary["availability"]["status"],
        "coverage": summary["coverage"],
    }


def main() -> int:
    args = parse_args()
    result = extract_activitysim_behavioral_kpis(
        runtime_dir=args.runtime_dir,
        ingestion_summary=args.ingestion_summary,
        output_dir=args.output_dir,
        force=args.force,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
