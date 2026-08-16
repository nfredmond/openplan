#!/usr/bin/env python3
"""Which population a bundle contains, and whether it says so.

THE FAILURE THIS GUARDS
=======================
Two populations can occupy the same two filenames. One is fitted from real
Census survey records; the other is expanded from the screening zone
attributes — the same inputs the trip-based demand model already uses, which is
why comparing the two models on a scaffolded population compares a model against
a rearrangement of its own inputs.

They are indistinguishable downstream. ActivitySim runs on either, the bundle
manifest has the same shape, and the households.csv looks the same. The only
thing that separates them is what the manifest and the caveats SAY — so a
scaffold shipping under the fitted population's caveats is a false claim about
where a planner's numbers came from, and it would never surface anywhere else.
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import build_activitysim_input_bundle as builder  # noqa: E402
import synthetic_population as sp  # noqa: E402


def zone(zone_id: int, geoid: str, kind: str = "internal") -> dict:
    return {
        "GEOID": geoid,
        "NAMELSAD": f"Tract {zone_id}",
        "zone_id": float(zone_id),
        "centroid_lon": -121.0,
        "centroid_lat": 39.3,
        "area_sq_mi": 5.0,
        "total_jobs": 100.0,
        "retail_jobs": 10.0,
        "health_jobs": 5.0,
        "education_jobs": 5.0,
        "accommodation_jobs": 5.0,
        "govt_jobs": 5.0,
        "est_population": 500.0,
        "households": 200.0,
        "worker_residents": 250.0,
        "area_share": 0.5,
        "zone_kind": kind,
    }


ZONES = [zone(1, "06057000100"), zone(2, "06057000200")]

FITTED = {
    "households": [{"household_id": 1, "home_zone_id": 1, "persons": 2}],
    "persons": [{"person_id": 1, "household_id": 1, "is_worker": 1}],
    "summary": {"households": 1, "persons": 1, "workers": 1, "zones_with_households": 1,
                "zone_geography": "tract"},
    "fit_quality": {"zones_fitted": 2, "note": "All 2 zones reproduce their published totals."},
    "fit_grading_note": "Graded against the published margin of error.",
    "dropped_controls": {},
    "provenance": {"note": "Drawn from Nevada & Sierra Counties PUMA."},
    "method": "acs_pums_seed_iterative_proportional_updating",
}


class WhichPopulationWasBuilt(unittest.TestCase):
    def test_a_fitted_population_is_labelled_as_fitted(self) -> None:
        with mock.patch.dict(os.environ, {"CENSUS_API_KEY": "key"}), \
             mock.patch.object(sp, "synthesize_study_area", return_value=FITTED):
            _, _, _, block, caveats = builder.build_population(ZONES, "auto")

        self.assertEqual(block["status"], "fitted_to_published_totals")
        self.assertEqual(block["method"], "acs_pums_seed_iterative_proportional_updating")
        self.assertIn("Nevada & Sierra Counties PUMA", " ".join(caveats))

    def test_a_fitted_population_never_carries_the_scaffold_caveats(self) -> None:
        # The claim that matters. "Deterministically scaffolded from screening
        # zone attributes" is simply false of a fitted population, and a reader
        # deciding whether to trust a comparison reads exactly this line.
        with mock.patch.dict(os.environ, {"CENSUS_API_KEY": "key"}), \
             mock.patch.object(sp, "synthesize_study_area", return_value=FITTED):
            _, _, _, _, caveats = builder.build_population(ZONES, "auto")

        for scaffold_caveat in builder.SCAFFOLD_POPULATION_CAVEATS:
            self.assertNotIn(scaffold_caveat, caveats)

    def test_a_scaffold_never_carries_the_fitted_populations_claims(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            _, _, _, block, caveats = builder.build_population(ZONES, "scaffold")

        self.assertEqual(block["status"], "prototype_scaffold")
        self.assertNotIn("PUMA", " ".join(caveats))
        self.assertIn(builder.SCAFFOLD_POPULATION_CAVEATS[0], caveats)

    def test_the_scaffolds_caveats_say_it_is_not_an_independent_method(self) -> None:
        # The reason this replacement exists at all. A planner comparing the two
        # models has to be told when one of them was built from the other's
        # inputs, and this is the only place that is said.
        joined = " ".join(builder.SCAFFOLD_POPULATION_CAVEATS)
        self.assertIn("SAME zone attributes", joined)
        self.assertIn("independent methods", joined)


class WhenTheMicrodataCannotBeReached(unittest.TestCase):
    def test_auto_falls_back_but_records_why_in_the_manifest_and_caveats(self) -> None:
        with mock.patch.dict(os.environ, {"CENSUS_API_KEY": "key"}), \
             mock.patch.object(
                 sp, "synthesize_study_area",
                 side_effect=sp.SyntheticPopulationError("the endpoint is unreachable")):
            _, _, _, block, caveats = builder.build_population(ZONES, "auto")

        self.assertEqual(block["status"], "prototype_scaffold")
        self.assertIn("unreachable", block["fallback_reason"])
        # And the reason leads the caveats, so it is read before the numbers.
        self.assertIn("unreachable", caveats[0])

    def test_asking_for_census_explicitly_fails_rather_than_degrading(self) -> None:
        # A caller that asked for real records and silently received zone
        # averages would report a comparison of two independent methods that
        # never happened.
        with mock.patch.dict(os.environ, {"CENSUS_API_KEY": "key"}), \
             mock.patch.object(
                 sp, "synthesize_study_area",
                 side_effect=sp.SyntheticPopulationError("the endpoint is unreachable")):
            with self.assertRaises(sp.SyntheticPopulationError):
                builder.build_population(ZONES, "census")

    def test_no_key_at_all_is_a_recorded_reason_not_a_silent_scaffold(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            _, _, _, block, caveats = builder.build_population(ZONES, "auto")

        self.assertEqual(block["status"], "prototype_scaffold")
        self.assertIn("CENSUS_API_KEY", block["fallback_reason"])
        self.assertIn("CENSUS_API_KEY", caveats[0])

    def test_asking_for_census_without_a_key_says_where_to_get_one(self) -> None:
        # The synthesiser is replaced with something that fails if it is called
        # at all, deliberately. Without that this test passed for the wrong
        # reason: with the key check removed it went on to make a LIVE network
        # request, got the adapter's own missing-key message back, and the
        # assertion still matched. A mutation caught it.
        def must_not_be_called(*_args, **_kwargs):
            raise AssertionError("the missing key should have been caught before any network call")

        with mock.patch.dict(os.environ, {}, clear=True), \
             mock.patch.object(sp, "synthesize_study_area", must_not_be_called):
            with self.assertRaises(RuntimeError) as caught:
                builder.build_population(ZONES, "census")
        self.assertIn("key_signup", str(caught.exception))

    def test_an_unknown_population_source_is_refused(self) -> None:
        with self.assertRaises(RuntimeError):
            builder.build_population(ZONES, "whatever")


class WhatTheManifestCarries(unittest.TestCase):
    def test_the_fit_quality_reaches_the_manifest_block(self) -> None:
        # A bundle whose population is poorly fitted must carry that fact where
        # a reader of the bundle finds it, not only in a log nobody keeps.
        with mock.patch.dict(os.environ, {"CENSUS_API_KEY": "key"}), \
             mock.patch.object(sp, "synthesize_study_area", return_value=FITTED):
            _, _, _, block, _ = builder.build_population(ZONES, "auto")

        self.assertEqual(block["fit_quality"], FITTED["fit_quality"])
        self.assertEqual(block["seed_provenance"], FITTED["provenance"])
        self.assertEqual(block["fit_grading"], FITTED["fit_grading_note"])

    def test_a_control_that_could_not_be_fitted_reaches_the_caveats(self) -> None:
        fitted = dict(FITTED, dropped_controls={"workers": "B08202 is not published at this level."})
        with mock.patch.dict(os.environ, {"CENSUS_API_KEY": "key"}), \
             mock.patch.object(sp, "synthesize_study_area", return_value=fitted):
            _, _, _, block, caveats = builder.build_population(ZONES, "auto")

        self.assertIn("workers", block["controls_not_fitted"])
        self.assertIn("B08202 is not published at this level.", caveats)

    def test_the_coefficient_caveat_survives_a_good_fit(self) -> None:
        # A population drawn from local survey records does not make the travel
        # behaviour local, and a clean fit is exactly when that gets forgotten.
        with mock.patch.dict(os.environ, {"CENSUS_API_KEY": "key"}), \
             mock.patch.object(sp, "synthesize_study_area", return_value=FITTED):
            _, _, _, _, caveats = builder.build_population(ZONES, "auto")

        self.assertIn("behavioural coefficients", " ".join(caveats))


class ItSurvivesTheWholeChainToTheCountyManifest(unittest.TestCase):
    """Four hops from the bundle to the record a planner reads.

    The bundle writes it, the bundle summary carries it, the prototype step
    records it, and the county manifest surfaces it. Any hop that drops it
    leaves a county run reporting 42,000 households with nothing saying where
    they came from — which is the defect class this repository keeps finding:
    a complete, tested capability nobody can reach.
    """

    def test_the_bundle_summary_carries_the_population_kind(self) -> None:
        # Asserted by BUILDING a bundle, not by reading the source for the key.
        # A source scan passes while the field is spelled and never filled, and
        # that is the same mistake as guarding a claim by scanning a document.
        import csv as csv_module
        import json as json_module
        import tempfile

        with tempfile.TemporaryDirectory() as workspace:
            run_dir = Path(workspace) / "run"
            (run_dir / "package").mkdir(parents=True)
            (run_dir / "run_output").mkdir(parents=True)
            (run_dir / "bundle_manifest.json").write_text(json_module.dumps({"run_name": "t"}))
            (run_dir / "run_output" / "travel_time_skims.omx").write_bytes(b"not a real omx")
            with (run_dir / "package" / "zone_attributes.csv").open("w", newline="") as handle:
                writer = csv_module.DictWriter(handle, fieldnames=list(ZONES[0]))
                writer.writeheader()
                writer.writerows(ZONES)

            summary = builder.build_activitysim_input_bundle(
                screening_run_dir=str(run_dir),
                output_dir=str(Path(workspace) / "bundle"),
                population_source="scaffold",
            )

            constants = (Path(workspace) / "bundle" / "configs" / "constants.yaml").read_text()

        self.assertEqual(summary["population"]["status"], "prototype_scaffold")
        self.assertEqual(summary["population"]["method"], "deterministic_zone_attribute_expansion")
        self.assertGreater(summary["households"], 0)
        # The generated config is stamped with the population the bundle
        # actually has. It used to say 'prototype_scaffold' unconditionally,
        # which becomes a false statement in a file that outlives the run log.
        self.assertIn("openplan_population_status: prototype_scaffold", constants)

    def test_the_county_manifest_surfaces_it(self) -> None:
        import bootstrap_county_validation_onramp as onramp

        summary = onramp.summarize_activitysim_bundle(
            {
                "steps": {
                    "build_activitysim_input_bundle": {
                        "status": "succeeded",
                        "artifacts": {"bundle_dir": "/x", "bundle_manifest_path": "/x/manifest.json"},
                        "metadata": {
                            "land_use_rows": 34,
                            "households": 42392,
                            "persons": 100382,
                            "skim_mode": "copy",
                            "population": {
                                "status": "fitted_to_published_totals",
                                "method": "acs_pums_seed_iterative_proportional_updating",
                                "fallback_reason": None,
                            },
                        },
                    }
                }
            }
        )
        self.assertEqual(summary["population"]["status"], "fitted_to_published_totals")

    def test_a_county_run_that_fell_back_carries_the_reason_that_far(self) -> None:
        import bootstrap_county_validation_onramp as onramp

        summary = onramp.summarize_activitysim_bundle(
            {
                "steps": {
                    "build_activitysim_input_bundle": {
                        "status": "succeeded",
                        "artifacts": {},
                        "metadata": {
                            "population": {
                                "status": "prototype_scaffold",
                                "method": "deterministic_zone_attribute_expansion",
                                "fallback_reason": "No CENSUS_API_KEY was configured.",
                            }
                        },
                    }
                }
            }
        )
        self.assertIn("CENSUS_API_KEY", summary["population"]["fallback_reason"])


if __name__ == "__main__":
    unittest.main()
