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
                reassign=lambda factors, scalar=1.0, ext=1.0: {},
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
                reassign=lambda factors, scalar=1.0, ext=1.0: volumes(matched, 10000.0),
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
            reassign=lambda factors, scalar=1.0, ext=1.0: volumes(self.matched, 10000.0),
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
            reassign=lambda factors, scalar=1.0, ext=1.0: volumes(self.matched, 500_000.0),
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
            reassign=lambda factors, scalar=1.0, ext=1.0: volumes(self.matched, 5000.0),
            baseline_volumes=self.baseline,
            max_iterations=3,
        )
        self.assertEqual(result["accepted_iterations"], 0)

    def test_the_loop_stops_rather_than_spinning(self) -> None:
        calls: list[dict] = []

        def reassign(factors, scalar=1.0, ext=1.0):
            calls.append(factors)
            return volumes(self.matched, 500_000.0)

        calibrate(
            matched_stations=self.matched,
            reassign=reassign,
            baseline_volumes=self.baseline,
            max_iterations=5,
        )
        # CHANGED 2026-08-17, and the change is the point. One rejected trial
        # used to end EVERY stage, so a hopeless run cost three assignments —
        # and so did a run whose external scalar merely needed a second guess.
        # On a real county that stopped the external stage after ONE value, and
        # it left a lever worth a third of all trips at 1.0 while the model
        # over-assigned every road class it was graded on.
        #
        # The external stage now sweeps a fixed candidate list instead. What
        # must still hold is that the work is BOUNDED: the first two stages
        # still stop at their first rejection, and the sweep cannot exceed its
        # candidate list or `max_iterations`, whichever is smaller.
        from calibrate_to_counts import external_scalar_candidates

        sweep_ceiling = min(len(external_scalar_candidates([], {})) + 1, 5)
        self.assertLessEqual(len(calls), 2 + sweep_ceiling)
        self.assertGreater(len(calls), 3, "the external stage must outlive its first rejection")


class DemandScalarStageTests(unittest.TestCase):
    """Stage 2: how MUCH travel there is.

    Class factors move traffic between road classes and cannot change the total.
    Measured after stage 1 converged on a real county, the model still
    over-assigned by a median 1.30x across every class — a level error no class
    adjustment reaches.
    """

    def setUp(self) -> None:
        self.matched = stations(20)
        self.baseline = volumes(self.matched, 5000.0)

    def test_a_uniform_over_assignment_is_corrected_by_scaling_demand(self) -> None:
        """The scalar the fit set implies is applied to the whole matrix, and
        the trial that uses it is judged on the held-out counts like any other."""
        def reassign(factors, scalar=1.0, ext=1.0):
            # A model whose volumes track the demand scalar exactly.
            return volumes(self.matched, 5000.0 * scalar)

        result = calibrate(
            matched_stations=self.matched,
            reassign=reassign,
            baseline_volumes=self.baseline,
            max_iterations=4,
        )
        self.assertGreater(result["demand_scalar"], 1.0)
        self.assertLess(result["calibrated"]["holdout"]["median_ape"],
                        result["baseline"]["holdout"]["median_ape"])
        self.assertTrue(any(s.get("stage") == "demand" for s in result["steps"]))

    def test_a_demand_step_that_worsens_the_holdout_is_rejected(self) -> None:
        def reassign(factors, scalar=1.0, ext=1.0):
            # Scaling makes it worse, not better.
            return volumes(self.matched, 5000.0 / max(scalar, 0.01))

        result = calibrate(
            matched_stations=self.matched,
            reassign=reassign,
            baseline_volumes=self.baseline,
            max_iterations=3,
        )
        self.assertEqual(result["demand_scalar"], 1.0)

    def test_an_already_correct_model_is_left_alone(self) -> None:
        # The negative control for the whole stage: nothing to fix, nothing
        # changed, and the run must NOT claim to have been calibrated.
        matched = stations(20)
        exact = volumes(matched, 10000.0)
        result = calibrate(
            matched_stations=matched,
            reassign=lambda factors, scalar=1.0, ext=1.0: exact,
            baseline_volumes=exact,
            max_iterations=3,
        )
        self.assertEqual(result["demand_scalar"], 1.0)
        self.assertEqual(result["class_factors"], {})
        self.assertEqual(result["accepted_iterations"], 0)

    def test_the_scalar_is_damped_not_applied_raw(self) -> None:
        """A single step never jumps the whole way to the implied ratio: the
        engine's gamma damps it, and the clip bounds it, so one noisy count
        cannot move the entire model."""
        from calibrate_to_counts import demand_scalar_step

        # A ratio INSIDE the clip range, or the clip masks the damping and the
        # test passes whether or not damping happens at all — which is exactly
        # what a first version of this test did at a ratio of 4.0, where
        # sqrt(4)=2 and the clip ceiling is also 2.
        implied_ratio = 1.44
        rows = [
            {"observed_volume": 1440.0, "modeled_daily_pce": 1000.0} for _ in range(5)
        ]
        step = demand_scalar_step(rows)
        self.assertIsNotNone(step)
        self.assertAlmostEqual(step, 1.2, places=6)  # sqrt(1.44), not 1.44
        self.assertLess(step, implied_ratio)

    def test_external_demand_is_scaled_separately_from_resident_travel(self) -> None:
        """Cordon traffic and resident travel are different guesses with
        different evidence, and stage 3 fits them apart. Smearing one correction
        across both would move trips that were never in doubt."""
        seen: list[tuple[float, float]] = []

        def reassign(factors, scalar=1.0, ext=1.0):
            seen.append((scalar, ext))
            # Only the external scalar helps, so only it should be adopted.
            return volumes(self.matched, 5000.0 * ext)

        result = calibrate(
            matched_stations=self.matched,
            reassign=reassign,
            baseline_volumes=self.baseline,
            max_iterations=3,
        )
        self.assertGreater(result["external_demand_scalar"], 1.0)
        # The two scalars are passed independently, never as one number.
        self.assertTrue(any(ext != scalar for scalar, ext in seen))

    def test_no_usable_pairs_yields_no_step_rather_than_one(self) -> None:
        # None means "nothing to fit"; 1.0 would mean "fitted, and the answer
        # was no change" — different facts.
        from calibrate_to_counts import demand_scalar_step

        self.assertIsNone(demand_scalar_step([]))
        self.assertIsNone(
            demand_scalar_step([{"observed_volume": 0.0, "modeled_daily_pce": 100.0}])
        )


class GateMetricTests(unittest.TestCase):
    """A step may not move the run further from the standard it is judged by.

    Found by running it: the demand stage improved the engine's blended
    objective (held-out GEH 21.20 -> 16.81) while making held-out median APE
    worse (43.29% -> 46.25%). The engine accepted it, correctly by its own rule.
    The screening gate is median APE, so accepting that would mean calibrating
    toward something no planner is ever shown.
    """

    def test_a_step_that_worsens_median_ape_is_rejected(self) -> None:
        from calibrate_to_counts import step_improves_the_gate_metric

        self.assertFalse(
            step_improves_the_gate_metric({"median_ape": 43.29}, {"median_ape": 46.25})
        )

    def test_an_improving_or_equal_step_passes(self) -> None:
        from calibrate_to_counts import step_improves_the_gate_metric

        self.assertTrue(step_improves_the_gate_metric({"median_ape": 62.8}, {"median_ape": 43.29}))
        # Equal passes here; the engine's own strict-improvement rule is what
        # stops a no-op being accepted, and duplicating that check would make
        # which rule rejected a step ambiguous.
        self.assertTrue(step_improves_the_gate_metric({"median_ape": 40.0}, {"median_ape": 40.0}))

    def test_the_two_rejection_reasons_are_distinguishable(self) -> None:
        """They mean different things. "The blend got no better" says the
        calibration converged; "the blend improved but the gate metric worsened"
        says the objective and the standard disagree — a fact about the model
        that was invisible while both printed the same sentence."""
        from calibrate_to_counts import rejection_reason

        converged = rejection_reason(0.40, 0.45, {"median_ape": 43.0}, {"median_ape": 50.0})
        self.assertIn("no strict improvement", converged)

        disagreed = rejection_reason(0.40, 0.35, {"median_ape": 43.29}, {"median_ape": 46.25})
        self.assertIn("worsened held-out median", disagreed)
        self.assertIn("screening gate", disagreed)
        self.assertNotEqual(converged, disagreed)

    def test_an_unmeasurable_trial_is_not_accepted_on_trust(self) -> None:
        from calibrate_to_counts import step_improves_the_gate_metric

        self.assertFalse(step_improves_the_gate_metric({"median_ape": 40.0}, {"median_ape": None}))

    def test_no_previous_measurement_does_not_block_a_first_step(self) -> None:
        from calibrate_to_counts import step_improves_the_gate_metric

        self.assertTrue(step_improves_the_gate_metric({"median_ape": None}, {"median_ape": 55.0}))


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
        def overfitting_reassign(factors, scalar=1.0, ext=1.0):
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
        def honest_reassign(factors, scalar=1.0, ext=1.0):
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
            reassign=lambda factors, scalar=1.0, ext=1.0: volumes(self.matched, 10000.0),
            baseline_volumes=volumes(self.matched, 5000.0),
            max_iterations=1,
        )

    def test_the_reported_figure_is_named_a_selection_score_not_an_accuracy(self) -> None:
        # STRENGTHENED 2026-08-17. This used to assert the basis said "held-out",
        # and that claim became false: every candidate is scored on those
        # stations and the best is kept, so the winning score is a best-of-N and
        # is optimistic by construction. Measured on a real county, this figure
        # read 16.1% while an independent count set put the same run at 60.0%.
        basis = self.result["reported_accuracy_basis"]
        self.assertIn("best-of-trials", basis)
        self.assertIn("not the run's accuracy", basis)
        self.assertEqual(
            self.result["holdout_median_ape"],
            self.result["calibrated"]["holdout"]["median_ape"],
        )

    def test_how_many_candidates_were_scored_on_the_holdout_is_recorded(self) -> None:
        # The size of the optimism. One trial is nearly unbiased; seven is not,
        # and a reader cannot judge the figure without knowing which it was.
        self.assertGreaterEqual(self.result["selection_trials_scored_on_holdout"], 1)
        self.assertEqual(
            self.result["selection_trials_scored_on_holdout"], len(self.result["steps"])
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
        self.assertIn("held back from the fit", self.result["caveat"])
        # And it must send the reader to the figure that IS the accuracy.
        self.assertIn("best-of-trials score", self.result["caveat"])
        self.assertIn("reads better than the model performs", self.result["caveat"])

    def test_the_split_is_reproducible_and_says_how(self) -> None:
        # A calibration nobody can reproduce is not evidence. The seed and the
        # fraction travel with the result.
        self.assertIn("holdout_seed", self.result)
        self.assertIn("holdout_fraction", self.result)
        again = calibrate(
            matched_stations=self.matched,
            reassign=lambda factors, scalar=1.0, ext=1.0: volumes(self.matched, 10000.0),
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




class ExternalScalarSweepTests(unittest.TestCase):
    """Stage 3 stopped after one guess, and that was the whole problem.

    MEASURED on a real county: the stage computed one ratio from the fit
    stations, tried it, landed 0.93 percentage points worse on the holdout, and
    stopped — leaving the external-demand scalar at 1.0. External travel is a
    third of all trips there, and the model over-assigned every road class it
    was graded on, from 1.05 on primary roads to 3.28 on trunk. One sample of
    that lever is not a search.
    """

    def setUp(self) -> None:
        self.matched = stations(20)
        self.baseline = volumes(self.matched, 5000.0)

    def test_the_suggested_ratio_is_tried_first(self) -> None:
        # When the fit stations imply a ratio it leads, because a ratio that is
        # right is right for a reason. The fixed sweep is the fallback.
        from calibrate_to_counts import external_scalar_candidates

        candidates = external_scalar_candidates([], {})
        self.assertEqual(candidates[0], 0.5)

    def test_the_candidates_lean_below_one(self) -> None:
        # The failure mode this lever has is over-assignment, measured on every
        # road class. Candidates concentrate where the answer is likely to be.
        from calibrate_to_counts import EXTERNAL_SCALAR_CANDIDATES

        below = [c for c in EXTERNAL_SCALAR_CANDIDATES if c < 1.0]
        self.assertGreater(len(below), len(EXTERNAL_SCALAR_CANDIDATES) - len(below))

    def test_scalars_above_one_stay_reachable(self) -> None:
        # A study area whose boundary traffic is genuinely understated must
        # still be able to get there. Leaning is not excluding.
        from calibrate_to_counts import EXTERNAL_SCALAR_CANDIDATES

        self.assertTrue(any(c > 1.0 for c in EXTERNAL_SCALAR_CANDIDATES))

    def test_a_duplicate_suggestion_does_not_cost_a_second_assignment(self) -> None:
        # Every trial is a full assignment. A suggested ratio that happens to
        # equal a fixed candidate must not spend two of them proving the same
        # thing twice.
        #
        # The suggestion is forced to 0.5 — already in the fixed list — because
        # a fixture that merely produces NO suggestion cannot tell a working
        # dedup from an absent one. A mutation proved that: removing the dedup
        # entirely left the weaker version of this test passing.
        import calibrate_to_counts as module

        original = module.demand_scalar_step
        module.demand_scalar_step = lambda *args, **kwargs: 0.5
        try:
            candidates = module.external_scalar_candidates(self.matched, self.baseline)
        finally:
            module.demand_scalar_step = original

        self.assertIn(0.5, candidates)
        self.assertEqual(len(candidates), len(set(candidates)))
        self.assertEqual(candidates.count(0.5), 1)

    def test_a_rejected_candidate_does_not_end_the_stage(self) -> None:
        # THE BEHAVIOUR CHANGE. Every trial here is worse than baseline, so
        # every one is rejected — and the stage must still have tried more than
        # one of them.
        external_trials: list[float] = []

        def reassign(factors, scalar=1.0, ext=1.0):
            if ext != 1.0:
                external_trials.append(ext)
            return volumes(self.matched, 500_000.0)

        calibrate(
            matched_stations=self.matched,
            reassign=reassign,
            baseline_volumes=self.baseline,
            max_iterations=6,
        )
        self.assertGreater(len(external_trials), 1)
        self.assertEqual(len(external_trials), len(set(external_trials)))

    def test_the_sweep_cannot_exceed_the_iteration_budget(self) -> None:
        # A sweep is only an improvement if it stays bounded; each trial costs a
        # full assignment.
        external_trials: list[float] = []

        def reassign(factors, scalar=1.0, ext=1.0):
            if ext != 1.0:
                external_trials.append(ext)
            return volumes(self.matched, 500_000.0)

        calibrate(
            matched_stations=self.matched,
            reassign=reassign,
            baseline_volumes=self.baseline,
            max_iterations=2,
        )
        self.assertLessEqual(len(external_trials), 2)

    def test_every_external_scalar_stays_inside_its_clamp(self) -> None:
        from calibrate_to_counts import EXTERNAL_SCALAR_CANDIDATES

        for candidate in EXTERNAL_SCALAR_CANDIDATES:
            self.assertGreaterEqual(candidate, 0.1)
            self.assertLessEqual(candidate, 10.0)


if __name__ == "__main__":
    unittest.main()
