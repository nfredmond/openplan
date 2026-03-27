from __future__ import annotations

import csv
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from generate_validation_scaffold import (
    build_ranked_candidates,
    build_scaffold_rows,
    load_volume_lookup,
    select_candidate_source,
    write_review_packet,
)


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_geojson(path: Path, features: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, indent=2))


class GenerateValidationScaffoldTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def make_run_dir(self, name: str) -> Path:
        run_dir = self.root / name
        (run_dir / "run_output").mkdir(parents=True)
        return run_dir

    def test_archived_run_falls_back_to_durable_geojson(self) -> None:
        run_dir = self.make_run_dir("archived-nevada")
        write_csv(
            run_dir / "run_output" / "link_volumes.csv",
            [
                {"link_id": 1001, "PCE_tot": 2500.0},
                {"link_id": 1002, "PCE_tot": 1200.0},
            ],
        )
        write_geojson(
            run_dir / "run_output" / "loaded_links.geojson",
            [
                {
                    "type": "Feature",
                    "properties": {"link_id": 1001, "name": "Main Street", "link_type": "primary", "pce_tot": 2500.0},
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-121.1, 39.1], [-121.05, 39.15], [-121.0, 39.2]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"link_id": 1002, "name": "Main Street", "link_type": "primary", "pce_tot": 1200.0},
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-121.2, 39.2], [-121.15, 39.25], [-121.1, 39.3]],
                    },
                },
            ],
        )

        records, source_info = select_candidate_source(run_dir)
        ranked = build_ranked_candidates(records, load_volume_lookup(run_dir / "run_output" / "link_volumes.csv"))
        rows = build_scaffold_rows(
            run_dir=run_dir,
            county_prefix="NEVADA",
            source_agency="TBD",
            bbox_padding_deg=0.01,
            limit=4,
            ranked=ranked,
            source_info=source_info,
        )
        review_path = run_dir / "validation_review.md"
        write_review_packet(review_path, run_dir, rows, ranked, source_info)

        self.assertEqual(source_info["mode"], "durable-geojson")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["facility_name"], "Main Street")
        self.assertEqual(rows[0]["candidate_link_types"], "primary")
        self.assertIn("Fallback used durable GeoJSON", rows[0]["notes"])
        self.assertEqual(rows[0]["bbox_min_lon"], "-121.060000")
        self.assertEqual(rows[0]["bbox_max_lat"], "39.160000")

        review_text = review_path.read_text()
        self.assertIn("durable loaded-links GeoJSON fallback", review_text)
        self.assertIn("fidelity caveat", review_text)

    def test_prefers_project_db_when_retained(self) -> None:
        run_dir = self.make_run_dir("retained-nevada")
        write_csv(
            run_dir / "run_output" / "link_volumes.csv",
            [
                {"link_id": 2001, "PCE_tot": 4000.0},
            ],
        )
        write_geojson(
            run_dir / "run_output" / "loaded_links.geojson",
            [
                {
                    "type": "Feature",
                    "properties": {"link_id": 2001, "name": "GeoJSON Name", "link_type": "primary", "pce_tot": 4000.0},
                    "geometry": {"type": "LineString", "coordinates": [[-121.8, 39.8], [-121.7, 39.9], [-121.6, 40.0]]},
                }
            ],
        )

        db_path = run_dir / "work" / "aeq_project" / "project_database.sqlite"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("CREATE TABLE links (link_id INTEGER, name TEXT, link_type TEXT, lon REAL, lat REAL)")
            conn.execute("INSERT INTO links VALUES (2001, 'Database Name', 'primary', -120.5, 38.5)")
            conn.commit()
        finally:
            conn.close()

        records, source_info = select_candidate_source(run_dir)
        ranked = build_ranked_candidates(records, load_volume_lookup(run_dir / "run_output" / "link_volumes.csv"))
        rows = build_scaffold_rows(
            run_dir=run_dir,
            county_prefix="NEVADA",
            source_agency="TBD",
            bbox_padding_deg=0.01,
            limit=4,
            ranked=ranked,
            source_info=source_info,
        )

        self.assertEqual(source_info["mode"], "project-db")
        self.assertEqual(rows[0]["facility_name"], "Database Name")
        self.assertEqual(rows[0]["bbox_min_lon"], "-120.510000")
        self.assertEqual(rows[0]["bbox_max_lat"], "38.510000")
        self.assertNotIn("Fallback used durable GeoJSON", rows[0]["notes"])


if __name__ == "__main__":
    unittest.main()
