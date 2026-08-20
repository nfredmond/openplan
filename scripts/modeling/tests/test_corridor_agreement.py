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

import hashlib
import json
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


NETWORK_DIGEST = "a" * 64


def id_digest(link_ids: list[int]) -> str:
    return hashlib.sha256(
        json.dumps(sorted(link_ids), separators=(",", ":")).encode()
    ).hexdigest()


def verified_network_evidence(
    all_link_ids: list[int],
    *,
    roadway_link_ids: list[int] | None = None,
    connector_link_ids: list[int] | None = None,
    factors: dict[str, float] | None = None,
) -> dict:
    roadway_ids = sorted(roadway_link_ids if roadway_link_ids is not None else all_link_ids)
    connector_ids = sorted(connector_link_ids or [])
    manifest = {
        "schema_version": "openplan.retained-network-manifest.v1",
        "all_link_count": len(all_link_ids),
        "all_link_ids_digest": id_digest(all_link_ids),
        "roadway_link_count": len(roadway_ids),
        "roadway_link_ids_digest": id_digest(roadway_ids),
        "modeling_connector_link_count": len(connector_ids),
        "modeling_connector_link_ids_digest": id_digest(connector_ids),
        "excluded_roles": ["modeling_connector"],
        "role_definition": {
            "roadway": "link_type != centroid_connector",
            "modeling_connector": "link_type = centroid_connector",
        },
    }
    settings = {
        "schema_version": "openplan.network-calibration.v1",
        "road_class_factors": factors or {},
        "application": {
            "travel_time": "baseline_travel_time / factor",
            "capacity": "baseline_capacity * factor",
        },
        "excludes": ["trip_based_od_adjustments"],
    }
    settings_payload = json.dumps(settings, sort_keys=True, separators=(",", ":"))
    settings_digest = hashlib.sha256(settings_payload.encode()).hexdigest()
    component_digest = hashlib.sha256(b"component").hexdigest()
    state = {
        "schema_version": "openplan.assignment-network-state.v1",
        "network_settings_digest": settings_digest,
        "assignment_centroid_count": 2,
        "assignment_centroid_order_digest": component_digest,
        "block_centroid_flows": True,
        "penalty_through_centroids": "positive_infinity",
        "cost_field": "travel_time",
        "capacity_field": "capacity",
        "graph_row_count": len(all_link_ids),
        "graph_rows_digest": component_digest,
        "graph_float_dtype": "<f8",
        "graph_cost_digest": component_digest,
        "graph_cost_dtype": "<f8",
        "compact_cost_digest": component_digest,
        "compact_cost_dtype": "<f8",
        "solver_free_flow_tt_digest": component_digest,
        "solver_free_flow_tt_dtype": "<f8",
        "solver_capacity_digest": component_digest,
        "solver_capacity_dtype": "<f8",
        "retained_network_digest": component_digest,
        "retained_network_manifest": manifest,
    }
    state_digest = hashlib.sha256(
        json.dumps(state, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "first_network_settings_payload_json": settings_payload,
        "first_network_settings_digest": settings_digest,
        "second_network_settings_payload_json": settings_payload,
        "second_network_settings_digest": settings_digest,
        "first_network_state_record": state,
        "first_network_state_digest": state_digest,
        "second_network_state_record": json.loads(json.dumps(state)),
        "second_network_state_digest": state_digest,
        "retained_network_manifest": manifest,
        "geometry_network_state_digest": state_digest,
        "geometry_roadway_link_ids": roadway_ids,
    }


def convergence_record(gap: float, *, target: float = 0.0005, ceiling: int = 3000) -> dict:
    profile = {
        "schema_version": "openplan.assignment-profile.v1",
        "profile_id": "aequilibrae-bfw-bpr-tight-v1",
        "engine": "aequilibrae",
        "engine_version": "1.4.2",
        "algorithm": "bfw",
        "vdf": "BPR",
        "vdf_parameters": {"alpha": 0.15, "beta": 4},
        "capacity_field": "capacity",
        "time_field": "travel_time",
        "class_pce": 1,
        "cores": 1,
        "target_gap": target,
        "max_iterations": ceiling,
    }
    payload_json = json.dumps(
        profile,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    digest = hashlib.sha256(payload_json.encode()).hexdigest()
    return {
        "final_gap": gap,
        "target_gap": target,
        "max_iterations": ceiling,
        "algorithm": "bfw",
        "assignment_profile": profile,
        "assignment_profile_payload_json": payload_json,
        "assignment_profile_digest": digest,
    }


def rehash_profile(record: dict) -> None:
    record["assignment_profile_payload_json"] = json.dumps(
        record["assignment_profile"],
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    record["assignment_profile_digest"] = hashlib.sha256(
        record["assignment_profile_payload_json"].encode()
    ).hexdigest()


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

    def test_two_runs_on_disjoint_networks_keep_diagnostics_but_align_nothing(self) -> None:
        # The premise of the whole comparison is that everything downstream of
        # demand is identical. Two runs sharing no links did not hold the
        # network constant, and nothing about their difference is attributable
        # to the demand model.
        comparison = compare_link_volumes([link(1, 1000)], [link(99, 1000)])
        self.assertEqual(comparison["links"], [])
        self.assertFalse(comparison["network_alignment"]["exact"])
        self.assertEqual(comparison["network_alignment"]["shared_links"], 0)

    def test_a_partially_shared_network_is_compared_but_flagged(self) -> None:
        comparison = compare_link_volumes(
            [link(1, 1000), link(2, 900)], [link(1, 1000), link(3, 900)]
        )
        alignment = comparison["network_alignment"]
        self.assertEqual(alignment["shared_links"], 1)
        self.assertEqual(alignment["only_in_first"], 1)
        self.assertEqual(alignment["only_in_second"], 1)
        self.assertIn("link sets do not match", alignment["note"])

    def test_an_identical_network_says_so_positively(self) -> None:
        comparison = compare_link_volumes([link(1, 1000)], [link(1, 1000)])
        self.assertTrue(comparison["network_alignment"]["exact"])
        self.assertIn("link-set alignment only", comparison["network_alignment"]["note"])

    def test_the_classification_is_derived_from_the_reported_rounded_geh(self) -> None:
        comparison = compare_link_volumes(
            [link(1, 10_000), link(2, 10_000)],
            [link(1, 10_506.2480516406), link(2, 11_025.270413738388)],
        )
        first, second = comparison["links"]
        self.assertEqual((first["geh"], first["agreement"]), (5.0, "marginal"))
        self.assertEqual((second["geh"], second["agreement"]), (10.0, "diverge"))

    def test_a_run_with_no_usable_volumes_is_refused(self) -> None:
        with self.assertRaises(CorridorAgreementError):
            compare_link_volumes([link(1, 1000)], [])

    def test_every_row_requires_a_finite_nonnegative_volume(self) -> None:
        invalid_rows = (
            {"link_id": 1},
            {"link_id": 1, "PCE_tot": "not-a-number"},
            {"link_id": 1, "PCE_tot": "NaN"},
            {"link_id": 1, "PCE_tot": "Infinity"},
            {"link_id": 1, "PCE_tot": -0.01},
        )
        for row in invalid_rows:
            with self.subTest(row=row), self.assertRaises(CorridorAgreementError):
                compare_link_volumes([row], [link(1, 1)])

    def test_link_ids_are_unique_and_mathematically_integral(self) -> None:
        for bad_id in (None, "abc", "NaN", 1.5):
            with self.subTest(link_id=bad_id), self.assertRaises(CorridorAgreementError):
                compare_link_volumes(
                    [{"link_id": bad_id, "PCE_tot": 1}], [link(1, 1)]
                )
        with self.assertRaisesRegex(CorridorAgreementError, "duplicate link_id 1"):
            compare_link_volumes(
                [link(1, 1), {"link_id": "1.0", "PCE_tot": 2}], [link(1, 1)]
            )
        accepted = compare_link_volumes(
            [{"link_id": "1.0", "PCE_tot": 1}], [link(1, 1)]
        )
        self.assertEqual(accepted["links"][0]["link_id"], 1)

    def test_published_geh_is_computed_from_published_volumes(self) -> None:
        comparison = compare_link_volumes(
            [link(1, 10_000.0)], [link(1, 10_000.5535)]
        )
        published = comparison["links"][0]
        self.assertEqual(published["first_volume"], 10_000.0)
        self.assertEqual(published["second_volume"], 10_000.55)
        self.assertEqual(published["geh"], round(geh(10_000.0, 10_000.55), 3))
        self.assertEqual(published["agreement"], classify_agreement(published["geh"]))


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
    def test_corridor_classification_is_derived_from_its_reported_rounded_geh(self) -> None:
        comparison = compare_link_volumes(
            [link(1, 10_000), link(2, 10_000)],
            [link(1, 10_506.2480516406), link(2, 11_025.270413738388)],
            link_names={1: {"name": "First"}, 2: {"name": "Second"}},
        )
        by_name = {row["corridor"]: row for row in corridor_rollup(comparison)}
        self.assertEqual(
            (by_name["First"]["geh"], by_name["First"]["agreement"]),
            (5.0, "marginal"),
        )
        self.assertEqual(
            (by_name["Second"]["geh"], by_name["Second"]["agreement"]),
            (10.0, "diverge"),
        )

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
        verdict = convergence_verdict(
            convergence_record(0.0004), convergence_record(0.0005)
        )
        self.assertEqual(verdict["status"], "tight_enough")
        self.assertIn("attribution still requires exact verified", verdict["note"])
        self.assertEqual(
            verdict["assignment_profiles"]["first"]["engine"], "aequilibrae"
        )
        self.assertEqual(
            verdict["assignment_profile_digests"]["first"],
            verdict["assignment_profile_digests"]["second"],
        )
        self.assertEqual(
            verdict["assignment_profile_digests"]["first"],
            "0ba5e437e9cfd1fea8c5fd37c5642940c376266eecba427b969371078e48d717",
        )

    def test_a_loosely_converged_pair_supports_corridors_but_not_links(self) -> None:
        # MEASURED, and it is why this is not a blanket refusal. Assigning
        # IDENTICAL demand at both settings on one county moved named corridor
        # totals by 0.5-1.4%, while 21% of individual links moved more than 10%.
        # A corridor total averages over many links and survives; a single link
        # is where the assignment is still choosing between parallel routes.
        verdict = convergence_verdict(
            convergence_record(0.00916), convergence_record(0.00951)
        )
        self.assertEqual(verdict["status"], "corridors_only")
        self.assertEqual(verdict["attributable_at"], ["corridor"])
        self.assertIn("corridor table, not the individual links", verdict["note"])
        # Both offending gaps named, and the way out given.
        self.assertIn("0.00916", verdict["note"])
        self.assertIn("0.00951", verdict["note"])
        self.assertIn("OPENPLAN_ASSIGNMENT_RGAP_TARGET", verdict["note"])

    def test_one_loose_side_is_enough_to_restrict_the_pair(self) -> None:
        verdict = convergence_verdict(
            convergence_record(0.0002), convergence_record(0.009)
        )
        self.assertEqual(verdict["status"], "corridors_only")
        self.assertIn("second", verdict["note"])

    def test_a_tight_pair_supports_both_units(self) -> None:
        verdict = convergence_verdict(
            convergence_record(0.0004), convergence_record(0.0004)
        )
        self.assertEqual(verdict["attributable_at"], ["corridor", "link"])

    def test_an_unknown_pair_supports_neither_unit(self) -> None:
        self.assertEqual(convergence_verdict(None, None)["attributable_at"], [])

    def test_either_missing_side_makes_the_pair_unknown(self) -> None:
        tight = convergence_record(0.0004)
        for first, second, missing_side in (
            (None, tight, "first"),
            (tight, None, "second"),
        ):
            with self.subTest(missing_side=missing_side):
                verdict = convergence_verdict(first, second)
                self.assertEqual(verdict["status"], "unknown")
                self.assertEqual(verdict["attributable_at"], [])
                self.assertIn(missing_side, verdict["note"])
                self.assertIn("valid nonnegative final gap", verdict["note"])

    def test_a_negative_gap_makes_the_pair_unknown(self) -> None:
        verdict = convergence_verdict(
            convergence_record(-0.1),
            convergence_record(0.0004),
        )
        self.assertEqual(verdict["status"], "unknown")
        self.assertEqual(verdict["attributable_at"], [])
        self.assertIn("valid nonnegative final gap", verdict["note"])

    def test_mismatched_recorded_profiles_support_no_attribution(self) -> None:
        first = convergence_record(0.0002)
        second = convergence_record(0.0001, target=0.0002, ceiling=5000)
        verdict = convergence_verdict(first, second)
        self.assertEqual(verdict["status"], "assignment_settings_mismatch")
        self.assertEqual(verdict["attributable_at"], [])
        self.assertIn("different recorded assignment profiles", verdict["note"])

    def test_one_recorded_profile_and_one_legacy_record_is_unknown(self) -> None:
        verdict = convergence_verdict(
            convergence_record(0.0003),
            {"final_gap": 0.0003},
        )
        self.assertEqual(verdict["status"], "unknown")
        self.assertEqual(verdict["attributable_at"], [])
        self.assertIn("second did not record", verdict["note"])

    def test_two_legacy_records_do_not_invent_matching_assignment_settings(self) -> None:
        verdict = convergence_verdict(
            {"final_gap": 0.0003},
            {"final_gap": 0.0003},
        )
        self.assertEqual(verdict["status"], "unknown")
        self.assertEqual(verdict["attributable_at"], [])
        self.assertIn("first, second did not record", verdict["note"])

    def test_profiles_without_cores_cannot_claim_the_assignment_was_held_constant(self) -> None:
        first = convergence_record(0.0003)
        second = convergence_record(0.0003)
        for record in (first, second):
            record["assignment_profile"].pop("cores")
            rehash_profile(record)
        verdict = convergence_verdict(first, second)
        self.assertEqual(verdict["status"], "unknown")
        self.assertEqual(verdict["attributable_at"], [])
        self.assertIn("fields are not exact", verdict["note"])
        self.assertIsNone(verdict["assignment_profiles"]["first"])

    def test_a_profile_without_engine_identity_is_not_verified(self) -> None:
        first = convergence_record(0.0003)
        second = convergence_record(0.0003)
        for record in (first, second):
            record["assignment_profile"].pop("engine_version")
            rehash_profile(record)
        verdict = convergence_verdict(first, second)
        self.assertEqual(verdict["status"], "unknown")
        self.assertIsNone(verdict["assignment_profiles"]["first"])
        self.assertIn("engine_version", verdict["note"])

    def test_profile_schema_rejects_an_extra_unhashed_method_field(self) -> None:
        first = convergence_record(0.0003)
        second = convergence_record(0.0003)
        for record in (first, second):
            record["assignment_profile"]["unrecorded_option"] = True
            rehash_profile(record)
        verdict = convergence_verdict(first, second)
        self.assertEqual(verdict["status"], "unknown")
        self.assertIn("extra=['unrecorded_option']", verdict["note"])

    def test_profile_schema_enforces_the_v1_method_and_accuracy_limits(self) -> None:
        mutations = (
            ("schema_version", "other"),
            ("profile_id", "other"),
            ("engine", "other"),
            ("engine_version", ""),
            ("algorithm", "msa"),
            ("vdf", "OTHER"),
            ("vdf_parameters", {"alpha": 0.2, "beta": 4}),
            ("capacity_field", ""),
            ("time_field", ""),
            ("class_pce", 2),
            ("cores", 0),
            ("target_gap", 0.0006),
            ("max_iterations", 2999),
        )
        for field, value in mutations:
            with self.subTest(field=field):
                first = convergence_record(0.0003)
                second = convergence_record(0.0003)
                for record in (first, second):
                    record["assignment_profile"][field] = value
                    if field in ("algorithm", "target_gap", "max_iterations"):
                        record[field] = value
                    rehash_profile(record)
                verdict = convergence_verdict(first, second)
                self.assertEqual(verdict["status"], "unknown")
                self.assertEqual(verdict["attributable_at"], [])

    def test_a_recorded_profile_digest_must_match_the_full_profile(self) -> None:
        first = convergence_record(0.0003)
        second = convergence_record(0.0003)
        first["assignment_profile_digest"] = "f" * 64
        verdict = convergence_verdict(first, second)
        self.assertEqual(verdict["status"], "unknown")
        self.assertIsNone(verdict["assignment_profiles"]["first"])
        self.assertIsNone(verdict["assignment_profile_digests"]["first"])
        self.assertIn("digest does not match", verdict["note"])

    def test_exact_profile_payload_bytes_are_the_cross_runtime_hash_contract(self) -> None:
        first = convergence_record(0.0003, target=0.00001)
        second = convergence_record(0.0003, target=0.00001)
        tampered_payload = second["assignment_profile_payload_json"] + " "
        second["assignment_profile_payload_json"] = tampered_payload
        second["assignment_profile_digest"] = hashlib.sha256(
            tampered_payload.encode()
        ).hexdigest()
        verdict = convergence_verdict(
            first,
            second,
            first_assignment_profile_payload_json=first[
                "assignment_profile_payload_json"
            ],
            first_assignment_profile_digest=first["assignment_profile_digest"],
            second_assignment_profile_payload_json=tampered_payload,
            second_assignment_profile_digest=second["assignment_profile_digest"],
        )
        self.assertEqual(verdict["status"], "unknown")
        self.assertIn("exact compact sorted JSON", verdict["note"])

    def test_prepared_graph_field_names_are_recorded_not_hardcoded(self) -> None:
        first = convergence_record(0.0003)
        second = convergence_record(0.0003)
        for record in (first, second):
            record["assignment_profile"]["capacity_field"] = "capacity_ab"
            record["assignment_profile"]["time_field"] = "free_flow_time_ab"
            rehash_profile(record)
        verdict = convergence_verdict(first, second)
        self.assertEqual(verdict["status"], "tight_enough")
        self.assertEqual(
            verdict["assignment_profiles"]["first"]["capacity_field"],
            "capacity_ab",
        )

    def test_final_gap_not_requested_target_decides_link_attribution(self) -> None:
        # 0.0005 is the requested target. 0.001 is the separately measured
        # maximum final gap for link attribution. Do not collapse the two.
        inside_attribution_ceiling = convergence_verdict(
            convergence_record(0.0009),
            convergence_record(0.0008),
        )
        outside_attribution_ceiling = convergence_verdict(
            convergence_record(0.0011),
            convergence_record(0.0004),
        )
        self.assertEqual(inside_attribution_ceiling["status"], "tight_enough")
        self.assertEqual(outside_attribution_ceiling["status"], "corridors_only")

    def test_an_unrecorded_gap_is_unknown_and_not_fine(self) -> None:
        # The difference that matters. Treating a missing convergence record as
        # acceptable lets any run at all be compared, which is exactly how the
        # check gets bypassed without anybody deciding to bypass it.
        verdict = convergence_verdict(None, None)
        self.assertEqual(verdict["status"], "unknown")
        self.assertNotEqual(verdict["status"], "tight_enough")
        self.assertIn("cannot be established", verdict["note"])

    def test_the_verdict_reaches_the_map_as_a_single_readable_flag(self) -> None:
        evidence = verified_network_evidence([1])
        loose = build_agreement_map(
            [link(1, 10_000)], [link(1, 12_000)],
            first_label="a", second_label="b",
            first_convergence=convergence_record(0.009),
            second_convergence=convergence_record(0.009),
            **evidence,
        )
        tight = build_agreement_map(
            [link(1, 10_000)], [link(1, 12_000)],
            first_label="a", second_label="b",
            first_convergence=convergence_record(0.0004),
            second_convergence=convergence_record(0.0004),
            **evidence,
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


class WhetherTheNetworkWasActuallyHeldConstant(unittest.TestCase):
    def _agreement(self, **overrides) -> dict:
        arguments = {
            "first_rows": [link(1, 10_000), link(2, 5_000)],
            "second_rows": [link(1, 11_000), link(2, 5_500)],
            "first_label": "a",
            "second_label": "b",
            "first_convergence": convergence_record(0.0003),
            "second_convergence": convergence_record(0.0003),
            **verified_network_evidence([1, 2]),
        }
        arguments.update(overrides)
        return build_agreement_map(**arguments)

    def test_matching_links_settings_and_profiles_support_attribution(self) -> None:
        agreement = self._agreement()
        self.assertEqual(agreement["network_consistency"]["status"], "verified_same")
        self.assertTrue(agreement["attribution_is_supportable"])
        self.assertEqual(agreement["attributable_at"], ["corridor", "link"])

    def test_missing_network_digest_keeps_the_result_diagnostic_only(self) -> None:
        agreement = self._agreement(second_network_settings_digest=None)
        consistency = agreement["network_consistency"]
        self.assertEqual(consistency["status"], "unverified")
        self.assertIsNotNone(
            consistency["evidence"]["network_settings"]["first"]["recorded_digest"]
        )
        self.assertIsNone(
            consistency["evidence"]["network_settings"]["second"]["recorded_digest"]
        )
        self.assertFalse(agreement["attribution_is_supportable"])
        self.assertEqual(agreement["attributable_at"], [])

    def test_mismatched_network_settings_keep_the_result_diagnostic_only(self) -> None:
        second_settings = {
            "schema_version": "openplan.network-calibration.v1",
            "road_class_factors": {"motorway": 1.1},
            "application": {
                "travel_time": "baseline_travel_time / factor",
                "capacity": "baseline_capacity * factor",
            },
            "excludes": ["trip_based_od_adjustments"],
        }
        second_payload = json.dumps(second_settings, sort_keys=True, separators=(",", ":"))
        agreement = self._agreement(
            second_network_settings_payload_json=second_payload,
            second_network_settings_digest=hashlib.sha256(second_payload.encode()).hexdigest(),
        )
        self.assertEqual(
            agreement["network_consistency"]["status"], "settings_mismatch"
        )
        self.assertFalse(agreement["attribution_is_supportable"])
        self.assertEqual(agreement["attributable_at"], [])

    def test_mismatched_link_sets_override_matching_settings_digests(self) -> None:
        agreement = self._agreement(
            second_rows=[link(1, 11_000), link(3, 5_500)]
        )
        self.assertEqual(agreement["network_consistency"]["status"], "network_mismatch")
        self.assertFalse(agreement["network_alignment"]["exact"])
        self.assertFalse(agreement["attribution_is_supportable"])
        self.assertEqual(agreement["attributable_at"], [])
        self.assertEqual(len(agreement["links"]), 1)

    def test_disjoint_link_sets_still_emit_the_mismatch_diagnostic(self) -> None:
        agreement = self._agreement(second_rows=[link(9, 11_000)])
        self.assertEqual(agreement["network_consistency"]["status"], "network_mismatch")
        self.assertEqual(agreement["network_alignment"]["shared_links"], 0)
        self.assertEqual(agreement["links"], [])
        self.assertEqual(agreement["attributable_at"], [])

    def test_an_invalid_digest_is_unverified_not_same(self) -> None:
        agreement = self._agreement(second_network_settings_digest="A" * 64)
        self.assertEqual(agreement["network_consistency"]["status"], "unverified")
        self.assertIn(
            "not a lowercase SHA-256",
            agreement["network_consistency"]["evidence"]["network_settings"]["second"]["reason"],
        )

    def test_both_tables_omitting_the_same_retained_link_fails_coverage(self) -> None:
        agreement = self._agreement(
            **verified_network_evidence([1, 2, 3]),
        )
        self.assertTrue(agreement["network_alignment"]["exact"])
        self.assertEqual(
            agreement["network_consistency"]["status"],
            "retained_network_coverage_mismatch",
        )
        self.assertFalse(agreement["attribution_is_supportable"])

    def test_high_volume_modeling_connector_never_enters_the_analysis(self) -> None:
        evidence = verified_network_evidence(
            [1, 2, 900], roadway_link_ids=[1, 2], connector_link_ids=[900]
        )
        agreement = self._agreement(
            first_rows=[link(1, 10_000), link(2, 5_000), link(900, 999_999)],
            second_rows=[link(1, 11_000), link(2, 5_500), link(900, 1)],
            link_names={
                1: {"name": "Road 1"},
                2: {"name": "Road 2"},
                900: {"name": "Centroid connector"},
            },
            **evidence,
        )
        self.assertEqual([item["link_id"] for item in agreement["links"]], [1, 2])
        self.assertEqual(agreement["summary"]["links_compared"], 2)
        self.assertNotIn("Centroid connector", [row["corridor"] for row in agreement["corridors"]])
        self.assertEqual(
            agreement["retained_network"]["excluded_modeling_connector_count"], 1
        )
        self.assertEqual(agreement["network_consistency"]["status"], "verified_same")

    def test_matching_arbitrary_hex_does_not_verify_state_records(self) -> None:
        agreement = self._agreement(
            first_network_state_digest="a" * 64,
            second_network_state_digest="a" * 64,
            geometry_network_state_digest="a" * 64,
        )
        self.assertEqual(agreement["network_consistency"]["status"], "unverified")

    def test_two_valid_but_different_observed_states_are_a_mismatch(self) -> None:
        evidence = verified_network_evidence([1, 2])
        second_state = json.loads(json.dumps(evidence["second_network_state_record"]))
        second_state["graph_rows_digest"] = "b" * 64
        evidence["second_network_state_record"] = second_state
        evidence["second_network_state_digest"] = hashlib.sha256(
            json.dumps(second_state, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        agreement = self._agreement(**evidence)
        self.assertEqual(
            agreement["network_consistency"]["status"], "network_state_mismatch"
        )

    def test_noncanonical_settings_payload_is_not_accepted_even_with_its_hash(self) -> None:
        evidence = verified_network_evidence([1, 2])
        tampered = evidence["second_network_settings_payload_json"] + " "
        evidence["second_network_settings_payload_json"] = tampered
        evidence["second_network_settings_digest"] = hashlib.sha256(tampered.encode()).hexdigest()
        agreement = self._agreement(**evidence)
        self.assertEqual(agreement["network_consistency"]["status"], "unverified")
        self.assertIn(
            "exact compact sorted JSON",
            agreement["network_consistency"]["evidence"]["network_settings"]["second"]["reason"],
        )

    def test_network_factors_must_be_positive_finite_numbers_not_booleans(self) -> None:
        for factor in (True, 0, -1):
            with self.subTest(factor=factor):
                evidence = verified_network_evidence([1, 2])
                settings = json.loads(evidence["second_network_settings_payload_json"])
                settings["road_class_factors"] = {"primary": factor}
                payload = json.dumps(settings, sort_keys=True, separators=(",", ":"))
                evidence["second_network_settings_payload_json"] = payload
                evidence["second_network_settings_digest"] = hashlib.sha256(
                    payload.encode()
                ).hexdigest()
                agreement = self._agreement(**evidence)
                self.assertEqual(
                    agreement["network_consistency"]["status"], "unverified"
                )
                self.assertIn(
                    "invalid road-class factor",
                    agreement["network_consistency"]["evidence"]["network_settings"]["second"]["reason"],
                )


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
        self.assertEqual(result["schema_version"], "openplan.corridor_agreement.v2")
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
