#!/usr/bin/env python3
"""The United States adapter: every way a category can be silently wrong.

WHY THESE ARE THE TESTS
=======================
Nothing here fails loudly. A household sorted into the wrong income bracket, an
age control fitted to a population that includes people the seed excludes, a
microdata query that returns a fifth of the sample — every one of them produces
a complete population, a converged fit and a finished model run. The categories
simply describe someone other than the people who live there.

So these tests assert the boundaries and the exclusions, and the parts that
have already been observed to behave differently from how they read.

Every ACS cell reference below was verified against the live variables endpoint
on 2026-08-16; the API structure claims here are records of what was checked,
not recollections.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import census_pums as cp  # noqa: E402


class SortingAHouseholdIntoItsCategory(unittest.TestCase):
    def test_size_categories_stop_at_four_or_more(self) -> None:
        self.assertEqual(
            [cp.size_category(n) for n in (0, 1, 2, 3, 4, 9)],
            ["1", "1", "2", "3", "4_plus", "4_plus"],
        )

    def test_income_brackets_match_the_acs_boundaries_they_are_fitted_to(self) -> None:
        # The published table breaks at 35k, 75k and 150k; a household exactly on
        # a boundary belongs to the bracket that STARTS there, as it does in the
        # ACS. An off-by-one here shifts households between brackets and the fit
        # then chases a target counting something different.
        self.assertEqual(cp.income_category(34_999), "under_35k")
        self.assertEqual(cp.income_category(35_000), "35_to_75k")
        self.assertEqual(cp.income_category(74_999), "35_to_75k")
        self.assertEqual(cp.income_category(75_000), "75_to_150k")
        self.assertEqual(cp.income_category(149_999), "75_to_150k")
        self.assertEqual(cp.income_category(150_000), "150k_plus")

    def test_a_household_that_lost_money_is_in_the_lowest_bracket(self) -> None:
        # A negative household income is a real survey answer — a business loss —
        # and the ACS table puts it in its bottom bracket too.
        self.assertEqual(cp.income_category(-4_200), "under_35k")

    def test_an_unreported_income_is_not_guessed_at(self) -> None:
        self.assertIsNone(cp.income_category(None))
        self.assertIsNone(cp.adjusted_income(None, "1.0"))
        self.assertIsNone(cp.adjusted_income("", "1.0"))
        self.assertIsNone(cp.adjusted_income("not a number", "1.0"))

    def test_the_group_quarters_income_sentinel_is_not_read_as_a_loss(self) -> None:
        # PUMS reports -60000 for a record with no household income. Read as a
        # number it is a household that lost $60,000, and it would be counted in
        # the lowest income bracket instead of excluded.
        self.assertIsNone(cp.adjusted_income("-60000", "1.042311"))

    def test_income_is_adjusted_to_the_files_final_year_dollars(self) -> None:
        # ESSENTIAL, NOT COSMETIC. The five-year sample mixes 2018 and 2022
        # dollars while the income table it is fitted to is entirely in
        # final-year dollars. Skipping this shifts early-year households a
        # bracket down and overstates how many households are poor.
        self.assertAlmostEqual(cp.adjusted_income("100000", "1.1"), 110_000.0, places=3)

    def test_both_spellings_of_the_adjustment_factor_are_accepted(self) -> None:
        # The API serves 1.042311; the published flat files carry 1042311. A
        # factor of a million applied by accident would not look like an error in
        # any downstream number — every household would simply be rich.
        api_form = cp.adjusted_income("50000", "1.042311")
        file_form = cp.adjusted_income("50000", "1042311")
        self.assertAlmostEqual(api_form, file_form, places=3)
        self.assertAlmostEqual(api_form, 52_115.55, places=1)

    def test_vehicle_categories_stop_at_three_or_more(self) -> None:
        self.assertEqual(
            [cp.vehicle_category(v) for v in ("0", "1", "2", "3", "6")],
            ["0", "1", "2", "3_plus", "3_plus"],
        )

    def test_the_not_applicable_vehicle_code_is_not_read_as_zero_cars(self) -> None:
        # PUMS uses -1 where the question does not apply. Read as zero it makes a
        # car-owning household look carless, which is the direction that matters:
        # zero-vehicle share is a published equity indicator in this repository.
        self.assertIsNone(cp.vehicle_category("-1"))
        self.assertIsNone(cp.vehicle_category(None))
        self.assertIsNone(cp.vehicle_category(""))

    def test_only_employed_status_codes_count_as_workers(self) -> None:
        # ESR: 1 and 2 are employed civilians, 4 and 5 armed forces. 3 is
        # unemployed, 6 is not in the labour force, and blank is a person under
        # 16 — counting any of those inflates every household's worker count.
        self.assertEqual([cp.is_worker(c) for c in ("1", "2", "4", "5")], [True] * 4)
        self.assertEqual([cp.is_worker(c) for c in ("3", "6", "", None)], [False] * 4)

    def test_age_boundaries_fall_where_the_published_cells_break(self) -> None:
        # B01001 breaks between 15-17 and 18-19, and between 62-64 and 65-66, so
        # neither of these boundaries splits a published cell across two controls.
        self.assertEqual(cp.age_category(17), "child")
        self.assertEqual(cp.age_category(18), "adult")
        self.assertEqual(cp.age_category(64), "adult")
        self.assertEqual(cp.age_category(65), "senior")
        self.assertIsNone(cp.age_category(None))


class BuildingTheSeedFromMicrodata(unittest.TestCase):
    def person(self, serial: str, **overrides) -> dict:
        row = {
            "SERIALNO": serial,
            "WGTP": "40",
            "NP": "2",
            "HINCP": "60000",
            "ADJINC": "1.0",
            "VEH": "2",
            "AGEP": "40",
            "ESR": "1",
        }
        row.update(overrides)
        return row

    def test_people_are_grouped_into_the_household_they_share(self) -> None:
        seed, dropped = cp.seed_households_from_pums(
            [
                self.person("2022HU01"),
                self.person("2022HU01", AGEP="38"),
                self.person("2022HU01", AGEP="9", ESR=""),
                self.person("2022HU02", NP="1"),
            ]
        )
        self.assertEqual(len(seed), 2)
        by_id = {h.household_id: h for h in seed}
        self.assertEqual(by_id["2022HU01"].persons, 3)
        self.assertEqual(by_id["2022HU01"].household_category["size"], "3")
        self.assertEqual(by_id["2022HU01"].person_categories["age"], {"adult": 2, "child": 1})
        self.assertEqual(by_id["2022HU01"].household_category["workers"], "2")

    def test_group_quarters_records_are_excluded_and_counted(self) -> None:
        # A dormitory or a prison is not a household anybody drives from, it
        # reports no income, and its household weight is zero. Included, it lands
        # in the lowest income bracket and distorts every zone fitted from it.
        seed, dropped = cp.seed_households_from_pums(
            [self.person("2022GQ0001", WGTP="0", HINCP="-60000"), self.person("2022HU01")]
        )
        self.assertEqual([h.household_id for h in seed], ["2022HU01"])
        self.assertEqual(dropped["group_quarters"], 1)

    def test_a_household_that_cannot_be_categorised_is_dropped_not_defaulted(self) -> None:
        # Assigning a default category would put a household the survey never
        # described into a planner's numbers, and it would be indistinguishable
        # from one it did.
        seed, dropped = cp.seed_households_from_pums(
            [self.person("2022HU01", VEH="-1"), self.person("2022HU02")]
        )
        self.assertEqual([h.household_id for h in seed], ["2022HU02"])
        self.assertEqual(dropped["unclassifiable"], 1)

    def test_a_zero_weight_household_is_dropped_and_counted_separately(self) -> None:
        seed, dropped = cp.seed_households_from_pums([self.person("2022HU01", WGTP="0")])
        self.assertEqual(seed, [])
        self.assertEqual(dropped["zero_weight"], 1)


class ControlsThatDependOnTheGeography(unittest.TestCase):
    def test_a_tract_run_fits_all_five_controls(self) -> None:
        controls, dropped = cp.controls_for_geography("tract")
        self.assertEqual([c.name for c in controls], ["size", "income", "vehicles", "workers", "age"])
        self.assertEqual(dropped, {})

    def test_a_block_group_run_drops_workers_and_says_why(self) -> None:
        # VERIFIED LIVE 2026-08-16: B08202 answers HTTP 200 with every cell null
        # at block-group geography, exactly as B17001 does for poverty. Left in,
        # every zone's worker target is zero and the population has nobody
        # employed in it — with no error anywhere.
        controls, dropped = cp.controls_for_geography("block_group")
        self.assertEqual([c.name for c in controls], ["size", "income", "vehicles", "age"])
        self.assertIn("workers", dropped)
        self.assertIn("B08202", dropped["workers"])

    def test_every_control_has_cells_defined_for_every_category(self) -> None:
        # A category with no cells silently targets zero, which reads as "this
        # zone has none of these households" rather than "nobody asked".
        for control in [cp.SIZE_CONTROL, cp.INCOME_CONTROL, cp.VEHICLES_CONTROL,
                        cp.WORKERS_CONTROL, cp.AGE_CONTROL]:
            for category in control.categories:
                cells = cp.CONTROL_CELLS[control.name][category]
                self.assertTrue(cells, f"{control.name}:{category} has no ACS cells")

    def test_no_acs_cell_is_counted_in_two_categories_of_one_control(self) -> None:
        # A cell in two categories double-counts those households and the
        # category totals stop summing to the zone's household count.
        for control in [cp.SIZE_CONTROL, cp.INCOME_CONTROL, cp.VEHICLES_CONTROL,
                        cp.WORKERS_CONTROL, cp.AGE_CONTROL]:
            seen: set[str] = set()
            for category in control.categories:
                for cell in cp.CONTROL_CELLS[control.name][category]:
                    self.assertNotIn(cell, seen, f"{cell} appears twice in {control.name}")
                    seen.add(cell)

    def test_margins_of_error_are_requested_alongside_the_estimates(self) -> None:
        variables = cp.acs_variables_for([cp.SIZE_CONTROL])
        self.assertIn("B11016_010E", variables)
        self.assertIn("B11016_010M", variables)

    def test_the_population_universe_cells_are_always_requested(self) -> None:
        # Without them the group-quarters share cannot be computed and the age
        # control is fitted to a population the seed does not contain.
        variables = cp.acs_variables_for([cp.SIZE_CONTROL])
        self.assertIn(cp.HOUSEHOLD_POPULATION_CELL, variables)
        self.assertIn(cp.TOTAL_POPULATION_CELL, variables)


class TurningPublishedCellsIntoTargets(unittest.TestCase):
    def test_a_category_sums_the_cells_that_make_it_up(self) -> None:
        row = {"B11016_010E": "100", "B11016_003E": "50", "B11016_011E": "25"}
        targets = cp.zone_targets_from_acs(row, [cp.SIZE_CONTROL])
        self.assertEqual(targets["size"]["1"], 100.0)
        self.assertEqual(targets["size"]["2"], 75.0)

    def test_a_suppressed_cell_is_read_as_zero_not_as_an_error(self) -> None:
        row = {"B11016_010E": None, "B11016_003E": "50"}
        targets = cp.zone_targets_from_acs(row, [cp.SIZE_CONTROL])
        self.assertEqual(targets["size"]["1"], 0.0)

    def test_person_targets_are_scaled_to_the_household_population(self) -> None:
        # THE GROUP-QUARTERS FIX. The age table counts everyone in the zone;
        # the seed contains only households. A tract holding a prison or a
        # university hall would otherwise ask the fit for people the seed has
        # none of, and the household population would be inflated to cover them.
        row = {
            "B01001_003E": "100",
            "B01001_007E": "400",
            cp.HOUSEHOLD_POPULATION_CELL: "400",
            cp.TOTAL_POPULATION_CELL: "500",
        }
        targets = cp.zone_targets_from_acs(row, [cp.AGE_CONTROL])
        self.assertAlmostEqual(targets["age"]["child"], 80.0)
        self.assertAlmostEqual(targets["age"]["adult"], 320.0)

    def test_household_targets_are_not_scaled_by_the_household_share(self) -> None:
        # Household counts already exclude group quarters; scaling them too
        # would shrink every zone's household count by the same factor twice.
        row = {"B11016_010E": "100", cp.HOUSEHOLD_POPULATION_CELL: "400", cp.TOTAL_POPULATION_CELL: "500"}
        targets = cp.zone_targets_from_acs(row, [cp.SIZE_CONTROL])
        self.assertEqual(targets["size"]["1"], 100.0)

    def test_a_zone_with_no_universe_cells_is_left_unscaled(self) -> None:
        row = {"B01001_003E": "100"}
        self.assertEqual(cp.household_population_share(row), 1.0)
        self.assertEqual(cp.zone_targets_from_acs(row, [cp.AGE_CONTROL])["age"]["child"], 100.0)


class MarginsOfError(unittest.TestCase):
    def test_margins_combine_in_quadrature_not_by_addition(self) -> None:
        # The Census Bureau's own published rule for aggregating margins. Adding
        # them directly overstates the uncertainty of a category built from many
        # cells — for the eight-cell 4-plus size category, by roughly threefold —
        # and every fit would then look acceptable.
        row = {"B11016_003M": "30", "B11016_011M": "40"}
        margins = cp.zone_margins_from_acs(row, [cp.SIZE_CONTROL])
        self.assertAlmostEqual(margins["size"]["2"], 50.0)  # sqrt(30^2 + 40^2), not 70

    def test_a_missing_margin_contributes_nothing_rather_than_everything(self) -> None:
        row = {"B11016_003M": "30", "B11016_011M": None}
        margins = cp.zone_margins_from_acs(row, [cp.SIZE_CONTROL])
        self.assertAlmostEqual(margins["size"]["2"], 30.0)

    def test_person_margins_are_scaled_the_same_way_the_targets_are(self) -> None:
        # A scaled target compared against an unscaled margin is a mismatched
        # comparison, and it would grade group-quarters-heavy zones leniently.
        row = {
            "B01001_003M": "100",
            cp.HOUSEHOLD_POPULATION_CELL: "250",
            cp.TOTAL_POPULATION_CELL: "500",
        }
        margins = cp.zone_margins_from_acs(row, [cp.AGE_CONTROL])
        self.assertAlmostEqual(margins["age"]["child"], 50.0)


class WhatTheProvenanceMustSay(unittest.TestCase):
    def test_it_names_the_areas_the_sample_actually_covers(self) -> None:
        # A PUMA is at least 100,000 people and rural ones span several counties,
        # so a household mix fitted for one small town is drawn from far wider
        # than the map shows. True of every population synthesiser, and worth
        # saying rather than leaving to be discovered.
        provenance = cp.seed_provenance(
            [{"name": "Nevada & Sierra Counties PUMA"}],
            {"sources": [], "person_records": 3749},
            1200,
            {"group_quarters": 12},
        )
        self.assertIn("Nevada & Sierra Counties PUMA", provenance["note"])
        self.assertIn("100,000", provenance["note"])

    def test_a_thin_sample_is_called_thin(self) -> None:
        provenance = cp.seed_provenance([{"name": "Somewhere PUMA"}], {"person_records": 90}, 120, {})
        self.assertIn("thin", provenance["note"])
        self.assertIn("120", provenance["note"])

    def test_a_healthy_sample_carries_no_thinness_warning(self) -> None:
        provenance = cp.seed_provenance([{"name": "Somewhere PUMA"}], {"person_records": 9000}, 3600, {})
        self.assertNotIn("thin", provenance["note"])


if __name__ == "__main__":
    unittest.main()
