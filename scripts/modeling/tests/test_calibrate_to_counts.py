#!/usr/bin/env python3
"""Calibration may not report the accuracy of the data it was fitted to.

WHY THESE ARE THE TESTS THAT MATTER
===================================
Calibration is the one place in this model where it is trivially easy to
produce an impressive, meaningless number: fit parameters to a set of counts,
then report the error against those same counts. It will look excellent and
mean nothing.

Every test here is about the machinery that stops that — the holdout that is
never fitted, the requirement that a step improve the HELD-OUT objective, and
the rule that calibrating does not by itself grant a passing gate.

The loop's assignment and matching are injected, so the whole decision sequence
can be driven to the exact cases that matter without running a real model.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
WORKER_DIR = SCRIPT_DIR.parents[1] / "workers" / "aequilibrae_worker"
for _candidate in (SCRIPT_DIR, WORKER_DIR):
    if str(_candidate) not in sys.path:
        sys.path.insert(0, str(_candidate))

import calibration  # noqa: E402
from calibrate_to_counts import (  # noqa: E402
    CalibrationUnavailable,
    attach_modelled_volumes,
    calibrate,
)


def stations(count: int, *, observed: float = 10000.0) -> list[dict]:
    """`count` matched stations spread over two road classes."""
    return [
        {
            "station_id": f"S{i:03d}",
            "facility_name": f"Route {i % 4}",
            "link_id": i,
            "matched_link_type": "trunk" if i % 2 else "primary",
            "observed_volume": observed,
        }
        for i in range(1, count + 1)
    ]


def volumes(matched: list[dict], value: float) -> dict[int, float]:
    return {int(s["link_id"]): value for s in matched}


class HoldoutRefusalTests(unittest.TestCase):
    """Refuses rather than reporting an accuracy it cannot stand behind."""

    def test_too_few_stations_to_hold_any_back(self) -> None:
        with self.assertRaises(CalibrationUnavailable) as caught:
            calibrate(
                matched_stations=stations(1),
                reassign=lambda factors: {},
                baseline_volumes={1: 5000.0},
            )
        self.assertIn("holdout", str(caught.exception))

    def test_some_counts_are_always_held_back_however_small_the_fraction(self) -> None:
        """Asking for a zero holdout does not get you one.

        The shared engine guarantees a non-empty holdout whenever two or more
        stations exist, precisely so a run cannot claim the calibrated tier
        without out-of-sample evidence. Asserted here through the public path,
        because this driver's own refusal branch would otherwise be the only
        thing standing between a caller and an unvalidated claim — and it is
        belt-and-braces, not the mechanism.
        """
        matched = stations(10)
        for requested in (0.0, 0.01, 0.5):
            result = calibrate(
                matched_stations=matched,
                reassign=lambda factors: volumes(matched, 10000.0),
                baseline_volumes=volumes(matched, 5000.0),
                holdout_frac=requested,
                max_iterations=1,
            )
            self.assertGreater(
                result["holdout_station_count"], 0, f"holdout_frac={requested} kept nothing back"
            )
            self.assertGreater(result["fit_station_count"], 0)


class OverfitGuardTests(unittest.TestCase):
    """A step must improve the HELD-OUT counts, not the fitted ones."""

    def setUp(self) -> None:
        self.matched = stations(20)
        # The model under-assigns by half everywhere, so there is a real,
        # correctable bias for the loop to find.
        self.baseline = volumes(self.matched, 5000.0)

    def test_a_step_that_improves_the_holdout_is_accepted(self) -> None:
        result = calibrate(
            matched_stations=self.matched,
            reassign=lambda factors: volumes(self.matched, 10000.0),
            baseline_volumes=self.baseline,
            max_iterations=1,
        )
        self.assertEqual(result["accepted_iterations"], 1)
        self.assertLess(result["calibrated"]["holdout"]["median_ape"],
                        result["baseline"]["holdout"]["median_ape"])

    def test_a_step_that_worsens_the_holdout_is_rejected(self) -> None:
        """THE OVERFIT GUARD. The trial is far worse out-of-sample; it must be
        thrown away and the baseline kept, with nothing promoted."""
        result = calibrate(
            matched_stations=self.matched,
            reassign=lambda factors: volumes(self.matched, 500_000.0),
            baseline_volumes=self.baseline,
            max_iterations=3,
        )
        self.assertEqual(result["accepted_iterations"], 0)
        self.assertEqual(result["class_factors"], {})
        # And the reported accuracy is the baseline's, unchanged.
        self.assertEqual(result["calibrated"]["holdout"], result["baseline"]["holdout"])

    def test_a_step_that_changes_nothing_is_not_accepted(self) -> None:
        """An identical-objective step is a no-op and must never move a run into
        the calibrated tier — otherwise a run could claim calibration for having
        done nothing at all."""
        result = calibrate(
            matched_stations=self.matched,
            reassign=lambda factors: volumes(self.matched, 5000.0),
            baseline_volumes=self.baseline,
            max_iterations=3,
        )
        self.assertEqual(result["accepted_iterations"], 0)

    def test_the_loop_stops_rather_than_spinning(self) -> None:
        calls: list[dict] = []

        def reassign(factors):
            calls.append(factors)
            return volumes(self.matched, 500_000.0)

        calibrate(
            matched_stations=self.matched,
            reassign=reassign,
            baseline_volumes=self.baseline,
            max_iterations=5,
        )
        # One rejected trial ends it. A loop that kept trying after a rejection
        # would burn a full assignment per iteration for nothing.
        self.assertEqual(len(calls), 1)


class JudgedOnHeldOutDataTests(unittest.TestCase):
    """THE test for this module, and the one my first pass did not actually have.

    Every fixture above gives fit and holdout stations the same volumes, so a
    loop judging steps on the FIT set passes them all identically. That mutation
    survived — meaning the single property this whole module exists to enforce
    was untested.

    This constructs the exact shape of overfitting: a trial that is PERFECT on
    the stations it was fitted to and badly wrong on the ones held back. Judged
    on the fit set it looks like a triumph; judged out-of-sample it is a
    disaster, and it must be rejected.
    """

    def setUp(self) -> None:
        self.matched = stations(20)
        # Learn the actual split — it is deterministic from (seed, station set),
        # which is what makes this constructible at all.
        self.fit, self.holdout = calibration.split_holdout(self.matched)
        self.fit_ids = {int(s["link_id"]) for s in self.fit}
        self.baseline = volumes(self.matched, 5000.0)

    def test_a_trial_that_is_perfect_on_fit_and_wrong_on_holdout_is_rejected(self) -> None:
        def overfitting_reassign(factors):
            # Exactly right where it was fitted; an order of magnitude out
            # everywhere it was not.
            return {
                int(s["link_id"]): (10000.0 if int(s["link_id"]) in self.fit_ids else 200_000.0)
                for s in self.matched
            }

        result = calibrate(
            matched_stations=self.matched,
            reassign=overfitting_reassign,
            baseline_volumes=self.baseline,
            max_iterations=3,
        )

        self.assertEqual(result["accepted_iterations"], 0, "an overfitting step was accepted")
        self.assertEqual(result["class_factors"], {})
        # And the trial's flattering fit-set accuracy must not be what gets
        # reported: the run keeps the baseline's held-out figure.
        self.assertEqual(result["holdout_median_ape"], result["baseline"]["holdout"]["median_ape"])

    def test_a_trial_that_helps_the_holdout_is_still_accepted(self) -> None:
        # The negative control: the guard must not simply reject everything.
        def honest_reassign(factors):
            return volumes(self.matched, 10000.0)

        result = calibrate(
            matched_stations=self.matched,
            reassign=honest_reassign,
            baseline_volumes=self.baseline,
            max_iterations=1,
        )
        self.assertEqual(result["accepted_iterations"], 1)


class DisclosureTests(unittest.TestCase):
    """What the run has to say about itself afterwards."""

    def setUp(self) -> None:
        self.matched = stations(20)
        self.result = calibrate(
            matched_stations=self.matched,
            reassign=lambda factors: volumes(self.matched, 10000.0),
            baseline_volumes=volumes(self.matched, 5000.0),
            max_iterations=1,
        )

    def test_the_reported_accuracy_is_named_as_held_out(self) -> None:
        self.assertIn("held-out", self.result["reported_accuracy_basis"])
        self.assertEqual(
            self.result["holdout_median_ape"],
            self.result["calibrated"]["holdout"]["median_ape"],
        )

    def test_the_baseline_is_reported_beside_the_result(self) -> None:
        # Without the before, "12% error" says nothing about what calibration
        # bought — or whether it bought anything.
        self.assertIsNotNone(self.result["baseline"]["holdout"]["median_ape"])
        self.assertIsNotNone(self.result["calibrated"]["holdout"]["median_ape"])

    def test_the_fit_and_holdout_station_counts_are_both_stated(self) -> None:
        self.assertEqual(
            self.result["fit_station_count"] + self.result["holdout_station_count"],
            len(self.matched),
        )
        self.assertGreater(self.result["holdout_station_count"], 0)

    def test_the_caveat_says_it_does_not_grant_a_passing_gate(self) -> None:
        # Calibration changes the model, not the standard.
        self.assertIn("does not by itself make a run pass", self.result["caveat"])
        self.assertIn("held-out", self.result["caveat"])

    def test_the_split_is_reproducible_and_says_how(self) -> None:
        # A calibration nobody can reproduce is not evidence. The seed and the
        # fraction travel with the result.
        self.assertIn("holdout_seed", self.result)
        self.assertIn("holdout_fraction", self.result)
        again = calibrate(
            matched_stations=self.matched,
            reassign=lambda factors: volumes(self.matched, 10000.0),
            baseline_volumes=volumes(self.matched, 5000.0),
            max_iterations=1,
        )
        self.assertEqual(again["fit_station_count"], self.result["fit_station_count"])
        self.assertEqual(again["class_factors"], self.result["class_factors"])


class VolumeAttachmentTests(unittest.TestCase):
    def test_a_link_with_no_assigned_traffic_reads_as_zero_not_missing(self) -> None:
        matched = stations(2)
        attached = attach_modelled_volumes(matched, {1: 4200.0})
        self.assertEqual(attached[0]["modeled_daily_pce"], 4200.0)
        # Zero is the honest reading: the assignment ran and put nothing there.
        self.assertEqual(attached[1]["modeled_daily_pce"], 0.0)

    def test_the_input_stations_are_not_mutated(self) -> None:
        # The loop re-attaches volumes every iteration; mutating in place would
        # make each iteration's evaluation depend on the last one's.
        matched = stations(2)
        attach_modelled_volumes(matched, {1: 4200.0, 2: 1.0})
        self.assertNotIn("modeled_daily_pce", matched[0])


if __name__ == "__main__":
    unittest.main()
