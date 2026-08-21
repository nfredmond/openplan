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


if __name__ == "__main__":
    unittest.main(verbosity=1)
