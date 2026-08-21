#!/usr/bin/env python3
"""A denominator that reports zero when it found nothing is worse than no denominator.

Every test here is a failure this module was written after walking into on
2026-08-20, in the hour before it existed:

  * a service named `HPMS_FULL_PR_2022` holds 43,860 sections, ALL of them
    Puerto Rico, and answers a query for Colorado with zero rows and no error;
  * that same service renames every field, so a query written against the
    per-state schema returns nothing rather than failing;
  * two of the 52 published service names do not follow the naming pattern, so
    a derived name works for 50 states and silently 404s for Alaska and DC.

In each case the wrong answer was a plausible number or an empty result, never
an exception. That is the shape this file exists to make impossible.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import vmt_sources as vs


def section(aadt, begin=0.0, end=1.0, f_system=3):
    return {"aadt": aadt, "begin_point": begin, "end_point": end, "f_system": f_system}


class TheArithmetic(unittest.TestCase):
    def test_vehicle_miles_are_aadt_times_length(self) -> None:
        got = vs.county_vmt_from_sections([section(1000, 0.0, 2.0), section(500, 2.0, 4.0)])
        self.assertEqual(got["daily_vehicle_miles"], 3000.0)
        self.assertEqual(got["centerline_miles"], 4.0)
        self.assertEqual(got["sections"], 2)

    def test_a_section_without_aadt_is_counted_not_treated_as_empty_road(self) -> None:
        """'No data' and 'no cars' are different facts. Summing the second when
        the first is true shrinks the denominator, which makes the model look
        worse — so nothing downstream would look wrong."""
        got = vs.county_vmt_from_sections([section(1000, 0.0, 1.0), section(None, 1.0, 3.0)])
        self.assertEqual(got["daily_vehicle_miles"], 1000.0)
        self.assertEqual(got["sections_without_aadt"], 1)
        # …and its length still counts as road that exists.
        self.assertEqual(got["centerline_miles"], 3.0)

    def test_a_zero_length_or_reversed_section_is_reported_not_silently_dropped(self) -> None:
        got = vs.county_vmt_from_sections([section(1000, 5.0, 5.0), section(1000, 4.0, 2.0)])
        self.assertEqual(got["daily_vehicle_miles"], 0.0)
        self.assertEqual(got["sections_without_length"], 2)
        self.assertEqual(got["sections"], 2)

    def test_travel_is_split_by_functional_system(self) -> None:
        got = vs.county_vmt_from_sections(
            [section(100, 0, 1, f_system=1), section(200, 0, 1, f_system=5)]
        )
        self.assertEqual(got["by_functional_system"], {1: 100.0, 5: 200.0})


class TheNumeratorIsReducedToWhatHpmsWouldHaveCounted(unittest.TestCase):
    """Two reductions, both reported, so a reader can see how much each moved."""

    def link(self, link_type, miles, inside=1.0):
        return {"link_type": link_type, "vehicle_miles": miles, "inside_fraction": inside}

    def test_travel_outside_the_boundary_is_removed_and_reported(self) -> None:
        got = vs.scoped_vmt_from_links([self.link("primary", 1000, 0.4)])
        self.assertEqual(got["scoped_daily_vehicle_miles"], 400.0)
        self.assertEqual(got["dropped_outside_boundary"], 600.0)
        self.assertEqual(got["unclipped_daily_vehicle_miles"], 1000.0)

    def test_classes_hpms_does_not_publish_are_removed_and_reported(self) -> None:
        got = vs.scoped_vmt_from_links(
            [self.link("primary", 1000), self.link("residential", 300), self.link("service", 200)]
        )
        self.assertEqual(got["scoped_daily_vehicle_miles"], 1000.0)
        self.assertEqual(got["dropped_out_of_hpms_scope"], 500.0)

    def test_centroid_connectors_are_out_of_scope_because_they_are_not_roads(self) -> None:
        got = vs.scoped_vmt_from_links([self.link("centroid_connector", 999)])
        self.assertEqual(got["scoped_daily_vehicle_miles"], 0.0)

    def test_TERTIARY_IS_KEPT_because_HPMS_publishes_major_collectors(self) -> None:
        """The judgement that matters most in the mapping.

        HPMS Full Extent excludes LOCAL and RURAL MINOR COLLECTOR, not major
        collectors — and `tertiary` is the closest OSM class to a major
        collector. Dropping it would take 8.2% of the model's vehicle-miles out
        of the numerator against a denominator that kept them, which would make
        the model look better for a reason that is not about the model.
        """
        self.assertNotIn("tertiary", vs.OSM_CLASSES_OUTSIDE_HPMS_SCOPE)
        got = vs.scoped_vmt_from_links([self.link("tertiary", 800)])
        self.assertEqual(got["scoped_daily_vehicle_miles"], 800.0)

    def test_a_link_outside_the_boundary_is_not_also_charged_as_out_of_scope(self) -> None:
        # A residential link half outside must not be counted in both buckets,
        # or the two disclosures add up to more than the run drove.
        got = vs.scoped_vmt_from_links([self.link("residential", 1000, 0.5)])
        self.assertEqual(got["dropped_outside_boundary"], 500.0)
        self.assertEqual(got["dropped_out_of_hpms_scope"], 500.0)
        self.assertEqual(
            got["dropped_outside_boundary"] + got["dropped_out_of_hpms_scope"]
            + got["scoped_daily_vehicle_miles"],
            got["unclipped_daily_vehicle_miles"],
        )


class TheServiceNamesAreWrittenDownBecauseTheRuleDoesNotHold(unittest.TestCase):
    def test_every_state_and_dc_is_registered(self) -> None:
        # 50 states + DC + Puerto Rico, verified against the live service
        # directory on 2026-08-20.
        self.assertEqual(len(vs.HPMS_2018_SERVICE_BY_STATE_FIPS), 52)
        for fips in ("06", "08", "41", "53"):
            self.assertIn(fips, vs.HPMS_2018_SERVICE_BY_STATE_FIPS)

    def test_the_two_names_a_derived_rule_would_get_wrong(self) -> None:
        """A CamelCase rule produces DistrictOfColumbia and Alaska. Both 404,
        and a 404 here reads as a county with no roads."""
        self.assertEqual(vs.hpms_service("11"), "District_2018_PR")
        self.assertEqual(vs.hpms_service("02"), "Alaska_2018_PR_test")

    def test_an_unregistered_state_refuses_and_says_what_is_registered(self) -> None:
        with self.assertRaises(vs.VmtSourceError) as caught:
            vs.hpms_service("99")
        self.assertIn("99", str(caught.exception))
        self.assertIn("Registered", str(caught.exception))

    def test_a_state_fips_is_accepted_without_its_leading_zero(self) -> None:
        self.assertEqual(vs.hpms_service("8"), vs.hpms_service("08"))


class TheQueryIsBuiltFromTheFeedsOwnFieldNames(unittest.TestCase):
    def test_the_county_filter_uses_the_last_three_digits(self) -> None:
        # Callers hold five-digit county FIPS; HPMS stores the three-digit code.
        url = vs.county_query_url("08", "08014")
        self.assertIn("county_code%3D14", url)
        self.assertIn("Colorado_2018_PR", url)

    def test_it_asks_for_the_2018_schema_not_the_2022_one(self) -> None:
        """The 2022 national service calls these stateid/county_id/beginpoint.
        Querying one schema against the other returns zero rows and no error,
        which is how `HPMS_FULL_PR_2022` looked usable."""
        url = vs.county_query_url("06", "06047")
        for field in ("aadt", "begin_point", "end_point", "f_system"):
            self.assertIn(field, url)
        self.assertNotIn("beginpoint", url)
        self.assertNotIn("county_id", url)


class ItRefusesRatherThanReportingZero(unittest.TestCase):
    def test_no_sections_raises_instead_of_returning_no_vehicle_miles(self) -> None:
        """The failure that started this: a query returning zero rows for a real
        county, with no error, because the schema was wrong. Zero vehicle-miles
        and 'I found nothing' are indistinguishable in a number."""
        original = vs.fetch_county_sections
        try:
            vs.fetch_county_sections = lambda *a, **k: []
            with self.assertRaises(vs.VmtSourceError) as caught:
                vs.county_vmt("08", "08014")
            self.assertIn("no sections", str(caught.exception))
        finally:
            vs.fetch_county_sections = original

    def test_the_result_says_it_is_derived_and_names_its_scope(self) -> None:
        original = vs.fetch_county_sections
        try:
            vs.fetch_county_sections = lambda *a, **k: [section(1000, 0.0, 2.0)]
            got = vs.county_vmt("08", "08014")
        finally:
            vs.fetch_county_sections = original
        self.assertFalse(got["is_published_figure"])
        self.assertIn("not a published county figure", got["not_reconciled_note"])
        self.assertIn("local or rural minor collector", got["scope"])
        self.assertEqual(got["vintage"], 2018)
        self.assertIn("Colorado_2018_PR", got["source_service"])


class TheDenominatorIsFetchedOncePerCounty(unittest.TestCase):
    """A gamma sweep grades several arms of one county, and a published figure
    cannot change between them."""

    def setUp(self) -> None:
        vs.reset_county_vmt_cache()
        self.calls = 0
        self.original = vs.fetch_county_sections

        def counting(*args, **kwargs):
            self.calls += 1
            return [section(1000, 0.0, 2.0)]

        vs.fetch_county_sections = counting

    def tearDown(self) -> None:
        vs.fetch_county_sections = self.original
        vs.reset_county_vmt_cache()

    def test_a_second_ask_for_the_same_county_does_not_refetch(self) -> None:
        first = vs.county_vmt("08", "08014")
        second = vs.county_vmt("08", "08014")
        self.assertEqual(self.calls, 1)
        self.assertEqual(first["daily_vehicle_miles"], second["daily_vehicle_miles"])

    def test_a_different_county_is_fetched(self) -> None:
        vs.county_vmt("08", "08014")
        vs.county_vmt("08", "08101")
        self.assertEqual(self.calls, 2)

    def test_the_caller_cannot_mutate_what_the_next_caller_receives(self) -> None:
        """Mutate a CACHED read, not the first one.

        The first call returns the freshly computed dict, which was never the
        cached object — so mutating it proves nothing, and a version handing out
        the cache itself passed this test until the mutation exposed it. The
        protection only exists from the second read onward, so that is where it
        has to be tested.
        """
        vs.county_vmt("08", "08014")                    # populates
        cached = vs.county_vmt("08", "08014")           # a cached read
        cached["daily_vehicle_miles"] = -1
        third = vs.county_vmt("08", "08014")
        self.assertNotEqual(third["daily_vehicle_miles"], -1)
        self.assertEqual(third["daily_vehicle_miles"], 2000.0)

    def test_a_failure_is_retried_rather_than_remembered(self) -> None:
        """Caching a transient 500 would turn one bad minute into a whole study
        with no denominator. FHWA returned exactly that on 2026-08-20."""
        vs.fetch_county_sections = lambda *a, **k: []
        with self.assertRaises(vs.VmtSourceError):
            vs.county_vmt("08", "08014")
        vs.fetch_county_sections = self.original

        def works(*a, **k):
            self.calls += 1
            return [section(1000, 0.0, 2.0)]

        vs.fetch_county_sections = works
        self.assertEqual(vs.county_vmt("08", "08014")["daily_vehicle_miles"], 2000.0)


if __name__ == "__main__":
    unittest.main(verbosity=1)
