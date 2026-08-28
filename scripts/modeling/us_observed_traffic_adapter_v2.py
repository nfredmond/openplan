#!/usr/bin/env python3
"""United States adapters for the v2 observed-traffic contract.

TMAS station, direction, lane, and year records become one series with every
raw day retained as a separately hashed measurement. HPMS sections keep their
route/LRS attributes and complete LineString or MultiLineString geometry.
Country-specific codes and coordinate sign rules stop here; the matcher only
sees country-neutral observations.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any, Mapping, Sequence

import tmas_count_source


OBSERVATION_SCHEMA = "openplan.observed-traffic-observation.v2"
UNKNOWN = "unknown"
TMAS_DIRECTION_CODES = {
    "1": "north", "2": "northeast", "3": "east", "4": "southeast",
    "5": "south", "6": "southwest", "7": "west", "8": "northwest",
    "9": "north_south_combined", "0": "east_west_combined",
}
TMAS_EASTERN_HEMISPHERE_CODES = {"66", "69"}  # Guam and Northern Mariana Islands.
TMAS_WESTERN_HEMISPHERE_CODES = {
    *(str(value).zfill(2) for value in range(1, 79)),
    *(str(value) for value in range(81, 95)),
}
HPMS_FACILITY_CLASSES = {
    "1": "interstate",
    "2": "principal_arterial_freeway_expressway",
    "3": "principal_arterial_other",
    "4": "minor_arterial",
    "5": "major_collector",
    "6": "minor_collector",
    "7": "local",
}
HPMS_FACILITY_TYPES = {
    "1": "one_way",
    "2": "two_way",
    "4": "ramp",
    "5": "non_mainline",
    "6": "non_inventory_direction",
    "7": "planned_unbuilt",
}
HPMS_EXCLUSIONS = {
    "4": "ramp_not_represented_by_retained_network",
    "5": "non_mainline_not_represented_by_retained_network",
    "6": "non_inventory_direction",
    "7": "planned_or_unbuilt_facility",
}


class AdapterError(RuntimeError):
    """Exact source bytes cannot satisfy the country adapter contract."""


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float | None:
    try:
        result = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _source_year(value: Any, fallback: int) -> int:
    text = _text(value)
    if len(text) == 2 and text.isdigit():
        return 2000 + int(text)
    if len(text) == 4 and text.isdigit():
        return int(text)
    return fallback


def decode_tmas_wgs84(station: Mapping[str, Any]) -> list[float] | str:
    """Decode a TMAS station coordinate inside the U.S. adapter.

    The 2022 guide defines signed decimal WGS84 coordinates. The preserved
    2024 station release uses millionths and omits the minus sign for western
    records, so the sign comes from the reporting jurisdiction here, never in
    the country-neutral contract. Ambiguous or implausible coordinates remain
    unavailable.
    """
    latitude = _number(station.get("latitude"))
    longitude = _number(station.get("longitude"))
    if latitude is None or longitude is None:
        return UNKNOWN
    if abs(latitude) > 90:
        latitude /= 1_000_000.0
    if abs(longitude) > 180:
        longitude /= 1_000_000.0
    code = _text(station.get("state_code")).zfill(2)
    if longitude >= 0:
        if code in TMAS_EASTERN_HEMISPHERE_CODES:
            pass
        elif code in TMAS_WESTERN_HEMISPHERE_CODES:
            longitude = -longitude
        else:
            return UNKNOWN
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return UNKNOWN
    return [longitude, latitude]


def _lane_label(code: str) -> str:
    if code == "0":
        return "lanes_combined"
    if code == "1":
        return "outside_lane"
    if code.isdigit() and 2 <= int(code) <= 9:
        return f"lane_{int(code)}"
    return UNKNOWN


def _tmas_station_rows(path: Path) -> dict[tuple[str, str, str, str], tuple[dict[str, Any], dict[str, Any]]]:
    stations: dict[tuple[str, str, str, str], tuple[dict[str, Any], dict[str, Any]]] = {}
    for member in tmas_count_source.archive_members(path, kind="station"):
        for row in member["rows"]:
            stations[tmas_count_source.station_key(row)] = (row, member)
    return stations


def build_tmas_series(
    station_archive: Path,
    volume_archives: Sequence[Path],
    *,
    downloaded_at: str,
    state_codes: set[str],
    county_codes: set[str],
) -> list[dict[str, Any]]:
    """Build stable station series while retaining every published daily row."""
    stations = _tmas_station_rows(station_archive)
    selected_states = {str(value).zfill(2) for value in state_codes}
    selected_counties = {str(value).zfill(3) for value in county_codes}
    measurements: dict[tuple[str, str, str, str, int], list[dict[str, Any]]] = defaultdict(list)
    sources: dict[tuple[str, str, str, str, int], dict[str, Any]] = {}

    for archive in volume_archives:
        for member in tmas_count_source.archive_members(archive, kind="volume"):
            for row in member["rows"]:
                key = tmas_count_source.station_key(row)
                station_entry = stations.get(key)
                if station_entry is None:
                    continue
                station, station_member = station_entry
                state = _text(station.get("state_code")).zfill(2)
                county = _text(station.get("county_code")).zfill(3)
                if selected_states and state not in selected_states:
                    continue
                if selected_counties and county not in selected_counties:
                    continue
                year = _source_year(row.get("year_record"), tmas_count_source.YEAR)
                month = int(_text(row.get("month_record")) or 0)
                day = int(_text(row.get("day_record")) or 0)
                try:
                    measured_on = date(year, month, day)
                except ValueError:
                    raise AdapterError(f"TMAS record has an invalid date: {year}-{month}-{day}")
                hour_fields = tmas_count_source._hour_fields(row)
                if len(hour_fields) != 24:
                    raise AdapterError("TMAS daily record does not contain exactly 24 hourly fields")
                hourly = [_number(row.get(field)) for field in hour_fields]
                complete = all(value is not None for value in hourly)
                daily_value = sum(value for value in hourly if value is not None) if complete else UNKNOWN
                record_sha = sha256_bytes(canonical_bytes(row))
                series_key = (*key, year)
                measurements[series_key].append({
                    "measurement_id": f"tmas:{':'.join(key)}:{measured_on.isoformat()}",
                    "source_member_path": member["member_path"],
                    "source_member_sha256": member["member_sha256"],
                    "source_artifact_sha256": member["archive_sha256"],
                    "period": {
                        "start": measured_on.isoformat(),
                        "end": measured_on.isoformat(),
                        "label": "complete_day" if complete else "incomplete_day",
                    },
                    "value": daily_value,
                    "unit": "vehicles",
                    "complete": complete,
                    "raw_hourly_values": [value if value is not None else UNKNOWN for value in hourly],
                    "exact_record_sha256": record_sha,
                })
                sources[series_key] = {
                    "station": station,
                    "station_member": station_member,
                    "volume_archive": archive,
                }

    result: list[dict[str, Any]] = []
    for series_key, rows in sorted(measurements.items()):
        state, station_id, direction_code, lane_code, year = series_key
        source = sources[series_key]
        station = source["station"]
        station_member = source["station_member"]
        complete_values = [float(item["value"]) for item in rows if item["complete"]]
        site_id = f"tmas:{state}:{station_id}"
        series_id = f"{site_id}:{direction_code}:{lane_code}:{year}"
        direction = TMAS_DIRECTION_CODES.get(direction_code, UNKNOWN)
        combined = direction_code in {"0", "9"}
        result.append({
            "schema": OBSERVATION_SCHEMA,
            "observation_id": series_id,
            "site_id": site_id,
            "series_id": series_id,
            "source_kind": "point",
            "observation_status": "eligible" if complete_values else "excluded",
            "status_reason": "complete daily measurements available" if complete_values else "no complete daily measurement",
            "source": {
                "dataset_id": "fhwa:tmas:continuous-volume:2024",
                "publisher": "Federal Highway Administration",
                "source_url": tmas_count_source.BASE_URL,
                "downloaded_at": downloaded_at,
                "station_member_path": station_member["member_path"],
                "station_member_sha256": station_member["member_sha256"],
                "station_archive_sha256": station_member["archive_sha256"],
            },
            "geography": {"country": "US", "subdivision": state, "county": _text(station.get("county_code")).zfill(3)},
            "route_lrs": {
                "route_id": _text(station.get("lrs_id")) or UNKNOWN,
                "begin": _number(station.get("lrs_point")) if _text(station.get("lrs_point")) else UNKNOWN,
                "end": UNKNOWN,
                "route_number": _text(station.get("posted_signed_route")) or UNKNOWN,
                "route_signing": _text(station.get("posted_route_signing")) or UNKNOWN,
                "route_name": _text(station.get("station_location")) or UNKNOWN,
            },
            "geometry": {"type": "Point", "coordinates": decode_tmas_wgs84(station), "crs": "EPSG:4326"},
            "direction_lane_carriageway": {
                "basis": "combined_directions" if combined else "one_direction",
                "direction": direction,
                "raw_direction_code": direction_code,
                "lane": _lane_label(lane_code),
                "raw_lane_code": lane_code,
                "carriageway": UNKNOWN,
            },
            "facility": {
                "class": _text(station.get("f_system")) or UNKNOWN,
                "lanes_in_direction": int(_text(station.get("num_lanes"))) if _text(station.get("num_lanes")).isdigit() else UNKNOWN,
            },
            "vehicle_basis": {"unit": "vehicles", "definition": "TMAS motorized traffic volume"},
            "time_basis": {"year": year, "day_basis": "published_daily_records", "period": "daily"},
            "measurements": sorted(rows, key=lambda item: item["period"]["start"]),
            "estimate": {
                "center": sum(complete_values) / len(complete_values) if complete_values else UNKNOWN,
                "statistic": "mean_of_published_complete_days",
                "source_supported_bounds": UNKNOWN,
            },
            "evidence_grade": "B" if complete_values else "D",
            "duplicate_lineage": {
                "lineage_id": series_id,
                "canonical_observation_id": series_id,
                "duplicate_of": UNKNOWN,
                "resolution": "stable station-direction-lane-year series",
            },
        })
    return result


def _hpms_section_id(properties: Mapping[str, Any], year: int) -> str:
    fields = (
        _text(properties.get("stateid")).zfill(2),
        _text(properties.get("route_id")),
        _text(properties.get("begin_point")),
        _text(properties.get("end_point")),
        _text(properties.get("shapeid")),
    )
    return f"hpms:{year}:" + ":".join(fields)


def build_hpms_series(
    response_path: Path,
    *,
    source_url: str,
    downloaded_at: str,
) -> list[dict[str, Any]]:
    """Normalize captured HPMS GeoJSON without replacing sections by points."""
    payload = json.loads(response_path.read_text())
    features = payload.get("features") if isinstance(payload, Mapping) else None
    if not isinstance(features, list):
        raise AdapterError("HPMS captured response is not a GeoJSON FeatureCollection")
    artifact_sha = hashlib.sha256(response_path.read_bytes()).hexdigest()
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for feature in features:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in {"LineString", "MultiLineString"}:
            raise AdapterError("HPMS section omitted full LineString or MultiLineString geometry")
        year = _source_year(properties.get("year_record"), 0)
        site_id = _hpms_section_id(properties, year)
        series_id = f"{site_id}:aadt"
        value = _number(properties.get("aadt"))
        facility_type = _text(properties.get("facility_type"))
        facility_class = _text(properties.get("f_system"))
        reason = None
        if str(properties.get("is_restricted")).lower() in {"true", "1", "yes"}:
            reason = "public_travel_restricted"
        elif facility_type in HPMS_EXCLUSIONS:
            reason = HPMS_EXCLUSIONS[facility_type]
        elif facility_class not in HPMS_FACILITY_CLASSES:
            reason = "facility_class_unavailable"
        elif value is None:
            reason = "aadt_unavailable_for_section"
        elif value < 0:
            reason = "negative_observation_retained_but_excluded"
        if site_id in seen:
            reason = "duplicate_source_section"
        seen.add(site_id)
        exact_record_sha = sha256_bytes(canonical_bytes(feature))
        measurement_date = _text(properties.get("aadt_d")) or UNKNOWN
        result.append({
            "schema": OBSERVATION_SCHEMA,
            "observation_id": series_id,
            "site_id": site_id,
            "series_id": series_id,
            "source_kind": "section",
            "observation_status": "excluded" if reason else "eligible",
            "status_reason": reason or "published HPMS AADT section",
            "source": {
                "dataset_id": "42um-tgh5",
                "publisher": "Federal Highway Administration",
                "source_url": source_url,
                "downloaded_at": downloaded_at,
                "artifact_sha256": artifact_sha,
                "member_path": "captured GeoJSON feature",
                "member_sha256": exact_record_sha,
            },
            "geography": {
                "country": "US",
                "subdivision": _text(properties.get("stateid")).zfill(2),
                "county": _text(properties.get("county_id")).zfill(3) if _text(properties.get("county_id")) else UNKNOWN,
            },
            "route_lrs": {
                "route_id": _text(properties.get("route_id")) or UNKNOWN,
                "begin": _text(properties.get("begin_point")) or UNKNOWN,
                "end": _text(properties.get("end_point")) or UNKNOWN,
                "route_number": _text(properties.get("route_number")) or UNKNOWN,
                "route_signing": _text(properties.get("route_signing")) or UNKNOWN,
                "route_name": _text(properties.get("routename")) or UNKNOWN,
            },
            "geometry": {**geometry, "crs": "EPSG:4326"},
            "direction_lane_carriageway": {
                "basis": "one_direction" if facility_type == "1" else "both_directions",
                "direction": "inventory_direction" if facility_type == "1" else "combined",
                "raw_direction_code": facility_type,
                "lane": "all_lanes",
                "raw_lane_code": UNKNOWN,
                "carriageway": HPMS_FACILITY_TYPES.get(facility_type, UNKNOWN),
            },
            "facility": {"class": HPMS_FACILITY_CLASSES.get(facility_class, UNKNOWN), "raw_class_code": facility_class},
            "vehicle_basis": {"unit": "vehicles", "definition": "annual average daily traffic"},
            "time_basis": {"year": year, "day_basis": "annual_average_daily_traffic", "period": "daily"},
            "measurements": [{
                "measurement_id": f"{series_id}:{measurement_date}",
                "source_member_path": "captured GeoJSON feature",
                "source_member_sha256": exact_record_sha,
                "source_artifact_sha256": artifact_sha,
                "period": {"start": measurement_date, "end": measurement_date, "label": "annual_average_daily_traffic"},
                "value": value if value is not None else UNKNOWN,
                "unit": "vehicles",
                "complete": value is not None,
                "exact_record_sha256": exact_record_sha,
            }],
            "estimate": {"center": value if value is not None else UNKNOWN, "statistic": "published_aadt", "source_supported_bounds": UNKNOWN},
            "evidence_grade": "C" if value is not None and not reason else "D",
            "duplicate_lineage": {
                "lineage_id": site_id,
                "canonical_observation_id": series_id,
                "duplicate_of": site_id if reason == "duplicate_source_section" else UNKNOWN,
                "resolution": reason if reason == "duplicate_source_section" else "unique HPMS route/LRS section/year",
            },
        })
    return result
