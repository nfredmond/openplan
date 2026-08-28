#!/usr/bin/env python3
"""Acquire exact public source bytes for a development observation package."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any, Mapping, Sequence

import requests

import count_sources
import hpms_count_source
import tmas_count_source
import validation_instrument as instrument


def geometry_bbox(geometry: Mapping[str, Any]) -> tuple[float, float, float, float]:
    points: list[tuple[float, float]] = []

    def walk(value: Any) -> None:
        if isinstance(value, list):
            if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
                points.append((float(value[0]), float(value[1])))
            else:
                for item in value:
                    walk(item)

    walk(geometry.get("coordinates"))
    if not points:
        raise instrument.InstrumentError("Resolved polygon has no numeric coordinates")
    return min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points), max(y for _, y in points)


def _safe_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-") or "response"


def _write_response(path: Path, response: requests.Response) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(response.content)
    return instrument.artifact_record(path, relative_to=path.parents[2])


def _unknown_match(status: str = "unresolved", reason: str = "Network match has not been frozen.") -> dict[str, Any]:
    return {
        "status": status, "frozen_at": "unknown", "frozen_before_model_volume": "unknown",
        "geometry": "unknown", "route": "unknown", "direction": "unknown", "facility": "unknown",
        "candidate_link_ids": "unknown", "selected_link_id": "unknown", "reason": reason,
    }


def _number(value: Any) -> float | None:
    try:
        result = float(str(value).strip())
        return result if result == result else None
    except (TypeError, ValueError):
        return None


def _state_observation(
    feature: Mapping[str, Any],
    *,
    index: int,
    region: str,
    artifact_sha256: str,
    downloaded_at: str,
) -> dict[str, Any]:
    source = count_sources.COUNT_SOURCES[region]
    fields = source["fields"]
    properties = feature.get("properties") or feature.get("attributes") or {}
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        coordinates = [geometry.get("x"), geometry.get("y")]
    route = str(properties.get(fields.get("route", "")) or "")
    postmile = str(properties.get(fields.get("postmile", "")) or "")
    description = str(properties.get(fields.get("description", "")) or "")
    if fields.get("aadt"):
        back = ahead = _number(properties.get(fields["aadt"]))
    else:
        back = _number(properties.get(fields.get("back_aadt", "")))
        ahead = _number(properties.get(fields.get("ahead_aadt", "")))
    center: float | str = "unknown"
    adjacent_state = "missing"
    if back is not None and ahead is not None and back == ahead:
        center, adjacent_state = back, "equal_adjacent_sections"
    elif back is None and ahead is not None:
        center, adjacent_state = ahead, "single_ahead"
    elif ahead is None and back is not None:
        center, adjacent_state = back, "single_back"
    elif back is not None and ahead is not None:
        adjacent_state = "ambiguous_adjacent_sections"
    source_id = f"us-state-{region.lower()}"
    stable = hashlib.sha256(
        json.dumps([source_id, route, postmile, description, coordinates, index], sort_keys=True).encode()
    ).hexdigest()[:20]
    facility = " ".join(item for item in (source.get("route_label_prefix", ""), route) if item).strip()
    status = "ambiguous" if adjacent_state == "ambiguous_adjacent_sections" else "unresolved"
    return {
        "schema": instrument.OBSERVATION_SCHEMA,
        "observation_id": f"{source_id}:{stable}",
        "source": {
            "dataset_id": count_sources.observed_count_source_descriptor(source_id)["dataset_id"],
            "publisher": source["agency"], "source_url": source["query_url"],
            "downloaded_at": downloaded_at, "artifact_sha256": artifact_sha256,
            "member_path": "HTTP response feature", "member_sha256": artifact_sha256,
        },
        "route_lrs": {
            "label": f"{facility} at {description}".strip(), "facility_name": facility,
            "description": description, "candidate_names": [facility] if facility else [],
            "candidate_facility_classes": [], "route_id": route or "unknown",
            "section_start": postmile or "unknown", "section_end": "unknown",
            "adjacent_section_state": adjacent_state, "back_observed_volume": back if back is not None else "unknown",
            "ahead_observed_volume": ahead if ahead is not None else "unknown",
        },
        "geometry": {"type": "Point", "coordinates": coordinates, "crs": "EPSG:4326"},
        "direction_lane_carriageway": {"basis": "two_way", "direction": "two_way", "lane": "unknown", "carriageway": "unknown"},
        "vehicle_basis": {"unit": "vehicles", "vehicle_definition": "annual average daily traffic", "conversion": "unknown"},
        "time_basis": {
            "year": source.get("count_year") or "unknown", "start_date": "unknown", "end_date": "unknown",
            "day_basis": "annual_average_daily_traffic", "observation_period": {"label": "daily", "hours": list(range(24))},
            "frozen_year_adjustment": "unknown",
        },
        "measurement": {"method": "source_derived", "duration": {"start": "unknown", "end": "unknown", "complete_hours": "unknown"}, "factors": "unknown"},
        "qa": {"status": "unknown", "flags": "unknown", "source_fields": {"adjacent_section_state": adjacent_state}},
        "estimate": {"center": center, "source_supported_bounds": "unknown"},
        "evidence_grade": "D" if center == "unknown" else "C",
        "match_audit": _unknown_match(status, "Adjacent source sections remain assignment-blind and unresolved." if status == "ambiguous" else "Network match has not been frozen."),
        "duplicate_lineage": {
            "lineage_id": f"{source_id}:{stable}", "canonical_observation_id": f"{source_id}:{stable}",
            "duplicate_of": "unknown", "resolution": "unique source feature",
        },
    }


def fetch_state_source(
    source_id: str,
    bbox: Sequence[float],
    package_dir: Path,
    *,
    attempted_at: str,
    get=requests.get,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    region = source_id.removeprefix("us-state-").upper()
    descriptor = count_sources.observed_count_source_descriptor(source_id)
    if region not in count_sources.COUNT_SOURCES:
        return ({
            "source_id": source_id, "adapter": descriptor["adapter"], "status": "geography_unsupported",
            "attempted_at": attempted_at, "source_url": "registry:no-state-source", "artifacts": [],
            "record_count": 0, "reason": "No registered state adapter covers this subdivision.",
        }, [])
    source = count_sources.COUNT_SOURCES[region]
    out_fields = ",".join(sorted(set(source["fields"].values())))
    params = {
        "where": "1=1", "geometry": ",".join(str(item) for item in bbox),
        "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "outFields": out_fields,
    }
    artifacts: list[dict[str, Any]] = []
    error: str | None = None
    payload: Mapping[str, Any] | None = None
    artifact_hash: str | None = None
    source_dir = package_dir / "sources" / source_id
    existing_responses = sorted(source_dir.glob("*.response"))
    for path in existing_responses:
        artifact = instrument.artifact_record(path, relative_to=package_dir)
        artifacts.append(artifact)
        try:
            candidate = json.loads(path.read_bytes())
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            error = str(exc)
            continue
        if isinstance(candidate, Mapping) and not candidate.get("error"):
            payload = candidate
            artifact_hash = artifact["sha256"]
            break
    for index, fmt in enumerate(("geojson", "json"), start=len(existing_responses) + 1):
        if payload is not None:
            break
        try:
            response = get(source["query_url"], params={**params, "f": fmt}, timeout=120)
            artifact = _write_response(source_dir / f"{index:02d}-{fmt}.response", response)
            artifacts.append(artifact)
            response.raise_for_status()
            candidate = response.json()
            if isinstance(candidate, Mapping) and candidate.get("error"):
                raise RuntimeError(str(candidate["error"]))
            payload = candidate
            artifact_hash = artifact["sha256"]
            break
        except Exception as exc:
            error = str(exc)
    if payload is None or artifact_hash is None:
        return ({
            "source_id": source_id, "adapter": descriptor["adapter"], "status": "source_unavailable",
            "attempted_at": attempted_at, "source_url": source["query_url"], "artifacts": artifacts,
            "record_count": 0, "reason": f"Every registered response format failed: {error or 'unknown error'}",
        }, [])
    raw_features = list(payload.get("features") or [])
    normalized = count_sources.normalize_features(raw_features, source["fields"])
    # Preserve raw publisher fields for observation normalization.
    usable_features = raw_features if raw_features and (raw_features[0].get("properties") or raw_features[0].get("attributes")) else normalized
    observations = [
        _state_observation(feature, index=index, region=region, artifact_sha256=artifact_hash, downloaded_at=attempted_at)
        for index, feature in enumerate(usable_features)
    ]
    status = "available" if observations else "supported_but_empty"
    return ({
        "source_id": source_id, "adapter": descriptor["adapter"], "status": status,
        "attempted_at": attempted_at, "source_url": source["query_url"], "artifacts": artifacts,
        "record_count": len(observations),
        "reason": "Exact HTTP response bytes preserved before normalization." if observations else "The source returned a successful response with zero intersecting records.",
    }, observations)


class RecordingGet:
    def __init__(self, package_dir: Path, source_id: str):
        self.package_dir = package_dir
        self.source_id = source_id
        source_dir = package_dir / "sources" / source_id
        existing = sorted(source_dir.glob("*-data.response"))
        self.data_artifacts = [
            instrument.artifact_record(path, relative_to=package_dir) for path in existing
        ]
        self.artifacts: list[dict[str, Any]] = list(self.data_artifacts)
        indexes = []
        for path in source_dir.glob("*.response"):
            try:
                indexes.append(int(path.name.split("-", 1)[0]))
            except ValueError:
                continue
        self.calls = max(indexes, default=0)

    def __call__(self, url: str, **kwargs):
        self.calls += 1
        response = requests.get(url, **kwargs)
        kind = "metadata" if "/api/views/" in url else "data"
        path = self.package_dir / "sources" / self.source_id / f"{self.calls:03d}-{kind}.response"
        artifact = _write_response(path, response)
        self.artifacts.append(artifact)
        if kind == "data":
            self.data_artifacts.append(artifact)
        return response


def fetch_hpms_source(
    bbox: Sequence[float], package_dir: Path, *, attempted_at: str
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source_id = count_sources.HPMS_SOURCE_ID
    descriptor = count_sources.observed_count_source_descriptor(source_id)
    recorder = RecordingGet(package_dir, source_id)
    result = hpms_count_source.fetch_hpms_records(
        bbox, package_dir / "sources" / source_id / "normalized-cache",
        request_get=recorder, page_size=50_000,
    )
    status_map = {
        "available": "available", "source_unavailable": "source_unavailable",
        "geography_unsupported": "geography_unsupported", "no_eligible_sections": "supported_but_empty",
        "no_traffic_found": "supported_but_empty",
    }
    status = status_map.get(result["status"], "source_unavailable")
    observations: list[dict[str, Any]] = []
    if status == "available" and recorder.data_artifacts:
        data_hash = recorder.data_artifacts[0]["sha256"]
        for record in result["records"]:
            observations.append(hpms_count_source.record_to_observation_v1(
                record, source_snapshot_sha256=data_hash,
                source_url=f"https://data.transportation.gov/resource/{descriptor['dataset_id']}.geojson",
                downloaded_at=attempted_at,
            ))
    return ({
        "source_id": source_id, "adapter": descriptor["adapter"], "status": status,
        "attempted_at": attempted_at,
        "source_url": f"https://data.transportation.gov/resource/{descriptor['dataset_id']}.geojson",
        "artifacts": recorder.artifacts, "record_count": len(observations),
        "reason": (
            "Exact metadata and paged HTTP response bytes preserved before normalization."
            if status == "available"
            else str(result.get("error") or descriptor["coverage_statement"])
        ),
    }, observations)


def ensure_tmas_archives(shared_dir: Path, *, attempted_at: str) -> dict[str, Any]:
    manifest_path = shared_dir / "source-manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
        for entry in manifest.get("archives", []):
            path = shared_dir / entry["name"]
            if not path.is_file() or instrument.sha256_file(path) != entry["sha256"]:
                raise instrument.InstrumentError(f"Frozen TMAS archive changed: {path}")
        if manifest.get("complete") and len(manifest.get("archives", [])) == len(tmas_count_source.ARCHIVE_NAMES):
            return manifest
    return tmas_count_source.fetch_complete_2024_archives(shared_dir, downloaded_at=attempted_at)


def fetch_tmas_source(
    package_dir: Path,
    shared_dir: Path,
    *,
    state_codes: set[str],
    county_codes: set[str],
    attempted_at: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source_id = count_sources.TMAS_SOURCE_ID
    descriptor = count_sources.observed_count_source_descriptor(source_id)
    try:
        manifest = ensure_tmas_archives(shared_dir, attempted_at=attempted_at)
        target_dir = package_dir / "sources" / source_id
        target_dir.mkdir(parents=True, exist_ok=True)
        artifacts = []
        for entry in manifest["archives"]:
            source = shared_dir / entry["name"]
            target = target_dir / entry["name"]
            if not target.exists():
                try:
                    os.link(source, target)
                except OSError:
                    shutil.copyfile(source, target)
            artifacts.append(instrument.artifact_record(target, relative_to=package_dir))
        observations = []
        station_archive = target_dir / "2024_station_data.zip"
        for month in tmas_count_source.MONTHS:
            for item in tmas_count_source.build_monthly_observations(
                station_archive,
                target_dir / f"{month}_2024_ccs_data.zip",
                downloaded_at=attempted_at,
                state_codes=state_codes,
                county_codes=county_codes,
            ):
                geography = item["route_lrs"].get("source_geography") or {}
                state = str(geography.get("state_code") or "").zfill(2)
                county = str(geography.get("county_code") or "").zfill(3)
                if state in state_codes and (not county_codes or county in county_codes):
                    observations.append(item)
        status = "available" if observations else "supported_but_empty"
        return ({
            "source_id": source_id, "adapter": descriptor["adapter"], "status": status,
            "attempted_at": attempted_at, "source_url": tmas_count_source.BASE_URL,
            "artifacts": artifacts, "record_count": len(observations),
            "reason": "All thirteen exact 2024 archives preserved before normalization." if observations else "Complete source archives contain no records for the resolved geography.",
        }, observations)
    except Exception as exc:
        return ({
            "source_id": source_id, "adapter": descriptor["adapter"], "status": "source_unavailable",
            "attempted_at": attempted_at, "source_url": tmas_count_source.BASE_URL,
            "artifacts": [], "record_count": 0, "reason": str(exc),
        }, [])
