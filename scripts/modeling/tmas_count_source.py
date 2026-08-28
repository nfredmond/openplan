#!/usr/bin/env python3
"""FHWA TMAS 2024 station and continuous-count adapter.

The adapter is U.S.-specific and stays behind the observed-count registry. It
downloads the one station archive and all twelve monthly volume archives,
retains the exact zip bytes, hashes every archive and member, and leaves fields
unknown when TMAS does not publish enough evidence to interpret them.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


YEAR = 2024
DATASET_ID = "fhwa:tmas:continuous-volume:2024"
BASE_URL = "https://www.fhwa.dot.gov/policyinformation/tables/tmasdata/2024"
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
ARCHIVE_NAMES = ("2024_station_data.zip",) + tuple(f"{month}_2024_ccs_data.zip" for month in MONTHS)

STATION_REQUIRED_FIELDS = {
    "record_type", "state_code", "station_id", "travel_dir", "travel_lane",
    "year_record", "f_system", "num_lanes", "num_lanes_volume", "method_volume",
    "lrs_id", "lrs_point", "latitude", "longitude", "county_code", "station_location",
}
VOLUME_ID_FIELDS = {
    "record_type", "state_code", "station_id", "travel_dir", "travel_lane",
    "year_record", "month_record", "day_record",
}


class TMASSchemaDriftError(RuntimeError):
    """A published member no longer matches the pinned TMAS field contract."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def archive_url(name: str) -> str:
    if name not in ARCHIVE_NAMES:
        raise ValueError(f"unsupported TMAS archive name: {name}")
    return f"{BASE_URL}/{name}"


def fetch_complete_2024_archives(
    output_dir: Path,
    *,
    opener=urllib.request.urlopen,
    downloaded_at: str | None = None,
) -> dict[str, Any]:
    """Fetch all official 2024 archives atomically and write a hash manifest."""
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = downloaded_at or datetime.now(timezone.utc).isoformat()
    entries: list[dict[str, Any]] = []
    for name in ARCHIVE_NAMES:
        url = archive_url(name)
        with opener(url, timeout=180) as response:
            payload = response.read()
        if not payload.startswith(b"PK"):
            raise RuntimeError(f"TMAS archive {name} is not a zip file")
        digest = sha256_bytes(payload)
        with tempfile.NamedTemporaryFile(dir=output_dir, prefix=f".{name}.", delete=False) as handle:
            handle.write(payload)
            temporary = Path(handle.name)
        target = output_dir / name
        os.replace(temporary, target)
        entries.append({
            "name": name,
            "url": url,
            "sha256": digest,
            "bytes": len(payload),
            "downloaded_at": timestamp,
        })
    manifest = {
        "schema": "openplan.tmas-source-bundle.v1",
        "dataset_id": DATASET_ID,
        "year": YEAR,
        "complete": len(entries) == len(ARCHIVE_NAMES),
        "archives": entries,
    }
    (output_dir / "source-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def _pipe_rows(payload: bytes, required: set[str], member_path: str) -> list[dict[str, str]]:
    text = payload.decode("utf-8-sig", errors="strict")
    reader = csv.DictReader(io.StringIO(text), delimiter="|")
    fields = set(reader.fieldnames or [])
    missing = sorted(required - fields)
    if missing:
        raise TMASSchemaDriftError(f"TMAS member {member_path} omitted required field(s): {missing}")
    return [{str(key): str(value or "") for key, value in row.items() if key is not None} for row in reader]


def archive_members(path: Path, *, kind: str) -> list[dict[str, Any]]:
    """Read source members without extracting or changing their bytes."""
    required = STATION_REQUIRED_FIELDS if kind == "station" else VOLUME_ID_FIELDS
    suffix = ".STA" if kind == "station" else ".VOL"
    result: list[dict[str, Any]] = []
    archive_sha256 = sha256_bytes(path.read_bytes())
    with zipfile.ZipFile(path) as bundle:
        names = sorted(name for name in bundle.namelist() if name.upper().endswith(suffix))
        if not names:
            raise TMASSchemaDriftError(f"TMAS {kind} archive contains no {suffix} members")
        for name in names:
            payload = bundle.read(name)
            rows = _pipe_rows(payload, required, name)
            result.append({
                "archive_path": str(path),
                "archive_sha256": archive_sha256,
                "member_path": name,
                "member_sha256": sha256_bytes(payload),
                "rows": rows,
            })
    return result


def station_key(row: Mapping[str, Any]) -> tuple[str, str, str, str]:
    def normalized(field: str) -> str:
        value = str(row.get(field) or "").strip()
        if field in {"state_code", "travel_dir", "travel_lane"}:
            try:
                return str(int(value))
            except ValueError:
                return value
        return value

    return tuple(normalized(field) for field in ("state_code", "station_id", "travel_dir", "travel_lane"))  # type: ignore[return-value]


def _numeric(value: Any, scale: float = 1.0) -> float | None:
    try:
        return float(str(value).strip()) / scale
    except (TypeError, ValueError):
        return None


def _hour_fields(row: Mapping[str, Any]) -> list[str]:
    candidates = []
    for key in row:
        normalized = key.lower().replace("traffic_volume_counted_", "hour_").replace("volume_", "hour_")
        if normalized.startswith("hour_") and normalized[-2:].isdigit():
            candidates.append(key)
    return sorted(candidates, key=lambda key: int(key[-2:]))


def complete_daily_volume(row: Mapping[str, Any]) -> float | None:
    fields = _hour_fields(row)
    if len(fields) != 24:
        raise TMASSchemaDriftError("TMAS volume record does not expose exactly 24 hourly fields")
    values = [_numeric(row.get(field)) for field in fields]
    if any(value is None for value in values):
        return None
    return sum(value for value in values if value is not None)


def _unknown_match() -> dict[str, Any]:
    return {
        "status": "unresolved",
        "frozen_at": "unknown",
        "frozen_before_model_volume": "unknown",
        "geometry": "unknown",
        "route": "unknown",
        "direction": "unknown",
        "facility": "unknown",
        "candidate_link_ids": "unknown",
        "selected_link_id": "unknown",
        "reason": "Network match has not been frozen.",
    }


def build_monthly_observations(
    station_archive: Path,
    volume_archive: Path,
    *,
    downloaded_at: str,
    state_codes: set[str] | None = None,
    county_codes: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Normalize one monthly archive without manufacturing precision bounds."""
    station_members = archive_members(station_archive, kind="station")
    volume_members = archive_members(volume_archive, kind="volume")
    selected_states = {str(value).zfill(2) for value in (state_codes or set())}
    selected_counties = {str(value).zfill(3) for value in (county_codes or set())}
    all_station_keys: set[tuple[str, str, str, str]] = set()
    stations: dict[tuple[str, str, str, str], tuple[dict[str, str], dict[str, Any]]] = {}
    for member in station_members:
        for row in member["rows"]:
            key = station_key(row)
            all_station_keys.add(key)
            state = str(row.get("state_code") or "").zfill(2)
            county = str(row.get("county_code") or "").zfill(3)
            if selected_states and state not in selected_states:
                continue
            if selected_counties and county not in selected_counties:
                continue
            stations[key] = (row, member)

    days: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    volume_sources: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for member in volume_members:
        for row in member["rows"]:
            key = station_key(row)
            state = str(row.get("state_code") or "").zfill(2)
            if selected_states and state not in selected_states:
                continue
            if (selected_states or selected_counties) and key not in stations:
                # A complete national monthly archive can contain a volume row
                # with no station-description row. It cannot be assigned to the
                # selected polygon, so a filtered package retains the exact
                # source bytes but does not invent its county or coordinate.
                continue
            daily = complete_daily_volume(row)
            if daily is not None:
                days[key].append(daily)
                volume_sources[key] = member

    observations: list[dict[str, Any]] = []
    for key, daily_values in sorted(days.items()):
        station_entry = stations.get(key)
        if station_entry is None:
            raise TMASSchemaDriftError(f"TMAS volume station code {key} has no station-description record")
        station, _station_source = station_entry
        volume_source = volume_sources[key]
        center = sum(daily_values) / len(daily_values)
        latitude = _numeric(station.get("latitude"), 1_000_000.0)
        longitude_raw = _numeric(station.get("longitude"), 1_000_000.0)
        # The station record does not carry a hemisphere field. Preserve its raw
        # coordinate instead of applying a country-wide sign assumption.
        geometry = {
            "type": "source_coordinate",
            "latitude": latitude if latitude is not None else "unknown",
            "longitude_magnitude": longitude_raw if longitude_raw is not None else "unknown",
            "longitude_hemisphere": "unknown",
            "crs": "unknown",
        }
        source_url = archive_url(volume_archive.name)
        observation_id = "tmas:" + ":".join(key) + f":{volume_archive.stem}"
        observations.append({
            "schema": "openplan.observed-traffic-observation.v1",
            "observation_id": observation_id,
            "source": {
                "dataset_id": DATASET_ID,
                "publisher": "Federal Highway Administration",
                "source_url": source_url,
                "downloaded_at": downloaded_at,
                "artifact_sha256": volume_source["archive_sha256"],
                "member_path": volume_source["member_path"],
                "member_sha256": volume_source["member_sha256"],
            },
            "route_lrs": {
                "lrs_id": station.get("lrs_id") or "unknown",
                "lrs_point": _numeric(station.get("lrs_point")) if station.get("lrs_point", "").strip() else "unknown",
                "station_location": station.get("station_location") or "unknown",
                "source_geography": {
                    "state_code": station.get("state_code") or "unknown",
                    "county_code": station.get("county_code") or "unknown",
                },
            },
            "geometry": geometry,
            "direction_lane_carriageway": {
                "basis": "source_direction_and_lane",
                "direction": station.get("travel_dir") or "unknown",
                "lane": station.get("travel_lane") or "unknown",
                "carriageway": "unknown",
            },
            "vehicle_basis": {
                "unit": "vehicles",
                "vehicle_definition": "TMAS reported traffic volume",
                "conversion": "unknown",
            },
            "time_basis": {
                "year": YEAR,
                "start_date": "unknown",
                "end_date": "unknown",
                "day_basis": "available_complete_days_in_month",
                "observation_period": {"label": "daily", "hours": list(range(24))},
                "frozen_year_adjustment": "unknown",
            },
            "measurement": {
                "method": "source_derived",
                "duration": {"start": "unknown", "end": "unknown", "complete_hours": len(daily_values) * 24},
                "factors": "unknown",
            },
            "qa": {
                "status": "accepted",
                "flags": ["complete_days_only"],
                "source_fields": {
                    "method_volume": station.get("method_volume") or "unknown",
                    "sample_type_volume": station.get("sample_type_volume") or "unknown",
                    "complete_days": len(daily_values),
                },
            },
            "estimate": {"center": center, "source_supported_bounds": "unknown"},
            "evidence_grade": "B",
            "match_audit": _unknown_match(),
            "duplicate_lineage": {
                "lineage_id": "tmas:" + ":".join(key),
                "canonical_observation_id": observation_id,
                "duplicate_of": "unknown",
                "resolution": "unique TMAS station-direction-lane and month",
            },
        })
    return observations


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch and normalize the complete FHWA TMAS 2024 continuous-count release.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--fetch", action="store_true", help="Download all thirteen official archives before normalizing.")
    args = parser.parse_args()
    output_dir = Path(args.output_dir)
    if args.fetch:
        manifest = fetch_complete_2024_archives(output_dir)
    else:
        manifest = json.loads((output_dir / "source-manifest.json").read_text())
    downloaded_at = manifest["archives"][0]["downloaded_at"]
    observations: list[dict[str, Any]] = []
    for month in MONTHS:
        observations.extend(build_monthly_observations(
            output_dir / "2024_station_data.zip",
            output_dir / f"{month}_2024_ccs_data.zip",
            downloaded_at=downloaded_at,
        ))
    payload = {
        "schema": "openplan.observed-traffic-input-bundle.v1",
        "source_manifest": manifest,
        "observations": observations,
    }
    (output_dir / "observed-traffic-observations.json").write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {len(observations)} TMAS observations")


if __name__ == "__main__":
    main()
