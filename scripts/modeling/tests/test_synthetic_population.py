#!/usr/bin/env python3
"""The sequence, not the pieces — where a population quietly describes nobody.

WHY THIS FILE TESTS THE ORCHESTRATION SEPARATELY
================================================
The fitting is tested in ``test_population_synthesis.py`` and the Census
categories in ``test_census_pums.py``. Both can be perfect while this file is
wrong, because the failures here are failures of ORDER: a zone fitted against
another zone's totals, a household expanded with another household's people, two
zones numbering their households from 1 so every person in the second attaches
to the first zone's household.

Each of those produces a population of exactly the right size, a fit that
converges, and a model run that finishes. None of them can be seen from inside
the pieces.

The network is injected, so what is exercised here is the real sequence against
records whose right answer is known.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import census_pums as cp  # noqa: E402
from synthetic_population import (  # noqa: E402
    SyntheticPopulationError,
    internal_zones,
    synthesize_study_area,
    zone_geography_of,
    zones_bbox,
)

TRACT_A = "06057000100"
TRACT_B = "06057000200"


def zone(zone_id: int, geoid: str, lon: float = -121.0, lat: float = 39.3, kind: str = "internal") -> dict:
    return {
        "GEOID": geoid,
        "zone_id": zone_id,
        "centroid_lon": lon,
        "centroid_lat": lat,
        "zone_kind": kind,
    }


def person(serial: str, order: int, age: int, esr: str = "1", veh: str = "2", income: str = "60000") -> dict:
    return {
        "SERIALNO": serial,
        "SPORDER": str(order),
        "AGEP": str(age),
        "SEX": "1",
        "ESR": esr,
        "SCHG": "5" if age < 18 else "",
        "WGTP": "10",
        "NP": "2",
        "HINCP": income,
        "ADJINC": "1.0",
        "VEH": veh,
    }


# Two distinguishable seed households: one working-age pair, one adult with a
# child. Nothing but the age split separates them, so a mix-up shows up.
SEED_ROWS = [
    person("2022HU_PAIR", 1, 40),
    person("2022HU_PAIR", 2, 42),
    person("2022HU_FAMILY", 1, 35),
    person("2022HU_FAMILY", 2, 10, esr=""),
]


def acs_row(one_person: int, two_person: int, children: int, adults: int) -> dict:
    """A zone's published totals, spelled in the cells the code actually reads."""
    return {
        "B11016_010E": str(one_person),
        "B11016_003E": str(two_person),
        "B19001_011E": str(one_person + two_person),      # all in the $50-60k bracket
        "B25044_005E": str(one_person + two_person),      # all owning 2 vehicles
        "B08202_004E": str(one_person + two_person),      # all with 2 workers
        "B01001_004E": str(children),                     # males 5 to 9
        "B01001_014E": str(adults),                       # males 40 to 44
        cp.HOUSEHOLD_POPULATION_CELL: str(children + adults),
        cp.TOTAL_POPULATION_CELL: str(children + adults),
    }


def fake_fetches(zone_totals: dict[str, dict]):
    def resolve(_bbox):
        return [{"vintage": "2020", "state_fips": "06", "puma": "05700", "name": "Test PUMA"}]

    def pums(_pumas, _key):
        return SEED_ROWS, {"sources": [], "person_records": len(SEED_ROWS)}

    def controls(geoids, _controls, _key):
        missing = [g for g in geoids if g not in zone_totals]
        if missing:
            raise cp.CensusPumsError(f"no totals for {missing}")
        return {g: zone_totals[g] for g in geoids}

    return dict(
        resolve_pumas=resolve,
        fetch_pums_person_rows=pums,
        fetch_acs_zone_controls=controls,
    )


class ChoosingTheZonesToPopulate(unittest.TestCase):
    def test_cordon_zones_get_no_residents(self) -> None:
        # A cordon zone stands for traffic entering from outside. Giving it
        # residents puts people at a point on the boundary and then lets them
        # make trips as though they lived there.
        zones = internal_zones([zone(1, TRACT_A), zone(2, "", kind="external")])
        self.assertEqual([z["zone_id"] for z in zones], [1])

    def test_every_spelling_of_an_outside_zone_is_excluded(self) -> None:
        rows = [zone(i, TRACT_A, kind=k) for i, k in enumerate(("external", "cordon", "gateway"), start=2)]
        with self.assertRaises(SyntheticPopulationError):
            internal_zones(rows)

    def test_a_zone_with_no_census_identifier_cannot_be_fitted(self) -> None:
        zones = internal_zones([zone(1, TRACT_A), zone(2, "")])
        self.assertEqual([z["zone_id"] for z in zones], [1])

    def test_the_geography_is_read_from_the_identifiers_not_a_label(self) -> None:
        # A mislabelled package would otherwise fit every block group to its
        # parent tract's totals — a complete population, every zone wrong.
        self.assertEqual(zone_geography_of([{"GEOID": TRACT_A}]), "tract")
        self.assertEqual(zone_geography_of([{"GEOID": TRACT_A + "1"}]), "block_group")

    def test_mixed_identifier_lengths_are_refused(self) -> None:
        with self.assertRaises(SyntheticPopulationError):
            zone_geography_of([{"GEOID": TRACT_A}, {"GEOID": TRACT_A + "1"}])

    def test_the_search_box_reaches_past_the_zone_centroids(self) -> None:
        # A study area whose edge sits just inside a sample-area boundary would
        # otherwise miss the sample covering most of its own population.
        box = zones_bbox([zone(1, TRACT_A, lon=-121.0, lat=39.3)])
        self.assertLess(box[0], -121.0)
        self.assertGreater(box[2], -121.0)


class TheSequenceItself(unittest.TestCase):
    def test_each_zone_is_fitted_to_its_own_totals(self) -> None:
        # THE ONE THAT CATCHES A CROSSED ZONE. Zone 1 asks for 10 households,
        # zone 2 for 40. Both fit, both converge, and a swap is invisible in
        # every total except each zone's own.
        totals = {
            TRACT_A: acs_row(one_person=0, two_person=10, children=0, adults=20),
            TRACT_B: acs_row(one_person=0, two_person=40, children=0, adults=80),
        }
        result = synthesize_study_area(
            [zone(1, TRACT_A), zone(2, TRACT_B)], census_api_key="k", **fake_fetches(totals)
        )
        by_zone: dict[int, int] = {}
        for household in result["households"]:
            by_zone[household["home_zone_id"]] = by_zone.get(household["home_zone_id"], 0) + 1
        self.assertEqual(by_zone, {1: 10, 2: 40})

    def test_household_ids_never_repeat_across_zones(self) -> None:
        # Two zones both numbering from 1 makes every person in the second
        # attach to a household in the first — the population is the right size
        # and half of it lives somewhere it does not.
        totals = {
            TRACT_A: acs_row(0, 10, 0, 20),
            TRACT_B: acs_row(0, 10, 0, 20),
        }
        result = synthesize_study_area(
            [zone(1, TRACT_A), zone(2, TRACT_B)], census_api_key="k", **fake_fetches(totals)
        )
        ids = [h["household_id"] for h in result["households"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_person_ids_never_repeat_either(self) -> None:
        totals = {TRACT_A: acs_row(0, 10, 0, 20), TRACT_B: acs_row(0, 10, 0, 20)}
        result = synthesize_study_area(
            [zone(1, TRACT_A), zone(2, TRACT_B)], census_api_key="k", **fake_fetches(totals)
        )
        ids = [p["person_id"] for p in result["persons"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_person_belongs_to_a_household_that_exists(self) -> None:
        totals = {TRACT_A: acs_row(0, 10, 0, 20), TRACT_B: acs_row(0, 25, 0, 50)}
        result = synthesize_study_area(
            [zone(1, TRACT_A), zone(2, TRACT_B)], census_api_key="k", **fake_fetches(totals)
        )
        household_ids = {h["household_id"] for h in result["households"]}
        for p in result["persons"]:
            self.assertIn(p["household_id"], household_ids)

    def test_a_household_carries_the_real_people_from_its_seed_record(self) -> None:
        # The whole point of fetching microdata. A synthesiser that invents
        # plausible people to fill a household of the right size has thrown away
        # the only thing the seed was for — and the result looks identical.
        totals = {TRACT_A: acs_row(one_person=0, two_person=10, children=5, adults=15)}
        result = synthesize_study_area([zone(1, TRACT_A)], census_api_key="k", **fake_fetches(totals))

        def people_in(seed_id: str) -> list[list[int]]:
            households = [h for h in result["households"] if h["seed_household_id"] == seed_id]
            self.assertTrue(households, f"the {seed_id} seed household was never used")
            return [
                sorted(p["age"] for p in result["persons"] if p["household_id"] == h["household_id"])
                for h in households
            ]

        # BOTH seed records checked, deliberately. Asserting only one of them
        # passes even when every household in the study area is expanded from
        # the same seed record — a mutation proved exactly that, because the
        # record being checked happened to be the one used for everything.
        for ages in people_in("2022HU_FAMILY"):
            self.assertEqual(ages, [10, 35])
        for ages in people_in("2022HU_PAIR"):
            self.assertEqual(ages, [40, 42])

        family = [h for h in result["households"] if h["seed_household_id"] == "2022HU_FAMILY"][0]
        family_people = sorted(
            (p for p in result["persons"] if p["household_id"] == family["household_id"]),
            key=lambda p: p["age"],
        )
        self.assertEqual([p["is_student"] for p in family_people], [1, 0])

    def test_a_persons_home_zone_matches_the_household_it_is_in(self) -> None:
        totals = {TRACT_A: acs_row(0, 10, 0, 20), TRACT_B: acs_row(0, 10, 0, 20)}
        result = synthesize_study_area(
            [zone(1, TRACT_A), zone(2, TRACT_B)], census_api_key="k", **fake_fetches(totals)
        )
        zone_of = {h["household_id"]: h["home_zone_id"] for h in result["households"]}
        for p in result["persons"]:
            self.assertEqual(p["home_zone_id"], zone_of[p["household_id"]])

    def test_household_size_and_workers_come_from_the_people_actually_present(self) -> None:
        totals = {TRACT_A: acs_row(0, 10, 5, 15)}
        result = synthesize_study_area([zone(1, TRACT_A)], census_api_key="k", **fake_fetches(totals))
        for household in result["households"]:
            people = [p for p in result["persons"] if p["household_id"] == household["household_id"]]
            self.assertEqual(household["persons"], len(people))
            self.assertEqual(household["workers"], sum(p["is_worker"] for p in people))


class WhatItRefusesToDo(unittest.TestCase):
    def test_unreachable_microdata_raises_rather_than_scaffolding(self) -> None:
        # The failure this whole module replaces is a population built from the
        # model's own inputs. One appearing under the same filename, without
        # saying so, is worse than none at all.
        fakes = fake_fetches({TRACT_A: acs_row(0, 10, 0, 20)})

        def refuse(_pumas, _key):
            raise cp.CensusPumsError("the microdata endpoint is unreachable")

        fakes["fetch_pums_person_rows"] = refuse
        with self.assertRaises(SyntheticPopulationError) as caught:
            synthesize_study_area([zone(1, TRACT_A)], census_api_key="k", **fakes)
        self.assertIn("unreachable", str(caught.exception))

    def test_a_seed_emptied_by_exclusions_is_refused_with_the_counts(self) -> None:
        fakes = fake_fetches({TRACT_A: acs_row(0, 10, 0, 20)})
        fakes["fetch_pums_person_rows"] = lambda _p, _k: (
            [person("2022GQ0001", 1, 30)],
            {"sources": [], "person_records": 1},
        )
        with self.assertRaises(SyntheticPopulationError) as caught:
            synthesize_study_area([zone(1, TRACT_A)], census_api_key="k", **fakes)
        self.assertIn("group_quarters", str(caught.exception))

    def test_a_zone_with_no_published_totals_stops_the_run(self) -> None:
        # Fitting only the zones that answered would leave the rest empty, and
        # an empty zone reads as a place where nobody lives.
        with self.assertRaises(SyntheticPopulationError):
            synthesize_study_area(
                [zone(1, TRACT_A), zone(2, TRACT_B)],
                census_api_key="k",
                **fake_fetches({TRACT_A: acs_row(0, 10, 0, 20)}),
            )


class WhatTravelsWithTheResult(unittest.TestCase):
    def _result(self):
        return synthesize_study_area(
            [zone(1, TRACT_A)], census_api_key="k",
            **fake_fetches({TRACT_A: acs_row(0, 10, 5, 15)}),
        )

    def test_the_provenance_names_the_sample_it_was_drawn_from(self) -> None:
        result = self._result()
        self.assertIn("Test PUMA", result["provenance"]["note"])
        self.assertEqual(result["method"], "acs_pums_seed_iterative_proportional_updating")

    def test_the_fit_quality_travels_with_the_population(self) -> None:
        # A caller must not be able to take the households without also being
        # handed how well they reproduce the published totals.
        result = self._result()
        quality = result["fit_quality"]
        self.assertEqual(quality["zones_fitted"], 1)
        # Asserted on what the real summary COMPUTES, not just on a key being
        # present: a hand-written stand-in satisfied the shape of this check
        # while carrying none of the grading, and the mutation survived.
        self.assertEqual(quality["zones_graded_against_margins"], 1)
        self.assertEqual(quality["zones_outside_published_margin"], 0)
        self.assertIn("margin of error", quality["note"])
        self.assertIn("margin of error", result["fit_grading_note"])

    def test_a_block_group_run_reports_the_control_it_had_to_drop(self) -> None:
        totals = {TRACT_A + "1": acs_row(0, 10, 5, 15)}
        result = synthesize_study_area(
            [zone(1, TRACT_A + "1")], census_api_key="k", **fake_fetches(totals)
        )
        self.assertIn("workers", result["dropped_controls"])
        self.assertEqual(result["summary"]["zone_geography"], "block_group")

    def test_the_raw_survey_codes_travel_with_the_population(self) -> None:
        """HHT rides on households; ESR/SCHG/WKHP ride on persons, verbatim.

        Downstream adapters (the ActivitySim MTC package) derive person types
        from the codes themselves; a population that only carries our 0/1
        reductions of them cannot be coded."""
        enriched = []
        for row in SEED_ROWS:
            copy = dict(row)
            copy["HHT"] = "1" if row["SERIALNO"] == "2022HU_PAIR" else "3"
            copy["WKHP"] = "40" if row["ESR"] == "1" else ""
            enriched.append(copy)

        fakes = fake_fetches({TRACT_A: acs_row(0, 10, 5, 15)})

        def pums_with_codes(_pumas, _key):
            return enriched, {"sources": [], "person_records": len(enriched)}

        fakes["fetch_pums_person_rows"] = pums_with_codes
        result = synthesize_study_area([zone(1, TRACT_A)], census_api_key="k", **fakes)

        pair = next(h for h in result["households"] if h["seed_household_id"] == "2022HU_PAIR")
        family = next(h for h in result["households"] if h["seed_household_id"] == "2022HU_FAMILY")
        self.assertEqual(pair["hht"], 1)
        self.assertEqual(family["hht"], 3)

        workers = [p for p in result["persons"] if p["esr"] == "1"]
        self.assertTrue(workers, "no persons carried a raw ESR code")
        self.assertTrue(all(p["wkhp"] == "40" for p in workers))
        child = next(p for p in result["persons"] if p["age"] == 10)
        self.assertEqual(child["schg"], "5")
        self.assertEqual(child["wkhp"], "")

    def test_a_seed_without_the_new_codes_still_builds_with_them_blank(self) -> None:
        # Older fixtures (and any non-US adapter that lacks these fields) must
        # keep working: absent codes become 0 / empty string, never a crash.
        totals = {TRACT_A: acs_row(0, 10, 5, 15)}
        result = synthesize_study_area([zone(1, TRACT_A)], census_api_key="k", **fake_fetches(totals))
        self.assertEqual(result["households"][0]["hht"], 0)
        self.assertEqual(result["persons"][0]["wkhp"], "")


if __name__ == "__main__":
    unittest.main()
