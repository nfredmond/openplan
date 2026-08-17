#!/usr/bin/env python3
"""Adopting another run's network — and every way that could be the wrong network.

Two demand models can only be compared if the roads under them are identical.
These tests exist because each refusal below, if it silently passed instead,
would produce a complete run, a converged assignment, and a corridor comparison
that attributes to the demand model a difference that came from the network.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import pandas as pd
from shapely.geometry import box, mapping

from screening_runtime import (
    ZONE_ATTRIBUTE_COLUMNS,
    boundary_fingerprint,
    build_network,
    reuse_network_from_run,
)

BOUNDARY = box(-121.2, 39.2, -120.8, 39.5)
OTHER_BOUNDARY = box(-122.2, 38.2, -121.8, 38.5)


def zone_row(zone_id: int, kind: str = "internal") -> dict:
    return {
        "GEOID": f"0605700{zone_id:04d}" if kind == "internal" else f"EXT{zone_id:04d}",
        "NAMELSAD": f"Zone {zone_id}",
        "zone_id": zone_id,
        "centroid_lon": -121.0,
        "centroid_lat": 39.3,
        "area_sq_mi": 2.0,
        "total_jobs": 10.0,
        "retail_jobs": 1.0,
        "health_jobs": 1.0,
        "education_jobs": 1.0,
        "accommodation_jobs": 1.0,
        "govt_jobs": 1.0,
        "est_population": 100.0,
        "households": 40.0,
        "worker_residents": 50.0,
        "area_share": 0.5,
        "zone_kind": kind,
    }


class ReuseNetworkFromRun(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / "source-run"
        self.dest = self.root / "dest-run"
        self.dest.mkdir(parents=True)
        self._write_source(BOUNDARY)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_source(self, boundary, *, internal_ids=(1, 2), externals=(3,)) -> None:
        (self.source / "work" / "aeq_project").mkdir(parents=True, exist_ok=True)
        (self.source / "work" / "aeq_project" / "project_database.sqlite").write_bytes(b"fake-project")
        (self.source / "boundary").mkdir(parents=True, exist_ok=True)
        (self.source / "boundary" / "analysis_boundary.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": mapping(boundary)}]})
        )
        (self.source / "work" / "network_setup_summary.json").write_text(
            json.dumps(
                {
                    "project_dir": str(self.source / "work" / "aeq_project"),
                    "centroid_map": {str(z): 900 + z for z in list(internal_ids) + list(externals)},
                    "gateways": [{"label": "I-80 west"}],
                    "internal_zone_count": len(internal_ids),
                    "external_zone_count": len(externals),
                }
            )
        )
        (self.source / "package").mkdir(parents=True, exist_ok=True)
        rows = [zone_row(z) for z in internal_ids] + [zone_row(z, "external") for z in externals]
        pd.DataFrame(rows)[list(ZONE_ATTRIBUTE_COLUMNS)].to_csv(
            self.source / "package" / "zone_attributes.csv", index=False
        )

    def incoming(self, ids=(1, 2)) -> pd.DataFrame:
        return pd.DataFrame([zone_row(z) for z in ids])[list(ZONE_ATTRIBUTE_COLUMNS)]

    def test_the_project_zone_system_and_gateways_all_come_across(self) -> None:
        summary, zones = reuse_network_from_run(self.dest, BOUNDARY, self.incoming(), self.source)

        copied = self.dest / "work" / "aeq_project" / "project_database.sqlite"
        self.assertTrue(copied.exists())
        self.assertEqual(copied.read_bytes(), b"fake-project")
        # project_dir must point at THIS run's copy, not the source's, or the
        # second run would assign into the first run's project directory.
        self.assertEqual(summary["project_dir"], str(self.dest / "work" / "aeq_project"))
        self.assertEqual(summary["centroid_map"], {"1": 901, "2": 902, "3": 903})
        # The external gateway zone rides along with the network it belongs to.
        self.assertEqual(sorted(int(z) for z in zones["zone_id"]), [1, 2, 3])
        self.assertEqual(list(zones[zones["zone_kind"] == "external"]["zone_id"]), [3])

    def test_the_reuse_is_recorded_where_a_reader_will_find_it(self) -> None:
        summary, _ = reuse_network_from_run(self.dest, BOUNDARY, self.incoming(), self.source)
        record = summary["network_reused_from"]
        self.assertEqual(record["run_name"], "source-run")
        self.assertEqual(record["boundary_sha256"], boundary_fingerprint(BOUNDARY))
        on_disk = json.loads((self.dest / "work" / "network_setup_summary.json").read_text())
        self.assertEqual(on_disk["network_reused_from"]["run_dir"], str(self.source.resolve()))

    def test_a_different_study_area_is_refused(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            reuse_network_from_run(self.dest, OTHER_BOUNDARY, self.incoming(), self.source)
        self.assertIn("different study area", str(ctx.exception))

    def test_a_different_zone_system_is_refused(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            reuse_network_from_run(self.dest, BOUNDARY, self.incoming(ids=(1, 2, 5)), self.source)
        self.assertIn("do not match", str(ctx.exception))

    def test_a_source_without_a_retained_project_names_the_missing_flag(self) -> None:
        import shutil

        shutil.rmtree(self.source / "work" / "aeq_project")
        with self.assertRaises(RuntimeError) as ctx:
            reuse_network_from_run(self.dest, BOUNDARY, self.incoming(), self.source)
        self.assertIn("--keep-project", str(ctx.exception))

    def test_each_missing_source_artifact_is_named(self) -> None:
        for relative, expected in (
            ("work/network_setup_summary.json", "network setup summary"),
            ("package/zone_attributes.csv", "zone table"),
            ("boundary/analysis_boundary.geojson", "analysis boundary"),
        ):
            with self.subTest(relative=relative):
                self._write_source(BOUNDARY)
                (self.source / relative).unlink()
                with self.assertRaises(RuntimeError) as ctx:
                    reuse_network_from_run(self.dest, BOUNDARY, self.incoming(), self.source)
                self.assertIn(expected, str(ctx.exception))

    def test_build_network_routes_to_reuse_without_touching_osm(self) -> None:
        """The flag must reach the reuse path — if build_network ignored it the
        run would download a different network and still look successful."""
        summary, zones = build_network(
            self.dest, BOUNDARY, self.incoming(), 2.0, reuse_network_from=str(self.source)
        )
        self.assertIn("network_reused_from", summary)
        self.assertEqual(len(zones), 3)

    def test_the_fingerprint_ignores_formatting_but_not_shape(self) -> None:
        from shapely.geometry import shape

        round_tripped = shape(json.loads(json.dumps(mapping(BOUNDARY))))
        self.assertEqual(boundary_fingerprint(round_tripped), boundary_fingerprint(BOUNDARY))
        self.assertNotEqual(boundary_fingerprint(OTHER_BOUNDARY), boundary_fingerprint(BOUNDARY))


if __name__ == "__main__":
    unittest.main()
