#!/usr/bin/env python3
"""Exact observed-count reuse for controlled model comparisons."""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import box, mapping

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from screening_runtime import reuse_study_area_counts  # noqa: E402


BOUNDARY = box(-81.0, 40.0, -80.0, 41.0)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ReuseStudyAreaCounts(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.destination = self.root / "destination"
        (self.source / "boundary").mkdir(parents=True)
        (self.source / "counts").mkdir()
        (self.source / "boundary" / "analysis_boundary.geojson").write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {"type": "Feature", "properties": {}, "geometry": mapping(BOUNDARY)}
                    ],
                }
            )
        )
        counts = self.source / "counts" / "published_counts.csv"
        gateway = self.source / "counts" / "published_counts.gateway.csv"
        counts.write_text("station_id,observed_volume\ninside,100\n")
        gateway.write_text("station_id,observed_volume\ninside,100\noutside,200\n")
        published = {
            "available": True,
            "counts_csv": str(counts),
            "gateway_counts_csv": str(gateway),
            "station_count": 1,
            "sources": [{"source": "us-fhwa-hpms-2024"}],
            "artifact_hashes": {
                "counts_csv": sha256(counts),
                "gateway_counts_csv": sha256(gateway),
            },
        }
        (self.source / "bundle_manifest.json").write_text(
            json.dumps({"published_counts": published})
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_both_exact_artifacts_are_copied_and_provenance_is_retained(self) -> None:
        reused = reuse_study_area_counts(self.destination, BOUNDARY, self.source)
        self.assertEqual(Path(reused["counts_csv"]).read_text(), "station_id,observed_volume\ninside,100\n")
        self.assertIn("outside,200", Path(reused["gateway_counts_csv"]).read_text())
        self.assertEqual(reused["station_count"], 1)
        self.assertEqual(reused["reused_from_run"]["run_name"], "source")
        self.assertEqual(
            reused["reused_from_run"]["artifact_hashes"], reused["artifact_hashes"]
        )

    def test_an_altered_source_artifact_is_refused(self) -> None:
        with (self.source / "counts" / "published_counts.gateway.csv").open("a") as handle:
            handle.write("late-row,999\n")
        with self.assertRaisesRegex(RuntimeError, "hash changed"):
            reuse_study_area_counts(self.destination, BOUNDARY, self.source)

    def test_a_different_boundary_is_refused(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "different study area"):
            reuse_study_area_counts(
                self.destination, box(-122.0, 38.0, -121.0, 39.0), self.source
            )

    def test_unhashed_legacy_artifacts_are_refused(self) -> None:
        manifest_path = self.source / "bundle_manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["published_counts"].pop("artifact_hashes")
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, "predates hashed"):
            reuse_study_area_counts(self.destination, BOUNDARY, self.source)

    def test_calibration_partitions_are_not_reconstructed(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "calibration"):
            reuse_study_area_counts(self.destination, BOUNDARY, self.source, calibrate=True)


if __name__ == "__main__":
    unittest.main()
