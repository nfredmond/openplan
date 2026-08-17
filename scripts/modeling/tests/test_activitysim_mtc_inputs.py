#!/usr/bin/env python3
"""Tests for the prototype_mtc input adapter.

The person-coding tests grade against the stock example's own data — the rule
must reproduce ActivitySim's shipped persons.csv exactly, not merely look
plausible. The skim tests build a source OMX whose node ids deliberately do
NOT sort in zone order, so any implementation that assumes they do fails here
rather than in a county.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import activitysim_mtc_inputs as mtc
import census_pums as cp
from screening_metrics import METERS_PER_MILE, intrazonal_miles

STOCK_ROOT = (
    SCRIPT_DIR.parents[1]
    / "workers"
    / "activitysim_worker"
    / ".venv-exec"
    / "lib"
    / "python3.11"
    / "site-packages"
    / "activitysim"
    / "examples"
    / "prototype_mtc"
)


def worker_esr(is_working: bool) -> str:
    return "1" if is_working else "6"


class PersonCoding(unittest.TestCase):
    def test_the_ptype_rule_reproduces_the_stock_example_exactly(self):
        """The derivation must match ActivitySim's own shipped coding on every
        one of the example's persons — 'close' is a different person type."""
        persons_csv = STOCK_ROOT / "data" / "persons.csv"
        if not persons_csv.exists():
            self.skipTest(f"stock prototype_mtc example not installed at {STOCK_ROOT}")
        with persons_csv.open(newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertGreater(len(rows), 8000, "the stock example should have thousands of persons")
        mismatches = []
        for row in rows:
            derived = mtc.derive_ptype(int(row["age"]), int(row["pemploy"]), int(row["pstudent"]))
            if derived != int(row["ptype"]):
                mismatches.append((row["age"], row["pemploy"], row["pstudent"], row["ptype"], derived))
        self.assertEqual(mismatches[:5], [], f"{len(mismatches)} of {len(rows)} persons miscoded")

    def test_full_time_starts_at_35_hours(self):
        working = worker_esr(True)
        self.assertEqual(mtc.derive_pemploy(40, working, "35", is_working=cp.is_worker), mtc.PEMPLOY_FULL)
        self.assertEqual(mtc.derive_pemploy(40, working, "34", is_working=cp.is_worker), mtc.PEMPLOY_PART)

    def test_children_are_pemploy_child_whatever_their_esr_says(self):
        self.assertEqual(mtc.derive_pemploy(12, worker_esr(True), "40", is_working=cp.is_worker), mtc.PEMPLOY_CHILD)

    def test_a_worker_with_unreported_hours_is_part_time_not_full_time(self):
        self.assertEqual(mtc.derive_pemploy(40, worker_esr(True), "", is_working=cp.is_worker), mtc.PEMPLOY_PART)

    def test_non_workers_are_pemploy_not(self):
        self.assertEqual(mtc.derive_pemploy(40, "6", "40", is_working=cp.is_worker), mtc.PEMPLOY_NOT)

    def test_pstudent_codes_partition_schg(self):
        self.assertEqual(mtc.derive_pstudent("14"), mtc.PSTUDENT_GRADE_OR_HIGH)
        self.assertEqual(mtc.derive_pstudent("1"), mtc.PSTUDENT_GRADE_OR_HIGH)
        self.assertEqual(mtc.derive_pstudent("15"), mtc.PSTUDENT_UNIVERSITY)
        self.assertEqual(mtc.derive_pstudent("16"), mtc.PSTUDENT_UNIVERSITY)
        self.assertEqual(mtc.derive_pstudent(""), mtc.PSTUDENT_NOT)
        self.assertEqual(mtc.derive_pstudent(None), mtc.PSTUDENT_NOT)

    def test_an_adult_in_grade_school_codes_as_a_university_student(self):
        # The stock example codes 20+ K-12 attendees as ptype 3; 73 of its own
        # persons take this branch.
        self.assertEqual(mtc.derive_ptype(35, mtc.PEMPLOY_NOT, mtc.PSTUDENT_GRADE_OR_HIGH), mtc.PTYPE_UNIVERSITY)

    def test_an_unenrolled_child_is_still_a_student_person_type(self):
        self.assertEqual(mtc.derive_ptype(10, mtc.PEMPLOY_CHILD, mtc.PSTUDENT_NOT), mtc.PTYPE_SCHOOL)
        self.assertEqual(mtc.derive_ptype(3, mtc.PEMPLOY_CHILD, mtc.PSTUDENT_NOT), mtc.PTYPE_PRESCHOOL)

    def test_full_time_work_beats_university_enrolment(self):
        self.assertEqual(mtc.derive_ptype(28, mtc.PEMPLOY_FULL, mtc.PSTUDENT_UNIVERSITY), mtc.PTYPE_FULL)


FITTED_HOUSEHOLD = {
    "household_id": 1,
    "home_zone_id": 1,
    "persons": 2,
    "workers": 1,
    "autos": 2,
    "income": 100000,
    "hht": 1,
    "seed_household_id": "2022HU01",
    "source_geoid": "06057000100",
    "synthesis_method": "acs_pums_seed_iterative_proportional_updating",
}

FITTED_PERSON = {
    "person_id": 1,
    "household_id": 1,
    "person_num": 1,
    "home_zone_id": 1,
    "age": 40,
    "sex": 2,
    "is_worker": 1,
    "is_student": 0,
    "esr": "1",
    "schg": "",
    "wkhp": "40",
    "seed_household_id": "2022HU01",
    "source_geoid": "06057000100",
    "synthesis_method": "acs_pums_seed_iterative_proportional_updating",
}


class HouseholdConversion(unittest.TestCase):
    def test_income_is_deflated_to_year_2000_dollars(self):
        rows, accounting = mtc.mtc_households([FITTED_HOUSEHOLD])
        # Independent arithmetic: 100000 * 172.2 / 292.655 = 58840.7…
        self.assertEqual(rows[0]["income"], 58841)
        self.assertEqual(accounting["income_dollar_year"], 2000)

    def test_columns_are_exactly_the_mtc_vocabulary(self):
        rows, _ = mtc.mtc_households([FITTED_HOUSEHOLD])
        self.assertEqual(
            list(rows[0].keys()),
            ["household_id", "home_zone_id", "income", "hhsize", "HHT", "auto_ownership", "num_workers"],
        )
        self.assertEqual(rows[0]["hhsize"], 2)
        self.assertEqual(rows[0]["HHT"], 1)
        self.assertEqual(rows[0]["auto_ownership"], 2)
        self.assertEqual(rows[0]["num_workers"], 1)

    def test_a_scaffold_household_is_refused_with_the_fix_named(self):
        scaffold = {"household_id": 1, "home_zone_id": 1, "persons": 2, "workers": 1, "autos": 1, "income": 50000}
        with self.assertRaises(mtc.MtcInputError) as ctx:
            mtc.mtc_households([scaffold])
        self.assertIn("--population census", str(ctx.exception))

    def test_unreported_hht_is_counted_not_hidden(self):
        rows, accounting = mtc.mtc_households([{**FITTED_HOUSEHOLD, "hht": ""}])
        self.assertEqual(rows[0]["HHT"], 0)
        self.assertEqual(accounting["hht_unreported"], 1)

    def test_the_vintage_guard_refuses_a_repointed_endpoint(self):
        mtc.check_income_vintage("https://api.census.gov/data/2022/acs/acs5")
        with self.assertRaises(mtc.MtcInputError):
            mtc.check_income_vintage("https://api.census.gov/data/2023/acs/acs5")


class PersonConversion(unittest.TestCase):
    def test_columns_are_exactly_the_mtc_vocabulary(self):
        rows, _ = mtc.mtc_persons([FITTED_PERSON])
        self.assertEqual(
            list(rows[0].keys()),
            ["person_id", "household_id", "age", "PNUM", "sex", "pemploy", "pstudent", "ptype"],
        )
        self.assertEqual(rows[0]["PNUM"], 1)
        self.assertEqual(rows[0]["pemploy"], mtc.PEMPLOY_FULL)
        self.assertEqual(rows[0]["ptype"], mtc.PTYPE_FULL)

    def test_scaffold_persons_are_refused(self):
        scaffold = {"person_id": 1, "household_id": 1, "person_num": 1, "age": 30, "sex": 1}
        with self.assertRaises(mtc.MtcInputError) as ctx:
            mtc.mtc_persons([scaffold])
        self.assertIn("--population census", str(ctx.exception))

    def test_workers_with_unreported_hours_are_counted(self):
        _, accounting = mtc.mtc_persons([{**FITTED_PERSON, "wkhp": ""}])
        self.assertEqual(accounting["workers_with_unreported_hours_treated_part_time"], 1)


ZONES = [
    {
        "GEOID": "06057000100",
        "NAMELSAD": "Tract 1",
        "zone_id": 1,
        "centroid_lon": -121.0,
        "centroid_lat": 39.2,
        "area_sq_mi": 4.0,
        "total_jobs": 120.0,
        "retail_jobs": 30.0,
        "health_jobs": 20.0,
        "education_jobs": 10.0,
        "accommodation_jobs": 5.0,
        "govt_jobs": 15.0,
        "est_population": 900,
        "households": 400,
        "worker_residents": 500,
        "area_share": 0.5,
        "zone_kind": "internal",
    },
    {
        "GEOID": "06057000200",
        "NAMELSAD": "Tract 2",
        "zone_id": 2,
        "centroid_lon": -121.1,
        "centroid_lat": 39.3,
        "area_sq_mi": 0.0,
        "total_jobs": 0.0,
        "retail_jobs": 0.0,
        "health_jobs": 0.0,
        "education_jobs": 0.0,
        "accommodation_jobs": 0.0,
        "govt_jobs": 0.0,
        "est_population": 10,
        "households": 5,
        "worker_residents": 5,
        "area_share": 0.5,
        "zone_kind": "internal",
    },
    {
        "GEOID": "EXT0003",
        "NAMELSAD": "Gateway",
        "zone_id": 3,
        "centroid_lon": -121.2,
        "centroid_lat": 39.4,
        "area_sq_mi": 0.0,
        "total_jobs": 0.0,
        "retail_jobs": 0.0,
        "health_jobs": 0.0,
        "education_jobs": 0.0,
        "accommodation_jobs": 0.0,
        "govt_jobs": 0.0,
        "est_population": 0,
        "households": 0,
        "worker_residents": 0,
        "area_share": 0.0,
        "zone_kind": "external",
    },
]

ENROLLMENT = {
    "06057000100": {"high_school": 80.0, "college": 40.0},
    "06057000200": {"high_school": 0.0, "college": 0.0},
}


def _population_for_land_use():
    households = [
        {**FITTED_HOUSEHOLD, "household_id": 1, "home_zone_id": 1},
        {**FITTED_HOUSEHOLD, "household_id": 2, "home_zone_id": 1},
        {**FITTED_HOUSEHOLD, "household_id": 3, "home_zone_id": 2},
    ]
    persons = [
        {**FITTED_PERSON, "person_id": 1, "household_id": 1, "home_zone_id": 1, "age": 40},
        {**FITTED_PERSON, "person_id": 2, "household_id": 1, "home_zone_id": 1, "age": 12},
        {**FITTED_PERSON, "person_id": 3, "household_id": 2, "home_zone_id": 1, "age": 19},
        {**FITTED_PERSON, "person_id": 4, "household_id": 3, "home_zone_id": 2, "age": 70},
    ]
    return households, persons


class LandUse(unittest.TestCase):
    def build(self):
        households, persons = _population_for_land_use()
        return mtc.mtc_land_use(ZONES, households, persons, ENROLLMENT)

    def test_totals_come_from_the_population_actually_in_the_bundle(self):
        rows, _ = self.build()
        by_zone = {row["zone_id"]: row for row in rows}
        self.assertEqual(by_zone[1]["TOTHH"], 2)
        self.assertEqual(by_zone[1]["TOTPOP"], 3)
        self.assertEqual(by_zone[2]["TOTHH"], 1)
        # AGE0519 counts ages 5-19 inclusive: the 12- and 19-year-olds, not 40.
        self.assertEqual(by_zone[1]["AGE0519"], 2)
        self.assertEqual(by_zone[2]["AGE0519"], 0)

    def test_external_zones_are_excluded(self):
        rows, _ = self.build()
        self.assertEqual([row["zone_id"] for row in rows], [1, 2])

    def test_the_six_sectors_sum_to_totemp_in_every_zone(self):
        rows, _ = self.build()
        for row in rows:
            sector_sum = sum(int(row[s]) for s in mtc.EMPLOYMENT_SECTORS)
            self.assertEqual(sector_sum, int(row["TOTEMP"]), f"zone {row['zone_id']}")
        by_zone = {row["zone_id"]: row for row in rows}
        self.assertEqual(by_zone[1]["RETEMPN"], 30)
        self.assertEqual(by_zone[1]["HEREMPN"], 35)  # health 20 + education 10 + accommodation 5
        self.assertEqual(by_zone[1]["OTHEMPN"], 55)  # govt 15 + uncategorised remainder 40
        self.assertEqual(by_zone[1]["FPSEMPN"], 0)

    def test_developed_acres_never_divide_by_zero(self):
        rows, _ = self.build()
        for row in rows:
            self.assertGreaterEqual(row["RESACRE"] + row["CIACRE"], 1.0, f"zone {row['zone_id']}")

    def test_county_id_matches_no_bay_area_county(self):
        # MTC's auto_ownership and free_parking specs carry dummies for county
        # ids 1-9; a study area impersonating San Francisco would inherit its
        # adjustments.
        rows, _ = self.build()
        for row in rows:
            self.assertEqual(row["county_id"], 0)

    def test_area_type_stays_in_the_mtc_range(self):
        rows, _ = self.build()
        for row in rows:
            self.assertIn(row["area_type"], range(0, 6))

    def test_enrollment_maps_by_geoid_and_a_missing_zone_is_recorded(self):
        rows, accounting = self.build()
        by_zone = {row["zone_id"]: row for row in rows}
        self.assertEqual(by_zone[1]["HSENROLL"], 80.0)
        self.assertEqual(by_zone[1]["COLLFTE"], 40.0)
        rows2, accounting2 = mtc.mtc_land_use(ZONES, *_population_for_land_use(), {"06057000100": ENROLLMENT["06057000100"]})
        self.assertEqual(accounting2["zones_missing_enrollment"], ["06057000200"])
        self.assertEqual(accounting["zones_missing_enrollment"], [])


class SkimExpansion(unittest.TestCase):
    """Built on a source OMX whose node ids do NOT sort in zone order."""

    # zone 1 -> node 907, zone 2 -> node 903, zone 3 -> node 911: sorted node
    # order is NOT zone order, so positional shortcuts produce visibly
    # transposed values.
    CENTROID_MAP = {1: 907, 2: 903, 3: 911, 4: 909}

    def setUp(self):
        import numpy as np
        import openmatrix as omx

        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)

        # Source screening skim: 4x4 (3 internal + 1 external gateway), node
        # order sorted = [903, 907, 909, 911] = [zone 2, zone 1, external,
        # zone 3]. The zone2->zone1 direction is deliberately unreachable so
        # the sentinel path is exercised INSIDE the internal submatrix — while
        # zone 2 can still reach zone 3, so no zone is stranded.
        self.source_omx = root / "travel_time_skims.omx"
        time = np.array(
            [
                [0.0, np.inf, 30.0, 22.0],  # zone2 -> zone1 unreachable
                [11.0, 0.0, 30.0, 20.0],
                [30.0, 30.0, 0.0, 30.0],
                [23.0, 21.0, 30.0, 0.0],
            ]
        )
        dist = np.array(
            [
                [0.0, np.inf, 40000.0, 35000.0],
                [8850.0, 0.0, 40000.0, 32000.0],
                [40000.0, 40000.0, 0.0, 40000.0],
                [36000.0, 33000.0, 40000.0, 0.0],
            ]
        )
        with omx.open_file(str(self.source_omx), "w") as handle:
            handle["travel_time"] = time
            handle["distance"] = dist
            handle.create_mapping("main_index", [903, 907, 909, 911])

        # Fake stock example: a spec referencing names bracket- AND tuple-style,
        # and a stock skims.omx defining the inventory.
        self.stock_root = root / "stock"
        configs = self.stock_root / "configs"
        configs.mkdir(parents=True)
        (configs / "settings.yaml").write_text("models: []\n")
        (configs / "tour_mode_choice.csv").write_text(
            "Label,Expression\n"
            "a,odt_skims['SOV_TIME']\n"
            "b,od_skims['DIST']\n"
            "c,odt_skims['WLK_LOC_WLK_TOTIVT']\n"
            "d,\"skim_od[('WLK_TRN_WLK_IVT', 'AM')]\"\n"
        )
        data = self.stock_root / "data"
        data.mkdir()
        self.stock_skims = data / "skims.omx"
        periods = ["EA", "AM", "MD", "PM", "EV"]
        with omx.open_file(str(self.stock_skims), "w") as handle:
            tiny = np.zeros((2, 2))
            handle["DIST"] = tiny
            handle["DISTWALK"] = tiny
            for period in periods:
                handle[f"SOV_TIME__{period}"] = tiny
                handle[f"SOV_DIST__{period}"] = tiny
                handle[f"SOV_BTOLL__{period}"] = tiny
                handle[f"WLK_LOC_WLK_TOTIVT__{period}"] = tiny
            for period in ("AM", "MD", "PM"):
                handle[f"WLK_TRN_WLK_IVT__{period}"] = tiny

        self.output_omx = root / "out" / "mtc_skims.omx"

    def tearDown(self):
        self.tmp.cleanup()

    def skim_zones(self):
        """Three internal zones plus one external gateway."""
        zone3 = {**ZONES[0], "GEOID": "06057000300", "zone_id": 3, "area_sq_mi": 2.0}
        external = {**ZONES[2], "zone_id": 4}
        return [ZONES[0], ZONES[1], zone3, external]

    def expand(self, **overrides):
        kwargs = dict(
            source_omx=self.source_omx,
            output_omx=self.output_omx,
            internal_zone_rows=self.skim_zones(),
            centroid_map=self.CENTROID_MAP,
            stock_configs_dir=self.stock_root / "configs",
            stock_skims_omx=self.stock_skims,
        )
        kwargs.update(overrides)
        return mtc.expand_skims(**kwargs)

    def test_rows_are_reordered_from_node_order_to_zone_order(self):
        import numpy as np
        import openmatrix as omx

        self.expand()
        with omx.open_file(str(self.output_omx), "r") as handle:
            sov_am = np.array(handle["SOV_TIME__AM"])
        # In the source (node order), zone1->zone2 sits at [1][0] = 11.0.
        # In zone order it must be [0][1]. An implementation that assumed the
        # node ids sort in zone order would put it at [1][0] instead.
        self.assertAlmostEqual(sov_am[0][1], 11.0)
        self.assertAlmostEqual(sov_am[1][0], mtc.UNREACHABLE_SENTINEL)

    def test_distances_are_miles_and_diagonals_use_the_intrazonal_convention(self):
        import numpy as np
        import openmatrix as omx

        self.expand()
        with omx.open_file(str(self.output_omx), "r") as handle:
            dist = np.array(handle["DIST"])
            sov_time = np.array(handle["SOV_TIME__MD"])
        self.assertAlmostEqual(dist[0][1], 8850.0 / METERS_PER_MILE, places=4)
        self.assertAlmostEqual(dist[0][0], intrazonal_miles(4.0), places=6)
        self.assertAlmostEqual(dist[1][1], intrazonal_miles(0.0), places=6)  # 0.75 fallback
        self.assertAlmostEqual(
            sov_time[0][0], intrazonal_miles(4.0) / mtc.INTRAZONAL_SPEED_MPH * 60.0, places=6
        )
        self.assertGreater(sov_time.min(), 0.0, "a zero time would trip the SOV availability test")

    def test_transit_and_tolls_are_zero_everywhere(self):
        import numpy as np
        import openmatrix as omx

        self.expand()
        with omx.open_file(str(self.output_omx), "r") as handle:
            for name in ("WLK_LOC_WLK_TOTIVT__AM", "WLK_TRN_WLK_IVT__MD", "SOV_BTOLL__PM"):
                self.assertEqual(np.abs(np.array(handle[name])).max(), 0.0, name)

    def test_the_output_mirrors_the_stock_inventory_with_no_mapping(self):
        import openmatrix as omx

        accounting = self.expand()
        with omx.open_file(str(self.output_omx), "r") as handle:
            names = set(str(n) for n in handle.list_matrices())
            mappings = handle.list_mappings()
        with omx.open_file(str(self.stock_skims), "r") as handle:
            stock_names = set(str(n) for n in handle.list_matrices())
        self.assertEqual(names, stock_names)
        self.assertEqual(list(mappings), [])
        self.assertEqual(accounting["matrices_written"], len(stock_names))

    def test_unreachable_pairs_get_the_sentinel_and_are_counted(self):
        import numpy as np
        import openmatrix as omx

        accounting = self.expand()
        self.assertEqual(accounting["unreachable_pairs_sentinelled"], 1)  # zone1->zone3 is external
        with omx.open_file(str(self.output_omx), "r") as handle:
            sov = np.array(handle["SOV_TIME__AM"])
        self.assertTrue(np.isfinite(sov).all())

    def test_a_source_without_a_distance_matrix_is_refused(self):
        import numpy as np
        import openmatrix as omx

        bare = Path(self.tmp.name) / "bare.omx"
        with omx.open_file(str(bare), "w") as handle:
            handle["travel_time"] = np.zeros((3, 3))
            handle.create_mapping("main_index", [903, 907, 909])
        with self.assertRaises(mtc.MtcInputError) as ctx:
            self.expand(source_omx=bare)
        self.assertIn("distance", str(ctx.exception))

    def test_a_spec_name_missing_from_the_inventory_is_an_error(self):
        (self.stock_root / "configs" / "extra.csv").write_text(
            "Label,Expression\nz,odt_skims['HOV9_TIME']\n"
        )
        with self.assertRaises(mtc.MtcInputError) as ctx:
            self.expand()
        self.assertIn("HOV9_TIME", str(ctx.exception))

    def test_a_zone_missing_from_the_centroid_map_is_an_error(self):
        with self.assertRaises(mtc.MtcInputError):
            self.expand(centroid_map={1: 907})

    def test_a_zone_that_can_reach_nothing_is_refused_with_the_zone_named(self):
        """Measured on Jackson County OR (41029): one stranded zone of 52 kills
        ActivitySim four minutes in, with a pandas index error naming nothing.
        Refused here instead, before a model run is spent on it."""
        import numpy as np
        import openmatrix as omx

        stranded = Path(self.tmp.name) / "stranded.omx"
        # zone 3 (node 911, row 3) can neither reach nor be reached by any
        # other internal zone.
        time = np.array(
            [
                [0.0, 12.0, 30.0, np.inf],
                [11.0, 0.0, 30.0, np.inf],
                [30.0, 30.0, 0.0, 30.0],
                [np.inf, np.inf, 30.0, 0.0],
            ]
        )
        dist = np.where(np.isfinite(time), 20000.0, np.inf)
        np.fill_diagonal(dist, 0.0)
        with omx.open_file(str(stranded), "w") as handle:
            handle["travel_time"] = time
            handle["distance"] = dist
            handle.create_mapping("main_index", [903, 907, 909, 911])

        with self.assertRaises(mtc.MtcInputError) as ctx:
            self.expand(source_omx=stranded)
        message = str(ctx.exception)
        self.assertIn("cannot reach any other zone", message)
        self.assertIn("3", message)
        self.assertIn("one-way", message)

    def test_a_merely_unreachable_pair_does_not_trip_the_stranded_guard(self):
        """The negative control for the guard above: the standard fixture has an
        unreachable pair and must still build."""
        accounting = self.expand()
        self.assertEqual(accounting["unreachable_pairs_sentinelled"], 1)

    def test_tuple_style_references_are_seen_by_the_scan(self):
        names = mtc.required_skim_names(self.stock_root / "configs")
        self.assertIn("WLK_TRN_WLK_IVT", names)
        self.assertIn("SOV_TIME", names)


class RequiredNamesOnTheRealStock(unittest.TestCase):
    def test_the_live_scan_finds_the_tuple_only_transit_family(self):
        configs = STOCK_ROOT / "configs"
        if not configs.is_dir():
            self.skipTest(f"stock prototype_mtc example not installed at {STOCK_ROOT}")
        names = mtc.required_skim_names(configs)
        self.assertGreater(len(names), 100)
        for expected in ("SOV_TIME", "DIST", "WLK_LOC_WLK_TOTIVT", "WLK_TRN_WLK_IVT"):
            self.assertIn(expected, names)
        inventory = {n.partition("__")[0] for n in mtc.stock_skim_inventory(STOCK_ROOT / "data" / "skims.omx")}
        self.assertEqual(sorted(names - inventory), [], "specs reference names the stock OMX lacks")


class ConfigGeneration(unittest.TestCase):
    def test_settings_inherit_and_drop_exactly_the_three_reporting_steps(self):
        text = mtc.mtc_settings_yaml()
        self.assertIn("inherit_settings: True", text)
        self.assertIn("households_sample_size: 0", text)
        for dropped in ("write_trip_matrices", "summarize", "track_skim_usage"):
            self.assertNotIn(dropped, text)
        for kept in ("trip_mode_choice", "write_tables", "write_data_dictionary", "compute_accessibility"):
            self.assertIn(f"- {kept}", text)

    def test_the_land_use_keep_columns_match_the_installed_stock_settings(self):
        """The overlay's keep_columns must equal the stock list, read live —
        a drifted list silently drops a column the specs read."""
        stock_settings = STOCK_ROOT / "configs" / "settings.yaml"
        if not stock_settings.exists():
            self.skipTest(f"stock prototype_mtc example not installed at {STOCK_ROOT}")
        text = stock_settings.read_text()
        land_use_block = text.split("tablename: land_use", 1)[1]
        keep_block = land_use_block.split("keep_columns:", 1)[1]
        stock_columns = []
        for line in keep_block.splitlines()[1:]:
            stripped = line.strip()
            if not stripped.startswith("- "):
                if stripped and not stripped.startswith("#"):
                    break
                continue
            stock_columns.append(stripped[2:].strip())
        self.assertEqual(stock_columns, mtc.MTC_LAND_USE_KEEP_COLUMNS)

    def test_network_los_mirrors_the_stock_periods_and_points_at_the_expanded_skims(self):
        text = mtc.mtc_network_los_yaml()
        self.assertIn("taz_skims: skims/mtc_skims.omx", text)
        self.assertIn("periods: [0, 3, 5, 9, 14, 18, 24]", text)
        self.assertIn("labels: ['EA', 'EA', 'AM', 'MD', 'PM', 'EV']", text)
        self.assertIn("inherit_settings: False", text)

    def test_the_settings_do_not_ship_a_constants_file_reference(self):
        # A constants.yaml in the overlay would SHADOW the stock one
        # (first-match resolution), silently replacing every person-type code.
        self.assertNotIn("constants", mtc.mtc_settings_yaml())


class StockDigest(unittest.TestCase):
    def test_content_and_names_both_move_the_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.csv").write_text("one")
            (root / "b.yaml").write_text("two")
            base = mtc.stock_configs_digest(root)
            (root / "b.yaml").write_text("two!")
            changed_content = mtc.stock_configs_digest(root)
            self.assertNotEqual(base, changed_content)
            (root / "b.yaml").rename(root / "c.yaml")
            self.assertNotEqual(changed_content, mtc.stock_configs_digest(root))

    def test_the_worker_runtime_computes_the_identical_digest(self):
        worker_dir = SCRIPT_DIR.parents[1] / "workers" / "activitysim_worker"
        if str(worker_dir) not in sys.path:
            sys.path.insert(0, str(worker_dir))
        import runtime as worker_runtime

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "settings.yaml").write_text("models: []\n")
            (root / "spec.csv").write_text("Label,Expression\n")
            self.assertEqual(worker_runtime._stock_configs_digest(root), mtc.stock_configs_digest(root))


class StockResolution(unittest.TestCase):
    def test_an_explicit_configs_subdirectory_is_accepted(self):
        if not STOCK_ROOT.is_dir():
            self.skipTest(f"stock prototype_mtc example not installed at {STOCK_ROOT}")
        via_root = mtc.resolve_stock_prototype_mtc(str(STOCK_ROOT))
        via_configs = mtc.resolve_stock_prototype_mtc(str(STOCK_ROOT / "configs"))
        self.assertEqual(via_root["configs_dir"], via_configs["configs_dir"])
        self.assertEqual(via_root["activitysim_version"], "1.5.1")

    def test_a_bogus_path_is_refused_with_the_fix_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(mtc.MtcInputError) as ctx:
                mtc.resolve_stock_prototype_mtc(str(Path(tmp) / "nowhere"))
            self.assertIn("stock-configs-dir", str(ctx.exception))


class Caveats(unittest.TestCase):
    def test_the_caveats_name_the_borrowed_region_and_the_zeroed_transit(self):
        joined = " ".join(mtc.mtc_config_caveats())
        self.assertIn("San Francisco Bay Area", joined)
        self.assertIn("transit", joined)
        self.assertIn("2000 dollars", joined)


if __name__ == "__main__":
    unittest.main()
