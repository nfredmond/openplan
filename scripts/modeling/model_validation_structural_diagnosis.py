#!/usr/bin/env python3
"""Diagnose frozen model-validation structure without repairing the instrument.

The assignment-blind functions in this module accept no model-output path or
volume mapping. Post-assignment functions consume only the link IDs selected by
the frozen audit. They never rematch, calibrate, rank, or average methods.
"""
from __future__ import annotations

import csv
import json
import math
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Mapping, Sequence

from shapely.geometry import Point, box, shape
from shapely.strtree import STRtree

import validation_instrument as instrument


ASSIGNMENT_BLIND_SCHEMA = "openplan.model-validation-assignment-blind-diagnosis.v1"
DIAGNOSIS_SCHEMA = "openplan.model-validation-structural-diagnosis.v1"
METHODS = ("aequilibrae", "activitysim")
UNKNOWN = "unknown"
SEARCH_DISTANCE_METERS = instrument.MAX_MATCH_DISTANCE_METERS
EARTH_RADIUS_METERS = 6_371_008.8
VOLUME_FIELDS = ("PCE_tot", "demand_tot", "volume", "loaded_volume")


class DiagnosisRefused(RuntimeError):
    """The frozen diagnosis contract cannot be satisfied."""


def _artifact(path: Path, repo_root: Path) -> dict[str, Any]:
    try:
        return instrument.artifact_record(path, relative_to=repo_root)
    except ValueError:
        return instrument.artifact_record(path)


def _connect_network(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path))
    connection.enable_load_extension(True)
    for extension in instrument.SPATIALITE_PATHS:
        if not Path(extension).exists():
            continue
        try:
            connection.load_extension(extension)
            return connection
        except sqlite3.Error:
            continue
    connection.close()
    raise DiagnosisRefused("SpatiaLite is required to diagnose frozen network geometry")


def read_network_geometries(path: Path) -> list[dict[str, Any]]:
    """Read full link geometry and the centroid used by the frozen v1 matcher."""
    connection = _connect_network(path)
    try:
        rows = connection.execute(
            "SELECT link_id, name, link_type, direction, AsGeoJSON(geometry), "
            "X(Centroid(geometry)), Y(Centroid(geometry)) FROM links ORDER BY link_id"
        ).fetchall()
    finally:
        connection.close()
    links = []
    for link_id, name, link_type, direction, geometry_json, centroid_lon, centroid_lat in rows:
        if geometry_json is None or centroid_lon is None or centroid_lat is None:
            continue
        geometry = shape(json.loads(str(geometry_json)))
        if geometry.geom_type not in {"LineString", "MultiLineString"}:
            continue
        links.append({
            "link_id": int(link_id),
            "name": str(name or ""),
            "link_type": str(link_type or ""),
            "direction": int(direction or 0),
            "geometry": geometry,
            "centroid_lon": float(centroid_lon),
            "centroid_lat": float(centroid_lat),
        })
    return links


def _usable_coordinate(observation: Mapping[str, Any]) -> tuple[float, float] | None:
    geometry = observation.get("geometry")
    if not isinstance(geometry, Mapping) or geometry.get("type") != "Point":
        return None
    coordinates = geometry.get("coordinates")
    if (
        not isinstance(coordinates, list)
        or len(coordinates) < 2
        or isinstance(coordinates[0], bool)
        or isinstance(coordinates[1], bool)
        or not isinstance(coordinates[0], (int, float))
        or not isinstance(coordinates[1], (int, float))
    ):
        return None
    lon, lat = float(coordinates[0]), float(coordinates[1])
    if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
        return None
    return lon, lat


def _normalized_delta_lon(lon: float, origin: float) -> float:
    return ((lon - origin + 180.0) % 360.0) - 180.0


def _point_segment_distance_meters(
    lon: float,
    lat: float,
    start: Sequence[float],
    end: Sequence[float],
) -> float:
    cos_lat = max(1e-9, math.cos(math.radians(lat)))

    def local(coordinate: Sequence[float]) -> tuple[float, float]:
        return (
            EARTH_RADIUS_METERS * math.radians(_normalized_delta_lon(float(coordinate[0]), lon)) * cos_lat,
            EARTH_RADIUS_METERS * math.radians(float(coordinate[1]) - lat),
        )

    ax, ay = local(start)
    bx, by = local(end)
    dx, dy = bx - ax, by - ay
    denominator = dx * dx + dy * dy
    if denominator == 0:
        return math.hypot(ax, ay)
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / denominator))
    return math.hypot(ax + t * dx, ay + t * dy)


def full_link_distance_meters(lon: float, lat: float, geometry: Any) -> float:
    lines = [geometry] if geometry.geom_type == "LineString" else list(geometry.geoms)
    distances = []
    for line in lines:
        coordinates = list(line.coords)
        distances.extend(
            _point_segment_distance_meters(lon, lat, coordinates[index], coordinates[index + 1])
            for index in range(len(coordinates) - 1)
        )
    return min(distances, default=math.inf)


def _centroid_distance_meters(lon: float, lat: float, link: Mapping[str, Any]) -> float:
    return instrument._distance_meters(
        lon,
        lat,
        float(link["centroid_lon"]),
        float(link["centroid_lat"]),
    )


def _candidate_indices(tree: STRtree, lon: float, lat: float) -> list[int]:
    latitude_degrees = SEARCH_DISTANCE_METERS / 110_574.0
    longitude_degrees = SEARCH_DISTANCE_METERS / max(1.0, 111_320.0 * math.cos(math.radians(lat)))
    envelopes = [box(lon - longitude_degrees, lat - latitude_degrees, lon + longitude_degrees, lat + latitude_degrees)]
    if lon - longitude_degrees < -180:
        envelopes.append(box(lon - longitude_degrees + 360, lat - latitude_degrees, 180, lat + latitude_degrees))
    if lon + longitude_degrees > 180:
        envelopes.append(box(-180, lat - latitude_degrees, lon + longitude_degrees - 360, lat + latitude_degrees))
    indices: set[int] = set()
    for envelope in envelopes:
        indices.update(int(index) for index in tree.query(envelope))
    return sorted(indices)


def _route_has_name_evidence(observation: Mapping[str, Any]) -> bool:
    route = observation.get("route_lrs")
    if not isinstance(route, Mapping):
        return False
    scalar_keys = ("facility_name", "station_location", "label", "lrs_id", "route_id")
    if any(str(route.get(key) or "").strip() not in {"", UNKNOWN} for key in scalar_keys):
        return True
    candidates = route.get("candidate_names")
    return isinstance(candidates, list) and any(str(item).strip() for item in candidates)


def _route_has_facility_evidence(observation: Mapping[str, Any]) -> bool:
    route = observation.get("route_lrs")
    if not isinstance(route, Mapping):
        return False
    candidates = route.get("candidate_facility_classes")
    return isinstance(candidates, list) and any(str(item).strip() for item in candidates)


def _lineage_findings(observations: Sequence[Mapping[str, Any]]) -> tuple[int, int]:
    canonical_by_lineage: dict[str, set[str]] = defaultdict(set)
    observation_ids = {str(item.get("observation_id")) for item in observations}
    ambiguous = 0
    missing_canonical = 0
    for observation in observations:
        lineage = observation.get("duplicate_lineage")
        if not isinstance(lineage, Mapping):
            continue
        lineage_id = str(lineage.get("lineage_id") or "")
        canonical = str(lineage.get("canonical_observation_id") or "")
        if lineage_id and canonical:
            canonical_by_lineage[lineage_id].add(canonical)
        if "ambig" in str(lineage.get("resolution") or "").lower():
            ambiguous += 1
        duplicate_of = str(lineage.get("duplicate_of") or "")
        if duplicate_of not in {"", UNKNOWN} and duplicate_of not in observation_ids:
            missing_canonical += 1
    ambiguous += sum(1 for values in canonical_by_lineage.values() if len(values) > 1)
    return ambiguous, missing_canonical


def build_assignment_blind_diagnosis(
    *,
    repo_root: Path,
    geography_id: str,
    network_path: Path,
    observation_package_path: Path,
    match_audit_path: Path,
    preregistration_path: Path,
    created_at: str,
) -> dict[str, Any]:
    """Measure frozen inputs without accepting or discovering model output."""
    package = instrument.validate_observation_package(observation_package_path)
    audit = instrument.validate_match_audit(
        match_audit_path, network_path, observation_package_path, preregistration_path
    )
    if str(package.get("geography_id")) != geography_id:
        raise DiagnosisRefused("Observation package geography does not match the registry geography")
    observations = package["observations"]
    matches = audit["matches"]
    links = read_network_geometries(network_path)
    link_by_id = {str(item["link_id"]): item for item in links}
    tree = STRtree([item["geometry"] for item in links])

    status_counts = Counter(str(item.get("status") or "unresolved") for item in matches)
    grade_counts = Counter(str(item.get("evidence_grade") or UNKNOWN) for item in observations)
    missing_coordinates = 0
    unknown_bounds = 0
    name_evidence = 0
    facility_evidence = 0
    candidate_counts: Counter[str] = Counter()
    exclusion_reasons: Counter[str] = Counter()
    genuine_network_absence = 0
    centroid_misleading = 0
    nearby_network_without_match_evidence = 0
    nearby_network_with_unmatched_evidence = 0
    diagnostic_records = []

    for observation, match in zip(observations, matches, strict=True):
        if str(observation.get("observation_id")) != str(match.get("observation_id")):
            raise DiagnosisRefused("Frozen observation and audit order diverged")
        coordinate = _usable_coordinate(observation)
        if coordinate is None:
            missing_coordinates += 1
        if (observation.get("estimate") or {}).get("source_supported_bounds") == UNKNOWN:
            unknown_bounds += 1
        if _route_has_name_evidence(observation):
            name_evidence += 1
        if _route_has_facility_evidence(observation):
            facility_evidence += 1
        candidate_link_ids = match.get("candidate_link_ids")
        frozen_candidates = list(candidate_link_ids) if isinstance(candidate_link_ids, list) else []
        candidate_counts[str(len(frozen_candidates))] += 1
        if match.get("status") == "excluded":
            exclusion_reasons[str(match.get("reason") or "No reason recorded")] += 1

        geometry_finding: dict[str, Any] | str = UNKNOWN
        full_link_within_radius = False
        centroid_only_exclusion = False
        network_absent_for_record = False
        if coordinate is not None and links:
            lon, lat = coordinate
            indices = _candidate_indices(tree, lon, lat)
            distances = [
                (full_link_distance_meters(lon, lat, links[index]["geometry"]), index)
                for index in indices
            ]
            distances = [item for item in distances if math.isfinite(item[0])]
            if distances:
                full_distance, nearest_index = min(distances)
                nearest = links[nearest_index]
                centroid_distance = _centroid_distance_meters(lon, lat, nearest)
                full_link_within_radius = full_distance <= SEARCH_DISTANCE_METERS
                centroid_only_exclusion = full_link_within_radius and centroid_distance > SEARCH_DISTANCE_METERS
                geometry_finding = {
                    "nearest_full_link_distance_meters": round(full_distance, 3),
                    "same_link_centroid_distance_meters": round(centroid_distance, 3),
                    "full_link_within_frozen_search_distance": full_link_within_radius,
                    "centroid_outside_frozen_search_distance": centroid_distance > SEARCH_DISTANCE_METERS,
                }
            if not full_link_within_radius and match.get("status") in {"unresolved", "ambiguous"}:
                genuine_network_absence += 1
                network_absent_for_record = True
            if centroid_only_exclusion:
                centroid_misleading += 1
            if (
                full_link_within_radius
                and match.get("status") == "unresolved"
                and not frozen_candidates
            ):
                if not _route_has_name_evidence(observation) and not _route_has_facility_evidence(observation):
                    nearby_network_without_match_evidence += 1
                else:
                    nearby_network_with_unmatched_evidence += 1

        selected_geometry: dict[str, Any] | str = UNKNOWN
        selected_ids = instrument.selected_link_ids(match)
        if coordinate is not None and selected_ids:
            lon, lat = coordinate
            selected_distances = []
            for selected_id in selected_ids:
                link = link_by_id.get(selected_id)
                if link is None:
                    continue
                selected_distances.append({
                    "link_id": selected_id,
                    "full_link_distance_meters": round(
                        full_link_distance_meters(lon, lat, link["geometry"]), 3
                    ),
                    "centroid_distance_meters": round(_centroid_distance_meters(lon, lat, link), 3),
                })
            if selected_distances:
                selected_geometry = {"frozen_selected_links": selected_distances}

        if (
            match.get("status") in {"matched", "ambiguous"}
            or centroid_only_exclusion
            or network_absent_for_record
        ):
            diagnostic_records.append({
                "observation_id": str(observation["observation_id"]),
                "frozen_status": str(match.get("status") or "unresolved"),
                "frozen_candidate_link_ids": frozen_candidates,
                "frozen_selected_link_id": match.get("selected_link_id", UNKNOWN),
                "full_network_geometry": geometry_finding,
                "frozen_selected_geometry": selected_geometry,
                "name_evidence_present": _route_has_name_evidence(observation),
                "facility_evidence_present": _route_has_facility_evidence(observation),
            })

    lineage_ambiguous, missing_canonical = _lineage_findings(observations)
    source_attempts = [
        {
            "source_id": str(item.get("source_id")),
            "status": str(item.get("status")),
            "record_count": int(item.get("record_count") or 0),
            "reason": str(item.get("reason") or ""),
            "artifacts": list(item.get("artifacts") or []),
        }
        for item in package["source_attempts"]
    ]
    findings = [
        {
            "category": "observation",
            "classification": "cause" if missing_coordinates else "finding",
            "code": "missing_usable_point_coordinates",
            "count": missing_coordinates,
            "statement": "The frozen matcher cannot evaluate a location when the observation has no usable GeoJSON point coordinate pair.",
        },
        {
            "category": "matching",
            "classification": "cause" if centroid_misleading else "finding",
            "code": "centroid_geometry_excludes_full_link",
            "count": centroid_misleading,
            "statement": "A full link lies inside the frozen distance while that link's centroid lies outside it. The diagnosis does not replace the frozen match.",
        },
        {
            "category": "matching",
            "classification": "finding",
            "code": "genuine_network_absence_within_search_distance",
            "count": genuine_network_absence,
            "statement": "No frozen network link geometry lies within the search distance for these usable coordinates.",
        },
        {
            "category": "matching",
            "classification": "cause" if nearby_network_without_match_evidence else "finding",
            "code": "nearby_network_without_name_or_facility_evidence",
            "count": nearby_network_without_match_evidence,
            "statement": "A network link lies within the search distance, but the observation supplies neither name nor facility evidence required by the frozen matcher. This causes candidate exclusion without selecting a replacement link.",
        },
        {
            "category": "matching",
            "classification": "finding",
            "code": "nearby_network_with_unmatched_name_or_facility_evidence",
            "count": nearby_network_with_unmatched_evidence,
            "statement": "A network link lies within the search distance and the observation has some route or facility evidence, but the frozen audit retained no candidate. The diagnosis does not infer a corrected match.",
        },
    ]
    result = {
        "schema": ASSIGNMENT_BLIND_SCHEMA,
        "diagnosis_stage": "assignment_blind",
        "geography_id": geography_id,
        "created_at": created_at,
        "model_output_bytes_read": False,
        "exact_inputs": {
            "preregistration": _artifact(preregistration_path, repo_root),
            "network": _artifact(network_path, repo_root),
            "observation_package": _artifact(observation_package_path, repo_root),
            "pre_volume_match_audit": _artifact(match_audit_path, repo_root),
        },
        "jurisdictions": {
            "state": "resolved" if package["intersected_subdivisions"] else "unsupported_or_unresolved",
            "intersected_subdivisions": list(package["intersected_subdivisions"]),
        },
        "source_attempts": source_attempts,
        "observation": {
            "records": len(observations),
            "evidence_grades": dict(sorted(grade_counts.items())),
            "missing_usable_point_coordinates": missing_coordinates,
            "source_supported_bounds_unknown": unknown_bounds,
        },
        "matching": {
            "frozen_statuses": dict(sorted(status_counts.items())),
            "frozen_candidate_count_distribution": dict(sorted(candidate_counts.items(), key=lambda item: int(item[0]))),
            "name_evidence_present": name_evidence,
            "facility_evidence_present": facility_evidence,
            "ambiguous_lineage": lineage_ambiguous,
            "missing_declared_canonical_observation": missing_canonical,
            "exclusion_reasons": dict(sorted(exclusion_reasons.items())),
            "full_link_within_radius_but_centroid_outside": centroid_misleading,
            "genuine_network_absence_within_search_distance": genuine_network_absence,
            "nearby_network_without_name_or_facility_evidence": nearby_network_without_match_evidence,
            "nearby_network_with_unmatched_name_or_facility_evidence": nearby_network_with_unmatched_evidence,
            "records": diagnostic_records,
        },
        "findings": findings,
        "match_changes": 0,
    }
    instrument.assert_assignment_blind(result)
    return result


def read_link_volumes(path: Path) -> dict[str, float]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        volume_field = next((field for field in VOLUME_FIELDS if field in fields), None)
        if volume_field is None or "link_id" not in fields:
            raise DiagnosisRefused(f"Model output has no supported link or volume field: {path}")
        values: dict[str, float] = {}
        for row in reader:
            try:
                value = float(row[volume_field])
            except (TypeError, ValueError) as exc:
                raise DiagnosisRefused(f"Model output has a nonnumeric {volume_field} value: {path}") from exc
            if not math.isfinite(value):
                raise DiagnosisRefused(f"Model output has a non-finite {volume_field} value: {path}")
            values[str(row["link_id"])] = value
    return values


def build_network_loading_records(
    audit: Mapping[str, Any],
    volumes: Mapping[str, float],
    method: str,
) -> dict[str, Any]:
    records = []
    for match in audit["matches"]:
        if match.get("status") != "matched":
            continue
        link_ids = instrument.selected_link_ids(match)
        link_values = {link_id: volumes[link_id] if link_id in volumes else UNKNOWN for link_id in link_ids}
        missing = [link_id for link_id in link_ids if link_id not in volumes]
        output_row_present = not missing and bool(link_ids)
        raw_value: float | str = (
            sum(float(volumes[link_id]) for link_id in link_ids) if output_row_present else UNKNOWN
        )
        assignment_state = (
            "output_row_absent"
            if not output_row_present
            else "unloaded_zero"
            if raw_value == 0
            else "loaded_nonzero"
        )
        records.append({
            "observation_id": str(match["observation_id"]),
            "frozen_selected_link_id": match.get("selected_link_id", UNKNOWN),
            "frozen_link_ids": link_ids,
            "method": method,
            "loaded": assignment_state == "loaded_nonzero",
            "output_row_present": output_row_present,
            "assignment_state": assignment_state,
            "link_values": link_values,
            "missing_link_ids": missing,
            "raw_method_value": raw_value,
        })
    return {
        "method": method,
        "matched_records": len(records),
        "loaded_records": sum(1 for item in records if item["assignment_state"] == "loaded_nonzero"),
        "unloaded_records": sum(1 for item in records if item["assignment_state"] == "unloaded_zero"),
        "output_missing_records": sum(1 for item in records if item["assignment_state"] == "output_row_absent"),
        "negative_loaded_records": sum(
            1
            for item in records
            if item["assignment_state"] == "loaded_nonzero" and float(item["raw_method_value"]) < 0
        ),
        "records": records,
    }


def compare_methods(
    aequilibrae_loading: Mapping[str, Any],
    activitysim_loading: Mapping[str, Any],
) -> dict[str, Any]:
    by_method = {
        "aequilibrae": {item["observation_id"]: item for item in aequilibrae_loading["records"]},
        "activitysim": {item["observation_id"]: item for item in activitysim_loading["records"]},
    }
    observation_ids = sorted(set(by_method["aequilibrae"]) | set(by_method["activitysim"]))
    records = []
    for observation_id in observation_ids:
        aeq = by_method["aequilibrae"].get(observation_id)
        asim = by_method["activitysim"].get(observation_id)
        if aeq is None or asim is None or aeq["frozen_link_ids"] != asim["frozen_link_ids"]:
            raise DiagnosisRefused("Methods do not use identical frozen matched links")
        both_values_available = bool(aeq["output_row_present"] and asim["output_row_present"])
        difference: float | str = UNKNOWN
        ratio: float | str = UNKNOWN
        if both_values_available:
            aeq_value = float(aeq["raw_method_value"])
            asim_value = float(asim["raw_method_value"])
            difference = aeq_value - asim_value
            if asim_value != 0:
                ratio = aeq_value / asim_value
        records.append({
            "observation_id": observation_id,
            "frozen_link_ids": list(aeq["frozen_link_ids"]),
            "identical_frozen_links": True,
            "aequilibrae": {
                "assignment_state": aeq["assignment_state"],
                "output_row_present": aeq["output_row_present"],
                "raw_value": aeq["raw_method_value"],
            },
            "activitysim": {
                "assignment_state": asim["assignment_state"],
                "output_row_present": asim["output_row_present"],
                "raw_value": asim["raw_method_value"],
            },
            "aequilibrae_minus_activitysim": difference,
            "aequilibrae_to_activitysim_ratio": ratio,
        })
    return {
        "aggregation": "none",
        "ranking": "none",
        "winner": "none",
        "records": records,
        "both_values_available_records": sum(
            1
            for item in records
            if item["aequilibrae"]["output_row_present"]
            and item["activitysim"]["output_row_present"]
        ),
        "records_with_unloaded_method": sum(
            1
            for item in records
            if item["aequilibrae"]["assignment_state"] == "unloaded_zero"
            or item["activitysim"]["assignment_state"] == "unloaded_zero"
        ),
        "records_with_unavailable_method": sum(
            1
            for item in records
            if not item["aequilibrae"]["output_row_present"]
            or not item["activitysim"]["output_row_present"]
        ),
        "zero_denominator_ratios_retained_as_unknown": sum(
            1
            for item in records
            if item["aequilibrae"]["output_row_present"]
            and item["activitysim"]["output_row_present"]
            and item["activitysim"]["raw_value"] == 0
        ),
    }


def _ledger_fact(
    *,
    value: Any,
    artifact: Mapping[str, Any],
    json_pointer: str,
    proven_when: bool,
) -> dict[str, Any]:
    if not proven_when:
        return {"status": UNKNOWN, "value": UNKNOWN, "evidence": []}
    return {
        "status": "proved",
        "value": value,
        "evidence": [{
            "path": artifact["path"],
            "sha256": artifact["sha256"],
            "json_pointer": json_pointer,
        }],
    }


def build_evidence_ledger(
    comparison_basis: Mapping[str, Any],
    basis_artifact: Mapping[str, Any],
    assignment_profile_path: Path,
    repo_root: Path,
) -> dict[str, Any]:
    model_year = comparison_basis.get("model_base_year")
    day_basis = comparison_basis.get("day_basis")
    assignment_period = comparison_basis.get("assignment_period")
    direction = comparison_basis.get("direction_basis")
    vehicle = comparison_basis.get("vehicle_basis")
    profile = comparison_basis.get("assignment_profile")
    population = comparison_basis.get("population_vintage")
    coefficients = comparison_basis.get("coefficient_package")

    profile_artifact: dict[str, Any] | None = None
    profile_proved = False
    if isinstance(profile, Mapping) and assignment_profile_path.is_file():
        profile_artifact = _artifact(assignment_profile_path, repo_root)
        profile_proved = profile_artifact["sha256"] == profile.get("artifact_sha256")

    return {
        "model_year": _ledger_fact(
            value=model_year,
            artifact=basis_artifact,
            json_pointer="/model_base_year",
            proven_when=model_year not in {None, "", UNKNOWN},
        ),
        "day_basis": _ledger_fact(
            value=day_basis,
            artifact=basis_artifact,
            json_pointer="/day_basis",
            proven_when=day_basis not in {None, "", UNKNOWN},
        ),
        "assignment_period": _ledger_fact(
            value=assignment_period,
            artifact=basis_artifact,
            json_pointer="/assignment_period",
            proven_when=isinstance(assignment_period, Mapping),
        ),
        "direction": _ledger_fact(
            value=direction,
            artifact=basis_artifact,
            json_pointer="/direction_basis",
            proven_when=isinstance(direction, Mapping),
        ),
        "vehicle_pce_basis": _ledger_fact(
            value=vehicle,
            artifact=basis_artifact,
            json_pointer="/vehicle_basis",
            proven_when=isinstance(vehicle, Mapping)
            and isinstance(vehicle.get("vehicle_pce_conversion"), Mapping)
            and vehicle["vehicle_pce_conversion"].get("status") == "proven",
        ),
        "assignment_profile": (
            {
                "status": "proved",
                "value": profile.get("profile"),
                "evidence": [{
                    "path": profile_artifact["path"],
                    "sha256": profile_artifact["sha256"],
                    "json_pointer": "",
                }],
            }
            if profile_proved and profile_artifact is not None
            else {"status": UNKNOWN, "value": UNKNOWN, "evidence": []}
        ),
        "population_vintage": _ledger_fact(
            value=population,
            artifact=basis_artifact,
            json_pointer="/population_vintage",
            proven_when=population not in {None, "", UNKNOWN},
        ),
        "coefficients": _ledger_fact(
            value=coefficients,
            artifact=basis_artifact,
            json_pointer="/coefficient_package",
            proven_when=coefficients not in {None, "", UNKNOWN},
        ),
    }


def build_method_diagnosis(
    *,
    repo_root: Path,
    study_id: str,
    geography_id: str,
    method: str,
    created_at: str,
    app_version: str,
    git_sha: str,
    source_release: Mapping[str, Any],
    assignment_blind_path: Path,
    loading: Mapping[str, Any],
    method_comparison: Mapping[str, Any],
    preregistration_path: Path,
    network_path: Path,
    observation_package_path: Path,
    match_audit_path: Path,
    model_output_path: Path,
    comparison_basis_path: Path,
    assessment_path: Path,
    assignment_profile_path: Path,
) -> dict[str, Any]:
    if method not in METHODS:
        raise DiagnosisRefused(f"Unregistered diagnosis method: {method}")
    assignment_blind = json.loads(assignment_blind_path.read_text())
    if assignment_blind.get("model_output_bytes_read") is not False:
        raise DiagnosisRefused("Assignment-blind diagnosis does not prove its output boundary")
    instrument.assert_assignment_blind(assignment_blind)
    comparison_basis = json.loads(comparison_basis_path.read_text())
    assessment = json.loads(assessment_path.read_text())
    basis_artifact = _artifact(comparison_basis_path, repo_root)
    assessment_artifact = _artifact(assessment_path, repo_root)
    model_output_artifact = _artifact(model_output_path, repo_root)
    if assessment.get("scientific_outcome") != "inconclusive":
        raise DiagnosisRefused("Structural diagnosis may not change the frozen scientific outcome")
    if assessment.get("exact_inputs", {}).get("comparison_basis_sha256") != basis_artifact["sha256"]:
        raise DiagnosisRefused("Existing assessment does not bind the supplied comparison basis")
    if assessment.get("exact_inputs", {}).get("model_output_sha256") != model_output_artifact["sha256"]:
        raise DiagnosisRefused("Existing assessment does not bind the supplied model output")
    ledger = build_evidence_ledger(
        comparison_basis, basis_artifact, assignment_profile_path, repo_root
    )
    unknown_facts = sorted(key for key, value in ledger.items() if value["status"] == UNKNOWN)
    findings = list(assignment_blind["findings"])
    findings.extend([
        {
            "category": "network_loading",
            "classification": "cause" if loading["output_missing_records"] else "finding",
            "code": "frozen_matched_links_missing_from_output",
            "count": loading["output_missing_records"],
            "statement": "A frozen matched link absent from the method output cannot produce a comparable modeled quantity.",
        },
        {
            "category": "network_loading",
            "classification": "cause" if loading["unloaded_records"] else "finding",
            "code": "frozen_matched_links_with_zero_assigned_volume",
            "count": loading["unloaded_records"],
            "statement": "A recorded zero on a frozen matched link is retained as unloaded, not discarded or relabeled as a missing output row.",
        },
        {
            "category": "comparability",
            "classification": "cause" if unknown_facts else "finding",
            "code": "comparison_basis_facts_unknown",
            "count": len(unknown_facts),
            "unknown_facts": unknown_facts,
            "statement": "Absent basis facts remain unknown and block a same-quantity claim.",
        },
        {
            "category": "method_disagreement",
            "classification": "finding",
            "code": "paired_raw_values_retained_separately",
            "count": method_comparison["both_values_available_records"],
            "statement": "Raw values, differences, and ratios are reported on identical frozen links without averaging or selecting a method.",
        },
    ])
    return {
        "schema": DIAGNOSIS_SCHEMA,
        "diagnosis_id": f"{geography_id}:{method}:structural-diagnosis-v1",
        "study_id": study_id,
        "geography_id": geography_id,
        "method": method,
        "created_at": created_at,
        "release_source": {"app_version": app_version, "git_sha": git_sha},
        "source_validation_release": dict(source_release),
        "scientific_outcome": "inconclusive",
        "claim_tier_changed": False,
        "match_changes": 0,
        "calibrated": False,
        "candidate_selected": False,
        "acceptance_rule_created": False,
        "acceptance_holdout_opened": False,
        "method_aggregation": "separate",
        "exact_inputs": {
            "preregistration": _artifact(preregistration_path, repo_root),
            "network": _artifact(network_path, repo_root),
            "observation_package": _artifact(observation_package_path, repo_root),
            "pre_volume_match_audit": _artifact(match_audit_path, repo_root),
            "assignment_blind_diagnosis": _artifact(assignment_blind_path, repo_root),
            "model_output": model_output_artifact,
            "comparison_basis": basis_artifact,
            "existing_assessment": assessment_artifact,
        },
        "assignment_blind_summary": {
            "artifact": _artifact(assignment_blind_path, repo_root),
            "model_output_bytes_read": False,
            "observation": assignment_blind["observation"],
            "matching": {key: value for key, value in assignment_blind["matching"].items() if key != "records"},
        },
        "post_assignment": {"network_loading": dict(loading)},
        "paired_method_comparison": dict(method_comparison),
        "evidence_ledger": ledger,
        "findings": findings,
    }
