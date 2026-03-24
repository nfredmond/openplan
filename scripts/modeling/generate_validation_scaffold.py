#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import os
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any

DEFAULT_SPATIALITE_PATHS = [
    os.getenv("SPATIALITE_LIBRARY_PATH", ""),
    "/home/linuxbrew/.linuxbrew/lib/mod_spatialite.so",
    "/home/linuxbrew/.linuxbrew/lib/mod_spatialite",
    "/usr/lib/x86_64-linux-gnu/mod_spatialite.so",
]

ALLOWED_LINK_TYPES = {"motorway", "trunk", "primary", "secondary"}
EXCLUDED_NAMES = {
    "",
    "connector",
    "centroid_connector",
    "ramp",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a first-pass observed-count validation scaffold from a completed screening run."
    )
    parser.add_argument("--run-dir", required=True, help="Screening run directory containing run_output/ and retained work/aeq_project")
    parser.add_argument("--output-csv", required=True, help="Path to write scaffold CSV")
    parser.add_argument("--county-prefix", required=True, help="Station id prefix, e.g. PLACER or TEHAMA")
    parser.add_argument("--source-agency", default="TBD", help="Default source agency placeholder")
    parser.add_argument("--limit", type=int, default=8, help="Max number of scaffold rows to emit")
    parser.add_argument("--bbox-padding-deg", type=float, default=0.006, help="Half-width/height bbox padding in degrees")
    parser.add_argument("--output-md", help="Optional markdown review packet path")
    return parser.parse_args()


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


def normalize_name(value: str) -> str:
    return " ".join((value or "").strip().split())


def slugify(value: str) -> str:
    safe = []
    for ch in value.upper():
        if ch.isalnum():
            safe.append(ch)
        else:
            safe.append("_")
    text = "".join(safe)
    while "__" in text:
        text = text.replace("__", "_")
    return text.strip("_") or "SITE"


def load_volume_lookup(path: Path) -> dict[int, float]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
    for field in ["PCE_tot", "demand_tot", "volume", "loaded_volume"]:
        if rows and field in rows[0]:
            volume_field = field
            break
    else:
        raise RuntimeError(f"No usable volume field found in {path}")
    lookup: dict[int, float] = {}
    for row in rows:
        try:
            link_id = int(float(row["link_id"]))
            lookup[link_id] = float(row.get(volume_field) or 0)
        except Exception:
            continue
    return lookup


def choose_candidate_names(name: str) -> str:
    return name


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = [
        "station_id",
        "label",
        "facility_name",
        "count_year",
        "count_type",
        "direction",
        "observed_volume",
        "source_agency",
        "source_description",
        "candidate_model_names",
        "candidate_link_types",
        "exclude_model_names",
        "bbox_min_lon",
        "bbox_min_lat",
        "bbox_max_lon",
        "bbox_max_lat",
        "notes",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_review_packet(path: Path, run_dir: Path, rows: list[dict[str, Any]], ranked: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Validation Scaffold Review Packet — {run_dir.name}",
        "",
        "This packet is auto-generated from a completed screening run.",
        "Use it to pick the first observed-count stations to source and finalize.",
        "",
        "## Selected starter stations",
        "",
    ]
    for row in rows:
        lines.extend(
            [
                f"### {row['station_id']} — {row['facility_name']}",
                f"- label: {row['label']}",
                f"- candidate link type: `{row['candidate_link_types']}`",
                f"- candidate model names: `{row['candidate_model_names']}`",
                f"- bbox: `{row['bbox_min_lon']}, {row['bbox_min_lat']}` to `{row['bbox_max_lon']}, {row['bbox_max_lat']}`",
                f"- source seed: {row['source_description']}",
                f"- notes: {row['notes']}",
                "",
            ]
        )
    lines.extend([
        "## Top screened facilities by loaded volume",
        "",
        "| Rank | Facility | Link type | Top link volume | Segments | Representative lon | Representative lat |",
        "|---:|---|---|---:|---:|---:|---:|",
    ])
    for idx, item in enumerate(ranked[:25], start=1):
        lines.append(
            f"| {idx} | {item['name']} | {item['link_type']} | {item['top_volume']:.0f} | {item['segments']} | {item['lon']:.5f} | {item['lat']:.5f} |"
        )
    lines.extend([
        "",
        "## Review guidance",
        "",
        "- Replace placeholders with actual observed counts and source text.",
        "- Tighten each bbox before formal validation.",
        "- Add `exclude_model_names` where nearby cross streets, ramps, or frontage roads could contaminate the match.",
        "- If the first validation pass shows ambiguity, use the validator's candidate-audit outputs to refine the station definitions.",
        "",
    ])
    path.write_text("\n".join(lines))


def main() -> int:
    args = parse_args()
    run_dir = Path(args.run_dir).expanduser().resolve()
    output_csv = Path(args.output_csv).expanduser().resolve()
    link_volumes_path = run_dir / "run_output" / "link_volumes.csv"
    project_db = run_dir / "work" / "aeq_project" / "project_database.sqlite"
    if not link_volumes_path.exists():
        raise FileNotFoundError(link_volumes_path)
    if not project_db.exists():
        raise FileNotFoundError(project_db)

    volume_lookup = load_volume_lookup(link_volumes_path)
    conn = connect_spatialite(project_db)

    rows = conn.execute(
        """
        SELECT link_id, COALESCE(name,''), COALESCE(link_type,''),
               X(Centroid(geometry)) AS lon, Y(Centroid(geometry)) AS lat
        FROM links
        WHERE COALESCE(name,'') != '' AND link_type != 'centroid_connector'
        """
    ).fetchall()

    grouped: dict[tuple[str, str], list[tuple[int, float, float, float]]] = defaultdict(list)
    for link_id, name, link_type, lon, lat in rows:
        name = normalize_name(name)
        link_type = (link_type or "").strip().lower()
        if link_type not in ALLOWED_LINK_TYPES:
            continue
        if name.lower() in EXCLUDED_NAMES:
            continue
        volume = float(volume_lookup.get(int(link_id), 0.0))
        if volume <= 0:
            continue
        grouped[(name, link_type)].append((int(link_id), volume, float(lon), float(lat)))

    ranked = []
    for (name, link_type), entries in grouped.items():
        entries.sort(key=lambda item: item[1], reverse=True)
        top_link_id, top_volume, top_lon, top_lat = entries[0]
        total_volume = sum(item[1] for item in entries)
        ranked.append(
            {
                "name": name,
                "link_type": link_type,
                "top_link_id": top_link_id,
                "top_volume": top_volume,
                "total_volume": total_volume,
                "lon": top_lon,
                "lat": top_lat,
                "segments": len(entries),
            }
        )

    ranked.sort(key=lambda item: (item["top_volume"], item["total_volume"]), reverse=True)

    emitted: list[dict[str, Any]] = []
    used_names: set[str] = set()
    ordinal = 1
    for item in ranked:
        name = item["name"]
        if name in used_names:
            continue
        used_names.add(name)
        lon = item["lon"]
        lat = item["lat"]
        padding = float(args.bbox_padding_deg)
        emitted.append(
            {
                "station_id": f"{args.county_prefix}_{slugify(name)}_{ordinal:03d}",
                "label": f"{name} starter validation point",
                "facility_name": name,
                "count_year": "",
                "count_type": "",
                "direction": "two_way",
                "observed_volume": "",
                "source_agency": args.source_agency,
                "source_description": f"Seeded from runtime top-loaded {name} segment (link {item['top_link_id']})",
                "candidate_model_names": choose_candidate_names(name),
                "candidate_link_types": item["link_type"],
                "exclude_model_names": "",
                "bbox_min_lon": f"{lon - padding:.6f}",
                "bbox_min_lat": f"{lat - padding:.6f}",
                "bbox_max_lon": f"{lon + padding:.6f}",
                "bbox_max_lat": f"{lat + padding:.6f}",
                "notes": (
                    f"Auto-generated starter scaffold from {run_dir.name}. Confirm actual count location/postmile, tighten bbox, "
                    f"and add exclude_model_names for ramps/cross streets if needed. top_volume={item['top_volume']:.0f}; segments={item['segments']}"
                ),
            }
        )
        ordinal += 1
        if len(emitted) >= args.limit:
            break

    write_csv(output_csv, emitted)
    if args.output_md:
        write_review_packet(Path(args.output_md).expanduser().resolve(), run_dir, emitted, ranked)
    print(f"Wrote {len(emitted)} scaffold rows to {output_csv}")
    if args.output_md:
        print(f"Wrote review packet to {Path(args.output_md).expanduser().resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
