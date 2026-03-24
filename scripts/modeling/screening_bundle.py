#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from screening_boundary import boundary_area_sq_mi, boundary_feature_collection

DEFAULT_ARTIFACTS = {
    "boundary": "boundary/analysis_boundary.geojson",
    "zones": "package/zones.geojson",
    "zone_centroids": "package/zone_centroids.geojson",
    "zone_attributes": "package/zone_attributes.csv",
    "od_trip_matrix": "package/od_trip_matrix.csv",
    "demand_layers": "package/demand_layers.json",
    "demand_omx": "run_output/demand.omx",
    "skim_omx": "run_output/travel_time_skims.omx",
    "link_volumes": "run_output/link_volumes.csv",
    "loaded_links_geojson": "run_output/loaded_links.geojson",
    "top_loaded_links_geojson": "run_output/top_loaded_links.geojson",
    "evidence_packet": "run_output/evidence_packet.json",
}

DEFAULT_CAVEATS = [
    "screening-grade only",
    "OSM default speeds/capacities",
    "tract fragments are not calibrated TAZs",
    "jobs are estimated from tract-scale demographic proxies",
    "external gateways are inferred from major boundary-crossing roads",
]


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "screening-run"


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, payload: dict[str, Any]) -> Path:
    path.write_text(json.dumps(payload, indent=2))
    return path


def write_boundary_artifact(boundary_geom, boundary_dir: Path) -> Path:
    ensure_dir(boundary_dir)
    return write_json(boundary_dir / "analysis_boundary.geojson", boundary_feature_collection(boundary_geom))


def build_bundle_manifest(
    run_name: str,
    boundary_meta: dict[str, Any],
    zone_meta: dict[str, Any],
    network_meta: dict[str, Any],
    skim_meta: dict[str, Any],
    demand_meta: dict[str, Any],
    assignment_meta: dict[str, Any],
    keep_project: bool,
    artifacts: dict[str, str] | None = None,
    caveats: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "run_name": run_name,
        "screening_grade": True,
        "boundary": {
            "source": boundary_meta["source"],
            "label": boundary_meta["label"],
            "source_path": boundary_meta["source_path"],
            "bbox": [round(float(v), 6) for v in boundary_meta["geometry"].bounds],
            "area_sq_mi": round(boundary_area_sq_mi(boundary_meta["geometry"]), 3),
        },
        "zones": zone_meta,
        "network": {
            "bbox": network_meta["network_bbox"],
            "largest_component_pct": network_meta["largest_component_pct"],
            "zones_connected": network_meta["zones_connected"],
        },
        "skims": {
            "reachable_pairs": skim_meta["reachable_pairs"],
            "total_pairs": skim_meta["total_pairs"],
            "avg_time_min": skim_meta["avg_time_min"],
            "max_time_min": skim_meta["max_time_min"],
        },
        "demand": demand_meta["summary"],
        "assignment": assignment_meta,
        "artifacts": artifacts or DEFAULT_ARTIFACTS,
        "project_retained": keep_project,
        "caveats": caveats or DEFAULT_CAVEATS,
    }


def build_evidence_packet(
    run_name: str,
    zone_meta: dict[str, Any],
    assignment_meta: dict[str, Any],
    demand_meta: dict[str, Any],
    skims: dict[str, Any],
    caveats: list[str],
) -> dict[str, Any]:
    return {
        "run_name": run_name,
        "run_id": run_name,
        "engine": "AequilibraE screening runtime",
        "network_source": "OpenStreetMap",
        "zone_system": zone_meta["zone_type"],
        "assignment": assignment_meta,
        "demand": demand_meta["summary"],
        "skims": skims,
        "caveats": caveats,
    }


def write_bundle_outputs(
    run_dir: Path,
    run_name: str,
    boundary_meta: dict[str, Any],
    zone_meta: dict[str, Any],
    network_meta: dict[str, Any],
    skim_meta: dict[str, Any],
    demand_meta: dict[str, Any],
    assignment_meta: dict[str, Any],
    keep_project: bool,
) -> dict[str, Any]:
    manifest = build_bundle_manifest(
        run_name=run_name,
        boundary_meta=boundary_meta,
        zone_meta=zone_meta,
        network_meta=network_meta,
        skim_meta=skim_meta,
        demand_meta=demand_meta,
        assignment_meta=assignment_meta,
        keep_project=keep_project,
    )
    write_json(run_dir / "bundle_manifest.json", manifest)
    evidence = build_evidence_packet(
        run_name=run_name,
        zone_meta=zone_meta,
        assignment_meta=assignment_meta,
        demand_meta=demand_meta,
        skims=manifest["skims"],
        caveats=manifest["caveats"],
    )
    write_json(run_dir / "run_output" / "evidence_packet.json", evidence)
    return manifest


def build_run_summary(
    run_name: str,
    run_dir: Path,
    boundary_meta: dict[str, Any],
    zone_meta: dict[str, Any],
    demand_meta: dict[str, Any],
    assignment_meta: dict[str, Any],
    manifest: dict[str, Any],
) -> dict[str, Any]:
    return {
        "run_name": run_name,
        "output_dir": str(run_dir),
        "boundary_source": boundary_meta["source"],
        "zones": int(zone_meta["zones"]),
        "total_trips": float(demand_meta["summary"]["total_trips"]),
        "loaded_links": int(assignment_meta["loaded_links"]),
        "manifest": manifest,
    }
