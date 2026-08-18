#!/usr/bin/env python3
"""Splitting network VMT into what the county generates and what passes through.

The number decides what to fix next in the modelling lane, and it is easy to get
wrong in a way that looks right: an earlier estimate subtracted
`internal_trips x avg_trip_miles`, where that mean is centroid-to-centroid
rather than the assigned path, and overstated the external share. These checks
are about the pairing being valid, because an invalid pair still produces a
plausible percentage.
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

import external_demand_share as eds


def make_run(root: Path, name: str, *, scalar: float, county: str = "06047", vmt: float | None = None) -> Path:
    run = root / name
    (run / "run_output").mkdir(parents=True)
    (run / "run_summary.json").write_text(json.dumps({
        "manifest": {
            "study_area": {"county_fips": county},
            "demand": {"total_trips": 1_000_000, "external_trips": 260_000,
                       "trip_rates": {"external_demand_scalar": scalar}},
        }
    }))
    if vmt is not None:
        run._fake_vmt = vmt  # noqa: SLF001 - test-local marker, see setUp patch
    return run


class ThePairMustActuallyBeAPair(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.vmt: dict[str, float] = {}
        self._real = eds.network_vmt
        eds.network_vmt = lambda run_dir: self.vmt[Path(run_dir).name]

    def tearDown(self) -> None:
        eds.network_vmt = self._real
        self.tmp.cleanup()

    def test_a_valid_pair_splits_the_vehicle_miles(self) -> None:
        full = make_run(self.root, "full", scalar=1.0)
        internal = make_run(self.root, "noext", scalar=0.0)
        self.vmt = {"full": 10_000_000.0, "noext": 4_000_000.0}
        result = eds.decompose(full, internal)
        self.assertEqual(result["external_daily_vmt"], 6_000_000.0)
        self.assertEqual(result["external_share_of_network_vmt"], 0.6)

    def test_a_comparison_run_that_still_had_external_demand_is_refused(self) -> None:
        # The whole measurement rests on this one property, and a run named
        # "noext" that was launched without the flag looks identical on disk.
        full = make_run(self.root, "full", scalar=1.0)
        internal = make_run(self.root, "noext", scalar=1.0)
        self.vmt = {"full": 10_000_000.0, "noext": 9_900_000.0}
        with self.assertRaises(eds.ExternalShareError) as caught:
            eds.decompose(full, internal)
        self.assertIn("not an internal-only run", str(caught.exception))

    def test_two_counties_are_refused_rather_than_subtracted(self) -> None:
        full = make_run(self.root, "full", scalar=1.0, county="06047")
        internal = make_run(self.root, "noext", scalar=0.0, county="06069")
        self.vmt = {"full": 10_000_000.0, "noext": 1_000_000.0}
        with self.assertRaises(eds.ExternalShareError) as caught:
            eds.decompose(full, internal)
        self.assertIn("different counties", str(caught.exception))

    def test_two_internal_only_runs_measure_nothing(self) -> None:
        full = make_run(self.root, "full", scalar=0.0)
        internal = make_run(self.root, "noext", scalar=0.0)
        self.vmt = {"full": 4_000_000.0, "noext": 4_000_000.0}
        with self.assertRaises(eds.ExternalShareError):
            eds.decompose(full, internal)

    def test_the_scalar_comes_from_the_run_not_its_name(self) -> None:
        # A directory called "noext" that recorded scalar 1.0 must be caught,
        # because the name is the one thing nobody verifies.
        full = make_run(self.root, "full", scalar=1.0)
        internal = make_run(self.root, "noext", scalar=0.5)
        self.vmt = {"full": 10_000_000.0, "noext": 7_000_000.0}
        with self.assertRaises(eds.ExternalShareError) as caught:
            eds.decompose(full, internal)
        self.assertIn("0.5", str(caught.exception))

    def test_an_unfinished_run_is_named_rather_than_treated_as_zero(self) -> None:
        full = make_run(self.root, "full", scalar=1.0)
        internal = self.root / "noext"
        (internal / "run_output").mkdir(parents=True)
        with self.assertRaises(eds.ExternalShareError) as caught:
            eds.decompose(full, internal)
        self.assertIn("did not finish", str(caught.exception))

    def test_the_stated_bias_travels_with_the_number(self) -> None:
        full = make_run(self.root, "full", scalar=1.0)
        internal = make_run(self.root, "noext", scalar=0.0)
        self.vmt = {"full": 10_000_000.0, "noext": 4_000_000.0}
        self.assertIn("less congested", eds.decompose(full, internal)["bias"])


class TheMedianAcrossCounties(unittest.TestCase):
    def test_it_reports_the_spread_not_only_the_middle(self) -> None:
        rows = [{"external_share_of_network_vmt": v} for v in (0.31, 0.55, 0.62, 0.70, 0.71)]
        summary = eds.summarize(rows)
        self.assertEqual(summary["counties"], 5)
        self.assertEqual(summary["median_external_share_of_network_vmt"], 0.62)
        self.assertEqual(summary["lowest"], 0.31)
        self.assertEqual(summary["highest"], 0.71)

    def test_no_counties_is_not_a_zero_share(self) -> None:
        self.assertEqual(eds.summarize([]), {"counties": 0})


if __name__ == "__main__":
    unittest.main(verbosity=1)
