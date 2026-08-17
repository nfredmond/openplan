#!/usr/bin/env python3
"""How many ways in and out of a study area the model is allowed to know about.

WHAT THE CAP COSTS, MEASURED
============================
On the county this was written against, `network_setup_summary.json` recorded:

    "18 boundary crossings remained after corridor grouping;
     kept the 8 busiest and dropped 10."

Ten real ways in and out of the county, discarded by a hardcoded number. Two of
the dropped crossings carry state highways with published counts of 12,200 and
5,100 vehicles a day, and the model assigns **zero** traffic to both — because a
road whose whole purpose is leaving the study area has no trips at all once its
gateway is gone.

The traffic that should have entered on those roads does not disappear from the
model; it is injected at the crossings that were kept. So the cap is a candidate
explanation for both symptoms at once: roads with no gateway carrying nothing,
and the roads that kept theirs carrying two to three times too much.

The cap itself is not wrong — a study area with a hundred farm tracks crossing
its line does not need a hundred cordon zones. What was wrong is that it could
only be changed by editing a constant, so nobody could find out what it cost.
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


def reload_runtime(env: dict[str, str]):
    with mock.patch.dict(os.environ, env, clear=False):
        import screening_runtime

        return importlib.reload(screening_runtime)


class TheGatewayCap(unittest.TestCase):
    @classmethod
    def tearDownClass(cls) -> None:
        os.environ.pop("OPENPLAN_MAX_GATEWAYS", None)
        import screening_runtime

        importlib.reload(screening_runtime)

    def test_the_default_is_unchanged(self) -> None:
        os.environ.pop("OPENPLAN_MAX_GATEWAYS", None)
        self.assertEqual(reload_runtime({}).MAX_GATEWAYS, 8)

    def test_a_study_area_can_model_every_crossing_it_has(self) -> None:
        self.assertEqual(reload_runtime({"OPENPLAN_MAX_GATEWAYS": "24"}).MAX_GATEWAYS, 24)

    def test_the_detector_takes_the_configured_cap_as_its_default(self) -> None:
        # The override has to reach the function's DEFAULT argument, not just
        # sit in a module constant nobody passes. A caller that never mentions
        # the cap is the only caller there is.
        import inspect

        runtime = reload_runtime({"OPENPLAN_MAX_GATEWAYS": "24"})
        signature = inspect.signature(runtime.detect_external_gateways)
        self.assertEqual(signature.parameters["max_gateways"].default, 24)


class WhatTheCapMustAlwaysDisclose(unittest.TestCase):
    def test_the_note_names_how_many_crossings_were_dropped(self) -> None:
        # THIS SENTENCE IS WHY THE DEFECT WAS FINDABLE. It is the only record
        # that ten ways in and out of a county were discarded.
        runtime = reload_runtime({})
        note = runtime.gateway_cap_note(18, 8)

        self.assertIn("18 boundary crossings", note)
        self.assertIn("dropped 10", note)

    def test_the_note_says_what_a_dropped_crossing_costs(self) -> None:
        # "Capped at 8" reads as housekeeping. What it actually means is that a
        # road existing mainly to leave the study area now carries nothing.
        note = reload_runtime({}).gateway_cap_note(18, 8)

        self.assertIn("carry no traffic at all", note)
        self.assertIn("injected at the crossings that were kept", note)
        self.assertIn("OPENPLAN_MAX_GATEWAYS", note)

    def test_a_study_area_inside_the_cap_reports_nothing_dropped(self) -> None:
        self.assertIn("dropped 0", reload_runtime({}).gateway_cap_note(5, 8))


if __name__ == "__main__":
    unittest.main()
