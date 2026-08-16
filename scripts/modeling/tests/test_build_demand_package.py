#!/usr/bin/env python3
"""A demand package must never claim a zone resolution it did not achieve.

Block-group refinement can fail — a study area may have no block-group coverage,
or the LEHD residence files that disaggregate tract population may be
unavailable — and the producer falls back to tract zones when it does. That
fallback is the dangerous kind: the run completes, the package is valid, and
nothing in it looks different from a run that asked for tracts in the first
place.

Zone resolution is the measured limit on this model's link volumes, so "did I
get the finer zones I asked for?" is a question every downstream reader has to
be able to answer. These tests hold the producer to answering it.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import build_demand_package as builder  # noqa: E402


class _FakeGeometry:
    __geo_interface__ = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}


def run_builder(tmpdir: Path, *, requested: str, achieved: str) -> dict:
    """Drive the builder with a stubbed producer that reports `achieved`."""
    captured: dict = {}

    def fake_generate_package(**kwargs):
        captured.update(kwargs)
        return {"zones": 80 if achieved == "block_group" else 26, "zone_geography": achieved}

    fake_module = type(sys)("data_pipeline")
    fake_module.generate_package = fake_generate_package

    with patch.dict(sys.modules, {"data_pipeline": fake_module}), patch.object(
        builder, "resolve_boundary", return_value={"geometry": _FakeGeometry(), "source": "county-fips", "label": "Test County"}
    ):
        manifest = builder.build_demand_package(
            boundary_geojson=None,
            county_fips="06057",
            output_dir=str(tmpdir),
            zone_geography=requested,
        )
    manifest["_captured"] = captured
    return manifest


class ZoneGeographyHonestyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_a_silent_fallback_is_recorded_as_a_fallback(self) -> None:
        """THE CHECK THIS FILE EXISTS FOR. Asked for block groups, got tracts."""
        manifest = run_builder(self.dir, requested="block_group", achieved="tract")

        self.assertEqual(manifest["zone_geography_requested"], "block_group")
        self.assertEqual(manifest["zone_geography_achieved"], "tract")
        self.assertTrue(manifest["zone_geography_fell_back"])

    def test_getting_what_was_asked_for_is_not_reported_as_a_fallback(self) -> None:
        # The negative control: a flag that is always true says nothing.
        manifest = run_builder(self.dir, requested="block_group", achieved="block_group")
        self.assertFalse(manifest["zone_geography_fell_back"])

    def test_asking_for_tracts_and_getting_them_is_not_a_fallback(self) -> None:
        manifest = run_builder(self.dir, requested="tract", achieved="tract")
        self.assertFalse(manifest["zone_geography_fell_back"])

    def test_the_record_is_written_to_disk_where_a_reader_will_find_it(self) -> None:
        # An in-memory return value nobody persists is not a paper trail. The
        # assignment step reads this file and carries it into the run.
        run_builder(self.dir, requested="block_group", achieved="tract")
        written = json.loads((self.dir / "manifest.json").read_text())
        self.assertTrue(written["zone_geography_fell_back"])
        self.assertEqual(written["zone_geography_achieved"], "tract")

    def test_the_study_area_polygon_is_passed_not_just_its_bounding_box(self) -> None:
        """A bounding box around any real county overlaps its neighbours, and
        the producer keeps a tract whose CENTROID falls inside the geometry it
        is given. Passing the polygon is what stops a county's package from
        quietly including the next county's tracts."""
        manifest = run_builder(self.dir, requested="block_group", achieved="block_group")
        self.assertEqual(
            manifest["_captured"]["corridor_geojson"], _FakeGeometry.__geo_interface__
        )
        self.assertEqual(manifest["_captured"]["zone_geography"], "block_group")

    def test_the_study_area_is_named_in_the_manifest(self) -> None:
        manifest = run_builder(self.dir, requested="tract", achieved="tract")
        self.assertEqual(manifest["study_area"]["county_fips"], "06057")
        self.assertEqual(manifest["study_area"]["label"], "Test County")


if __name__ == "__main__":
    unittest.main()
