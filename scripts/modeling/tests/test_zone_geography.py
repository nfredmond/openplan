#!/usr/bin/env python3
"""Zone resolution is a choice, and the choice has to reach the data.

Zone size IS the model's spatial resolution: a trip beginning and ending inside
one zone carries VMT and no link volume, so a coarse zone system cannot put
local traffic on local roads at all. Block groups are roughly three times finer
than tracts and cost proportionally more runtime — which OpenPlan spends,
because a defensible number matters more than a fast one.

These tests hold the parts that would otherwise fail silently: asking for block
groups must actually query block groups, must build 12-digit identifiers (which
is how everything downstream RECOGNISES the geography rather than being told),
and the default must stay tracts.
"""
from __future__ import annotations

import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import screening_runtime as sr


class TheGeographiesOnOffer(unittest.TestCase):
    def test_both_published_geographies_are_registered(self) -> None:
        self.assertEqual(sorted(sr.ZONE_GEOGRAPHIES), ["block_group", "tract"])

    def test_each_names_its_own_tiger_layer(self) -> None:
        tract_template, tract_tag = sr.ZONE_GEOGRAPHIES["tract"]
        bg_template, bg_tag = sr.ZONE_GEOGRAPHIES["block_group"]
        self.assertIn("/TRACT/", tract_template)
        self.assertIn("/BG/", bg_template)
        # The cache filename must differ, or one geography would serve the
        # other's download from cache and nobody would see it happen.
        self.assertNotEqual(tract_tag, bg_tag)

    def test_the_default_is_tracts(self) -> None:
        self.assertEqual(sr.DEFAULT_ZONE_GEOGRAPHY, "tract")

    def test_an_unknown_geography_is_refused_by_name(self) -> None:
        with self.assertRaises(sr.ConfigurationError) as ctx:
            sr.build_zone_package(object(), Path("/tmp"), Path("/tmp"), "county")
        self.assertIn("county", str(ctx.exception))
        self.assertIn("block_group", str(ctx.exception))


class TheAcsQueryFollowsTheChoice(unittest.TestCase):
    """A block-group run that quietly fetched tract totals would give every
    block group in a tract the same population."""

    def fetch(self, geography: str):
        captured = {}

        class Response:
            status_code = 200
            text = ""
            url = "https://api.census.gov/data/2022/acs/acs5"

            def raise_for_status(self):
                return None

            def json(self):
                if geography == "block_group":
                    return [
                        ["NAME", "B01003_001E", "B11001_001E", "B23025_004E", "state", "county", "tract", "block group"],
                        ["BG 1", "1200", "400", "600", "06", "057", "000100", "1"],
                        ["BG 2", "900", "300", "450", "06", "057", "000100", "2"],
                    ]
                return [
                    ["NAME", "B01003_001E", "B11001_001E", "B23025_004E", "state", "county", "tract"],
                    ["Tract 1", "2100", "700", "1050", "06", "057", "000100"],
                ]

        def fake_get(url, params=None, timeout=None):
            captured.update(params or {})
            return Response()

        with mock.patch.object(sr.requests, "get", fake_get):
            frame = sr.fetch_acs_tract_attributes({("06", "057")}, geography)
        return captured, frame

    def test_asking_for_block_groups_queries_block_groups(self) -> None:
        params, frame = self.fetch("block_group")
        self.assertEqual(params["for"], "block group:*")
        self.assertIn("tract:*", params["in"])
        # 12-digit identifiers: how every downstream step recognises the
        # geography, including the population synthesiser.
        self.assertEqual(sorted(frame["geoid"]), ["060570001001", "060570001002"])
        self.assertTrue(all(len(g) == 12 for g in frame["geoid"]))

    def test_asking_for_tracts_is_unchanged(self) -> None:
        params, frame = self.fetch("tract")
        self.assertEqual(params["for"], "tract:*")
        self.assertNotIn("tract:*", params["in"])
        self.assertEqual(list(frame["geoid"]), ["06057000100"])
        self.assertTrue(all(len(g) == 11 for g in frame["geoid"]))

    def test_the_finer_geography_returns_more_zones_for_one_tract(self) -> None:
        _, tracts = self.fetch("tract")
        _, groups = self.fetch("block_group")
        self.assertGreater(len(groups), len(tracts))


class TheChoiceIsReachableWithoutEditingCode(unittest.TestCase):
    def reload_with(self, value: str | None):
        previous = os.environ.get("OPENPLAN_ZONE_GEOGRAPHY")
        if value is None:
            os.environ.pop("OPENPLAN_ZONE_GEOGRAPHY", None)
        else:
            os.environ["OPENPLAN_ZONE_GEOGRAPHY"] = value
        try:
            # The value is read INSIDE the try: `sr` is one module object, so
            # the restoring reload below would overwrite it before any caller
            # could look.
            reloaded = importlib.reload(sr)
            return reloaded.DEFAULT_ZONE_GEOGRAPHY
        finally:
            if previous is None:
                os.environ.pop("OPENPLAN_ZONE_GEOGRAPHY", None)
            else:
                os.environ["OPENPLAN_ZONE_GEOGRAPHY"] = previous
            importlib.reload(sr)

    def test_the_environment_can_select_block_groups(self) -> None:
        self.assertEqual(self.reload_with("block_group"), "block_group")

    def test_and_the_default_survives_the_override(self) -> None:
        self.reload_with("block_group")
        self.assertEqual(sr.DEFAULT_ZONE_GEOGRAPHY, "tract")

    def test_the_cli_exposes_both_choices(self) -> None:
        import run_screening_model

        parser_actions = {}

        class Recorder:
            def add_argument(self, *args, **kwargs):
                if args and args[0].startswith("--"):
                    parser_actions[args[0]] = kwargs

            def parse_args(self):
                return None

        with mock.patch.object(run_screening_model.argparse, "ArgumentParser", lambda **_: Recorder()):
            run_screening_model.parse_args()
        self.assertIn("--zone-geography", parser_actions)
        self.assertEqual(parser_actions["--zone-geography"]["choices"], ["tract", "block_group"])


if __name__ == "__main__":
    unittest.main()
