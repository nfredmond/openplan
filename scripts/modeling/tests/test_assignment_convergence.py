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

import screening_runtime as screening_runtime_module  # noqa: E402

if screening_runtime_module.installed_assignment_engine_version() is None:
    screening_runtime_module.installed_assignment_engine_version = lambda: "test-only-aequilibrae"

from screening_runtime import (  # noqa: E402
    ASSIGNMENT_MAX_ITERATIONS,
    ASSIGNMENT_RGAP_TARGET,
    assignment_convergence,
)


class ConvergenceReportingTests(unittest.TestCase):
    def test_a_run_that_stopped_short_is_marked_unconverged_and_caveated(self) -> None:
        record = assignment_convergence(0.00243, iterations=3000, max_iterations=3000)

        self.assertFalse(record["converged"])
        self.assertIn("did NOT converge", record["caveat"])
        # The caveat has to carry the numbers, or a reader has to go and find
        # them to know how far short it stopped.
        self.assertIn("0.0024", record["caveat"])
        self.assertIn("3000", record["caveat"])
        # And it must say what the consequence is, not merely that it happened.
        self.assertIn("observed counts", record["caveat"])

    def test_a_converged_run_carries_no_caveat(self) -> None:
        # The negative control. A caveat on every run is a caveat nobody reads.
        record = assignment_convergence(0.0004, iterations=2137, max_iterations=3000)
        self.assertTrue(record["converged"])
        self.assertNotIn("caveat", record)

    def test_exactly_at_the_target_counts_as_converged(self) -> None:
        record = assignment_convergence(
            ASSIGNMENT_RGAP_TARGET,
            iterations=2200,
            max_iterations=ASSIGNMENT_MAX_ITERATIONS,
        )
        self.assertTrue(record["converged"])

    def test_an_unmeasured_gap_is_not_treated_as_success(self) -> None:
        """AequilibraE reports NaN when it cannot compute the gap. Unknown is
        not converged — defaulting the other way would let a run that could not
        even measure its own convergence pass as equilibrium."""
        record = assignment_convergence(float("nan"), iterations=3000, max_iterations=3000)
        self.assertFalse(record["converged"])
        self.assertIsNone(record["final_gap"])
        self.assertIn("unmeasured", record["caveat"])

    def test_a_negative_gap_is_invalid_not_better_than_the_target(self) -> None:
        record = assignment_convergence(-0.1, iterations=12, max_iterations=3000)
        self.assertFalse(record["converged"])
        self.assertIsNone(record["final_gap"])
        self.assertIn("unmeasured", record["caveat"])

    def test_the_gap_decides_convergence_and_not_the_iteration_count(self) -> None:
        """The discriminating case, and the one my first pass missed: an
        assignment that stopped WELL SHORT of the ceiling with the gap still
        above target. Judging by "did it hit the ceiling?" would call this
        converged — it is not, and its link volumes are no more usable than a
        run that ran out of iterations."""
        record = assignment_convergence(0.002, iterations=500, max_iterations=3000)
        self.assertFalse(record["converged"])
        self.assertIn("did NOT converge", record["caveat"])

        # And the mirror: hitting the ceiling with an acceptable gap IS
        # convergence. The ceiling is a safety stop, not the criterion.
        at_ceiling = assignment_convergence(0.0004, iterations=3000, max_iterations=3000)
        self.assertTrue(at_ceiling["converged"])

    def test_the_numbers_a_reader_needs_are_all_recorded(self) -> None:
        record = assignment_convergence(0.002, iterations=500, max_iterations=3000)
        self.assertEqual(record["final_gap"], 0.002)
        self.assertEqual(record["iterations"], 500)
        self.assertEqual(record["target_gap"], ASSIGNMENT_RGAP_TARGET)
        # The ceiling too: stopping at 500 of 3,000 means something different from
        # stopping at 3,000 of 3,000 — the first is a converging run interrupted,
        # the second is a network that would not settle.
        self.assertEqual(record["max_iterations"], 3000)
        self.assertEqual(record["algorithm"], "bfw")
        self.assertEqual(record["assignment_profile"]["target_gap"], ASSIGNMENT_RGAP_TARGET)
        self.assertEqual(
            record["assignment_profile_payload_json"],
            screening_runtime_module.assignment_profile_payload_json(
                record["assignment_profile"]
            ),
        )
        self.assertEqual(len(record["assignment_profile_digest"]), 64)

    def test_unknown_iteration_count_stays_unknown(self) -> None:
        record = assignment_convergence(0.002, iterations=None, max_iterations=3000)
        self.assertIsNone(record["iterations"])
        self.assertIn("unreported", record["caveat"])

    def test_boolean_gap_and_pce_are_not_numeric_evidence(self) -> None:
        record = assignment_convergence(True, iterations=2, max_iterations=3000)
        self.assertIsNone(record["final_gap"])
        self.assertFalse(record["converged"])

        profile = screening_runtime_module.assignment_profile()
        profile["class_pce"] = True
        with self.assertRaisesRegex(ValueError, "PCE"):
            assignment_convergence(
                0.0004,
                iterations=2,
                max_iterations=3000,
                profile=profile,
            )


if __name__ == "__main__":
    unittest.main()
