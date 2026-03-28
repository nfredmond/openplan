#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PIPELINE_MANIFEST_NAME = "behavioral_demand_prototype_manifest.json"
RUNTIME_MANIFEST_NAME = "runtime_manifest.json"
RUNTIME_SUMMARY_NAME = "runtime_summary.json"
INGESTION_SUMMARY_NAME = "activitysim_output_ingestion_summary.json"
KPI_SUMMARY_NAME = "activitysim_behavioral_kpi_summary.json"
KPI_PACKET_NAME = "activitysim_behavioral_kpi_packet.md"
OUTPUT_SUBDIR_NAME = "evidence_packet"
JSON_PACKET_NAME = "behavioral_demand_evidence_packet.json"
MARKDOWN_PACKET_NAME = "behavioral_demand_evidence_packet.md"


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Assemble an internal OpenPlan behavioral-demand evidence/validation packet."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument(
        "--behavioral-manifest",
        help="Path to behavioral_demand_prototype_manifest.json",
    )
    source_group.add_argument(
        "--county-onramp-manifest",
        help="Path to an OpenPlan county onramp manifest JSON",
    )
    source_group.add_argument(
        "--runtime-dir",
        help="Path to an ActivitySim behavioral runtime directory",
    )
    parser.add_argument(
        "--output-dir",
        help="Directory where packet artifacts should be written (default: <behavioral-root>/evidence_packet)",
    )
    parser.add_argument("--force", action="store_true", help="Replace an existing output directory")
    return parser.parse_args()


def read_json(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def write_markdown(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


def dedupe_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        result.append(normalized)
        seen.add(normalized)
    return result


def get_nested(mapping: dict[str, Any] | None, *keys: str) -> Any:
    current: Any = mapping
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def normalize_path(path_value: str | None) -> Path | None:
    if not isinstance(path_value, str) or not path_value.strip():
        return None
    return Path(path_value).expanduser().resolve()


def bool_from_any(value: Any) -> bool | None:
    if value is None:
        return None
    return bool(value)


def resolve_sources(
    *,
    behavioral_manifest: str | None = None,
    county_onramp_manifest: str | None = None,
    runtime_dir: str | None = None,
) -> dict[str, Any]:
    if behavioral_manifest:
        behavioral_manifest_path = Path(behavioral_manifest).expanduser().resolve()
        if behavioral_manifest_path.name != PIPELINE_MANIFEST_NAME:
            raise RuntimeError(
                f"Expected behavioral manifest named {PIPELINE_MANIFEST_NAME}, got {behavioral_manifest_path.name}"
            )
        behavioral_root = behavioral_manifest_path.parent
        return {
            "source_type": "behavioral_manifest",
            "input_path": behavioral_manifest_path,
            "behavioral_manifest_path": behavioral_manifest_path,
            "behavioral_root": behavioral_root,
            "county_onramp_manifest_path": None,
            "runtime_dir": normalize_path(str(behavioral_root / "runtime")),
        }

    if county_onramp_manifest:
        county_manifest_path = Path(county_onramp_manifest).expanduser().resolve()
        county_manifest = read_json(county_manifest_path) or {}
        behavioral_manifest_path = normalize_path(
            get_nested(county_manifest, "artifacts", "behavioral_prototype_manifest_json")
        )
        behavioral_root = behavioral_manifest_path.parent if behavioral_manifest_path else None
        runtime_dir_path = normalize_path(get_nested(county_manifest, "summary", "behavioral_prototype", "output_root"))
        if runtime_dir_path is not None:
            runtime_dir_path = runtime_dir_path / "runtime"
        runtime_manifest_hint = normalize_path(get_nested(county_manifest, "artifacts", "behavioral_runtime_manifest_json"))
        if runtime_dir_path is None and runtime_manifest_hint is not None:
            runtime_dir_path = runtime_manifest_hint.parent
        if behavioral_root is None and runtime_dir_path is not None:
            behavioral_root = runtime_dir_path.parent
            behavioral_manifest_path = behavioral_root / PIPELINE_MANIFEST_NAME
        return {
            "source_type": "county_onramp_manifest",
            "input_path": county_manifest_path,
            "behavioral_manifest_path": behavioral_manifest_path,
            "behavioral_root": behavioral_root,
            "county_onramp_manifest_path": county_manifest_path,
            "runtime_dir": runtime_dir_path,
        }

    if not runtime_dir:
        raise RuntimeError("One of behavioral_manifest, county_onramp_manifest, or runtime_dir is required")

    resolved_runtime_dir = Path(runtime_dir).expanduser().resolve()
    if not resolved_runtime_dir.exists():
        raise RuntimeError(f"Runtime directory does not exist: {resolved_runtime_dir}")
    behavioral_root = resolved_runtime_dir.parent
    behavioral_manifest_path = behavioral_root / PIPELINE_MANIFEST_NAME
    return {
        "source_type": "runtime_dir",
        "input_path": resolved_runtime_dir,
        "behavioral_manifest_path": behavioral_manifest_path if behavioral_manifest_path.exists() else None,
        "behavioral_root": behavioral_root,
        "county_onramp_manifest_path": None,
        "runtime_dir": resolved_runtime_dir,
    }


def resolve_output_dir(output_dir: str | None, behavioral_root: Path | None, input_path: Path) -> Path:
    if output_dir:
        return Path(output_dir).expanduser().resolve()
    if behavioral_root is not None:
        return behavioral_root / OUTPUT_SUBDIR_NAME
    if input_path.is_dir():
        return input_path / OUTPUT_SUBDIR_NAME
    return input_path.parent / OUTPUT_SUBDIR_NAME


def summarize_screening_run(
    screening_run_dir: Path | None,
    source_bundle_manifest: dict[str, Any] | None,
    run_summary: dict[str, Any] | None,
    county_manifest: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "run_dir": str(screening_run_dir) if screening_run_dir else None,
        "run_name": get_nested(source_bundle_manifest, "source_screening_run", "run_name")
        or get_nested(source_bundle_manifest, "run_name")
        or get_nested(county_manifest, "name"),
        "screening_grade": bool_from_any(
            get_nested(source_bundle_manifest, "source_screening_run", "screening_grade")
            if source_bundle_manifest and source_bundle_manifest.get("bundle_type") == "activitysim_input_bundle"
            else get_nested(source_bundle_manifest, "screening_grade")
        ),
        "validation_status_label": get_nested(county_manifest, "summary", "validation", "screening_gate", "status_label")
        or get_nested(run_summary, "validation", "status_label")
        or get_nested(source_bundle_manifest, "validation", "status_label"),
        "zone_count": get_nested(run_summary, "zones", "count")
        or get_nested(run_summary, "zone_count")
        or get_nested(source_bundle_manifest, "land_use", "rows")
        or get_nested(source_bundle_manifest, "zones", "zones"),
        "population_total": get_nested(run_summary, "zones", "population_total")
        or get_nested(run_summary, "population_total")
        or get_nested(source_bundle_manifest, "land_use", "total_population"),
        "jobs_total": get_nested(run_summary, "zones", "jobs_total")
        or get_nested(run_summary, "jobs_total")
        or get_nested(source_bundle_manifest, "land_use", "total_employment"),
        "total_trips": get_nested(run_summary, "demand", "total_trips")
        or get_nested(run_summary, "total_trips")
        or get_nested(source_bundle_manifest, "source_bundle_excerpt", "demand", "total_trips")
        or get_nested(source_bundle_manifest, "demand", "total_trips"),
        "assignment_loaded_links": get_nested(run_summary, "assignment", "loaded_links")
        or get_nested(run_summary, "loaded_links"),
        "assignment_final_gap": get_nested(run_summary, "assignment", "convergence", "final_gap")
        or get_nested(run_summary, "final_gap"),
    }


def summarize_bundle(bundle_manifest: dict[str, Any] | None, behavioral_manifest: dict[str, Any] | None) -> dict[str, Any]:
    step = get_nested(behavioral_manifest, "steps", "build_activitysim_input_bundle") or {}
    metadata = step.get("metadata") if isinstance(step, dict) else {}
    source_screening = get_nested(bundle_manifest, "source_screening_run") or {}
    skim_artifact = get_nested(bundle_manifest, "skims", "artifact") or {}
    return {
        "status": step.get("status") or ("available" if bundle_manifest else "missing"),
        "manifest_path": get_nested(behavioral_manifest, "artifacts", "bundle_manifest_path"),
        "bundle_type": get_nested(bundle_manifest, "bundle_type"),
        "schema_version": get_nested(bundle_manifest, "schema_version"),
        "land_use_rows": metadata.get("land_use_rows") or get_nested(bundle_manifest, "land_use", "rows"),
        "households": metadata.get("households") or get_nested(bundle_manifest, "synthetic_population", "households"),
        "persons": metadata.get("persons") or get_nested(bundle_manifest, "synthetic_population", "persons"),
        "synthetic_population_status": get_nested(bundle_manifest, "synthetic_population", "status"),
        "synthetic_population_calibration_status": get_nested(bundle_manifest, "synthetic_population", "calibration_status"),
        "skim_mode": metadata.get("skim_mode") or skim_artifact.get("mode"),
        "screening_run_name": source_screening.get("run_name"),
        "screening_run_dir": source_screening.get("run_dir"),
    }


def summarize_runtime(runtime_manifest: dict[str, Any] | None, runtime_summary: dict[str, Any] | None) -> dict[str, Any]:
    stages = list(runtime_manifest.get("stages", [])) if runtime_manifest else []
    artifacts = runtime_manifest.get("artifacts", {}) if runtime_manifest else {}
    return {
        "runtime_dir": get_nested(runtime_summary, "runtime_dir") or get_nested(runtime_manifest, "runtime_dir"),
        "manifest_path": get_nested(runtime_summary, "runtime_manifest_path"),
        "summary_path": get_nested(runtime_summary, "runtime_summary_path"),
        "mode": get_nested(runtime_summary, "mode") or get_nested(runtime_manifest, "mode"),
        "status": get_nested(runtime_summary, "status") or get_nested(runtime_manifest, "status"),
        "stage_statuses": get_nested(runtime_summary, "stage_statuses")
        or {str(item.get("stage_key")): str(item.get("status")) for item in stages if item.get("stage_key")},
        "stages": [
            {
                "stage_key": item.get("stage_key"),
                "status": item.get("status"),
                "notes": list(item.get("notes", [])) if isinstance(item.get("notes"), list) else [],
                "errors": list(item.get("errors", [])) if isinstance(item.get("errors"), list) else [],
            }
            for item in stages
        ],
        "collected_output_count": len(artifacts.get("collected_outputs", [])) if isinstance(artifacts.get("collected_outputs"), list) else None,
        "errors": list(runtime_manifest.get("errors", [])) if runtime_manifest else [],
        "caveats": list(runtime_manifest.get("caveats", [])) if runtime_manifest else [],
    }


def summarize_ingestion(ingestion_summary: dict[str, Any] | None, summary_path: Path | None) -> dict[str, Any]:
    common_tables = ingestion_summary.get("common_tables", {}) if ingestion_summary else {}
    output_inventory = ingestion_summary.get("output_inventory", []) if ingestion_summary else []
    output_tables = ingestion_summary.get("output_tables", []) if ingestion_summary else []
    return {
        "summary_path": str(summary_path) if summary_path else None,
        "schema_version": get_nested(ingestion_summary, "schema_version"),
        "runtime_mode": get_nested(ingestion_summary, "runtime", "mode"),
        "runtime_status": get_nested(ingestion_summary, "runtime", "status"),
        "output_file_count": len(output_inventory),
        "output_table_count": len(output_tables),
        "common_tables": {
            key: {
                "present": bool(value),
                "row_count": get_nested(value, "row_count"),
                "relative_path": get_nested(value, "relative_path"),
            }
            for key, value in common_tables.items()
        },
        "caveats": list(ingestion_summary.get("caveats", [])) if ingestion_summary else [],
    }


def summarize_kpis(kpi_summary: dict[str, Any] | None, summary_path: Path | None, packet_path: Path | None) -> dict[str, Any]:
    return {
        "summary_path": str(summary_path) if summary_path else None,
        "packet_path": str(packet_path) if packet_path else None,
        "schema_version": get_nested(kpi_summary, "schema_version"),
        "availability_status": get_nested(kpi_summary, "availability", "status"),
        "availability_reasons": list(get_nested(kpi_summary, "availability", "reasons") or []),
        "coverage": dict(kpi_summary.get("coverage", {})) if kpi_summary else {},
        "totals": dict(kpi_summary.get("totals", {})) if kpi_summary else {},
        "trip_volumes_by_purpose": dict(kpi_summary.get("trip_volumes_by_purpose", {})) if kpi_summary else {},
        "mode_shares": dict(kpi_summary.get("mode_shares", {})) if kpi_summary else {},
        "segment_summary_count": len(kpi_summary.get("segment_summaries", [])) if kpi_summary else 0,
        "caveats": list(kpi_summary.get("caveats", [])) if kpi_summary else [],
    }


def artifact_entry(
    *,
    artifact_key: str,
    artifact_type: str,
    path: Path | None,
    source_component: str,
) -> dict[str, Any]:
    return {
        "artifact_key": artifact_key,
        "artifact_type": artifact_type,
        "path": str(path) if path else None,
        "exists": bool(path and path.exists()),
        "source_component": source_component,
    }


def build_artifact_inventory(paths: dict[str, Path | None]) -> list[dict[str, Any]]:
    return [
        artifact_entry(
            artifact_key="county_onramp_manifest",
            artifact_type="county_onramp_manifest",
            path=paths.get("county_onramp_manifest_path"),
            source_component="county_onramp",
        ),
        artifact_entry(
            artifact_key="behavioral_manifest",
            artifact_type="behavioral_demand_prototype_manifest",
            path=paths.get("behavioral_manifest_path"),
            source_component="behavioral_orchestrator",
        ),
        artifact_entry(
            artifact_key="screening_run_summary",
            artifact_type="screening_run_summary",
            path=paths.get("screening_run_summary_path"),
            source_component="screening_run",
        ),
        artifact_entry(
            artifact_key="screening_bundle_manifest",
            artifact_type="screening_bundle_manifest",
            path=paths.get("screening_bundle_manifest_path"),
            source_component="screening_run",
        ),
        artifact_entry(
            artifact_key="activitysim_bundle_manifest",
            artifact_type="activitysim_input_bundle_manifest",
            path=paths.get("bundle_manifest_path"),
            source_component="activitysim_bundle_builder",
        ),
        artifact_entry(
            artifact_key="runtime_manifest",
            artifact_type="activitysim_runtime_manifest",
            path=paths.get("runtime_manifest_path"),
            source_component="activitysim_runtime",
        ),
        artifact_entry(
            artifact_key="runtime_summary",
            artifact_type="activitysim_runtime_summary",
            path=paths.get("runtime_summary_path"),
            source_component="activitysim_runtime",
        ),
        artifact_entry(
            artifact_key="ingestion_summary",
            artifact_type="activitysim_output_ingestion_summary",
            path=paths.get("ingestion_summary_path"),
            source_component="activitysim_output_ingestion",
        ),
        artifact_entry(
            artifact_key="kpi_summary",
            artifact_type="activitysim_behavioral_kpi_summary",
            path=paths.get("kpi_summary_path"),
            source_component="behavioral_kpi_extraction",
        ),
        artifact_entry(
            artifact_key="kpi_packet",
            artifact_type="activitysim_behavioral_kpi_packet",
            path=paths.get("kpi_packet_path"),
            source_component="behavioral_kpi_extraction",
        ),
    ]


def coverage_statement(runtime_status: str | None, runtime_mode: str | None, kpi_status: str | None) -> str:
    if runtime_mode == "preflight_only" or runtime_status == "blocked":
        return "This packet proves a chained prototype run to preflight depth only; it does not prove a successful behavioral-demand execution."
    if runtime_status == "failed":
        return "This packet proves a partial behavioral prototype attempt with partial outputs only; it does not prove complete runtime success."
    if runtime_status == "succeeded" and kpi_status == "behavioral_kpis_available":
        return "This packet proves that the prototype chain produced auditable runtime, ingestion, and lightweight behavioral KPI artifacts."
    if runtime_status == "succeeded":
        return "This packet proves that the prototype runtime completed, but downstream behavioral evidence remains limited to the artifacts actually discovered."
    return "This packet proves only the artifacts explicitly inventoried below."


def build_caveats(
    *,
    behavioral_manifest: dict[str, Any] | None,
    bundle_manifest: dict[str, Any] | None,
    runtime_manifest: dict[str, Any] | None,
    ingestion_summary: dict[str, Any] | None,
    kpi_summary: dict[str, Any] | None,
    artifact_inventory: list[dict[str, Any]],
) -> list[str]:
    caveats: list[str] = []
    caveats.extend(str(item) for item in (behavioral_manifest or {}).get("caveats", []) if isinstance(item, str))
    caveats.extend(str(item) for item in (bundle_manifest or {}).get("caveats", []) if isinstance(item, str))
    caveats.extend(str(item) for item in (runtime_manifest or {}).get("caveats", []) if isinstance(item, str))
    caveats.extend(str(item) for item in (ingestion_summary or {}).get("caveats", []) if isinstance(item, str))
    caveats.extend(str(item) for item in (kpi_summary or {}).get("caveats", []) if isinstance(item, str))

    caveats.extend(
        [
            "Internal proof artifact only; this packet is client-safe in tone but not a client-ready modeling claim.",
            "Behavioral-demand lane remains prototype-only, uncalibrated, and not validated for outward forecasting claims.",
            "Any KPI summaries in this packet describe discovered prototype outputs only and do not establish calibration quality, behavioral realism, or scenario meaning.",
        ]
    )

    runtime_mode = get_nested(runtime_manifest, "mode")
    runtime_status = get_nested(runtime_manifest, "status")
    if runtime_mode == "preflight_only" or runtime_status == "blocked":
        caveats.append("Runtime only reached preflight depth or was blocked; this packet must not be read as successful behavioral-demand execution.")
    if runtime_status == "failed":
        caveats.append("Runtime ended in failed status; any discovered outputs are partial artifacts only.")

    availability_status = get_nested(kpi_summary, "availability", "status")
    if availability_status == "not_enough_behavioral_outputs":
        caveats.append("Behavioral KPI extraction was not supportable from the discovered outputs; the packet reports absence rather than inventing zero values.")
    if availability_status == "partial_behavioral_outputs":
        caveats.append("Behavioral KPI extraction reflects partial-output coverage only.")

    missing = [item["artifact_key"] for item in artifact_inventory if not item["exists"]]
    if missing:
        caveats.append(f"Some expected prototype-chain artifacts were missing when the packet was built: {', '.join(missing)}.")

    return dedupe_strings(caveats)


def validation_posture(runtime_status: str | None, runtime_mode: str | None, kpi_status: str | None) -> dict[str, Any]:
    return {
        "internal_status_label": "internal prototype only",
        "outward_status_label": "not ready for outward modeling claims",
        "coverage_statement": coverage_statement(runtime_status, runtime_mode, kpi_status),
        "packet_proves": [
            "One auditable internal prototype artifact chain exists from screening inputs through the currently available behavioral-demand lane outputs.",
            "OpenPlan can assemble bundle, runtime, ingestion, and KPI metadata into one traceable packet without inflating the claim beyond the artifacts that actually exist.",
            "The packet preserves honest distinctions between preflight-only, partial-output, failed, and runtime-succeeded cases.",
        ],
        "packet_does_not_prove": [
            "calibration quality",
            "behavioral realism",
            "forecast readiness",
            "county-transferable validation",
            "client-ready scenario claims",
            "full production ActivitySim coverage",
        ],
    }


def markdown_for_packet(packet: dict[str, Any]) -> str:
    source_screening = packet["source_screening_run"]
    chain = packet["prototype_chain"]
    posture = packet["validation_posture"]
    lines = [
        "# OpenPlan Behavioral-Demand Evidence Packet",
        "",
        "## Summary",
        "",
        f"- Generated at: `{packet['generated_at_utc']}`",
        f"- Source type: `{packet['source']['source_type']}`",
        f"- Screening run: `{source_screening.get('run_name') or 'unknown'}`",
        f"- Runtime mode: `{chain['runtime']['mode'] or 'unknown'}`",
        f"- Runtime status: `{chain['runtime']['status'] or 'unknown'}`",
        f"- KPI availability: `{chain['behavioral_kpis']['availability_status'] or 'unknown'}`",
        f"- Internal status label: `{posture['internal_status_label']}`",
        f"- Outward status label: `{posture['outward_status_label']}`",
        "",
        "## What This Packet Proves",
        "",
        f"- {posture['coverage_statement']}",
    ]
    for item in posture["packet_proves"]:
        lines.append(f"- {item}")

    lines.extend(
        [
            "",
            "## Prototype Chain",
            "",
            "### Screening source",
            "",
            f"- Run directory: `{source_screening.get('run_dir') or 'unknown'}`",
            f"- Validation status: `{source_screening.get('validation_status_label') or 'unknown'}`",
            f"- Zones: `{source_screening.get('zone_count')}`",
            f"- Population: `{source_screening.get('population_total')}`",
            f"- Jobs: `{source_screening.get('jobs_total')}`",
            f"- Total trips: `{source_screening.get('total_trips')}`",
            "",
            "### ActivitySim bundle",
            "",
            f"- Status: `{chain['activitysim_bundle']['status']}`",
            f"- Land-use rows: `{chain['activitysim_bundle']['land_use_rows']}`",
            f"- Households: `{chain['activitysim_bundle']['households']}`",
            f"- Persons: `{chain['activitysim_bundle']['persons']}`",
            f"- Synthetic population status: `{chain['activitysim_bundle']['synthetic_population_status']}`",
            f"- Calibration status: `{chain['activitysim_bundle']['synthetic_population_calibration_status']}`",
            "",
            "### Runtime",
            "",
            f"- Mode: `{chain['runtime']['mode']}`",
            f"- Status: `{chain['runtime']['status']}`",
            f"- Collected output count: `{chain['runtime']['collected_output_count']}`",
        ]
    )
    for stage in chain["runtime"]["stages"]:
        lines.append(f"- Stage `{stage['stage_key']}`: `{stage['status']}`")

    lines.extend(
        [
            "",
            "### Ingestion",
            "",
            f"- Output files discovered: `{chain['ingestion']['output_file_count']}`",
            f"- Output tables discovered: `{chain['ingestion']['output_table_count']}`",
        ]
    )
    for key, value in chain["ingestion"]["common_tables"].items():
        lines.append(f"- Common table `{key}` present: `{value['present']}`")

    lines.extend(
        [
            "",
            "### Behavioral KPIs",
            "",
            f"- Availability status: `{chain['behavioral_kpis']['availability_status']}`",
            f"- Totals: `{json.dumps(chain['behavioral_kpis']['totals'], sort_keys=True)}`",
            f"- Coverage: `{json.dumps(chain['behavioral_kpis']['coverage'], sort_keys=True)}`",
            "",
            "## Artifact Inventory",
            "",
        ]
    )
    for item in packet["artifact_inventory"]:
        lines.append(
            f"- `{item['artifact_key']}` ({item['artifact_type']}): "
            f"`{item['path'] or 'missing'}` | exists=`{item['exists']}`"
        )

    lines.extend(["", "## Caveats", ""])
    for caveat in packet["caveats"]:
        lines.append(f"- {caveat}")

    lines.extend(["", "## What This Packet Does Not Prove", ""])
    for item in posture["packet_does_not_prove"]:
        lines.append(f"- {item}")

    return "\n".join(lines) + "\n"


def build_behavioral_demand_evidence_packet(
    *,
    behavioral_manifest: str | None = None,
    county_onramp_manifest: str | None = None,
    runtime_dir: str | None = None,
    output_dir: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    resolved = resolve_sources(
        behavioral_manifest=behavioral_manifest,
        county_onramp_manifest=county_onramp_manifest,
        runtime_dir=runtime_dir,
    )
    behavioral_root: Path | None = resolved["behavioral_root"]
    input_path: Path = resolved["input_path"]
    output_path = resolve_output_dir(output_dir, behavioral_root, input_path)
    if output_path.exists():
        if not force:
            raise RuntimeError(f"Evidence packet output directory already exists: {output_path}")
        shutil.rmtree(output_path)
    output_path.mkdir(parents=True, exist_ok=True)

    county_manifest_path = resolved["county_onramp_manifest_path"]
    behavioral_manifest_path = resolved["behavioral_manifest_path"]
    county_manifest = read_json(county_manifest_path)
    behavioral_manifest_data = read_json(behavioral_manifest_path)

    runtime_dir_path = resolved["runtime_dir"]
    runtime_manifest_path = None
    runtime_summary_path = None
    if isinstance(runtime_dir_path, Path):
        runtime_manifest_path = runtime_dir_path / RUNTIME_MANIFEST_NAME
        runtime_summary_path = runtime_dir_path / RUNTIME_SUMMARY_NAME
    elif behavioral_root is not None:
        runtime_dir_path = behavioral_root / "runtime"
        runtime_manifest_path = runtime_dir_path / RUNTIME_MANIFEST_NAME
        runtime_summary_path = runtime_dir_path / RUNTIME_SUMMARY_NAME

    artifacts = get_nested(behavioral_manifest_data, "artifacts") or {}
    bundle_manifest_path = normalize_path(artifacts.get("bundle_manifest_path"))
    if bundle_manifest_path is None and runtime_manifest_path is not None:
        runtime_manifest_preview = read_json(runtime_manifest_path)
        bundle_manifest_path = normalize_path(get_nested(runtime_manifest_preview, "bundle", "manifest_path"))
    ingestion_summary_path = normalize_path(artifacts.get("ingestion_summary_path"))
    if ingestion_summary_path is None and behavioral_root is not None:
        candidate = behavioral_root / "ingestion" / INGESTION_SUMMARY_NAME
        ingestion_summary_path = candidate if candidate.exists() else None
    kpi_summary_path = normalize_path(artifacts.get("kpi_summary_path"))
    if kpi_summary_path is None and behavioral_root is not None:
        candidate = behavioral_root / "kpis" / KPI_SUMMARY_NAME
        kpi_summary_path = candidate if candidate.exists() else None
    kpi_packet_path = normalize_path(artifacts.get("kpi_packet_path"))
    if kpi_packet_path is None and behavioral_root is not None:
        candidate = behavioral_root / "kpis" / KPI_PACKET_NAME
        kpi_packet_path = candidate if candidate.exists() else None

    runtime_manifest = read_json(runtime_manifest_path)
    runtime_summary = read_json(runtime_summary_path)
    bundle_manifest = read_json(bundle_manifest_path)
    ingestion_summary = read_json(ingestion_summary_path)
    kpi_summary_data = read_json(kpi_summary_path)

    screening_run_dir = normalize_path(get_nested(behavioral_manifest_data, "source", "screening_run_dir"))
    if screening_run_dir is None:
        screening_run_dir = normalize_path(get_nested(bundle_manifest, "source_screening_run", "run_dir"))
    if screening_run_dir is None:
        screening_run_dir = normalize_path(get_nested(county_manifest, "run_dir"))
    screening_run_summary_path = screening_run_dir / "run_summary.json" if screening_run_dir else None
    screening_bundle_manifest_path = screening_run_dir / "bundle_manifest.json" if screening_run_dir else None
    screening_run_summary = read_json(screening_run_summary_path)
    screening_bundle_manifest = read_json(screening_bundle_manifest_path)

    source_screening = summarize_screening_run(
        screening_run_dir=screening_run_dir,
        source_bundle_manifest=screening_bundle_manifest if screening_bundle_manifest else bundle_manifest,
        run_summary=screening_run_summary,
        county_manifest=county_manifest,
    )
    bundle_summary = summarize_bundle(bundle_manifest, behavioral_manifest_data)
    runtime_summary_block = summarize_runtime(runtime_manifest, runtime_summary)
    ingestion_summary_block = summarize_ingestion(ingestion_summary, ingestion_summary_path)
    kpi_summary_block = summarize_kpis(kpi_summary_data, kpi_summary_path, kpi_packet_path)

    paths = {
        "county_onramp_manifest_path": county_manifest_path,
        "behavioral_manifest_path": behavioral_manifest_path,
        "screening_run_summary_path": screening_run_summary_path,
        "screening_bundle_manifest_path": screening_bundle_manifest_path,
        "bundle_manifest_path": bundle_manifest_path,
        "runtime_manifest_path": runtime_manifest_path,
        "runtime_summary_path": runtime_summary_path,
        "ingestion_summary_path": ingestion_summary_path,
        "kpi_summary_path": kpi_summary_path,
        "kpi_packet_path": kpi_packet_path,
    }
    artifact_inventory = build_artifact_inventory(paths)
    posture = validation_posture(
        runtime_status=runtime_summary_block["status"],
        runtime_mode=runtime_summary_block["mode"],
        kpi_status=kpi_summary_block["availability_status"],
    )
    caveats = build_caveats(
        behavioral_manifest=behavioral_manifest_data,
        bundle_manifest=bundle_manifest,
        runtime_manifest=runtime_manifest,
        ingestion_summary=ingestion_summary,
        kpi_summary=kpi_summary_data,
        artifact_inventory=artifact_inventory,
    )

    packet = {
        "schema_version": "openplan.behavioral_demand_evidence_packet.v0",
        "packet_type": "behavioral_demand_evidence_packet",
        "generated_at_utc": _utc_now(),
        "source": {
            "source_type": resolved["source_type"],
            "input_path": str(input_path),
            "county_onramp_manifest_path": str(county_manifest_path) if county_manifest_path else None,
            "behavioral_manifest_path": str(behavioral_manifest_path) if behavioral_manifest_path else None,
            "runtime_dir": str(runtime_dir_path) if runtime_dir_path else None,
        },
        "source_screening_run": source_screening,
        "prototype_chain": {
            "activitysim_bundle": bundle_summary,
            "runtime": runtime_summary_block,
            "ingestion": ingestion_summary_block,
            "behavioral_kpis": kpi_summary_block,
        },
        "artifact_inventory": artifact_inventory,
        "validation_posture": posture,
        "caveats": caveats,
        "metadata": {
            "output_dir": str(output_path),
            "json_packet_path": str(output_path / JSON_PACKET_NAME),
            "markdown_packet_path": str(output_path / MARKDOWN_PACKET_NAME),
            "included_artifact_count": len([item for item in artifact_inventory if item["exists"]]),
            "missing_artifact_count": len([item for item in artifact_inventory if not item["exists"]]),
        },
    }

    markdown = markdown_for_packet(packet)
    write_json(output_path / JSON_PACKET_NAME, packet)
    write_markdown(output_path / MARKDOWN_PACKET_NAME, markdown)

    return {
        "output_dir": str(output_path),
        "json_packet_path": str(output_path / JSON_PACKET_NAME),
        "markdown_packet_path": str(output_path / MARKDOWN_PACKET_NAME),
        "source_type": resolved["source_type"],
        "runtime_mode": runtime_summary_block["mode"],
        "runtime_status": runtime_summary_block["status"],
        "kpi_availability_status": kpi_summary_block["availability_status"],
        "caveats": caveats,
    }


def main() -> int:
    args = parse_args()
    result = build_behavioral_demand_evidence_packet(
        behavioral_manifest=args.behavioral_manifest,
        county_onramp_manifest=args.county_onramp_manifest,
        runtime_dir=args.runtime_dir,
        output_dir=args.output_dir,
        force=args.force,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
