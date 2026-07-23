"""Count-set provenance checks: every row a count builder writes must name the
agency that actually published it, and the validation summary must carry that
agency forward instead of leaving downstream evidence to guess from a file path.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import count_sources
from build_expanded_aadt_counts import station_row
from validate_screening_observed_counts import build_summary


def point(**overrides):
    pt = {"rte": "20", "pm": 12.24, "desc": "BRUNSWICK ROAD", "obs": 35500,
          "lon": -121.0, "lat": 39.2}
    pt.update(overrides)
    return pt


class SourceProvenanceTests(unittest.TestCase):
    def test_every_registered_source_declares_its_agency(self):
        for region in count_sources.COUNT_SOURCES:
            prov = count_sources.source_provenance(region)
            self.assertTrue(prov["agency"], region)
            self.assertTrue(prov["station_prefix"], region)

    def test_each_region_reports_its_own_agency(self):
        agencies = {r: count_sources.source_provenance(r)["agency"] for r in ("CA", "WA", "CO", "OR")}
        self.assertEqual(len(set(agencies.values())), len(agencies), agencies)
        for region, agency in agencies.items():
            if region != "CA":
                self.assertNotIn("caltrans", agency.lower(), region)

    def test_unregistered_region_fails_closed(self):
        with self.assertRaises(ValueError):
            count_sources.source_provenance("ZZ")

    def test_source_missing_agency_is_refused(self):
        # A half-filled registry entry must not silently produce unattributed
        # counts; adding a state means declaring who publishes it.
        count_sources.COUNT_SOURCES["ZZ"] = {"name": "Somewhere AADT", "fields": {"route": "R", "aadt": "AADT"}}
        try:
            with self.assertRaises(ValueError):
                count_sources.source_provenance("ZZ")
        finally:
            del count_sources.COUNT_SOURCES["ZZ"]


class StationRowProvenanceTests(unittest.TestCase):
    def test_non_california_counts_never_carry_caltrans_attribution(self):
        prov = count_sources.source_provenance("WA")
        row = station_row(point(rte="005", pm=0.3, desc="I-5"), prov, "Interstate 5", "motorway", "")
        self.assertEqual(row["source_agency"], "WSDOT")
        self.assertTrue(row["station_id"].startswith("WSDOT_"))
        for field, value in row.items():
            self.assertNotIn("caltrans", str(value).lower(), field)

    def test_unknown_vintage_is_left_blank_and_said_out_loud(self):
        prov = count_sources.source_provenance("CO")
        row = station_row(point(rte="025A", pm=None), prov, "I-25", "motorway", "")
        self.assertEqual(row["count_year"], "")
        self.assertIn("vintage not published", row["notes"])
        # No postmile in the feed -> the coordinate names the station instead.
        self.assertIn("_AT", row["station_id"])

    def test_california_rows_keep_their_caltrans_provenance(self):
        prov = count_sources.source_provenance("CA")
        row = station_row(point(), prov, "Colfax Highway", "secondary", "Brunswick Road")
        self.assertEqual(row["source_agency"], "Caltrans")
        self.assertEqual(row["station_id"], "CT_RTE20_PM12_240")
        self.assertEqual(row["count_year"], 2023)
        self.assertEqual(row["facility_name"], "SR 20")


class ValidationSummaryProvenanceTests(unittest.TestCase):
    def summary_for(self, agencies):
        results = [
            {"match_status": "matched", "absolute_percent_error": 10.0, "observed_volume": 1000,
             "modeled_daily_pce": 900, "label": f"station {idx}", "source_agency": agency}
            for idx, agency in enumerate(agencies)
        ]
        return build_summary(
            evidence={}, counts_csv=Path("/runs/x/auto_aadt_counts.csv"),
            geometry_path=Path("/runs/x/geometry.geojson"), project_db=None,
            volume_field="daily_pce", results=results,
            ready_median_ape=30.0, ready_critical_ape=50.0, required_matches=3,
        )

    def test_summary_carries_the_agencies_the_counts_declare(self):
        summary = self.summary_for(["WSDOT", "WSDOT", "Snohomish County"])
        self.assertEqual(summary["count_source_agencies"], ["Snohomish County", "WSDOT"])

    def test_unattributed_counts_report_an_empty_agency_list(self):
        summary = self.summary_for(["", "  "])
        self.assertEqual(summary["count_source_agencies"], [])


if __name__ == "__main__":
    unittest.main()
