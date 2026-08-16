#!/usr/bin/env python3
"""An unconverged assignment has to say so.

MEASURED 2026-08-16
===================
A county run stopped at its 50-iteration ceiling with a relative gap of 0.0243
against a target of 0.01. Both numbers had always been recorded and the record
was true — but reading it required noticing that one exceeded the other, and a
run that stopped short looked identical at a glance to one that converged.

Why it matters: a traffic assignment redistributes trips until no driver can
find a faster route. Stopping early means traffic has not finished moving off
over-capacity roads, so every link volume is a figure taken from part-way
through a calculation. Comparing those to observed counts — which is exactly
what the validation gate does — measures the arithmetic's unfinished state as
much as the model.

This is the same defect class as everything else found this week: the fact was
present, correct, and unreadable.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from screening_runtime import (  # noqa: E402
    ASSIGNMENT_RGAP_TARGET,
    assignment_convergence,
)


class ConvergenceReportingTests(unittest.TestCase):
    def test_a_run_that_stopped_short_is_marked_unconverged_and_caveated(self) -> None:
        """The exact numbers from the measured run."""
        record = assignment_convergence(0.0243, iterations=50, max_iterations=50)

        self.assertFalse(record["converged"])
        self.assertIn("did NOT converge", record["caveat"])
        # The caveat has to carry the numbers, or a reader has to go and find
        # them to know how far short it stopped.
        self.assertIn("0.0243", record["caveat"])
        self.assertIn("50", record["caveat"])
        # And it must say what the consequence is, not merely that it happened.
        self.assertIn("observed counts", record["caveat"])

    def test_a_converged_run_carries_no_caveat(self) -> None:
        # The negative control. A caveat on every run is a caveat nobody reads.
        record = assignment_convergence(0.008, iterations=137, max_iterations=500)
        self.assertTrue(record["converged"])
        self.assertNotIn("caveat", record)

    def test_exactly_at_the_target_counts_as_converged(self) -> None:
        record = assignment_convergence(ASSIGNMENT_RGAP_TARGET, iterations=200, max_iterations=500)
        self.assertTrue(record["converged"])

    def test_an_unmeasured_gap_is_not_treated_as_success(self) -> None:
        """AequilibraE reports NaN when it cannot compute the gap. Unknown is
        not converged — defaulting the other way would let a run that could not
        even measure its own convergence pass as equilibrium."""
        record = assignment_convergence(float("nan"), iterations=500, max_iterations=500)
        self.assertFalse(record["converged"])
        self.assertIsNone(record["final_gap"])
        self.assertIn("unmeasured", record["caveat"])

    def test_the_gap_decides_convergence_and_not_the_iteration_count(self) -> None:
        """The discriminating case, and the one my first pass missed: an
        assignment that stopped WELL SHORT of the ceiling with the gap still
        above target. Judging by "did it hit the ceiling?" would call this
        converged — it is not, and its link volumes are no more usable than a
        run that ran out of iterations."""
        record = assignment_convergence(0.02, iterations=50, max_iterations=500)
        self.assertFalse(record["converged"])
        self.assertIn("did NOT converge", record["caveat"])

        # And the mirror: hitting the ceiling with an acceptable gap IS
        # convergence. The ceiling is a safety stop, not the criterion.
        at_ceiling = assignment_convergence(0.005, iterations=500, max_iterations=500)
        self.assertTrue(at_ceiling["converged"])

    def test_the_numbers_a_reader_needs_are_all_recorded(self) -> None:
        record = assignment_convergence(0.02, iterations=50, max_iterations=500)
        self.assertEqual(record["final_gap"], 0.02)
        self.assertEqual(record["iterations"], 50)
        self.assertEqual(record["target_gap"], ASSIGNMENT_RGAP_TARGET)
        # The ceiling too: stopping at 50 of 500 means something different from
        # stopping at 500 of 500 — the first is a converging run interrupted,
        # the second is a network that would not settle.
        self.assertEqual(record["max_iterations"], 500)


if __name__ == "__main__":
    unittest.main()
