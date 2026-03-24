#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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


def collect_station_candidates(
    station: dict[str, Any],
    features: list[dict[str, Any]],
    project_db: Path | None,
    volume_lookup: dict[int, dict[str, Any]],
    volume_field: str,
) -> list[dict[str, Any]]:
    candidate_names = parse_candidate_names(station.get("candidate_model_names"))
    candidate_names_norm = {normalize_text(name) for name in candidate_names}
    facility_name_norm = normalize_text(station.get("facility_name"))

    candidates: dict[int, dict[str, Any]] = {}

    def ingest(source: str, rows: list[dict[str, Any]]) -> None:
        for feature in rows:
            if not bbox_contains(station, feature["lon"], feature["lat"]):
                continue
            feature_name_norm = normalize_text(feature.get("name"))
            exact_name_match = bool(candidate_names_norm and feature_name_norm in candidate_names_norm)
            facility_name_match = bool(facility_name_norm and facility_name_norm in feature_name_norm)
            if not exact_name_match and not facility_name_match:
                continue
            match_score = 2 if exact_name_match else 1
            link_id = int(feature["link_id"])
            candidate = {
                "link_id": link_id,
                "name": feature.get("name", ""),
                "link_type": feature.get("link_type", ""),
                "lon": feature.get("lon"),
                "lat": feature.get("lat"),
                "volume": float(feature.get("volume") or 0),
                "source": source,
                "exact_name_match": exact_name_match,
                "facility_name_match": facility_name_match,
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
        "model_geometry_source": str(geometry_path),
        "model_project_db": str(project_db) if project_db is not None else None,
        "model_volume_field": volume_field,
        "stations_total": len(results),
        "stations_matched": len(matched),
        "stations_missed": len(results) - len(matched),
        "screening_gate": {
            "status_label": status_label,
            "required_matches": required_matches,
            "ready_median_ape_threshold": ready_median_ape,
            "ready_critical_ape_threshold": ready_critical_ape,
            "reasons": gate_reasons,
        },
        "metrics": {
            "median_absolute_percent_error": round(median_ape, 2) if median_ape is not None else None,
            "mean_absolute_percent_error": round(mean_ape, 2) if mean_ape is not None else None,
            "min_absolute_percent_error": round(min_ape, 2) if min_ape is not None else None,
            "max_absolute_percent_error": round(max_ape, 2) if max_ape is not None else None,
            "spearman_rho_facility_ranking": round(spearman_rho, 4) if spearman_rho is not None else None,
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
        f"- Geometry source: `{summary['model_geometry_source']}`",
        f"- Project DB: `{summary['model_project_db']}`",
        f"- Matched stations: **{summary['stations_matched']} / {summary['stations_total']}**",
        f"- Gate status: **{summary['screening_gate']['status_label']}**",
        "",
        "## Gate reasons",
    ]
    for reason in summary["screening_gate"]["reasons"]:
        lines.append(f"- {reason}")
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

        if best_model_link is not None and observed_volume is not None and observed_volume > 0:
            modeled_volume = float(best_model_link["volume"] or 0)
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
