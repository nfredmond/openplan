#!/usr/bin/env python3
"""The lever on trip length, and the record that says it was pulled.

Measured 2026-08-17 across 24 counties: OpenPlan's screening model produces
2.16x the published VMT per capita, and miles-per-trip correlates +0.93 with
that overshoot. Trip length is the defect; the gravity deterrence is its lever.

These tests pin the arithmetic and — more importantly — that a run RECORDS the
gammas it actually used. A run whose trip lengths were shaped by a multiplier
its own paper trail does not mention is a run nobody can check.
"""
from __future__ import annotations

import importlib
import os
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import numpy as np

import screening_runtime as sr


class TheMultiplierShortensTrips(unittest.TestCase):
    """Higher gamma decays distance faster, so trips get shorter. If this ever
    inverts, a calibration would push the model the wrong way while the number
    it reports still moves."""

    def mean_trip_length(self, gamma: float) -> float:
        # Three zones in a line: 0, 5 and 20 minutes apart.
        impedance = np.array([[1.0, 5.0, 20.0], [5.0, 1.0, 15.0], [20.0, 15.0, 1.0]])
        productions = np.array([100.0, 100.0, 100.0])
        attractions = np.array([100.0, 100.0, 100.0])
        trips = sr.gravity_distribute(productions, attractions, impedance, gamma)
        return float((trips * impedance).sum() / trips.sum())

    def test_a_higher_gamma_produces_shorter_trips(self) -> None:
        self.assertLess(self.mean_trip_length(3.0), self.mean_trip_length(1.5))

    def test_the_relationship_is_monotonic_across_the_fitting_range(self) -> None:
        lengths = [self.mean_trip_length(g) for g in (0.9, 1.35, 1.8, 2.7, 4.5)]
        self.assertEqual(lengths, sorted(lengths, reverse=True))


class TheMultiplierIsReachableAndRecorded(unittest.TestCase):
    def reload_with(self, value: str | None) -> float:
        previous = os.environ.get("OPENPLAN_GAMMA_MULTIPLIER")
        if value is None:
            os.environ.pop("OPENPLAN_GAMMA_MULTIPLIER", None)
        else:
            os.environ["OPENPLAN_GAMMA_MULTIPLIER"] = value
        try:
            return importlib.reload(sr).GAMMA_MULTIPLIER
        finally:
            if previous is None:
                os.environ.pop("OPENPLAN_GAMMA_MULTIPLIER", None)
            else:
                os.environ["OPENPLAN_GAMMA_MULTIPLIER"] = previous
            importlib.reload(sr)

    def test_the_shipped_default_is_unchanged_behaviour(self) -> None:
        # 1.0 until a pre-registered experiment moves it.
        self.assertEqual(self.reload_with(None), 1.0)

    def test_it_can_be_set_without_editing_code(self) -> None:
        # An experiment that needs a source edit is one nobody re-runs.
        self.assertEqual(self.reload_with("1.75"), 1.75)

    def test_the_run_records_the_gammas_it_actually_used(self) -> None:
        """THE POINT OF THE WHOLE PARAGRAPH. A run whose trip lengths were
        shaped by a multiplier its paper trail does not mention cannot be
        checked by anyone who was not present."""
        os.environ["OPENPLAN_GAMMA_MULTIPLIER"] = "2.0"
        try:
            module = importlib.reload(sr)
            assumptions = module.model_assumptions()["trip_distribution_deterrence"]
            self.assertEqual(assumptions["gamma_multiplier"], 2.0)
            self.assertAlmostEqual(assumptions["home_based_work_gamma"], module.HBW_GAMMA * 2.0)
            self.assertAlmostEqual(assumptions["home_based_other_gamma"], module.HBO_GAMMA * 2.0)
            self.assertAlmostEqual(assumptions["non_home_based_gamma"], module.NHB_GAMMA * 2.0)
        finally:
            os.environ.pop("OPENPLAN_GAMMA_MULTIPLIER", None)
            importlib.reload(sr)

    def test_the_default_run_records_the_unmultiplied_gammas(self) -> None:
        assumptions = sr.model_assumptions()["trip_distribution_deterrence"]
        self.assertEqual(assumptions["gamma_multiplier"], 1.0)
        self.assertEqual(assumptions["home_based_work_gamma"], sr.HBW_GAMMA)

    def test_the_provenance_still_says_these_were_fitted_to_nothing(self) -> None:
        # Until a pre-registered experiment says otherwise, and the sentence is
        # what stops a multiplied run reading as a calibrated one.
        provenance = sr.model_assumptions()["provenance"]
        self.assertIn("not drawn from a published", provenance)


if __name__ == "__main__":
    unittest.main()
