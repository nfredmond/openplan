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
from screening_bundle import build_evidence_packet
from validate_screening_observed_counts import build_summary, write_markdown_report


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


class ZoneResolutionReachesTheOperatorReportTests(unittest.TestCase):
    """An operator's report must not say "passed" where the product says "not
    established".

    OpenPlan refuses to record a screening claim from a link-level count
    comparison when too much of a run's travel never reaches a link. That
    judgement lives in ONE place — the app's zone-resolution bands — and this
    script must not become a second copy of it. So the script reports the NUMBER
    the app bands, and says plainly that the gate it printed is a count-fit
    result the app still qualifies. One definition, two surfaces, nothing to
    drift.
    """

    def summary_for(self, evidence):
        results = [
            {"match_status": "matched", "absolute_percent_error": 10.0, "observed_volume": 1000,
             "modeled_daily_pce": 900, "label": f"station {idx}", "source_agency": "WSDOT"}
            for idx in range(3)
        ]
        return build_summary(
            evidence=evidence, counts_csv=Path("/runs/x/auto_aadt_counts.csv"),
            geometry_path=Path("/runs/x/geometry.geojson"), project_db=None,
            volume_field="daily_pce", results=results,
            ready_median_ape=30.0, ready_critical_ape=50.0, required_matches=3,
        )

    def test_summary_carries_the_share_from_the_evidence_packet(self):
        summary = self.summary_for({"vmt": {"intrazonal_share": 0.36}, "zone_count": 26})
        zone = summary["zone_resolution"]
        self.assertAlmostEqual(zone["intrazonal_trip_share"], 0.36)
        self.assertEqual(zone["zone_count"], 26)
        self.assertIn("not an adopted standard", zone["note"])

    def test_an_unrecorded_share_is_none_and_never_zero(self):
        # 0.0 would assert the finest possible zone system on a run nobody
        # measured — the most flattering answer available.
        for evidence in ({}, {"vmt": {}}, {"vmt": {"intrazonal_share": None}},
                         {"vmt": {"intrazonal_share": "0.36"}}):
            zone = self.summary_for(evidence)["zone_resolution"]
            self.assertIsNone(zone["intrazonal_trip_share"], evidence)

    def test_a_boolean_is_not_a_measurement(self):
        # bool is an int in Python; True must not become a 1.0 share.
        zone = self.summary_for({"vmt": {"intrazonal_share": True}})["zone_resolution"]
        self.assertIsNone(zone["intrazonal_trip_share"])

    def test_the_operator_report_qualifies_the_gate_it_prints(self):
        import tempfile
        summary = self.summary_for({"vmt": {"intrazonal_share": 0.36}, "zone_count": 26})
        # These three stations all sit inside the thresholds, so the gate PASSES
        # — which is exactly the case where an unqualified report misleads.
        self.assertEqual(summary["screening_gate"]["status_label"], "bounded screening-ready")

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.md"
            write_markdown_report(path, summary, [])
            text = path.read_text()

        self.assertIn("36.0%", text)
        self.assertIn("across 26 zones", text)
        self.assertIn("NOT recorded as a screening claim", text)
        self.assertIn("not an adopted standard", text)

    def test_the_report_says_so_when_the_share_was_never_recorded(self):
        import tempfile
        summary = self.summary_for({})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.md"
            write_markdown_report(path, summary, [])
            text = path.read_text()
        self.assertIn("not recorded by this run's producer", text)
        # An absent measurement must not be reported as a qualified pass.
        self.assertNotIn("36.0%", text)


class EvidencePacketCarriesWhatTheValidatorReadsTests(unittest.TestCase):
    """The validator reads the zone system out of `evidence_packet.json`.

    Every other test in this file hands `build_summary` a hand-built evidence
    dict, so none of them notices if the packet stops carrying the fields —
    verified by mutation: deleting `zone_count` from `build_evidence_packet`
    left them all green while the operator report silently lost "across N
    zones". The producer and the consumer have to be checked against each other,
    not each against a fixture.
    """

    def packet(self):
        return build_evidence_packet(
            run_name="nevada-county",
            zone_meta={"zone_type": "tract", "zones": 26},
            assignment_meta={"loaded_links": 900},
            demand_meta={"summary": {"total_trips": 319000}},
            skims={},
            caveats=[],
            vmt={"daily_vmt": 1.0, "intrazonal_share": 0.36, "intrazonal_trips": 936.0},
        )

    def test_the_packet_names_its_zone_count_not_just_its_zone_type(self):
        packet = self.packet()
        self.assertEqual(packet["zone_count"], 26)
        self.assertEqual(packet["zone_system"], "tract")

    def test_the_packet_carries_the_intrazonal_share(self):
        self.assertAlmostEqual(self.packet()["vmt"]["intrazonal_share"], 0.36)

    def test_the_validator_reads_the_real_packet_end_to_end(self):
        # Producer -> consumer, with no hand-written evidence dict in between.
        results = [
            {"match_status": "matched", "absolute_percent_error": 10.0, "observed_volume": 1000,
             "modeled_daily_pce": 900, "label": f"station {idx}", "source_agency": "Caltrans"}
            for idx in range(3)
        ]
        summary = build_summary(
            evidence=self.packet(), counts_csv=Path("/runs/x/counts.csv"),
            geometry_path=Path("/runs/x/geometry.geojson"), project_db=None,
            volume_field="daily_pce", results=results,
            ready_median_ape=30.0, ready_critical_ape=50.0, required_matches=3,
        )
        zone = summary["zone_resolution"]
        self.assertAlmostEqual(zone["intrazonal_trip_share"], 0.36)
        self.assertEqual(zone["zone_count"], 26)
        self.assertEqual(zone["zone_system"], "tract")


if __name__ == "__main__":
    unittest.main()
