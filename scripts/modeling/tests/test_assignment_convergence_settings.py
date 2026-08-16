#!/usr/bin/env python3
"""The convergence gap is the agreement map's noise floor, so it must be tunable.

WHAT THIS GUARDS, AND WHY IT IS NOT A PREFERENCE
================================================
Measured on 2026-08-16: two screening runs whose demand differed by 0.001% were
compared link by link on the same 28,670-link network.

    total network vehicle-miles ......... matched to 0.047%
    links carrying real traffic ......... 3,891
    of those, diverging by GEH >= 10 .... 507  (13%)
    those 507 split ..................... 318 up, 189 down

Total flow preserved, individual links moving in both directions: that is flow
redistributing between near-equal-cost parallel routes, not a demand difference.
Both runs had hit the 500-iteration ceiling at a relative gap of about 0.0092.

This matters because the dual-model comparison attributes a link's divergence to
the demand model. Below that floor the attribution is simply false — the
assignment generates the divergence by itself. A comparison run has to be able
to tighten the gap, and a value that can only be changed by editing a constant
is a value nobody will change.
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


class TheConvergenceSettingsCanBeTightened(unittest.TestCase):
    @classmethod
    def tearDownClass(cls) -> None:
        # Leave the module as the rest of the suite expects to find it.
        for name in ("OPENPLAN_ASSIGNMENT_RGAP_TARGET", "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS"):
            os.environ.pop(name, None)
        import screening_runtime

        importlib.reload(screening_runtime)

    def test_the_defaults_are_the_documented_ones(self) -> None:
        for name in ("OPENPLAN_ASSIGNMENT_RGAP_TARGET", "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS"):
            os.environ.pop(name, None)
        runtime = reload_runtime({})
        self.assertEqual(runtime.ASSIGNMENT_RGAP_TARGET, 0.01)
        self.assertEqual(runtime.ASSIGNMENT_MAX_ITERATIONS, 500)

    def test_a_comparison_run_can_ask_for_a_tighter_gap(self) -> None:
        runtime = reload_runtime(
            {
                "OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0005",
                "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "3000",
            }
        )
        self.assertEqual(runtime.ASSIGNMENT_RGAP_TARGET, 0.0005)
        self.assertEqual(runtime.ASSIGNMENT_MAX_ITERATIONS, 3000)

    def test_the_gap_a_run_reports_is_the_one_it_was_asked_for(self) -> None:
        # The recorded target must follow the setting. A run tightened to 0.0005
        # that still reports 0.01 as its target would be graded against the loose
        # threshold and called converged when it is not.
        runtime = reload_runtime({"OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0005"})
        verdict = runtime.assignment_convergence(0.004, 900, 3000)
        self.assertEqual(verdict["target_gap"], 0.0005)
        self.assertFalse(verdict["converged"])

    def test_a_gap_inside_the_tightened_target_is_converged(self) -> None:
        runtime = reload_runtime({"OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0005"})
        verdict = runtime.assignment_convergence(0.0004, 900, 3000)
        self.assertTrue(verdict["converged"])


if __name__ == "__main__":
    unittest.main()
