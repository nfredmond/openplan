#!/usr/bin/env python3
"""A fitted population that misses its target looks exactly like one that hits it.

WHY THESE TESTS EXIST
=====================
Population synthesis has no natural failure signal. The loop always terminates,
the weights are always numbers, the household file always writes, and the model
downstream always runs. A zone whose household mix is badly wrong produces a
complete, plausible, entirely fictional set of travellers — and the only place
that could ever have said so is here.

So the tests that matter most are not "does it fit" but the three ways it can
fail silently: a category the seed cannot supply, a rounding step that invents
or loses households, and a person-level control that is quietly ignored while
the household-level ones look healthy.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from population_synthesis import (  # noqa: E402
    Control,
    PopulationSynthesisError,
    SeedHousehold,
    build_seed_matrix,
    expand_population,
    find_unmet_controls,
    fit_quality_summary,
    fit_zone_weights,
    integerize_weights,
    margins_summary,
    synthesize_zone,
)

SIZE = Control(name="size", level="household", categories=("small", "large"))
INCOME = Control(name="income", level="household", categories=("low", "high"))
AGE = Control(name="age", level="person", categories=("adult", "child"))


def household(
    hid: str,
    *,
    size: str,
    income: str,
    weight: float = 1.0,
    adults: int = 1,
    children: int = 0,
) -> SeedHousehold:
    return SeedHousehold(
        household_id=hid,
        weight=weight,
        household_category={"size": size, "income": income},
        person_categories={"age": {"adult": adults, "child": children}},
        persons=adults + children,
    )


def totals(households, weights, control, category) -> float:
    """What the fitted weights actually produce for one category."""
    if control.level == "household":
        return sum(
            w for h, w in zip(households, weights) if h.household_category[control.name] == category
        )
    return sum(
        w * h.person_categories[control.name].get(category, 0) for h, w in zip(households, weights)
    )


class ReproducingThePublishedTotals(unittest.TestCase):
    def test_the_fitted_weights_reproduce_every_household_control(self) -> None:
        seed = [
            household("a", size="small", income="low"),
            household("b", size="small", income="high"),
            household("c", size="large", income="low"),
            household("d", size="large", income="high"),
        ]
        targets = {
            "size": {"small": 300.0, "large": 100.0},
            "income": {"low": 250.0, "high": 150.0},
        }

        fit = fit_zone_weights(seed, [SIZE, INCOME], targets, zone_id=7)

        self.assertTrue(fit.converged)
        for control in (SIZE, INCOME):
            for category in control.categories:
                self.assertAlmostEqual(
                    totals(seed, fit.weights, control, category),
                    targets[control.name][category],
                    places=1,
                    msg=f"{control.name}:{category} did not reach its published total",
                )

    def test_a_person_level_control_is_balanced_in_the_same_loop(self) -> None:
        # THE ONE THAT CATCHES A HOUSEHOLD-ONLY FIT. Every household here is
        # 'small', so the household control is satisfied by ANY weights that sum
        # to 200 — a fit that ignores person-level controls converges instantly
        # and gets the child count completely wrong. The age split is the only
        # thing separating the two households, so it is the only thing that can
        # distinguish a real IPU from a household-only IPF.
        seed = [
            household("childless", size="small", income="low", adults=2, children=0, weight=1.0),
            household("family", size="small", income="low", adults=2, children=2, weight=1.0),
        ]
        targets = {
            "size": {"small": 200.0},
            "income": {"low": 200.0},
            "age": {"adult": 400.0, "child": 100.0},
        }

        fit = fit_zone_weights(seed, [SIZE, INCOME, AGE], targets)

        self.assertTrue(fit.converged, f"worst {fit.worst_control} at {fit.worst_deviation}")
        # Asserted to the tolerance the module promises (0.1% relative), not to a
        # tighter number that would pass today and break the first time the
        # convergence criterion is legitimately re-tuned.
        self.assertAlmostEqual(totals(seed, fit.weights, AGE, "child"), 100.0, delta=0.1)
        self.assertAlmostEqual(totals(seed, fit.weights, AGE, "adult"), 400.0, delta=0.4)
        # 100 children at 2 per family household means 50 family households, and
        # the remaining 150 households childless — a split no household-level
        # control in this fixture asks for.
        self.assertAlmostEqual(fit.weights[1], 50.0, delta=0.05)
        self.assertAlmostEqual(fit.weights[0], 150.0, delta=0.15)

    def test_a_zone_that_reports_nobody_in_a_category_gets_nobody(self) -> None:
        seed = [
            household("a", size="small", income="low"),
            household("b", size="large", income="low"),
        ]
        targets = {"size": {"small": 100.0, "large": 0.0}, "income": {"low": 100.0}}

        fit = fit_zone_weights(seed, [SIZE, INCOME], targets)

        self.assertAlmostEqual(totals(seed, fit.weights, SIZE, "small"), 100.0, places=1)
        self.assertLess(totals(seed, fit.weights, SIZE, "large"), 1e-3)


class WhatTheSeedCannotSupply(unittest.TestCase):
    def test_a_category_no_sampled_household_falls_in_is_reported(self) -> None:
        # The failure this whole module exists to surface. The zone reports 40
        # high-income households; the regional sample contains none. Reweighting
        # cannot invent one, and nothing downstream would ever notice.
        seed = [
            household("a", size="small", income="low"),
            household("b", size="large", income="low"),
        ]
        targets = {"size": {"small": 60.0, "large": 40.0}, "income": {"low": 60.0, "high": 40.0}}

        fit = fit_zone_weights(seed, [SIZE, INCOME], targets)

        self.assertEqual(len(fit.unmet_controls), 1)
        entry = fit.unmet_controls[0]
        self.assertEqual((entry["control"], entry["category"]), ("income", "high"))
        self.assertEqual(entry["target"], 40.0)
        self.assertIn("40", entry["reason"])

    def test_an_unmet_control_does_not_stop_the_rest_from_fitting(self) -> None:
        # An unreachable category must not hold the loop hostage: the zone's
        # other controls are still worth fitting, and a run that could only
        # report "did not converge" would hide WHICH problem it had.
        #
        # The seed has nobody aged 65+, which a small rural sample really can
        # lack. Person-level, so the reachable controls stay consistent with one
        # another — see the household-level case below, where they do not.
        age_with_seniors = Control(name="age", level="person", categories=("adult", "child", "senior"))
        seed = [
            household("childless", size="small", income="low", adults=2, children=0),
            household("family", size="small", income="low", adults=2, children=2),
        ]
        targets = {
            "size": {"small": 200.0},
            "income": {"low": 200.0},
            "age": {"adult": 400.0, "child": 100.0, "senior": 50.0},
        }

        fit = fit_zone_weights(seed, [SIZE, INCOME, age_with_seniors], targets)

        self.assertTrue(fit.converged, f"worst {fit.worst_control} at {fit.worst_deviation}")
        self.assertEqual([e["category"] for e in fit.unmet_controls], ["senior"])
        self.assertAlmostEqual(totals(seed, fit.weights, SIZE, "small"), 200.0, delta=0.2)
        self.assertAlmostEqual(totals(seed, fit.weights, age_with_seniors, "child"), 100.0, delta=0.1)

    def test_a_missing_household_type_leaves_the_zone_unsatisfiable_and_says_both(self) -> None:
        # DISCOVERED BY THIS TEST FAILING, and kept because the behaviour is
        # right. When the seed cannot supply a HOUSEHOLD-level category, the
        # zone's remaining marginals contradict each other: 60 low-income
        # households cannot also be the 100 households the size control counts.
        # No weights satisfy both, so the fit reports BOTH facts — the missing
        # type and the non-convergence. Reporting only one would leave a reader
        # thinking the population was merely imprecise.
        seed = [
            household("a", size="small", income="low"),
            household("b", size="large", income="low"),
        ]
        targets = {"size": {"small": 60.0, "large": 40.0}, "income": {"low": 60.0, "high": 40.0}}

        fit = fit_zone_weights(seed, [SIZE, INCOME], targets)

        self.assertEqual([e["category"] for e in fit.unmet_controls], ["high"])
        self.assertFalse(fit.converged)
        self.assertGreater(fit.worst_deviation, 0.001)

    def test_a_category_nobody_is_asked_for_is_not_called_unmet(self) -> None:
        # Zero target and zero supply agree with each other. Reporting it would
        # bury the real misses in noise.
        seed = [household("a", size="small", income="low")]
        targets = {"size": {"small": 10.0, "large": 0.0}, "income": {"low": 10.0, "high": 0.0}}

        self.assertEqual(find_unmet_controls(seed, [SIZE, INCOME], targets), [])


class TurningWeightsIntoWholeHouseholds(unittest.TestCase):
    def test_the_household_total_is_preserved_exactly(self) -> None:
        # Rounding each weight on its own loses three households here. A study
        # area's household count is one of the few model figures a reader checks
        # against the Census directly, so it has to survive integerization.
        weights = [2.4, 2.4, 2.4, 2.4, 2.4]
        counts = integerize_weights(weights)
        self.assertEqual(sum(counts), 12)
        self.assertEqual(sum(counts), round(sum(weights)))

    def test_the_largest_fractions_are_the_ones_rounded_up(self) -> None:
        counts = integerize_weights([1.9, 1.1, 1.1])
        self.assertEqual(counts, [2, 1, 1])

    def test_the_same_weights_always_give_the_same_households(self) -> None:
        # Stochastic rounding fits better on average and would make two runs of
        # one model produce different populations. A planner cannot defend a
        # number they cannot reproduce.
        weights = [0.5, 0.5, 0.5, 0.5, 1.7, 3.3]
        self.assertEqual(integerize_weights(weights), integerize_weights(weights))
        self.assertEqual(integerize_weights(list(reversed(weights))), integerize_weights(list(reversed(weights))))

    def test_ties_break_on_position_not_on_sort_luck(self) -> None:
        counts = integerize_weights([0.5, 0.5, 0.5, 0.5])
        self.assertEqual(sum(counts), 2)
        self.assertEqual(counts, [1, 1, 0, 0])

    def test_no_weights_is_no_households(self) -> None:
        self.assertEqual(integerize_weights([]), [])


class ExpandingIntoAHouseholdList(unittest.TestCase):
    def test_each_seed_household_appears_as_many_times_as_its_count(self) -> None:
        seed = [household("a", size="small", income="low"), household("b", size="large", income="low")]
        rows = expand_population(seed, [2, 1], zone_id=42)

        self.assertEqual(len(rows), 3)
        self.assertEqual([r["seed_household_id"] for r in rows], ["a", "a", "b"])
        self.assertEqual([r["household_id"] for r in rows], [1, 2, 3])
        self.assertEqual({r["home_zone_id"] for r in rows}, {42})
        self.assertEqual([r["seed_replicate"] for r in rows], [1, 2, 1])

    def test_household_ids_continue_across_zones(self) -> None:
        # Two zones that both start at 1 produce duplicate household ids, and
        # every person in the second zone attaches to the first zone's household.
        seed = [household("a", size="small", income="low")]
        first = expand_population(seed, [2], zone_id=1)
        second = expand_population(seed, [2], zone_id=2, first_household_id=len(first) + 1)
        self.assertEqual([r["household_id"] for r in second], [3, 4])

    def test_counts_that_do_not_match_the_seed_are_refused(self) -> None:
        seed = [household("a", size="small", income="low")]
        with self.assertRaises(PopulationSynthesisError):
            expand_population(seed, [1, 1], zone_id=1)

    def test_an_empty_seed_is_refused_rather_than_fitted(self) -> None:
        with self.assertRaises(PopulationSynthesisError):
            fit_zone_weights([], [SIZE], {"size": {"small": 10.0}})

    def test_a_fit_with_no_controls_is_refused(self) -> None:
        seed = [household("a", size="small", income="low")]
        with self.assertRaises(PopulationSynthesisError):
            fit_zone_weights(seed, [], {})


class OneCallGivesBothThePopulationAndItsFlaws(unittest.TestCase):
    def test_synthesize_zone_hands_back_the_fit_with_the_rows(self) -> None:
        seed = [
            household("a", size="small", income="low"),
            household("b", size="large", income="high"),
        ]
        targets = {"size": {"small": 30.0, "large": 20.0}, "income": {"low": 30.0, "high": 20.0}}

        rows, fit = synthesize_zone(seed, [SIZE, INCOME], targets, zone_id=3)

        self.assertEqual(len(rows), 50)
        self.assertTrue(fit.converged)
        self.assertEqual(fit.zone_id, 3)


class GradingTheFitAgainstThePublishedUncertainty(unittest.TestCase):
    """A fixed tolerance grades a tract-level fit against noise.

    Measured on one real county on 2026-08-16, the ACS publishes its tract-level
    "4-person family households" cell with a median relative margin of error of
    54%, and its under-5 age cell at 92%. A fit graded at a fixed 0.1% reports
    every zone as a failure, and a run that cries failure everywhere teaches a
    planner to ignore it. What means something is a miss LARGER than the
    published uncertainty in the number being missed.
    """

    def _seed_and_targets(self):
        seed = [
            household("a", size="small", income="low"),
            household("b", size="large", income="high"),
        ]
        targets = {"size": {"small": 60.0, "large": 40.0}, "income": {"low": 60.0, "high": 40.0}}
        return seed, targets

    def test_a_fit_inside_the_published_margin_is_not_reported_as_a_problem(self) -> None:
        seed, targets = self._seed_and_targets()
        generous = {"size": {"small": 30.0, "large": 30.0}, "income": {"low": 30.0, "high": 30.0}}

        fit = fit_zone_weights(seed, [SIZE, INCOME], targets, margins=generous)

        self.assertTrue(fit.graded_against_margins)
        self.assertEqual(fit.outside_margin, [])

    def test_a_miss_larger_than_the_margin_is_named_with_its_numbers(self) -> None:
        # A fit that cannot reach its target at all: the seed has no
        # small-and-high-income household, so 'large' can only be 40 if 'high'
        # is too, and the deliberately tiny margins leave the miss exposed.
        seed = [household("a", size="small", income="low")]
        targets = {"size": {"small": 100.0}, "income": {"low": 40.0}}
        strict = {"size": {"small": 0.5}, "income": {"low": 0.5}}

        fit = fit_zone_weights(seed, [SIZE, INCOME], targets, margins=strict)

        self.assertTrue(fit.graded_against_margins)
        self.assertTrue(fit.outside_margin)
        entry = fit.outside_margin[0]
        self.assertIn("target", entry)
        self.assertIn("fitted", entry)
        self.assertIn("margin_of_error", entry)

    def test_a_zero_margin_is_not_treated_as_perfect_precision(self) -> None:
        # A suppressed or missing margin means "unknown", not "exact". Grading
        # against zero would mark every zone as outside its margin and bury the
        # real disagreements in noise.
        seed = [household("a", size="small", income="low")]
        targets = {"size": {"small": 100.0}, "income": {"low": 40.0}}
        absent = {"size": {"small": 0.0}, "income": {"low": 0.0}}

        fit = fit_zone_weights(seed, [SIZE, INCOME], targets, margins=absent)

        self.assertEqual(fit.outside_margin, [])

    def test_no_margins_supplied_is_distinguishable_from_no_problems_found(self) -> None:
        seed, targets = self._seed_and_targets()
        fit = fit_zone_weights(seed, [SIZE, INCOME], targets)
        self.assertFalse(fit.graded_against_margins)
        self.assertEqual(fit.outside_margin, [])
        self.assertIn("not graded", margins_summary([fit]))

    def test_the_summary_leads_with_the_margin_verdict_when_there_is_one(self) -> None:
        seed, targets = self._seed_and_targets()
        generous = {"size": {"small": 30.0, "large": 30.0}, "income": {"low": 30.0, "high": 30.0}}
        fit = fit_zone_weights(seed, [SIZE, INCOME], targets, margins=generous, max_iterations=1)

        summary = fit_quality_summary([fit])

        self.assertEqual(summary["zones_graded_against_margins"], 1)
        self.assertEqual(summary["zones_outside_published_margin"], 0)
        self.assertIn("margin of error", summary["note"])
        # And it must NOT lead with the tolerance verdict, which at one iteration
        # says this zone failed — the exact false alarm this grading replaces.
        self.assertNotIn("did not reach the fitting tolerance", summary["note"])


class PreparingTheSeedOnce(unittest.TestCase):
    def test_a_prepared_seed_gives_the_same_answer_as_none(self) -> None:
        seed = [
            household("a", size="small", income="low"),
            household("b", size="large", income="high"),
        ]
        targets = {"size": {"small": 60.0, "large": 40.0}, "income": {"low": 60.0, "high": 40.0}}

        without = fit_zone_weights(seed, [SIZE, INCOME], targets)
        with_matrix = fit_zone_weights(
            seed, [SIZE, INCOME], targets, seed_matrix=build_seed_matrix(seed, [SIZE, INCOME])
        )

        for left, right in zip(without.weights, with_matrix.weights):
            self.assertAlmostEqual(left, right, places=9)

    def test_a_prepared_seed_for_a_different_household_list_is_refused(self) -> None:
        # The failure this catches is total and silent: every household would be
        # fitted against another household's category memberships, and the run
        # would complete with a population describing nobody.
        seed = [household("a", size="small", income="low")]
        other = [household("a", size="small", income="low"), household("b", size="large", income="high")]
        with self.assertRaises(PopulationSynthesisError):
            fit_zone_weights(
                seed, [SIZE, INCOME], {}, seed_matrix=build_seed_matrix(other, [SIZE, INCOME])
            )

    def test_a_prepared_seed_missing_a_control_is_refused(self) -> None:
        seed = [household("a", size="small", income="low")]
        with self.assertRaises(PopulationSynthesisError):
            fit_zone_weights(
                seed, [SIZE, INCOME], {}, seed_matrix=build_seed_matrix(seed, [SIZE])
            )


class TheStudyAreaVerdict(unittest.TestCase):
    def _fit(self, **kwargs):
        from population_synthesis import ZoneFit

        defaults = dict(
            zone_id=1,
            weights=[1.0],
            iterations=3,
            converged=True,
            worst_deviation=0.0001,
            worst_control="size:small",
            unmet_controls=[],
        )
        defaults.update(kwargs)
        return ZoneFit(**defaults)

    def test_a_clean_study_area_says_so_plainly(self) -> None:
        summary = fit_quality_summary([self._fit(zone_id=1), self._fit(zone_id=2)])
        self.assertEqual(summary["zones_not_converged"], 0)
        self.assertEqual(summary["zones_with_unmet_controls"], 0)
        self.assertIn("within the fitting tolerance", summary["note"])

    def test_a_missing_household_type_is_named_not_averaged_away(self) -> None:
        # An average deviation would read as healthy here. The whole point of
        # the summary is that the reader learns which zones not to quote.
        bad = self._fit(
            zone_id=9,
            unmet_controls=[{"control": "income", "category": "high", "target": 40.0, "reason": "x"}],
        )
        summary = fit_quality_summary([self._fit(zone_id=1), bad])

        self.assertEqual(summary["zones_with_unmet_controls"], 1)
        self.assertEqual(summary["unmet_categories"], ["income:high"])
        self.assertIn("income:high", summary["note"])
        self.assertIn("missing from the", summary["note"])

    def test_a_zone_that_never_converged_is_counted(self) -> None:
        summary = fit_quality_summary(
            [self._fit(zone_id=1), self._fit(zone_id=2, converged=False, worst_deviation=0.4)]
        )
        self.assertEqual(summary["zones_not_converged"], 1)
        self.assertEqual(summary["worst_zone_id"], 2)
        self.assertIn("did not reach the fitting tolerance", summary["note"])

    def test_no_zones_at_all_is_not_reported_as_success(self) -> None:
        summary = fit_quality_summary([])
        self.assertEqual(summary["zones_fitted"], 0)
        self.assertIn("no synthetic population", summary["note"])


if __name__ == "__main__":
    unittest.main()
