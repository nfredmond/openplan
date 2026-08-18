#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from screening_metrics import (
    accuracy_by_road_class,
    geh_summary,
    percent_rmse,
    road_class_accuracy_note,
)


DEFAULT_READY_MEDIAN_APE = 30.0
DEFAULT_READY_CRITICAL_APE = 50.0
DEFAULT_REQUIRED_MATCHES = 3
VOLUME_FIELD_CANDIDATES = ["PCE_tot", "demand_tot", "volume", "loaded_volume"]
DEFAULT_SPATIALITE_PATHS = [
    os.getenv("SPATIALITE_LIBRARY_PATH", ""),
    "/home/linuxbrew/.linuxbrew/lib/mod_spatialite.so",
    "/home/linuxbrew/.linuxbrew/lib/mod_spatialite",
    "/usr/lib/x86_64-linux-gnu/mod_spatialite.so",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a screening-grade assignment bundle against observed counts using a data-driven station crosswalk."
    )
    parser.add_argument(
        "--run-output-dir",
        required=True,
        help="Directory containing link_volumes.csv, evidence_packet.json, and loaded/top_loaded GeoJSON",
    )
    parser.add_argument(
        "--counts-csv",
        required=True,
        help="CSV of observed count stations with candidate model names and bounding boxes",
    )
    parser.add_argument(
        "--output-dir",
        help="Optional output directory. Defaults to <run-output-dir>/validation_bundle",
    )
    parser.add_argument(
        "--volume-field",
        help="Optional link volume column override. Defaults to auto-detect from common names.",
    )
    parser.add_argument(
        "--project-db",
        help="Optional AequilibraE project_database.sqlite path for full-link lookup when the GeoJSON sample is incomplete.",
    )
    parser.add_argument(
        "--ready-median-ape",
        type=float,
        default=DEFAULT_READY_MEDIAN_APE,
        help="Median absolute percent error threshold for bounded screening-ready (default: 30)",
    )
    parser.add_argument(
        "--ready-critical-ape",
        type=float,
        default=DEFAULT_READY_CRITICAL_APE,
        help="Maximum critical absolute percent error threshold for bounded screening-ready (default: 50)",
    )
    parser.add_argument(
        "--required-matches",
        type=int,
        default=DEFAULT_REQUIRED_MATCHES,
        help="Minimum number of matched stations required for a bounded screening-ready decision (default: 3)",
    )
    return parser.parse_args()


def resolve_shared_links(results: list[dict[str, Any]], *, consistency_ratio: float | None = None) -> dict[str, Any]:
    """Decide what to do when several count stations match the SAME model link.

    ================================================== WHY THIS IS NOT COSMETIC

    The model holds one volume for a link. Two stations matched to it are two
    observations of that one number, so the comparison is being made twice —
    and if they disagree, at most one of them can belong there.

    Measured 2026-08-17 across the 24 study counties, after ramp counts were
    already excluded: **33% of matched stations sit on a link shared with
    another station**, across 404 links, and only 166 of those groups have
    counts that agree with each other. The worst pair is 2 vehicles a day and
    33,723 on the same link; another is 27 against 38,243. A count of two
    vehicles is not a mainline observation, and grading a modelled 72,220
    against it manufactures an error of three million percent.

    ==================================================== WHAT IT DOES, AND WHY

    - **Stations that agree with each other** are collapsed to a single
      comparison at their median. They are measuring one road; counting them
      twice weights that link twice for no reason.
    - **Stations that disagree** take the whole group out, because the pairing
      is genuinely ambiguous and nothing in the data says which station belongs
      to the link. Keeping the closest one would be a guess wearing a method.

    "Agree" reuses the screening gate's own 30% band rather than inventing a
    threshold: if two observations of one quantity sit inside the tolerance
    OpenPlan already accepts as a model matching reality, they are consistent
    observations of it.

    The underlying cause is network resolution — a link long enough to span a
    junction really does carry different volumes at its two ends — and that is
    not fixable here. This makes the consequence visible instead of silently
    averaging it into the accuracy figure.
    """
    ratio_limit = 1.0 + (DEFAULT_READY_MEDIAN_APE / 100.0 if consistency_ratio is None else consistency_ratio)
    by_link: dict[str, list[dict[str, Any]]] = {}
    for row in results:
        if row.get("match_status") != "matched":
            continue
        link_id = str(row.get("model_link_id") or "")
        if link_id:
            by_link.setdefault(link_id, []).append(row)

    merged_groups = 0
    merged_stations = 0
    ambiguous_groups = 0
    ambiguous_stations = 0
    for link_id, group in by_link.items():
        if len(group) < 2:
            continue
        # `is not None`, NOT truthiness: a station reporting zero vehicles is a
        # real observation and a zero would otherwise drop out of the range,
        # letting the group look consistent and merge into a live corridor.
        volumes = [
            value for value in (parse_float(row.get("observed_volume")) for row in group) if value is not None
        ]
        if not volumes:
            continue
        low, high = min(volumes), max(volumes)
        consistent = low > 0 and (high / low) <= ratio_limit
        ordered = sorted(group, key=lambda row: float(row["observed_volume"]))
        if consistent:
            merged_groups += 1
            merged_stations += len(group) - 1
            keeper = ordered[len(ordered) // 2]
            median_observed = float(keeper["observed_volume"])
            modeled = float(keeper["modeled_daily_pce"])
            keeper["observed_volume"] = int(round(median_observed))
            keeper["absolute_difference"] = int(round(abs(modeled - median_observed)))
            keeper["absolute_percent_error"] = round(100.0 * abs(modeled - median_observed) / median_observed, 2)
            ratio = safe_ratio(modeled, median_observed)
            keeper["volume_ratio_model_obs"] = round(ratio, 4) if ratio is not None else ""
            keeper["notes"] = "; ".join(
                part for part in (
                    keeper.get("notes", ""),
                    f"{len(group)} stations matched this link and agree within "
                    f"{(ratio_limit - 1) * 100:.0f}%; compared once at their median",
                ) if part
            )
            for row in group:
                if row is keeper:
                    continue
                row["match_status"] = "merged_into_shared_link"
                row["absolute_percent_error"] = ""
                row["volume_ratio_model_obs"] = ""
                row["notes"] = "; ".join(
                    part for part in (
                        row.get("notes", ""),
                        f"merged into station {keeper.get('station_id', '')} on link {link_id}",
                    ) if part
                )
        else:
            ambiguous_groups += 1
            ambiguous_stations += len(group)
            for row in group:
                row["match_status"] = "excluded_ambiguous_link"
                row["absolute_percent_error"] = ""
                row["volume_ratio_model_obs"] = ""
                row["notes"] = "; ".join(
                    part for part in (
                        row.get("notes", ""),
                        f"{len(group)} stations matched link {link_id} reporting {low:,.0f} to "
                        f"{high:,.0f} vehicles a day. The model holds one volume for the link and "
                        "nothing in the data says which station belongs to it, so none of them "
                        "grades it.",
                    ) if part
                )

    return {
        "consistency_ratio": round(ratio_limit, 4),
        "links_shared_by_several_stations": merged_groups + ambiguous_groups,
        "groups_merged_as_consistent": merged_groups,
        "stations_merged_away": merged_stations,
        "groups_excluded_as_ambiguous": ambiguous_groups,
        "stations_excluded_as_ambiguous": ambiguous_stations,
        "note": (
            "A model link holds one volume, so several stations matched to it are several "
            "observations of one number. Where they agree they are compared once at their median; "
            "where they disagree the pairing is ambiguous and none of them grades the link. The "
            "cause is network resolution — a link long enough to span a junction genuinely carries "
            "different volumes at its ends."
        ),
    }


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def discover_project_db(run_output_dir: Path, override: str | None) -> Path | None:
    del run_output_dir
    if not override:
        return None
    path = Path(override).expanduser().resolve()
    return path if path.exists() else None


def find_spatialite_path() -> str | None:
    for candidate in DEFAULT_SPATIALITE_PATHS:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def connect_spatialite(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    spatialite_path = find_spatialite_path()
    if spatialite_path:
        conn.enable_load_extension(True)
        conn.load_extension(spatialite_path)
    return conn


def find_run_project_db(run_output_dir: Path, explicit: Path | None) -> Path | None:
    """Locate the AequilibraE database a run was assigned on, for direction only.

    `discover_project_db` deliberately honours only an explicit flag, because a
    project database also supplies station-matching candidates and turning that
    on by default would change which link a station matches. Direction is a
    different question -- it changes no match, only whether both halves of a
    divided road are counted -- so it is looked up in the run's own conventional
    layout without disturbing matching.
    """
    if explicit is not None:
        return explicit
    for candidate in (
        run_output_dir.parent / "work" / "aeq_project" / "project_database.sqlite",
        run_output_dir / "work" / "aeq_project" / "project_database.sqlite",
    ):
        if candidate.exists():
            return candidate
    return None


def backfill_direction_from_project_db(features: list[dict[str, Any]], project_db: Path | None) -> int:
    """Recover which links are one-way carriageways for a run whose geometry predates the property.

    A count station measures a whole road; OSM maps a divided one as two one-way
    links. Runs made before `is_one_way` was exported cannot be compared
    correctly from their GeoJSON alone -- but the AequilibraE project database
    they were assigned on still records `direction` (0 = two-way), which is the
    same fact from its source. Returns the number of features backfilled, so a
    caller can say where the direction came from rather than implying the
    geometry carried it.
    """
    if project_db is None or not Path(project_db).exists():
        return 0
    if any(feature.get("direction_recorded") for feature in features):
        return 0
    try:
        conn = connect_spatialite(Path(project_db))
    except sqlite3.Error:
        return 0
    try:
        directions = {
            str(link_id): int(direction or 0)
            for link_id, direction in conn.execute("SELECT link_id, direction FROM links")
        }
    except sqlite3.Error:
        return 0
    finally:
        conn.close()
    filled = 0
    for feature in features:
        direction = directions.get(str(feature.get("link_id")))
        if direction is None:
            continue
        feature["is_one_way"] = direction != 0
        feature["direction_recorded"] = True
        feature["direction_source"] = "project_db"
        filled += 1
    return filled


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").split())


def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_candidate_names(value: Any) -> list[str]:
    if value is None:
        return []
    text = str(value).strip()
    if not text:
        return []
    return [piece.strip() for piece in text.split("|") if piece.strip()]


def parse_pipe_list(value: Any) -> list[str]:
    if value is None:
        return []
    text = str(value).strip()
    if not text:
        return []
    return [piece.strip() for piece in text.split("|") if piece.strip()]


def choose_geometry_path(run_output_dir: Path) -> Path:
    loaded = run_output_dir / "loaded_links.geojson"
    top = run_output_dir / "top_loaded_links.geojson"
    if loaded.exists():
        return loaded
    if top.exists():
        return top
    raise FileNotFoundError(
        f"No loaded link GeoJSON found in {run_output_dir}. Expected loaded_links.geojson or top_loaded_links.geojson"
    )


def iter_coords(geometry: dict[str, Any]):
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if geom_type == "LineString":
        for coord in coords or []:
            yield coord
    elif geom_type == "MultiLineString":
        for line in coords or []:
            for coord in line:
                yield coord
    elif geom_type == "Point":
        if coords:
            yield coords
    elif geom_type == "MultiPoint":
        for coord in coords or []:
            yield coord
    else:
        return


def geometry_centroid(geometry: dict[str, Any]) -> tuple[float | None, float | None]:
    points = list(iter_coords(geometry))
    if not points:
        return None, None
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def bbox_contains(row: dict[str, Any], lon: float | None, lat: float | None) -> bool:
    if lon is None or lat is None:
        return False
    min_lon = parse_float(row.get("bbox_min_lon"))
    min_lat = parse_float(row.get("bbox_min_lat"))
    max_lon = parse_float(row.get("bbox_max_lon"))
    max_lat = parse_float(row.get("bbox_max_lat"))
    if None in {min_lon, min_lat, max_lon, max_lat}:
        return True
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


def load_volume_lookup(link_volumes_path: Path, override_field: str | None) -> tuple[str, dict[int, dict[str, Any]]]:
    with link_volumes_path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fieldnames = reader.fieldnames or []
    volume_field = override_field
    if volume_field is None:
        for candidate in VOLUME_FIELD_CANDIDATES:
            if candidate in fieldnames:
                volume_field = candidate
                break
    if volume_field is None:
        raise RuntimeError(
            f"Could not auto-detect a volume field in {link_volumes_path}. Available columns: {fieldnames}"
        )

    lookup: dict[int, dict[str, Any]] = {}
    for row in rows:
        link_id_raw = row.get("link_id")
        if link_id_raw is None:
            continue
        try:
            link_id = int(float(link_id_raw))
        except ValueError:
            continue
        lookup[link_id] = row
    return volume_field, lookup


def build_feature_index(geojson_path: Path, volume_lookup: dict[int, dict[str, Any]], volume_field: str) -> list[dict[str, Any]]:
    payload = read_json(geojson_path)
    features = []
    for feature in payload.get("features", []):
        properties = feature.get("properties", {})
        link_id_raw = properties.get("link_id")
        if link_id_raw is None:
            continue
        try:
            link_id = int(float(link_id_raw))
        except ValueError:
            continue
        volume_row = volume_lookup.get(link_id, {})
        volume = parse_float(volume_row.get(volume_field))
        lon, lat = geometry_centroid(feature.get("geometry") or {})
        features.append(
            {
                "link_id": link_id,
                "name": str(properties.get("name") or "").strip(),
                "link_type": str(properties.get("link_type") or "").strip(),
                "lon": lon,
                "lat": lat,
                "volume": round(volume) if volume is not None else 0,
                # Absent on runs made before this property existed. Those
                # runs cannot have their carriageways summed — the information
                # is not in the artifact — and the summary says so rather than
                # reporting a corrected comparison it did not make.
                "is_one_way": bool(properties.get("is_one_way")),
                "direction_recorded": "is_one_way" in properties,
            }
        )
    return features


def query_project_db_candidates(
    project_db: Path,
    station: dict[str, Any],
    volume_lookup: dict[int, dict[str, Any]],
    volume_field: str,
) -> list[dict[str, Any]]:
    candidate_names = parse_candidate_names(station.get("candidate_model_names"))
    if not candidate_names:
        return []
    min_lon = parse_float(station.get("bbox_min_lon"))
    min_lat = parse_float(station.get("bbox_min_lat"))
    max_lon = parse_float(station.get("bbox_max_lon"))
    max_lat = parse_float(station.get("bbox_max_lat"))
    if None in {min_lon, min_lat, max_lon, max_lat}:
        return []

    name_clauses = " OR ".join(["name = ?" for _ in candidate_names])
    sql = f"""
        SELECT link_id, COALESCE(name, ''), COALESCE(link_type, ''),
               X(Centroid(geometry)) AS cx, Y(Centroid(geometry)) AS cy
        FROM links
        WHERE ({name_clauses})
          AND X(Centroid(geometry)) BETWEEN ? AND ?
          AND Y(Centroid(geometry)) BETWEEN ? AND ?
    """
    params = list(candidate_names) + [min_lon, max_lon, min_lat, max_lat]
    try:
        conn = connect_spatialite(project_db)
        rows = conn.execute(sql, params).fetchall()
        conn.close()
    except sqlite3.DatabaseError:
        return []

    features = []
    for link_id, name, link_type, lon, lat in rows:
        volume_row = volume_lookup.get(int(link_id), {})
        volume = parse_float(volume_row.get(volume_field)) or 0.0
        features.append(
            {
                "link_id": int(link_id),
                "name": str(name or "").strip(),
                "link_type": str(link_type or "").strip(),
                "lon": float(lon) if lon is not None else None,
                "lat": float(lat) if lat is not None else None,
                "volume": round(volume),
            }
        )
    return features


def station_sort_key(row: dict[str, Any]) -> tuple[int, float]:
    volume = parse_float(row.get("observed_volume")) or 0.0
    return (0 if volume > 0 else 1, -volume)


def corridor_volume_for(candidate: dict[str, Any], features: list[dict[str, Any]]) -> tuple[float, int]:
    """The whole corridor's volume at a link — ONE authority, the worker's.

    Imported rather than reimplemented: two lanes computing "is this a divided
    highway" from the same data by different rules is how the app and a report
    come to disagree about one road. The worker's version is the tested one
    (workers/aequilibrae_worker/count_validation.py) and it is pure, so it
    imports cleanly here.
    """
    # parents[1] is scripts/, not the repo root — this file lives in
    # scripts/modeling/, so the repo root is two levels up.
    worker_dir = Path(__file__).resolve().parents[2] / "workers" / "aequilibrae_worker"
    if str(worker_dir) not in sys.path:
        sys.path.insert(0, str(worker_dir))
    from count_validation import corridor_volume

    return corridor_volume(candidate, features)


def collect_station_candidates(
    station: dict[str, Any],
    features: list[dict[str, Any]],
    project_db: Path | None,
    volume_lookup: dict[int, dict[str, Any]],
    volume_field: str,
) -> list[dict[str, Any]]:
    candidate_names = parse_candidate_names(station.get("candidate_model_names"))
    candidate_names_norm = {normalize_text(name) for name in candidate_names}
    excluded_names_norm = {normalize_text(name) for name in parse_pipe_list(station.get("exclude_model_names"))}
    allowed_link_types_norm = {normalize_text(link_type) for link_type in parse_pipe_list(station.get("candidate_link_types"))}
    facility_name_norm = normalize_text(station.get("facility_name"))

    candidates: dict[int, dict[str, Any]] = {}

    def ingest(source: str, rows: list[dict[str, Any]]) -> None:
        for feature in rows:
            if not bbox_contains(station, feature["lon"], feature["lat"]):
                continue
            feature_name_norm = normalize_text(feature.get("name"))
            feature_link_type_norm = normalize_text(feature.get("link_type"))
            if excluded_names_norm and feature_name_norm in excluded_names_norm:
                continue
            type_allowed = not allowed_link_types_norm or feature_link_type_norm in allowed_link_types_norm
            if not type_allowed:
                continue
            exact_name_match = bool(candidate_names_norm and feature_name_norm in candidate_names_norm)
            facility_name_match = bool(facility_name_norm and facility_name_norm in feature_name_norm)
            type_only_match = bool(allowed_link_types_norm)
            if not exact_name_match and not facility_name_match and not type_only_match:
                continue
            match_score = 3 if exact_name_match else 2 if facility_name_match else 1
            link_id = int(feature["link_id"])
            candidate = {
                "link_id": link_id,
                "name": feature.get("name", ""),
                "link_type": feature.get("link_type", ""),
                "lon": feature.get("lon"),
                "lat": feature.get("lat"),
                "volume": float(feature.get("volume") or 0),
                # Carried through because `corridor_volume` needs it. The
                # candidate dict rebuilds selected fields rather than copying,
                # so a field the pairing depends on silently became False here
                # and every divided highway read as a single carriageway.
                "is_one_way": bool(feature.get("is_one_way")),
                "source": source,
                "exact_name_match": exact_name_match,
                "facility_name_match": facility_name_match,
                "type_only_match": type_only_match and not exact_name_match and not facility_name_match,
                "match_score": match_score,
            }
            existing = candidates.get(link_id)
            if existing is None or (candidate["match_score"], candidate["volume"], source == "project_db") > (
                existing["match_score"],
                existing["volume"],
                existing["source"] == "project_db",
            ):
                candidates[link_id] = candidate

    ingest("geometry", features)
    if project_db is not None:
        ingest("project_db", query_project_db_candidates(project_db, station, volume_lookup, volume_field))

    ordered = sorted(candidates.values(), key=lambda item: (item["match_score"], item["volume"]), reverse=True)
    for idx, candidate in enumerate(ordered, start=1):
        candidate["rank"] = idx
    return ordered


def find_best_model_link(
    station: dict[str, Any],
    features: list[dict[str, Any]],
    project_db: Path | None,
    volume_lookup: dict[int, dict[str, Any]],
    volume_field: str,
) -> dict[str, Any] | None:
    candidates = collect_station_candidates(station, features, project_db, volume_lookup, volume_field)
    return candidates[0] if candidates else None


def safe_ratio(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def compute_spearman_rho(observed: list[float], modeled: list[float]) -> float | None:
    n = len(observed)
    if n <= 1:
        return None
    obs_sorted = sorted(range(n), key=lambda idx: observed[idx], reverse=True)
    mod_sorted = sorted(range(n), key=lambda idx: modeled[idx], reverse=True)
    obs_rank = {idx: rank + 1 for rank, idx in enumerate(obs_sorted)}
    mod_rank = {idx: rank + 1 for rank, idx in enumerate(mod_sorted)}
    d_sq = sum((obs_rank[idx] - mod_rank[idx]) ** 2 for idx in range(n))
    return 1.0 - (6.0 * d_sq) / (n * (n * n - 1))


def classify_gate(
    matched_count: int,
    median_ape: float | None,
    max_ape: float | None,
    required_matches: int,
    ready_median_ape: float,
    ready_critical_ape: float,
) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if matched_count < required_matches:
        reasons.append(
            f"Only {matched_count} matched stations; at least {required_matches} are required for a bounded screening-ready decision."
        )
    if median_ape is None:
        reasons.append("No usable matched stations produced percent-error metrics.")
    elif median_ape > ready_median_ape:
        reasons.append(
            f"Median absolute percent error is {median_ape:.2f}%, above the {ready_median_ape:.2f}% screening threshold."
        )
    if max_ape is None:
        reasons.append("No maximum absolute percent error could be computed.")
    elif max_ape > ready_critical_ape:
        reasons.append(
            f"At least one core facility has {max_ape:.2f}% absolute percent error, above the {ready_critical_ape:.2f}% critical-facility threshold."
        )
    if reasons:
        return "internal prototype only", reasons
    return "bounded screening-ready", [
        f"Matched stations >= {required_matches}, median absolute percent error <= {ready_median_ape:.2f}%, and no matched facility exceeds {ready_critical_ape:.2f}% absolute percent error."
    ]


def _evidence_number(evidence: Any, *path: str) -> float | None:
    """A numeric field from the evidence packet, or None when it is absent.

    None means the run's producer did not record it — never 0, which for an
    intrazonal share would assert the finest possible zone system on a run
    nobody measured.
    """
    node: Any = evidence
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    if isinstance(node, bool) or not isinstance(node, (int, float)):
        return None
    return float(node)


def build_summary(
    *,
    evidence: dict[str, Any],
    counts_csv: Path,
    geometry_path: Path,
    project_db: Path | None,
    volume_field: str,
    results: list[dict[str, Any]],
    ready_median_ape: float,
    ready_critical_ape: float,
    required_matches: int,
) -> dict[str, Any]:
    matched = [row for row in results if row["match_status"] == "matched"]
    excluded_not_mainline = [row for row in results if row["match_status"] == "excluded_not_mainline"]
    apes = [float(row["absolute_percent_error"]) for row in matched if row.get("absolute_percent_error") is not None]
    observed = [float(row["observed_volume"]) for row in matched]
    modeled = [float(row["modeled_daily_pce"]) for row in matched]

    median_ape = float(sorted(apes)[len(apes) // 2]) if apes else None
    if apes and len(apes) % 2 == 0:
        ordered = sorted(apes)
        midpoint = len(ordered) // 2
        median_ape = (ordered[midpoint - 1] + ordered[midpoint]) / 2.0
    mean_ape = sum(apes) / len(apes) if apes else None
    min_ape = min(apes) if apes else None
    max_ape = max(apes) if apes else None
    spearman_rho = compute_spearman_rho(observed, modeled)
    by_road_class = accuracy_by_road_class(matched)
    pct_rmse = percent_rmse(observed, modeled)
    geh = geh_summary(observed, modeled)

    status_label, gate_reasons = classify_gate(
        matched_count=len(matched),
        median_ape=median_ape,
        max_ape=max_ape,
        required_matches=required_matches,
        ready_median_ape=ready_median_ape,
        ready_critical_ape=ready_critical_ape,
    )

    ranked = sorted(matched, key=lambda row: float(row["observed_volume"]), reverse=True)
    facility_ranking = []
    modeled_order = sorted(range(len(ranked)), key=lambda idx: float(ranked[idx]["modeled_daily_pce"]), reverse=True)
    modeled_rank_lookup = {idx: rank + 1 for rank, idx in enumerate(modeled_order)}
    for idx, row in enumerate(ranked, start=1):
        facility_ranking.append(
            {
                "station": row["label"],
                "observed_volume": int(round(float(row["observed_volume"]))),
                "modeled_daily_pce": int(round(float(row["modeled_daily_pce"]))),
                "obs_rank": idx,
                "mod_rank": modeled_rank_lookup[idx - 1],
            }
        )

    return {
        "validation_type": "screening_assignment_vs_observed_counts",
        "model_run_id": evidence.get("run_id", "unknown"),
        "model_engine": evidence.get("engine", "unknown"),
        "model_caveats": evidence.get("caveats", []),
        "counts_source_csv": str(counts_csv),
        # Who published these counts, taken from the count rows themselves.
        # Downstream evidence packets cite this instead of inferring an agency
        # from the CSV's file path — a path cannot tell one DOT from another,
        # and a wrong guess is a falsified attribution. Empty means the count
        # set did not record an agency, which must read as "not recorded".
        "count_source_agencies": sorted(
            {str(row.get("source_agency") or "").strip()
             for row in results if str(row.get("source_agency") or "").strip()}
        ),
        "model_geometry_source": str(geometry_path),
        "model_project_db": str(project_db) if project_db is not None else None,
        "model_volume_field": volume_field,
        "stations_total": len(results),
        "stations_matched": len(matched),
        "stations_missed": len(results) - len(matched),
        # Reported, never merely absent. A count set that quietly shrank is
        # indistinguishable from one the DOT published fewer stations for, and
        # the number of set-aside stations is itself worth reading: where it is
        # large, most of this feed's stations measure ramps.
        "stations_excluded_not_mainline": len(excluded_not_mainline),
        "stations_excluded_note": (
            f"{len(excluded_not_mainline)} station(s) measure a ramp or connector this network has "
            "no link for, so they were set aside before matching rather than compared against the "
            "mainline they leave. They are in validation_results.csv with match_status "
            "'excluded_not_mainline' and the source's own reason."
            if excluded_not_mainline
            else "No station was set aside; every published station measures a road this network contains."
        ),
        "screening_gate": {
            "status_label": status_label,
            "required_matches": required_matches,
            "ready_median_ape_threshold": ready_median_ape,
            "ready_critical_ape_threshold": ready_critical_ape,
            "reasons": gate_reasons,
        },
        # ── What the zone system lets this comparison establish ──────────────
        #
        # FACTS ONLY, DELIBERATELY. A trip beginning and ending in the same zone
        # carries VMT and no link volume, so past a threshold a link-level
        # comparison to counts cannot settle whether a model is right — which is
        # why OpenPlan refuses to record a screening claim from one. But the
        # THRESHOLD and the wording live in exactly one place, the app
        # (`src/lib/models/zone-resolution.ts`), and this file must not become a
        # second definition of that judgement: two definitions of one judgement
        # are free to drift, and the drift would put a "passed" in an operator's
        # report against a "not established" in the product.
        #
        # So this reports the NUMBER the app bands, and the markdown below says
        # plainly that the gate is a count-fit result the app still qualifies.
        # An operator reading the report sees the same input the claim is made
        # from, and there is no second threshold to disagree with.
        "zone_resolution": {
            "intrazonal_trip_share": _evidence_number(evidence, "vmt", "intrazonal_share"),
            "zone_count": _evidence_number(evidence, "zone_count"),
            "zone_system": evidence.get("zone_system") if isinstance(evidence, dict) else None,
            "note": (
                "Share of internal trips that begin and end in the same zone, so they carry VMT "
                "but never appear on any link. OpenPlan bands this share when it records a claim "
                "for this run: past its threshold the gate above is NOT recorded as a screening "
                "claim, because a link-level comparison cannot establish one at that resolution. "
                "The banding is OpenPlan's own screening heuristic, not an adopted standard. Null "
                "means the run's producer did not record the share."
            ),
        },
        "metrics": {
            "median_absolute_percent_error": round(median_ape, 2) if median_ape is not None else None,
            "mean_absolute_percent_error": round(mean_ape, 2) if mean_ape is not None else None,
            "min_absolute_percent_error": round(min_ape, 2) if min_ape is not None else None,
            "max_absolute_percent_error": round(max_ape, 2) if max_ape is not None else None,
            "spearman_rho_facility_ranking": round(spearman_rho, 4) if spearman_rho is not None else None,
            "percent_rmse": round(pct_rmse, 2) if pct_rmse is not None else None,
            "geh_mean": round(geh["mean"], 2) if geh["mean"] is not None else None,
            "geh_max": round(geh["max"], 2) if geh["max"] is not None else None,
            "geh_basis": geh["basis"],
            # THE STUDY-AREA MEDIAN HIDES THE THING A PLANNER NEEDS. On the run
            # that produced this code, the median was 39.7% while freeways sat
            # at 22.8% and arterials at 132-227% — two numbers of completely
            # different quality reported as one. A corridor figure is only as
            # good as the accuracy for ITS kind of road.
            "by_road_class": by_road_class,
            "by_road_class_note": road_class_accuracy_note(by_road_class),
        },
        "facility_ranking": facility_ranking,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def write_results_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = [
        "station_id",
        "label",
        "match_status",
        "facility_name",
        "count_year",
        "count_type",
        "direction",
        "observed_volume",
        "source_agency",
        "source_description",
        "model_link_id",
        "model_link_name",
        "model_link_type",
        "model_lon",
        "model_lat",
        "modeled_daily_pce",
        "absolute_difference",
        "absolute_percent_error",
        "volume_ratio_model_obs",
        "carriageways_summed",
        "candidate_model_names",
        "notes",
    ]
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_candidate_audit_json(path: Path, audit: list[dict[str, Any]]) -> None:
    path.write_text(json.dumps(audit, indent=2))


def write_candidate_audit_csv(path: Path, audit: list[dict[str, Any]]) -> None:
    rows: list[dict[str, Any]] = []
    for station in audit:
        base = {
            "station_id": station.get("station_id", ""),
            "label": station.get("label", ""),
            "observed_volume": station.get("observed_volume", ""),
            "best_model_link_id": station.get("best_model_link_id", ""),
            "best_model_link_name": station.get("best_model_link_name", ""),
            "best_modeled_daily_pce": station.get("best_modeled_daily_pce", ""),
        }
        for candidate in station.get("candidates", []):
            row = dict(base)
            row.update(
                {
                    "candidate_rank": candidate.get("rank", ""),
                    "candidate_link_id": candidate.get("link_id", ""),
                    "candidate_name": candidate.get("name", ""),
                    "candidate_link_type": candidate.get("link_type", ""),
                    "candidate_source": candidate.get("source", ""),
                    "candidate_exact_name_match": candidate.get("exact_name_match", False),
                    "candidate_facility_name_match": candidate.get("facility_name_match", False),
                    "candidate_type_only_match": candidate.get("type_only_match", False),
                    "candidate_lon": candidate.get("lon", ""),
                    "candidate_lat": candidate.get("lat", ""),
                    "candidate_modeled_daily_pce": int(round(float(candidate.get("volume") or 0))),
                }
            )
            rows.append(row)
    if not rows:
        rows.append({"station_id": "", "label": "", "candidate_rank": ""})
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_markdown_report(path: Path, summary: dict[str, Any], results: list[dict[str, Any]]) -> None:
    lines = [
        "# Screening Validation Report",
        "",
        f"- Model run id: `{summary['model_run_id']}`",
        f"- Model engine: `{summary['model_engine']}`",
        f"- Count source CSV: `{summary['counts_source_csv']}`",
        f"- Count publishing agency: {', '.join(summary['count_source_agencies']) or '_not recorded in the count set_'}",
        f"- Geometry source: `{summary['model_geometry_source']}`",
        f"- Project DB: `{summary['model_project_db']}`",
        f"- Matched stations: **{summary['stations_matched']} / {summary['stations_total']}**",
        f"- Set aside as ramp/connector counts: **{summary.get('stations_excluded_not_mainline', 0)}** "
        f"— {summary.get('stations_excluded_note', '')}",
        f"- Gate status: **{summary['screening_gate']['status_label']}**",
        "",
        "## Gate reasons",
    ]
    for reason in summary["screening_gate"]["reasons"]:
        lines.append(f"- {reason}")

    # The gate above is a COUNT-FIT result. Whether it becomes a screening claim
    # also depends on the zone system, and OpenPlan decides that when it records
    # the claim — so an operator reading this report is told the same thing the
    # product will conclude, rather than discovering later that a "passed" here
    # was not recorded as one. The number is reported; the banding is not
    # repeated here (see the zone_resolution note in the summary JSON).
    zone = summary.get("zone_resolution") or {}
    share = zone.get("intrazonal_trip_share")
    lines.extend(["", "## Zone resolution"])
    if share is None:
        lines.append(
            "- Intrazonal trip share: _not recorded by this run's producer_ — so this gate was "
            "not qualified against the zone system either way."
        )
    else:
        zone_count = zone.get("zone_count")
        zones_clause = f" across {int(zone_count)} zones" if zone_count else ""
        lines.append(
            f"- Intrazonal trip share: **{share * 100:.1f}%**{zones_clause} — trips that begin "
            "and end in the same zone and never appear on any link."
        )
        lines.append(
            "- The gate above is a count-fit result. OpenPlan bands this share when it records "
            "the claim for this run: past its threshold the gate is NOT recorded as a screening "
            "claim, because a link-level comparison cannot establish one at that resolution. "
            "The banding is OpenPlan's own screening heuristic, not an adopted standard."
        )
    lines.extend(
        [
            "",
            "## Metrics",
            f"- Median absolute percent error: **{summary['metrics']['median_absolute_percent_error']}%**",
            f"- Mean absolute percent error: **{summary['metrics']['mean_absolute_percent_error']}%**",
            f"- Min absolute percent error: **{summary['metrics']['min_absolute_percent_error']}%**",
            f"- Max absolute percent error: **{summary['metrics']['max_absolute_percent_error']}%**",
            f"- Spearman rho (facility ranking): **{summary['metrics']['spearman_rho_facility_ranking']}**",
            "",
            summary["metrics"]["by_road_class_note"],
            "",
            "| Road type | Stations | Median error | Model ÷ observed |",
            "|---|---:|---:|---:|",
            *[
                f"| {entry['road_class']}{' (one station)' if entry['single_station'] else ''} "
                f"| {entry['stations']} | {entry['median_absolute_percent_error']}% "
                f"| {entry['median_model_over_observed']} |"
                for entry in summary["metrics"]["by_road_class"]
            ],
            "",
            "## Matched facilities",
            "",
            "| Station | Observed | Modeled | APE | Match |",
            "|---|---:|---:|---:|---|",
        ]
    )
    for row in results:
        ape = row.get("absolute_percent_error")
        ape_display = f"{ape}%" if ape not in (None, "") else ""
        lines.append(
            "| {label} | {obs} | {mod} | {ape} | {match} |".format(
                label=row.get("label", ""),
                obs=row.get("observed_volume", ""),
                mod=row.get("modeled_daily_pce", ""),
                ape=ape_display,
                match=row.get("match_status", ""),
            )
        )
    path.write_text("\n".join(lines) + "\n")


def run_validation_bundle(
    *,
    run_output_dir: str | Path,
    counts_csv: str | Path,
    output_dir: str | Path | None = None,
    volume_field: str | None = None,
    project_db: str | Path | None = None,
    ready_median_ape: float = DEFAULT_READY_MEDIAN_APE,
    ready_critical_ape: float = DEFAULT_READY_CRITICAL_APE,
    required_matches: int = DEFAULT_REQUIRED_MATCHES,
) -> dict[str, Any]:
    run_output_dir = Path(run_output_dir).expanduser().resolve()
    counts_csv = Path(counts_csv).expanduser().resolve()
    output_dir = (
        Path(output_dir).expanduser().resolve()
        if output_dir is not None
        else run_output_dir / "validation_bundle"
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    link_volumes_path = run_output_dir / "link_volumes.csv"
    evidence_path = run_output_dir / "evidence_packet.json"
    geometry_path = choose_geometry_path(run_output_dir)

    evidence = read_json(evidence_path)
    project_db_path = discover_project_db(run_output_dir, str(project_db) if project_db is not None else None)
    volume_field, volume_lookup = load_volume_lookup(link_volumes_path, volume_field)
    features = build_feature_index(geometry_path, volume_lookup, volume_field)
    direction_backfilled = backfill_direction_from_project_db(
        features, find_run_project_db(run_output_dir, project_db_path)
    )

    with counts_csv.open(newline="") as handle:
        reader = csv.DictReader(handle)
        stations = sorted(list(reader), key=station_sort_key)

    results: list[dict[str, Any]] = []
    candidate_audit: list[dict[str, Any]] = []
    for station in stations:
        observed_volume = parse_float(station.get("observed_volume"))
        station_candidates = collect_station_candidates(station, features, project_db_path, volume_lookup, volume_field)
        best_model_link = station_candidates[0] if station_candidates else None
        result = {
            "station_id": station.get("station_id", ""),
            "label": station.get("label", ""),
            "match_status": "model_miss",
            "facility_name": station.get("facility_name", ""),
            "count_year": station.get("count_year", ""),
            "count_type": station.get("count_type", ""),
            "direction": station.get("direction", ""),
            "observed_volume": int(round(observed_volume)) if observed_volume is not None else "",
            "source_agency": station.get("source_agency", ""),
            "source_description": station.get("source_description", ""),
            "model_link_id": "",
            "model_link_name": "",
            "model_link_type": "",
            "model_lon": "",
            "model_lat": "",
            "modeled_daily_pce": "",
            "absolute_difference": "",
            "absolute_percent_error": "",
            "volume_ratio_model_obs": "",
            "candidate_model_names": station.get("candidate_model_names", ""),
            "notes": station.get("notes", ""),
        }

        # A station the SOURCE marked as measuring something the network does
        # not contain — a ramp or a connector — is set aside before matching.
        # Left in, it is paired with the mainline it leaves and reports an error
        # of tens of times, which is the pairing being wrong rather than the
        # model. A count set that never declared a role behaves exactly as
        # before, so a hand-supplied CSV is unaffected.
        station_role = (station.get("station_role") or "").strip().lower()
        if station_role and station_role != "mainline":
            result["match_status"] = "excluded_not_mainline"
            result["notes"] = "; ".join(
                part for part in (station.get("notes", ""), station.get("station_role_reason", "")) if part
            )
            results.append(result)
            candidate_audit.append(
                {
                    "station_id": station.get("station_id", ""),
                    "label": station.get("label", ""),
                    "observed_volume": int(round(observed_volume)) if observed_volume is not None else "",
                    "best_model_link_id": "",
                    "candidates": [],
                    "excluded_reason": station.get("station_role_reason", ""),
                }
            )
            continue

        if best_model_link is not None and observed_volume is not None and observed_volume > 0:
            # THE WHOLE CORRIDOR, not one carriageway. A count station on a
            # divided highway measures both directions while OSM maps them as
            # two one-way links — a factor of two on 99% of motorway links.
            modeled_volume, carriageways = corridor_volume_for(best_model_link, features)
            abs_diff = abs(modeled_volume - observed_volume)
            ape = 100.0 * abs_diff / observed_volume
            ratio = safe_ratio(modeled_volume, observed_volume)
            result.update(
                {
                    "match_status": "matched",
                    "model_link_id": best_model_link["link_id"],
                    "model_link_name": best_model_link["name"],
                    "model_link_type": best_model_link["link_type"],
                    "model_lon": round(float(best_model_link["lon"]), 5) if best_model_link["lon"] is not None else "",
                    "model_lat": round(float(best_model_link["lat"]), 5) if best_model_link["lat"] is not None else "",
                    "modeled_daily_pce": int(round(modeled_volume)),
                    "absolute_difference": int(round(abs_diff)),
                    "absolute_percent_error": round(ape, 2),
                    "volume_ratio_model_obs": round(ratio, 4) if ratio is not None else "",
                    "carriageways_summed": carriageways,
                }
            )
        candidate_audit.append(
            {
                "station_id": station.get("station_id", ""),
                "label": station.get("label", ""),
                "observed_volume": int(round(observed_volume)) if observed_volume is not None else "",
                "best_model_link_id": result.get("model_link_id", ""),
                "best_model_link_name": result.get("model_link_name", ""),
                "best_modeled_daily_pce": result.get("modeled_daily_pce", ""),
                "candidates": [
                    {
                        **candidate,
                        "volume": int(round(float(candidate.get("volume") or 0))),
                    }
                    for candidate in station_candidates
                ],
            }
        )
        results.append(result)

    # After every station has been matched, not during: whether a link is shared
    # is only knowable once they all have.
    shared_link_resolution = resolve_shared_links(results)

    # A run whose geometry predates the direction property cannot have its
    # carriageways summed, and a comparison that quietly skipped the correction
    # is indistinguishable from one that did not need it.
    direction_known = any(feature.get("direction_recorded") for feature in features)
    direction_source = "project_database" if direction_backfilled else ("geometry" if direction_known else None)
    carriageway_note = (
        f"{sum(1 for row in results if str(row.get('carriageways_summed') or '') == '2')} station(s) "
        "sit on a divided highway and were compared against both carriageways summed"
        + (
            f", using link direction recovered from the run's AequilibraE project database "
            f"({direction_backfilled:,} links) because this run's geometry predates the exported property."
            if direction_backfilled
            else " using the direction recorded in the run's link geometry."
        )
        if direction_known
        else (
            "This run's link geometry predates the carriageway-direction property, so a station on a "
            "divided highway was compared against ONE carriageway while its count measures both. "
            "Freeway figures here read roughly half of what a corrected comparison gives. Re-run the "
            "model to get a comparison that sums them."
        )
    )

    summary = build_summary(
        evidence=evidence,
        counts_csv=counts_csv,
        geometry_path=geometry_path,
        project_db=project_db_path,
        volume_field=volume_field,
        results=results,
        ready_median_ape=ready_median_ape,
        ready_critical_ape=ready_critical_ape,
        required_matches=required_matches,
    )
    summary["shared_model_links"] = shared_link_resolution
    summary["divided_highways"] = {
        "direction_known": direction_known,
        "direction_source": direction_source,
        "links_backfilled_from_project_db": direction_backfilled,
        "note": carriageway_note,
    }

    write_results_csv(output_dir / "validation_results.csv", results)
    (output_dir / "validation_summary.json").write_text(json.dumps(summary, indent=2))
    write_markdown_report(output_dir / "validation_report.md", summary, results)
    write_candidate_audit_json(output_dir / "validation_candidate_audit.json", candidate_audit)
    write_candidate_audit_csv(output_dir / "validation_candidate_audit.csv", candidate_audit)
    return summary


def main() -> int:
    args = parse_args()
    summary = run_validation_bundle(
        run_output_dir=args.run_output_dir,
        counts_csv=args.counts_csv,
        output_dir=args.output_dir,
        volume_field=args.volume_field,
        project_db=args.project_db,
        ready_median_ape=args.ready_median_ape,
        ready_critical_ape=args.ready_critical_ape,
        required_matches=args.required_matches,
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
