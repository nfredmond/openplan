#!/usr/bin/env python3
"""Fetch published traffic counts for a study area, without anyone typing a path.

============================================================== WHY THIS EXISTS

Until now a run could be compared against real traffic counts only by someone
who knew to build a count set at a command line. So no run a planner could
produce had an accuracy figure at all — not a bad one, none. The figures went
into decisions with nothing said about how close to reality they were, because
the thing that would have said it required an operator step.

State DOTs publish this data free and without a key. The study area's own
boundary says which state it is in. There is nothing for a planner to supply.

======================================================= WHAT IT WILL NOT PRETEND

Four state DOT feeds are registered and preferred because they are usually more
current and locally descriptive. Every other U.S. state uses FHWA HPMS as the
nationwide floor. A multi-state area selects a publisher per source state and
never merges a DOT row with HPMS into one apparent observation.
"""
from __future__ import annotations

import subprocess
import sys
import csv
import json
import math
from pathlib import Path
from typing import Any

from shapely.geometry import Point, shape
from shapely.ops import unary_union

SCRIPT_DIR = Path(__file__).resolve().parent
WORKER_DIR = SCRIPT_DIR.parents[1] / "workers" / "aequilibrae_worker"
for candidate in (SCRIPT_DIR, WORKER_DIR):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

import count_sources  # noqa: E402
from lodes import STATE_FIPS_TO_ABBR  # noqa: E402


class CountsUnavailable(RuntimeError):
    """No count set can be built here, with the reason a planner should read."""


def registered_regions() -> list[str]:
    return sorted(count_sources.COUNT_SOURCES)


def region_for_state_fips(state_fips_codes: set[str]) -> str:
    """The DOT whose counts apply to this study area.

    Refuses a multi-state area rather than choosing. Every count row is stamped
    with the agency that published it, and an area straddling a state line has
    no single answer — attributing one state's counts to another is a citation
    that cannot be checked and would not be caught downstream.
    """
    if not state_fips_codes:
        raise CountsUnavailable("The study area did not record which state it is in.")
    if len(state_fips_codes) > 1:
        names = ", ".join(sorted((STATE_FIPS_TO_ABBR.get(f) or f).upper() for f in state_fips_codes))
        raise CountsUnavailable(
            f"This study area spans more than one state ({names}). Published count sets are "
            "per-state, and attributing one state's counts to another would be a citation nobody "
            "could check, so no automatic comparison is made here."
        )

    fips = next(iter(state_fips_codes))
    # Upper-cased on the way out. The worker's map yields lowercase ("ca") and
    # the count registry is keyed uppercase ("CA"), so the two look identical in
    # a log and match nothing — a mismatch that has already cost one debugging
    # round on the command line.
    region = (STATE_FIPS_TO_ABBR.get(fips) or "").upper() or None
    if not region:
        raise CountsUnavailable(f"No state is recorded for FIPS {fips}.")
    if region not in count_sources.COUNT_SOURCES:
        raise CountsUnavailable(
            f"No published traffic-count feed is registered for {region} yet. "
            f"Registered today: {', '.join(registered_regions())}. This run has no accuracy "
            "figure — not a poor one, none — and says so rather than leaving it to be assumed."
        )
    return region


def preferred_sources_for_state_fips(state_fips_codes: set[str]) -> dict[str, set[str]]:
    """The preferred count publisher for each state in a U.S. study area.

    A registered state feed wins for its own rows. States without one use the
    national HPMS adapter. Returning the state membership with each source is
    what lets a multi-state run query HPMS once and then retain only the states
    for which it is the fallback, rather than blending duplicate state and
    federal representations into one apparent count set.
    """
    if not state_fips_codes:
        raise CountsUnavailable("The study area did not record which state it is in.")
    selected: dict[str, set[str]] = {}
    for fips in sorted(str(code).zfill(2) for code in state_fips_codes):
        region = (STATE_FIPS_TO_ABBR.get(fips) or "").upper()
        if not region:
            raise CountsUnavailable(f"No U.S. state or territory is recorded for FIPS {fips}.")
        source = region if region in count_sources.COUNT_SOURCES else count_sources.HPMS_SOURCE_ID
        selected.setdefault(source, set()).add(fips)
    return selected


def _run_count_builder(
    *,
    source: str,
    boundary_geojson_path: Path | None,
    project_db: Path,
    output_csv: Path,
    bbox: tuple[float, float, float, float],
    python_bin: str,
    count_source_cache_dir: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    command = [
        python_bin,
        str(SCRIPT_DIR / "build_expanded_aadt_counts.py"),
        f"--fetch-bbox={','.join(f'{value:.5f}' for value in bbox)}",
        "--region",
        source,
        "--db",
        str(project_db),
        "--out",
        str(output_csv),
    ]
    if boundary_geojson_path is not None:
        command.extend(["--boundary-geojson", str(boundary_geojson_path)])
    if count_source_cache_dir is not None:
        command.extend(["--count-source-cache-dir", str(count_source_cache_dir)])
    return subprocess.run(command, capture_output=True, text=True)


def buffer_bbox_miles(
    bbox: tuple[float, float, float, float], miles: float
) -> tuple[float, float, float, float]:
    """Expand WGS84 query bounds by distance without a place-specific degree guess."""
    min_lon, min_lat, max_lon, max_lat = (float(value) for value in bbox)
    mid_lat = (min_lat + max_lat) / 2.0
    lat_delta = miles / 69.0
    lon_delta = miles / max(69.172 * abs(math.cos(math.radians(mid_lat))), 0.01)

    def wrap(longitude: float) -> float:
        return ((longitude + 180.0) % 360.0) - 180.0

    return (
        wrap(min_lon - lon_delta),
        max(-90.0, min_lat - lat_delta),
        wrap(max_lon + lon_delta),
        min(90.0, max_lat + lat_delta),
    )


def _boundary_geometry(boundary_geojson_path: Path):
    payload = json.loads(Path(boundary_geojson_path).read_text())
    if payload.get("type") == "FeatureCollection":
        geometries = [
            shape(feature["geometry"])
            for feature in payload.get("features", [])
            if feature.get("geometry")
        ]
        if not geometries:
            raise CountsUnavailable("The study-area boundary contains no geometry.")
        return unary_union(geometries)
    if payload.get("type") == "Feature":
        return shape(payload["geometry"])
    return shape(payload)


def _rows_inside_boundary(
    rows: list[dict[str, str]], boundary_geojson_path: Path
) -> list[dict[str, str]]:
    """Derive the validation set from the wider gateway evidence fetch.

    Count rows store a small matching box around their source midpoint. The
    midpoint is the same point the count builder used for boundary clipping,
    so filtering the already-crosswalked wide result is equivalent to running
    the expensive road-name crosswalk a second time inside the boundary.
    """
    boundary = _boundary_geometry(boundary_geojson_path)
    inside: list[dict[str, str]] = []
    for row in rows:
        try:
            longitude = (float(row["bbox_min_lon"]) + float(row["bbox_max_lon"])) / 2.0
            latitude = (float(row["bbox_min_lat"]) + float(row["bbox_max_lat"])) / 2.0
        except (KeyError, TypeError, ValueError) as exc:
            raise CountsUnavailable(
                "A normalized count row lacks the midpoint bounds needed to prove it lies "
                "inside the study area. The count-source schema may have drifted."
            ) from exc
        if boundary.covers(Point(longitude, latitude)):
            inside.append(row)
    return inside


def split_counts_for_calibration(counts_csv: Path, fit_csv: Path, holdout_csv: Path) -> dict[str, Any]:
    """Split a count set so the model is never graded on what it was fitted to.

    THE WHOLE POINT. Calibrating on a set of counts and then validating against
    the same set reports the accuracy of the data the model was fitted to. It
    looks like diligence and means nothing, and `run_screening_model` refuses
    the combination outright — this is how a run gets both honestly: fit on one
    portion, and let the GATE be decided by stations the model never saw.

    Uses the shared engine's own stratified, seed-deterministic split, so the
    stations held back here are the same ones the calibration holds back
    internally. Two different splits would mean the gate's "held out" and the
    calibration's "held out" were different sets, and neither claim would mean
    what it said.
    """
    import csv as csv_module

    import calibration

    with counts_csv.open(newline="") as handle:
        rows = list(csv_module.DictReader(handle))
        fieldnames = list(rows[0].keys()) if rows else []

    if len(rows) < 2:
        raise CountsUnavailable(
            f"Only {len(rows)} count station was found inside this study area. Splitting it would "
            "leave nothing to grade the model on, so calibration is not attempted here."
        )

    fit_rows, holdout_rows = calibration.split_holdout(rows)
    if not holdout_rows or not fit_rows:
        raise CountsUnavailable(
            "The count set could not be split into a fit and a held-back portion, so a calibrated "
            "run could not be graded on stations it never saw."
        )

    for path, subset in ((fit_csv, fit_rows), (holdout_csv, holdout_rows)):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="") as handle:
            writer = csv_module.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(subset)

    return {
        "fit_csv": str(fit_csv),
        "holdout_csv": str(holdout_csv),
        "fit_station_count": len(fit_rows),
        "holdout_station_count": len(holdout_rows),
        "split": (
            f"{len(fit_rows)} stations used to fit the model and {len(holdout_rows)} held back to "
            "grade it. The accuracy this run reports is measured only on the held-back stations."
        ),
    }


def fetch_counts_for_study_area(
    *,
    state_fips_codes: set[str],
    boundary_geojson_path: Path,
    project_db: Path,
    output_csv: Path,
    bbox: tuple[float, float, float, float],
    python_bin: str | None = None,
    count_source_cache_dir: Path | None = None,
) -> dict[str, Any]:
    """Build a boundary-clipped preferred count set for this study area, or say why not.

    Shells out to `build_expanded_aadt_counts.py` rather than importing it: that
    script owns the fetch, the normalisation, the boundary clip and the station
    crosswalk, and a second in-process path through the same work is how the two
    drift apart.
    """
    sources = preferred_sources_for_state_fips(state_fips_codes)
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    source_rows: list[dict[str, str]] = []
    gateway_rows: list[dict[str, str]] = []
    fieldnames: list[str] = []
    source_outputs: list[dict[str, Any]] = []
    gateway_output_csv = output_csv.with_name(f"{output_csv.stem}.gateway{output_csv.suffix}")
    gateway_bbox = buffer_bbox_miles(bbox, 3.0)
    for index, (source, source_states) in enumerate(sorted(sources.items())):
        gateway_source_csv = (
            gateway_output_csv
            if len(sources) == 1
            else gateway_output_csv.with_name(
                f"{gateway_output_csv.stem}.{index:02d}-{source}{gateway_output_csv.suffix}"
            )
        )
        gateway_completed = _run_count_builder(
            source=source,
            boundary_geojson_path=None,
            project_db=project_db,
            output_csv=gateway_source_csv,
            bbox=gateway_bbox,
            python_bin=python_bin or sys.executable,
            count_source_cache_dir=count_source_cache_dir,
        )
        if gateway_completed.returncode != 0 or not gateway_source_csv.exists():
            raise CountsUnavailable(
                f"The {source} count feed could not build the boundary-crossing evidence set: "
                f"{(gateway_completed.stderr or gateway_completed.stdout or '').strip()[:400] or 'no output'}"
            )
        with gateway_source_csv.open(newline="") as handle:
            reader = csv.DictReader(handle)
            if not fieldnames:
                fieldnames = list(reader.fieldnames or [])
            gateway_source_rows = list(reader)
        if source == count_sources.HPMS_SOURCE_ID and len(sources) > 1:
            gateway_source_rows = [
                row
                for row in gateway_source_rows
                if str(row.get("source_state") or "").zfill(2) in source_states
            ]
        gateway_rows.extend(gateway_source_rows)
        rows = _rows_inside_boundary(gateway_source_rows, boundary_geojson_path)
        source_rows.extend(rows)
        source_outputs.append(
            {
                "source": source,
                "states": sorted(source_states),
                "stations": len(rows),
                "gateway_evidence_sections": len(gateway_source_rows),
                "provenance": count_sources.source_provenance(source),
            }
        )

    # Always materialize both artifacts. With one source the builder already
    # wrote the wide gateway file; the validation file is the boundary subset.
    # With several sources both files are source-precedence merges.
    with output_csv.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(source_rows)
    if len(sources) > 1:
        with gateway_output_csv.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(gateway_rows)

    station_count = len(source_rows)
    if station_count == 0:
        raise CountsUnavailable(
            "The preferred observed-count sources returned no eligible sections inside this study area. "
            "Published section coverage is incomplete on the lowest road classes; this is not a "
            "zero-traffic finding or a modelling failure."
        )

    return {
        "region": next(iter(sources)) if len(sources) == 1 else "multi-source",
        "sources": source_outputs,
        "counts_csv": str(output_csv),
        "gateway_counts_csv": str(gateway_output_csv),
        "station_count": station_count,
        "provenance": (
            source_outputs[0]["provenance"]
            if len(source_outputs) == 1
            else {
                "selection": "registered state publisher per state, otherwise nationwide HPMS fallback",
                "sources": source_outputs,
            }
        ),
    }
