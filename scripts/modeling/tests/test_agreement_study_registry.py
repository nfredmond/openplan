#!/usr/bin/env python3
"""The pre-registration, and every way it could stop being one.

A study registry that can be rebuilt differently after the fact is not a
pre-registration. These tests hold the properties that make it one: the same
seed gives the same counties, both halves span the same strata, a short cell is
reported rather than backfilled, and an existing registry cannot be silently
overwritten with a different county list.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import agreement_study_registry as reg


def counts(region_prefix: str, sizes: dict[str, int]) -> dict[str, int]:
    return {f"{region_prefix}{suffix}": n for suffix, n in sizes.items()}


def four_state_universe() -> dict[str, dict[str, int]]:
    """Enough counties per (region, band) that every cell can be filled."""
    universe: dict[str, dict[str, int]] = {}
    for region, prefix in (("CA", "06"), ("CO", "08"), ("OR", "41"), ("WA", "53")):
        sizes = {}
        for index in range(6):  # 6 counties per band
            sizes[f"{index * 2 + 1:03d}"] = 20  # small
            sizes[f"{index * 2 + 101:03d}"] = 50  # medium
            sizes[f"{index * 2 + 201:03d}"] = 100  # large
        universe[region] = counts(prefix, sizes)
    return universe


class Banding(unittest.TestCase):
    def test_the_bands_partition_the_eligible_range_with_no_gap(self) -> None:
        for tracts in range(reg.MIN_TRACTS, reg.MAX_TRACTS + 1):
            self.assertIsNotNone(reg.band_of(tracts), f"{tracts} tracts falls in no band")

    def test_counties_outside_the_range_are_not_eligible(self) -> None:
        self.assertIsNone(reg.band_of(reg.MIN_TRACTS - 1))
        self.assertIsNone(reg.band_of(reg.MAX_TRACTS + 1))

    def test_eligibility_drops_the_too_small_the_too_large_and_the_excluded(self) -> None:
        universe = {"CA": {"06001": 5, "06003": 40, "06005": 400, "06057": 26}}
        eligible = reg.eligible_counties(universe)
        self.assertEqual([c["county_fips"] for c in eligible], ["06003"])

    def test_nevada_county_is_excluded_by_default(self) -> None:
        # Every method decision in this lane was made while looking at it.
        self.assertIn("06057", reg.EXCLUDED_COUNTIES)


class Selection(unittest.TestCase):
    def test_the_same_seed_gives_the_same_counties(self) -> None:
        universe = four_state_universe()
        first, _ = reg.select_counties(reg.eligible_counties(universe))
        second, _ = reg.select_counties(reg.eligible_counties(universe))
        self.assertEqual(
            [c["county_fips"] for c in first], [c["county_fips"] for c in second]
        )

    def test_a_different_seed_gives_a_different_draw(self) -> None:
        """If it did not, the seed would be decoration and the selection would
        not be a random draw at all."""
        candidates = reg.eligible_counties(four_state_universe())
        a, _ = reg.select_counties(candidates, seed=reg.SELECTION_SEED)
        b, _ = reg.select_counties(candidates, seed=reg.SELECTION_SEED + 1)
        self.assertNotEqual([c["county_fips"] for c in a], [c["county_fips"] for c in b])

    def test_every_cell_is_filled_when_the_universe_allows(self) -> None:
        selected, shortfalls = reg.select_counties(reg.eligible_counties(four_state_universe()))
        self.assertEqual(shortfalls, [])
        self.assertEqual(len(selected), 4 * 3 * reg.COUNTIES_PER_CELL)
        cells = {(c["region"], c["band"]) for c in selected}
        self.assertEqual(len(cells), 12)
        for cell in cells:
            in_cell = [c for c in selected if (c["region"], c["band"]) == cell]
            self.assertEqual(len(in_cell), reg.COUNTIES_PER_CELL, cell)

    def test_a_short_cell_is_reported_and_never_backfilled(self) -> None:
        universe = four_state_universe()
        # Leave Colorado with a single large county.
        universe["CO"] = {k: v for k, v in universe["CO"].items() if v != 100}
        universe["CO"]["08999"] = 100
        selected, shortfalls = reg.select_counties(reg.eligible_counties(universe))
        large_co = [c for c in selected if c["region"] == "CO" and c["band"] == "large"]
        self.assertEqual(len(large_co), 1)
        self.assertEqual(len(shortfalls), 1)
        self.assertEqual((shortfalls[0]["region"], shortfalls[0]["band"]), ("CO", "large"))
        self.assertEqual(shortfalls[0]["available"], 1)
        # And no other cell grew to compensate.
        for region in ("CA", "OR", "WA"):
            for band in ("small", "medium", "large"):
                in_cell = [c for c in selected if (c["region"], c["band"]) == (region, band)]
                self.assertEqual(len(in_cell), reg.COUNTIES_PER_CELL, (region, band))

    def test_one_cell_shrinking_does_not_change_another_cell_draw(self) -> None:
        """A single shared random stream would make every later cell's draw
        depend on how many counties the earlier cells happened to have."""
        universe = four_state_universe()
        base, _ = reg.select_counties(reg.eligible_counties(universe))
        universe["CA"] = {k: v for k, v in universe["CA"].items() if v != 20}
        changed, _ = reg.select_counties(reg.eligible_counties(universe))
        untouched_before = sorted(c["county_fips"] for c in base if c["region"] == "WA")
        untouched_after = sorted(c["county_fips"] for c in changed if c["region"] == "WA")
        self.assertEqual(untouched_before, untouched_after)


class TheSplit(unittest.TestCase):
    def setUp(self) -> None:
        self.selected, _ = reg.select_counties(reg.eligible_counties(four_state_universe()))
        self.halves = reg.split_dev_holdout(self.selected)

    def test_the_halves_are_equal_disjoint_and_complete(self) -> None:
        dev = {c["county_fips"] for c in self.halves["dev"]}
        holdout = {c["county_fips"] for c in self.halves["holdout"]}
        self.assertEqual(len(dev), len(holdout))
        self.assertEqual(dev & holdout, set())
        self.assertEqual(dev | holdout, {c["county_fips"] for c in self.selected})

    def test_both_halves_span_every_stratum(self) -> None:
        # A holdout half that is mostly large counties would answer a different
        # question than the development half did.
        for half in ("dev", "holdout"):
            cells = {(c["region"], c["band"]) for c in self.halves[half]}
            self.assertEqual(len(cells), 12, half)

    def test_each_county_is_labelled_with_the_half_it_is_in(self) -> None:
        self.assertTrue(all(c["half"] == "dev" for c in self.halves["dev"]))
        self.assertTrue(all(c["half"] == "holdout" for c in self.halves["holdout"]))


class TheRegistryDocument(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = reg.build_registry(four_state_universe())

    def test_it_carries_the_rules_that_must_precede_the_first_run(self) -> None:
        rules = self.registry["pre_registered_rules"]
        self.assertEqual(rules["minimum_stations_per_county"], 8)
        self.assertEqual(rules["convergence"]["rgap_target"], 0.0005)
        self.assertEqual(rules["convergence"]["max_iterations"], 3000)
        self.assertIn("never from a calibration", rules["reported_figures"])
        self.assertIn("refuses any run manifest carrying a calibration", rules["calibration"])

    def test_the_thresholds_come_from_the_shipped_constants(self) -> None:
        from corridor_agreement import DEFAULT_MINIMUM_VOLUME, GEH_CLOSE, GEH_MARGINAL

        thresholds = self.registry["pre_registered_rules"]["agreement_thresholds"]
        self.assertEqual(thresholds["geh_close"], GEH_CLOSE)
        self.assertEqual(thresholds["geh_marginal"], GEH_MARGINAL)
        self.assertEqual(thresholds["minimum_volume"], DEFAULT_MINIMUM_VOLUME)

    def test_it_says_why_nevada_county_is_absent(self) -> None:
        self.assertIn("06057", self.registry["selection"]["excluded_counties"])
        self.assertIn("shaped them", self.registry["selection"]["excluded_reason"])

    def test_an_empty_universe_is_refused_rather_than_pre_registering_nothing(self) -> None:
        with self.assertRaises(reg.AgreementStudyRegistryError):
            reg.build_registry({"CA": {"06001": 5}})


class WritingAndLoading(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "registry.json"
        self.registry = reg.build_registry(four_state_universe())

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_rewriting_the_same_registry_is_allowed(self) -> None:
        reg.write_registry(self.registry, self.path)
        reg.write_registry(self.registry, self.path)  # must not raise
        self.assertEqual(reg.load_registry(self.path)["counts"], self.registry["counts"])

    def test_overwriting_with_a_different_county_list_is_refused(self) -> None:
        reg.write_registry(self.registry, self.path)
        other = reg.build_registry(four_state_universe(), seed=reg.SELECTION_SEED + 5)
        with self.assertRaises(reg.AgreementStudyRegistryError) as ctx:
            reg.write_registry(other, self.path)
        self.assertIn("un-pre-register", str(ctx.exception))

    def test_a_missing_registry_says_to_build_it_first(self) -> None:
        with self.assertRaises(reg.AgreementStudyRegistryError) as ctx:
            reg.load_registry(self.path)
        self.assertIn("pre-registered", str(ctx.exception))

    def test_a_foreign_schema_version_is_refused(self) -> None:
        self.path.write_text(json.dumps({"schema_version": "something.else.v9"}))
        with self.assertRaises(reg.AgreementStudyRegistryError):
            reg.load_registry(self.path)


class TractCounting(unittest.TestCase):
    def test_counties_are_read_off_the_tract_rows_not_a_county_list(self) -> None:
        from unittest import mock

        payload = [
            ["NAME", "state", "county", "tract"],
            ["Tract 1", "06", "001", "000100"],
            ["Tract 2", "06", "001", "000200"],
            ["Tract 3", "06", "003", "000100"],
        ]
        import census_pums as cp

        with mock.patch.object(cp, "_get_json", return_value=payload):
            counts_by_county = reg.fetch_tract_counts("06", "key")
        self.assertEqual(counts_by_county, {"06001": 2, "06003": 1})

    def test_an_empty_answer_is_refused_rather_than_banding_nothing(self) -> None:
        from unittest import mock

        import census_pums as cp

        with mock.patch.object(cp, "_get_json", return_value=[]):
            with self.assertRaises(reg.AgreementStudyRegistryError):
                reg.fetch_tract_counts("06", "key")


if __name__ == "__main__":
    unittest.main()
