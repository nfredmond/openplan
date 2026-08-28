#!/usr/bin/env python3
"""Freeze development observation packages and pre-volume match audits."""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
WORKER_DIR = ROOT / "workers" / "aequilibrae_worker"
for directory in (SCRIPT_DIR, WORKER_DIR):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import count_sources
import development_validation_sources as sources
import validation_instrument as instrument
from lodes import STATE_FIPS_TO_ABBR
from screening_boundary import intersecting_state_fips, load_geojson_geometry


DEFAULT_OUTPUT = "data/modeling/development-validation-study-2026-08-28"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Freeze development observation packages without opening model output.")
    parser.add_argument("--registry", required=True)
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--output-root", default=DEFAULT_OUTPUT)
    parser.add_argument("--geography-id", action="append", default=[])
    parser.add_argument("--created-at")
    return parser.parse_args()


def _copy_exact(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and instrument.sha256_file(target) == instrument.sha256_file(source):
        return
    shutil.copyfile(source, target)


def _county_source_path(seed_run: Path) -> Path:
    path = seed_run / "work" / "aeq_project" / "project_database.sqlite"
    if not path.is_file():
        raise instrument.InstrumentError(f"Network seed has no retained project database: {path}")
    return path


def _boundary_path(seed_run: Path) -> Path:
    path = seed_run / "boundary" / "analysis_boundary.geojson"
    if not path.is_file():
        raise instrument.InstrumentError(f"Network seed has no exact resolved polygon: {path}")
    return path


def _subdivisions(boundary_path: Path, cache_dir: Path) -> tuple[list[dict[str, str]], set[str], set[str]]:
    geometry = load_geojson_geometry(boundary_path)
    state_fips = set(intersecting_state_fips(geometry, cache_dir))
    subdivisions = []
    unresolved = []
    for fips in sorted(state_fips):
        abbreviation = STATE_FIPS_TO_ABBR.get(fips)
        if abbreviation:
            subdivisions.append({"country": "US", "subdivision": abbreviation.upper()})
        else:
            unresolved.append(fips)
    if unresolved:
        raise instrument.InstrumentError(f"Intersected subdivisions have no registered code: {unresolved}")
    return subdivisions, state_fips, {item["subdivision"] for item in subdivisions}


def _clip_to_resolved_polygon(
    observations: list[dict[str, Any]],
    boundary_geometry: Any,
) -> list[dict[str, Any]]:
    from shapely.geometry import Point

    clipped = []
    for observation in observations:
        source_geometry = observation.get("geometry") or {}
        coordinates = source_geometry.get("coordinates") if isinstance(source_geometry, dict) else None
        if isinstance(coordinates, list) and len(coordinates) >= 2 and all(
            isinstance(value, (int, float)) for value in coordinates[:2]
        ):
            if boundary_geometry.covers(Point(float(coordinates[0]), float(coordinates[1]))):
                clipped.append(observation)
            continue
        source_geography = (observation.get("route_lrs") or {}).get("source_geography")
        if isinstance(source_geography, dict):
            clipped.append(observation)
    return clipped


def _record_polygon_clip(attempt: dict[str, Any], observations: list[dict[str, Any]]) -> None:
    attempt["record_count"] = len(observations)
    if attempt["status"] == "available" and not observations:
        attempt["status"] = "supported_but_empty"
        attempt["reason"] += " Exact-polygon clipping retained zero records."
    elif attempt["status"] == "available":
        attempt["reason"] += f" Exact-polygon clipping retained {len(observations)} record(s)."


def prepare_one(
    repo_root: Path,
    output_root: Path,
    registry_path: Path,
    county: dict[str, Any],
    *,
    created_at: str,
) -> dict[str, Any]:
    geography_id = str(county["geography_id"])
    seed_run = repo_root / county["network_seed_run"]
    instrument_dir = output_root / "instruments" / geography_id
    network_path = instrument_dir / "network" / "project_database.sqlite"
    boundary_path = _boundary_path(seed_run)
    _copy_exact(_county_source_path(seed_run), network_path)
    subdivisions, state_fips, regions = _subdivisions(boundary_path, repo_root / "data" / "_screening_cache")
    boundary_geometry = load_geojson_geometry(boundary_path)
    boundary_payload = json.loads(boundary_path.read_text())
    geometry = instrument._geometry_from_boundary(boundary_payload)
    bbox = sources.geometry_bbox(geometry)
    source_attempts: list[dict[str, Any]] = []
    observations: list[dict[str, Any]] = []

    tmas_attempt, tmas_observations = sources.fetch_tmas_source(
        instrument_dir,
        output_root / "shared-sources" / "tmas-2024",
        state_codes=state_fips,
        county_codes={geography_id[2:]} if len(geography_id) == 5 and geography_id[:2] in state_fips else set(),
        attempted_at=created_at,
    )
    tmas_observations = _clip_to_resolved_polygon(tmas_observations, boundary_geometry)
    _record_polygon_clip(tmas_attempt, tmas_observations)
    source_attempts.append(tmas_attempt)
    observations.extend(tmas_observations)

    for source_id, _descriptor in count_sources.observed_count_sources_for_regions(sorted(regions)):
        if source_id in {count_sources.TMAS_SOURCE_ID, count_sources.HPMS_SOURCE_ID}:
            continue
        attempt, source_observations = sources.fetch_state_source(
            source_id, bbox, instrument_dir, attempted_at=created_at
        )
        source_observations = _clip_to_resolved_polygon(source_observations, boundary_geometry)
        _record_polygon_clip(attempt, source_observations)
        source_attempts.append(attempt)
        observations.extend(source_observations)

    hpms_attempt, hpms_observations = sources.fetch_hpms_source(
        bbox, instrument_dir, attempted_at=created_at
    )
    hpms_observations = _clip_to_resolved_polygon(hpms_observations, boundary_geometry)
    _record_polygon_clip(hpms_attempt, hpms_observations)
    source_attempts.append(hpms_attempt)
    observations.extend(hpms_observations)

    package = instrument.build_observation_package(
        instrument_dir,
        geography_id=geography_id,
        boundary_path=boundary_path,
        subdivisions=subdivisions,
        source_attempts=source_attempts,
        observations=observations,
        created_at=created_at,
    )
    package_path = instrument_dir / "observation-package.json"
    audit_path = instrument_dir / "pre-volume-match-audit.json"
    audit = instrument.build_pre_volume_match_audit(
        network_path, package_path, registry_path, audit_path, created_at=created_at
    )
    return {
        "geography_id": geography_id,
        "ready": True,
        "network_path": str(network_path.relative_to(repo_root)),
        "network_sha256": instrument.sha256_file(network_path),
        "observation_package_path": str(package_path.relative_to(repo_root)),
        "observation_package_sha256": instrument.sha256_file(package_path),
        "match_audit_path": str(audit_path.relative_to(repo_root)),
        "match_audit_sha256": instrument.sha256_file(audit_path),
        "source_attempts": {item["source_id"]: item["status"] for item in source_attempts},
        "observation_count": len(package["observations"]),
        "match_coverage": audit["coverage"],
    }


def prepare_all(
    repo_root: Path,
    registry_path: Path,
    output_root: Path,
    *,
    selected: set[str] | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    registry = json.loads(registry_path.read_text())
    if registry.get("schema") != "openplan.development-validation-instrument-study.v2":
        raise instrument.InstrumentError("Preparation requires the development study v2 registry")
    timestamp = created_at or instrument.utc_now()
    selected_counties = [
        item for item in registry["counties"]
        if not selected or str(item["geography_id"]) in selected
    ]
    if selected and len(selected_counties) != len(selected):
        known = {str(item["geography_id"]) for item in registry["counties"]}
        raise instrument.InstrumentError(f"Unregistered geography selection: {sorted(selected - known)}")
    output_root.mkdir(parents=True, exist_ok=True)
    counties = [
        prepare_one(repo_root, output_root, registry_path, item, created_at=timestamp)
        for item in selected_counties
    ]
    result = {
        "schema": "openplan.development-validation-instrument-readiness.v2",
        "study_id": registry["study_id"],
        "created_at": timestamp,
        "preregistration_sha256": instrument.sha256_file(registry_path),
        "model_output_bytes_read": False,
        "readiness": "ready" if len(counties) == len(registry["counties"]) and all(item["ready"] for item in counties) else "partial",
        "ready_counties": sum(bool(item["ready"]) for item in counties),
        "county_count": len(registry["counties"]),
        "counties": counties,
    }
    readiness_path = output_root / "instrument-readiness.json"
    readiness_path.write_bytes(instrument.canonical_json_bytes(result))
    return result


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    registry_path = (repo_root / args.registry).resolve()
    output_root = (repo_root / args.output_root).resolve()
    try:
        result = prepare_all(
            repo_root, registry_path, output_root,
            selected=set(args.geography_id) or None,
            created_at=args.created_at,
        )
    except instrument.InstrumentError as exc:
        print(f"instrument preparation refused: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
