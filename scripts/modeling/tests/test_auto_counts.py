#!/usr/bin/env python3
"""Nationwide source selection at the county study driver's real front door."""
from __future__ import annotations

import csv
import sys
import tempfile
import unittest
import json
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import auto_counts  # noqa: E402


class NationwideCountSourceSelection(unittest.TestCase):
    def test_registered_state_feed_is_preferred(self) -> None:
        self.assertEqual(auto_counts.preferred_sources_for_state_fips({"06"}), {"CA": {"06"}})

    def test_unregistered_state_reaches_hpms(self) -> None:
        self.assertEqual(
            auto_counts.preferred_sources_for_state_fips({"39"}),
            {"us-fhwa-hpms-2024": {"39"}},
        )

    def test_multi_state_selection_does_not_replace_a_state_feed_with_hpms(self) -> None:
        self.assertEqual(
            auto_counts.preferred_sources_for_state_fips({"06", "39"}),
            {"CA": {"06"}, "us-fhwa-hpms-2024": {"39"}},
        )

    def test_driver_filters_hpms_to_only_fallback_states(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            boundary = root / "boundary.geojson"
            database = root / "project_database.sqlite"
            output = root / "counts.csv"
            boundary.write_text(json.dumps({
                "type": "Polygon",
                "coordinates": [[[-124, 32], [-80, 32], [-80, 42], [-124, 42], [-124, 32]]],
            }))
            database.write_text("")

            def fake_builder(**kwargs):
                rows = (
                    [{"station_id": "CA-DOT", "source_state": "", "bbox_min_lon": "-120", "bbox_max_lon": "-120", "bbox_min_lat": "35", "bbox_max_lat": "35"}]
                    if kwargs["source"] == "CA"
                    else [
                        {"station_id": "HPMS-CA", "source_state": "06", "bbox_min_lon": "-121", "bbox_max_lon": "-121", "bbox_min_lat": "36", "bbox_max_lat": "36"},
                        {"station_id": "HPMS-OH", "source_state": "39", "bbox_min_lon": "-82", "bbox_max_lon": "-82", "bbox_min_lat": "40", "bbox_max_lat": "40"},
                    ]
                )
                with kwargs["output_csv"].open("w", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
                    writer.writeheader()
                    writer.writerows(rows)

                class Result:
                    returncode = 0
                    stderr = ""
                    stdout = ""

                return Result()

            with patch.object(auto_counts, "_run_count_builder", side_effect=fake_builder) as run:
                result = auto_counts.fetch_counts_for_study_area(
                    state_fips_codes={"06", "39"},
                    boundary_geojson_path=boundary,
                    project_db=database,
                    output_csv=output,
                    bbox=(-124.0, 32.0, -80.0, 42.0),
                )

            with output.open(newline="") as handle:
                station_ids = [row["station_id"] for row in csv.DictReader(handle)]
            self.assertEqual(station_ids, ["CA-DOT", "HPMS-OH"])
            self.assertEqual(run.call_count, 2)
            self.assertEqual(result["station_count"], 2)

    def test_gateway_evidence_query_is_buffered_and_not_boundary_clipped(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            boundary = root / "boundary.geojson"
            database = root / "project_database.sqlite"
            output = root / "counts.csv"
            boundary.write_text(json.dumps({
                "type": "Polygon",
                "coordinates": [[[-80.9, 40.7], [-80.5, 40.7], [-80.5, 41], [-80.9, 41], [-80.9, 40.7]]],
            }))
            database.write_text("")
            calls = []

            def fake_builder(**kwargs):
                calls.append(kwargs)
                with kwargs["output_csv"].open("w", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=[
                        "station_id", "source_state", "bbox_min_lon", "bbox_max_lon",
                        "bbox_min_lat", "bbox_max_lat",
                    ])
                    writer.writeheader()
                    writer.writerow({
                        "station_id": "S1", "source_state": "39",
                        "bbox_min_lon": "-80.7", "bbox_max_lon": "-80.7",
                        "bbox_min_lat": "40.8", "bbox_max_lat": "40.8",
                    })
                    writer.writerow({
                        "station_id": "OUTSIDE", "source_state": "39",
                        "bbox_min_lon": "-80.95", "bbox_max_lon": "-80.95",
                        "bbox_min_lat": "40.8", "bbox_max_lat": "40.8",
                    })

                class Result:
                    returncode = 0
                    stderr = ""
                    stdout = ""

                return Result()

            bbox = (-80.90, 40.70, -80.50, 41.00)
            with patch.object(auto_counts, "_run_count_builder", side_effect=fake_builder):
                result = auto_counts.fetch_counts_for_study_area(
                    state_fips_codes={"39"},
                    boundary_geojson_path=boundary,
                    project_db=database,
                    output_csv=output,
                    bbox=bbox,
                )
            self.assertEqual(len(calls), 1)
            self.assertIsNone(calls[0]["boundary_geojson_path"])
            self.assertLess(calls[0]["bbox"][0], bbox[0])
            self.assertGreater(calls[0]["bbox"][2], bbox[2])
            self.assertTrue(Path(result["gateway_counts_csv"]).exists())
            with output.open(newline="") as handle:
                self.assertEqual([row["station_id"] for row in csv.DictReader(handle)], ["S1"])


if __name__ == "__main__":
    unittest.main()
