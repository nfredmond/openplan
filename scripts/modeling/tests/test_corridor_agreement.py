#!/usr/bin/env python3
"""The agreement map, and the ways it can flatter two models that disagree.

WHY THESE ARE THE TESTS
=======================
An agreement figure is the kind of number that gets quoted. "The two methods
agree on 91% of the network" would go into a grant application, and it can be
true and meaningless at the same time — most links in any network carry almost
nothing, and two models both predicting almost nothing agree perfectly.

So the tests here are mostly about what the summary must NOT let a reader
conclude: that agreement on empty roads is evidence, that agreement means either
model is right, that two runs on different networks can be compared at all, and
that a blend of the two would be a reasonable simplification.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from corridor_agreement import (  # noqa: E402
    COMPARISON_MAX_RELATIVE_GAP,
    CorridorAgreementError,
    agreement_summary,
    build_agreement_map,
    classify_agreement,
    compare_link_volumes,
    convergence_verdict,
    corridor_rollup,
    geh,
)


def link(link_id: int, volume: float) -> dict:
    return {"link_id": link_id, "PCE_tot": volume}


def names(**mapping) -> dict:
    return {int(k.lstrip("l")): v for k, v in mapping.items()}


class TheGehStatistic(unittest.TestCase):
    def test_identical_volumes_have_no_disagreement(self) -> None:
        self.assertEqual(geh(5000, 5000), 0.0)

    def test_two_empty_links_do_not_divide_by_zero(self) -> None:
        self.assertEqual(geh(0, 0), 0.0)

    def test_it_computes_the_published_geh_values(self) -> None:
        # Pinned to the actual formula, sqrt(2(a-b)^2/(a+b)), not merely to its
        # ordering. Dropping the square root leaves every ordering test passing
        # while the numbers become unrecognisable to any traffic engineer —
        # a mutation proved exactly that, so the value itself is asserted.
        self.assertAlmostEqual(geh(5_000, 5_500), 6.9007, places=3)
        self.assertAlmostEqual(geh(10_000, 12_000), 19.0693, places=3)
        self.assertAlmostEqual(geh(100, 121), 1.9977, places=3)

    def test_the_same_absolute_gap_matters_less_on_a_bigger_road(self) -> None:
        # The whole reason GEH is used instead of a percentage or a raw
        # difference: 100 vehicles apart on a quiet street is a large
        # disagreement, and on a freeway it is noise.
        self.assertGreater(geh(200, 300), geh(50_000, 50_100))

    def test_the_thresholds_are_the_recognised_ones(self) -> None:
        self.assertEqual(classify_agreement(4.99), "agree")
        self.assertEqual(classify_agreement(5.0), "marginal")
        self.assertEqual(classify_agreement(9.99), "marginal")
        self.assertEqual(classify_agreement(10.0), "diverge")


class ComparingTwoRuns(unittest.TestCase):
    def test_each_link_is_compared_against_its_own_counterpart(self) -> None:
        comparison = compare_link_volumes(
            [link(1, 1000), link(2, 5000)], [link(1, 1100), link(2, 200)]
        )
        by_id = {row["link_id"]: row for row in comparison["links"]}
        self.assertEqual(by_id[1]["first_volume"], 1000)
        self.assertEqual(by_id[1]["second_volume"], 1100)
        self.assertEqual(by_id[2]["difference"], -4800)
        self.assertEqual(by_id[2]["agreement"], "diverge")

    def test_two_runs_on_different_networks_are_refused(self) -> None:
        # The premise of the whole comparison is that everything downstream of
        # demand is identical. Two runs sharing no links did not hold the
        # network constant, and nothing about their difference is attributable
        # to the demand model.
        with self.assertRaises(CorridorAgreementError):
            compare_link_volumes([link(1, 1000)], [link(99, 1000)])

    def test_a_partially_shared_network_is_compared_but_flagged(self) -> None:
        comparison = compare_link_volumes(
            [link(1, 1000), link(2, 900)], [link(1, 1000), link(3, 900)]
        )
        alignment = comparison["network_alignment"]
        self.assertEqual(alignment["shared_links"], 1)
        self.assertEqual(alignment["only_in_first"], 1)
        self.assertEqual(alignment["only_in_second"], 1)
        self.assertIn("NOT held constant", alignment["note"])

    def test_an_identical_network_says_so_positively(self) -> None:
        comparison = compare_link_volumes([link(1, 1000)], [link(1, 1000)])
        self.assertIn("genuinely held constant", comparison["network_alignment"]["note"])

    def test_a_run_with_no_usable_volumes_is_refused(self) -> None:
        with self.assertRaises(CorridorAgreementError):
            compare_link_volumes([link(1, 1000)], [])


class WhatTheHeadlineMayNotHide(unittest.TestCase):
    def _busy_and_empty(self):
        # Nine empty links that agree perfectly, one busy corridor that does not.
        first = [link(i, 1.0) for i in range(1, 10)] + [link(10, 40_000)]
        second = [link(i, 1.0) for i in range(1, 10)] + [link(10, 12_000)]
        return first, second

    def test_agreement_on_empty_roads_does_not_become_the_headline(self) -> None:
        # THE ONE THAT MATTERS. Counting every link, these two models "agree"
        # on 90% of the network while disagreeing by a factor of three on the
        # only road anybody cares about.
        first, second = self._busy_and_empty()
        summary = agreement_summary(compare_link_volumes(first, second))

        self.assertAlmostEqual(summary["agree_share_all_links"], 0.9)
        self.assertEqual(summary["links_carrying_meaningful_traffic"], 1)
        self.assertAlmostEqual(summary["agree_share_meaningful_links"], 0.0)
        self.assertAlmostEqual(summary["diverge_share_meaningful_links"], 1.0)

    def test_the_volume_weighted_share_reflects_the_road_that_matters(self) -> None:
        first, second = self._busy_and_empty()
        summary = agreement_summary(compare_link_volumes(first, second))
        self.assertAlmostEqual(summary["agree_share_by_volume"], 0.0, places=3)

    def test_the_note_says_agreement_is_not_correctness(self) -> None:
        first, second = self._busy_and_empty()
        summary = agreement_summary(compare_link_volumes(first, second))
        self.assertIn("NOT that either is", summary["note"])
        self.assertIn("never averaged", summary["note"])

    def test_the_note_discloses_that_the_thresholds_were_borrowed(self) -> None:
        # GEH < 5 is a model-versus-COUNT standard, where one side is measured.
        # Presenting it as a validation standard met by two models compared
        # against each other would be a claim nobody could check.
        first, second = self._busy_and_empty()
        summary = agreement_summary(compare_link_volumes(first, second))
        self.assertIn("measured counts", summary["note"])

    def test_a_network_with_nothing_busy_on_it_says_so(self) -> None:
        summary = agreement_summary(
            compare_link_volumes([link(1, 5.0)], [link(1, 5.0)])
        )
        self.assertEqual(summary["links_carrying_meaningful_traffic"], 0)
        self.assertIsNone(summary["agree_share_meaningful_links"])
        self.assertIn("no corridor here", summary["note"])


class RollingUpToCorridors(unittest.TestCase):
    def test_links_of_one_road_become_one_corridor(self) -> None:
        comparison = compare_link_volumes(
            [link(1, 10_000), link(2, 12_000)],
            [link(1, 10_100), link(2, 11_900)],
            link_names={1: {"name": "SR 49"}, 2: {"name": "SR 49"}},
        )
        corridors = corridor_rollup(comparison)
        self.assertEqual(len(corridors), 1)
        self.assertEqual(corridors[0]["corridor"], "SR 49")
        self.assertEqual(corridors[0]["links"], 2)
        self.assertEqual(corridors[0]["first_volume"], 22_000)

    def test_unnamed_links_are_not_merged_into_one_phantom_corridor(self) -> None:
        # They are unrelated roads that happen to share a missing attribute.
        # Grouping them invents a corridor nobody can find on a map, and it
        # would be the busiest one in the study area.
        comparison = compare_link_volumes(
            [link(1, 10_000), link(2, 12_000)],
            [link(1, 10_100), link(2, 11_900)],
            link_names={1: {"name": ""}, 2: {"name": ""}},
        )
        self.assertEqual(corridor_rollup(comparison), [])

    def test_the_worst_corridors_come_first(self) -> None:
        # A reader scanning this list is looking for what NOT to quote.
        comparison = compare_link_volumes(
            [link(1, 10_000), link(2, 10_000)],
            [link(1, 10_050), link(2, 30_000)],
            link_names={1: {"name": "Agrees Road"}, 2: {"name": "Diverges Road"}},
        )
        corridors = corridor_rollup(comparison)
        self.assertEqual([c["corridor"] for c in corridors], ["Diverges Road", "Agrees Road"])
        self.assertEqual(corridors[0]["agreement"], "diverge")

    def test_quiet_links_stay_out_of_the_corridor_rollup(self) -> None:
        comparison = compare_link_volumes(
            [link(1, 5.0)], [link(1, 5.0)], link_names={1: {"name": "Quiet Lane"}}
        )
        self.assertEqual(corridor_rollup(comparison), [])

    def test_a_corridor_that_agrees_in_total_still_shows_its_worst_link(self) -> None:
        # Links whose errors cancel: the corridor total agrees while two of its
        # links do not. Reporting only the total would hide it.
        #
        # One link matching EXACTLY is deliberate. An earlier version of this
        # fixture had every link diverging, so reporting the corridor's best
        # link instead of its worst was indistinguishable — both were above the
        # threshold and the assertion passed either way.
        comparison = compare_link_volumes(
            [link(1, 20_000), link(2, 10_000), link(3, 10_000)],
            [link(1, 20_000), link(2, 14_000), link(3, 6_000)],
            link_names={i: {"name": "SR 20"} for i in (1, 2, 3)},
        )
        corridor = corridor_rollup(comparison)[0]

        self.assertEqual(corridor["agreement"], "agree")
        self.assertEqual(corridor["first_volume"], corridor["second_volume"])
        # The best link here is a perfect match at 0.0; only the worst carries
        # the warning a reader needs.
        self.assertGreater(corridor["worst_link_geh"], 10.0)


class WhetherThisComparisonCanAttributeAnythingAtAll(unittest.TestCase):
    """A loosely converged pair cannot support the claim the map is for.

    MEASURED, on the same 28,670-link network with the SAME demand assigned twice:

        relative gap 0.0092   ->  13.0% of busy links diverged, median GEH 2.05
        relative gap 0.00046  ->   0.0% of busy links diverged, median GEH 0.141

    At the loose gap the assignment is still choosing between near-equal-cost
    parallel routes and produces corridor divergence by itself — indistinguishable,
    to a reader, from the demand models disagreeing. Written in a document that
    would be a convention; this is the field every report carries.
    """

    def test_a_tightly_converged_pair_supports_attribution(self) -> None:
        verdict = convergence_verdict({"final_gap": 0.0004}, {"final_gap": 0.0005})
        self.assertEqual(verdict["status"], "tight_enough")
        self.assertIn("attributable to the demand model", verdict["note"])

    def test_a_loosely_converged_pair_supports_corridors_but_not_links(self) -> None:
        # MEASURED, and it is why this is not a blanket refusal. Assigning
        # IDENTICAL demand at both settings on one county moved named corridor
        # totals by 0.5-1.4%, while 21% of individual links moved more than 10%.
        # A corridor total averages over many links and survives; a single link
        # is where the assignment is still choosing between parallel routes.
        verdict = convergence_verdict({"final_gap": 0.00916}, {"final_gap": 0.00951})
        self.assertEqual(verdict["status"], "corridors_only")
        self.assertEqual(verdict["attributable_at"], ["corridor"])
        self.assertIn("corridor table, not the individual links", verdict["note"])
        # Both offending gaps named, and the way out given.
        self.assertIn("0.00916", verdict["note"])
        self.assertIn("0.00951", verdict["note"])
        self.assertIn("OPENPLAN_ASSIGNMENT_RGAP_TARGET", verdict["note"])

    def test_one_loose_side_is_enough_to_restrict_the_pair(self) -> None:
        verdict = convergence_verdict({"final_gap": 0.0002}, {"final_gap": 0.009})
        self.assertEqual(verdict["status"], "corridors_only")
        self.assertIn("second", verdict["note"])

    def test_a_tight_pair_supports_both_units(self) -> None:
        verdict = convergence_verdict({"final_gap": 0.0004}, {"final_gap": 0.0004})
        self.assertEqual(verdict["attributable_at"], ["corridor", "link"])

    def test_an_unknown_pair_supports_neither_unit(self) -> None:
        self.assertEqual(convergence_verdict(None, None)["attributable_at"], [])

    def test_an_unrecorded_gap_is_unknown_and_not_fine(self) -> None:
        # The difference that matters. Treating a missing convergence record as
        # acceptable lets any run at all be compared, which is exactly how the
        # check gets bypassed without anybody deciding to bypass it.
        verdict = convergence_verdict(None, None)
        self.assertEqual(verdict["status"], "unknown")
        self.assertNotEqual(verdict["status"], "tight_enough")
        self.assertIn("cannot be established", verdict["note"])

    def test_the_verdict_reaches_the_map_as_a_single_readable_flag(self) -> None:
        loose = build_agreement_map(
            [link(1, 10_000)], [link(1, 12_000)],
            first_label="a", second_label="b",
            first_convergence={"final_gap": 0.009}, second_convergence={"final_gap": 0.009},
        )
        tight = build_agreement_map(
            [link(1, 10_000)], [link(1, 12_000)],
            first_label="a", second_label="b",
            first_convergence={"final_gap": 0.0004}, second_convergence={"final_gap": 0.0004},
        )
        self.assertFalse(loose["attribution_is_supportable"])
        self.assertTrue(tight["attribution_is_supportable"])
        self.assertEqual(loose["attributable_at"], ["corridor"])
        self.assertEqual(tight["attributable_at"], ["corridor", "link"])
        self.assertIn(loose["assignment_convergence"]["note"], loose["what_this_is_not"])

    def test_the_required_gap_is_the_measured_one(self) -> None:
        # 0.001 sits between the two measured points: divergence at 0.0092, none
        # at 0.00046. Loosening it past 0.0092 would readmit the very pair the
        # measurement disqualified.
        self.assertLess(COMPARISON_MAX_RELATIVE_GAP, 0.0092)
        self.assertGreaterEqual(COMPARISON_MAX_RELATIVE_GAP, 0.00046)


class TheWholeAgreementMap(unittest.TestCase):
    def test_it_names_both_methods_and_refuses_to_blend_them(self) -> None:
        result = build_agreement_map(
            [link(1, 10_000)],
            [link(1, 12_000)],
            first_label="trip-based gravity",
            second_label="activity-based",
            link_names={1: {"name": "SR 49", "link_type": "trunk"}},
        )
        self.assertEqual(result["methods"], {"first": "trip-based gravity", "second": "activity-based"})
        self.assertIn("never averaged", " ".join(result["what_this_is_not"]))
        self.assertIn("Neither method is ground truth", " ".join(result["what_this_is_not"]))
        self.assertEqual(result["corridors"][0]["corridor"], "SR 49")

    def test_no_blended_volume_appears_anywhere_in_the_output(self) -> None:
        # A guard against the simplification the whole design forbids. If a
        # future edit adds a mean of the two volumes, this fails rather than
        # shipping a number with no provenance.
        #
        # It walks KEYS AND NUMBERS, never prose. A first version scanned the
        # stringified output for "average" and failed on the sentence that
        # forbids averaging — the same way five guards in this repository have
        # been broken by their own explanatory text reaching the matcher.
        result = build_agreement_map(
            [link(1, 10_000)], [link(1, 20_000)],
            first_label="a", second_label="b",
            link_names={1: {"name": "SR 49"}},
        )

        keys: set[str] = set()
        numbers: set[float] = set()

        def walk(node) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    keys.add(str(key))
                    walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)
            elif isinstance(node, (int, float)) and not isinstance(node, bool):
                numbers.add(float(node))

        walk(result)

        self.assertNotIn(15_000.0, numbers, "the mean of the two volumes is being reported")
        for forbidden in ("average", "blended", "combined_volume", "mean_volume", "consensus"):
            for key in keys:
                self.assertNotIn(forbidden, key.lower(), f"key '{key}' reports a blend")

    def test_an_unmeasured_noise_floor_is_stated_as_unmeasured(self) -> None:
        # The biggest caveat of all, and the one a reader would never think to
        # ask for. Equilibrium assignment moves flow between near-equal-cost
        # parallel routes, so two runs with identical demand still disagree link
        # by link — measured at 13% of busy links on a real network. Silence
        # here invites a reader to attribute that to the demand model, which is
        # the one thing this comparison claims to be able to do.
        result = build_agreement_map(
            [link(1, 10_000)], [link(1, 12_000)], first_label="a", second_label="b"
        )
        floor = result["assignment_noise_floor"]
        self.assertFalse(floor["measured"])
        self.assertIsNone(floor["measurement"])
        self.assertIn("HAS NOT BEEN MEASURED", floor["note"])
        self.assertIn(floor["note"], result["what_this_is_not"])

    def test_a_measured_noise_floor_is_reported_with_its_number(self) -> None:
        result = build_agreement_map(
            [link(1, 10_000)], [link(1, 12_000)],
            first_label="a", second_label="b",
            noise_floor={"diverge_share_meaningful_links": 0.13, "relative_gap": 0.01},
        )
        floor = result["assignment_noise_floor"]
        self.assertTrue(floor["measured"])
        self.assertIn("13.0%", floor["note"])
        self.assertIn("0.01", floor["note"])
        self.assertNotIn("HAS NOT BEEN MEASURED", floor["note"])

    def test_the_settings_used_travel_with_the_answer(self) -> None:
        result = build_agreement_map(
            [link(1, 10_000)], [link(1, 10_000)],
            first_label="a", second_label="b", minimum_volume=250.0,
        )
        self.assertEqual(result["settings"]["minimum_volume"], 250.0)
        self.assertEqual(result["settings"]["geh_close"], 5.0)
        self.assertEqual(result["summary"]["minimum_volume"], 250.0)


if __name__ == "__main__":
    unittest.main()
